import { DEFAULT_CONFIG } from '../src/engine/config';
import { OrderBook } from '../src/engine/orderbook';
import type { LevelUpdate } from '../src/engine/types';
import { WallTracker } from '../src/engine/walls';

function ladder(mid: number, side: 'bid' | 'ask', n = 20, size = 1): LevelUpdate[] {
  return Array.from({ length: n }, (_, i) => [side === 'bid' ? mid - 0.5 - i * 0.5 : mid + 0.5 + i * 0.5, size]);
}

function bookWithAskWall(wallSize: number): OrderBook {
  const b = new OrderBook();
  const asks = ladder(1000, 'ask');
  asks[3] = [asks[3][0], wallSize]; // 1002.0
  b.reset(ladder(1000, 'bid'), asks);
  return b;
}

describe('WallTracker', () => {
  const cfg = DEFAULT_CONFIG.walls;

  it('only announces a wall after it persists', () => {
    const t = new WallTracker(cfg);
    const b = bookWithAskWall(20);
    expect(t.update(0, b, 1000)).toEqual([]);
    const ch = t.update(cfg.minAgeMs, b, 1000);
    expect(ch).toHaveLength(1);
    expect(ch[0].kind).toBe('spotted');
    expect(ch[0].wall.price).toBe(1002);
    expect(ch[0].wall.multiple).toBeCloseTo(20);
  });

  it('calls it eaten when trades explain the shrinkage', () => {
    const t = new WallTracker(cfg);
    const b = bookWithAskWall(20);
    t.update(0, b, 1000);
    t.update(cfg.minAgeMs, b, 1000);
    t.onTrade({ ts: 1, price: 1002, size: 14, aggressor: 'buy' });
    b.apply([], [[1002, 6]]);
    const ch = t.update(cfg.minAgeMs + 500, b, 1000);
    expect(ch.map((c) => c.kind)).toEqual(['eaten']);
  });

  it('calls it vanished when size is pulled without trading', () => {
    const t = new WallTracker(cfg);
    const b = bookWithAskWall(20);
    t.update(0, b, 1000);
    t.update(cfg.minAgeMs, b, 1000);
    t.onTrade({ ts: 1, price: 1002, size: 1, aggressor: 'buy' });
    b.apply([], [[1002, 0]]);
    const ch = t.update(cfg.minAgeMs + 500, b, 1000);
    expect(ch.map((c) => c.kind)).toEqual(['vanished']);
  });

  it('does not count sells against an ask wall', () => {
    const t = new WallTracker(cfg);
    const b = bookWithAskWall(20);
    t.update(0, b, 1000);
    t.update(cfg.minAgeMs, b, 1000);
    t.onTrade({ ts: 1, price: 1002, size: 14, aggressor: 'sell' });
    b.apply([], [[1002, 0]]);
    expect(t.update(cfg.minAgeMs + 500, b, 1000).map((c) => c.kind)).toEqual(['vanished']);
  });

  it('ignores flicker that disappears before the minimum age', () => {
    const t = new WallTracker(cfg);
    const b = bookWithAskWall(20);
    t.update(0, b, 1000);
    b.apply([], [[1002, 1]]);
    expect(t.update(1000, b, 1000)).toEqual([]);
    expect(t.walls(1000, 1000)).toEqual([]);
  });
});
