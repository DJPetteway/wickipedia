import type { EngineConfig } from './config';
import { betaQuantile } from './stats';

/**
 * Empirical, self-calibrating breakout estimates.
 *
 * Every `sampleEverySec` we record the current composite score bucket and mid
 * price, then set symmetric barriers at ±max(minBps, k·σ₁ₛ·√h) for each
 * horizon h. Whichever barrier price touches first (or neither, by expiry) is
 * the outcome — the "triple-barrier" labelling method. The estimate shown for
 * a bucket is the Dirichlet(1,1,1)-smoothed frequency of those outcomes.
 *
 * So every percentage on screen is "how often this actually happened after
 * readings like this one, on this pair, on this venue", with a sample size
 * attached. No model invents a number; with no data the answer is "unknown".
 */

export type Outcome = 'up' | 'down' | 'flat';
const OUTCOME_INDEX: Record<Outcome, number> = { up: 0, down: 1, flat: 2 };

interface PendingSample {
  ts: number;
  expires: number;
  horizonSec: number;
  bucket: number;
  upPx: number;
  downPx: number;
}

export type LevelKind = 'floor' | 'ceiling';

interface PendingLevelTest {
  kind: LevelKind;
  ts: number;
  expires: number;
  horizonSec: number;
  /** Price beyond which the level counts as broken. */
  breakPx: number;
  broken: boolean;
}

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

export interface HorizonEstimate {
  horizonSec: number;
  bucket: number;
  bucketLabel: string;
  /** Barrier distance used for this horizon right now, bps. */
  barrierBps: number | null;
  up: Interval;
  down: Interval;
  flat: Interval;
  /** Unconditional (all buckets) rates for comparison. */
  baseUp: number;
  baseDown: number;
  n: number;
  /** Raw resolved outcomes for this bucket. */
  counts: { up: number; down: number; flat: number };
  /** n discounted for overlapping horizons (samples are autocorrelated). */
  nEff: number;
  ready: boolean;
  pending: number;
}

export interface LevelHoldEstimate {
  kind: LevelKind;
  horizonSec: number;
  held: number;
  broken: number;
  rate: Interval;
  ready: boolean;
}

export interface CalibrationState {
  version: string;
  counts: Record<string, number[][]>;
  levels: Record<string, [held: number, broken: number]>;
}

export class Calibrator {
  private counts: Record<string, number[][]> = {};
  private levels: Record<string, [number, number]> = {};
  private pending: PendingSample[] = [];
  private levelTests: PendingLevelTest[] = [];
  private lastSampleAt = -Infinity;
  private lastSigma: number | null = null;

  constructor(
    private readonly cfg: EngineConfig['calibration'],
    private readonly version: string,
  ) {
    this.clear();
  }

  clear(): void {
    const nb = this.cfg.bucketEdges.length + 1;
    this.counts = {};
    for (const h of this.cfg.horizonsSec) this.counts[h] = Array.from({ length: nb }, () => [0, 0, 0]);
    this.levels = {};
    for (const k of ['floor', 'ceiling'] as const) for (const h of this.cfg.horizonsSec) this.levels[`${k}:${h}`] = [0, 0];
    this.pending = [];
    this.levelTests = [];
  }

  bucketOf(score: number): number {
    const edges = this.cfg.bucketEdges;
    let i = 0;
    while (i < edges.length && score >= edges[i]) i++;
    return i;
  }

  bucketLabel(b: number): string {
    const edges = this.cfg.bucketEdges;
    const lo = b === 0 ? '−1' : edges[b - 1].toFixed(1);
    const hi = b === edges.length ? '+1' : edges[b].toFixed(1);
    return `score ${lo}…${hi}`;
  }

  barrierBps(horizonSec: number, sigma1s: number | null): number | null {
    if (sigma1s === null || !(sigma1s > 0)) return null;
    return Math.max(this.cfg.minBarrierBps, this.cfg.barrierSigma * sigma1s * Math.sqrt(horizonSec) * 1e4);
  }

  /** Records a sample if the cadence allows. `sigma1s` is the stdev of 1 s log returns. */
  maybeSample(now: number, mid: number, score: number, sigma1s: number | null): boolean {
    if (now - this.lastSampleAt < this.cfg.sampleEverySec * 1000) return false;
    if (sigma1s === null || !(sigma1s > 0)) return false;
    this.lastSampleAt = now;
    this.lastSigma = sigma1s;
    const bucket = this.bucketOf(score);
    for (const h of this.cfg.horizonsSec) {
      const b = this.barrierBps(h, sigma1s)! / 1e4;
      this.pending.push({ ts: now, expires: now + h * 1000, horizonSec: h, bucket, upPx: mid * (1 + b), downPx: mid * (1 - b) });
    }
    return true;
  }

