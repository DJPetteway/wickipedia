import { useMemo, useRef, useState } from 'react';
import type { DepthPoint, EngineSnapshot } from '../../engine/engine';
import { fmtPx, fmtQty, fmtUsd } from '../format';
import { Panel } from './common';

const RANGES = [10, 25, 50, 100, 200];

export function DepthChart({ s }: { s: EngineSnapshot }) {
  const [rangeBps, setRange] = useState(50);
  const [hover, setHover] = useState<{ x: number; price: number } | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 220;
  const padB = 22;
  const mid = s.mid;

  const view = useMemo(() => {
    if (mid === null) return null;
    const lo = mid * (1 - rangeBps / 1e4);
    const hi = mid * (1 + rangeBps / 1e4);
    const bids = s.depth.bids.filter((p) => p.price >= lo);
    const asks = s.depth.asks.filter((p) => p.price <= hi);
    const maxY = Math.max(bids.at(-1)?.cum ?? 0, asks.at(-1)?.cum ?? 0, 1e-12);
    const x = (p: number) => ((p - lo) / (hi - lo)) * W;
    const y = (q: number) => H - padB - (q / maxY) * (H - padB - 10);
    const step = (pts: DepthPoint[], side: 'bid' | 'ask') => {
      if (!pts.length) return { line: '', area: '' };
      let d = `M${x(pts[0].price)},${y(0)}`;
      let prev = 0;
      for (const p of pts) {
        d += `L${x(p.price)},${y(prev)}L${x(p.price)},${y(p.cum)}`;
        prev = p.cum;
      }
      const edge = side === 'bid' ? 0 : W;
      d += `L${edge},${y(prev)}`;
      return { line: d, area: `${d}L${edge},${y(0)}Z` };
    };
    return { lo, hi, x, y, maxY, bids, asks, b: step(bids, 'bid'), a: step(asks, 'ask') };
  }, [s.depth, mid, rangeBps]);

  const tip = useMemo(() => {
    if (!hover || !view || mid === null) return null;
    const side = hover.price < mid ? 'bid' : 'ask';
    const pts = side === 'bid' ? view.bids : view.asks;
    const within = side === 'bid' ? pts.filter((p) => p.price >= hover.price) : pts.filter((p) => p.price <= hover.price);
    const cum = within.at(-1)?.cum ?? 0;
    const notional = within.reduce((a, p) => a + p.size * p.price, 0);
    return { side, cum, notional, bps: ((hover.price - mid) / mid) * 1e4 };
  }, [hover, view, mid]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!view || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    setHover({ x: fx, price: view.lo + (fx / W) * (view.hi - view.lo) });
  };

  const bidTotal = view?.bids.at(-1)?.cum ?? 0;
  const askTotal = view?.asks.at(-1)?.cum ?? 0;

  return (
    <Panel
      title="Depth"
      lesson="book"
      id="depth"
      className="span-2"
      kicker={
        <div className="seg" role="group" aria-label="Depth range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === rangeBps} onClick={() => setRange(r)}>
              ±{(r / 100).toFixed(r < 100 ? 2 : 1)}%
            </button>
          ))}
        </div>
      }
    >
      {!view ? (
        <div className="empty">No synchronized book — no depth to draw.</div>
      ) : (
        <>
          <div className="legend" aria-hidden="true">
            <span className="lg bid">▲ Bids {fmtQty(bidTotal)}</span>
            <span className="lg ask">Asks {fmtQty(askTotal)} ▼</span>
          </div>
          <div className="chart-wrap">
            <svg
              ref={ref}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="depth"
              role="img"
              aria-label={`Cumulative depth within ±${rangeBps / 100}% of mid: ${fmtQty(bidTotal)} bid vs ${fmtQty(askTotal)} ask`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={0} x2={W} y1={view.y(view.maxY * f)} y2={view.y(view.maxY * f)} className="gridline" />
              ))}
              <path d={view.b.area} className="area bid" />
              <path d={view.a.area} className="area ask" />
              <path d={view.b.line} className="stroke bid" />
              <path d={view.a.line} className="stroke ask" />
              <line x1={view.x(mid!)} x2={view.x(mid!)} y1={0} y2={H - padB} className="midline" />
              {(() => {
                // Draw every wall line, but only label walls that won't collide with a neighbour.
                let lastLabelX = -Infinity;
                return s.walls
                  .filter((w) => w.price >= view.lo && w.price <= view.hi)
                  .sort((a, b) => a.price - b.price)
                  .map((w) => {
                    const x = view.x(w.price);
                    const label = x - lastLabelX > 90;
                    if (label) lastLabelX = x;
                    return (
                      <g key={`${w.side}${w.price}`}>
                        <line x1={x} x2={x} y1={14} y2={H - padB} className={`wall-line ${w.side}`} />
                        {label && (
                          <text x={Math.min(Math.max(x, 40), W - 40)} y={11} textAnchor="middle" className="wall-tag">
                            {w.side === 'ask' ? '▼' : '▲'} {fmtUsd(w.notional)}
                            {w.status === 'eaten' ? ' eaten' : ''}
                          </text>
                        )}
                      </g>
                    );
                  });
              })()}
              {s.setup.trigger !== null && s.setup.trigger >= view.lo && s.setup.trigger <= view.hi && (
                <line x1={view.x(s.setup.trigger)} x2={view.x(s.setup.trigger)} y1={0} y2={H - padB} className="trigger-line" />
              )}
              <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="axis" />
              <text x={4} y={H - 6} className="tick">
                {fmtPx(view.lo)}
              </text>
              <text x={W / 2} y={H - 6} className="tick" textAnchor="middle">
                mid {fmtPx(mid!)}
              </text>
              <text x={W - 4} y={H - 6} className="tick" textAnchor="end">
                {fmtPx(view.hi)}
              </text>
              {hover && <line x1={hover.x} x2={hover.x} y1={0} y2={H - padB} className="crosshair" />}
            </svg>
            {hover && tip && (
              <div className="tooltip" style={{ left: `${(hover.x / W) * 100}%` }}>
                <strong>{fmtPx(hover.price)}</strong> <span className="muted">({tip.bps >= 0 ? '+' : ''}{tip.bps.toFixed(1)} bps)</span>
                <br />
                <span className={tip.side === 'bid' ? 'bid-t' : 'ask-t'}>{tip.side === 'bid' ? '▲ bids' : '▼ asks'}</span> to here: {fmtQty(tip.cum)} · {fmtUsd(tip.notional)}
              </div>
            )}
          </div>
          <p className="caption">
            Cumulative resting size from the touch outward. Marked lines are detected walls; the dashed line is the active trigger.
          </p>
        </>
      )}
    </Panel>
  );
}
