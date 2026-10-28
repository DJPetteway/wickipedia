import { useEffect, useRef, useState } from 'react';
import type { ChainId } from '../../engine/types';
import { CHAINS } from '../../sources/chains';
import type { Candidate } from '../../sources/resolve';
import { fmtPx, fmtUsd } from '../format';
import { Discover } from './Discover';

/** A clean, Google-style search: one box, two buttons, chain chips, suggestions on focus. */
export function SearchBox({
  chain,
  onChain,
  onSearch,
  onPick,
  onDegen,
  geckoBase,
  pumpWs,
  home = false,
}: {
  chain: ChainId;
  onChain: (c: ChainId) => void;
  onSearch: (q: string) => Promise<Candidate[]>;
  onPick: (c: Candidate) => void;
  onDegen: () => Promise<void>;
  geckoBase?: string;
  pumpWs?: string;
  home?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);

  const choose = (c: Candidate) => {
    setOpen(false);
    setResults(null);
    setQ('');
    onPick(c);
  };

  const run = async () => {
    if (!q.trim()) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await onSearch(q);
      if (r.length === 1) choose(r[0]);
      else {
        setResults(r);
        setOpen(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const degen = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onDegen();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`gsearch ${home ? 'home' : ''}`} ref={wrap} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <form
        role="search"
        className={`gbox ${open ? 'open' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <svg viewBox="0 0 24 24" className="gicon" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <label className="sr-only" htmlFor="wk-q">
          Search Wickipedia
        </label>
        <input
          id="wk-q"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setResults(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search Wickipedia — paste a token, pool or link"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
        />
        {busy && <span className="gspin" aria-label="searching" />}
      </form>

      {open && (
        <div className="gdrop" role="region" aria-label="Suggestions">
          {err && <p className="gmsg">{err}</p>}
          {results ? (
            results.length === 0 ? (
              <p className="gmsg">No indexed pools found. Brand-new pump.fun mints (…pump) can be pasted directly.</p>
            ) : (
              <ul className="disc-list">
                {results.slice(0, 10).map((c) => (
                  <li key={`${c.pool ?? c.token}${c.pumpCurve}`}>
                    <button type="button" className="cand" onClick={() => choose(c)}>
                      <strong>${c.symbol}</strong>
                      <span className="muted name">{c.venue}</span>
                      <span className="num">{c.priceUsd ? fmtPx(c.priceUsd) : ''}</span>
                      <span className="num muted">{c.liquidityUsd ? `liq ${fmtUsd(c.liquidityUsd)}` : c.pumpCurve ? 'live curve' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Discover chain={chain} onPick={choose} geckoBase={geckoBase} pumpWs={pumpWs} />
          )}
        </div>
      )}

      <div className="gbuttons">
        <button type="button" className="gbtn" onClick={() => void run()} disabled={busy}>
          Wickipedia Search
        </button>
        <button type="button" className="gbtn" onClick={() => void degen()} disabled={busy} title="Opens a random token from what's trending — degen at your own risk">
          I&apos;m Feeling Degen
        </button>
      </div>
      <div className="gchains" role="group" aria-label="Chain">
        {CHAINS.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === chain} onClick={() => onChain(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
