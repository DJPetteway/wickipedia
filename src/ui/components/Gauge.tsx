const W = 320;
const H = 178;
const CX = W / 2;
const CY = 158;
const R = 128;

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

const SELL = [255, 92, 154];
const MID = [180, 156, 255];
const BUY = [47, 214, 166];
/** Candy colour for a score: pink ← lilac → mint. */
export function candy(t: number): string {
  const [a, b, k] = t < 0 ? [MID, SELL, -t] : [MID, BUY, t];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, k)));
  return `rgb(${c.join(',')})`;
}

/**
 * The toy: a glossy jelly bead that slides along a candy track. Sellers on
 * the left, buyers on the right. One word underneath. That's it.
 */
export function Gauge({ score, ready }: { score: number; ready: boolean }) {
  const s = ready ? Math.max(-1, Math.min(1, score)) : 0;
  const [bx, by] = polar(s);
  const word = !ready ? 'WARMING UP' : Math.abs(s) < 0.12 ? 'BALANCED' : s > 0 ? (s > 0.5 ? 'BUYERS!' : 'BUYERS') : s < -0.5 ? 'SELLERS!' : 'SELLERS';
  const color = ready ? candy(s) : 'rgb(200,190,255)';

  return (
    <figure className="toy-gauge" aria-label={`Pressure: ${word.toLowerCase()}`} style={{ ['--bead' as string]: color }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
        <defs>
          <linearGradient id="g-candy" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--sell)" />
            <stop offset="50%" stopColor="var(--hazy)" />
            <stop offset="100%" stopColor="var(--buy)" />
          </linearGradient>
          <radialGradient id="g-bead" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="30%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0.85" />
          </radialGradient>
          <filter id="g-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <path d={arc(-1, 1)} className="g-glow" filter="url(#g-blur)" />
        <path d={arc(-1, 1)} className="g-track" />
        <path d={arc(-1, 1)} className="g-arc" />
        <path d={arc(-0.9, 0.9, R + 7)} className="g-gloss" />
        <g className={`bead ${ready ? '' : 'idle'}`} style={{ transform: `translate(${bx}px, ${by}px)` }}>
          <circle r="27" className="bead-halo" />
          <circle r="21" fill="url(#g-bead)" className="bead-body" />
          <ellipse cx="-7" cy="-9" rx="7" ry="4.5" className="bead-shine" />
        </g>
        <text x={CX - R} y={H - 2} className="g-end" textAnchor="middle">
          SELLERS
        </text>
        <text x={CX + R} y={H - 2} className="g-end" textAnchor="middle">
          BUYERS
        </text>
      </svg>
      <figcaption className="toy-word" key={word}>
        {word}
      </figcaption>
    </figure>
  );
}
