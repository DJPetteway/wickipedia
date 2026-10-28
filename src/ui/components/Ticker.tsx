import type { ActivityItem } from '../../engine/poolEngine';

/** One tiny line at the bottom: the most recent thing the engine actually did. */
export function Ticker({ items, now }: { items: ActivityItem[]; now: number }) {
  const last = items[items.length - 1];
  if (!last) return null;
  const age = Math.max(0, Math.round((now - last.ts) / 1000));
  return (
    <div className="ticker" aria-hidden="true" title={items.slice(-6).map((i) => i.text).join('\n')}>
      <span className="ticker-dot" />
      <span className="ticker-text" key={`${last.ts}${last.text}`}>
        {last.text}
      </span>
      <span className="ticker-age">{age < 1 ? 'now' : `${age}s`}</span>
    </div>
  );
}
