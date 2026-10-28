import { DEFAULT_CONFIG } from '../src/engine/config';
import { SetupStateMachine, type StateInputs } from '../src/engine/stateMachine';

const base = (now: number, over: Partial<StateInputs> = {}): StateInputs => ({
  now,
  mid: 100,
  score: 0,
  compression: 1,
  rangeHigh: 100.2,
  rangeLow: 99.8,
  flowDelta: 0,
  lastSupport: { up: null, down: null },
  ...over,
});

describe('SetupStateMachine', () => {
  it('walks a full bullish setup to a confirmed breakout and back to neutral', () => {
    const sm = new SetupStateMachine(DEFAULT_CONFIG.state);
    const states: string[] = [];
    const step = (x: StateInputs) => {
      const t = sm.step(x);
      if (t) states.push(t.to);
      return t;
    };
    let t = 0;
    for (; t <= 4000; t += 1000) step(base(t, { score: 0.4 }));
    expect(sm.view().state).toBe('WATCHING');
    expect(sm.view().trigger).toBe(100.2);
    expect(sm.view().invalidation).toBe(99.8);

    step(base((t += 1000), { score: 0.4, compression: 0.5 }));
    expect(sm.view().state).toBe('COILING');

    // near the trigger with strong pressure but no supporting book event → stays coiling
    step(base((t += 1000), { score: 0.6, compression: 0.5, mid: 100.15 }));
    expect(sm.view().state).toBe('COILING');

    step(base((t += 1000), { score: 0.6, compression: 0.5, mid: 100.15, lastSupport: { up: t, down: null } }));
    expect(sm.view().state).toBe('IMMINENT');

    // crossing without flow confirmation is not a breakout
    step(base((t += 1000), { score: 0.6, mid: 100.25, flowDelta: 0 }));
    expect(sm.view().state).toBe('IMMINENT');

    step(base((t += 1000), { score: 0.6, mid: 100.25, flowDelta: 0.4 }));
    expect(sm.view().state).toBe('BREAKOUT');

    step(base((t += 16_000), { score: 0.6, mid: 100.3 }));
    expect(sm.view().state).toBe('COOLDOWN');
    step(base((t += 31_000), { score: 0 }));
    expect(states).toEqual(['WATCHING', 'COILING', 'IMMINENT', 'BREAKOUT', 'COOLDOWN', 'NEUTRAL']);
  });

  it('flags a fakeout when a breakout falls back inside the range', () => {
    const sm = new SetupStateMachine(DEFAULT_CONFIG.state);
    let t = 0;
    for (; t <= 4000; t += 1000) sm.step(base(t, { score: 0.4 }));
    sm.step(base((t += 1000), { score: 0.4, mid: 100.3, flowDelta: 0.5 }));
    expect(sm.view().state).toBe('BREAKOUT');
    const tr = sm.step(base((t += 3000), { score: 0.2, mid: 100.1 }));
    expect(tr?.to).toBe('FAILED');
    expect(tr?.reason).toMatch(/wick/);
  });

  it('fails a coiled setup that breaks its invalidation level', () => {
    const sm = new SetupStateMachine(DEFAULT_CONFIG.state);
    let t = 0;
    for (; t <= 4000; t += 1000) sm.step(base(t, { score: 0.4 }));
    sm.step(base((t += 1000), { score: 0.4, compression: 0.5 }));
    expect(sm.view().state).toBe('COILING');
    const tr = sm.step(base((t += 1000), { score: 0.3, mid: 99.7, compression: 0.5 }));
    expect(tr?.to).toBe('FAILED');
  });

  it('dissolves quietly back to neutral when pressure fades', () => {
    const sm = new SetupStateMachine(DEFAULT_CONFIG.state);
    let t = 0;
    for (; t <= 4000; t += 1000) sm.step(base(t, { score: -0.4 }));
    expect(sm.view().direction).toBe('down');
    for (let i = 0; i < 10; i++) sm.step(base((t += 1000), { score: 0 }));
    expect(sm.view().state).toBe('NEUTRAL');
  });

  it('requires pressure to persist before watching', () => {
    const sm = new SetupStateMachine(DEFAULT_CONFIG.state);
    sm.step(base(0, { score: 0.5 }));
    sm.step(base(1000, { score: 0.1 }));
    sm.step(base(2000, { score: 0.5 }));
    sm.step(base(3000, { score: 0.5 }));
    expect(sm.view().state).toBe('NEUTRAL');
  });
});
