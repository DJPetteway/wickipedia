import type { EngineSnapshot } from '../../engine/engine';
import { fmtHorizon, fmtPct } from '../format';
import { Panel } from './common';

export function EstimatesPanel({ s, onReset }: { s: EngineSnapshot; onReset: () => void }) {
  const ready = s.valid && s.warmup.ready;
  return (
    <Panel
      title="Breakout odds (calibrated)"
      lesson="estimates"
      id="estimates"
      kicker={<span className="muted">{s.estimates[0]?.bucketLabel ?? ''}</span>}
    >
      {!ready && <div className="empty small">Estimates appear once the book is live and baselined.</div>}
      <ul className="est">
        {s.estimates.map((e) => {
          const lowConf = !e.ready;
          const fmtI = (i: { p: number; lo: number; hi: number }) => `${fmtPct(i.p)} (${fmtPct(i.lo)}–${fmtPct(i.hi)})`;
          return (
            <li key={e.horizonSec} className={lowConf ? 'calibrating' : ''}>
              <div className="est-h">
                <strong>{fmtHorizon(e.horizonSec)}</strong>
                <span className="muted">barrier ±{e.barrierBps !== null ? e.barrierBps.toFixed(1) : '—'} bps</span>
                <span className={`chip ${lowConf ? '' : 'ok'}`}>{lowConf ? `calibrating · n_eff ${e.nEff.toFixed(1)}/10` : `n ${e.n} · n_eff ${e.nEff.toFixed(0)}`}</span>
              </div>
              {e.n === 0 ? (
                <p className="est-none">No resolved samples in this bucket yet — no number to show. {e.pending > 0 ? `${e.pending} in flight.` : ''}</p>
              ) : (
                <>
                  <div
                    className="est-bar"
                    role="img"
                    aria-label={`${fmtHorizon(e.horizonSec)}: up first ${fmtI(e.up)}, no break ${fmtPct(e.flat.p)}, down first ${fmtI(e.down)}. ${e.n} samples.`}
                  >
                    <span className="eb-up" style={{ width: `${e.up.p * 100}%` }}>
                      {e.up.p > 0.12 ? `▲ ${fmtPct(e.up.p)}` : ''}
                    </span>
                    <span className="eb-flat" style={{ width: `${e.flat.p * 100}%` }}>
                      {e.flat.p > 0.12 ? fmtPct(e.flat.p) : ''}
                    </span>
                    <span className="eb-down" style={{ width: `${e.down.p * 100}%` }}>
                      {e.down.p > 0.12 ? `${fmtPct(e.down.p)} ▼` : ''}
                    </span>
                  </div>
                  <p className="est-txt">
                    <span className="bid-t">▲ up first {fmtI(e.up)}</span> · <span className="ask-t">▼ down first {fmtI(e.down)}</span>
                    <br />
                    <span className="muted">
                      base rate (all readings): ▲ {fmtPct(e.baseUp)} · ▼ {fmtPct(e.baseDown)}
                      {e.pending ? ` · ${e.pending} in flight` : ''}
                    </span>
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <h3 className="sub">Did floors hold?</h3>
      <table className="tbl compact">
        <caption className="sr-only">Floor and ceiling hold rates by horizon</caption>
        <thead>
          <tr>
            <th scope="col">Level</th>
            {s.estimates.map((e) => (
              <th scope="col" key={e.horizonSec}>
                {fmtHorizon(e.horizonSec)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(['floor', 'ceiling'] as const).map((k) => (
            <tr key={k}>
              <th scope="row" className={k === 'floor' ? 'bid-t' : 'ask-t'}>
                {k === 'floor' ? '▲ Floors' : '▼ Ceilings'}
              </th>
              {s.levelHolds
                .filter((h) => h.kind === k)
                .map((h) => (
                  <td key={h.horizonSec} className="num">
                    {h.held + h.broken === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <>
                        {h.held}/{h.held + h.broken}
                        {!h.ready && <span className="muted"> (few)</span>}
                      </>
                    )}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        Counted live on {s.venue.name} {s.symbol}, stored in this browser. These are observed frequencies, not guarantees.{' '}
        <button type="button" className="linkish" onClick={onReset}>
          Reset calibration
        </button>
      </p>
    </Panel>
  );
}
