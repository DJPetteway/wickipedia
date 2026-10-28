import { BinanceDepthSync, CoinbaseL2Sync, CoinbaseSequenceTracker } from '../src/engine/sync';

const ev = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []) => ({ U, u, b, a });

describe('BinanceDepthSync', () => {
  it('buffers until a snapshot, drops stale events and applies the bridging one', () => {
    const s = new BinanceDepthSync();
    expect(s.onEvent(ev(90, 95, [['1', '9']])).type).toBe('none');
    expect(s.onEvent(ev(96, 101, [['100', '2']])).type).toBe('none');
    expect(s.onEvent(ev(102, 104, [], [['101', '3']])).type).toBe('none');
    const out = s.onSnapshot({ lastUpdateId: 100, bids: [['100', '1']], asks: [['101', '1']] });
    expect(out.type).toBe('snapshot');
    if (out.type !== 'snapshot') return;
    // event 90–95 dropped (u <= 100); 96–101 and 102–104 merged after the snapshot
    expect(out.bids).toEqual([
      [100, 1],
      [100, 2],
    ]);
    expect(out.asks).toEqual([
      [101, 1],
      [101, 3],
    ]);
    expect(s.isSynced).toBe(true);
    expect(s.onEvent(ev(105, 106, [['99', '1']])).type).toBe('delta');
  });

  it('requests a resync when the stream skips an update id', () => {
    const s = new BinanceDepthSync();
    s.onEvent(ev(101, 105));
    s.onSnapshot({ lastUpdateId: 100, bids: [], asks: [] });
    const out = s.onEvent(ev(110, 112));
    expect(out.type).toBe('resync');
    expect(s.isSynced).toBe(false);
  });

  it('rejects a snapshot that is older than the buffered stream', () => {
    const s = new BinanceDepthSync();
    s.onEvent(ev(200, 210));
    const out = s.onSnapshot({ lastUpdateId: 100, bids: [], asks: [] });
    expect(out.type).toBe('resync');
    expect(s.isSynced).toBe(false);
  });

  it('ignores duplicates after sync', () => {
    const s = new BinanceDepthSync();
    s.onEvent(ev(101, 105));
    s.onSnapshot({ lastUpdateId: 100, bids: [], asks: [] });
    expect(s.onEvent(ev(101, 105)).type).toBe('none');
    expect(s.onEvent(ev(106, 107)).type).toBe('delta');
  });
});

describe('Coinbase level2', () => {
  it('only applies updates after a snapshot', () => {
    const s = new CoinbaseL2Sync();
    const upd = { type: 'update' as const, product_id: 'BTC-USD', updates: [{ side: 'bid' as const, price_level: '1', new_quantity: '2' }] };
    expect(s.onEvent(upd).type).toBe('none');
    const snap = s.onEvent({
      type: 'snapshot',
      product_id: 'BTC-USD',
      updates: [
        { side: 'bid', price_level: '100', new_quantity: '1.5' },
        { side: 'offer', price_level: '101', new_quantity: '0.5' },
      ],
    });
    expect(snap).toEqual({ type: 'snapshot', bids: [[100, 1.5]], asks: [[101, 0.5]] });
    expect(s.onEvent(upd).type).toBe('delta');
  });

  it('flags sequence gaps but not duplicates', () => {
    const t = new CoinbaseSequenceTracker();
    expect(t.check(0)).toBeNull();
    expect(t.check(1)).toBeNull();
    expect(t.check(1)).toBeNull();
    expect(t.check(5)).toMatch(/gap/);
  });
});
