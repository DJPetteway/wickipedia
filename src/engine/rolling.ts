/**
 * Time-windowed accumulator. Values older than `windowMs` (relative to the
 * `now` passed to prune) fall out; `sum` is maintained incrementally and
 * recomputed on compaction so floating-point drift can't accumulate.
 */
export class RollingWindow {
  private t: number[] = [];
  private v: number[] = [];
  private h = 0;
  sum = 0;

  constructor(readonly windowMs: number) {}

  push(ts: number, value: number): void {
    this.t.push(ts);
    this.v.push(value);
    this.sum += value;
  }

  prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.h < this.t.length && this.t[this.h] <= cutoff) {
      this.sum -= this.v[this.h];
      this.h++;
    }
    if (this.h > 512 && this.h * 2 > this.t.length) {
      this.t = this.t.slice(this.h);
      this.v = this.v.slice(this.h);
      this.h = 0;
      this.sum = this.v.reduce((a, b) => a + b, 0);
    }
  }

  get count(): number {
    return this.t.length - this.h;
  }

  values(): number[] {
    return this.v.slice(this.h);
  }

  entries(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = this.h; i < this.t.length; i++) out.push([this.t[i], this.v[i]]);
    return out;
  }

  clear(): void {
    this.t = [];
    this.v = [];
    this.h = 0;
    this.sum = 0;
  }
}

/** Fixed-capacity ring of numbers (oldest dropped first). */
export class Ring {
  private buf: number[] = [];
  constructor(readonly capacity: number) {}

  push(x: number): void {
    this.buf.push(x);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  get length(): number {
    return this.buf.length;
  }

  last(n = 1): number | undefined {
    return this.buf[this.buf.length - n];
  }

  /** Last n values (or all). */
  tail(n?: number): number[] {
    return n === undefined ? [...this.buf] : this.buf.slice(Math.max(0, this.buf.length - n));
  }

  clear(): void {
    this.buf = [];
  }
}
