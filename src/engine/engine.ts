import { Calibrator, type HorizonEstimate, type LevelHoldEstimate } from './calibration';
import { CandleBuilder, type Candle } from './candles';
import { DEFAULT_CONFIG, ENGINE_VERSION, type EngineConfig } from './config';
import { copy } from './copy';
import { OrderBook, type TopOfBook } from './orderbook';
import { Ring, RollingWindow } from './rolling';
import { SetupStateMachine, type SetupView, type Transition } from './stateMachine';
import { clamp, median, std, zScore } from './stats';
import type { Direction, FeedHealth, FeedStatus, LevelUpdate, Trade, VenueKind, WickEvent } from './types';
import { WallTracker, type WallView } from './walls';

export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface EngineOptions {
  venueId: string;
  venueName: string;
  venueKind: VenueKind;
  symbol: string;
  config?: EngineConfig;
  store?: KVStore;
  onEvent?: (e: WickEvent) => void;
}

export interface DepthPoint {
  price: number;
  /** Cumulative base quantity from the touch out to this price. */
  cum: number;
  size: number;
}

export interface FlowView {
  buyNotional10: number;
  sellNotional10: number;
  buyNotional60: number;
  sellNotional60: number;
  /** (buy − sell) / (buy + sell), 10 s and 60 s. */
  delta10: number;
  delta60: number;
  tradesPerSec: number;
  /** Cumulative volume delta since connect (base units). */
  cvd: number;
  cvdSeries: number[];
}

export interface ScoreParts {
  imbalance: number;
  ofi: number;
  flow: number;
  microprice: number;
}

export interface EngineSnapshot {
  now: number;
  venue: { id: string; name: string; kind: VenueKind };
  symbol: string;
  health: FeedHealth;
  /** False whenever the data can't be trusted (not synced, stale, crossed). Signals are withheld. */
  valid: boolean;
  invalidReason: string | null;
  warmup: { ready: boolean; have: number; need: number };
  top: TopOfBook | null;
  mid: number | null;
  lastTradePrice: number | null;
  spreadBps: number | null;
  bookLevels: { bids: number; asks: number };
  imbalance: { bandBps: number; value: number; bidQty: number; askQty: number }[];
  microprice: number | null;
  ofi: { raw: number; normalized: number; z: number | null; series: number[] };
  flow: FlowView;
  volatility: { sigma1sBps: number | null; compression: number | null; rangeHigh: number | null; rangeLow: number | null };
  score: number;
  scoreParts: ScoreParts;
  scoreSeries: number[];
  priceSeries: number[];
  setup: SetupView;
  walls: WallView[];
  depth: { bids: DepthPoint[]; asks: DepthPoint[] };
  estimates: HorizonEstimate[];
  levelHolds: LevelHoldEstimate[];
  floors: { kind: 'floor' | 'ceiling'; level: number; ts: number }[];
  candles: Candle[];
  events: WickEvent[];
}

const STALE_MS = 10_000;
const MAX_EVENTS = 250;

function emptyHealth(): FeedHealth {
  return {
    status: 'idle',
    lastMessageAt: null,
    lastBookUpdateAt: null,
    lastTradeAt: null,
    latencyMs: null,
    messagesPerSec: 0,
    resyncs: 0,
    gaps: 0,
    connectedAt: null,
  };
}

/**
 * The quantitative core. Feeds push normalized book updates and trades in;
 * `tick(now)` advances the per-second analytics and returns an immutable
 * snapshot for the UI / agent. All timing uses the `now` values passed in,
 * which keeps the engine deterministic under test and replay.
 */
export class WickEngine {
  readonly cfg: EngineConfig;
  readonly book = new OrderBook();
  private health: FeedHealth = emptyHealth();
  private synced = false;

