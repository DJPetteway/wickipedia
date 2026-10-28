import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WickEvent } from '../engine/types';
import { VENUES, findVenue, normalizeSymbol } from '../feeds';
import { FlowPanel, ImbalancePanel, WallsPanel } from './components/BookPanels';
import { CandlesPanel } from './components/Candles';
import { LessonContext } from './components/common';
import { DepthChart } from './components/DepthChart';
import { EstimatesPanel } from './components/Estimates';
import { EventFeed, ReadsPanel } from './components/Feed';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { WickSchool } from './components/WickSchool';
import { Widget } from './components/Widget';
import type { LessonId } from './content';
import { fmtPx } from './format';
import { browserStore, useWickipedia } from './useWickipedia';

function readParams() {
  const p = new URLSearchParams(location.search);
  const venue = findVenue(p.get('venue') ?? '') ?? VENUES[0];
  const symbol = p.get('symbol') ? normalizeSymbol(venue, p.get('symbol')!) : venue.symbols[0].id;
  return {
    venueId: venue.id,
    symbol,
    widget: p.get('view') === 'widget',
    // Endpoint overrides exist for local testing against a mock exchange. They are always shown in the UI.
    ws: p.get('ws') ?? undefined,
    rest: p.get('rest') ?? undefined,
  };
}

function writeParams(next: Record<string, string | undefined>) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(next)) v === undefined ? p.delete(k) : p.set(k, v);
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

const notifySupported = typeof Notification !== 'undefined';

export function App() {
  const initial = useMemo(readParams, []);
  const [venueId, setVenueId] = useState(initial.venueId);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [widget, setWidget] = useState(initial.widget);
  const [palette, setPalette] = useState<'trader' | 'cvd'>(() => (browserStore.get('wickipedia:palette') === 'cvd' ? 'cvd' : 'trader'));
  const [notifyOn, setNotifyOn] = useState(() => browserStore.get('wickipedia:notify') === '1');
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(notifySupported ? Notification.permission : 'unsupported');
  const [toast, setToast] = useState<WickEvent | null>(null);
  const [school, setSchool] = useState<{ open: boolean; focus: LessonId | null }>({ open: false, focus: null });
  const lastNotified = useRef<Record<string, number>>({});
  const venue = findVenue(venueId)!;
  const endpoints = useMemo(() => ({ ws: initial.ws, rest: initial.rest }), [initial.ws, initial.rest]);
  const custom = !!(initial.ws || initial.rest);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    browserStore.set('wickipedia:palette', palette);
  }, [palette]);

  const onEvent = useCallback(
    (e: WickEvent) => {
      if (e.severity !== 'alert') return;
      setToast(e);
      if (!notifyOn || perm !== 'granted') return;
      const last = lastNotified.current[e.kind] ?? 0;
      if (e.ts - last < 20_000) return;
      lastNotified.current[e.kind] = e.ts;
      try {
        new Notification(`${e.title} · ${symbol}`, { body: e.body, tag: `wk-${e.kind}`, silent: false });
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    },
    [notifyOn, perm, symbol],
  );

  const { snap, engine } = useWickipedia(venueId, symbol, endpoints, onEvent);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!snap) return;
    const px = snap.mid ?? snap.lastTradePrice;
    const st = snap.setup.state;
    const flag = st === 'NEUTRAL' ? '' : `${st}${snap.setup.direction === 'up' ? '↑' : snap.setup.direction === 'down' ? '↓' : ''} · `;
    document.title = `${flag}${px ? fmtPx(px) : '…'} ${snap.symbol} · Wickipedia`;
  }, [snap]);

  const changeVenue = (id: string) => {
    const v = findVenue(id)!;
    setVenueId(v.id);
    setSymbol(v.symbols[0].id);
    writeParams({ venue: v.id, symbol: v.symbols[0].id });
  };
  const changeSymbol = (raw: string) => {
    const sym = normalizeSymbol(venue, raw);
    if (!sym) return;
    setSymbol(sym);
    writeParams({ symbol: sym });
  };
  const toggleNotify = async () => {
    if (!notifySupported) return;
    if (notifyOn) {
      setNotifyOn(false);
      browserStore.set('wickipedia:notify', '0');
      return;
    }
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPerm(p);
    if (p === 'granted') {
      setNotifyOn(true);
      browserStore.set('wickipedia:notify', '1');
    }
  };
  const popWidget = () => {
    const p = new URLSearchParams(location.search);
    p.set('view', 'widget');
    p.set('venue', venueId);
    p.set('symbol', symbol);
    const w = window.open(`${location.pathname}?${p.toString()}`, `wickipedia-${venueId}-${symbol}`, 'width=400,height=640');
    if (!w) {
      setWidget(true);
      writeParams({ view: 'widget' });
    }
  };
  const openLesson = useCallback((id: LessonId) => setSchool({ open: true, focus: id }), []);

  if (!snap) return <div className="boot">Licking the order book…</div>;

  if (widget) {
    return (
      <LessonContext.Provider value={openLesson}>
        <Widget
          s={snap}
          custom={custom}
          onExpand={() => {
            setWidget(false);
            writeParams({ view: undefined });
          }}
        />
      </LessonContext.Provider>
    );
  }

  return (
    <LessonContext.Provider value={openLesson}>
      <a href="#feed" className="skip">
        Skip to the feed
      </a>
      <Header
        s={snap}
        venue={venue}
        symbol={symbol}
        onVenue={changeVenue}
        onSymbol={changeSymbol}
        notify={!notifySupported ? 'unsupported' : notifyOn && perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'off'}
        onNotify={toggleNotify}
        palette={palette}
        onPalette={() => setPalette(palette === 'trader' ? 'cvd' : 'trader')}
        onSchool={() => setSchool({ open: true, focus: null })}
        onWidget={popWidget}
        custom={custom}
      />
      {!snap.valid && (
        <div className="banner" role="alert">
          <strong>No trustworthy data right now:</strong> {snap.invalidReason}. {venue.note}
          {snap.health.status === 'error' && venue.id === 'binance' && ' If Binance is blocked where you are, try Binance.US or Coinbase.'}
        </div>
      )}
      <main className="grid">
        <Hero s={snap} />
        <DepthChart s={snap} />
        <ReadsPanel s={snap} />
        <ImbalancePanel s={snap} />
        <FlowPanel s={snap} />
        <WallsPanel s={snap} />
        <EstimatesPanel s={snap} onReset={() => engine.current?.resetCalibration()} />
        <CandlesPanel s={snap} />
        <EventFeed s={snap} />
      </main>
      <footer className="foot">
        <p>
          <strong>CEX order book only.</strong> Data: {venue.name} public market data ({venue.note}) DEX/AMM pool liquidity is a different structure and is not
          shown or inferred here.{' '}
          <button type="button" className="linkish" onClick={() => openLesson('cexdex')}>
            CEX vs DEX
          </button>
        </p>
        <p className="muted">
          Wickipedia reads the book; it doesn&apos;t know the future. Every number is measured from live data or counted from what happened after similar readings.
          Not financial advice.
        </p>
      </footer>
      {toast && (
        <div className={`toast dir-${toast.direction ?? "none"}`} role="status">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
          <button type="button" className="btn small" onClick={() => setToast(null)} aria-label="Dismiss alert">
            ✕
          </button>
        </div>
      )}
      <WickSchool
        open={school.open}
        focus={school.focus}
        onClose={() => setSchool({ open: false, focus: null })}
        onPick={(id) => setSchool({ open: true, focus: id })}
      />
    </LessonContext.Provider>
  );
}
