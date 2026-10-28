import type { SetupState } from '../engine/types';

export const STATE_META: Record<SetupState, { label: string; blurb: string; glyph: string }> = {
  NEUTRAL: { label: 'NEUTRAL', blurb: 'Book is chill. Nothing loading.', glyph: '○' },
  WATCHING: { label: 'WATCHING', blurb: 'Something is leaning. Eyes on it.', glyph: '◔' },
  COILING: { label: 'COILING', blurb: 'Range is tightening. The spring is loading.', glyph: '◑' },
  IMMINENT: { label: 'IMMINENT', blurb: "Trigger's close and the book agrees.", glyph: '◕' },
  BREAKOUT: { label: 'BREAKOUT', blurb: 'It went — and flow confirmed it.', glyph: '●' },
  FAILED: { label: 'FAILED', blurb: 'Fakeout. That was a wick.', glyph: '✕' },
  COOLDOWN: { label: 'COOLDOWN', blurb: 'Catching our breath before the next read.', glyph: '◌' },
};

export const STATE_ORDER: SetupState[] = ['NEUTRAL', 'WATCHING', 'COILING', 'IMMINENT', 'BREAKOUT'];

export type LessonId =
  | 'book'
  | 'imbalance'
  | 'flow'
  | 'ofi'
  | 'walls'
  | 'absorption'
  | 'compression'
  | 'wick'
  | 'floors'
  | 'estimates'
  | 'states'
  | 'cexdex'
  | 'data';

export interface Lesson {
  id: LessonId;
  title: string;
  tldr: string;
  body: string[];
  candle?: 'lower' | 'upper' | 'body' | 'doji';
}