  private prevTop: TopOfBook | null = null;
  private ofiWin: RollingWindow;
  private l1DepthWin: RollingWindow;
  private buyN10: RollingWindow;
  private sellN10: RollingWindow;
  private buyN60: RollingWindow;
  private sellN60: RollingWindow;
  private buyNAbs: RollingWindow;
  private sellNAbs: RollingWindow;
  private tradeCount: RollingWindow;
  private msgWin = new RollingWindow(5_000);
  private latencies = new Ring(200);
  private cvd = 0;
  /** Aggressive notional accumulated during the current second. */
  private secBuy = 0;
  private secSell = 0;
  private secBuyHist = new Ring(600);
  private secSellHist = new Ring(600);
  private lastTradePrice: number | null = null;

  /** 1 Hz series. */
  private mids = new Ring(1800);
  private ofiHist = new Ring(600);
  private sellAbsHist = new Ring(600);
  private buyAbsHist = new Ring(600);
  private bidNearHist = new Ring(180);
  private askNearHist = new Ring(180);
  private cvdHist = new Ring(300);
  private scoreHist = new Ring(300);

  private walls: WallTracker;
  private sm: SetupStateMachine;
  private cal: Calibrator;
  private candles = new CandleBuilder();
  private events: WickEvent[] = [];
  private lastSupport: Record<Direction, number | null> = { up: null, down: null };
  private cooldowns: Record<string, number> = {};
  private floors: { kind: 'floor' | 'ceiling'; level: number; ts: number }[] = [];

  private lastSecond = -1;
  private lastPersist = 0;
  private cached = {
    score: 0,
    parts: { imbalance: 0, ofi: 0, flow: 0, microprice: 0 } as ScoreParts,
    sigma1s: null as number | null,
    compression: null as number | null,
    rangeHigh: null as number | null,
    rangeLow: null as number | null,
    ofiNorm: 0,
    ofiZ: null as number | null,
  };

  constructor(private readonly opts: EngineOptions) {
    this.cfg = opts.config ?? DEFAULT_CONFIG;
    const c = this.cfg;
    this.ofiWin = new RollingWindow(c.shortWindowMs);
    this.l1DepthWin = new RollingWindow(c.shortWindowMs);
    this.buyN10 = new RollingWindow(c.shortWindowMs);
    this.sellN10 = new RollingWindow(c.shortWindowMs);
    this.buyN60 = new RollingWindow(c.longWindowMs);
    this.sellN60 = new RollingWindow(c.longWindowMs);
    this.buyNAbs = new RollingWindow(c.absorption.windowSec * 1000);
    this.sellNAbs = new RollingWindow(c.absorption.windowSec * 1000);
    this.tradeCount = new RollingWindow(c.shortWindowMs);
    this.walls = new WallTracker(c.walls);
    this.sm = new SetupStateMachine(c.state);
    this.cal = new Calibrator(c.calibration, ENGINE_VERSION);
    this.loadCalibration();
  }

  // ------------------------------------------------------------------ input

  /** Call for every raw message received (any channel). `exchangeTs` enables latency tracking. */
  onMessage(now: number, exchangeTs?: number): void {
    this.health.lastMessageAt = now;
    this.msgWin.push(now, 1);
    if (exchangeTs && Number.isFinite(exchangeTs)) this.latencies.push(now - exchangeTs);
  }

  onStatus(now: number, status: FeedStatus, detail?: string): void {
    const prev = this.health.status;
    this.health.status = status;
    this.health.detail = detail;
    if (status === 'live' && prev !== 'live') this.health.connectedAt ??= now;
    if (status === 'resyncing' || status === 'error' || status === 'closed') {
      const wasSynced = this.synced;
      this.synced = false;
      if (status === 'resyncing') {
        this.health.resyncs++;
        if (detail?.includes('gap')) this.health.gaps++;
      }
      if (wasSynced && status !== 'closed') {
        this.invalidate(now, status === 'resyncing' ? `Book resync: ${detail ?? 'unknown reason'}` : `Feed ${status}${detail ? `: ${detail}` : ''}`);
      }
    }
  }

