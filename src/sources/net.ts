/** Minimal network surfaces shared by browsers, Node ≥ 22 and test fakes. */

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
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const defaultWs: WsFactory = (url) => {
  const W = (globalThis as { WebSocket?: new (u: string) => WsLike }).WebSocket;
  if (!W) throw new Error('No global WebSocket — use a browser or Node ≥ 22.');
  return new W(url);
};

export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init) as ReturnType<FetchLike>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status}`);
  }
}

/**
 * Serialises requests to one host and spaces them out so a free, IP-rate-limited
 * API is never hammered. On HTTP 429 the whole queue backs off.
 */
export class RateLimitedClient {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private nextAt = 0;
  private backoffUntil = 0;
  /** Listeners notified when we hit / clear a rate limit. */
  onThrottle?: (throttled: boolean, untilMs: number) => void;

  constructor(
    readonly base: string,
    private readonly minIntervalMs: number,
    private readonly fetchFn: FetchLike = defaultFetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        const url = `${this.base}${path}`;
        try {
          const res = await this.fetchFn(url, { headers: { accept: 'application/json' } });
          if (res.status === 429) {
            this.backoffUntil = this.now() + 30_000;
            this.onThrottle?.(true, this.backoffUntil);
            reject(new HttpError(429, url));
            return;
          }
          if (!res.ok) {
            reject(new HttpError(res.status, url));
            return;
          }
          resolve(await res.json());
        } catch (e) {
          reject(e);
        }
      });
      void this.pump();
    });
  }

  /** Drop queued (not yet started) requests, e.g. when switching tokens. */
  clear(): void {
    this.queue = [];
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const wait = Math.max(this.nextAt, this.backoffUntil) - this.now();
      if (wait > 0) await this.sleep(wait);
      if (this.backoffUntil && this.now() >= this.backoffUntil) {
        this.backoffUntil = 0;
        this.onThrottle?.(false, 0);
      }
      const job = this.queue.shift();
      if (!job) break;
      this.nextAt = this.now() + this.minIntervalMs;
      await job();
    }
    this.running = false;
  }
}