export const LESSONS: Lesson[] = [
  {
    id: 'book',
    title: 'The order book',
    tldr: 'A live list of everyone waiting to buy (bids) and sell (asks).',
    body: [
      'Bids sit below the price, asks sit above. The gap between the best bid and best ask is the spread.',
      'Resting orders are *passive* — they wait. Market orders are *aggressive* — they cross the spread and trade instantly. Price only moves when aggressive orders eat through the resting ones.',
      'Depth = how much is resting near price. Thin depth means price moves easily; thick depth means it takes real size to push.',
    ],
  },
  {
    id: 'imbalance',
    title: 'Book imbalance',
    tldr: '(bids − asks) / (bids + asks) near the price. Positive = more cushion below.',
    body: [
      'Measured within 0.10%, 0.25% and 0.50% of mid. +100% means only bids, −100% only asks.',
      'Imbalance is a *lean*, not a verdict — resting orders can be pulled in milliseconds (that is what spoofing is). It matters more when it persists and when trades agree with it.',
    ],
  },
  {
    id: 'flow',
    title: 'Aggressive flow & CVD',
    tldr: 'Who is crossing the spread: market buyers or market sellers.',
    body: [
      'Every trade has an aggressor — the side that hit the other. Buy flow lifts asks; sell flow hits bids.',
      'Delta = buy volume − sell volume. CVD (cumulative volume delta) adds it up since you connected. Rising CVD with flat price is a classic absorption tell.',
    ],
  },
  {
    id: 'ofi',
    title: 'Order-flow imbalance (OFI)',
    tldr: 'Net pressure at the best bid and ask: adds, cancels and fills combined.',
    body: [
      'OFI (Cont, Kukanov & Stoikov) scores every change at the top of the book: a bigger or higher best bid adds buy pressure; a bigger or lower best ask adds sell pressure.',
      'Shown here as a z-score versus this pair\'s own recent history, so +2σ means "unusually bid for this market right now".',
    ],
  },
  {
    id: 'walls',
    title: 'Liquidity walls',
    tldr: 'Unusually big resting orders near price. Friction, not destiny.',
    body: [
      'A level counts as a wall when it is at least 6× the median level size nearby and survives 3 seconds (anti-flicker).',
      '*Eaten*: the wall shrank because it traded — real takers consumed it. Price tends to move into the space it guarded.',
      '*Vanished*: the wall disappeared without trading. Someone pulled it. That removes friction but is not proof of anything — it may have been a spoof.',
    ],
  },
  {
    id: 'absorption',
    title: 'Absorption → floors & ceilings',
    tldr: 'Heavy aggression that fails to move price. Someone is soaking it up.',
    body: [
      'Floor: market sells run well above normal (≥1.5σ, ≥60% of volume, sustained) but price barely moves and bids near the touch stay put. A passive buyer is absorbing — this is often what a long lower wick is made of.',
      'Ceiling: the mirror image — buyers keep lifting the offer and price will not go.',
      'Floors fail too. Wickipedia tracks how often floors it spotted actually held, and shows you that hit rate rather than a promise.',
    ],
  },
  {
    id: 'compression',
    title: 'Coiling (volatility compression)',
    tldr: 'Short-term volatility well below its norm while one side keeps leaning.',
    body: [
      'Ratio of 1-minute realized volatility to 10-minute realized volatility. Below 75% = coiling.',
      'Compression says energy is being stored, not which way it releases. Order flow is the directional tell.',
    ],
  },
  {
    id: 'wick',
    title: 'Reading wicks',
    tldr: 'A wick is where price went and got rejected.',
    body: [
      'Long lower wick: sellers pushed price down, buyers absorbed it and pushed back. Often the footprint of a floor.',
      'Long upper wick: buyers pushed up, sellers rejected it. Often the footprint of a ceiling — or a failed breakout.',
      'Big body, small wicks: one side controlled the whole candle. No rejection.',
      'Hover any candle in the chart to see its anatomy and the flow that built it.',
    ],
    candle: 'lower',
  },
  {
    id: 'floors',
    title: 'Did the floor hold?',
    tldr: 'After every floor/ceiling, we check whether price stayed on the right side of it.',
    body: [
      'A floor "holds" over a horizon if price never trades more than max(2 bps, spread) below it before the horizon ends.',
      'Rates are counted per pair and per venue, and stored in your browser. Under 5 samples they are flagged as anecdotes.',
    ],
  },
  {
    id: 'estimates',
    title: 'Breakout estimates (how the % works)',
    tldr: 'Historical hit rates for readings like this one — not predictions from a model.',
    body: [
      'Every 10 seconds the engine records its pressure score, then sets two barriers at ±max(2 bps, 1σ·√horizon). Whichever barrier price touches first is the outcome; if neither, it is "no break".',
      'The percentage shown is how often each outcome happened for samples in the same score bucket — smoothed with a uniform prior, with an 80% credible range.',
      'Samples overlap in time, so the effective sample size (n_eff) is discounted. Below n_eff 10, estimates are shown as "calibrating". With no data, the answer is "we don\'t know".',
      'Compare against the base rate: an edge is the gap between this bucket and all samples.',
    ],
  },
  {
    id: 'states',
    title: 'Setup states',
    tldr: 'NEUTRAL → WATCHING → COILING → IMMINENT → BREAKOUT (or FAILED) → COOLDOWN.',
    body: [
      'WATCHING: pressure score beyond ±0.25 for 3s+. Trigger = edge of the prior 2-min range; invalidation = the opposite edge.',
      'COILING: watching + volatility compression. Levels freeze.',
      'IMMINENT: pressure ≥ 0.45, price within 35% of the range from the trigger, and a supporting book event (wall eaten, floor/ceiling, stacking) in the last 30s.',
      'BREAKOUT: price crosses the trigger *and* 10s flow agrees. If it falls back within 15s → FAILED (that is a wick).',
      'Every transition is logged in the feed with the numbers that caused it.',
    ],
  },
  {
    id: 'cexdex',
    title: 'CEX order books vs DEX pools',
    tldr: 'Wickipedia reads centralized-exchange limit order books. DEX AMM pools are a different animal.',
    body: [
      'A CEX book is a list of discrete limit orders from many participants. Walls, imbalance, absorption and OFI all come from it.',
      'An AMM pool (Uniswap-style) has no order book: liquidity sits on a pricing curve (x·y=k, or concentrated ranges). "Depth" there is derived from the curve and LP ranges, and there are no walls to eat or pull in the same sense.',
      'Wickipedia currently only ingests CEX L2 books and labels every view accordingly. It does not show or infer DEX liquidity.',
    ],
  },
  {
    id: 'data',
    title: 'Data integrity',
    tldr: 'No synced book, no signal.',
    body: [
      'Books are built from a snapshot plus sequenced updates. Any sequence gap, crossed book or 10s silence pauses all signals until the book is rebuilt.',
      'In-flight calibration samples that span a data hole are discarded, not guessed.',
      'Latency shown = local receive time − exchange event time, which also includes your clock offset.',
    ],
  },
];

export const lessonById = (id: LessonId) => LESSONS.find((l) => l.id === id)!;
