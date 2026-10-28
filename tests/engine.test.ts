import { WickEngine } from '../src/engine/engine';
import { narrate } from '../src/engine/narrative';
import { SimMarket } from './helpers/sim';

describe('WickEngine — data integrity', () => {
  it('withholds every signal until the book is synchronized', () => {
    const e = new WickEngine({ venueId: 'x', venueName: 'X', venueKind: 'CEX_ORDER_BOOK', symbol: 'X' });
    e.onTrade(0, { ts: 0, price: 100, size: 10, aggressor: 'buy' });
    const s = e.tick(1000);
    expect(s.valid).toBe(false);
    expect(s.mid).toBeNull();
    expect(s.score).toBe(0);
    expect(s.depth.bids).toEqual([]);
    expect(narrate(s)[0].concept).toBe('data');
  });

  it('marks data stale after 10 s of silence and clears the setup', () => {
    const sim = new SimMarket();
    sim.snapshot();
    sim.run(5, (s) => s.noise());
    expect(sim.engine.tick(sim.t).valid).toBe(true);
    sim.t += 11_000;
    const s = sim.engine.tick(sim.t);
    expect(s.valid).toBe(false);
    expect(s.health.status).toBe('stale');
    expect(s.events.some((e) => e.title === 'DATA HICCUP')).toBe(true);
  });

  it('needs a warmup baseline before scoring', () => {
    const sim = new SimMarket();
    sim.snapshot();
    const s = sim.run(20, (m) => m.noise());
    expect(s.warmup.ready).toBe(false);
    expect(s.score).toBe(0);
    expect(s.setup.state).toBe('NEUTRAL');
  });

  it('refuses a crossed book', () => {
    const sim = new SimMarket();
    sim.snapshot();
    const top = sim.engine.book.top()!;
    expect(sim.engine.onBookDelta(sim.t, [[top.askPrice + 0.05, 5]], [])).toBe(false);
    expect(sim.engine.tick(sim.t).valid).toBe(false);
  });
});

describe('WickEngine — microstructure signals', () => {
  it('computes imbalance and OFI with the right sign when bids get added', () => {
    const sim = new SimMarket();
    sim.snapshot();
    sim.run(2);
    const top = sim.engine.book.top()!;
    sim.engine.onMessage(sim.t);
    sim.engine.onBookDelta(sim.t, [[top.bidPrice, top.bidSize + 5]], []);
    const s = sim.engine.tick(sim.t + 10);
    expect(s.ofi.raw).toBeGreaterThan(0);
    expect(s.imbalance[0].value).toBeGreaterThan(0);
  });

  it('tracks aggressive flow and CVD', () => {
    const sim = new SimMarket();
    sim.snapshot();
    sim.trade('buy', 2);
    sim.trade('sell', 0.5);
    const s = sim.engine.tick(sim.t);
    expect(s.flow.cvd).toBeCloseTo(1.5);
    expect(s.flow.delta10).toBeGreaterThan(0);
    expect(s.flow.buyNotional10).toBeGreaterThan(s.flow.sellNotional10);
  });

  it('detects a floor: heavy market selling absorbed by refilled bids without price falling', () => {
    const sim = new SimMarket();
    sim.snapshot();
    sim.run(240, (m) => m.noise()); // baseline
    const before = sim.engine.tick(sim.t).events.length;
    const snap = sim.run(35, (m) => {
      // Sellers slam the bid; a passive buyer keeps the bid refilled, price holds.
      m.trade('sell', 1.5);
      if (m.random() < 0.2) m.trade('buy', 0.05);
    });
    const fresh = snap.events.slice(before);
    const floor = fresh.find((e) => e.kind === 'FLOOR_FORMING');
    expect(floor).toBeDefined();
    expect(floor!.direction).toBe('up');
    expect(Number(floor!.evidence.flowZ)).toBeGreaterThanOrEqual(1.5);
    expect(snap.floors.at(-1)?.kind).toBe('floor');
    // and it shows up in the plain-English read
    expect(narrate(snap).some((r) => r.concept === 'absorption')).toBe(true);
  });

  it('does not call a floor when selling actually pushes price down', () => {
    const sim = new SimMarket();
    sim.snapshot();
    sim.run(240, (m) => m.noise());
    const before = sim.engine.tick(sim.t).events.length;
    const snap = sim.run(35, (m, i) => {
      m.trade('sell', 1.5);
      if (i % 2 === 0) m.moveTo(+(m.mid - 0.01).toFixed(2));
    });
    expect(snap.events.slice(before).some((e) => e.kind === 'FLOOR_FORMING')).toBe(false);
  });

  it('persists calibration through a KV store', () => {
    const mem = new Map<string, string>();
    const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v) };
    const mk = () => new WickEngine({ venueId: 'sim', venueName: 'Sim', venueKind: 'CEX_ORDER_BOOK', symbol: 'SIMUSD', store });
    const sim = new SimMarket(mk());
    sim.snapshot();
    sim.run(400, (m) => m.noise());
    sim.engine.persistCalibration();
    const n1 = sim.engine.tick(sim.t).estimates[0].n;
    expect(n1).toBeGreaterThan(0);
    const again = mk().tick(0);
    const total = (s: typeof again) => s.estimates[0].n;
    // a fresh engine sees the same bucket counts for the neutral-score bucket
    expect(total(again)).toBeGreaterThan(0);
  });
});
