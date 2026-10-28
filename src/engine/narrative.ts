import { anatomy, type Candle } from './candles';
import { fmtPct, fmtPx, fmtUsd, shortAddr } from './copy';
import type { EngineSnapshot } from './poolEngine';

export type Tone = 'bull' | 'bear' | 'neutral' | 'warn';

export interface Read {
  id: string;
  tone: Tone;
  /** Maps to a Wick School lesson. */
  concept: 'flow' | 'liquidity' | 'absorption' | 'whales' | 'wallets' | 'curve' | 'compression' | 'wick' | 'floors' | 'data';
  text: string;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** What does a finished candle's shape say, given the flow that built it? */
export function explainCandle(c: Candle): { tone: Tone; text: string } | null {
  const a = anatomy(c);
  if (a.range <= 0) return null;
  const flowKnown = c.buyVol + c.sellVol > 0;
  const sellHeavy = flowKnown && c.sellVol > c.buyVol * 1.2;
  const buyHeavy = flowKnown && c.buyVol > c.sellVol * 1.2;
  if (a.lowerFrac >= 0.5) {
    return {
      tone: 'bull',
      text: `Last candle: ${pct(a.lowerFrac)} lower wick. Price dipped and got bought back${
        sellHeavy ? " even though sells outweighed buys — that's absorption, the classic floor tell" : ''
      }. Lower wicks = rejection of lower prices.`,
    };
  }
  if (a.upperFrac >= 0.5) {
    return {
      tone: 'bear',
      text: `Last candle: ${pct(a.upperFrac)} upper wick. Price poked up and got sold back down${
        buyHeavy ? ' despite heavier buying — buyers got absorbed overhead' : ''
      }. Upper wicks = rejection of higher prices.`,
    };
  }
  if (a.bodyFrac >= 0.7) {
    return {
      tone: a.bullish ? 'bull' : 'bear',
      text: `Last candle: ${pct(a.bodyFrac)} body, barely any wick. ${a.bullish ? 'Buyers' : 'Sellers'} controlled the whole minute — no rejection either way.`,
    };
  }
  return { tone: 'neutral', text: 'Last candle: mixed body and wicks — nobody won the minute decisively.' };
}

/** Turns the snapshot into plain-English observations. Every sentence restates a measured number. */
export function narrate(s: EngineSnapshot): Read[] {
  const out: Read[] = [];
  if (!s.valid) {
    out.push({ id: 'data', tone: 'warn', concept: 'data', text: `${s.invalidReason ?? 'No data'}. No data, no read — Wickipedia doesn't guess.` });
    return out;
  }
  if (!s.warmup.ready) {
    out.push({
      id: 'warmup',
      tone: 'neutral',
      concept: 'data',
      text: `Learning what "normal" looks like for ${s.market.symbol}: ${s.warmup.have}/${s.warmup.need}s of baseline. Signals unlock after that.`,
    });
  }

  const f = s.flow;
  const tot = f.buyUsdLong + f.sellUsdLong;
  if (tot > 0) {
    const d = f.deltaLong;
    const who = f.buyersLong + f.sellersLong > 0 ? ` from ${f.buyersLong} buyers / ${f.sellersLong} sellers` : '';
    out.push({
      id: 'flow',
      tone: d > 0.15 ? 'bull' : d < -0.15 ? 'bear' : 'neutral',
      concept: 'flow',
      text: `Last 5 min: ${fmtUsd(f.buyUsdLong)} bought vs ${fmtUsd(f.sellUsdLong)} sold${who} — ${
        d > 0.15 ? 'buyers are in control' : d < -0.15 ? 'sellers are in control' : 'roughly even'
      }.`,
    });
    if (f.netImpactLong !== null) {
      out.push({
        id: 'netimpact',
        tone: f.netImpactLong > 0.01 ? 'bull' : f.netImpactLong < -0.01 ? 'bear' : 'neutral',
        concept: 'liquidity',
        text: `That net ${fmtUsd(f.buyUsdLong - f.sellUsdLong)} is worth about ${fmtPct(f.netImpactLong)} of price on this ${
          s.impactExact ? 'bonding curve' : 'pool'
        }.`,
      });
    }
  } else {
    out.push({ id: 'flow', tone: 'neutral', concept: 'flow', text: 'No swaps in the last 5 min. Dead tape.' });
  }

  const five = s.impact.find((r) => r.pct === 0.05);
  if (five && s.pool) {
    const liq = s.pool.liquidityUsd;
    out.push({
      id: 'liq',
      tone: 'neutral',
      concept: 'liquidity',
      text: `${liq ? `Pool holds ${fmtUsd(liq)}. ` : ''}${fmtUsd(five.upUsd)} of buys pumps it +5%; ${fmtUsd(five.downUsd)} of sells dumps it −5%${
        s.pool.model === 'CONCENTRATED' ? ' (rough — concentrated liquidity can be deeper or thinner near price)' : s.impactExact ? ' (exact, from the curve)' : ''
      }.`,
    });
  }

  if (s.pool?.curve && !s.pool.curve.graduated) {
    const c = s.pool.curve;
    out.push({
      id: 'curve',
      tone: c.progress >= 0.75 ? 'warn' : 'neutral',
      concept: 'curve',
      text: `Bonding curve ${(c.progress * 100).toFixed(1)}% full — ~${c.solToGraduate.toFixed(1)} SOL of net buys until it graduates to an AMM.`,
    });
  }

  const recent = s.events.filter((e) => s.now - e.ts < 5 * 60_000);
  const last = (k: string) => [...recent].reverse().find((e) => e.kind === k);
  const floor = last('FLOOR_FORMING');
  const ceiling = last('CEILING_FORMING');
  const pulled = last('LIQUIDITY_PULLED');
  if (floor) out.push({ id: 'floor', tone: 'bull', concept: 'absorption', text: floor.body });
  if (ceiling) out.push({ id: 'ceil', tone: 'bear', concept: 'absorption', text: ceiling.body });
  if (pulled) out.push({ id: 'pull', tone: 'warn', concept: 'liquidity', text: pulled.body });

  const top = s.wallets[0];
  if (top && top.share >= 0.35 && s.wallets.length > 1) {
    out.push({
      id: 'wallet',
      tone: 'warn',
      concept: 'wallets',
      text: `${shortAddr(top.wallet)} is ${pct(top.share)} of all volume in 5 min (${fmtUsd(top.buyUsd)} in, ${fmtUsd(top.sellUsd)} out). Price action here is mostly one trader.`,
    });
  }

  const whale = s.whales[0];
  if (whale && s.now - whale.ts < 5 * 60_000) {
    out.push({
      id: 'whale',
      tone: whale.side === 'buy' ? 'bull' : 'bear',
      concept: 'whales',
      text: `Biggest recent print: a ${fmtUsd(whale.usd)} ${whale.side} at ${fmtPx(whale.priceUsd)}${whale.wallet ? ` by ${shortAddr(whale.wallet)}` : ''}.`,
    });
  }

  const comp = s.volatility.compression;
  if (comp !== null) {
    if (comp <= 0.75) out.push({ id: 'comp', tone: 'warn', concept: 'compression', text: `Volatility is ${pct(comp)} of its 15-min norm. The range is coiling.` });
    else if (comp >= 1.6) out.push({ id: 'comp', tone: 'warn', concept: 'compression', text: `Volatility is ${comp.toFixed(1)}× its 15-min norm. Wicks get long in this regime.` });
  }

  const closed = s.candles.length >= 2 ? s.candles[s.candles.length - 2] : null;
  if (closed) {
    const c = explainCandle(closed);
    if (c) out.push({ id: 'wick', concept: 'wick', ...c });
  }

  const fh = s.levelHolds.find((h) => h.kind === 'floor' && h.horizonSec === 900);
  if (fh && fh.held + fh.broken > 0) {
    out.push({
      id: 'holds',
      tone: 'neutral',
      concept: 'floors',
      text: `Floors spotted on this token held for 15 min ${fh.held}/${fh.held + fh.broken} times${fh.ready ? '' : ' (tiny sample — anecdote, not stats)'}.`,
    });
  }
  return out;
}