  onBookSnapshot(now: number, bids: LevelUpdate[], asks: LevelUpdate[]): void {
    this.book.reset(bids, asks);
    this.prevTop = this.book.top();
    this.walls.reset();
    this.synced = true;
    this.health.lastBookUpdateAt = now;
    this.health.status = 'live';
    this.health.connectedAt ??= now;
  }

  /** Returns false if the update left the book crossed — the feed must resync. */
  onBookDelta(now: number, bids: LevelUpdate[], asks: LevelUpdate[]): boolean {
    if (!this.synced) return true;
    this.book.apply(bids, asks);
    this.health.lastBookUpdateAt = now;
    if (this.book.isCrossed()) {
      this.synced = false;
      return false;
    }
    const top = this.book.top();
    if (top && this.prevTop) {
      // Order-flow imbalance (Cont, Kukanov & Stoikov 2014) on the best quotes.
      const p = this.prevTop;
      let e = 0;
      if (top.bidPrice > p.bidPrice) e += top.bidSize;
      else if (top.bidPrice === p.bidPrice) e += top.bidSize - p.bidSize;
      else e -= p.bidSize;
      if (top.askPrice < p.askPrice) e -= top.askSize;
      else if (top.askPrice === p.askPrice) e -= top.askSize - p.askSize;
      else e += p.askSize;
      this.ofiWin.push(now, e);
      this.l1DepthWin.push(now, (top.bidSize + top.askSize) / 2);
    }
    this.prevTop = top;
    return true;
  }

  onTrade(now: number, t: Trade): void {
    const notional = t.price * t.size;
    this.health.lastTradeAt = now;
    this.lastTradePrice = t.price;
    if (t.aggressor === 'buy') {
      this.buyN10.push(now, notional);
      this.buyN60.push(now, notional);
      this.buyNAbs.push(now, notional);
      this.secBuy += notional;
      this.cvd += t.size;
    } else {
      this.sellN10.push(now, notional);
      this.sellN60.push(now, notional);
      this.sellNAbs.push(now, notional);
      this.secSell += notional;
      this.cvd -= t.size;
    }
    this.tradeCount.push(now, 1);
    this.walls.onTrade(t);
    this.candles.onTrade(t);
  }

  seedCandles(history: Candle[]): void {
    this.candles.seed(history);
  }

  // ------------------------------------------------------------------- tick

  tick(now: number): EngineSnapshot {
    for (const w of [this.ofiWin, this.l1DepthWin, this.buyN10, this.sellN10, this.buyN60, this.sellN60, this.buyNAbs, this.sellNAbs, this.tradeCount, this.msgWin])
      w.prune(now);
    this.health.messagesPerSec = this.msgWin.count / (this.msgWin.windowMs / 1000);
    const lat = this.latencies.tail();
    this.health.latencyMs = lat.length ? median(lat) : null;

    const invalidReason = this.validity(now);
    const valid = invalidReason === null;
    const mid = valid ? this.book.mid() : null;

    if (valid && mid !== null) {
      this.cal.observe(now, mid);
      for (const ch of this.walls.update(now, this.book, mid)) this.onWallChange(now, ch);
      this.computeFast(mid);
      const sec = Math.floor(now / 1000);
      if (sec !== this.lastSecond) {
        this.lastSecond = sec;
        this.perSecond(now, mid);
      }
    }

    if (this.opts.store && now - this.lastPersist > 30_000) {
      this.lastPersist = now;
      this.persistCalibration();
    }

    return this.snapshot(now, valid, invalidReason, mid);
  }

  // -------------------------------------------------------------- internals

  private validity(now: number): string | null {
    if (!this.synced) return this.health.status === 'resyncing' ? 'Resyncing order book' : 'Order book not synchronized yet';
    if (this.book.isEmpty) return 'Order book is empty';
    if (this.book.isCrossed()) return 'Order book crossed — resyncing';
    const last = this.health.lastMessageAt;
    if (last === null || now - last > STALE_MS) {
      if (this.health.status === 'live') {
        this.health.status = 'stale';
        this.invalidate(now, `No market data for ${STALE_MS / 1000}s`);
      }
      return 'Market data is stale';
    }
    if (this.health.status === 'stale') this.health.status = 'live';
    return null;
  }

