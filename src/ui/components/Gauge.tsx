import type { ScoreParts } from '../../engine/poolEngine';

const W = 320;
const H = 186;
const CX = W / 2;
const CY = 164;
const R = 132;

const polar = (t: number, r = R) => {
  // t ∈ [−1, 1] → left … right along the top semicircle
  const a = Math.PI * (1 - (t + 1) / 2);
  return [CX + Math.cos(a) * r, CY - Math.sin(a) * r] as const;
};

const arc = (t0: number, t1: number, r = R) => {
  const [x0, y0] = polar(t0, r);
  const [x1, y1] = polar(t1, r);
  return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
};

export function Gauge({ score, ready, parts, warmup }: { score: number; ready: boolean; parts: ScoreParts; warmup: { have: number; need: number } | null }) {
  const s = Math.max(-1, Math.min(1, score));
  const [nx, ny] = polar(s, R - 24);
  const lean = !ready ? 'warming up' : Math.abs(s) < 0.12 ? 'balanced' : s > 0 ? 'buyers leaning' : 'sellers leaning';
  const chips: Array<[string, number]> = [
    ['Flow 1m', parts.flowShort],
    ['Flow 5m', parts.flowLong],
    ['Wallets', parts.wallets],
    ['vs Liq', parts.flowVsLiquidity],
  ];

  return (
    <section className="gauge-card glass" aria-label="Pressure">
      <figure className="gauge" aria-label={`Pressure ${ready ? s.toFixed(2) : 'not ready'}: ${lean}`}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
          <defs>
            <linearGradient id="g-candy" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--sell)" />
              <stop offset="50%" stopColor="var(--hazy)" />
              <stop offset="100%" stopColor="var(--buy)" />
            </linearGradient>
            <radialGradient id="g-hub" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="45%" stopColor="var(--candy-lilac)" />
              <stop offset="100%" stopColor="var(--candy-deep)" />
            </radialGradient>
            <filter id="g-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          {/* soft glow under the arc */}
          <path d={arc(-1, 1)} className="g-glow" filter="url(#g-glow)" />
          <path d={arc(-1, 1)} className="g-track" />
          <path d={arc(-1, 1)} className="g-arc" />
          {/* glossy highlight */}
          <path d={arc(-0.92, 0.92, R + 5)} className="g-gloss" />
          {[-1, -0.5, 0, 0.5, 1].map((t) => {
            const [x0, y0] = polar(t, R + 16);
            const [x1, y1] = polar(t, R + 23);
            return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} className="g-tick" />;
          })}
          {ready && (
            <g className="g-needle-g">
              <line x1={CX} y1={CY} x2={nx} y2={ny} className="g-needle-shadow" />
              <line x1={CX} y1={CY} x2={nx} y2={ny} className="g-needle" />
            </g>
          )}
          <circle cx={CX} cy={CY} r={11} fill="url(#g-hub)" className="g-hub" />
          <text x={CX - R} y={H - 1} className="g-end" textAnchor="middle">
            ▼ SELLERS
          </text>
          <text x={CX + R} y={H - 1} className="g-end" textAnchor="middle">
            BUYERS ▲
          </text>
        </svg>
        <figcaption>
          <span className={`g-score ${!ready ? 'muted' : s > 0.12 ? 'buy-t' : s < -0.12 ? 'sell-t' : ''}`}>{ready ? `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(2)}` : '—'}</span>
          <span className="g-lean">{lean}</span>
        </figcaption>
      </figure>

      <ul className="chips" aria-label="What the pressure is made of">
        {chips.map(([k, v]) => (
          <li key={k} className={v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : ''}>
            <span>{k}</span>
            <strong>
              {v > 0.05 ? '▲' : v < -0.05 ? '▼' : '·'} {Math.abs(v).toFixed(2)}
            </strong>
          </li>
        ))}
      </ul>

      {warmup && (
        <div className="warm" role="progressbar" aria-valuemin={0} aria-valuemax={warmup.need} aria-valuenow={warmup.have} aria-label="Learning the baseline">
          <span style={{ width: `${(warmup.have / warmup.need) * 100}%` }} />
          <em>
            Learning what normal looks like… {warmup.have}/{warmup.need}s
          </em>
        </div>
      )}
    </section>
  );
}
