import { Calibrator } from '../src/engine/calibration';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { betaCdf, betaQuantile } from '../src/engine/stats';

const cfg = { ...DEFAULT_CONFIG.calibration, horizonsSec: [60], sampleEverySec: 10 };

describe('beta helpers', () => {
  it('matches known values', () => {
    expect(betaCdf(0.5, 1, 1)).toBeCloseTo(0.5, 8);
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 8);
    expect(betaQuantile(0.5, 5, 5)).toBeCloseTo(0.5, 6);
    // Beta(2,1) CDF is x^2 → median sqrt(0.5)
    expect(betaQuantile(0.5, 2, 1)).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('Calibrator', () => {
  it('reports the uninformed prior (1/3 each) with zero samples and flags not ready', () => {
    const c = new Calibrator(cfg, 'test');
    const [e] = c.estimates(0.6, 1e-4);
    expect(e.n).toBe(0);
    expect(e.ready).toBe(false);
    expect(e.up.p).toBeCloseTo(1 / 3);
  });

  it('labels outcomes with triple barriers and counts them per score bucket', () => {
    const c = new Calibrator(cfg, 'test');
    const sigma = 1e-4; // 1 bp per second → barrier = max(2, 1·1bp·√60 ≈ 7.75) bps
    let t = 0;
    // 30 samples in the strongest bullish bucket; each one is followed by a +10 bps move.
    for (let i = 0; i < 30; i++) {
      t += 10_000;
      expect(c.maybeSample(t, 100, 0.8, sigma)).toBe(true);
      c.observe(t + 1, 100.1);
    }
    const [e] = c.estimates(0.8, sigma);
    expect(e.n).toBe(30);
    expect(e.up.p).toBeCloseTo(31 / 33);
    expect(e.down.p).toBeCloseTo(1 / 33);
    expect(e.up.lo).toBeLessThan(e.up.p);
    expect(e.up.hi).toBeGreaterThan(e.up.p);
    expect(e.barrierBps).toBeCloseTo(Math.sqrt(60), 4);
    // 30 samples × 10 s / 60 s horizon → nEff 5 — overlapping horizons are discounted.
    expect(e.nEff).toBeCloseTo(5);
    expect(e.ready).toBe(false);
    // Other buckets are untouched.
    expect(c.estimates(-0.8, sigma)[0].n).toBe(0);
  });

  it('resolves flat at expiry and respects the sampling cadence', () => {
    const c = new Calibrator(cfg, 'test');
    expect(c.maybeSample(0, 100, 0, 1e-4)).toBe(true);
    expect(c.maybeSample(5_000, 100, 0, 1e-4)).toBe(false);
    c.observe(30_000, 100.01);
    expect(c.estimates(0)[0].n).toBe(0);
    c.observe(60_000, 100.01);
    const [e] = c.estimates(0);
    expect(e.n).toBe(1);
    expect(e.flat.p).toBeCloseTo(2 / 4);
  });

  it('drops in-flight samples on a data hole instead of guessing their outcome', () => {
    const c = new Calibrator(cfg, 'test');
    c.maybeSample(0, 100, 0, 1e-4);
    c.dropPending();
    c.observe(120_000, 200);
    expect(c.estimates(0)[0].n).toBe(0);
  });

  it('tracks whether floors held', () => {
    const c = new Calibrator(cfg, 'test');
    c.addLevelTest(0, 'floor', 100, 2);
    c.observe(30_000, 100.5);
    c.observe(61_000, 100.5);
    c.addLevelTest(70_000, 'floor', 100, 2);
    c.observe(71_000, 99.9); // below 100·(1−2bps)=99.98
    const h = c.levelHolds().find((x) => x.kind === 'floor')!;
    expect(h.held).toBe(1);
    expect(h.broken).toBe(1);
  });

  it('round-trips persisted state and rejects other versions', () => {
    const a = new Calibrator(cfg, 'v1');
    a.maybeSample(0, 100, 0.8, 1e-4);
    a.observe(1, 101);
    const state = a.serialize();
    const b = new Calibrator(cfg, 'v1');
    expect(b.load(state)).toBe(true);
    expect(b.estimates(0.8)[0].n).toBe(1);
    const c = new Calibrator(cfg, 'v2');
    expect(c.load(state)).toBe(false);
    expect(c.estimates(0.8)[0].n).toBe(0);
  });
});