  /** A data hole: drop anything that depends on continuity. */
  private invalidate(now: number, reason: string): void {
    this.cal.dropPending();
    const t = this.sm.reset(now, `Setup cleared: ${reason}`);
    if (t) this.emit(copy.state(now, 'SETUP CLEARED', t.reason));
    this.emit(copy.feed(now, 'DATA HICCUP', `${reason}. Signals paused until the book is trustworthy again — no data, no guesses.`));
  }

  private nearDepth(side: 'bid' | 'ask', mid: number): number {
    return this.book.notionalWithin(side, mid, this.cfg.stacking.bandBps);
  }

  private computeFast(mid: number): void {
    const c = this.cfg;
    const top = this.book.top()!;
    const prim = this.book.depthWithin('bid', mid, c.primaryBandBps);
    const prima = this.book.depthWithin('ask', mid, c.primaryBandBps);
    const imb = prim + prima > 0 ? (prim - prima) / (prim + prima) : 0;

    const avgL1 = this.l1DepthWin.count ? this.l1DepthWin.sum / this.l1DepthWin.count : 0;
    const ofiNorm = avgL1 > 0 ? this.ofiWin.sum / avgL1 : 0;
    const ofiZ = zScore(ofiNorm, this.ofiHist.tail(300), 30);

    const b10 = this.buyN10.sum;
    const s10 = this.sellN10.sum;
    const b60 = this.buyN60.sum;
    const s60 = this.sellN60.sum;
    const d10 = b10 + s10 > 0 ? (b10 - s10) / (b10 + s10) : 0;
    const d60 = b60 + s60 > 0 ? (b60 - s60) / (b60 + s60) : 0;

    const half = (top.askPrice - top.bidPrice) / 2;
    const micro = (top.askPrice * top.bidSize + top.bidPrice * top.askSize) / (top.bidSize + top.askSize);
    const microTilt = half > 0 ? clamp((micro - mid) / half, -1, 1) : 0;

    const parts: ScoreParts = {
      imbalance: Math.tanh(2 * imb),
      ofi: ofiZ === null ? 0 : Math.tanh(ofiZ / 2),
      flow: 0.5 * d10 + 0.5 * d60,
      microprice: microTilt,
    };
    const w = c.weights;
    this.cached.score = clamp(
      w.imbalance * parts.imbalance + w.ofi * parts.ofi + w.flow * parts.flow + w.microprice * parts.microprice,
      -1,
      1,
    );
    this.cached.parts = parts;
    this.cached.ofiNorm = ofiNorm;
    this.cached.ofiZ = ofiZ;
  }

