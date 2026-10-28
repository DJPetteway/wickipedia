import type { Direction, EventKind, Severity, WickEvent } from './types';

/**
 * Alert copywriting. Every function takes *observed* numbers and turns them
 * into a headline + plain-English body. Nothing is emitted unless the engine
 * detected the condition; these are just the words.
 */

let seq = 0;
const nextId = (ts: number) => `${ts.toString(36)}-${(seq++).toString(36)}`;

export const fmtUsd = (x: number): string => {
  const a = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 10) return `${sign}$${a.toFixed(0)}`;
  return `${sign}$${a.toFixed(2)}`;
};

/** Memecoin-friendly price: 0.0₅1234 style for tiny prices. */
export const fmtPx = (x: number | null | undefined): string => {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (x >= 1000) return `$${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (x >= 1) return `$${x.toFixed(4)}`;
  if (x >= 0.001) return `$${x.toPrecision(4)}`;
  const zeros = Math.floor(-Math.log10(x)) - 1;
  const sig = Math.round(x * 10 ** (zeros + 4));
  const sub = String(zeros)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d])
    .join('');
  return `$0.0${sub}${sig}`;
};

export const fmtPct = (x: number, digits = 1): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;

export const shortAddr = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

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
  floor:
    'On an AMM, sells push price down by a fixed amount set by the pool curve. When heavy selling should have dumped price but didn\'t, dip buyers absorbed it. On a candle that often prints a long lower wick.',
  ceiling:
    'Buys should have pumped price by a predictable amount on this curve, but sellers kept taking profit into them. That tends to print a long upper wick — a rejection.',
  whale:
    'A single swap that is large relative to pool liquidity moves price by a lot. Watch what the next few minutes of flow do: follow-through or a fade.',
  oneWallet:
    'When one wallet is most of the volume, the "trend" is one person. It can reverse the moment they stop. Distinct wallets matter more than raw volume.',
  liquidityPulled:
    'Liquidity providers removed part of the pool. Every $ of selling now moves price further. Big unexplained LP pulls on small tokens are a classic rug precursor — not proof, but a red flag.',
  liquidityAdded: 'More liquidity means each $ moves price less. Moves get harder to push — in both directions.',
  stacking:
    'Many different wallets buying while price holds is broad demand, not one whale. Breadth tends to be more durable than size.',
  graduation:
    'pump.fun tokens trade on a bonding curve until it fills, then migrate to an AMM pool. Approaching graduation often draws attention — and volatility around the migration.',
  coiling: 'Volatility compression: the range tightens while one side keeps leaning. Compression doesn\'t say which way — flow is the tell.',
  breakout: 'A breakout only counts here when price clears the level *and* swap flow agrees.',
  failed: 'A move through a level that snaps right back leaves a wick — the market rejecting the price.',
};

export const copy = {
  floor(ts: number, level: number, sellUsd: number, impliedMove: number | null, actualMove: number, absorbed: number | null, flowZ: number): WickEvent {
    const body =
      impliedMove !== null && absorbed !== null
        ? `${fmtUsd(sellUsd)} of sells hit the pool (${flowZ.toFixed(1)}σ above normal). On this curve that should have moved price ${fmtPct(
            impliedMove,
          )} — it moved ${fmtPct(actualMove)}. Dip buyers absorbed ${(absorbed * 100).toFixed(0)}%. Floor ≈ ${fmtPx(level)}.`
        : `${fmtUsd(sellUsd)} of sells (${flowZ.toFixed(1)}σ above normal) and price moved only ${fmtPct(actualMove)}. Floor ≈ ${fmtPx(level)}.`;
    return ev(ts, 'FLOOR_FORMING', 'alert', 'FLOOR FORMING: Sellers are getting absorbed', body, { level, sellUsd, impliedMove, actualMove, absorbed, flowZ }, 'up', LESSONS.floor);
  },

  ceiling(ts: number, level: number, buyUsd: number, impliedMove: number | null, actualMove: number, absorbed: number | null, flowZ: number): WickEvent {
    const body =
      impliedMove !== null && absorbed !== null
        ? `${fmtUsd(buyUsd)} of buys hit the pool (${flowZ.toFixed(1)}σ above normal). That should have moved price ${fmtPct(
            impliedMove,
          )} — it moved ${fmtPct(actualMove)}. Sellers absorbed ${(absorbed * 100).toFixed(0)}%. Ceiling ≈ ${fmtPx(level)}.`
        : `${fmtUsd(buyUsd)} of buys (${flowZ.toFixed(1)}σ above normal) and price moved only ${fmtPct(actualMove)}. Ceiling ≈ ${fmtPx(level)}.`;
    return ev(ts, 'CEILING_FORMING', 'alert', 'CEILING FORMING: Buyers are getting absorbed', body, { level, buyUsd, impliedMove, actualMove, absorbed, flowZ }, 'down', LESSONS.ceiling);
  },

  whale(ts: number, side: 'buy' | 'sell', usd: number, liqPct: number | null, impact: number | null, wallet?: string): WickEvent {
    const who = wallet ? ` from ${shortAddr(wallet)}` : '';
    const rel = liqPct !== null ? ` — ${(liqPct * 100).toFixed(1)}% of pool liquidity` : '';
    const imp = impact !== null ? `, worth about ${fmtPct(impact)} of price on its own` : '';
    return side === 'buy'
      ? ev(ts, 'WHALE_BUY', 'notice', 'WHALE APED IN', `${fmtUsd(usd)} buy${who}${rel}${imp}.`, { usd, liqPct, impact, wallet: wallet ?? null }, 'up', LESSONS.whale)
      : ev(ts, 'WHALE_SELL', 'notice', 'WHALE DUMPED', `${fmtUsd(usd)} sell${who}${rel}${imp}.`, { usd, liqPct, impact, wallet: wallet ?? null }, 'down', LESSONS.whale);
  },

  oneWallet(ts: number, side: 'buy' | 'sell', wallet: string, share: number, usd: number, trades: number): WickEvent {
    return ev(
      ts,
      'ONE_WALLET',
      'notice',
      side === 'buy' ? 'ONE WALLET IS DOING THE HEAVY LIFTING' : 'ONE WALLET IS DOING THE DUMPING',
      `${shortAddr(wallet)} is ${(share * 100).toFixed(0)}% of all ${side}s in the last 5 min (${fmtUsd(usd)} over ${trades} swaps). That's one trader, not a trend.`,
      { wallet, share, usd, trades },
      side === 'buy' ? 'up' : 'down',
      LESSONS.oneWallet,
    );
  },

  liquidityPulled(ts: number, fromUsd: number, toUsd: number, unexplained: number): WickEvent {
    return ev(
      ts,
      'LIQUIDITY_PULLED',
      'alert',
      'LIQUIDITY JUST VANISHED',
      `Pool liquidity fell ${fmtUsd(fromUsd)} → ${fmtUsd(toUsd)}; ${(unexplained * 100).toFixed(0)}% of that isn't explained by price. Looks like an LP withdrawal — sells now hit harder. Not proof of a rug, but watch it.`,
      { fromUsd, toUsd, unexplained },
      'down',
      LESSONS.liquidityPulled,
    );
  },

  liquidityAdded(ts: number, fromUsd: number, toUsd: number, unexplained: number): WickEvent {
    return ev(
      ts,
      'LIQUIDITY_ADDED',
      'notice',
      'LIQUIDITY ADDED',
      `Pool liquidity rose ${fmtUsd(fromUsd)} → ${fmtUsd(toUsd)}, ${(unexplained * 100).toFixed(0)}% beyond what price explains. Each $ now moves price less.`,
      { fromUsd, toUsd, unexplained },
      undefined,
      LESSONS.liquidityAdded,
    );
  },

  stacking(ts: number, side: 'buy' | 'sell', buyers: number, sellers: number, move: number): WickEvent {
    return side === 'buy'
      ? ev(
          ts,
          'BUYERS_STACKING',
          'notice',
          'BIDS ARE STACKING',
          `${buyers} different wallets bought vs ${sellers} sold in 5 min, and price ${move >= 0 ? 'held' : 'only dipped'} (${fmtPct(move)}). Broad demand, not one whale.`,
          { buyers, sellers, move },
          'up',
          LESSONS.stacking,
        )
      : ev(
          ts,
          'SELLERS_STACKING',
          'notice',
          'EXITS ARE STACKING',
          `${sellers} different wallets sold vs ${buyers} bought in 5 min while price ${move <= 0 ? 'held' : 'only ticked up'} (${fmtPct(move)}). Broad distribution.`,
          { buyers, sellers, move },
          'down',
          LESSONS.stacking,
        );
  },

  graduationLoading(ts: number, progress: number, solToGo: number): WickEvent {
    return ev(
      ts,
      'GRADUATION_LOADING',
      progress >= 0.9 ? 'alert' : 'notice',
      `GRADUATION LOADING… ${(progress * 100).toFixed(0)}%`,
      `The bonding curve is ${(progress * 100).toFixed(1)}% full — about ${solToGo.toFixed(1)} SOL of net buys left before it migrates to an AMM pool (estimate from pump.fun's curve constants).`,
      { progress, solToGo },
      'up',
      LESSONS.graduation,
    );
  },

  graduated(ts: number): WickEvent {
    return ev(ts, 'GRADUATED', 'alert', 'GRADUATED 🎓', 'The bonding curve completed and the token is migrating to an AMM pool. Switch to the new pool for live liquidity.', {}, undefined, LESSONS.graduation);
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
    return ev(ts, 'WICK_LOADING', 'notice', dir === 'up' ? 'WICK LOADING… ↑' : 'WICK LOADING… ↓', `Compression and directional flow suggest an emerging setup. ${reason}`, { trigger, invalidation }, dir, LESSONS.coiling);
  },

  imminent(ts: number, dir: Direction, reason: string, trigger: number | null, invalidation: number | null): WickEvent {
    return ev(
      ts,
      'IMMINENT',
      'alert',
      dir === 'up' ? 'BREAKOUT LOADING ↑' : 'BREAKDOWN LOADING ↓',
      `${reason} Trigger ${fmtPx(trigger)}, invalidation ${fmtPx(invalidation)}.`,
      { trigger, invalidation },
      dir,
    );
  },

  breakout(ts: number, dir: Direction, reason: string, trigger: number | null): WickEvent {
    return ev(ts, 'BREAKOUT_CONFIRMED', 'alert', dir === 'up' ? 'BREAKOUT CONFIRMED ↑' : 'BREAKDOWN CONFIRMED ↓', `Price crossed the trigger level with supporting flow. ${reason}`, { trigger }, dir, LESSONS.breakout);
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
