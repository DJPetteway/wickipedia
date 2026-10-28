import type { EngineSnapshot } from '../../engine/engine';
import type { FeedStatus } from '../../engine/types';
import { VENUES, type VenueDef } from '../../feeds';
import { fmtAge } from '../format';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="logo">
      <defs>
        <radialGradient id="wk-glow" cx="50%" cy="20%" r="60%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="40" height="40" rx="11" className="logo-bg" />
      <circle cx="20" cy="9" r="8" fill="url(#wk-glow)" className="logo-flame" />
      <line x1="20" y1="5" x2="20" y2="35" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="13" y="13" width="14" height="12" rx="3" fill="var(--accent)" />
      <circle cx="17.5" cy="18.5" r="1.4" fill="#0b0c10" />
      <circle cx="22.5" cy="18.5" r="1.4" fill="#0b0c10" />
    </svg>
  );
}

const STATUS_LABEL: Record<FeedStatus, string> = {
  idle: 'idle',
  connecting: 'connecting',
  syncing: 'syncing book',
  live: 'live',
  resyncing: 'resyncing',
  stale: 'stale',
  error: 'disconnected',
  closed: 'closed',
};

export function HealthPill({ s, custom }: { s: EngineSnapshot; custom: boolean }) {
  const h = s.health;
  const ok = s.valid && h.status === 'live';
  const age = h.lastMessageAt ? s.now - h.lastMessageAt : null;
  const tone = ok ? 'ok' : h.status === 'syncing' || h.status === 'connecting' || h.status === 'resyncing' ? 'warn' : 'bad';
  return (
    <div
      className={`health ${tone}`}
      role="status"
      aria-label={`Market data ${STATUS_LABEL[h.status]}. Last message ${fmtAge(age)} ago. Latency ${h.latencyMs !== null ? Math.round(h.latencyMs) + ' ms' : 'unknown'}.`}
      title={h.detail ?? ''}
    >
      <span className="h-dot" aria-hidden="true" />
      <strong>{STATUS_LABEL[h.status].toUpperCase()}</strong>
      <span className="h-meta">
        <span title="Local receive − exchange event time (includes clock offset)">{h.latencyMs !== null ? `${Math.round(h.latencyMs)}ms` : '—'}</span>
        <span>{h.messagesPerSec.toFixed(0)} msg/s</span>
        <span title="Time since last message">{fmtAge(age)}</span>
        {h.resyncs > 0 && <span title="Book resyncs this session">{h.resyncs} resync</span>}
        {custom && <span className="custom">custom endpoint</span>}
      </span>
    </div>
  );
}

export function Header({
  s,
  venue,
  symbol,
  onVenue,
  onSymbol,
  notify,
  onNotify,
  palette,
  onPalette,
  onSchool,
  onWidget,
  custom,
}: {
  s: EngineSnapshot | null;
  venue: VenueDef;
  symbol: string;
  onVenue: (id: string) => void;
  onSymbol: (sym: string) => void;
  notify: NotificationPermission | 'off' | 'unsupported';
  onNotify: () => void;
  palette: 'trader' | 'cvd';
  onPalette: () => void;
  onSchool: () => void;
  onWidget: () => void;
  custom: boolean;
}) {
  return (
    <header className="top">
      <div className="brand">
        <Logo />
        <div>
          <h1>
            Wickipedia
          </h1>
          <p className="tagline">Read the book. See the wick coming.</p>
        </div>
      </div>
      <div className="controls">
        <label className="ctl">
          <span>Venue</span>
          <select value={venue.id} onChange={(e) => onVenue(e.target.value)}>
            {VENUES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ctl">
          <span>Pair</span>
          <input
            list="wk-symbols"
            defaultValue={symbol}
            key={`${venue.id}:${symbol}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSymbol((e.target as HTMLInputElement).value);
            }}
            onBlur={(e) => e.target.value !== symbol && onSymbol(e.target.value)}
            spellCheck={false}
            size={10}
            aria-describedby="sym-hint"
          />
          <datalist id="wk-symbols">
            {venue.symbols.map((x) => (
              <option key={x.id} value={x.id} />
            ))}
          </datalist>
          <span id="sym-hint" className="sr-only">
            Type a pair like {venue.symbols[0].id} and press Enter.
          </span>
        </label>
        {s && <HealthPill s={s} custom={custom} />}
        <div className="btns">
          <button type="button" className="btn" onClick={onSchool}>
            Wick School
          </button>
          <button
            type="button"
            className="btn"
            onClick={onNotify}
            aria-pressed={notify === 'granted'}
            disabled={notify === 'unsupported' || notify === 'denied'}
            title={notify === 'denied' ? 'Notifications are blocked in your browser settings' : 'Desktop alerts for high-severity events'}
          >
            {notify === 'granted' ? 'Alerts on' : notify === 'denied' ? 'Alerts blocked' : 'Enable alerts'}
          </button>
          <button type="button" className="btn" onClick={onPalette} aria-pressed={palette === 'cvd'} title="Switch bid/ask colors to a colorblind-safe blue/orange pair">
            {palette === 'cvd' ? 'Colors: CVD-safe' : 'Colors: trader'}
          </button>
          <button type="button" className="btn accent" onClick={onWidget} title="Open a compact always-on widget window">
            Pop-out widget
          </button>
        </div>
      </div>
    </header>
  );
}
