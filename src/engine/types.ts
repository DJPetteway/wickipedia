/** Core types shared by the engine, feeds, agent and UI. */

export type BookSide = 'bid' | 'ask';
export type Aggressor = 'buy' | 'sell';
export type Direction = 'up' | 'down';

/** [price, size] — size is the absolute resting quantity at that price (0 = level removed). */
export type LevelUpdate = [price: number, size: number];

export interface Trade {
  /** Exchange trade time (ms since epoch). */
  ts: number;
  price: number;
  size: number;
  /** Side of the taker (the aggressive order). */
  aggressor: Aggressor;
  id?: string | number;
}

export type VenueKind = 'CEX_ORDER_BOOK' | 'DEX_AMM_POOL';

export type FeedStatus =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'resyncing'
  | 'stale'
  | 'error'
  | 'closed';

export interface FeedHealth {
  status: FeedStatus;
  detail?: string;
  /** Local receive time of the last message (ms). */
  lastMessageAt: number | null;
  /** Local receive time of the last applied book update (ms). */
  lastBookUpdateAt: number | null;
  /** Local receive time of the last trade (ms). */
  lastTradeAt: number | null;
  /** Median (local receive − exchange event time) over recent messages, ms. Includes clock skew. */
  latencyMs: number | null;
  messagesPerSec: number;
  resyncs: number;
  gaps: number;
  connectedAt: number | null;
}

export type SetupState =
  | 'NEUTRAL'
  | 'WATCHING'
  | 'COILING'
  | 'IMMINENT'
  | 'BREAKOUT'
  | 'FAILED'
  | 'COOLDOWN';

export type EventKind =
  | 'STATE_CHANGE'
  | 'COOKING'
  | 'WALL_SPOTTED'
  | 'WALL_EATEN'
  | 'WALL_VANISHED'
  | 'BIDS_STACKING'
  | 'ASKS_STACKING'
  | 'FLOOR_FORMING'
  | 'CEILING_FORMING'
  | 'WICK_LOADING'
  | 'IMMINENT'
  | 'BREAKOUT_CONFIRMED'
  | 'FALSE_ALARM'
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
  /** Short teaching note: why this matters / what it usually looks like on a candle. */
  lesson?: string;
  /** The numbers that triggered it — always real observations. */
  evidence: Record<string, number | string | null>;
}
