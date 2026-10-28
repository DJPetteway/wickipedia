import { anatomy, type Candle } from './candles';
import { fmtPx, fmtUsd } from './copy';
import type { EngineSnapshot } from './engine';

export type Tone = 'bull' | 'bear' | 'neutral' | 'warn';

export interface Read {
  id: string;
  tone: Tone;
  /** Short tag that maps to a Wick School lesson. */
  concept: 'imbalance' | 'flow' | 'absorption' | 'walls' | 'compression' | 'wick' | 'floors' | 'data';
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
        sellHeavy ? ' even though market sells outnumbered buys — that\'s absorption, the classic floor tell' : ''
      }. Lower wicks = rejection of lower prices.`,
    };
  }
  if (a.upperFrac >= 0.5) {
    return {
      tone: 'bear',
      text: `Last candle: ${pct(a.upperFrac)} upper wick. Price poked up and got sold back down${
        buyHeavy ? ' despite heavier market buying — buyers got absorbed overhead' : ''
      }. Upper wicks = rejection of higher prices.`,
    };
  }
  if (a.bodyFrac >= 0.7) {
    return {
      tone: a.bullish ? 'bull' : 'bear',
      text: `Last candle: ${pct(a.bodyFrac)} body, barely any wick. ${
        a.bullish ? 'Buyers' : 'Sellers'
      } controlled the whole minute — no rejection either way.`,
    };
  }
  return { tone: 'neutral', text: 'Last candle: mixed body and wicks — nobody won the minute decisively.' };
}

/**
 * Turns the current snapshot into plain-English observations. Purely
 * descriptive: every sentence restates a number the engine measured.
 */
export function narrate(s: EngineSnapshot): Read[] {
  const out: Read[] = [];
  if (!s.valid) {
    out.push({ id: 'data', tone: 'warn', concept: 'data', text: `${s.invalidReason ?? 'No data'}. No book, no read — Wickipedia doesn't guess.` });
    return out;
  }
  if (!s.warmup.ready) {
    out.push({
      id: 'warmup',
      tone: 'neutral',
      concept: 'data',
      text: `Learning what "normal" looks like for ${s.symbol}: ${s.warmup.have}/${s.warmup.need}s of baseline collected. Signals unlock after that.`,
    });
  }

  const band = s.imbalance.find((b) => b.bandBps === 25) ?? s.imbalance[0];
  if (band) {
    const ratio = band.askQty > 0 && band.bidQty > 0 ? Math.max(band.bidQty / band.askQty, band.askQty / band.bidQty) : null;
    const span = `${(band.bandBps / 100).toFixed(2)}%`;
    if (Math.abs(band.value) < 0.15 || ratio === null) {
      out.push({ id: 'imb', tone: 'neutral', concept: 'imbalance', text: `Book is balanced within ${span} of price — no side is leaning.` });
    } else {
      const bids = band.value > 0;
      out.push({
        id: 'imb',
        tone: bids ? 'bull' : 'bear',
        concept: 'imbalance',
        text: `${bids ? 'Bids' : 'Asks'} outweigh ${bids ? 'asks' : 'bids'} ${ratio.toFixed(1)}:1 within ${span} of price — ${
          bids ? 'more cushion below than lid above' : 'more supply overhead than support below'
        }.`,
      });
    }
  }

  const f = s.flow;
  const tot = f.buyNotional60 + f.sellNotional60;
  if (tot > 0) {
    const d = f.delta60;
    out.push({
      id: 'flow',
      tone: d > 0.15 ? 'bull' : d < -0.15 ? 'bear' : 'neutral',
      concept: 'flow',
      text: `Last 60s: ${fmtUsd(f.buyNotional60)} market buys vs ${fmtUsd(f.sellNotional60)} market sells — ${
        d > 0.15 ? 'buyers are the aggressors' : d < -0.15 ? 'sellers are the aggressors' : 'aggression is roughly even'
      }.`,
    });
  } else {
    out.push({ id: 'flow', tone: 'neutral', concept: 'flow', text: 'No trades in the last 60s. Quiet tape.' });
  }

  const recent = s.events.filter((e) => s.now - e.ts < 120_000);
  const floor = [...recent].reverse().find((e) => e.kind === 'FLOOR_FORMING');
  const ceiling = [...recent].reverse().find((e) => e.kind === 'CEILING_FORMING');
  if (floor) out.push({ id: 'floor', tone: 'bull', concept: 'absorption', text: floor.body });
  if (ceiling) out.push({ id: 'ceil', tone: 'bear', concept: 'absorption', text: ceiling.body });

  const askWall = s.walls.find((w) => w.side === 'ask');
  const bidWall = s.walls.find((w) => w.side === 'bid');
  if (askWall || bidWall) {
    const parts: string[] = [];
    if (askWall) parts.push(`${fmtUsd(askWall.notional)} ask wall ${askWall.distanceBps.toFixed(0)} bps up at ${fmtPx(askWall.price)}`);
    if (bidWall) parts.push(`${fmtUsd(bidWall.notional)} bid wall ${bidWall.distanceBps.toFixed(0)} bps down at ${fmtPx(bidWall.price)}`);
    out.push({ id: 'walls', tone: 'neutral', concept: 'walls', text: `${parts.join('; ')}. Walls are friction, not destiny — they can be eaten or pulled.` });
  }

  const comp = s.volatility.compression;
  if (comp !== null) {
    if (comp <= 0.75) {
      out.push({ id: 'comp', tone: 'warn', concept: 'compression', text: `Volatility is ${pct(comp)} of its 10-min norm. The range is coiling — energy is being stored.` });
    } else if (comp >= 1.5) {
      out.push({ id: 'comp', tone: 'warn', concept: 'compression', text: `Volatility is running ${comp.toFixed(1)}× its 10-min norm. Wicks get long in this regime.` });
    }
  }

  const closed = s.candles.length >= 2 ? s.candles[s.candles.length - 2] : null;
  if (closed) {
    const c = explainCandle(closed);
    if (c) out.push({ id: 'wick', concept: 'wick', ...c });
  }

  const fh = s.levelHolds.find((h) => h.kind === 'floor' && h.horizonSec === 300);
  if (fh && fh.held + fh.broken > 0) {
    out.push({
      id: 'holds',
      tone: 'neutral',
      concept: 'floors',
      text: `Floors spotted on this pair held for 5 min ${fh.held}/${fh.held + fh.broken} times${fh.ready ? '' : ' (tiny sample — treat as anecdote)'}.`,
    });
  }
  return out;
}
