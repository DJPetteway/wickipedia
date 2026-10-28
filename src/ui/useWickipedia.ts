import { useEffect, useRef, useState } from 'react';
import { WickEngine, type EngineSnapshot, type KVStore } from '../engine/engine';
import type { WickEvent } from '../engine/types';
import { createFeed, findVenue } from '../feeds';

/** localStorage, wrapped so private mode / blocked storage never breaks the app. */
export const browserStore: KVStore = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* calibration still works in memory */
    }
  },
};

export interface Endpoints {
  ws?: string;
  rest?: string;
}

export function useWickipedia(venueId: string, symbol: string, endpoints: Endpoints, onEvent: (e: WickEvent) => void) {
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const engineRef = useRef<WickEngine | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const venue = findVenue(venueId);
    if (!venue) return;
    const engine = new WickEngine({
      venueId: venue.id,
      venueName: venue.name,
      venueKind: venue.kind,
      symbol,
      store: browserStore,
      onEvent: (e) => onEventRef.current(e),
    });
    engineRef.current = engine;
    const feed = createFeed(venue, symbol, engine, { wsBase: endpoints.ws, restBase: endpoints.rest });
    feed.start();
    setSnap(engine.tick(Date.now()));
    const iv = setInterval(() => setSnap(engine.tick(Date.now())), 250);
    const persist = () => engine.persistCalibration();
    window.addEventListener('pagehide', persist);
    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', persist);
      feed.stop();
      engine.persistCalibration();
      engineRef.current = null;
    };
  }, [venueId, symbol, endpoints.ws, endpoints.rest]);

  return { snap, engine: engineRef };
}