  private perSecond(now: number, mid: number): void {
    const c = this.cfg;
    this.mids.push(mid);
    this.ofiHist.push(this.cached.ofiNorm);
    this.cvdHist.push(this.cvd);
    this.scoreHist.push(this.cached.score);
    const bidNear = this.nearDepth('bid', mid);
    const askNear = this.nearDepth('ask', mid);
    this.bidNearHist.push(bidNear);
    this.askNearHist.push(askNear);

    // Volatility from 1 s log returns.
    const m = this.mids.tail();
    const rets: number[] = [];
    for (let i = 1; i < m.length; i++) rets.push(Math.log(m[i] / m[i - 1]));
    const r300 = rets.slice(-300);
    const sigma = r300.length >= 30 ? std(r300) : null;
    this.cached.sigma1s = sigma !== null && sigma > 0 ? sigma : sigma === 0 ? 1e-6 : null;
    const short = rets.slice(-60);
    const long = rets.slice(-600);
    const sShort = short.length >= 30 ? std(short) : NaN;
    const sLong = long.length >= 120 ? std(long) : NaN;
    this.cached.compression = sLong > 0 && Number.isFinite(sShort) ? sShort / sLong : null;

    // Prior range: the last `rangeSec` seconds, excluding the latest 5 s so a fresh break registers.
    const prior = m.slice(-(c.state.rangeSec + 5), -5);
    if (prior.length >= 30) {
      this.cached.rangeHigh = Math.max(...prior);
      this.cached.rangeLow = Math.min(...prior);
    } else this.cached.rangeHigh = this.cached.rangeLow = null;

    this.sellAbsHist.push(this.sellNAbs.sum);
    this.buyAbsHist.push(this.buyNAbs.sum);
    this.secSellHist.push(this.secSell);
    this.secBuyHist.push(this.secBuy);
    this.secSell = this.secBuy = 0;

    if (this.mids.length < c.warmupSec) return;

    // Samples are bucketed by score, so they only start once the score has a baseline.
    this.cal.maybeSample(now, mid, this.cached.score, this.cached.sigma1s);

    this.detectAbsorption(now, mid);
    this.detectStacking(now, mid);

    const transition = this.sm.step({
      now,
      mid,
      score: this.cached.score,
      compression: this.cached.compression,
      rangeHigh: this.cached.rangeHigh,
      rangeLow: this.cached.rangeLow,
      flowDelta: (() => {
        const b = this.buyN10.sum;
        const s = this.sellN10.sum;
        return b + s > 0 ? (b - s) / (b + s) : 0;
      })(),
      lastSupport: this.lastSupport,
    });
    if (transition) this.onTransition(now, mid, transition);
  }

  private moveBps(mid: number, secondsAgo: number): number | null {
    const then = this.mids.last(secondsAgo + 1);
    return then ? ((mid - then) / then) * 1e4 : null;
  }

  private cooled(key: string, now: number, sec: number): boolean {
    const last = this.cooldowns[key];
    if (last !== undefined && now - last < sec * 1000) return false;
    this.cooldowns[key] = now;
    return true;
  }

  private detectAbsorption(now: number, mid: number): void {
    const a = this.cfg.absorption;
    const W = a.windowSec;
    const move = this.moveBps(mid, W);
    if (move === null || this.cached.sigma1s === null) return;
    const allowed = Math.max(a.maxMoveBps, a.sigmaMult * this.cached.sigma1s * Math.sqrt(W) * 1e4);
    const sells = this.sellNAbs.sum;
    const buys = this.buyNAbs.sum;
    const total = sells + buys;
    if (total <= 0) return;
    const window = this.mids.tail(W + 1);
    const bidThen = this.bidNearHist.last(W + 1);
    const askThen = this.askNearHist.last(W + 1);
    const bidNow = this.bidNearHist.last()!;
    const askNow = this.askNearHist.last()!;

    // Absorption needs *sustained* aggression: at least half the seconds in the
    // window must carry above-normal one-sided flow, otherwise the first second
    // of a dump (before price has had time to move) would look like a floor.
    const persistent = (hist: Ring) => {
      const all = hist.tail(600);
      const base = all.slice(0, -W);
      if (base.length < 60) return false;
      const norm = Math.max(median(base), 1e-12);
      return all.slice(-W).filter((x) => x > 2 * norm).length >= W / 2;
    };

    // Exclude the current window from its own baseline.
    const sellZ = zScore(sells, this.sellAbsHist.tail(600).slice(0, -W), 60);
    const buyZ = zScore(buys, this.buyAbsHist.tail(600).slice(0, -W), 60);

    if (sellZ !== null && sellZ >= a.minFlowZ && sells / total >= a.minAggressorShare && move >= -allowed && bidThen && persistent(this.secSellHist)) {
      const retention = bidNow / bidThen;
      if (retention >= a.minDepthRetention && this.cooled('floor', now, a.cooldownSec)) {
        const level = Math.min(...window);
        this.emit(copy.floor(now, level, sells, move, sellZ, retention));
        this.lastSupport.up = now;
        this.floors.push({ kind: 'floor', level, ts: now });
        this.cal.addLevelTest(now, 'floor', level, Math.max(2, this.spreadBps() ?? 0));
      }
    }
    if (buyZ !== null && buyZ >= a.minFlowZ && buys / total >= a.minAggressorShare && move <= allowed && askThen && persistent(this.secBuyHist)) {
      const retention = askNow / askThen;
      if (retention >= a.minDepthRetention && this.cooled('ceiling', now, a.cooldownSec)) {
        const level = Math.max(...window);
        this.emit(copy.ceiling(now, level, buys, move, buyZ, retention));
        this.lastSupport.down = now;
        this.floors.push({ kind: 'ceiling', level, ts: now });
        this.cal.addLevelTest(now, 'ceiling', level, Math.max(2, this.spreadBps() ?? 0));
      }
    }
    if (this.floors.length > 20) this.floors = this.floors.slice(-20);
  }

