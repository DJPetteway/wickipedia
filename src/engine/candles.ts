/** Minimal trade shape candles need. */
export interface CandleTrade {
  ts: number;
  price: number;
  size: number;
  aggressor: 'buy' | 'sell';
  /** Notional in USD, when known (drives VWAP and volume-by-price). */
  usd?: number;
}

export interface Candle {
  /** Bucket open time (ms). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Base volume split by aggressor. */
  buyVol: number;
  sellVol: number;
  /** Total traded notional in USD. */
  volUsd: number;
  /** True when this candle was built entirely from trades we saw live. */
  live: boolean;
}

export interface WickAnatomy {
  range: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  /** Fractions of the full range. */
  upperFrac: number;
  lowerFrac: number;
  bodyFrac: number;
  bullish: boolean;
}

export function anatomy(c: Candle): WickAnatomy {
  const range = c.h - c.l;
  const top = Math.max(c.o, c.c);
  const bot = Math.min(c.o, c.c);
  const upperWick = c.h - top;
  const lowerWick = bot - c.l;
  const body = top - bot;
  const safe = range > 0 ? range : 1;
  return {
    range,
    body,
    upperWick,
    lowerWick,
    upperFrac: range > 0 ? upperWick / safe : 0,
    lowerFrac: range > 0 ? lowerWick / safe : 0,
    bodyFrac: range > 0 ? body / safe : 0,
    bullish: c.c >= c.o,
  };
}

/** Builds fixed-interval OHLC candles from the live trade stream. */
export class CandleBuilder {
  private candles: Candle[] = [];

  constructor(
    readonly intervalMs = 60_000,
    readonly keep = 90,
  ) {}

  /** Seed with historical candles (e.g. venue REST klines). Live candles take precedence. */
  seed(history: Candle[]): void {
    const liveStart = this.candles.length ? this.candles[0].t : Infinity;
    const older = history.filter((c) => c.t < liveStart).map((c) => ({ ...c, live: false }));
    this.candles = [...older, ...this.candles].slice(-this.keep);
  }

  onTrade(t: CandleTrade): void {
    const bucket = Math.floor(t.ts / this.intervalMs) * this.intervalMs;
    let last = this.candles[this.candles.length - 1];
    if (last && bucket < last.t) return; // late trade from an older bucket; ignore
    if (!last || bucket > last.t) {
      last = { t: bucket, o: t.price, h: t.price, l: t.price, c: t.price, buyVol: 0, sellVol: 0, volUsd: 0, live: true };
      this.candles.push(last);
      if (this.candles.length > this.keep) this.candles.shift();
    }
    last.h = Math.max(last.h, t.price);
    last.l = Math.min(last.l, t.price);
    last.c = t.price;
    last.volUsd += t.usd ?? t.size * t.price;
    if (t.aggressor === 'buy') last.buyVol += t.size;
    else last.sellVol += t.size;
  }

  list(): Candle[] {
    return this.candles.map((c) => ({ ...c }));
  }

  clear(): void {
    this.candles = [];
  }
}
