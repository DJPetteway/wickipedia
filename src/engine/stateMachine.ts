import type { EngineConfig } from './config';
import type { Direction, SetupState } from './types';

export interface StateInputs {
  now: number;
  mid: number;
  /** Composite pressure score in [−1, 1]. */
  score: number;
  /** Short-vol / long-vol ratio, null while warming up. */
  compression: number | null;
  /** High/low of mid over the prior range window, excluding the last few seconds. */
  rangeHigh: number | null;
  rangeLow: number | null;
  /** 10 s aggressive-flow delta ratio in [−1, 1]. */
  flowDelta: number;
  /** Most recent supporting book event per direction (ms), e.g. ask wall eaten / floor formed → 'up'. */
  lastSupport: Record<Direction, number | null>;
}

export interface SetupView {
  state: SetupState;
  direction: Direction | null;
  since: number;
  /** Price that confirms the breakout. */
  trigger: number | null;
  /** Price that kills the setup. */
  invalidation: number | null;
  reason: string;
}

export interface Transition {
  from: SetupState;
  to: SetupState;
  direction: Direction | null;
  reason: string;
  view: SetupView;
}

const sign = (d: Direction) => (d === 'up' ? 1 : -1);
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : x.toPrecision(6));

/**
 * NEUTRAL → WATCHING → COILING → IMMINENT → BREAKOUT → COOLDOWN, with FAILED as
 * the exit when a setup is invalidated. Every transition carries a reason
 * string built from the inputs that caused it.
 */
export class SetupStateMachine {
  private s: SetupState = 'NEUTRAL';
  private dir: Direction | null = null;
  private since = 0;
  private trigger: number | null = null;
  private invalidation: number | null = null;
  private reason = 'Waiting for a reason to care.';
  /** When the current entry/exit condition started holding. */
  private enterSince: number | null = null;
  private exitSince: number | null = null;

  constructor(private readonly cfg: EngineConfig['state']) {}

  view(): SetupView {
    return {
      state: this.s,
      direction: this.dir,
      since: this.since,
      trigger: this.trigger,
      invalidation: this.invalidation,
      reason: this.reason,
    };
  }

  /** Hard reset, e.g. when the feed goes stale — we refuse to carry a setup across a data hole. */
  reset(now: number, reason: string): Transition | null {
    if (this.s === 'NEUTRAL') return null;
    return this.go(now, 'NEUTRAL', null, reason);
  }

