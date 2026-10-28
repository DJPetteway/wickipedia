import type { EngineSnapshot } from '../../engine/engine';
import { STATE_META } from '../content';
import { fmtHorizon, fmtPct, fmtPx, fmtTime } from '../format';
import { Sparkline } from './common';
import { HealthPill, Logo } from './Header';

/** Compact, glanceable view — for a pop-out window, a second monitor or a stream overlay. */
export function Widget({ s, custom, onExpand }: { s: EngineSnapshot; custom: boolean; onExpand: () => void }) {
  const meta = STATE_META[s.setup.state];
  const price = s.mid ?? s.lastTradePrice;
  const est = s.estimates.find((e) => e.horizonSec === 300) ?? s.estimates[0];
  const alerts = [...s.events].reverse().filter((e) => e.severity !== 'info').slice(0, 3);
  const ready = s.valid && s.warmup.ready;
  const imb = s.imbalance.find((b) => b.bandBps === 25);
  return (
    <main className={`widget state-${s.setup.state.toLowerCase()} ${s.setup.direction ? `dir-${s.setup.direction}` : ''}`}>
      <header className="w-h">
        <Logo size={26} />
        <div className="w-title">
          <strong>Wickipedia</strong>
          <span className="muted">
            {s.venue.name} · {s.symbol} · CEX book
          </span>
        </div>
        <button type="button" className="btn small" onClick={onExpand}>
          Full view
        </button>
      </header>
      <HealthPill s={s} custom={custom} />
      <div className="w-price">
        <span className="px">{price ? fmtPx(price) : '—'}</span>
        <Sparkline data={s.priceSeries.slice(-90)} width={120} height={34} label="Mid price, 90s" />
      </div>
      <div className="w-state" role="status" aria-live="polite">
        <span className="state-badge">
          <span aria-hidden="true">{meta.glyph}</span> {meta.label}
          {s.setup.direction && (s.setup.direction === 'up' ? ' ↑' : ' ↓')}
        </span>
        <span className="w-blurb">{meta.blurb}</span>
      </div>
      <div className="w-row">
        <div>
          <span className="muted">Pressure</span>
          <strong className={!ready ? 'muted' : s.score > 0.05 ? 'bid-t' : s.score < -0.05 ? 'ask-t' : ''}>
            {ready ? `${s.score > 0 ? '▲ +' : s.score < 0 ? '▼ −' : ''}${Math.abs(s.score).toFixed(2)}` : 'warming'}
          </strong>
        </div>
        <div>
          <span className="muted">Book ±0.25%</span>
          <strong className={imb ? (imb.value > 0.05 ? 'bid-t' : imb.value < -0.05 ? 'ask-t' : '') : 'muted'}>
            {imb ? `${imb.value > 0 ? '▲' : '▼'} ${Math.abs(imb.value * 100).toFixed(0)}%` : '—'}
          </strong>
        </div>
        <div>
          <span className="muted">{est ? `${fmtHorizon(est.horizonSec)} odds` : 'odds'}</span>
          <strong className={est?.ready ? '' : 'muted'}>
            {est?.ready ? `▲${fmtPct(est.up.p)} ▼${fmtPct(est.down.p)}` : 'calibrating'}
          </strong>
        </div>
      </div>
      {(s.setup.trigger !== null || s.setup.invalidation !== null) && (
        <div className="w-levels">
          <span>trigger {s.setup.trigger !== null ? fmtPx(s.setup.trigger) : '—'}</span>
          <span>invalid {s.setup.invalidation !== null ? fmtPx(s.setup.invalidation) : '—'}</span>
        </div>
      )}
      <ol className="w-alerts" aria-label="Latest alerts">
        {alerts.length === 0 ? (
          <li className="muted">No alerts yet. Quiet book.</li>
        ) : (
          alerts.map((e) => (
            <li key={e.id} className={`sev-${e.severity}`}>
              <time>{fmtTime(e.ts)}</time> <strong>{e.title}</strong>
              <span className="w-body">{e.body}</span>
            </li>
          ))
        )}
      </ol>
    </main>
  );
}
