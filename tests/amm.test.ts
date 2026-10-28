import { curvePriceSol, impactOf, pumpGraduationVSol, pumpProgress, pumpSolToGraduate, usdToMoveDown, usdToMoveUp, PUMP_CURVE } from '../src/engine/amm';

describe('constant-product impact', () => {
  it('round-trips: buying usdToMoveUp(k) moves price by exactly k', () => {
    for (const k of [0.01, 0.05, 0.25]) {
      expect(impactOf(10_000, usdToMoveUp(10_000, k))).toBeCloseTo(k, 10);
      expect(impactOf(10_000, -usdToMoveDown(10_000, k))).toBeCloseTo(-k, 10);
    }
  });

  it('matches x·y=k directly', () => {
    // pool: 1000 base, 50_000 USD quote → price 50
    const x = 1000;
    const y = 50_000;
    const B = 5_000;
    const y2 = y + B;
    const x2 = (x * y) / y2;
    expect(impactOf(y, B)).toBeCloseTo(y2 / x2 / (y / x) - 1, 10);
  });

  it('pushing down costs more than pushing up by the same %', () => {
    expect(usdToMoveDown(1000, 0.1)).toBeGreaterThan(usdToMoveUp(1000, 0.1));
    expect(usdToMoveDown(1000, 1)).toBe(Infinity);
  });
});

describe('pump.fun bonding curve', () => {
  it('starts at 0% and graduates at ~85 real SOL', () => {
    expect(pumpProgress(PUMP_CURVE.initialVirtualTokens)).toBe(0);
    const gradV = pumpGraduationVSol();
    expect(gradV - PUMP_CURVE.initialVirtualSol).toBeGreaterThan(84);
    expect(gradV - PUMP_CURVE.initialVirtualSol).toBeLessThan(86);
    expect(pumpProgress(PUMP_CURVE.initialVirtualTokens - PUMP_CURVE.initialRealTokens)).toBe(1);
    expect(pumpSolToGraduate(PUMP_CURVE.initialVirtualSol)).toBeCloseTo(gradV - 30, 6);
  });

  it('launch price is 30 SOL / 1.073B tokens', () => {
    expect(curvePriceSol(30, 1_073_000_000)).toBeCloseTo(2.796e-8, 10);
  });
});
