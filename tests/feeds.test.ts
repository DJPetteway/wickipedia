import { WickEngine } from '../src/engine/engine';
import { BinanceFeed } from '../src/feeds/binance';
import { CoinbaseFeed } from '../src/feeds/coinbase';
import type { WsLike } from '../src/feeds/feed';
import { findVenue } from '../src/feeds/venues';

class FakeWs implements WsLike {
  readyState = 0;
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onerror: WsLike['onerror'] = null;
  onclose: WsLike['onclose'] = null;
  sent: string[] = [];
  constructor(readonly url: string) {}
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
}

const engine = (sym: string) => new WickEngine({ venueId: 't', venueName: 'T', venueKind: 'CEX_ORDER_BOOK', symbol: sym });

describe('BinanceFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aligns the REST snapshot with the buffered stream and goes live; resyncs on a gap', async () => {
    const sockets: FakeWs[] = [];
    const fetches: string[] = [];
    let snapId = 100;
    const fetch = async (url: string) => {
      fetches.push(url);
      if (url.includes('klines')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({ lastUpdateId: snapId, bids: [['99', '1']], asks: [['101', '1']] }) };
    };
    const e = engine('BTCUSDT');
    const f = new BinanceFeed(findVenue('binance')!, 'BTCUSDT', e, {
      ws: (u) => {
        const w = new FakeWs(u);
        sockets.push(w);
        return w;
      },
      fetch,
    });
    f.start();
    const ws = sockets[0];
    expect(ws.url).toBe('wss://stream.binance.com:9443/stream?streams=btcusdt@depth@100ms/btcusdt@aggTrade');
    ws.open();
    const depth = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = []) =>
      ws.emit({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', E: Date.now(), s: 'BTCUSDT', U, u, b, a } });
    depth(95, 101, [['99.5', '2']]);
    expect(e.tick(Date.now()).valid).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(fetches.some((u) => u.includes('/api/v3/depth?symbol=BTCUSDT&limit=1000'))).toBe(true);
    let s = e.tick(Date.now());
    expect(s.valid).toBe(true);
    expect(s.top).toEqual({ bidPrice: 99.5, bidSize: 2, askPrice: 101, askSize: 1 });

    depth(102, 103, [], [['100.5', '3']]);
    expect(e.tick(Date.now()).top?.askPrice).toBe(100.5);

    ws.emit({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', E: 1, s: 'BTCUSDT', a: 1, p: '100.5', q: '1', T: Date.now(), m: false } });
    expect(e.tick(Date.now()).flow.cvd).toBe(1);

    // gap → invalid, refetch snapshot, live again
    snapId = 300;
    depth(200, 301);
    depth(302, 302);
    s = e.tick(Date.now());
    expect(s.valid).toBe(false);
    expect(s.health.gaps).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(e.tick(Date.now()).valid).toBe(true);
    f.stop();
  });
});

describe('CoinbaseFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('subscribes, builds the book from the WS snapshot, and reconnects on a sequence gap', async () => {
    const sockets: FakeWs[] = [];
    const e = engine('BTC-USD');
    const f = new CoinbaseFeed(findVenue('coinbase')!, 'BTC-USD', e, {
      ws: (u) => {
        const w = new FakeWs(u);
        sockets.push(w);
        return w;
      },
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    });
    f.start();
    const ws = sockets[0];
    ws.open();
    expect(ws.sent.map((m) => JSON.parse(m).channel)).toEqual(['heartbeats', 'level2', 'market_trades']);
    const ts = new Date().toISOString();
    ws.emit({
      channel: 'l2_data',
      timestamp: ts,
      sequence_num: 0,
      events: [
        {
          type: 'snapshot',
          product_id: 'BTC-USD',
          updates: [
            { side: 'bid', price_level: '100', new_quantity: '1' },
            { side: 'offer', price_level: '101', new_quantity: '2' },
          ],
        },
      ],
    });
    expect(e.tick(Date.now()).top).toEqual({ bidPrice: 100, bidSize: 1, askPrice: 101, askSize: 2 });
    ws.emit({
      channel: 'market_trades',
      timestamp: ts,
      sequence_num: 1,
      events: [{ type: 'update', trades: [{ trade_id: '1', product_id: 'BTC-USD', price: '101', size: '0.5', side: 'SELL', time: ts }] }],
    });
    expect(e.tick(Date.now()).flow.cvd).toBe(0.5); // maker SELL → taker bought
    ws.emit({ channel: 'heartbeats', timestamp: ts, sequence_num: 5, events: [] });
    expect(e.tick(Date.now()).valid).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets.length).toBe(2);
    f.stop();
  });
});