  private detectStacking(now: number, mid: number): void {
    const s = this.cfg.stacking;
    const move = this.moveBps(mid, s.windowSec);
    if (move === null || this.cached.sigma1s === null) return;
    const allowed = Math.max(this.cfg.absorption.maxMoveBps, this.cfg.absorption.sigmaMult * this.cached.sigma1s * Math.sqrt(s.windowSec) * 1e4);
    const bidThen = this.bidNearHist.last(s.windowSec + 1);
    const askThen = this.askNearHist.last(s.windowSec + 1);
    const bidNow = this.bidNearHist.last()!;
    const askNow = this.askNearHist.last()!;
    const imb = bidNow + askNow > 0 ? (bidNow - askNow) / (bidNow + askNow) : 0;
    const sells = this.sellNAbs.sum;
    const buys = this.buyNAbs.sum;

    if (bidThen && bidNow / bidThen - 1 >= s.minGrowth && imb >= s.minImbalance && sells > 0 && move >= -allowed) {
      if (this.cooled('bidstack', now, s.cooldownSec)) {
        this.emit(copy.stacking(now, 'bid', (bidNow / bidThen - 1) * 100, imb, move));
        this.lastSupport.up = now;
      }
    }
    if (askThen && askNow / askThen - 1 >= s.minGrowth && imb <= -s.minImbalance && buys > 0 && move <= allowed) {
      if (this.cooled('askstack', now, s.cooldownSec)) {
        this.emit(copy.stacking(now, 'ask', (askNow / askThen - 1) * 100, imb, move));
        this.lastSupport.down = now;
      }
    }
  }

  private onWallChange(now: number, ch: ReturnType<WallTracker['update']>[number]): void {
    const w = ch.wall;
    if (ch.kind === 'spotted') {
      // Walls stay visible in the snapshot; the feed only gets one "spotted" line per side per 30 s.
      if (this.cooled(`spot-${w.side}`, now, 30)) this.emit(copy.wallSpotted(now, w.side, w.price, w.notional, w.multiple, w.distanceBps));
    } else if (ch.kind === 'eaten') {
      this.emit(copy.wallEaten(now, w.side, w.price, ch.traded * w.price, (Math.min(ch.traded, ch.drop) / w.peakSize) * 100));
      // An eaten ask wall supports an up move; an eaten bid wall supports a down move.
      this.lastSupport[w.side === 'ask' ? 'up' : 'down'] = now;
    } else {
      this.emit(copy.wallVanished(now, w.side, w.price, ch.drop * w.price, ch.drop > 0 ? (Math.min(ch.traded, ch.drop) / ch.drop) * 100 : 0));
    }
  }

