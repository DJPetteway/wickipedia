import { consult } from '../src/engine/oracle';
import { PoolEngine } from '../src/engine/poolEngine';
import { SimPool } from './helpers/simPool';

describe('8-ball oracle', () => {
  it('refuses to answer without data', () => {
    const e = new PoolEngine({
      market: { chain: 'solana', network: 'solana', token: 'T', symbol: 'T', name: 'T', venue: 'x', model: 'CPMM' },
      source: { name: 'Test', mode: 'poll' },
    });
    const o = consult(e.tick(0));
    expect(o.answer).toBe('CANNOT SAY NOW');
    expect(o.odds).toBeNull();
  });

  it('says "ask again later" while learning the baseline', () => {
    const sim = new SimPool();
    sim.publishPool();
    const o = consult(sim.run(10, (p) => p.noise()));
    expect(o.answer).toBe('ASK AGAIN LATER');
    expect(o.detail).toMatch(/\/90s/);
  });

  it('lets a fresh alert take over the ball, with its evidence', () => {
    const sim = new SimPool();
    sim.publishPool();
    sim.run(100, (p) => p.noise());
    sim.engine.onPoolState(sim.t, { priceUsd: sim.price, liquidityUsd: 2 * sim.y * 0.5, fdvUsd: null, mcapUsd: null, model: 'CPMM' });
    const o = consult(sim.engine.tick(sim.t));
    expect(o.answer).toBe('LIQUIDITY VANISHED');
    expect(o.tone).toBe('warn');
    expect(o.detail).toMatch(/LP withdrawal/);
  });

  it('never claims certainty', () => {
    const sim = new SimPool();
    sim.publishPool();
    const answers = new Set<string>();
    sim.run(600, (p, i) => {
      p.noise();
      if (i > 1200 && i % 6 === 0) p.swap('buy', 200);
      if (i % 4 === 0) answers.add(consult(p.engine.tick(p.t)).answer);
    });
    for (const a of answers) expect(a).not.toMatch(/CERTAIN|DEFINITELY|GUARANTEE/);
    expect(answers.size).toBeGreaterThan(2);
  });
});
