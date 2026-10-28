/**
 * Every threshold the engine uses lives here so it is visible, testable and
 * documented in one place. These are heuristics chosen for liquid spot
 * pairs, not fitted parameters; the probability estimates shown in the UI
 * never come from these weights — they come from calibration.ts, which
 * counts what actually happened after similar readings.
 */
export interface EngineConfig {
  /** Bands (bps from mid) used for order-book imbalance. */
  imbalanceBandsBps: number[];
  /** The band that feeds the composite score. */
  primaryBandBps: number;
  /** Window for OFI and short flow (ms). */
  shortWindowMs: number;
  /** Window for longer flow context (ms). */
  longWindowMs: number;
  /** Seconds of 1 s mid samples needed before any signal is shown. */
  warmupSec: number;
  /** Composite score weights (sum to 1). */
  weights: { imbalance: number; ofi: number; flow: number; microprice: number };

  walls: {
    /** Only look this far from mid for walls (bps). */
    rangeBps: number;
    /** A level is a wall if its size ≥ mult × median level size on that side within range. */
    medianMultiple: number;
    /** …and it must persist this long before we call it out (anti-flicker). */
    minAgeMs: number;
    /** Drop fraction from peak that counts as "eaten" / "vanished". */
    eatenDropFrac: number;
    vanishDropFrac: number;
    /** Share of the drop that must be explained by trades to call it eaten. */
    eatenTradeShare: number;
    /** Share explained by trades below which a drop is "vanished" (pulled). */
    vanishMaxTradeShare: number;
  };

  absorption: {
    windowSec: number;
    /** Aggressive notional must be ≥ this z-score vs. its own recent history. */
    minFlowZ: number;
    /** Aggressor share of window volume (e.g. ≥ 0.6 of volume is sells). */
    minAggressorShare: number;
    /** Price must move less than max(minBps, sigmaMult × σ over the window). */
    maxMoveBps: number;
    sigmaMult: number;
    /** Near-touch depth on the absorbing side must stay ≥ this fraction of where it started. */
    minDepthRetention: number;
    cooldownSec: number;
  };

  stacking: {
    windowSec: number;
    bandBps: number;
    /** Depth growth required (0.3 = +30%). */
    minGrowth: number;
    minImbalance: number;
    cooldownSec: number;
  };

  state: {
    watchEnter: number;
    watchHoldSec: number;
    watchExit: number;
    watchExitSec: number;
    /** short-vol / long-vol below this = compression. */
    coilRatio: number;
    imminentScore: number;
    /** Price must be within this fraction of the range width from the trigger. */
    imminentProximity: number;
    /** Supporting book event must be this recent (s). */
    supportWindowSec: number;
    rangeSec: number;
    minRangeBps: number;
    /** Flow confirmation (10 s delta ratio) required for a breakout. */
    confirmFlow: number;
    breakoutHoldSec: number;
    imminentTimeoutSec: number;
    failedSec: number;
    cooldownSec: number;
  };

  calibration: {
    horizonsSec: number[];
    sampleEverySec: number;
    /** Barrier = max(minBps, k × σ_1s × √h). */
    barrierSigma: number;
    minBarrierBps: number;
    /** Score bucket edges (ascending, inside (−1, 1)). */
    bucketEdges: number[];
    /** Effective sample size below which estimates are flagged as low confidence. */
    minEffectiveN: number;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  imbalanceBandsBps: [10, 25, 50],
  primaryBandBps: 25,
  shortWindowMs: 10_000,
  longWindowMs: 60_000,
  warmupSec: 60,
  weights: { imbalance: 0.3, ofi: 0.25, flow: 0.3, microprice: 0.15 },
  walls: {
    rangeBps: 150,
    medianMultiple: 6,
    minAgeMs: 3_000,
    eatenDropFrac: 0.5,
    vanishDropFrac: 0.7,
    eatenTradeShare: 0.5,
    vanishMaxTradeShare: 0.2,
  },
  absorption: {
    windowSec: 30,
    minFlowZ: 1.5,
    minAggressorShare: 0.6,
    maxMoveBps: 3,
    sigmaMult: 0.5,
    minDepthRetention: 0.8,
    cooldownSec: 45,
  },
  stacking: {
    windowSec: 30,
    bandBps: 25,
    minGrowth: 0.3,
    minImbalance: 0.25,
    cooldownSec: 60,
  },
  state: {
    watchEnter: 0.25,
    watchHoldSec: 3,
    watchExit: 0.12,
    watchExitSec: 8,
    coilRatio: 0.75,
    imminentScore: 0.45,
    imminentProximity: 0.35,
    supportWindowSec: 30,
    rangeSec: 120,
    minRangeBps: 3,
    confirmFlow: 0.15,
    breakoutHoldSec: 15,
    imminentTimeoutSec: 120,
    failedSec: 5,
    cooldownSec: 30,
  },
  calibration: {
    horizonsSec: [60, 300, 900],
    sampleEverySec: 10,
    barrierSigma: 1,
    minBarrierBps: 2,
    bucketEdges: [-0.5, -0.2, 0.2, 0.5],
    minEffectiveN: 10,
  },
};

/** Bump when anything that changes calibration semantics changes. */
export const ENGINE_VERSION = 'wk-1';
