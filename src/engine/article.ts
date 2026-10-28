import { fmtPct, fmtPx, fmtUsd } from './copy';
import type { Check, DiscoveryStage } from './discovery';
import type { EngineSnapshot } from './poolEngine';
import type { EventKind } from './types';

export type Tone = 'up' | 'down' | 'hazy' | 'warn';

export interface Article {
  /** Changes when the verdict changes (the UI animates on it). */
  key: string;
  title: string;
  subtitle: string;
  /** The read / prediction — short, never certain. */
  verdict: string;
  tone: Tone;
  /** 1–3 plain-English sentences built only from measured values. */
  lede: string;
  /** A fresh alert, shown as a hatnote above the read. */
  hatnote: string | null;
  checks: Check[];
  infobox: { label: string; value: string }[];
  citations: string[];
}

const STAGE: Record<DiscoveryStage, { verdict: string; tone: Tone }> = {
  DISCOVERY: { verdict: 'In price discovery', tone: 'up' },
  LOADING: { verdict: 'Price discovery loading', tone: 'up' },
  BUILDING: { verdict: 'Building toward the high', tone: 'hazy' },
  NEUTRAL: { verdict: 'No discovery setup', tone: 'hazy' },
  DISTRIBUTION: { verdict: 'Distribution risk', tone: 'down' },
  NO_DATA: { verdict: 'Not enough data yet', tone: 'hazy' },
};

const HATNOTES: Partial<Record<EventKind, string>> = {
  LIQUIDITY_PULLED: 'Liquidity just vanished',
  FLOOR_FORMING: 'A floor is forming',
  CEILING_FORMING: 'A ceiling is forming',
  WHALE_SELL: 'A whale just sold',
  WHALE_BUY: 'A whale just bought',
  BREAKOUT_CONFIRMED: 'Breakout confirmed',
  FALSE_ALARM: 'False alarm — fakeout',
  GRADUATION_LOADING: 'Graduation loading',
  GRADUATED: 'Graduated to an AMM pool',
  ONE_WALLET: 'One wallet dominates the flow',
};

const ago = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s ago` : `${Math.round(ms / 60_000)} min ago`);

export function writeArticle(s: EngineSnapshot): Article {
  const m = s.market;
  const title = `$${m.symbol}`;
  const subtitle = `${m.name ? `${m.name} · ` : ''}${m.venue} · ${m.chain === 'robinhood' ? 'Robinhood Chain' : m.chain === 'arbitrum' ? 'Arbitrum One' : 'Solana'}`;
  const citations = [
    `${s.health.source}${s.health.mode === 'poll' ? `, polled every ~${Math.round((s.health.pollMs ?? 6000) / 1000)}s` : ', real-time'}${s.health.lastMessageAt ? `; last update ${ago(s.now - s.health.lastMessageAt)}` : ''}.`,
    'Price impact from constant-product (x·y=k) math on reported reserves; exact on bonding curves.',
    'Thresholds are documented heuristics, not predictions. Not financial advice.',
  ];

  if (!s.valid) {
    return {
      key: 'nodata',
      title,
      subtitle,
      verdict: 'Cannot say right now',
      tone: 'hazy',
      lede: `${s.invalidReason ?? 'No data'}. No data, no read — Wickipedia doesn't guess.`,
      hatnote: null,
      checks: [],
      infobox: [],
      citations,
    };
  }

  const d = s.discovery;
  const fresh = [...s.events].reverse().find((e) => s.now - e.ts < 60_000 && HATNOTES[e.kind]);
  const hatnote = fresh ? `${HATNOTES[fresh.kind]} (${ago(s.now - fresh.ts)}): ${fresh.body}` : null;

  if (!d.ready) {
    return {
      key: 'warm',
      title,
      subtitle,
      verdict: 'Ask again later',
      tone: 'hazy',
      lede: `Still collecting chart history and flow for ${title} — need at least 30 minutes of candles to place VWAP, Fibonacci levels and overhead supply.`,
      hatnote,
      checks: [],
      infobox: s.price ? [{ label: 'Price', value: fmtPx(s.price) }] : [],
      citations,
    };
  }

  const { verdict, tone } = STAGE[d.stage];
  const p = s.price!;
  const parts: string[] = [];
  parts.push(
    `${title} trades at ${fmtPx(p)}${d.vwap ? `, ${fmtPct(p / d.vwap - 1)} vs VWAP` : ''}${
      d.swingHigh ? (p >= d.swingHigh ? ', above its recent high' : `, ${((d.swingHigh / p - 1) * 100).toFixed(1)}% below its recent high`) : ''
    }.`,
  );
  if (d.costTo10 !== null) {
    parts.push(
      `The sell side is ${s.flow.buyUsdLong >= 0.5 * d.costTo10 ? 'thin' : 'deep relative to the buying'}: ${fmtUsd(d.costTo10)} of buys moves it +10%, against ${fmtUsd(
        s.flow.buyUsdLong,
      )} bought in the last 5 minutes.`,
    );
  }
  if (d.overheadShare !== null) {
    parts.push(
      d.distributionFlags.length
        ? `${(d.overheadShare * 100).toFixed(0)}% of recent volume sits above the price, and there are distribution signals: ${d.distributionFlags.join('; ')}.`
        : `${(d.overheadShare * 100).toFixed(0)}% of recent volume sits above the price, and no distribution signals are showing.`,
    );
  }

  const infobox: Article['infobox'] = [{ label: 'Price', value: fmtPx(p) }];
  if (d.vwap) infobox.push({ label: 'VWAP', value: fmtPx(d.vwap) });
  if (d.swingHigh) infobox.push({ label: 'Recent high', value: fmtPx(d.swingHigh) });
  const golden = d.fib.find((f) => f.ratio === 0.618);
  if (golden) infobox.push({ label: 'Fib 0.618', value: fmtPx(golden.price) });
  if (d.nextTarget) infobox.push({ label: `Next: ${d.nextTarget.label}`, value: fmtPx(d.nextTarget.price) });
  if (d.costToHigh !== null && d.costToHigh > 0) infobox.push({ label: '$ to the high', value: fmtUsd(d.costToHigh) });
  if (s.pool?.curve && !s.pool.curve.graduated) infobox.push({ label: 'Bonding curve', value: `${(s.pool.curve.progress * 100).toFixed(1)}%` });
  else if (s.pool?.liquidityUsd) infobox.push({ label: 'Liquidity', value: fmtUsd(s.pool.liquidityUsd) });

  return {
    key: `${d.stage}`,
    title,
    subtitle,
    verdict,
    tone,
    lede: parts.join(' '),
    hatnote,
    checks: d.checks,
    infobox,
    citations,
  };
}
