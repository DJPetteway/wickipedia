import { WickEngine } from '../../src/engine/engine';
import type { LevelUpdate } from '../../src/engine/types';

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic but internally consistent L2 market used only by tests. */
export class SimMarket {
  readonly engine: WickEngine;
  t = 1_700_000_000_000;
  mid = 100;
  readonly tick = 0.01;
  private r = rng(42);

  constructor(engine?: WickEngine) {
    this.engine = engine ?? new WickEngine({ venueId: 'sim', venueName: 'Sim', venueKind: 'CEX_ORDER_BOOK', symbol: 'SIMUSD' });
  }

  ladder(): { bids: LevelUpdate[]; asks: LevelUpdate[] } {
    const bids: LevelUpdate[] = [];
    const asks: LevelUpdate[] = [];
    const bb = Math.round((this.mid - this.tick / 2) / this.tick) * this.tick;
    for (let i = 0; i < 200; i++) {
      bids.push([+(bb - i * this.tick).toFixed(2), 1 + this.r() * 0.2]);
      asks.push([+(bb + this.tick + i * this.tick).toFixed(2), 1 + this.r() * 0.2]);
    }
    return { bids, asks };
  }

  snapshot(): void {
    const { bids, asks } = this.ladder();
    this.engine.onMessage(this.t);
    this.engine.onBookSnapshot(this.t, bids, asks);
  }

  /** Re-centre the book on a new mid, publishing removals and the new ladder as one delta. */
  moveTo(mid: number): void {
    const old = this.ladder();
    this.mid = mid;
    const nu = this.ladder();
    const keepB = new Set(nu.bids.map((l) => l[0]));
    const keepA = new Set(nu.asks.map((l) => l[0]));
    const bids: LevelUpdate[] = [...old.bids.filter((l) => !keepB.has(l[0])).map((l): LevelUpdate => [l[0], 0]), ...nu.bids];
    const asks: LevelUpdate[] = [...old.asks.filter((l) => !keepA.has(l[0])).map((l): LevelUpdate => [l[0], 0]), ...nu.asks];
    this.engine.onMessage(this.t);
    this.engine.onBookDelta(this.t, bids, asks);
  }

  trade(aggressor: 'buy' | 'sell', size: number): void {
    const top = this.engine.book.top()!;
    this.engine.onMessage(this.t);
    this.engine.onTrade(this.t, { ts: this.t, price: aggressor === 'buy' ? top.askPrice : top.bidPrice, size, aggressor });
  }

  /** Advance time in 250 ms ticks, calling `each` before every engine tick. */
  run(seconds: number, each?: (sim: SimMarket, i: number) => void) {
    let snap = this.engine.tick(this.t);
    for (let i = 0; i < seconds * 4; i++) {
      this.t += 250;
      each?.(this, i);
      snap = this.engine.tick(this.t);
    }
    return snap;
  }

  noise(): void {
    if (this.r() < 0.5) this.trade(this.r() < 0.5 ? 'buy' : 'sell', 0.05 + this.r() * 0.1);
    if (this.r() < 0.05) this.moveTo(+(this.mid + (this.r() < 0.5 ? -1 : 1) * this.tick).toFixed(2));
  }

  random(): number {
    return this.r();
  }
}