  step(x: StateInputs): Transition | null {
    const c = this.cfg;
    const age = (x.now - this.since) / 1000;
    const scoreDir: Direction = x.score >= 0 ? 'up' : 'down';
    const aligned = this.dir ? x.score * sign(this.dir) : 0;

    switch (this.s) {
      case 'NEUTRAL': {
        if (Math.abs(x.score) >= c.watchEnter) {
          this.enterSince ??= x.now;
          if ((x.now - this.enterSince) / 1000 >= c.watchHoldSec) {
            this.setLevels(scoreDir, x);
            return this.go(
              x.now,
              'WATCHING',
              scoreDir,
              `${scoreDir === 'up' ? 'Buy' : 'Sell'}-side pressure held at ${x.score.toFixed(2)} for ${c.watchHoldSec}s+.`,
            );
          }
        } else this.enterSince = null;
        return null;
      }

      case 'WATCHING':
      case 'COILING':
      case 'IMMINENT': {
        const d = this.dir!;
        // Levels track the prior range while WATCHING; they freeze once the setup coils.
        if (this.s === 'WATCHING') this.setLevels(d, x);

        const broke = this.trigger !== null && (d === 'up' ? x.mid > this.trigger : x.mid < this.trigger);
        if (broke && x.flowDelta * sign(d) >= c.confirmFlow) {
          return this.go(
            x.now,
            'BREAKOUT',
            d,
            `Price ${fmt(x.mid)} crossed the ${d === 'up' ? 'range high' : 'range low'} ${fmt(this.trigger!)} with ${
              d === 'up' ? 'buyers' : 'sellers'
            } in control of flow (${(x.flowDelta * 100).toFixed(0)}% delta).`,
          );
        }

        const invalid = this.invalidation !== null && (d === 'up' ? x.mid < this.invalidation : x.mid > this.invalidation);
        if (invalid && this.s !== 'WATCHING') {
          return this.go(x.now, 'FAILED', d, `Price ${fmt(x.mid)} broke the invalidation level ${fmt(this.invalidation!)}.`);
        }

        if (this.s === 'IMMINENT') {
          if (x.score * sign(d) <= -c.watchEnter) {
            return this.go(x.now, 'FAILED', d, `Pressure flipped against the setup (score ${x.score.toFixed(2)}).`);
          }
          if (age >= c.imminentTimeoutSec && aligned < c.watchEnter) {
            return this.go(x.now, 'FAILED', d, `No breakout after ${c.imminentTimeoutSec}s and pressure faded.`);
          }
          return null;
        }

        // Fade-out back to neutral (not a failure — nothing was promised yet).
        if (aligned < c.watchExit) {
          this.exitSince ??= x.now;
          if ((x.now - this.exitSince) / 1000 >= c.watchExitSec) {
            return this.go(x.now, 'NEUTRAL', null, `Pressure faded (score ${x.score.toFixed(2)}) — setup dissolved.`);
          }
        } else this.exitSince = null;

        const coiled = x.compression !== null && x.compression <= c.coilRatio;
        if (this.s === 'WATCHING' && coiled && this.trigger !== null) {
          return this.go(
            x.now,
            'COILING',
            d,
            `Volatility compressed to ${(x.compression! * 100).toFixed(0)}% of its 10-min norm while pressure stayed ${
              d === 'up' ? 'bid' : 'offered'
            }.`,
          );
        }

        if (this.s === 'COILING' && this.trigger !== null && x.rangeHigh !== null && x.rangeLow !== null) {
          const width = x.rangeHigh - x.rangeLow;
          const dist = Math.abs(this.trigger - x.mid);
          const support = x.lastSupport[d];
          const supported = support !== null && (x.now - support) / 1000 <= c.supportWindowSec;
          if (aligned >= c.imminentScore && width > 0 && dist <= c.imminentProximity * width && supported) {
            return this.go(
              x.now,
              'IMMINENT',
              d,
              `Pressure ${x.score.toFixed(2)}, price ${((dist / x.mid) * 1e4).toFixed(1)} bps from trigger, and the book just showed ${
                d === 'up' ? 'buy-side' : 'sell-side'
              } support.`,
            );
          }
        }
        return null;
      }

      case 'BREAKOUT': {
        const d = this.dir!;
        const backInside = this.trigger !== null && (d === 'up' ? x.mid < this.trigger : x.mid > this.trigger);
        if (backInside && age < c.breakoutHoldSec) {
          return this.go(
            x.now,
            'FAILED',
            d,
            `Price fell back through ${fmt(this.trigger!)} within ${c.breakoutHoldSec}s — that was a wick, not a breakout.`,
          );
        }
        if (age >= c.breakoutHoldSec) return this.go(x.now, 'COOLDOWN', d, `Breakout held for ${c.breakoutHoldSec}s.`);
        return null;
      }

      case 'FAILED':
        if (age >= c.failedSec) return this.go(x.now, 'COOLDOWN', this.dir, 'Letting the dust settle.');
        return null;

      case 'COOLDOWN':
        if (age >= c.cooldownSec) return this.go(x.now, 'NEUTRAL', null, 'Cooldown over. Reading the book fresh.');
        return null;
    }
  }

  private setLevels(d: Direction, x: StateInputs): void {
    if (x.rangeHigh === null || x.rangeLow === null) {
      this.trigger = this.invalidation = null;
      return;
    }
    const widthBps = ((x.rangeHigh - x.rangeLow) / x.mid) * 1e4;
    if (widthBps < this.cfg.minRangeBps) {
      // Range too tight to define meaningful levels: pad it symmetrically.
      const pad = (x.mid * this.cfg.minRangeBps) / 2e4;
      const mid = (x.rangeHigh + x.rangeLow) / 2;
      this.trigger = d === 'up' ? mid + pad : mid - pad;
      this.invalidation = d === 'up' ? mid - pad : mid + pad;
      return;
    }
    this.trigger = d === 'up' ? x.rangeHigh : x.rangeLow;
    this.invalidation = d === 'up' ? x.rangeLow : x.rangeHigh;
  }

  private go(now: number, to: SetupState, dir: Direction | null, reason: string): Transition {
    const from = this.s;
    this.s = to;
    this.dir = dir;
    this.since = now;
    this.reason = reason;
    this.enterSince = null;
    this.exitSince = null;
    if (to === 'NEUTRAL') this.trigger = this.invalidation = null;
    return { from, to, direction: dir, reason, view: this.view() };
  }
}