  addLevelTest(now: number, kind: LevelKind, level: number, bufferBps: number): void {
    for (const h of this.cfg.horizonsSec) {
      const breakPx = kind === 'floor' ? level * (1 - bufferBps / 1e4) : level * (1 + bufferBps / 1e4);
      this.levelTests.push({ kind, ts: now, expires: now + h * 1000, horizonSec: h, breakPx, broken: false });
    }
  }

  /** Feed every observed mid (or trade) price. Resolves barriers and level tests. */
  observe(now: number, px: number): void {
    const still: PendingSample[] = [];
    for (const s of this.pending) {
      let outcome: Outcome | null = null;
      if (px >= s.upPx) outcome = 'up';
      else if (px <= s.downPx) outcome = 'down';
      else if (now >= s.expires) outcome = 'flat';
      if (outcome) this.counts[s.horizonSec][s.bucket][OUTCOME_INDEX[outcome]]++;
      else still.push(s);
    }
    this.pending = still;

    const stillLv: PendingLevelTest[] = [];
    for (const t of this.levelTests) {
      if (!t.broken && (t.kind === 'floor' ? px < t.breakPx : px > t.breakPx)) t.broken = true;
      if (t.broken || now >= t.expires) {
        const c = this.levels[`${t.kind}:${t.horizonSec}`];
        if (t.broken) c[1]++;
        else c[0]++;
      } else stillLv.push(t);
    }
    this.levelTests = stillLv;
  }

  /**
   * Drop in-flight samples. Called when the feed has a hole: an outcome
   * spanning missing data could be wrong, so it is not counted at all.
   */
  dropPending(): void {
    this.pending = [];
    this.levelTests = [];
  }

  estimates(score: number, sigma1s: number | null = this.lastSigma): HorizonEstimate[] {
    const bucket = this.bucketOf(score);
    return this.cfg.horizonsSec.map((h) => {
      const c = this.counts[h][bucket];
      const n = c[0] + c[1] + c[2];
      const a = c.map((x) => x + 1);
      const total = a[0] + a[1] + a[2];
      const iv = (i: number): Interval => ({
        p: a[i] / total,
        lo: betaQuantile(0.1, a[i], total - a[i]),
        hi: betaQuantile(0.9, a[i], total - a[i]),
      });
      const all = this.counts[h].reduce((acc, r) => [acc[0] + r[0], acc[1] + r[1], acc[2] + r[2]], [0, 0, 0]);
      const allN = all[0] + all[1] + all[2];
      const nEff = n * Math.min(1, this.cfg.sampleEverySec / h);
      return {
        horizonSec: h,
        bucket,
        bucketLabel: this.bucketLabel(bucket),
        barrierBps: this.barrierBps(h, sigma1s),
        up: iv(0),
        down: iv(1),
        flat: iv(2),
        baseUp: (all[0] + 1) / (allN + 3),
        baseDown: (all[1] + 1) / (allN + 3),
        n,
        counts: { up: c[0], down: c[1], flat: c[2] },
        nEff,
        ready: nEff >= this.cfg.minEffectiveN,
        pending: this.pending.filter((p) => p.horizonSec === h).length,
      };
    });
  }

  levelHolds(): LevelHoldEstimate[] {
    const out: LevelHoldEstimate[] = [];
    for (const kind of ['floor', 'ceiling'] as const) {
      for (const h of this.cfg.horizonsSec) {
        const [held, broken] = this.levels[`${kind}:${h}`];
        const a = held + 1;
        const b = broken + 1;
        out.push({
          kind,
          horizonSec: h,
          held,
          broken,
          rate: { p: a / (a + b), lo: betaQuantile(0.1, a, b), hi: betaQuantile(0.9, a, b) },
          ready: held + broken >= 5,
        });
      }
    }
    return out;
  }

  serialize(): CalibrationState {
    return { version: this.version, counts: structuredClone(this.counts), levels: structuredClone(this.levels) };
  }

  /** Loads persisted counts; ignores state from a different engine version or config shape. */
  load(state: CalibrationState | null | undefined): boolean {
    if (!state || state.version !== this.version) return false;
    const nb = this.cfg.bucketEdges.length + 1;
    for (const h of this.cfg.horizonsSec) {
      const rows = state.counts?.[h];
      if (!rows || rows.length !== nb || rows.some((r) => r.length !== 3)) return false;
    }
    for (const h of this.cfg.horizonsSec) this.counts[h] = state.counts[h].map((r) => [...r]);
    for (const k of Object.keys(this.levels)) {
      const v = state.levels?.[k];
      if (v && v.length === 2) this.levels[k] = [v[0], v[1]];
    }
    return true;
  }
}
