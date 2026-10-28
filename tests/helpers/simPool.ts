import { PoolEngine } from '../../src/engine/poolEngine';
import type { Swap } from '../../src/engine/types';

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic constant-product pool used only by tests. */
export class SimPool {
  readonly engine: PoolEngine;
  t = 1_800_000_000_000;
  /** base units / USD quote reserve */
  x = 100_000_000;
  y = 50_000;
  private r = rng(7);
  private n = 0;

  constructor(engine?: PoolEngine) {
    this.engine =
      engine ??
      new PoolEngine({
        market: { chain: 'solana', network: 'solana', token: 'SIM', pool: 'POOL', symbol: 'SIM', name: 'Sim', venue: 'Sim CPMM', model: 'CPMM' },
        source: { name: 'Sim', mode: 'poll', pollMs: 1000 },
      });
    this.engine.onStatus(this.t, 'live');
  }

  get price() {
    return this.y / this.x;
  }

  publishPool() {
    this.engine.onPoolState(this.t, { priceUsd: this.price, liquidityUsd: 2 * this.y, fdvUsd: null, mcapUsd: null, model: 'CPMM' });
  }

  swap(side: 'buy' | 'sell', usd: number, wallet = `w${Math.floor(this.r() * 40)}`): Swap {
    const k = this.x * this.y;
    let base: number;
    if (side === 'buy') {
      const y2 = this.y + usd;
      base = this.x - k / y2;
      this.y = y2;
      this.x = k / y2;
    } else {
      // sell base worth `usd` at the current price
      base = usd / this.price;
      const x2 = this.x + base;
      const y2 = k / x2;
      usd = this.y - y2;
      this.x = x2;
      this.y = y2;
    }
    const s: Swap = { id: `tx${this.n++}`, ts: this.t, priceUsd: usd / base, baseAmount: base, usd, side, wallet };
    this.engine.onSwaps(this.t, [s]);
    return s;
  }

  noise() {
    if (this.r() < 0.12) this.swap(this.r() < 0.5 ? 'buy' : 'sell', 50 + this.r() * 100);
  }

  /** Advance in 250 ms steps; publishes pool state every 20 s and heartbeats every step. */
  run(seconds: number, each?: (p: SimPool, i: number) => void) {
    let snap = this.engine.tick(this.t);
    for (let i = 0; i < seconds * 4; i++) {
      this.t += 250;
      each?.(this, i);
      if (i % 80 === 0) this.publishPool();
      this.engine.onHeartbeat(this.t);
      snap = this.engine.tick(this.t);
    }
    return snap;
  }

  random() {
    return this.r();
  }
}
