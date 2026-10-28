import type { Candle } from '../src/engine/candles';
import { assessDiscovery, overheadShareOf, vwapOf, type DiscoveryInput } from '../src/engine/discovery';
import type { WickEvent } from '../src/engine/types';

const c = (t: number, o: number, h: number, l: number, cl: number, volUsd = 1000, buyVol = 0, sellVol = 0): Candle => ({
  t: t * 300_000,
  o,
  h,
  l,
  c: cl,
  buyVol,
  sellVol,
  volUsd,
  live: false,
});

/** A gentle uptrend from 1.0 to ~1.9 over 20 five-minute candles. */
const uptrend = () => Array.from({ length: 20 }, (_, i) => c(i, 1 + i * 0.045, 1 + i * 0.045 + 0.05, 1 + i * 0.045 - 0.02, 1 + (i + 1) * 0.045));

const base = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  now: 20 * 300_000,
  price: 1.85,
  structure: uptrend(),
  minute: [],
  quoteReserveUsd: 20_000,
  buyUsd5m: 2_500,
  sellUsd5m: 800,
  buyers5m: 20,
  sellers5m: 8,
  topSellerShare: 0.2,
  cvdSeries: [],
  priceSeries: [],
  events: [],
  ...over,
});

describe('VWAP & volume-by-price', () => {
  it('weights typical price by volume', () => {
    const v = vwapOf([c(0, 1, 1, 1, 1, 1000), c(1, 3, 3, 3, 3, 3000)]);
    // base: 1000/1 + 3000/3 = 2000 → VWAP = 4000/2000
    expect(v).toBeCloseTo(2);
  });

  it('measures how much volume traded above a price', () => {
    const cs = [c(0, 1, 1.2, 0.9, 1, 1000), c(1, 2, 2.2, 1.8, 2, 1000)];
    expect(overheadShareOf(cs, 1.5)).toBeCloseTo(0.5);
    expect(overheadShareOf(cs, 3)).toBe(0);
  });
});

describe('assessDiscovery', () => {
  it('needs chart history first', () => {
    const d = assessDiscovery(base({ structure: uptrend().slice(0, 3) }));
    expect(d.ready).toBe(false);
    expect(d.stage).toBe('NO_DATA');
  });

  it('calls price discovery when price clears the prior high with clean flow', () => {
    const d = assessDiscovery(base({ price: 2.1 }));
    expect(d.stage).toBe('DISCOVERY');
    expect(d.costToHigh).toBe(0);
    expect(d.checks.find((x) => x.id === 'reach')!.label).toBe('Above the prior high');
    expect(d.fibPosition!).toBeGreaterThan(1);
    expect(d.nextTarget?.label).toMatch(/extension/);
    expect(d.score).toBeGreaterThan(0.5);
  });

  it('calls it loading when the asks are thin, buyers can reach the high and nothing is distributing', () => {
    // just under the prior high, with only light volume traded up there
    const structure = uptrend().map((k, i) => (i >= 15 ? { ...k, volUsd: 150 } : k));
    const d = assessDiscovery(base({ price: 1.7, structure }));
    expect(d.checks.map((x) => [x.id, x.pass])).toEqual([
      ['asks', true],
      ['reach', true],
      ['overhead', true],
      ['vwap', true],
      ['fib', true],
      ['distribution', true],
    ]);
    expect(d.stage).toBe('LOADING');
  });

  it('flags distribution: whale sells, one dumping wallet, sellers into green candles', () => {
    const whale: WickEvent = { id: 'w', ts: 20 * 300_000 - 60_000, kind: 'WHALE_SELL', severity: 'notice', title: '', body: '', evidence: {} };
    const greens = Array.from({ length: 10 }, (_, i) => ({ ...c(i, 1, 1.1, 0.99, 1.05), buyVol: 40, sellVol: 60 }));
    const d = assessDiscovery(base({ events: [whale], topSellerShare: 0.7, minute: [...greens, greens[0]] }));
    expect(d.stage).toBe('DISTRIBUTION');
    expect(d.distributionFlags.join(' ')).toMatch(/whale sell/);
    expect(d.distributionFlags.join(' ')).toMatch(/one wallet is 70%/);
    expect(d.distributionFlags.join(' ')).toMatch(/green candles/);
    expect(d.score).toBeLessThan(d.checks.length);
  });

  it('flags a bearish CVD divergence', () => {
    const priceSeries = Array.from({ length: 700 }, (_, i) => 1 + i * 0.001);
    const cvdSeries = Array.from({ length: 700 }, (_, i) => -i);
    const d = assessDiscovery(base({ priceSeries, cvdSeries }));
    expect(d.distributionFlags.join(' ')).toMatch(/divergence/);
  });

  it('sees heavy overhead supply when price sits low in a range', () => {
    const d = assessDiscovery(base({ price: 1.1, buyUsd5m: 100, sellUsd5m: 400 }));
    const over = d.checks.find((x) => x.id === 'overhead')!;
    expect(over.pass).toBe(false);
    expect(d.checks.find((x) => x.id === 'fib')!.pass).toBe(false);
    expect(d.checks.find((x) => x.id === 'vwap')!.pass).toBe(false);
    expect(['NEUTRAL', 'BUILDING']).toContain(d.stage);
    expect(d.score).toBeLessThan(0);
  });

  it('marks liquidity checks unknown rather than guessing', () => {
    const d = assessDiscovery(base({ quoteReserveUsd: null }));
    expect(d.checks.find((x) => x.id === 'asks')!.pass).toBeNull();
    expect(d.checks.find((x) => x.id === 'reach')!.pass).toBeNull();
    expect(d.known).toBe(4);
  });
});

describe('writeArticle', () => {
  it('refuses to write a read without data', async () => {
    const { PoolEngine } = await import('../src/engine/poolEngine');
    const { writeArticle } = await import('../src/engine/article');
    const e = new PoolEngine({
      market: { chain: 'solana', network: 'solana', token: 'T', symbol: 'WICK', name: 'Wick', venue: 'PumpSwap', model: 'CPMM' },
      source: { name: 'Test', mode: 'poll' },
    });
    const a = writeArticle(e.tick(0));
    expect(a.title).toBe('$WICK');
    expect(a.verdict).toBe('Cannot say right now');
    expect(a.checks).toEqual([]);
  });
});
