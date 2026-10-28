import { anatomy, CandleBuilder } from '../src/engine/candles';
import { explainCandle } from '../src/engine/narrative';

describe('candles & wick explainer', () => {
  it('builds OHLC with aggressor volume from trades', () => {
    const b = new CandleBuilder(60_000);
    b.onTrade({ ts: 0, price: 100, size: 1, aggressor: 'buy' });
    b.onTrade({ ts: 10_000, price: 98, size: 2, aggressor: 'sell' });
    b.onTrade({ ts: 20_000, price: 101, size: 1, aggressor: 'buy' });
    b.onTrade({ ts: 59_999, price: 100.5, size: 1, aggressor: 'sell' });
    b.onTrade({ ts: 60_000, price: 100.6, size: 1, aggressor: 'buy' });
    const [c0, c1] = b.list();
    expect(c0).toMatchObject({ t: 0, o: 100, h: 101, l: 98, c: 100.5, buyVol: 2, sellVol: 3, live: true });
    expect(c1.t).toBe(60_000);
  });

  it('reads a long lower wick on sell-heavy flow as absorption', () => {
    const c = { t: 0, o: 100, h: 100.2, l: 98, c: 100.1, buyVol: 1, sellVol: 5, live: true };
    expect(anatomy(c).lowerFrac).toBeGreaterThan(0.5);
    const r = explainCandle(c)!;
    expect(r.tone).toBe('bull');
    expect(r.text).toMatch(/absorption/);
  });

  it('reads a long upper wick as rejection of higher prices', () => {
    const r = explainCandle({ t: 0, o: 100, h: 102, l: 99.9, c: 100.1, buyVol: 5, sellVol: 1, live: true })!;
    expect(r.tone).toBe('bear');
    expect(r.text).toMatch(/Upper wicks/);
  });

  it('does not invent a reading for a flat candle', () => {
    expect(explainCandle({ t: 0, o: 1, h: 1, l: 1, c: 1, buyVol: 0, sellVol: 0, live: true })).toBeNull();
  });

  it('seeds history without overwriting live candles', () => {
    const b = new CandleBuilder(60_000);
    b.onTrade({ ts: 120_000, price: 5, size: 1, aggressor: 'buy' });
    b.seed([
      { t: 60_000, o: 1, h: 1, l: 1, c: 1, buyVol: 0, sellVol: 0, live: true },
      { t: 120_000, o: 9, h: 9, l: 9, c: 9, buyVol: 0, sellVol: 0, live: true },
    ]);
    const list = b.list();
    expect(list.map((c) => c.t)).toEqual([60_000, 120_000]);
    expect(list[0].live).toBe(false);
    expect(list[1].c).toBe(5);
  });
});