  private onTransition(now: number, mid: number, t: Transition): void {
    const v = t.view;
    const d = t.direction;
    switch (t.to) {
      case 'WATCHING': {
        const hi = this.cached.rangeHigh;
        const lo = this.cached.rangeLow;
        let nearEdge = false;
        if (hi !== null && lo !== null && hi > lo) {
          const pos = (mid - lo) / (hi - lo);
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

  private emit(e: WickEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.opts.onEvent?.(e);
  }

  private spreadBps(): number | null {
    const t = this.book.top();
    if (!t) return null;
    const mid = (t.askPrice + t.bidPrice) / 2;
    return ((t.askPrice - t.bidPrice) / mid) * 1e4;
  }

  private depthCurve(side: 'bid' | 'ask', mid: number, bps: number, maxLevels: number): DepthPoint[] {
    let cum = 0;
    return this.book.levelsWithin(side, mid, bps, maxLevels).map((l) => {
      cum += l.size;
      return { price: l.price, size: l.size, cum };
    });
  }

  private calKey(): string {
    return `wickipedia:cal:${ENGINE_VERSION}:${this.opts.venueId}:${this.opts.symbol}`;
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
      /* storage may be unavailable (private mode, quota); calibration still works in memory */
    }
  }

  resetCalibration(): void {
    this.cal.clear();
    this.persistCalibration();
  }

  private snapshot(now: number, valid: boolean, invalidReason: string | null, mid: number | null): EngineSnapshot {
    const c = this.cfg;
    const top = valid ? this.book.top() : null;
    const spreadBps = valid ? this.spreadBps() : null;
    const imbalance =
      valid && mid !== null
        ? c.imbalanceBandsBps.map((b) => {
            const bidQty = this.book.depthWithin('bid', mid, b);
            const askQty = this.book.depthWithin('ask', mid, b);
            return { bandBps: b, bidQty, askQty, value: bidQty + askQty > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0 };
          })
        : [];
    const b10 = this.buyN10.sum;
    const s10 = this.sellN10.sum;
    const b60 = this.buyN60.sum;
    const s60 = this.sellN60.sum;
    const ready = this.mids.length >= c.warmupSec;
    return {
      now,
      venue: { id: this.opts.venueId, name: this.opts.venueName, kind: this.opts.venueKind },
      symbol: this.opts.symbol,
      health: { ...this.health },
      valid,
      invalidReason,
      warmup: { ready, have: Math.min(this.mids.length, c.warmupSec), need: c.warmupSec },
      top,
      mid,
      lastTradePrice: this.lastTradePrice,
      spreadBps,
      bookLevels: { bids: this.book.bidLevels, asks: this.book.askLevels },
      imbalance,
      microprice:
        top !== null ? (top.askPrice * top.bidSize + top.bidPrice * top.askSize) / (top.bidSize + top.askSize) : null,
      ofi: { raw: this.ofiWin.sum, normalized: this.cached.ofiNorm, z: this.cached.ofiZ, series: this.ofiHist.tail(180) },
      flow: {
        buyNotional10: b10,
        sellNotional10: s10,
        buyNotional60: b60,
        sellNotional60: s60,
        delta10: b10 + s10 > 0 ? (b10 - s10) / (b10 + s10) : 0,
        delta60: b60 + s60 > 0 ? (b60 - s60) / (b60 + s60) : 0,
        tradesPerSec: this.tradeCount.count / (c.shortWindowMs / 1000),
        cvd: this.cvd,
        cvdSeries: this.cvdHist.tail(180),
      },
      volatility: {
        sigma1sBps: this.cached.sigma1s !== null ? this.cached.sigma1s * 1e4 : null,
        compression: this.cached.compression,
        rangeHigh: this.cached.rangeHigh,
        rangeLow: this.cached.rangeLow,
      },
      score: valid && ready ? this.cached.score : 0,
      scoreParts: this.cached.parts,
      scoreSeries: this.scoreHist.tail(180),
      priceSeries: this.mids.tail(180),
      setup: this.sm.view(),
      walls: valid && mid !== null ? this.walls.walls(mid, now) : [],
      depth:
        valid && mid !== null
          ? {
              bids: this.depthCurve('bid', mid, 200, 600),
              asks: this.depthCurve('ask', mid, 200, 600),
            }
          : { bids: [], asks: [] },
      estimates: this.cal.estimates(this.cached.score, this.cached.sigma1s),
      levelHolds: this.cal.levelHolds(),
      floors: [...this.floors],
      candles: this.candles.list(),
      events: [...this.events],
    };
  }
}
