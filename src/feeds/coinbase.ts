import type { Candle } from '../engine/candles';
import { CoinbaseL2Sync, CoinbaseSequenceTracker, type CoinbaseL2Event } from '../engine/sync';
import type { Trade } from '../engine/types';
import { BaseFeed } from './feed';

interface CbTrade {
  trade_id: string;
  product_id: string;
  price: string;
  size: string;
  /** Coinbase documents this as the *maker* side. */
  side: 'BUY' | 'SELL';
  time: string;
}

interface CbMessage {
  channel?: string;
  type?: string;
  message?: string;
  timestamp?: string;
  sequence_num?: number;
  events?: Array<CoinbaseL2Event | { type: 'snapshot' | 'update'; trades: CbTrade[] }>;
}

/**
 * Normalize a Coinbase market trade. `side` is the maker side per the
 * Advanced Trade docs, so the aggressor is the opposite side.
 */
export function parseCoinbaseTrade(t: CbTrade): Trade {
  return {
    ts: Date.parse(t.time),
    price: Number(t.price),
    size: Number(t.size),
    aggressor: t.side === 'BUY' ? 'sell' : 'buy',
    id: t.trade_id,
  };
}

/** Coinbase Advanced Trade public WebSocket: level2 + market_trades + heartbeats on one connection. */
export class CoinbaseFeed extends BaseFeed {
  private sync = new CoinbaseL2Sync();
  private seq = new CoinbaseSequenceTracker();

  protected url(): string {
    return this.wsBase;
  }

  protected resetProtocol(): void {
    this.sync.reset();
    this.seq.reset();
  }

  protected onOpen(): void {
    const product_ids = [this.symbol];
    this.send({ type: 'subscribe', product_ids, channel: 'heartbeats' });
    this.send({ type: 'subscribe', product_ids, channel: 'level2' });
    this.send({ type: 'subscribe', product_ids, channel: 'market_trades' });
  }

  protected onData(raw: string): void {
    const msg = JSON.parse(raw) as CbMessage;
    const now = this.now();
    if (msg.type === 'error') {
      this.status('error', msg.message ?? 'venue error');
      return;
    }
    const exTs = msg.timestamp ? Date.parse(msg.timestamp) : undefined;
    this.engine.onMessage(now, exTs);

    if (typeof msg.sequence_num === 'number') {
      const gap = this.seq.check(msg.sequence_num);
      if (gap) {
        this.reconnect(gap);
        return;
      }
    }

    if (msg.channel === 'l2_data') {
      for (const ev of (msg.events ?? []) as CoinbaseL2Event[]) {
        if (ev.product_id && ev.product_id !== this.symbol) continue;
        const out = this.sync.onEvent(ev);
        if (out.type === 'snapshot') {
          this.engine.onBookSnapshot(now, out.bids, out.asks);
          this.status('live');
        } else if (out.type === 'delta' && !this.engine.onBookDelta(now, out.bids, out.asks)) {
          this.reconnect('local book crossed');
          return;
        }
      }
    } else if (msg.channel === 'market_trades') {
      for (const ev of msg.events ?? []) {
        // The snapshot is historical trades; only live updates count as flow.
        if (ev.type !== 'update' || !('trades' in ev)) continue;
        const trades = ev.trades.filter((t) => t.product_id === this.symbol).map(parseCoinbaseTrade);
        trades.sort((a, b) => a.ts - b.ts);
        for (const t of trades) this.engine.onTrade(now, t);
      }
    }
  }

  protected async fetchHistory(): Promise<Candle[]> {
    const end = Math.floor(this.now() / 1000);
    const start = end - 60 * 60;
    const res = await this.fetchFn(
      `${this.restBase}/api/v3/brokerage/market/products/${this.symbol}/candles?start=${start}&end=${end}&granularity=ONE_MINUTE`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { candles?: { start: string; low: string; high: string; open: string; close: string }[] };
    return (body.candles ?? [])
      .map((c) => ({
        t: Number(c.start) * 1000,
        o: Number(c.open),
        h: Number(c.high),
        l: Number(c.low),
        c: Number(c.close),
        // Coinbase candles don't split volume by aggressor.
        buyVol: 0,
        sellVol: 0,
        live: false,
      }))
      .sort((a, b) => a.t - b.t);
  }
}
