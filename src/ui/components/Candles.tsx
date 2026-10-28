import { useState } from 'react';
import { anatomy, type Candle } from '../../engine/candles';
import type { EngineSnapshot } from '../../engine/engine';
import { explainCandle } from '../../engine/narrative';
import type { EventKind } from '../../engine/types';
import { fmtPct, fmtPx, fmtQty, fmtTime } from '../format';
import { Panel, useWidth } from './common';

const MARKS: Partial<Record<EventKind, { glyph: string; cls: string; label: string }>> = {
  FLOOR_FORMING: { glyph: '▲', cls: 'bid-t', label: 'floor' },
  CEILING_FORMING: { glyph: '▼', cls: 'ask-t', label: 'ceiling' },
  BREAKOUT_CONFIRMED: { glyph: '★', cls: 'hot-t', label: 'breakout' },
  FALSE_ALARM: { glyph: '✕', cls: 'muted', label: 'false alarm' },
  WALL_EATEN: { glyph: '◆', cls: 'hot-t', label: 'wall eaten' },
};

/** Static anatomy diagram — the "how to read a wick" cheat sheet. */
export function WickDiagram() {
  return (
    <svg viewBox="0 0 300 150" className="wick-diagram" role="img" aria-label="Candle anatomy: upper wick above the body, lower wick below">
      <line x1="60" y1="12" x2="60" y2="138" className="wd-wick" />
      <rect x="44" y="48" width="32" height="40" rx="3" className="wd-body" />
      <line x1="84" y1="12" x2="120" y2="12" className="wd-guide" />
      <text x="124" y="16">high — buyers reached here</text>
      <line x1="84" y1="30" x2="120" y2="30" className="wd-guide" />
      <text x="124" y="34">upper wick = rejected up</text>
      <line x1="84" y1="68" x2="120" y2="68" className="wd-guide" />
      <text x="124" y="72">body = open ↔ close</text>
      <line x1="84" y1="112" x2="120" y2="112" className="wd-guide" />
      <text x="124" y="116">lower wick = rejected down</text>
      <line x1="84" y1="138" x2="120" y2="138" className="wd-guide" />
      <text x="124" y="142">low — sellers reached here</text>
    </svg>
  );
}

export function CandlesPanel({ s }: { s: EngineSnapshot }) {
  const candles = s.candles.slice(-40);
  const [sel, setSel] = useState<number | null>(null);
  const idx = sel !== null && sel < candles.length ? sel : Math.max(0, candles.length - 2);
  const c: Candle | undefined = candles[idx];

  const [wrapRef, W] = useWidth<HTMLDivElement>();
  const H = 200;
  const pad = 16;
  const lo = Math.min(...candles.map((k) => k.l));
  const hi = Math.max(...candles.map((k) => k.h));
  const y = (p: number) => pad + (1 - (p - lo) / (hi - lo || 1)) * (H - pad * 2);
  const slot = W / Math.max(candles.length, 1);
  const bw = Math.max(3, slot * 0.6);

  const minuteEvents = (k: Candle) => s.events.filter((e) => e.ts >= k.t && e.ts < k.t + 60_000 && MARKS[e.kind]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setSel(Math.max(0, idx - 1));
    else if (e.key === 'ArrowRight') setSel(Math.min(candles.length - 1, idx + 1));
    else return;
    e.preventDefault();
  };

  const a = c ? anatomy(c) : null;
  const read = c ? explainCandle(c) : null;
  const evs = c ? minuteEvents(c) : [];

  return (
    <Panel title="Wick explainer · 1m" lesson="wick" id="candles" className="span-2">
      {candles.length === 0 ? (
        <div className="empty">Candles build from live trades (and venue history when available).</div>
      ) : (
        <div className="candles-wrap">
          <div ref={wrapRef} className="chart-wrap">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="candles"
            role="img"
            tabIndex={0}
            onKeyDown={onKey}
            aria-label={`1-minute candles. Use left and right arrows to inspect. Selected ${c ? fmtTime(c.t) : ''}.`}
          >
            {candles.map((k, i) => {
              const cx = slot * i + slot / 2;
              const up = k.c >= k.o;
              const marks = minuteEvents(k);
              return (
                <g key={k.t} className={`cndl ${up ? 'up' : 'down'} ${i === idx ? 'sel' : ''} ${k.live ? '' : 'hist'}`} onPointerEnter={() => setSel(i)}>
                  <rect x={slot * i} y={0} width={slot} height={H} className="hit" />
                  <line x1={cx} x2={cx} y1={y(k.h)} y2={y(k.l)} className="c-wick" />
                  <rect x={cx - bw / 2} y={y(Math.max(k.o, k.c))} width={bw} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} rx={1.5} className="c-body" />
                  {marks.slice(0, 2).map((m, j) => (
                    <text key={m.id} x={cx} y={H - 2 - j * 10} textAnchor="middle" className={`c-mark ${MARKS[m.kind]!.cls}`}>
                      {MARKS[m.kind]!.glyph}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
          </div>
          {c && a && (
            <div className="anatomy" aria-live="polite">
              <div className="an-h">
                <strong>{fmtTime(c.t)}</strong> {c.live ? <span className="chip ok">live trades</span> : <span className="chip">venue history</span>}
              </div>
              <div className="an-bars" aria-hidden="true">
                <span className="an-up" style={{ flexGrow: a.upperFrac || 0.001 }}>
                  {a.upperFrac > 0.15 ? `upper ${fmtPct(a.upperFrac)}` : ''}
                </span>
                <span className={`an-body ${a.bullish ? 'bull' : 'bear'}`} style={{ flexGrow: a.bodyFrac || 0.001 }}>
                  {a.bodyFrac > 0.15 ? `body ${fmtPct(a.bodyFrac)}` : ''}
                </span>
                <span className="an-low" style={{ flexGrow: a.lowerFrac || 0.001 }}>
                  {a.lowerFrac > 0.15 ? `lower ${fmtPct(a.lowerFrac)}` : ''}
                </span>
              </div>
              <dl className="ohlc">
                <div><dt>O</dt><dd>{fmtPx(c.o)}</dd></div>
                <div><dt>H</dt><dd>{fmtPx(c.h)}</dd></div>
                <div><dt>L</dt><dd>{fmtPx(c.l)}</dd></div>
                <div><dt>C</dt><dd>{fmtPx(c.c)}</dd></div>
                {c.buyVol + c.sellVol > 0 && (
                  <>
                    <div><dt className="bid-t">▲ buys</dt><dd>{fmtQty(c.buyVol)}</dd></div>
                    <div><dt className="ask-t">▼ sells</dt><dd>{fmtQty(c.sellVol)}</dd></div>
                  </>
                )}
              </dl>
              {read && <p className={`an-read tone-${read.tone}`}>{read.text.replace('Last candle', 'This candle')}</p>}
              {evs.length > 0 && (
                <ul className="an-evs">
                  {evs.map((e) => (
                    <li key={e.id}>
                      <span className={MARKS[e.kind]!.cls}>{MARKS[e.kind]!.glyph}</span> {fmtTime(e.ts)} — {e.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <p className="caption">
        Hover or arrow-key through candles. Markers: <span className="bid-t">▲ floor</span> · <span className="ask-t">▼ ceiling</span> · <span className="hot-t">◆ wall eaten · ★ breakout</span> · ✕ false alarm.
      </p>
    </Panel>
  );
}
