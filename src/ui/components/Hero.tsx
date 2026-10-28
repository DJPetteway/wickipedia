import type { EngineSnapshot } from '../../engine/engine';
import { STATE_META, STATE_ORDER } from '../content';
import { fmtAge, fmtPx } from '../format';
import { LearnButton, Sparkline } from './common';

function Gauge({ score, ready }: { score: number; ready: boolean }) {
  const W = 220;
  const H = 128;
  const cx = W / 2;
  const cy = 112;
  const r = 92;
  const angle = Math.PI * (1 - (score + 1) / 2); // −1 → π (left), +1 → 0 (right)
  const nx = cx + Math.cos(angle) * (r - 14);
  const ny = cy - Math.sin(angle) * (r - 14);
  const arc = (a0: number, a1: number) => {
    const p0 = [cx + Math.cos(a0) * r, cy - Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy - Math.sin(a1) * r];
    return `M${p0[0]},${p0[1]} A${r},${r} 0 0 1 ${p1[0]},${p1[1]}`;
  };
  const lean = !ready ? 'warming up' : Math.abs(score) < 0.12 ? 'balanced' : score > 0 ? 'buyers leaning' : 'sellers leaning';
  return (
    <figure className="gauge" aria-label={`Pressure score ${ready ? score.toFixed(2) : 'not ready'}, ${lean}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden="true">
        <path d={arc(Math.PI, Math.PI * 0.62)} className="g-arc ask" />
        <path d={arc(Math.PI * 0.6, Math.PI * 0.4)} className="g-arc mid" />
        <path d={arc(Math.PI * 0.38, 0)} className="g-arc bid" />
        {[-1, -0.5, 0, 0.5, 1].map((t) => {
          const a = Math.PI * (1 - (t + 1) / 2);
          return (
            <line key={t} x1={cx + Math.cos(a) * (r + 6)} y1={cy - Math.sin(a) * (r + 6)} x2={cx + Math.cos(a) * (r + 12)} y2={cy - Math.sin(a) * (r + 12)} className="g-tick" />
          );
        })}
        {ready && (
          <>
            <line x1={cx} y1={cy} x2={nx} y2={ny} className="g-needle" />
            <circle cx={cx} cy={cy} r={6} className="g-hub" />
          </>
        )}
        <text x={14} y={H - 2} className="g-end">▼ SELLERS</text>
        <text x={W - 14} y={H - 2} className="g-end" textAnchor="end">BUYERS ▲</text>
      </svg>
      <figcaption>
        <span className="g-score">{ready ? (score >= 0 ? '+' : '−') + Math.abs(score).toFixed(2) : '—'}</span>
        <span className="g-lean">{lean}</span>
      </figcaption>
    </figure>
  );
}

export function Hero({ s }: { s: EngineSnapshot }) {
  const meta = STATE_META[s.setup.state];
  const dir = s.setup.direction;
  const price = s.mid ?? s.lastTradePrice;
  const series = s.priceSeries;
  const chg = series.length > 60 && price ? ((price - series[series.length - 61]) / series[series.length - 61]) * 1e4 : null;
  const bookAge = s.health.lastBookUpdateAt ? s.now - s.health.lastBookUpdateAt : null;
  const parts = s.scoreParts;
  const stateIdx = STATE_ORDER.indexOf(s.setup.state);

  return (
    <section className={`hero state-${s.setup.state.toLowerCase()} ${dir ? `dir-${dir}` : ''}`} aria-labelledby="hero-h">
      <div className="hero-price">
        <div className="hero-sym">
          <h2 id="hero-h">{s.symbol}</h2>
          <span className="venue-tag" title="Centralized-exchange limit order book (not a DEX pool)">
            {s.venue.name} · CEX L2 book
          </span>
        </div>
        <div className="px" aria-live="off">
          {price ? fmtPx(price) : '—'}
        </div>
        <div className="px-sub">
          {chg !== null && (
            <span className={chg >= 0 ? 'up' : 'down'}>
              {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(1)} bps · 1m
            </span>
          )}
          <span>spread {s.spreadBps !== null ? `${s.spreadBps.toFixed(2)} bps` : '—'}</span>
          <span title="Time since the last applied book update">book age {fmtAge(bookAge)}</span>
        </div>
        <Sparkline data={series.slice(-120)} width={260} height={44} label="Mid price, last 2 minutes" className="px-spark" />
      </div>

      <div className="hero-state" role="status" aria-live="polite" aria-atomic="true">
        <div className="state-row">
          <span className="state-badge">
            <span aria-hidden="true">{meta.glyph}</span> {meta.label}
            {dir && <span className="state-dir">{dir === 'up' ? ' ↑' : ' ↓'}</span>}
          </span>
          <LearnButton lesson="states" label="setup states" />
        </div>
        <p className="state-blurb">{meta.blurb}</p>
        <p className="state-reason">{s.setup.reason}</p>
        <ol className="state-track" aria-label="Setup progress">
          {STATE_ORDER.map((st, i) => (
            <li key={st} className={i <= stateIdx && stateIdx >= 0 ? 'on' : ''} aria-current={st === s.setup.state ? 'step' : undefined}>
              {STATE_META[st].label}
            </li>
          ))}
        </ol>
        <dl className="levels">
          <div>
            <dt>Trigger</dt>
            <dd>{s.setup.trigger !== null ? fmtPx(s.setup.trigger) : '—'}</dd>
          </div>
          <div>
            <dt>Invalidation</dt>
            <dd>{s.setup.invalidation !== null ? fmtPx(s.setup.invalidation) : '—'}</dd>
          </div>
          <div>
            <dt>2m range</dt>
            <dd>
              {s.volatility.rangeLow !== null && s.volatility.rangeHigh !== null
                ? `${fmtPx(s.volatility.rangeLow)} – ${fmtPx(s.volatility.rangeHigh)}`
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="hero-gauge">
        <div className="hg-title">
          Pressure <LearnButton lesson="ofi" label="pressure score" />
        </div>
        <Gauge score={s.score} ready={s.valid && s.warmup.ready} />
        <ul className="parts" aria-label="Score components">
          {(
            [
              ['Book', parts.imbalance],
              ['OFI', parts.ofi],
              ['Flow', parts.flow],
              ['Micro', parts.microprice],
            ] as const
          ).map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <span className={v > 0.05 ? 'bid-t' : v < -0.05 ? 'ask-t' : 'muted'}>
                {v > 0.05 ? '▲' : v < -0.05 ? '▼' : '·'} {Math.abs(v).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        {!s.warmup.ready && s.valid && (
          <div className="warm" role="progressbar" aria-valuemin={0} aria-valuemax={s.warmup.need} aria-valuenow={s.warmup.have} aria-label="Baseline warmup">
            <span style={{ width: `${(s.warmup.have / s.warmup.need) * 100}%` }} />
            <em>
              Learning what normal looks like… {s.warmup.have}/{s.warmup.need}s
            </em>
          </div>
        )}
      </div>
    </section>
  );
}
