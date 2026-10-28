import { narrate } from '../src/engine/narrative';
import { PoolEngine } from '../src/engine/poolEngine';
import { SimPool } from './helpers/simPool';

const mk = () =>
  new PoolEngine({
    market: { chain: 'solana', network: 'solana', token: 'T', symbol: 'T', name: 'T', venue: 'x', model: 'CPMM' },
    source: { name: 'Test', mode: 'poll' },
  });

describe('PoolEngine — data integrity', () => {
  it('withholds everything until there is a price and a live source', () => {
    const s = mk().tick(1000);
    expect(s.valid).toBe(false);
    expect(s.price).toBeNull();
    expect(s.score).toBe(0);
    expect(narrate(s)[0].concept).toBe('data');
  });

  it('goes stale after 45 s without data and clears the setup', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(5, (p) => p.noise());
    expect(sim.engine.tick(sim.t).valid).toBe(true);
    sim.t += 46_000;
    const s = sim.engine.tick(sim.t);
    expect(s.valid).toBe(false);
    expect(s.events.some((e) => e.title === 'DATA HICCUP')).toBe(true);
  });

  it('de-duplicates swaps seen twice (polling overlap / two sources)', () => {
    const sim = new SimPool();
    sim.publishPool();
    const s = sim.swap('buy', 500);
    sim.engine.onSwaps(sim.t, [s, s]);
    expect(sim.engine.tick(sim.t).flow.buyUsdShort).toBeCloseTo(500);
  });

  it('uses old swaps for candles but not live flow', () => {
    const e = mk();
    e.onStatus(0, 'live');
    const now = 1_800_000_000_000;
    e.onSwaps(now, [{ id: 'old', ts: now - 30 * 60_000, priceUsd: 1, baseAmount: 10, usd: 10, side: 'buy' }]);
    e.onHeartbeat(now);
    const s = e.tick(now);
    expect(s.flow.buyUsdLong).toBe(0);
    expect(s.candles).toHaveLength(1);
  });
});

describe('PoolEngine — impact & flow', () => {
  it('derives exact constant-product impact from pool liquidity', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.swap('buy', 10);
    const s = sim.engine.tick(sim.t);
    const row = s.impact.find((r) => r.pct === 0.05)!;
    // y ≈ 50k → +5% needs y(√1.05 − 1)
    expect(row.upUsd).toBeCloseTo(50_000 * (Math.sqrt(1.05) - 1), -1);
    expect(s.impactExact).toBe(false);
  });

  it('counts flow, wallet breadth and net impact', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.swap('buy', 1000, 'a');
    sim.swap('buy', 1000, 'b');
    sim.swap('sell', 500, 'c');
    const s = sim.engine.tick(sim.t);
    expect(s.flow.buyersLong).toBe(2);
    expect(s.flow.sellersLong).toBe(1);
    expect(s.flow.deltaShort).toBeGreaterThan(0);
    expect(s.flow.netImpactLong).toBeGreaterThan(0);
    expect(s.wallets[0].wallet).toMatch(/^[ab]$/);
  });

  it('flags whale prints relative to liquidity', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.swap('buy', 2_500, 'whale');
    const ev = sim.engine.tick(sim.t).events.find((e) => e.kind === 'WHALE_BUY');
    expect(ev).toBeDefined();
    expect(ev!.body).toMatch(/2\.5K/);
  });

  it('flags one-wallet concentration', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(100, (p, i) => {
      if (i % 8 === 0) p.swap('buy', 300, 'bigguy');
      else if (i % 23 === 0) p.swap('buy', 20);
    });
    const s = sim.engine.tick(sim.t);
    expect(s.events.some((e) => e.kind === 'ONE_WALLET' && e.direction === 'up')).toBe(true);
  });
});

