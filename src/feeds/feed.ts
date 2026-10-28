import type { Candle } from '../engine/candles';
import type { WickEngine } from '../engine/engine';
import type { FeedStatus } from '../engine/types';
import type { VenueDef } from './venues';

/** Minimal WebSocket surface shared by browsers, Node ≥ 22 and test fakes. */
export interface WsLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WsFactory = (url: string) => WsLike;
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FeedDeps {
  ws?: WsFactory;
  fetch?: FetchLike;
  now?: () => number;
  /** Override venue endpoints (used by tests and the local mock exchange). */
  wsBase?: string;
  restBase?: string;
  /** Raw message tap, used by the agent's --record option. */
  onRaw?: (channel: string, data: string) => void;
}

const defaultWs: WsFactory = (url) => {
  const W = (globalThis as { WebSocket?: new (u: string) => WsLike }).WebSocket;
  if (!W) throw new Error('No global WebSocket — use a browser or Node ≥ 22.');
  return new W(url);
};

const defaultFetch: FetchLike = (url) => globalThis.fetch(url) as ReturnType<FetchLike>;

/**
 * Shared connection lifecycle: connect, watchdog, exponential-backoff
 * reconnect, clean stop. Subclasses implement the venue protocol.
 */
export abstract class BaseFeed {
  protected ws: WsLike | null = null;
  protected readonly makeWs: WsFactory;
  protected readonly fetchFn: FetchLike;
  protected readonly now: () => number;
  protected readonly wsBase: string;
  protected readonly restBase: string;
  private stopped = true;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  protected lastMsgAt = 0;

  constructor(
    protected readonly venue: VenueDef,
    protected readonly symbol: string,
    protected readonly engine: WickEngine,
    protected readonly deps: FeedDeps = {},
  ) {
    this.makeWs = deps.ws ?? defaultWs;
    this.fetchFn = deps.fetch ?? defaultFetch;
    this.now = deps.now ?? Date.now;
    this.wsBase = deps.wsBase ?? venue.ws;
    this.restBase = deps.restBase ?? venue.rest;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.ws && this.lastMsgAt && this.now() - this.lastMsgAt > 20_000) this.reconnect('no messages for 20s');
    }, 5_000);
    void this.loadHistory().catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.reconnectTimer = this.watchdog = null;
    this.teardown();
    this.status('closed', 'stopped');
  }

  protected status(s: FeedStatus, detail?: string): void {
    this.engine.onStatus(this.now(), s, detail);
  }

  protected abstract url(): string;
  protected abstract onOpen(): void;
  protected abstract onData(raw: string): void;
  protected abstract resetProtocol(): void;
  /** Best-effort historical candles for context. Failures are silent: live data is the source of truth. */
  protected abstract fetchHistory(): Promise<Candle[]>;

  private async loadHistory(): Promise<void> {
    const c = await this.fetchHistory();
    if (c.length) this.engine.seedCandles(c);
  }

  private connect(): void {
    this.resetProtocol();
    this.status(this.attempts === 0 ? 'connecting' : 'resyncing', this.attempts === 0 ? this.url() : 'reconnecting');
    let ws: WsLike;
    try {
      ws = this.makeWs(this.url());
    } catch (e) {
      this.status('error', String(e));
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.status('syncing', 'connected, building book');
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = this.now();
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.deps.onRaw?.(this.venue.id, raw);
      try {
        this.onData(raw);
      } catch (e) {
        this.reconnect(`bad message: ${String(e)}`);
      }
    };
    ws.onerror = () => {
      /* onclose follows and handles reconnect */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.status('error', `socket closed${ev?.code ? ` (${ev.code})` : ''}${ev?.reason ? `: ${ev.reason}` : ''}`);
      this.scheduleReconnect();
    };
  }

  protected reconnect(reason: string): void {
    if (this.stopped) return;
    this.status('resyncing', reason);
    this.teardown();
    this.scheduleReconnect();
  }

  private teardown(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  protected send(obj: unknown): void {
    this.ws?.send(JSON.stringify(obj));
  }

  protected get isStopped(): boolean {
    return this.stopped;
  }
}
