import { usdToMoveUp } from './amm';
import type { Candle } from './candles';
import { fmtPct, fmtPx, fmtUsd } from './copy';
import type { WickEvent } from './types';

/**
 * "Is the sell side thin enough that buy pressure could knock this into price
 * discovery — and is anything hiding that would sell into it?"
 *
 * On a DEX pool there is no literal order book. The sell side a buyer has to
 * chew through is (a) the pool's curve — how many $ of buys move price — and
 * (b) overhead supply: holders who bought higher and are waiting to sell,
 * estimated from how much volume traded above the current price. Each check
 * below is a measurement with a pass/fail rule; nothing here is a probability.
 */

export type DiscoveryStage = 'NO_DATA' | 'DISTRIBUTION' | 'NEUTRAL' | 'BUILDING' | 'LOADING' | 'DISCOVERY';

export interface Check {
  id: 'asks' | 'reach' | 'overhead' | 'vwap' | 'fib' | 'distribution';
  label: string;
  /** null = not enough data to judge. */
  pass: boolean | null;
  detail: string;
}

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface Discovery {
  ready: boolean;
  stage: DiscoveryStage;
  /** −1 (supply / distribution) … +1 (discovery). A fixed blend of the checks — not a probability. */
  score: number;
  passed: number;
  known: number;
  checks: Check[];
  swingHigh: number | null;
  swingLow: number | null;
  vwap: number | null;
  fib: FibLevel[];
  /** Where price sits in the swing: 0 = low, 1 = high, >1 = above the high. */
  fibPosition: number | null;
  nextTarget: { label: string; price: number } | null;
  /** $ of buys needed to move price +10% on this curve. */
  costTo10: number | null;
  /** $ of buys needed to reach the swing high (0 when already above). */
  costToHigh: number | null;
  /** Net 5-min buying ÷ costToHigh. */
  coverage: number | null;
  /** Share of window volume that traded above the current price. */
  overheadShare: number | null;
  distributionFlags: string[];
  windowHours: number;
}

export interface DiscoveryInput {
  now: number;
  price: number | null;
  /** 5-minute candles, oldest first, with volUsd. */
  structure: Candle[];
  /** 1-minute candles, oldest first, with buy/sell volume. */
  minute: Candle[];
  quoteReserveUsd: number | null;
  buyUsd5m: number;
  sellUsd5m: number;
  buyers5m: number;
  sellers5m: number;
  /** Largest single wallet's share of 5-min sell volume. */
  topSellerShare: number | null;
  /** 1 Hz series, oldest first. */
  cvdSeries: number[];
  priceSeries: number[];
  events: WickEvent[];
}

export const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

const WEIGHTS: Record<Check['id'], number> = { asks: 0.2, reach: 0.2, overhead: 0.15, vwap: 0.15, fib: 0.1, distribution: 0.2 };

/** VWAP over candles: Σ$ / Σ(base), with base ≈ $ / typical price. */
export function vwapOf(candles: Candle[]): number | null {
  let usd = 0;
  let base = 0;
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3;
    if (!(c.volUsd > 0) || !(tp > 0)) continue;
    usd += c.volUsd;
    base += c.volUsd / tp;
  }
  return base > 0 ? usd / base : null;
}

/** Share of traded $ whose candle traded entirely or partly above `price` (pro-rata by range). */
export function overheadShareOf(candles: Candle[], price: number): number | null {
  let above = 0;
  let total = 0;
  for (const c of candles) {
    if (!(c.volUsd > 0)) continue;
    total += c.volUsd;
    if (c.l >= price) above += c.volUsd;
    else if (c.h > price) above += (c.volUsd * (c.h - price)) / (c.h - c.l || 1);
  }
  return total > 0 ? above / total : null;
}

