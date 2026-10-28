/** Core types shared by the engine, data sources, agent and UI. */

export type Side = 'buy' | 'sell';
export type Direction = 'up' | 'down';

/** Chains Wickipedia reads. */
export type ChainId = 'solana' | 'arbitrum' | 'robinhood';

/**
 * How liquidity is structured — this decides how price impact is modelled.
 *  - BONDING_CURVE: launchpad curve (pump.fun) — exact constant-product on virtual reserves.
 *  - CPMM: constant-product AMM pool — impact estimated from reported reserves.
 *  - CONCENTRATED: CLMM / DLMM / v3-style pools — liquidity sits in ranges; reserve-based impact is only an approximation.
 */
export type LiquidityModel = 'BONDING_CURVE' | 'CPMM' | 'CONCENTRATED' | 'UNKNOWN';

/** One on-chain swap against the pool. `side` is from the trader's point of view on the base token. */
export interface Swap {
  /** Unique id (tx signature / hash + index) — used to de-duplicate polled data. */
  id: string;
  /** Block time when known, otherwise local receive time (ms). */
  ts: number;
  /** Base-token price in USD at this swap. */
  priceUsd: number;
  /** Base-token amount. */
  baseAmount: number;
  /** Notional in USD. */
  usd: number;
  side: Side;
  /** Trader wallet, when the source provides it. */
  wallet?: string;
}

export interface BondingCurveState {
  /** Virtual SOL and token reserves in the curve (UI units). */
  vSol: number;
  vTokens: number;
  solUsd: number | null;
  /** 0…1 estimated progress to graduation (migration to an AMM). */
  progress: number;
  /** SOL still to be bought before graduation (estimate). */
  solToGraduate: number;
  graduated: boolean;
}

export interface WindowStats {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

export interface PoolState {
  priceUsd: number | null;
  /** Total pool liquidity in USD (both sides), as reported by the source. */
  liquidityUsd: number | null;
  fdvUsd: number | null;
  mcapUsd: number | null;
  model: LiquidityModel;
  curve?: BondingCurveState;
  /** Source-reported rolling stats (e.g. GeckoTerminal m5/h1), for context only. */
  window?: { m5?: WindowStats; h1?: WindowStats };
  priceChangePct?: { m5?: number; h1?: number; h24?: number };
}

export interface MarketRef {
  chain: ChainId;
  /** Network id at the data source (e.g. GeckoTerminal "solana"). */
  network: string;
  /** Token being analysed (mint / contract). */
  token: string;
  /** Pool / pair / bonding-curve address, when known. */
  pool?: string;
  symbol: string;
  name: string;
  /** Where it trades: "pump.fun bonding curve", "Raydium CLMM", "PumpSwap"… */
  venue: string;
  model: LiquidityModel;
  quoteSymbol?: string;
}

export type FeedStatus = 'idle' | 'connecting' | 'syncing' | 'live' | 'throttled' | 'stale' | 'error' | 'closed';

export interface FeedHealth {
  status: FeedStatus;
  detail?: string;
  /** Human name of the data source(s). */
  source: string;
  /** "push" (WebSocket) or "poll" (REST every N seconds). */
  mode: 'push' | 'poll';
  pollMs?: number;
  /** Last successful response / message (local time). */
  lastMessageAt: number | null;
  /** Block/receive time of the newest swap. */
  lastSwapAt: number | null;
  /** Local time we last refreshed pool state. */
  lastPoolAt: number | null;
  errors: number;
  connectedAt: number | null;
}

export type SetupState = 'NEUTRAL' | 'WATCHING' | 'COILING' | 'IMMINENT' | 'BREAKOUT' | 'FAILED' | 'COOLDOWN';

export type EventKind =
  | 'STATE_CHANGE'
  | 'COOKING'
  | 'WICK_LOADING'
  | 'IMMINENT'
  | 'BREAKOUT_CONFIRMED'
  | 'FALSE_ALARM'
  | 'FLOOR_FORMING'
  | 'CEILING_FORMING'
  | 'BUYERS_STACKING'
  | 'SELLERS_STACKING'
  | 'WHALE_BUY'
  | 'WHALE_SELL'
  | 'ONE_WALLET'
  | 'LIQUIDITY_PULLED'
  | 'LIQUIDITY_ADDED'
  | 'GRADUATION_LOADING'
  | 'GRADUATED'
  | 'FEED';

export type Severity = 'info' | 'notice' | 'alert';

export interface WickEvent {
  id: string;
  ts: number;
  kind: EventKind;
  severity: Severity;
  direction?: Direction;
  /** Headline — the meme-native part. */
  title: string;
  /** One-line, evidence-based explanation. */
  body: string;
  /** Short teaching note. */
  lesson?: string;
  /** The numbers that triggered it — always real observations. */
  evidence: Record<string, number | string | null>;
}
