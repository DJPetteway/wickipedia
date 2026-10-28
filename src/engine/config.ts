/**
 * Every threshold the engine uses lives here so it is visible, testable and
 * documented in one place. These are heuristics for on-chain memecoin /
 * launchpad markets, not fitted parameters. The probability estimates shown
 * in the UI never come from these weights — they come from calibration.ts,
 * which counts what actually happened after similar readings.
 */
export interface EngineConfig {
  /** Short and long flow windows (ms). */
  shortWindowMs: number;
  longWindowMs: number;
  /** Seconds of 1 s price samples needed before any signal is shown. */
  warmupSec: number;
  /** Signals pause when the source has been silent this long (ms). */
  staleMs: number;
  /** Swaps older than this (vs. now) are used for candles only, not live flow. */
  maxSwapAgeMs: number;
  /** Composite score weights (sum to 1). */
  weights: { flowShort: number; flowLong: number; wallets: number; flowVsLiquidity: number };
  /** Price move the flow-vs-liquidity term is scaled to (0.02 = 2%). */
  liquidityRefMove: number;

  whales: {
    minUsd: number;
    /** …or this fraction of pool liquidity, whichever is larger. */
    liquidityFrac: number;
    cooldownSec: number;
  };

  wallets: {
    /** Top wallet share of one side's 5-min volume that triggers a concentration alert. */
    topShare: number;
    minTrades: number;
    minUsd: number;
    cooldownSec: number;
  };

  liquidity: {
    /** Unexplained liquidity change (after removing the price effect) that counts as an LP pull / add. */
    pullFrac: number;
    addFrac: number;
    lookbackSec: number;
    cooldownSec: number;
  };

  absorption: {
    windowSec: number;
    /** Aggressive notional ≥ this z-score vs. its own recent history. */
    minFlowZ: number;
    /** Aggressor share of window volume. */
    minAggressorShare: number;
    /** One-sided flow must be at least this multiple of its typical (median) window volume. */
    minBaselineMultiple: number;
    /** All conditions must hold continuously this long before a floor/ceiling is called (s). */
    persistSec: number;
    /** Gross one-sided flow must have implied at least this move on the pool's curve. */
    minImpliedMove: number;
    /** Actual move must be ≤ this fraction of the implied move (the rest was absorbed). */
    maxRealizedShare: number;
    /** Fallback when liquidity is unknown: max move = max(minBps, sigmaMult·σ·√window). */
    fallbackMaxMoveBps: number;
    sigmaMult: number;
    /** A floor "breaks" if price trades this far below it (bps). */
    levelBufferBps: number;
    cooldownSec: number;
  };

  stacking: {
    windowSec: number;
    minWallets: number;
    /** Distinct buyers ÷ sellers (or the inverse). */
    minRatio: number;
    cooldownSec: number;
  };

  graduation: {
    /** Bonding-curve progress milestones that emit an event. */
    milestones: number[];
  };

  state: {
    watchEnter: number;
    watchHoldSec: number;
    watchExit: number;
    watchExitSec: number;
    coilRatio: number;
    imminentScore: number;
    imminentProximity: number;
    supportWindowSec: number;
    rangeSec: number;
    minRangeBps: number;
    confirmFlow: number;
    breakoutHoldSec: number;
    imminentTimeoutSec: number;
    failedSec: number;
    cooldownSec: number;
  };

  calibration: {
    horizonsSec: number[];
    sampleEverySec: number;
    barrierSigma: number;
    minBarrierBps: number;
    bucketEdges: number[];
    minEffectiveN: number;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  shortWindowMs: 60_000,
  longWindowMs: 300_000,
  warmupSec: 90,
  staleMs: 45_000,
  maxSwapAgeMs: 10 * 60_000,
  weights: { flowShort: 0.3, flowLong: 0.25, wallets: 0.2, flowVsLiquidity: 0.25 },
  liquidityRefMove: 0.02,
  whales: { minUsd: 2_000, liquidityFrac: 0.01, cooldownSec: 15 },
  wallets: { topShare: 0.5, minTrades: 6, minUsd: 1_000, cooldownSec: 180 },
  liquidity: { pullFrac: 0.2, addFrac: 0.25, lookbackSec: 180, cooldownSec: 120 },
  absorption: {
    windowSec: 120,
    minFlowZ: 1.5,
    minAggressorShare: 0.55,
    minBaselineMultiple: 2.5,
    persistSec: 10,
    minImpliedMove: 0.03,
    maxRealizedShare: 0.35,
    fallbackMaxMoveBps: 50,
    sigmaMult: 0.5,
    levelBufferBps: 100,
    cooldownSec: 120,
  },
  stacking: { windowSec: 300, minWallets: 8, minRatio: 2, cooldownSec: 180 },
  graduation: { milestones: [0.5, 0.75, 0.9, 0.95] },
  state: {
    watchEnter: 0.25,
    watchHoldSec: 5,
    watchExit: 0.12,
    watchExitSec: 20,
    coilRatio: 0.75,
    imminentScore: 0.45,
    imminentProximity: 0.35,
    supportWindowSec: 120,
    rangeSec: 300,
    minRangeBps: 50,
    confirmFlow: 0.2,
    breakoutHoldSec: 30,
    imminentTimeoutSec: 300,
    failedSec: 10,
    cooldownSec: 60,
  },
  calibration: {
    horizonsSec: [300, 900, 3600],
    sampleEverySec: 15,
    barrierSigma: 1,
    minBarrierBps: 50,
    bucketEdges: [-0.5, -0.2, 0.2, 0.5],
    minEffectiveN: 10,
  },
};

/** Bump when anything that changes calibration semantics changes. */
export const ENGINE_VERSION = 'wk-onchain-1';