export function assessDiscovery(x: DiscoveryInput): Discovery {
  const s = x.structure.filter((c) => [c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0));
  const empty: Discovery = {
    ready: false,
    stage: 'NO_DATA',
    score: 0,
    passed: 0,
    known: 0,
    checks: [],
    swingHigh: null,
    swingLow: null,
    vwap: null,
    fib: [],
    fibPosition: null,
    nextTarget: null,
    costTo10: null,
    costToHigh: null,
    coverage: null,
    overheadShare: null,
    distributionFlags: [],
    windowHours: 0,
  };
  const p = x.price;
  if (p === null || s.length < 6) return empty;

  // Swing range: everything but the latest 15 minutes, so a fresh breakout registers as "above the high".
  const prior = s.length > 4 ? s.slice(0, -3) : s;
  const swingHigh = Math.max(...prior.map((c) => c.h));
  const swingLow = Math.min(...prior.map((c) => c.l));
  const range = swingHigh - swingLow;
  const fib = range > 0 ? FIB_RATIOS.map((r) => ({ ratio: r, price: swingLow + r * range })) : [];
  const fibPosition = range > 0 ? (p - swingLow) / range : null;
  const vwap = vwapOf(s);
  const overheadShare = overheadShareOf(s, p);
  const qr = x.quoteReserveUsd;
  const costTo10 = qr ? usdToMoveUp(qr, 0.1) : null;
  const above = p >= swingHigh;
  const costToHigh = qr ? (above ? 0 : usdToMoveUp(qr, swingHigh / p - 1)) : null;
  const net = x.buyUsd5m - x.sellUsd5m;
  const coverage = costToHigh === null ? null : costToHigh === 0 ? Infinity : Math.max(0, net) / costToHigh;
  const windowHours = (s[s.length - 1].t - s[0].t) / 3_600_000 + 5 / 60;
  const hrs = windowHours >= 1 ? `${windowHours.toFixed(0)}h` : `${Math.round(windowHours * 60)}m`;

  const checks: Check[] = [];

  // 1. Thin sell side on the curve, relative to the buying that's actually happening.
  checks.push(
    costTo10 === null
      ? { id: 'asks', label: 'Thin sell side', pass: null, detail: 'No liquidity reading yet.' }
      : {
          id: 'asks',
          label: 'Thin sell side',
          pass: x.buyUsd5m >= 0.5 * costTo10,
          detail: `${fmtUsd(costTo10)} of buys moves it +10%; the last 5 min saw ${fmtUsd(x.buyUsd5m)} of buying.`,
        },
  );

  // 2. Can current buy pressure reach (or already clear) the high?
  checks.push(
    costToHigh === null
      ? { id: 'reach', label: 'Buyers can reach the high', pass: null, detail: 'No liquidity reading yet.' }
      : above
        ? { id: 'reach', label: 'Above the prior high', pass: true, detail: `Price is above the ${hrs} high of ${fmtPx(swingHigh)}.` }
        : {
            id: 'reach',
            label: 'Buyers can reach the high',
            pass: (coverage ?? 0) >= 0.5,
            detail: `${fmtUsd(costToHigh)} of net buying gets it to the ${hrs} high (${fmtPx(swingHigh)}); the last 5 min netted ${fmtUsd(net)}.`,
          },
  );

  // 3. Overhead supply: volume that traded above here = holders who may sell into a rally.
  checks.push(
    overheadShare === null
      ? { id: 'overhead', label: 'Little overhead supply', pass: null, detail: 'No volume history yet.' }
      : {
          id: 'overhead',
          label: 'Little overhead supply',
          pass: overheadShare <= 0.15,
          detail: `${(overheadShare * 100).toFixed(0)}% of the last ${hrs} of volume traded above this price${overheadShare <= 0.15 ? ' — few bag-holders waiting to sell' : ' — that supply can sell into a pump'}.`,
        },
  );

  // 4. VWAP.
  checks.push(
    vwap === null
      ? { id: 'vwap', label: 'Above VWAP', pass: null, detail: 'No volume history yet.' }
      : { id: 'vwap', label: 'Above VWAP', pass: p > vwap, detail: `Price is ${fmtPct(p / vwap - 1)} vs the ${hrs} VWAP (${fmtPx(vwap)}).` },
  );

  // 5. Fibonacci structure.
  let nextTarget: Discovery['nextTarget'] = null;
  if (fibPosition === null) checks.push({ id: 'fib', label: 'Fib structure', pass: null, detail: 'No swing range yet.' });
  else {
    const next = fib.find((f) => f.price > p * 1.001);
    nextTarget = next ? { label: next.ratio === 1 ? 'prior high' : `${next.ratio} ${next.ratio > 1 ? 'extension' : 'retracement'}`, price: next.price } : null;
    const golden = fib.find((f) => f.ratio === 0.618)!;
    checks.push({
      id: 'fib',
      label: 'Fib structure',
      pass: fibPosition >= 0.618,
      detail:
        fibPosition > 1
          ? `Above the swing high${next ? ` — next extension ${next.ratio} at ${fmtPx(next.price)}` : ''}.`
          : fibPosition >= 0.618
            ? `Holding above the 0.618 retracement (${fmtPx(golden.price)})${next ? `; next level ${fmtPx(next.price)}` : ''}.`
            : `Below the 0.618 retracement (${fmtPx(golden.price)}) — structure still weak.`,
    });
  }

  // 6. Distribution: is someone quietly selling into the buying?
  const flags: string[] = [];
  const recent = (ms: number) => x.events.filter((e) => x.now - e.ts <= ms);
  const whaleSells = recent(15 * 60_000).filter((e) => e.kind === 'WHALE_SELL').length;
  if (whaleSells) flags.push(`${whaleSells} whale sell${whaleSells > 1 ? 's' : ''} in 15 min`);
  if (x.topSellerShare !== null && x.topSellerShare >= 0.4 && x.sellUsd5m > 0) flags.push(`one wallet is ${(x.topSellerShare * 100).toFixed(0)}% of selling`);
  const greens = x.minute.slice(-16, -1).filter((c) => c.c > c.o && c.buyVol + c.sellVol > 0);
  if (greens.length >= 3) {
    const sv = greens.reduce((a, c) => a + c.sellVol, 0);
    const tv = greens.reduce((a, c) => a + c.buyVol + c.sellVol, 0);
    if (tv > 0 && sv / tv >= 0.45) flags.push(`sellers are ${((sv / tv) * 100).toFixed(0)}% of volume on green candles`);
  }
  const lookback = 600;
  if (x.cvdSeries.length > lookback && x.priceSeries.length > lookback) {
    const dP = x.priceSeries[x.priceSeries.length - 1] / x.priceSeries[x.priceSeries.length - 1 - lookback] - 1;
    const dC = x.cvdSeries[x.cvdSeries.length - 1] - x.cvdSeries[x.cvdSeries.length - 1 - lookback];
    if (dP > 0.01 && dC < 0) flags.push('price up while CVD falls (bearish divergence)');
  }
  if (recent(30 * 60_000).some((e) => e.kind === 'LIQUIDITY_PULLED')) flags.push('LP pulled in the last 30 min');
  if (x.sellers5m >= 6 && x.sellers5m > 1.5 * Math.max(1, x.buyers5m)) flags.push(`${x.sellers5m} sellers vs ${x.buyers5m} buyers`);
  checks.push({
    id: 'distribution',
    label: 'No hidden distribution',
    pass: flags.length === 0,
    detail: flags.length === 0 ? 'No whale sells, no single dumping wallet, sellers not unloading into green candles, LP intact.' : `Watch out: ${flags.join('; ')}.`,
  });

  const known = checks.filter((c) => c.pass !== null);
  const passed = known.filter((c) => c.pass).length;
  const wsum = known.reduce((a, c) => a + WEIGHTS[c.id], 0);
  const score = wsum > 0 ? known.reduce((a, c) => a + WEIGHTS[c.id] * (c.pass ? 1 : -1), 0) / wsum : 0;
  const distClean = flags.length === 0;

  let stage: DiscoveryStage;
  if (flags.length >= 2) stage = 'DISTRIBUTION';
  else if (above && distClean && x.buyUsd5m > x.sellUsd5m) stage = 'DISCOVERY';
  else if (known.length >= 4 && passed >= known.length - 1 && distClean) stage = 'LOADING';
  else if (passed >= Math.ceil(known.length / 2)) stage = 'BUILDING';
  else stage = 'NEUTRAL';

  return {
    ready: true,
    stage,
    score,
    passed,
    known: known.length,
    checks,
    swingHigh,
    swingLow,
    vwap,
    fib,
    fibPosition,
    nextTarget,
    costTo10,
    costToHigh,
    coverage,
    overheadShare,
    distributionFlags: flags,
    windowHours,
  };
}
