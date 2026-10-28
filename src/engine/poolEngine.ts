import { impactOf, quoteReserveFromLiquidity, usdToMoveDown, usdToMoveUp } from './amm';
import { Calibrator, type HorizonEstimate, type LevelHoldEstimate } from './calibration';
import { CandleBuilder, type Candle } from './candles';
import { DEFAULT_CONFIG, ENGINE_VERSION, type EngineConfig } from './config';
import { assessDiscovery, type Discovery } from './discovery';
import { copy, fmtPct, fmtUsd, shortAddr } from './copy';
import { Ring, RollingWindow } from './rolling';
import { SetupStateMachine, type SetupView, type Transition } from './stateMachine';
import { clamp, median, std, zScore } from './stats';
import type { Direction, FeedHealth, FeedStatus, MarketRef, PoolState, Side, Swap, WickEvent } from './types';

export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface EngineOptions {
  market: MarketRef;
  source: { name: string; mode: 'push' | 'poll'; pollMs?: number };
  config?: EngineConfig;
  store?: KVStore;
  onEvent?: (e: WickEvent) => void;
}

export interface ImpactRow {
  pct: number;
  /** USD of buys needed to move price up by pct. */
  upUsd: number;
  /** USD of sells needed to move price down by pct. */
  downUsd: number;
}

export interface WalletRow {
  wallet: string;
  buyUsd: number;
  sellUsd: number;
  trades: number;
  /** Share of total 5-min volume. */
  share: number;
}

export interface FlowView {
  buyUsdShort: number;
  sellUsdShort: number;
  buyUsdLong: number;
  sellUsdLong: number;
  deltaShort: number;
  deltaLong: number;
  swapsPerMin: number;
  buyersLong: number;
  sellersLong: number;
  /** Net 5-min flow expressed as the price move it would cause on this curve (no offsetting flow). */
  netImpactLong: number | null;
  cvdUsd: number;
  cvdSeries: number[];
}

export interface ScoreParts {
  flowShort: number;
  flowLong: number;
  wallets: number;
  flowVsLiquidity: number;
}

export interface EngineSnapshot {
  now: number;
  market: MarketRef;
  health: FeedHealth;
  /** False whenever the data can't be trusted (no price, stale source). Signals are withheld. */
  valid: boolean;
  invalidReason: string | null;
  warmup: { ready: boolean; have: number; need: number };
  price: number | null;
  priceSource: 'swap' | 'pool' | null;
  pool: PoolState | null;
  quoteReserveUsd: number | null;
  /** True when impact is computed from exact curve reserves (bonding curve). */
  impactExact: boolean;
  impact: ImpactRow[];
  flow: FlowView;
  wallets: WalletRow[];
  whales: Swap[];
  tape: Swap[];
  volatility: { sigma1sBps: number | null; compression: number | null; rangeHigh: number | null; rangeLow: number | null };
  score: number;
  scoreParts: ScoreParts;
  scoreSeries: number[];
  priceSeries: number[];
  liquiditySeries: number[];
  setup: SetupView;
  estimates: HorizonEstimate[];
  levelHolds: LevelHoldEstimate[];
  floors: { kind: 'floor' | 'ceiling'; level: number; ts: number }[];
  candles: Candle[];
  /** 5-minute candles used for structure (swing range, Fibonacci, VWAP, volume-by-price). */
  structure: Candle[];
  discovery: Discovery;
  events: WickEvent[];
  /** Newest-last micro log of what the engine just did — real processing steps, for the ticker. */
  activity: ActivityItem[];
}

export interface ActivityItem {
  ts: number;
  text: string;
}

const MAX_EVENTS = 250;
/** True once every 5 s (called from the 1 Hz loop). */
const sec5 = (now: number) => Math.floor(now / 1000) % 5 === 0;
const IMPACT_STEPS = [0.01, 0.02, 0.05, 0.1, 0.25];

interface FlowItem {
  ts: number;
  side: Side;
  usd: number;
  wallet?: string;
}

/**
 * The quantitative core for on-chain markets. Sources push swaps and pool
 * state in; `tick(now)` advances the analytics and returns a snapshot for the
 * UI / agent. All timing uses the `now` values passed in, so the engine is
 * deterministic under test and replay.
 */
