import { OrderBook } from '../src/engine/orderbook';

describe('OrderBook', () => {
  it('keeps best prices sorted through inserts and removals', () => {
    const b = new OrderBook();
    b.reset(
      [
        [99, 1],
        [100, 2],
        [98, 3],
      ],
      [
        [102, 1],
        [101, 4],
      ],
    );
    expect(b.top()).toEqual({ bidPrice: 100, bidSize: 2, askPrice: 101, askSize: 4 });
    b.apply([[100, 0]], [[101, 0], [101.5, 2]]);
    expect(b.top()).toEqual({ bidPrice: 99, bidSize: 1, askPrice: 101.5, askSize: 2 });
    expect(b.bidLevels).toBe(2);
    expect(b.askLevels).toBe(2);
  });

  it('ignores removal of unknown levels (normal on Binance)', () => {
    const b = new OrderBook();
    b.reset([[100, 1]], [[101, 1]]);
    b.apply([[42, 0]], []);
    expect(b.bidLevels).toBe(1);
  });

  it('detects crossed books', () => {
    const b = new OrderBook();
    b.reset([[100, 1]], [[101, 1]]);
    expect(b.isCrossed()).toBe(false);
    b.apply([[101, 1]], []);
    expect(b.isCrossed()).toBe(true);
  });

  it('sums depth within a bps band of a reference price', () => {
    const b = new OrderBook();
    b.reset(
      [
        [99.95, 1],
        [99.8, 2],
        [99, 10],
      ],
      [
        [100.05, 1],
        [100.3, 5],
      ],
    );
    // 25 bps of 100 = 99.75 … 100.25
    expect(b.depthWithin('bid', 100, 25)).toBe(3);
    expect(b.depthWithin('ask', 100, 25)).toBe(1);
    expect(b.notionalWithin('ask', 100, 50)).toBeCloseTo(100.05 + 5 * 100.3);
  });
});
