import type { EngineConfig } from './config';
import type { OrderBook } from './orderbook';
import { median } from './stats';
import type { BookSide, Trade } from './types';

export type WallStatus = 'pending' | 'active' | 'eaten';

export interface WallView {
  side: BookSide;
  price: number;
  size: number;
  peakSize: number;
  notional: number;
  /** Size relative to the median level size on that side. */
  multiple: number;
  distanceBps: number;
  ageSec: number;
  /** Fraction of the peak size that has been consumed by trades at the level. */
  eatenFrac: number;
  status: WallStatus;
}

export type WallChange =
  | { kind: 'spotted'; wall: WallView }
  | { kind: 'eaten'; wall: WallView; traded: number; drop: number }
  | { kind: 'vanished'; wall: WallView; traded: number; drop: number };

interface Tracked {
  side: BookSide;
  price: number;
  firstSeen: number;
  peakSize: number;
  peakAt: number;
  lastSize: number;
  multiple: number;
  /** Aggressive volume executed at (or through) the level since the peak. */
  traded: number;
  announced: boolean;
  eatenAnnounced: boolean;
}

const key = (side: BookSide, price: number) => `${side}:${price}`;

/**
 * Finds unusually large resting levels near the touch and follows them over
 * time, classifying shrinkage as *eaten* (explained by trades at the level)
 * or *vanished* (pulled without trading — a liquidity withdrawal, which may
 * or may not mean anything).
 */
export class WallTracker {
  private tracked = new Map<string, Tracked>();

  constructor(private readonly cfg: EngineConfig['walls']) {}

  reset(): void {
    this.tracked.clear();
  }

  onTrade(t: Trade): void {
    for (const w of this.tracked.values()) {
      const eps = w.price * 1e-9;
      // Buyers lift asks; sellers hit bids.
      if (w.side === 'ask' && t.aggressor === 'buy' && t.price >= w.price - eps) w.traded += t.size;
      if (w.side === 'bid' && t.aggressor === 'sell' && t.price <= w.price + eps) w.traded += t.size;
    }
  }

  update(now: number, book: OrderBook, mid: number): WallChange[] {
    const changes: WallChange[] = [];
    const candidates = new Map<string, { side: BookSide; price: number; size: number; multiple: number }>();

    for (const side of ['bid', 'ask'] as const) {
      const levels = book.levelsWithin(side, mid, this.cfg.rangeBps);
      if (levels.length < 10) continue;
      const med = median(levels.map((l) => l.size));
      if (!(med > 0)) continue;
      levels
        .filter((l) => l.size >= this.cfg.medianMultiple * med)
        .sort((a, b) => b.size - a.size)
        .slice(0, 3)
        .forEach((l) => candidates.set(key(side, l.price), { side, price: l.price, size: l.size, multiple: l.size / med }));
    }

    for (const [k, c] of candidates) {
      if (!this.tracked.has(k)) {
        this.tracked.set(k, {
          side: c.side,
          price: c.price,
          firstSeen: now,
          peakSize: c.size,
          peakAt: now,
          lastSize: c.size,
          multiple: c.multiple,
          traded: 0,
          announced: false,
          eatenAnnounced: false,
        });
      } else {
        this.tracked.get(k)!.multiple = c.multiple;
      }
    }

    for (const [k, w] of this.tracked) {
      const cur = book.sizeAt(w.side, w.price);
      w.lastSize = cur;
      if (cur > w.peakSize) {
        w.peakSize = cur;
        w.peakAt = now;
        w.traded = 0;
      }
      const distanceBps = (Math.abs(w.price - mid) / mid) * 1e4;
      const drop = w.peakSize - cur;
      const dropFrac = w.peakSize > 0 ? drop / w.peakSize : 0;
      const isCandidate = candidates.has(k);

      if (!w.announced) {
        if (!isCandidate) {
          // Flickered away before it proved itself — not worth a headline.
          this.tracked.delete(k);
          continue;
        }
        if (now - w.firstSeen >= this.cfg.minAgeMs) {
          w.announced = true;
          changes.push({ kind: 'spotted', wall: this.view(w, mid, now) });
        }
        continue;
      }

      const explained = drop > 0 ? Math.min(w.traded, drop) / drop : 0;
      if (dropFrac >= this.cfg.eatenDropFrac && explained >= this.cfg.eatenTradeShare && !w.eatenAnnounced) {
        w.eatenAnnounced = true;
        changes.push({ kind: 'eaten', wall: this.view(w, mid, now), traded: w.traded, drop });
      } else if (dropFrac >= this.cfg.vanishDropFrac && explained <= this.cfg.vanishMaxTradeShare) {
        changes.push({ kind: 'vanished', wall: this.view(w, mid, now), traded: w.traded, drop });
        this.tracked.delete(k);
        continue;
      }

      if (cur <= 0 || distanceBps > this.cfg.rangeBps * 2 || (w.eatenAnnounced && dropFrac > 0.9)) {
        this.tracked.delete(k);
      }
    }
    return changes;
  }

  walls(mid: number, now: number): WallView[] {
    return [...this.tracked.values()]
      .filter((w) => w.announced)
      .map((w) => this.view(w, mid, now))
      .sort((a, b) => a.distanceBps - b.distanceBps);
  }

  private view(w: Tracked, mid: number, now: number): WallView {
    const eatenFrac = w.peakSize > 0 ? Math.min(1, Math.min(w.traded, w.peakSize - w.lastSize) / w.peakSize) : 0;
    return {
      side: w.side,
      price: w.price,
      size: w.lastSize,
      peakSize: w.peakSize,
      notional: w.lastSize * w.price,
      multiple: w.multiple,
      distanceBps: (Math.abs(w.price - mid) / mid) * 1e4,
      ageSec: (now - w.firstSeen) / 1000,
      eatenFrac: Math.max(0, eatenFrac),
      status: w.eatenAnnounced ? 'eaten' : w.announced ? 'active' : 'pending',
    };
  }
}
