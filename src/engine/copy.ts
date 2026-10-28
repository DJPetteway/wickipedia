import type { Direction, EventKind, Severity, WickEvent } from './types';

/**
 * Alert copywriting. Every function here takes *observed* numbers and turns
 * them into a headline + plain-English body. Nothing is emitted unless the
 * engine detected the condition; these are just the words.
 */

let seq = 0;
const nextId = (ts: number) => `${ts.toString(36)}-${(seq++).toString(36)}`;

export const fmtUsd = (x: number): string => {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
};

export const fmtPx = (x: number): string => {
  if (!Number.isFinite(x)) return '—';
  if (x >= 1000) return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x >= 1) return x.toFixed(4);
  return x.toPrecision(5);
};

export const fmtBps = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(1)} bps`;

function ev(
  ts: number,
  kind: EventKind,
  severity: Severity,
  title: string,
  body: string,
  evidence: WickEvent['evidence'],
  direction?: Direction,
  lesson?: string,
): WickEvent {
  return { id: nextId(ts), ts, kind, severity, title, body, evidence, direction, lesson };
}

export const LESSONS = {
  wallEaten:
    'When resting size disappears *because it traded*, real buyers/sellers took it. Price tends to move into the space the wall used to guard.',
  wallVanished:
    'Big orders that vanish without trading were pulled, not filled. Could be a spoof, could be a trader repositioning — it removes friction but proves nothing.',
  floor:
    'Absorption: aggressive sellers keep hitting the bid, but price barely moves because someone keeps refilling it. On a candle this often prints as a long lower wick.',
  ceiling:
    'Absorption from above: buyers keep lifting the offer and price won\'t go. On a candle that tends to print a long upper wick — a rejection.',
  stacking:
    'Depth piling up on one side changes how much it costs to push price through it. Stacked bids under price = a cushion. Stacked asks overhead = a lid.',
  coiling:
    'Volatility compression: the range tightens while one side keeps leaning on it. Compression doesn\'t say which way — the order flow is the tell.',
  breakout: 'A breakout is only "confirmed" here when price clears the level *and* aggressive flow agrees.',
  failed: 'A move through a level that snaps right back leaves a wick. That\'s the market rejecting the price — a classic fakeout.',
};

export const copy = {
  wallSpotted(ts: number, side: 'bid' | 'ask', price: number, notional: number, multiple: number, distanceBps: number): WickEvent {
    return ev(
      ts,
      'WALL_SPOTTED',
      'info',
      side === 'ask' ? 'WALL UP: Ask liquidity stacked overhead' : 'WALL DOWN: Bid liquidity parked below',
      `${fmtUsd(notional)} resting at ${fmtPx(price)} (${multiple.toFixed(1)}× a typical level, ${distanceBps.toFixed(1)} bps away).`,
      { price, notional, multiple, distanceBps },
      side === 'ask' ? 'down' : 'up',
    );
  },

  wallEaten(ts: number, side: 'bid' | 'ask', price: number, tradedNotional: number, eatenPct: number): WickEvent {
    return ev(
      ts,
      'WALL_EATEN',
      'alert',
      side === 'ask' ? 'THE WALL IS GETTING EATEN' : 'THE FLOOR IS GETTING EATEN',
      side === 'ask'
        ? `Aggressive buyers consumed ${eatenPct.toFixed(0)}% of the ask wall at ${fmtPx(price)} (${fmtUsd(tradedNotional)} traded into it).`
        : `Aggressive sellers consumed ${eatenPct.toFixed(0)}% of the bid wall at ${fmtPx(price)} (${fmtUsd(tradedNotional)} traded into it).`,
      { price, tradedNotional, eatenPct },
      side === 'ask' ? 'up' : 'down',
      LESSONS.wallEaten,
    );
  },

  wallVanished(ts: number, side: 'bid' | 'ask', price: number, droppedNotional: number, tradedPct: number): WickEvent {
    return ev(
      ts,
      'WALL_VANISHED',
      'notice',
      'LIQUIDITY JUST VANISHED',
      `${side === 'ask' ? 'An ask' : 'A bid'} wall of ${fmtUsd(droppedNotional)} at ${fmtPx(price)} was pulled with only ${tradedPct.toFixed(
        0,
      )}% of it trading. This may be a liquidity withdrawal, not proof of a breakout.`,
      { price, droppedNotional, tradedPct },
      side === 'ask' ? 'up' : 'down',
      LESSONS.wallVanished,
    );
  },

  floor(ts: number, level: number, sellNotional: number, moveBps: number, flowZ: number, depthRetention: number): WickEvent {
    return ev(
      ts,
      'FLOOR_FORMING',
      'alert',
      'FLOOR FORMING: Sellers are getting absorbed',
      `${fmtUsd(sellNotional)} of market sells hit the bid (${flowZ.toFixed(1)}σ above normal) and price moved only ${fmtBps(
        moveBps,
      )}. Bids held at ${(depthRetention * 100).toFixed(0)}% of their depth. Floor ≈ ${fmtPx(level)}.`,
      { level, sellNotional, moveBps, flowZ, depthRetention },
      'up',
      LESSONS.floor,
    );
  },

  ceiling(ts: number, level: number, buyNotional: number, moveBps: number, flowZ: number, depthRetention: number): WickEvent {
    return ev(
      ts,
      'CEILING_FORMING',
      'alert',
      'CEILING FORMING: Buyers are getting absorbed',
      `${fmtUsd(buyNotional)} of market buys lifted the offer (${flowZ.toFixed(1)}σ above normal) and price moved only ${fmtBps(
        moveBps,
      )}. Asks held at ${(depthRetention * 100).toFixed(0)}% of their depth. Ceiling ≈ ${fmtPx(level)}.`,
      { level, buyNotional, moveBps, flowZ, depthRetention },
      'down',
      LESSONS.ceiling,
    );
  },

  stacking(ts: number, side: 'bid' | 'ask', growthPct: number, imbalance: number, moveBps: number): WickEvent {
    return side === 'bid'
      ? ev(
          ts,
          'BIDS_STACKING',
          'notice',
          'BIDS ARE STACKING',
          `Bid depth near the touch grew ${growthPct.toFixed(0)}% while aggressive selling failed to push price lower (${fmtBps(
            moveBps,
          )}). Imbalance ${(imbalance * 100).toFixed(0)}% bid-heavy.`,
          { growthPct, imbalance, moveBps },
          'up',
          LESSONS.stacking,
        )
      : ev(
          ts,
          'ASKS_STACKING',
          'notice',
          'ASKS ARE STACKING',
          `Ask depth near the touch grew ${growthPct.toFixed(0)}% while aggressive buying failed to push price higher (${fmtBps(
            moveBps,
          )}). Imbalance ${(Math.abs(imbalance) * 100).toFixed(0)}% ask-heavy.`,
          { growthPct, imbalance, moveBps },
          'down',
          LESSONS.stacking,
        );
  },

  watching(ts: number, dir: Direction, reason: string, nearEdge: boolean, score: number): WickEvent {
    if (nearEdge) {
      return dir === 'up'
        ? ev(ts, 'COOKING', 'notice', 'WICKIPEDIA IS COOKING', `Buy-side pressure is building near resistance. ${reason}`, { score }, dir)
        : ev(ts, 'COOKING', 'notice', 'SOMETHING IS BURNING', `Sell-side pressure is building near support. ${reason}`, { score }, dir);
    }
    return ev(ts, 'STATE_CHANGE', 'info', `WATCHING ${dir === 'up' ? '↑' : '↓'}`, reason, { score }, dir);
  },

  coiling(ts: number, dir: Direction, reason: string, trigger: number | null, invalidation: number | null): WickEvent {
    return ev(
      ts,
      'WICK_LOADING',
      'notice',
      dir === 'up' ? 'WICK LOADING… ↑' : 'WICK LOADING… ↓',
      `Compression and directional order flow suggest an emerging setup. ${reason}`,
      { trigger, invalidation },
      dir,
      LESSONS.coiling,
    );
  },

  imminent(ts: number, dir: Direction, reason: string, trigger: number | null, invalidation: number | null): WickEvent {
    return ev(
      ts,
      'IMMINENT',
      'alert',
      dir === 'up' ? 'BREAKOUT LOADING ↑' : 'BREAKDOWN LOADING ↓',
      `${reason} Trigger ${trigger !== null ? fmtPx(trigger) : '—'}, invalidation ${invalidation !== null ? fmtPx(invalidation) : '—'}.`,
      { trigger, invalidation },
      dir,
    );
  },

  breakout(ts: number, dir: Direction, reason: string, trigger: number | null): WickEvent {
    return ev(
      ts,
      'BREAKOUT_CONFIRMED',
      'alert',
      dir === 'up' ? 'BREAKOUT CONFIRMED ↑' : 'BREAKDOWN CONFIRMED ↓',
      `Price crossed the configured trigger level with supporting confirmation. ${reason}`,
      { trigger },
      dir,
      LESSONS.breakout,
    );
  },

  failed(ts: number, dir: Direction | null, reason: string): WickEvent {
    return ev(ts, 'FALSE_ALARM', 'notice', 'FALSE ALARM', `The setup invalidated before confirmation. ${reason}`, {}, dir ?? undefined, LESSONS.failed);
  },

  state(ts: number, title: string, reason: string): WickEvent {
    return ev(ts, 'STATE_CHANGE', 'info', title, reason, {});
  },

  feed(ts: number, title: string, body: string, severity: Severity = 'notice'): WickEvent {
    return ev(ts, 'FEED', severity, title, body, {});
  },
};
