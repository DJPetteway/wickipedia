import { fmtPct, fmtUsd } from './copy';
import { narrate } from './narrative';
import type { EngineSnapshot } from './poolEngine';
import type { EventKind } from './types';

export type OracleTone = 'up' | 'down' | 'hazy' | 'warn';

export interface Oracle {
  /** Stable key — the UI animates when this changes. */
  key: string;
  /** Magic-8-ball style headline. Never claims certainty. */
  answer: string;
  tone: OracleTone;
  /** The measured evidence behind the answer, in plain English. */
  detail: string;
  /** Calibrated odds line, only when there is enough data to show one. */
  odds: string | null;
}

/** Recent alert kinds that take over the ball, newest first wins. */
const OVERRIDES: Partial<Record<EventKind, { answer: string; tone: OracleTone }>> = {
  LIQUIDITY_PULLED: { answer: 'LIQUIDITY VANISHED', tone: 'warn' },
  FLOOR_FORMING: { answer: 'FLOOR FORMING', tone: 'up' },
  CEILING_FORMING: { answer: 'CEILING FORMING', tone: 'down' },
  BREAKOUT_CONFIRMED: { answer: 'IT WENT', tone: 'up' },
  FALSE_ALARM: { answer: 'FAKEOUT', tone: 'warn' },
  GRADUATED: { answer: 'IT GRADUATED', tone: 'up' },
  GRADUATION_LOADING: { answer: 'ALMOST GRADUATED', tone: 'up' },
  WHALE_BUY: { answer: 'WHALE APED IN', tone: 'up' },
  WHALE_SELL: { answer: 'WHALE DUMPED', tone: 'down' },
  ONE_WALLET: { answer: 'JUST ONE WALLET', tone: 'warn' },
  BUYERS_STACKING: { answer: 'BIDS ARE STACKING', tone: 'up' },
  SELLERS_STACKING: { answer: 'EXITS ARE STACKING', tone: 'down' },
  IMMINENT: { answer: 'SIGNS POINT UP', tone: 'up' },
};

const HOLD_MS = 25_000;

/**
 * Turns the engine snapshot into one 8-ball answer. Everything it says is a
 * restatement of measured state; when data is missing it says so.
 */
export function consult(s: EngineSnapshot): Oracle {
  const odds = oddsLine(s);
  if (!s.valid) {
    return { key: 'nodata', answer: 'CANNOT SAY NOW', tone: 'hazy', detail: `${s.invalidReason ?? 'No data'}. No data, no answer.`, odds: null };
  }

  // A fresh alert-level event takes over the ball for a short while.
  const recent = [...s.events].reverse().find((e) => s.now - e.ts < HOLD_MS && OVERRIDES[e.kind]);
  if (recent) {
    const o = OVERRIDES[recent.kind]!;
    const tone = o.tone === 'up' && recent.direction === 'down' ? 'down' : o.tone;
    const answer = recent.kind === 'IMMINENT' && recent.direction === 'down' ? 'SIGNS POINT DOWN' : recent.kind === 'BREAKOUT_CONFIRMED' && recent.direction === 'down' ? 'IT BROKE DOWN' : o.answer;
    return { key: `ev:${recent.id}`, answer, tone, detail: recent.body, odds };
  }

  if (!s.warmup.ready) {
    return {
      key: 'warmup',
      answer: 'ASK AGAIN LATER',
      tone: 'hazy',
      detail: `Learning what normal looks like for $${s.market.symbol} — ${s.warmup.have}/${s.warmup.need}s.`,
      odds: null,
    };
  }

  const st = s.setup;
  const up = st.direction === 'up';
  const f = s.flow;
  const flowLine =
    f.buyUsdLong + f.sellUsdLong > 0
      ? `5 min: ${fmtUsd(f.buyUsdLong)} in vs ${fmtUsd(f.sellUsdLong)} out from ${f.buyersLong} buyers / ${f.sellersLong} sellers${
          f.netImpactLong !== null ? ` (≈${fmtPct(f.netImpactLong)} of price)` : ''
        }.`
      : 'No swaps in the last 5 minutes. Dead tape.';

  switch (st.state) {
    case 'BREAKOUT':
      return { key: `st:${st.state}:${st.direction}`, answer: up ? 'IT WENT' : 'IT BROKE DOWN', tone: up ? 'up' : 'down', detail: st.reason, odds };
    case 'IMMINENT':
      return { key: `st:${st.state}:${st.direction}`, answer: up ? 'SIGNS POINT UP' : 'SIGNS POINT DOWN', tone: up ? 'up' : 'down', detail: st.reason, odds };
    case 'COILING':
      return { key: `st:${st.state}:${st.direction}`, answer: 'WICK LOADING…', tone: up ? 'up' : 'down', detail: st.reason, odds };
    case 'WATCHING':
      return { key: `st:${st.state}:${st.direction}`, answer: up ? 'OUTLOOK GOOD' : 'OUTLOOK NOT SO GOOD', tone: up ? 'up' : 'down', detail: flowLine, odds };
    case 'FAILED':
      return { key: 'st:FAILED', answer: "DON'T COUNT ON IT", tone: 'warn', detail: st.reason, odds };
    case 'COOLDOWN':
      return { key: 'st:COOLDOWN', answer: 'ASK AGAIN SOON', tone: 'hazy', detail: 'The last setup played out. Reading fresh.', odds };
  }

  // NEUTRAL: describe the lean, if any, without promising anything.
  const top = narrate(s).find((r) => r.concept !== 'data' && r.concept !== 'wick');
  if (Math.abs(s.score) < 0.12) return { key: 'hazy', answer: 'REPLY HAZY', tone: 'hazy', detail: top?.text ?? flowLine, odds };
  return {
    key: s.score > 0 ? 'lean:up' : 'lean:down',
    answer: s.score > 0 ? 'BUYERS NUDGING' : 'SELLERS NUDGING',
    tone: s.score > 0 ? 'up' : 'down',
    detail: flowLine,
    odds,
  };
}

function oddsLine(s: EngineSnapshot): string | null {
  const e = s.estimates.find((x) => x.horizonSec === 900 && x.ready) ?? s.estimates.find((x) => x.ready);
  if (!e) return null;
  const h = e.horizonSec >= 3600 ? `${e.horizonSec / 3600}h` : `${e.horizonSec / 60}m`;
  return `Past readings like this, next ${h}: ▲ ${(e.up.p * 100).toFixed(0)}% · ▼ ${(e.down.p * 100).toFixed(0)}% · n=${e.n}`;
}