export class PoolEngine {
  readonly cfg: EngineConfig;
  private health: FeedHealth;
  private pool: PoolState | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];

  private buyShort: RollingWindow;
  private sellShort: RollingWindow;
  private buyLong: RollingWindow;
  private sellLong: RollingWindow;
  private buyAbs: RollingWindow;
  private sellAbs: RollingWindow;
  private swapCount: RollingWindow;
  /** Swaps in the long window, for wallet breadth and concentration. */
  private recent: FlowItem[] = [];
  private cvd = 0;
  private lastSwap: Swap | null = null;
  private whaleList: Swap[] = [];
  private tapeList: Swap[] = [];

  private prices = new Ring(3600);
  private sellAbsHist = new Ring(900);
  private buyAbsHist = new Ring(900);
  private cvdHist = new Ring(900);
  private scoreHist = new Ring(300);
  private liqHist: { ts: number; liq: number; price: number }[] = [];
  private liqSeries = new Ring(240);

  private sm: SetupStateMachine;
  private cal: Calibrator;
  private candles = new CandleBuilder();
  private structure = new CandleBuilder(300_000, 200);
  private lastDiscovery: Discovery | null = null;
  private events: WickEvent[] = [];
  private lastSupport: Record<Direction, number | null> = { up: null, down: null };
  private cooldowns: Record<string, number> = {};
  private floors: { kind: 'floor' | 'ceiling'; level: number; ts: number }[] = [];
  private absorbSince: Record<Side, number | null> = { buy: null, sell: null };
  private milestoneIdx = -1;
  private graduatedEmitted = false;
  private wasValid = false;

  private lastSecond = -1;
  private lastPersist = 0;
  private activity: ActivityItem[] = [];
  private lastCurveLog = 0;
  private scanTurn = 0;
  private floorScan = 'floor scan: waiting for sell flow';
  private cached = {
    score: 0,
    parts: { flowShort: 0, flowLong: 0, wallets: 0, flowVsLiquidity: 0 } as ScoreParts,
    sigma1s: null as number | null,
    compression: null as number | null,
    rangeHigh: null as number | null,
    rangeLow: null as number | null,
  };

  constructor(private readonly opts: EngineOptions) {
    this.cfg = opts.config ?? DEFAULT_CONFIG;
    const c = this.cfg;
    this.health = {
      status: 'idle',
      source: opts.source.name,
      mode: opts.source.mode,
      pollMs: opts.source.pollMs,
      lastMessageAt: null,
      lastSwapAt: null,
      lastPoolAt: null,
      errors: 0,
      connectedAt: null,
    };
    this.buyShort = new RollingWindow(c.shortWindowMs);
    this.sellShort = new RollingWindow(c.shortWindowMs);
    this.buyLong = new RollingWindow(c.longWindowMs);
    this.sellLong = new RollingWindow(c.longWindowMs);
    this.buyAbs = new RollingWindow(c.absorption.windowSec * 1000);
    this.sellAbs = new RollingWindow(c.absorption.windowSec * 1000);
    this.swapCount = new RollingWindow(c.longWindowMs);
    this.sm = new SetupStateMachine(c.state);
    this.cal = new Calibrator(c.calibration, ENGINE_VERSION);
    this.loadCalibration();
  }

  get market(): MarketRef {
    return this.opts.market;
  }

  get poolState(): PoolState | null {
    return this.pool;
  }

  // ------------------------------------------------------------------ input

  /** Any successful response / message from the source. */
  onHeartbeat(now: number): void {
    this.health.lastMessageAt = now;
  }

  onStatus(now: number, status: FeedStatus, detail?: string): void {
    this.health.status = status;
    this.health.detail = detail;
    if (status === 'live') this.health.connectedAt ??= now;
    if (status === 'error') this.health.errors++;
  }

  onPoolState(now: number, state: PoolState): void {
    // Merge: a source that only knows some fields (null/undefined) must not erase what another source reported.
    const merged = { ...(this.pool ?? state) } as PoolState;
    for (const [k, v] of Object.entries(state)) if (v !== null && v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
    this.pool = merged;
    this.health.lastPoolAt = now;
    this.health.lastMessageAt = now;
    if (state.curve) {
      if (now - this.lastCurveLog > 10_000) {
        this.lastCurveLog = now;
        this.log(now, `curve reserves read · ${(state.curve.progress * 100).toFixed(1)}% full · ${state.curve.solToGraduate.toFixed(1)} SOL to graduate`);
      }
    } else if (state.liquidityUsd) {
      this.log(now, `pool re-read · liquidity ${fmtUsd(state.liquidityUsd)} · LP drift check`);
    }
    if (state.liquidityUsd !== null && state.liquidityUsd > 0 && state.model !== 'BONDING_CURVE') {
      const price = this.currentPrice() ?? state.priceUsd;
      if (price) this.checkLiquidity(now, state.liquidityUsd, price);
    }
    if (state.curve) this.checkGraduation(now, state.curve.progress, state.curve.solToGraduate, state.curve.graduated);
  }

  /**
   * Feed swaps (any order, duplicates allowed — they're de-duplicated by id).
   * Old swaps (beyond maxSwapAgeMs) only build candles.
   */
  onSwaps(now: number, swaps: Swap[]): void {
    const fresh = swaps.filter((s) => !this.seen.has(s.id) && Number.isFinite(s.priceUsd) && s.priceUsd > 0).sort((a, b) => a.ts - b.ts);
    for (const s of fresh) {
      this.remember(s.id);
      const ct = { ts: s.ts, price: s.priceUsd, size: s.baseAmount, aggressor: s.side, usd: s.usd };
      this.candles.onTrade(ct);
      this.structure.onTrade(ct);
      if (!this.lastSwap || s.ts >= this.lastSwap.ts) this.lastSwap = s;
      if (now - s.ts > this.cfg.maxSwapAgeMs) continue;
      this.health.lastSwapAt = Math.max(this.health.lastSwapAt ?? 0, s.ts);
      const buy = s.side === 'buy';
      (buy ? this.buyShort : this.sellShort).push(s.ts, s.usd);
      (buy ? this.buyLong : this.sellLong).push(s.ts, s.usd);
      (buy ? this.buyAbs : this.sellAbs).push(s.ts, s.usd);
      this.swapCount.push(s.ts, 1);
      this.recent.push({ ts: s.ts, side: s.side, usd: s.usd, wallet: s.wallet });
      this.cvd += buy ? s.usd : -s.usd;
      this.tapeList.push(s);
      if (this.tapeList.length > 40) this.tapeList.shift();
      this.checkWhale(now, s);
    }
    if (fresh.length) this.health.lastMessageAt = now;
    if (swaps.length > 1) this.log(now, `pulled ${swaps.length} swaps → ${fresh.length} new, ${swaps.length - fresh.length} deduped`);
    else if (fresh.length === 1) {
      const f = fresh[0];
      this.log(now, `${f.side} ${fmtUsd(f.usd)}${f.wallet ? ` · ${shortAddr(f.wallet)}` : ''} → flow windows updated`);
    }
  }

  seedStructure(history: Candle[]): void {
    this.structure.seed(history);
  }

  seedCandles(history: Candle[]): void {
    this.candles.seed(history);
  }

  // ------------------------------------------------------------------- tick

  tick(now: number): EngineSnapshot {
    for (const w of [this.buyShort, this.sellShort, this.buyLong, this.sellLong, this.buyAbs, this.sellAbs, this.swapCount]) w.prune(now);
    const cutoff = now - this.cfg.longWindowMs;
    if (this.recent.length && this.recent[0].ts <= cutoff) this.recent = this.recent.filter((r) => r.ts > cutoff);

    const invalidReason = this.validity(now);
    const valid = invalidReason === null;
    if (this.wasValid && !valid) this.invalidate(now, invalidReason!);
    this.wasValid = valid;
    const price = valid ? this.currentPrice() : null;

    if (valid && price !== null) {
      this.cal.observe(now, price);
      this.computeScore();
      const sec = Math.floor(now / 1000);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.perSecond(now, price);
      }
    }

    if (this.opts.store && now - this.lastPersist > 30_000) {
      this.lastPersist = now;
      this.persistCalibration();
    }
    return this.snapshot(now, valid, invalidReason, price);
  }

  // -------------------------------------------------------------- internals

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 20_000) this.seen.delete(this.seenOrder.shift()!);
  }

  private currentPrice(): number | null {
    if (this.lastSwap && (!this.pool?.priceUsd || !this.health.lastPoolAt || this.lastSwap.ts >= this.health.lastPoolAt - 60_000))
      return this.lastSwap.priceUsd;
    return this.pool?.priceUsd ?? this.lastSwap?.priceUsd ?? null;
  }

  private quoteReserve(): number | null {
    const p = this.pool;
    if (!p) return null;
    if (p.curve && p.curve.solUsd) return p.curve.vSol * p.curve.solUsd;
    return quoteReserveFromLiquidity(p.liquidityUsd);
  }

  private validity(now: number): string | null {
    if (this.health.status === 'error') return `Data source error${this.health.detail ? `: ${this.health.detail}` : ''}`;
    if (this.currentPrice() === null) return this.health.status === 'idle' || this.health.status === 'connecting' ? 'Connecting to the data source' : 'No price yet for this token';
    const last = this.health.lastMessageAt;
    if (last === null || now - last > this.cfg.staleMs) {
      if (this.health.status === 'live') this.health.status = 'stale';
      return `No data from ${this.health.source} for ${Math.round(this.cfg.staleMs / 1000)}s+`;
    }
    if (this.health.status === 'stale') this.health.status = 'live';
    return null;
  }

  private invalidate(now: number, reason: string): void {
    this.cal.dropPending();
    const t = this.sm.reset(now, `Setup cleared: ${reason}`);
    if (t) this.emit(copy.state(now, 'SETUP CLEARED', t.reason));
    this.emit(copy.feed(now, 'DATA HICCUP', `${reason}. Signals paused until data is flowing again — no data, no guesses.`));
  }

  private walletStats(sinceTs: number) {
    const m = new Map<string, { buyUsd: number; sellUsd: number; trades: number; buys: number; sells: number }>();
    let total = 0;
    for (const r of this.recent) {
      if (r.ts <= sinceTs || !r.wallet) continue;
      const w = m.get(r.wallet) ?? { buyUsd: 0, sellUsd: 0, trades: 0, buys: 0, sells: 0 };
      if (r.side === 'buy') {
        w.buyUsd += r.usd;
        w.buys++;
      } else {
        w.sellUsd += r.usd;
        w.sells++;
      }
      w.trades++;
      total += r.usd;
      m.set(r.wallet, w);
    }
    let buyers = 0;
    let sellers = 0;
    for (const w of m.values()) {
      if (w.buys) buyers++;
      if (w.sells) sellers++;
    }
    return { map: m, total, buyers, sellers, hasWallets: m.size > 0 };
  }

  private computeScore(): void {
    const c = this.cfg;
    const bS = this.buyShort.sum;
    const sS = this.sellShort.sum;
    const bL = this.buyLong.sum;
    const sL = this.sellLong.sum;
    const dS = bS + sS > 0 ? (bS - sS) / (bS + sS) : 0;
    const dL = bL + sL > 0 ? (bL - sL) / (bL + sL) : 0;
    const ws = this.walletStats(-Infinity);
    const breadth = ws.buyers + ws.sellers > 0 ? (ws.buyers - ws.sellers) / (ws.buyers + ws.sellers) : 0;
    const qr = this.quoteReserve();
    const net = bL - sL;
    let fvl = 0;
    if (qr) {
      const ref = net >= 0 ? usdToMoveUp(qr, c.liquidityRefMove) : usdToMoveDown(qr, c.liquidityRefMove);
      fvl = Math.tanh(net / ref);
    }
    const parts: ScoreParts = { flowShort: dS, flowLong: dL, wallets: breadth, flowVsLiquidity: fvl };
    const w = c.weights;
    // Without wallet data or liquidity, renormalise over the parts we actually have.
    let wsum = w.flowShort + w.flowLong;
    let s = w.flowShort * dS + w.flowLong * dL;
    if (ws.hasWallets) {
      s += w.wallets * breadth;
      wsum += w.wallets;
    }
    if (qr) {
      s += w.flowVsLiquidity * fvl;
      wsum += w.flowVsLiquidity;
    }
    this.cached.parts = parts;
    this.cached.score = this.swapCount.count === 0 ? 0 : clamp(s / wsum, -1, 1);
  }

  private perSecond(now: number, price: number): void {
    const c = this.cfg;
    this.prices.push(price);
    this.cvdHist.push(this.cvd);
    this.scoreHist.push(this.cached.score);
    this.sellAbsHist.push(this.sellAbs.sum);
    this.buyAbsHist.push(this.buyAbs.sum);
    if (now % 10_000 < 1000 && this.pool?.liquidityUsd) this.liqSeries.push(this.pool.liquidityUsd);

    const p = this.prices.tail();
    const rets: number[] = [];
    for (let i = Math.max(1, p.length - 900); i < p.length; i++) rets.push(Math.log(p[i] / p[i - 1]));
    const r300 = rets.slice(-300);
    const sigma = r300.length >= 60 ? std(r300) : null;
    this.cached.sigma1s = sigma !== null ? Math.max(sigma, 1e-6) : null;
    const short = rets.slice(-120);
    const long = rets.slice(-900);
    const sShort = short.length >= 60 ? std(short) : NaN;
    const sLong = long.length >= 300 ? std(long) : NaN;
    this.cached.compression = sLong > 0 && Number.isFinite(sShort) ? sShort / sLong : null;

    const prior = p.slice(-(c.state.rangeSec + 10), -10);
    if (prior.length >= 60) {
      this.cached.rangeHigh = Math.max(...prior);
      this.cached.rangeLow = Math.min(...prior);
    } else this.cached.rangeHigh = this.cached.rangeLow = null;

    if (this.prices.length < c.warmupSec) {
      if (sec5(now)) this.log(now, `baselining · ${this.prices.length}/${c.warmupSec}s of 1s price samples`);
      return;
    }

    if (sec5(now)) this.logScan(now);
    this.cal.maybeSample(now, price, this.cached.score, this.cached.sigma1s);
    this.detectAbsorption(now, price);
    this.detectStacking(now, price);
    this.detectConcentration(now);

    const bS = this.buyShort.sum;
    const sS = this.sellShort.sum;
    const t = this.sm.step({
      now,
      mid: price,
      score: this.cached.score,
      compression: this.cached.compression,
      rangeHigh: this.cached.rangeHigh,
      rangeLow: this.cached.rangeLow,
      flowDelta: bS + sS > 0 ? (bS - sS) / (bS + sS) : 0,
      lastSupport: this.lastSupport,
    });
    if (t) this.onTransition(now, price, t);
  }

  private moveSince(price: number, secondsAgo: number): number | null {
    const then = this.prices.last(secondsAgo + 1);
    return then ? price / then - 1 : null;
  }

  private cooled(key: string, now: number, sec: number): boolean {
    const last = this.cooldowns[key];
    if (last !== undefined && now - last < sec * 1000) return false;
    this.cooldowns[key] = now;
    return true;
  }

  private detectAbsorption(now: number, price: number): void {
    const a = this.cfg.absorption;
    const W = a.windowSec;
    const move = this.moveSince(price, W);
    if (move === null) return;
    const sells = this.sellAbs.sum;
    const buys = this.buyAbs.sum;
    const total = sells + buys;
    if (total <= 0) return;
    const qr = this.quoteReserve();
    const windowPrices = this.prices.tail(W + 1);

    // Flow must be spread out: ≥5 swaps and at least a quarter of it in the first half of the window.
    const start = now - W * 1000;
    const mid = now - (W * 1000) / 2;
    const spread = (side: Side) => {
      let n = 0;
      let early = 0;
      let all = 0;
      for (const r of this.recent) {
        if (r.ts <= start || r.side !== side) continue;
        n++;
        all += r.usd;
        if (r.ts <= mid) early += r.usd;
      }
      return n >= 5 && all > 0 && early / all >= 0.25;
    };

    const evaluate = (side: Side) => {
      const gross = side === 'sell' ? sells : buys;
      const hist = (side === 'sell' ? this.sellAbsHist : this.buyAbsHist).tail(900).slice(0, -W);
      const z = zScore(gross, hist, 60);
      const note = (why: string) => {
        if (side === 'sell') this.floorScan = `floor scan: ${fmtUsd(gross)} sells in ${W}s · ${why}`;
        return null;
      };
      if (z === null) return note('baseline still forming');
      if (z < a.minFlowZ) return note(`${z.toFixed(1)}σ — normal selling`);
      if (gross / total < a.minAggressorShare) return note(`${((gross / total) * 100).toFixed(0)}% of flow — two-sided`);
      if (!spread(side)) return note('one burst, not sustained');
      // Normal two-sided churn always "offsets" itself; only unusually heavy one-sided flow counts.
      if (gross < a.minBaselineMultiple * Math.max(median(hist), 1e-9)) return note('not heavy vs typical');
      let implied: number | null = null;
      let absorbed: number | null = null;
      if (qr) {
        implied = impactOf(qr, side === 'sell' ? -gross : gross);
        if (Math.abs(implied) < a.minImpliedMove) return note(`implies only ${fmtPct(implied)}`);
        const realizedShare = move / implied; // same sign → fraction of the implied move that happened
        if (realizedShare > a.maxRealizedShare) return note(`price followed (${fmtPct(move)} of ${fmtPct(implied)}) — not absorbed`);
        absorbed = 1 - Math.max(0, realizedShare);
      } else {
        if (this.cached.sigma1s === null) return null;
        const allowed = Math.max(a.fallbackMaxMoveBps / 1e4, a.sigmaMult * this.cached.sigma1s * Math.sqrt(W));
        if (side === 'sell' ? move < -allowed : move > allowed) return null;
      }
      if (side === 'sell') this.floorScan = `floor scan: ${fmtUsd(gross)} sells absorbed ${absorbed !== null ? `${(absorbed * 100).toFixed(0)}%` : ''} · confirming`;
      return { gross, implied, absorbed, z };
    };

    const check = (side: Side) => {
      const r = evaluate(side);
      if (!r) {
        this.absorbSince[side] = null;
        return;
      }
      this.absorbSince[side] ??= now;
      if ((now - this.absorbSince[side]!) / 1000 < a.persistSec) return;
      const { gross, implied, absorbed, z } = r;
      const key = side === 'sell' ? 'floor' : 'ceiling';
      if (!this.cooled(key, now, a.cooldownSec)) return;
      if (side === 'sell') {
        const level = Math.min(...windowPrices);
        this.emit(copy.floor(now, level, gross, implied, move, absorbed, z));
        this.lastSupport.up = now;
        this.floors.push({ kind: 'floor', level, ts: now });
        this.cal.addLevelTest(now, 'floor', level, a.levelBufferBps);
      } else {
        const level = Math.max(...windowPrices);
        this.emit(copy.ceiling(now, level, gross, implied, move, absorbed, z));
        this.lastSupport.down = now;
        this.floors.push({ kind: 'ceiling', level, ts: now });
        this.cal.addLevelTest(now, 'ceiling', level, a.levelBufferBps);
      }
      if (this.floors.length > 20) this.floors = this.floors.slice(-20);
    };
    check('sell');
    check('buy');
  }

  private detectStacking(now: number, price: number): void {
    const s = this.cfg.stacking;
    const ws = this.walletStats(now - s.windowSec * 1000);
    if (!ws.hasWallets) return;
    const move = this.moveSince(price, s.windowSec);
    if (move === null) return;
    const allowed = Math.max(this.cfg.absorption.fallbackMaxMoveBps / 1e4, (this.cached.sigma1s ?? 0) * Math.sqrt(s.windowSec) * 0.5);
    if (ws.buyers >= s.minWallets && ws.buyers >= s.minRatio * Math.max(1, ws.sellers) && move >= -allowed && move <= 3 * allowed) {
      if (this.cooled('stack-buy', now, s.cooldownSec)) {
        this.emit(copy.stacking(now, 'buy', ws.buyers, ws.sellers, move));
        this.lastSupport.up = now;
      }
    }
    if (ws.sellers >= s.minWallets && ws.sellers >= s.minRatio * Math.max(1, ws.buyers) && move <= allowed && move >= -3 * allowed) {
      if (this.cooled('stack-sell', now, s.cooldownSec)) {
        this.emit(copy.stacking(now, 'sell', ws.buyers, ws.sellers, move));
        this.lastSupport.down = now;
      }
    }
  }

  private detectConcentration(now: number): void {
    const c = this.cfg.wallets;
    const ws = this.walletStats(-Infinity);
    for (const side of ['buy', 'sell'] as const) {
      let total = 0;
      let trades = 0;
      let top: [string, number, number] | null = null;
      for (const [addr, w] of ws.map) {
        const usd = side === 'buy' ? w.buyUsd : w.sellUsd;
        const n = side === 'buy' ? w.buys : w.sells;
        total += usd;
        trades += n;
        if (!top || usd > top[1]) top = [addr, usd, n];
      }
      if (!top || total < c.minUsd || trades < c.minTrades) continue;
      const share = top[1] / total;
      if (share >= c.topShare && this.cooled(`one-${side}`, now, c.cooldownSec)) {
        this.emit(copy.oneWallet(now, side, top[0], share, top[1], top[2]));
      }
    }
  }

  private checkWhale(now: number, s: Swap): void {
    const c = this.cfg.whales;
    const liq = this.pool?.liquidityUsd ?? (this.pool?.curve?.solUsd ? this.pool.curve.vSol * this.pool.curve.solUsd * 2 : null);
    const threshold = Math.max(c.minUsd, liq ? c.liquidityFrac * liq : 0);
    if (s.usd < threshold) return;
    this.whaleList.push(s);
    if (this.whaleList.length > 12) this.whaleList.shift();
    if (!this.cooled(`whale-${s.side}`, now, c.cooldownSec)) return;
    const qr = this.quoteReserve();
    this.emit(copy.whale(now, s.side, s.usd, liq ? s.usd / liq : null, qr ? impactOf(qr, s.side === 'buy' ? s.usd : -s.usd) : null, s.wallet));
  }

  private checkLiquidity(now: number, liq: number, price: number): void {
    const c = this.cfg.liquidity;
    this.liqHist.push({ ts: now, liq, price });
    this.liqHist = this.liqHist.filter((h) => now - h.ts <= c.lookbackSec * 1000);
    if (this.liqHist.length < 2) return;
    // A constant-product pool's USD liquidity scales with √price when nobody adds or removes LP.
    let worst = { ratio: 1, from: liq };
    let best = { ratio: 1, from: liq };
    for (const h of this.liqHist.slice(0, -1)) {
      const expected = h.liq * Math.sqrt(price / h.price);
      const ratio = liq / expected;
      if (ratio < worst.ratio) worst = { ratio, from: h.liq };
      if (ratio > best.ratio) best = { ratio, from: h.liq };
    }
    if (1 - worst.ratio >= c.pullFrac && this.cooled('liq-pull', now, c.cooldownSec)) {
      this.emit(copy.liquidityPulled(now, worst.from, liq, 1 - worst.ratio));
      this.lastSupport.down = now;
      this.liqHist = [{ ts: now, liq, price }];
    } else if (best.ratio - 1 >= c.addFrac && this.cooled('liq-add', now, c.cooldownSec)) {
      this.emit(copy.liquidityAdded(now, best.from, liq, best.ratio - 1));
      this.liqHist = [{ ts: now, liq, price }];
    }
  }

  private checkGraduation(now: number, progress: number, solToGo: number, graduated: boolean): void {
    if (graduated || progress >= 1) {
      if (!this.graduatedEmitted) {
        this.graduatedEmitted = true;
        this.emit(copy.graduated(now));
      }
      return;
    }
    const ms = this.cfg.graduation.milestones;
    let idx = -1;
    for (let i = 0; i < ms.length; i++) if (progress >= ms[i]) idx = i;
    if (this.milestoneIdx === -1 && idx >= 0 && this.prices.length === 0) {
      // First reading after connect: note where we are, don't announce stale milestones.
      this.milestoneIdx = idx;
      return;
    }
    if (idx > this.milestoneIdx) {
      this.milestoneIdx = idx;
      this.emit(copy.graduationLoading(now, progress, solToGo));
      this.lastSupport.up = now;
    }
  }

  private onTransition(now: number, price: number, t: Transition): void {
    const v = t.view;
    const d = t.direction;
    switch (t.to) {
      case 'WATCHING': {
        const hi = this.cached.rangeHigh;
        const lo = this.cached.rangeLow;
        let nearEdge = false;
        if (hi !== null && lo !== null && hi > lo) {
          const pos = (price - lo) / (hi - lo);
          nearEdge = d === 'up' ? pos >= 0.7 : pos <= 0.3;
        }
        this.emit(copy.watching(now, d!, t.reason, nearEdge, this.cached.score));
        break;
      }
      case 'COILING':
        this.emit(copy.coiling(now, d!, t.reason, v.trigger, v.invalidation));
        break;
      case 'IMMINENT':
        this.emit(copy.imminent(now, d!, t.reason, v.trigger, v.invalidation));
        break;
      case 'BREAKOUT':
        this.emit(copy.breakout(now, d!, t.reason, v.trigger));
        break;
      case 'FAILED':
        this.emit(copy.failed(now, d, t.reason));
        break;
      default:
        this.emit(copy.state(now, t.to, t.reason));
    }
  }

  private log(ts: number, text: string): void {
    this.activity.push({ ts, text });
    if (this.activity.length > 40) this.activity.shift();
  }

  /** Rotating summary of what the per-second analytics are checking. */
  private logScan(now: number): void {
    const p = this.cached.parts;
    const est = this.cal.estimates(this.cached.score, this.cached.sigma1s);
    const n = est.reduce((a, e) => a + e.n, 0);
    const pending = est.reduce((a, e) => a + e.pending, 0);
    const lines = [
      `pressure ${this.cached.score >= 0 ? '+' : ''}${this.cached.score.toFixed(2)} · flow1m ${p.flowShort.toFixed(2)} · flow5m ${p.flowLong.toFixed(2)} · wallets ${p.wallets.toFixed(2)}`,
      this.floorScan,
      `volatility ${this.cached.sigma1s !== null ? (this.cached.sigma1s * 1e4).toFixed(1) : '—'}bp/s · compression ${this.cached.compression !== null ? this.cached.compression.toFixed(2) : '—'}`,
      `calibration · ${n} outcomes counted · ${pending} in flight`,
      `setup ${this.sm.view().state.toLowerCase()} · range ${this.cached.rangeLow !== null ? 'set' : 'forming'}`,
    ];
    const d = this.lastDiscovery;
    if (d?.ready) {
      lines.push(
        `discovery scan · ${d.passed}/${d.known} checks · ${d.stage.toLowerCase().replace('_', ' ')}`,
        `overhead supply ${d.overheadShare !== null ? `${(d.overheadShare * 100).toFixed(0)}%` : '—'} · VWAP ${d.vwap !== null ? fmtUsd(d.vwap) : '—'} · fib pos ${d.fibPosition !== null ? d.fibPosition.toFixed(2) : '—'}`,
        `distribution sweep · ${d.distributionFlags.length ? d.distributionFlags.join(', ') : 'clean'}`,
      );
    }
    this.log(now, lines[this.scanTurn++ % lines.length]);
  }

  private emit(e: WickEvent): void {
    this.log(e.ts, `⚑ ${e.title.toLowerCase()}`);
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.opts.onEvent?.(e);
  }

  private calKey(): string {
    const m = this.opts.market;
    return `wickipedia:cal:${ENGINE_VERSION}:${m.chain}:${m.token}`;
  }

  private loadCalibration(): void {
    const raw = this.opts.store?.get(this.calKey());
    if (!raw) return;
    try {
      this.cal.load(JSON.parse(raw));
    } catch {
      /* corrupt state is ignored, never trusted */
    }
  }

  persistCalibration(): void {
    try {
      this.opts.store?.set(this.calKey(), JSON.stringify(this.cal.serialize()));
    } catch {
      /* storage may be unavailable; calibration still works in memory */
    }
  }

  resetCalibration(): void {
    this.cal.clear();
    this.persistCalibration();
  }

  private snapshot(now: number, valid: boolean, invalidReason: string | null, price: number | null): EngineSnapshot {
    const c = this.cfg;
    const qr = this.quoteReserve();
    const bS = this.buyShort.sum;
    const sS = this.sellShort.sum;
    const bL = this.buyLong.sum;
    const sL = this.sellLong.sum;
    const ws = this.walletStats(-Infinity);
    const wallets: WalletRow[] = [...ws.map.entries()]
      .map(([wallet, w]) => ({ wallet, buyUsd: w.buyUsd, sellUsd: w.sellUsd, trades: w.trades, share: ws.total > 0 ? (w.buyUsd + w.sellUsd) / ws.total : 0 }))
      .sort((a, b) => b.buyUsd + b.sellUsd - (a.buyUsd + a.sellUsd))
      .slice(0, 6);
    const ready = this.prices.length >= c.warmupSec;
    let topSell = 0;
    let sellTot = 0;
    for (const w of ws.map.values()) {
      sellTot += w.sellUsd;
      topSell = Math.max(topSell, w.sellUsd);
    }
    const discovery = assessDiscovery({
      now,
      price,
      structure: this.structure.list(),
      minute: this.candles.list(),
      quoteReserveUsd: qr,
      buyUsd5m: bL,
      sellUsd5m: sL,
      buyers5m: ws.buyers,
      sellers5m: ws.sellers,
      topSellerShare: sellTot > 0 ? topSell / sellTot : null,
      cvdSeries: this.cvdHist.tail(),
      priceSeries: this.prices.tail(700),
      events: this.events,
    });
    this.lastDiscovery = discovery;
    return {
      now,
      market: this.opts.market,
      health: { ...this.health },
      valid,
      invalidReason,
      warmup: { ready, have: Math.min(this.prices.length, c.warmupSec), need: c.warmupSec },
      price,
      priceSource: price === null ? null : this.lastSwap && price === this.lastSwap.priceUsd ? 'swap' : 'pool',
      pool: this.pool,
      quoteReserveUsd: qr,
      impactExact: !!this.pool?.curve,
      impact: qr ? IMPACT_STEPS.map((pct) => ({ pct, upUsd: usdToMoveUp(qr, pct), downUsd: usdToMoveDown(qr, pct) })) : [],
      flow: {
        buyUsdShort: bS,
        sellUsdShort: sS,
        buyUsdLong: bL,
        sellUsdLong: sL,
        deltaShort: bS + sS > 0 ? (bS - sS) / (bS + sS) : 0,
        deltaLong: bL + sL > 0 ? (bL - sL) / (bL + sL) : 0,
        swapsPerMin: this.swapCount.count / (c.longWindowMs / 60_000),
        buyersLong: ws.buyers,
        sellersLong: ws.sellers,
        netImpactLong: qr && bL + sL > 0 ? impactOf(qr, bL - sL) : null,
        cvdUsd: this.cvd,
        cvdSeries: this.cvdHist.tail(300),
      },
      wallets,
      whales: [...this.whaleList].reverse(),
      tape: [...this.tapeList].reverse(),
      volatility: {
        sigma1sBps: this.cached.sigma1s !== null ? this.cached.sigma1s * 1e4 : null,
        compression: this.cached.compression,
        rangeHigh: this.cached.rangeHigh,
        rangeLow: this.cached.rangeLow,
      },
      score: valid && ready ? this.cached.score : 0,
      scoreParts: this.cached.parts,
      scoreSeries: this.scoreHist.tail(300),
      priceSeries: this.prices.tail(300),
      liquiditySeries: this.liqSeries.tail(),
      setup: this.sm.view(),
      estimates: this.cal.estimates(this.cached.score, this.cached.sigma1s),
      levelHolds: this.cal.levelHolds(),
      floors: [...this.floors],
      candles: this.candles.list(),
      structure: this.structure.list(),
      discovery,
      events: [...this.events],
      activity: this.activity.slice(-12),
    };
  }
}
