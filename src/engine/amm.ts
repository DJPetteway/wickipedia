/**
 * Price-impact math for on-chain liquidity.
 *
 * For a constant-product pool (x·y = k) with quote-side reserve worth `y` USD:
 *   buying  B USD of base moves price by (1 + B/y)²
 *   selling S USD of base moves price by 1 / (1 + S/y)²
 * The same math is *exact* for pump.fun-style bonding curves, which are
 * constant-product curves over virtual reserves.
 */

/** USD of buys needed to push price up by `pct` (0.05 = +5%). */
export function usdToMoveUp(quoteReserveUsd: number, pct: number): number {
  return quoteReserveUsd * (Math.sqrt(1 + pct) - 1);
}

/** USD of sells needed to push price down by `pct` (0.05 = −5%). */
export function usdToMoveDown(quoteReserveUsd: number, pct: number): number {
  if (pct >= 1) return Infinity;
  return quoteReserveUsd * (1 / Math.sqrt(1 - pct) - 1);
}

/** Fractional price change caused by a net buy (+) / sell (−) of `netUsd` with no offsetting flow. */
export function impactOf(quoteReserveUsd: number, netUsd: number): number {
  if (!(quoteReserveUsd > 0)) return 0;
  if (netUsd >= 0) return (1 + netUsd / quoteReserveUsd) ** 2 - 1;
  return 1 / (1 + -netUsd / quoteReserveUsd) ** 2 - 1;
}

/**
 * Quote-side reserve in USD. Pool liquidity reported by indexers is the value
 * of both sides; in a balanced constant-product pool each side is half.
 */
export function quoteReserveFromLiquidity(liquidityUsd: number | null): number | null {
  return liquidityUsd !== null && liquidityUsd > 0 ? liquidityUsd / 2 : null;
}

// ---------------------------------------------------------------------------
// pump.fun bonding curve
// Published launch constants (UI units). pump.fun has changed parameters in
// the past, so these live in one place and every derived figure is labelled
// as an estimate in the UI.
// ---------------------------------------------------------------------------

export const PUMP_CURVE = {
  initialVirtualTokens: 1_073_000_000,
  initialVirtualSol: 30,
  /** Tokens sellable from the curve before it graduates. */
  initialRealTokens: 793_100_000,
  totalSupply: 1_000_000_000,
};

export function pumpProgress(vTokens: number, c = PUMP_CURVE): number {
  const sold = c.initialVirtualTokens - vTokens;
  return Math.max(0, Math.min(1, sold / c.initialRealTokens));
}

/** Virtual SOL in the curve at the moment it graduates (constant product). */
export function pumpGraduationVSol(c = PUMP_CURVE): number {
  const k = c.initialVirtualTokens * c.initialVirtualSol;
  return k / (c.initialVirtualTokens - c.initialRealTokens);
}

export function pumpSolToGraduate(vSol: number, c = PUMP_CURVE): number {
  return Math.max(0, pumpGraduationVSol(c) - vSol);
}

/** Price of one token in SOL from virtual reserves. */
export function curvePriceSol(vSol: number, vTokens: number): number {
  return vTokens > 0 ? vSol / vTokens : NaN;
}
