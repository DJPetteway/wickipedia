import type { BookSide, LevelUpdate } from './types';

/**
 * One side of an L2 book. Prices are kept in an ascending sorted array next to a
 * price → size map so best-price lookups are O(1) and inserts/removals are
 * O(log n) search + O(n) splice — plenty for a few thousand levels.
 */
class SideBook {
  readonly prices: number[] = [];
  readonly sizes = new Map<number, number>();

  set(price: number, size: number): void {
    const exists = this.sizes.has(price);
    if (size <= 0) {
      if (!exists) return; // removing an unknown level is normal on most venues
      this.sizes.delete(price);
      const i = lowerBound(this.prices, price);
      if (this.prices[i] === price) this.prices.splice(i, 1);
      return;
    }
    if (!exists) {
      const i = lowerBound(this.prices, price);
      this.prices.splice(i, 0, price);
    }
    this.sizes.set(price, size);
  }

  clear(): void {
    this.prices.length = 0;
    this.sizes.clear();
  }

  get size(): number {
    return this.prices.length;
  }
}

/** First index i with arr[i] >= x. */
export function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Level {
  price: number;
  size: number;
}

export interface TopOfBook {
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
}

export class OrderBook {
  private readonly bids = new SideBook();
  private readonly asks = new SideBook();

  reset(bids: LevelUpdate[], asks: LevelUpdate[]): void {
    this.bids.clear();
    this.asks.clear();
    this.apply(bids, asks);
  }

  apply(bids: LevelUpdate[], asks: LevelUpdate[]): void {
    for (const [p, q] of bids) this.bids.set(p, q);
    for (const [p, q] of asks) this.asks.set(p, q);
  }

  get bidLevels(): number {
    return this.bids.size;
  }

  get askLevels(): number {
    return this.asks.size;
  }

  get isEmpty(): boolean {
    return this.bids.size === 0 || this.asks.size === 0;
  }

  top(): TopOfBook | null {
    if (this.isEmpty) return null;
    const bp = this.bids.prices[this.bids.prices.length - 1];
    const ap = this.asks.prices[0];
    return {
      bidPrice: bp,
      bidSize: this.bids.sizes.get(bp)!,
      askPrice: ap,
      askSize: this.asks.sizes.get(ap)!,
    };
  }

  /** A crossed or locked book means our local copy is corrupt (or the venue is broken). */
  isCrossed(): boolean {
    const t = this.top();
    return t !== null && t.bidPrice >= t.askPrice;
  }

  mid(): number | null {
    const t = this.top();
    return t ? (t.bidPrice + t.askPrice) / 2 : null;
  }

  sizeAt(side: BookSide, price: number): number {
    return (side === 'bid' ? this.bids : this.asks).sizes.get(price) ?? 0;
  }

  /**
   * Levels from the touch outward, stopping once price is more than `bps`
   * basis points from `ref` (or after maxLevels).
   */
  levelsWithin(side: BookSide, ref: number, bps: number, maxLevels = Infinity): Level[] {
    const out: Level[] = [];
    const book = side === 'bid' ? this.bids : this.asks;
    const bound = side === 'bid' ? ref * (1 - bps / 1e4) : ref * (1 + bps / 1e4);
    if (side === 'bid') {
      for (let i = book.prices.length - 1; i >= 0 && out.length < maxLevels; i--) {
        const p = book.prices[i];
        if (p < bound) break;
        out.push({ price: p, size: book.sizes.get(p)! });
      }
    } else {
      for (let i = 0; i < book.prices.length && out.length < maxLevels; i++) {
        const p = book.prices[i];
        if (p > bound) break;
        out.push({ price: p, size: book.sizes.get(p)! });
      }
    }
    return out;
  }

  /** Total base-asset quantity resting within `bps` of `ref`. */
  depthWithin(side: BookSide, ref: number, bps: number): number {
    let sum = 0;
    for (const l of this.levelsWithin(side, ref, bps)) sum += l.size;
    return sum;
  }

  /** Total quote-currency notional resting within `bps` of `ref`. */
  notionalWithin(side: BookSide, ref: number, bps: number): number {
    let sum = 0;
    for (const l of this.levelsWithin(side, ref, bps)) sum += l.size * l.price;
    return sum;
  }
}
