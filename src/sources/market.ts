import type { PoolEngine } from '../engine/poolEngine';
import type { PoolState } from '../engine/types';
import { CHAINS } from './chains';
import { gecko, GECKO_BASE, geckoClient } from './gecko';
import { HttpError, type FetchLike, type WsFactory } from './net';
import { curvePriceUsd, parsePumpTrade, pumpHub, PUMPPORTAL_WS } from './pumpportal';

/**
 * Data layer. Each market is fed by one or more sources:
 *   - GeckoTerminal (poll): swaps, pool liquidity/price, candles — any indexed DEX pool.
 *   - PumpPortal (push): real-time pump.fun bonding-curve swaps and curve reserves.
 * A paid real-time provider would be another function with this same shape:
 * start feeding `engine.onSwaps / onPoolState / onHeartbeat / onStatus`, return a stop().
 */
export interface SourceOptions {
  geckoBase?: string;
  pumpWs?: string;
  fetch?: FetchLike;
  ws?: WsFactory;
  now?: () => number;
  /** Poll interval for swaps when GeckoTerminal is the only source. */
  tradePollMs?: number;
}

export interface MarketPlan {
  pumpCurve: boolean;
}

export function sourceInfo(plan: MarketPlan, hasPool: boolean) {
  if (plan.pumpCurve) return { name: hasPool ? 'PumpPortal + GeckoTerminal' : 'PumpPortal', mode: 'push' as const };
  return { name: 'GeckoTerminal', mode: 'poll' as const, pollMs: 6_000 };
}

export function startMarket(engine: PoolEngine, plan: MarketPlan, opts: SourceOptions = {}): () => void {
  const m = engine.market;
  const now = opts.now ?? Date.now;
  const client = geckoClient(opts.geckoBase ?? GECKO_BASE, opts.fetch);
  const stops: Array<() => void> = [];
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  engine.onStatus(now(), 'connecting', m.pool ? 'GeckoTerminal' : 'PumpPortal');
  client.onThrottle = (t) => engine.onStatus(now(), t ? 'throttled' : 'live', t ? 'GeckoTerminal rate limit — backing off 30s' : undefined);

  const fail = (e: unknown) => {
    if (stopped) return;
    if (e instanceof HttpError && e.status === 429) return; // handled by onThrottle
    // On a pump.fun curve PumpPortal is the primary feed; GeckoTerminal only adds context.
    if (plan.pumpCurve) return;
    engine.onStatus(now(), 'error', e instanceof Error ? e.message : String(e));
  };

  // ---------------------------------------------------------- GeckoTerminal
  if (m.pool) {
    const pool = m.pool;
    const tradeEvery = plan.pumpCurve ? 15_000 : (opts.tradePollMs ?? 6_000);
    let lastPoolAt = 0;
    void (async () => {
      gecko
        .ohlcv(client, m.network, pool)
        .then((c) => !stopped && engine.seedCandles(c))
        .catch(() => undefined);
      while (!stopped) {
        try {
          if (now() - lastPoolAt > 20_000) {
            const p = await gecko.pool(client, m.network, pool);
            lastPoolAt = now();
            // While PumpPortal owns the curve state, only take context fields from GeckoTerminal.
            if (p && !stopped) engine.onPoolState(now(), plan.pumpCurve ? contextOnly(p.state) : p.state);
          }
          const swaps = await gecko.trades(client, m.network, pool);
          if (stopped) break;
          engine.onSwaps(now(), swaps);
          engine.onHeartbeat(now());
          if (!plan.pumpCurve) engine.onStatus(now(), 'live');
        } catch (e) {
          fail(e);
        }
        await sleep(tradeEvery);
      }
    })();
  }

  // ---------------------------------------------------------- PumpPortal
  if (plan.pumpCurve) {
    const hub = pumpHub(opts.pumpWs ?? PUMPPORTAL_WS, opts.ws);
    const sol = CHAINS.find((c) => c.id === 'solana')!.native!;
    let solUsd: number | null = null;
    const refreshSol = async () => {
      try {
        solUsd = (await gecko.tokenPrice(client, 'solana', sol.address)) ?? solUsd;
      } catch {
        /* keep last */
      }
    };
    void refreshSol();
    const solTimer = setInterval(refreshSol, 60_000);
    stops.push(() => clearInterval(solTimer));

    stops.push(
      hub.on((msg) => {
        if (msg.mint !== m.token) return;
        const t = now();
        engine.onHeartbeat(t);
        if (msg.txType === 'migrate') {
          const st = engine.poolState;
          if (st?.curve) engine.onPoolState(t, { ...st, curve: { ...st.curve, graduated: true, progress: 1 } });
          return;
        }
        if (solUsd === null) return; // can't price in USD yet — skip rather than guess
        const { swap, curve } = parsePumpTrade(msg, solUsd, t);
        if (curve) {
          engine.onPoolState(t, {
            priceUsd: curvePriceUsd(curve),
            liquidityUsd: null,
            fdvUsd: typeof msg.marketCapSol === 'number' ? msg.marketCapSol * solUsd : null,
            mcapUsd: typeof msg.marketCapSol === 'number' ? msg.marketCapSol * solUsd : null,
            model: 'BONDING_CURVE',
            curve,
          });
        }
        if (swap) engine.onSwaps(t, [swap]);
      }),
    );
    stops.push(
      hub.onStatus((s, detail) => {
        engine.onStatus(now(), s === 'open' ? 'live' : 'error', s === 'open' ? 'PumpPortal connected' : `PumpPortal disconnected${detail ? `: ${detail}` : ''}`);
        if (s === 'open') engine.onHeartbeat(now());
      }),
    );
    stops.push(hub.subscribeToken(m.token));
    stops.push(hub.subscribeMigrations());
    if (hub.isOpen) engine.onStatus(now(), 'live', 'PumpPortal connected');
    // The socket only speaks when someone trades: an open socket is itself a heartbeat.
    const hb = setInterval(() => hub.isOpen && engine.onHeartbeat(now()), 5_000);
    stops.push(() => clearInterval(hb));
  }

  return () => {
    stopped = true;
    client.clear();
    client.onThrottle = undefined;
    stops.forEach((s) => s());
    engine.onStatus(now(), 'closed');
  };
}

function contextOnly(s: PoolState): PoolState {
  return { priceUsd: null, liquidityUsd: null, fdvUsd: s.fdvUsd, mcapUsd: s.mcapUsd, model: 'BONDING_CURVE', window: s.window, priceChangePct: s.priceChangePct };
}
