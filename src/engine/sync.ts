import type { LevelUpdate } from './types';

/**
 * Venue-agnostic book-synchronisation state machines. They are pure (no I/O),
 * so the exact sequencing rules can be unit tested against recorded messages.
 */

export type SyncOutput =
  | { type: 'none' }
  | { type: 'snapshot'; bids: LevelUpdate[]; asks: LevelUpdate[] }
  | { type: 'delta'; bids: LevelUpdate[]; asks: LevelUpdate[] }
  | { type: 'resync'; reason: string };

// ---------------------------------------------------------------------------
// Binance (and Binance.US) spot diff-depth stream.
// Rules: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
//  1. Buffer stream events, then GET /api/v3/depth.
//  2. Drop buffered events with u <= lastUpdateId.
//  3. First applied event must satisfy U <= lastUpdateId + 1 <= u.
//  4. Every later event must have U == previous u + 1, otherwise resync.
// ---------------------------------------------------------------------------

export interface BinanceDepthEvent {
  U: number; // first update id in event
  u: number; // final update id in event
  b: [string, string][];
  a: [string, string][];
}

export interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

const toLevels = (xs: [string, string][]): LevelUpdate[] => xs.map(([p, q]) => [Number(p), Number(q)]);

export class BinanceDepthSync {
  private buffer: BinanceDepthEvent[] = [];
  private lastU: number | null = null;
  private synced = false;
  /** Cap on buffered events while waiting for a snapshot. */
  private readonly maxBuffer = 5000;

  get isSynced(): boolean {
    return this.synced;
  }

  get buffered(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = [];
    this.lastU = null;
    this.synced = false;
  }

  onEvent(ev: BinanceDepthEvent): SyncOutput {
    if (!this.synced) {
      this.buffer.push(ev);
      if (this.buffer.length > this.maxBuffer) this.buffer.shift();
      return { type: 'none' };
    }
    if (ev.u <= this.lastU!) return { type: 'none' }; // stale duplicate
    if (ev.U !== this.lastU! + 1) {
      const reason = `sequence gap: expected U=${this.lastU! + 1}, got U=${ev.U}`;
      this.reset();
      this.buffer.push(ev); // keep it: it may bridge the next snapshot
      return { type: 'resync', reason };
    }
    this.lastU = ev.u;
    return { type: 'delta', bids: toLevels(ev.b), asks: toLevels(ev.a) };
  }

  /**
   * Feed the REST snapshot. Returns the snapshot plus any buffered deltas
   * merged into it, or a resync request when the snapshot is older than the
   * buffered stream (the caller should fetch a new one).
   */
  onSnapshot(snap: BinanceDepthSnapshot): SyncOutput {
    const L = snap.lastUpdateId;
    const pending = this.buffer.filter((e) => e.u > L);
    if (pending.length > 0 && pending[0].U > L + 1) {
      // Snapshot is older than the first event we still hold: there is a hole.
      this.buffer = pending;
      return { type: 'resync', reason: `snapshot ${L} older than buffered stream (first U=${pending[0].U})` };
    }
    const bids = toLevels(snap.bids);
    const asks = toLevels(snap.asks);
    let last = L;
    for (const e of pending) {
      if (last !== L && e.U !== last + 1) {
        this.reset();
        return { type: 'resync', reason: `gap inside buffered events at U=${e.U}` };
      }
      bids.push(...toLevels(e.b));
      asks.push(...toLevels(e.a));
      last = e.u;
    }
    this.buffer = [];
    this.lastU = last;
    this.synced = true;
    return { type: 'snapshot', bids, asks };
  }
}

// ---------------------------------------------------------------------------
// Coinbase Advanced Trade `level2` channel.
// The first l2_data event is a full snapshot; later events carry absolute
// `new_quantity` values per level. `sequence_num` is per connection and
// increments by one on every message (all channels), so any gap means a
// dropped message and the book must be rebuilt.
// ---------------------------------------------------------------------------

export interface CoinbaseL2Update {
  side: 'bid' | 'offer';
  event_time?: string;
  price_level: string;
  new_quantity: string;
}

export interface CoinbaseL2Event {
  type: 'snapshot' | 'update';
  product_id: string;
  updates: CoinbaseL2Update[];
}

export class CoinbaseSequenceTracker {
  private last: number | null = null;

  reset(): void {
    this.last = null;
  }

  /** Returns a gap description if a message was skipped. */
  check(seq: number): string | null {
    const prev = this.last;
    this.last = seq;
    if (prev === null || seq === prev + 1) return null;
    if (seq <= prev) return null; // duplicate / replay — ignore
    return `sequence gap: expected ${prev + 1}, got ${seq}`;
  }
}

export class CoinbaseL2Sync {
  private synced = false;

  get isSynced(): boolean {
    return this.synced;
  }

  reset(): void {
    this.synced = false;
  }

  onEvent(ev: CoinbaseL2Event): SyncOutput {
    const bids: LevelUpdate[] = [];
    const asks: LevelUpdate[] = [];
    for (const u of ev.updates) {
      const lvl: LevelUpdate = [Number(u.price_level), Number(u.new_quantity)];
      if (u.side === 'bid') bids.push(lvl);
      else asks.push(lvl);
    }
    if (ev.type === 'snapshot') {
      this.synced = true;
      return { type: 'snapshot', bids, asks };
    }
    if (!this.synced) return { type: 'none' }; // updates before snapshot are meaningless
    return { type: 'delta', bids, asks };
  }
}
