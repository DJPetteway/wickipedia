import type { EngineSnapshot } from '../../engine/engine';
import { fmtAge, fmtPx, fmtQty, fmtUsd } from '../format';
import { DivergingBar, Panel, Sparkline } from './common';

export function ImbalancePanel({ s }: { s: EngineSnapshot }) {
  return (
    <Panel title="Book imbalance" lesson="imbalance" id="imbalance">
      {s.imbalance.length === 0 ? (
        <div className="empty">Waiting for a synced book.</div>
      ) : (
        <div className="dbars">
          {s.imbalance.map((b) => (
            <DivergingBar
              key={b.bandBps}
              value={b.value}
              label={`±${(b.bandBps / 100).toFixed(2)}%`}
              detail={`${fmtQty(b.bidQty)} bid · ${fmtQty(b.askQty)} ask`}
            />
          ))}
        </div>
      )}
      {s.microprice !== null && s.mid !== null && (
        <p className="caption">
          Microprice {fmtPx(s.microprice)} ({s.microprice >= s.mid ? 'above' : 'below'} mid by {Math.abs(((s.microprice - s.mid) / s.mid) * 1e4).toFixed(2)} bps) — the
          size-weighted touch leans {s.microprice >= s.mid ? 'up' : 'down'}.
        </p>
      )}
    </Panel>
  );
}

function SplitBar({ buy, sell, label }: { buy: number; sell: number; label: string }) {
  const tot = buy + sell;
  const b = tot > 0 ? (buy / tot) * 100 : 50;
  return (
    <div className="split" aria-label={`${label}: ${fmtUsd(buy)} market buys, ${fmtUsd(sell)} market sells`} role="img">
      <div className="split-h">
        <span className="bid-t">▲ {fmtUsd(buy)}</span>
        <span className="muted">{label}</span>
        <span className="ask-t">{fmtUsd(sell)} ▼</span>
      </div>
      <div className="split-track">
        {tot > 0 ? (
          <>
            <span className="split-b" style={{ width: `${b}%` }} />
            <span className="split-s" style={{ width: `${100 - b}%` }} />
          </>
        ) : (
          <span className="split-none">no trades</span>
        )}
      </div>
    </div>
  );
}

export function FlowPanel({ s }: { s: EngineSnapshot }) {
  const f = s.flow;
  const z = s.ofi.z;
  return (
    <Panel title="Aggressive flow" lesson="flow" id="flow" kicker={<span className="muted">{f.tradesPerSec.toFixed(1)} trades/s</span>}>
      <SplitBar buy={f.buyNotional10} sell={f.sellNotional10} label="10s" />
      <SplitBar buy={f.buyNotional60} sell={f.sellNotional60} label="60s" />
      <div className="mini-grid">
        <div>
          <div className="mini-h">
            CVD <span className="muted">since connect</span>
          </div>
          <div className={`mini-v ${f.cvd >= 0 ? 'bid-t' : 'ask-t'}`}>
            {f.cvd >= 0 ? '▲ +' : '▼ −'}
            {fmtQty(Math.abs(f.cvd))}
          </div>
          <Sparkline data={f.cvdSeries} label="Cumulative volume delta" width={150} height={32} />
        </div>
        <div>
          <div className="mini-h">
            OFI <span className="muted">10s, z-score</span>
          </div>
          <div className={`mini-v ${z === null ? 'muted' : z > 0 ? 'bid-t' : 'ask-t'}`}>
            {z === null ? 'baseline…' : `${z > 0 ? '▲ +' : '▼ −'}${Math.abs(z).toFixed(2)}σ`}
          </div>
          <Sparkline data={s.ofi.series} label="Order-flow imbalance (normalized)" width={150} height={32} />
        </div>
      </div>
    </Panel>
  );
}

export function WallsPanel({ s }: { s: EngineSnapshot }) {
  const recent = s.floors.filter((f) => s.now - f.ts < 15 * 60_000).slice(-4).reverse();
  return (
    <Panel title="Walls & absorption" lesson="walls" id="walls">
      {s.walls.length === 0 ? (
        <div className="empty">No walls within ±1.5% right now. A smooth book.</div>
      ) : (
        <table className="tbl">
          <caption className="sr-only">Detected liquidity walls</caption>
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Price</th>
              <th scope="col">Size</th>
              <th scope="col">Dist</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {s.walls.slice(0, 6).map((w) => (
              <tr key={`${w.side}${w.price}`}>
                <td className={w.side === 'bid' ? 'bid-t' : 'ask-t'}>{w.side === 'bid' ? '▲ BID' : '▼ ASK'}</td>
                <td className="num">{fmtPx(w.price)}</td>
                <td className="num">
                  {fmtUsd(w.notional)} <span className="muted">{w.multiple.toFixed(0)}×</span>
                </td>
                <td className="num">{w.distanceBps.toFixed(1)}bp</td>
                <td>
                  {w.status === 'eaten' ? (
                    <span className="chip hot">eaten {(w.eatenFrac * 100).toFixed(0)}%</span>
                  ) : w.eatenFrac > 0.1 ? (
                    <span className="chip warm">nibbled {(w.eatenFrac * 100).toFixed(0)}%</span>
                  ) : (
                    <span className="chip">holding {fmtAge(w.ageSec * 1000)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="sub">Floors & ceilings <span className="muted">(last 15 min)</span></h3>
      {recent.length === 0 ? (
        <div className="empty small">No absorption detected yet. Floors appear when heavy selling fails to move price.</div>
      ) : (
        <ul className="floors">
          {recent.map((f) => {
            const above = s.mid !== null ? s.mid >= f.level : null;
            const holding = f.kind === 'floor' ? above : above === null ? null : !above;
            return (
              <li key={`${f.kind}${f.ts}`}>
                <span className={f.kind === 'floor' ? 'bid-t' : 'ask-t'}>{f.kind === 'floor' ? '▲ FLOOR' : '▼ CEILING'}</span>
                <span className="num">{fmtPx(f.level)}</span>
                <span className="muted">{fmtAge(s.now - f.ts)} ago</span>
                <span className={`chip ${holding ? '' : 'hot'}`}>{holding === null ? '—' : holding ? 'holding' : 'broken'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
