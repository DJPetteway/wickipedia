import { useContext, useState } from 'react';
import type { EngineSnapshot } from '../../engine/engine';
import { narrate } from '../../engine/narrative';
import type { WickEvent } from '../../engine/types';
import type { LessonId } from '../content';
import { fmtTime } from '../format';
import { LessonContext, Panel } from './common';

const CONCEPT_LESSON: Record<string, LessonId> = {
  imbalance: 'imbalance',
  flow: 'flow',
  absorption: 'absorption',
  walls: 'walls',
  compression: 'compression',
  wick: 'wick',
  floors: 'floors',
  data: 'data',
};

export function ReadsPanel({ s }: { s: EngineSnapshot }) {
  const open = useContext(LessonContext);
  const reads = narrate(s);
  return (
    <Panel title="What the book is saying" id="reads" kicker={<span className="muted">plain English, from the numbers</span>}>
      <ul className="reads">
        {reads.map((r) => (
          <li key={r.id} className={`tone-${r.tone}`}>
            <span className="read-dot" aria-hidden="true" />
            <span className="read-txt">{r.text}</span>
            <button type="button" className="read-learn" onClick={() => open(CONCEPT_LESSON[r.concept])} aria-label={`Learn about ${r.concept}`}>
              learn
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type Filter = 'all' | 'alerts' | 'state';

const isState = (e: WickEvent) =>
  ['STATE_CHANGE', 'COOKING', 'WICK_LOADING', 'IMMINENT', 'BREAKOUT_CONFIRMED', 'FALSE_ALARM'].includes(e.kind);

export function EventFeed({ s }: { s: EngineSnapshot }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const events = [...s.events]
    .reverse()
    .filter((e) => (filter === 'all' ? true : filter === 'alerts' ? e.severity !== 'info' : isState(e)))
    .slice(0, 80);
  return (
    <Panel
      title="The feed"
      lesson="states"
      id="feed"
      className="feed-panel"
      kicker={
        <div className="seg" role="group" aria-label="Filter feed">
          {(['all', 'alerts', 'state'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      }
    >
      {events.length === 0 ? (
        <div className="empty">Nothing yet. Wickipedia only speaks when the book gives it a reason.</div>
      ) : (
        <ol className="feed" aria-label="Chronological event feed, newest first">
          {events.map((e) => (
            <li key={e.id} className={`ev sev-${e.severity} ${e.direction ? `dir-${e.direction}` : ''}`}>
              <time dateTime={new Date(e.ts).toISOString()}>{fmtTime(e.ts)}</time>
              <div className="ev-main">
                <div className="ev-title">
                  {e.direction && <span aria-hidden="true" className={e.direction === 'up' ? 'bid-t' : 'ask-t'}>{e.direction === 'up' ? '▲ ' : '▼ '}</span>}
                  {e.title}
                </div>
                <div className="ev-body">{e.body}</div>
                {e.lesson && (
                  <button type="button" className="linkish" aria-expanded={openId === e.id} onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                    {openId === e.id ? 'hide lesson' : 'why it matters'}
                  </button>
                )}
                {openId === e.id && <p className="ev-lesson">{e.lesson}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
