import { useEffect, useRef, useState } from 'react';
import { PoolEngine, type EngineSnapshot, type KVStore } from '../engine/poolEngine';
import type { WickEvent } from '../engine/types';
import { sourceInfo, startMarket, type SourceOptions } from '../sources/market';
import { toMarketRef, type Candidate } from '../sources/resolve';

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

export function useWickipedia(candidate: Candidate | null, sources: SourceOptions, onEvent: (e: WickEvent) => void) {
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const engineRef = useRef<PoolEngine | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const key = candidate ? `${candidate.chain}:${candidate.token}:${candidate.pool ?? ''}:${candidate.pumpCurve}` : '';

  useEffect(() => {
    setSnap(null);
    if (!candidate) return;
    const plan = { pumpCurve: candidate.pumpCurve };
    const engine = new PoolEngine({
      market: toMarketRef(candidate),
      source: sourceInfo(plan, !!candidate.pool),
      store: browserStore,
      onEvent: (e) => onEventRef.current(e),
    });
    engineRef.current = engine;
    const stop = startMarket(engine, plan, sources);
    setSnap(engine.tick(Date.now()));
    const iv = setInterval(() => setSnap(engine.tick(Date.now())), 250);
    const persist = () => engine.persistCalibration();
    window.addEventListener('pagehide', persist);
    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', persist);
      stop();
      engine.persistCalibration();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sources.geckoBase, sources.pumpWs]);

  return { snap, engine: engineRef };
}