describe('PoolEngine — floors under sell pressure', () => {
  it('calls a floor when heavy selling is absorbed by dip buyers', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(400, (p) => p.noise()); // baseline
    const before = sim.engine.tick(sim.t).events.length;
    const snap = sim.run(130, (p, i) => {
      if (i % 8 === 0) p.swap('sell', 333);
      if (i % 8 === 4) p.swap('buy', 250);
    });
    const floor = snap.events.slice(before).find((e) => e.kind === 'FLOOR_FORMING');
    expect(floor).toBeDefined();
    expect(floor!.direction).toBe('up');
    expect(Number(floor!.evidence.absorbed)).toBeGreaterThan(0.6);
    expect(snap.floors.at(-1)?.kind).toBe('floor');
    expect(narrate(snap).some((r) => r.concept === 'absorption')).toBe(true);
  });

  it('does not call a floor when the selling actually moves price', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(400, (p) => p.noise());
    const before = sim.engine.tick(sim.t).events.length;
    const snap = sim.run(130, (p, i) => {
      if (i % 8 === 0) p.swap('sell', 333);
    });
    expect(snap.events.slice(before).some((e) => e.kind === 'FLOOR_FORMING')).toBe(false);
  });

  it('calls a ceiling when buying is absorbed by sellers', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(400, (p) => p.noise());
    const before = sim.engine.tick(sim.t).events.length;
    const snap = sim.run(130, (p, i) => {
      if (i % 8 === 0) p.swap('buy', 333);
      if (i % 8 === 4) p.swap('sell', 250);
    });
    expect(snap.events.slice(before).some((e) => e.kind === 'CEILING_FORMING')).toBe(true);
  });
});

describe('PoolEngine — liquidity & bonding curve', () => {
  it('detects an LP pull that price does not explain', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(30, (p) => p.noise());
    sim.engine.onPoolState(sim.t, { priceUsd: sim.price, liquidityUsd: 2 * sim.y * 0.6, fdvUsd: null, mcapUsd: null, model: 'CPMM' });
    const ev = sim.engine.tick(sim.t).events.find((e) => e.kind === 'LIQUIDITY_PULLED');
    expect(ev).toBeDefined();
    expect(ev!.severity).toBe('alert');
  });

  it('does not mistake a price drop for an LP pull', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(10);
    // price −36% → CPMM liquidity falls to √0.64 = 80% on its own
    sim.engine.onPoolState(sim.t, { priceUsd: sim.price * 0.64, liquidityUsd: 2 * sim.y * 0.8, fdvUsd: null, mcapUsd: null, model: 'CPMM' });
    expect(sim.engine.tick(sim.t).events.some((e) => e.kind === 'LIQUIDITY_PULLED')).toBe(false);
  });

  it('announces graduation milestones once, and graduation', () => {
    const e = mk();
    e.onStatus(0, 'live');
    const curve = (progress: number, graduated = false) => ({
      priceUsd: 0.0001,
      liquidityUsd: null,
      fdvUsd: null,
      mcapUsd: null,
      model: 'BONDING_CURVE' as const,
      curve: { vSol: 60, vTokens: 500_000_000, solUsd: 150, progress, solToGraduate: 20, graduated },
    });
    e.onPoolState(0, curve(0.3));
    e.onHeartbeat(0);
    e.tick(1000);
    e.onPoolState(2000, curve(0.55));
    e.onPoolState(3000, curve(0.56));
    e.onPoolState(4000, curve(0.92));
    e.onPoolState(5000, curve(1, true));
    e.onHeartbeat(5000);
    const s = e.tick(5000);
    const kinds = s.events.map((x) => x.title);
    expect(kinds).toEqual(['GRADUATION LOADING… 55%', 'GRADUATION LOADING… 92%', 'GRADUATED 🎓']);
    expect(s.impactExact).toBe(true);
    // curve impact uses vSol × SOL/USD = $9,000 quote reserve
    expect(s.quoteReserveUsd).toBe(9000);
  });

  it('persists calibration per token', () => {
    const mem = new Map<string, string>();
    const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v) };
    const make = () =>
      new PoolEngine({
        market: { chain: 'solana', network: 'solana', token: 'P', symbol: 'P', name: 'P', venue: 'x', model: 'CPMM' },
        source: { name: 'Sim', mode: 'poll' },
        store,
      });
    const sim = new SimPool(make());
    sim.publishPool();
    sim.run(800, (p) => p.noise());
    sim.engine.persistCalibration();
    const total = (s: ReturnType<PoolEngine['tick']>) => s.estimates.reduce((a, e) => a + e.n, 0) + s.estimates.reduce((a, e) => a + e.pending, 0);
    expect(sim.engine.tick(sim.t).estimates[0].n).toBeGreaterThan(0);
    expect(total(make().tick(0))).toBeGreaterThan(0);
  });
});
