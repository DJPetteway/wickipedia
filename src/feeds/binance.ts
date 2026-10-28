import type { Candle } from '../engine/candles';
import { BinanceDepthSync, type BinanceDepthEvent, type BinanceDepthSnapshot, type SyncOutput } from '../engine/sync';
import type { Trade } from '../engine/types';
import { BaseFeed } from './feed';

interface DepthUpdateMsg extends BinanceDepthEvent {
  e: 'depthUpdate';
  E: number;
  s: string;
}

interface AggTradeMsg {
  e: 'aggTrade';
  E: number;
  s: string;
  a: number;
  p: string;
  q: string;
  T: number;
  /** true when the buyer was the maker → the taker sold. */
  m: boolean;
}

/** Parse a Binance aggTrade payload into a normalized trade. */
export function parseBinanceTrade(m: AggTradeMsg): Trade {
  return { ts: m.T, price: Number(m.p), size: Number(m.q), aggressor: m.m ? 'sell' : 'buy', id: m.a };
}

/** Binance / Binance.US spot: diff-depth stream + REST snapshot, synced by update id. */
export class BinanceFeed extends BaseFeed {
  private sync = new BinanceDepthSync();
  private snapshotInFlight = false;
  private snapshotAttempts = 0;

  protected url(): string {
    const s = this.symbol.toLowerCase();
    return `${this.wsBase}/stream?streams=${s}@depth@100ms/${s}@aggTrade`;
  }

  protected resetProtocol(): void {
    this.sync.reset();
    this.snapshotInFlight = false;
    this.snapshotAttempts = 0;
  }

  protected onOpen(): void {
    /* snapshot is requested once the first depth event is buffered */
  }

  protected onData(raw: string): void {
    const msg = JSON.parse(raw) as { stream?: string; data?: DepthUpdateMsg | AggTradeMsg };
    const d = msg.data;
    if (!d) return;
    const now = this.now();
    this.engine.onMessage(now, d.E);
    if (d.e === 'aggTrade') {
      this.engine.onTrade(now, parseBinanceTrade(d));
      return;
    }
    if (d.e === 'depthUpdate') {
      this.handle(this.sync.onEvent(d));
      if (!this.sync.isSynced && !this.snapshotInFlight) void this.fetchSnapshot();
    }
  }

  private handle(out: SyncOutput): void {
    const now = this.now();
    switch (out.type) {
      case 'snapshot':
        this.engine.onBookSnapshot(now, out.bids, out.asks);
        this.status('live');
        break;
      case 'delta':
        if (!this.engine.onBookDelta(now, out.bids, out.asks)) {
          this.sync.reset();
          this.status('resyncing', 'local book crossed');
        }
        break;
      case 'resync':
        this.status('resyncing', out.reason);
        break;
    }
  }

  private async fetchSnapshot(): Promise<void> {
    this.snapshotInFlight = true;
    const ws = this.ws;
    try {
      // Give the stream a moment to buffer so the snapshot lands inside it.
      await new Promise((r) => setTimeout(r, this.snapshotAttempts === 0 ? 300 : 1000));
      if (this.isStopped || this.ws !== ws) return;
      const res = await this.fetchFn(`${this.restBase}/api/v3/depth?symbol=${this.symbol.toUpperCase()}&limit=1000`);
      if (!res.ok) throw new Error(`depth snapshot HTTP ${res.status}`);
      const snap = (await res.json()) as BinanceDepthSnapshot;
      if (this.isStopped || this.ws !== ws) return;
      const out = this.sync.onSnapshot(snap);
      this.handle(out);
      if (out.type === 'resync') {
        if (++this.snapshotAttempts > 5) {
          this.reconnect('could not align snapshot with stream');
          return;
        }
        this.snapshotInFlight = false;
        void this.fetchSnapshot();
        return;
      }
      this.snapshotAttempts = 0;
    } catch (e) {
      if (this.ws === ws) this.reconnect(String(e instanceof Error ? e.message : e));
    } finally {
      if (this.ws === ws) this.snapshotInFlight = false;
    }
  }

  protected async fetchHistory(): Promise<Candle[]> {
    const res = await this.fetchFn(`${this.restBase}/api/v3/klines?symbol=${this.symbol.toUpperCase()}&interval=1m&limit=60`);
    if (!res.ok) return [];
    const rows = (await res.json()) as (string | number)[][];
    return rows.map((r) => {
      const vol = Number(r[5]);
      const takerBuy = Number(r[9]);
      return {
        t: Number(r[0]),
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
        buyVol: takerBuy,
        sellVol: Math.max(0, vol - takerBuy),
        live: false,
      };
    });
  }
}
