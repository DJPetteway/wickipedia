import { useEffect, useRef, useState } from 'react';
import type { ChainId } from '../../engine/types';
import { CHAINS } from '../../sources/chains';
import type { Candidate } from '../../sources/resolve';
import { fmtPx, fmtUsd } from '../format';
import { Discover } from './Discover';

/** Bottom sheet for picking a token: chain, paste/search, or tap a trending pool. */
export function TokenSheet({
  open,
  chain,
  onChain,
  onSearch,
  onPick,
  onClose,
  geckoBase,
  pumpWs,
}: {
  open: boolean;
  chain: ChainId;
  onChain: (c: ChainId) => void;
  onSearch: (q: string) => Promise<Candidate[]>;
  onPick: (c: Candidate) => void;
  onClose: () => void;
  geckoBase?: string;
  pumpWs?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Candidate[] | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const choose = (c: Candidate) => {
    setResults(null);
    setQ('');
    onPick(c);
  };

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await onSearch(q);
      if (r.length === 1) choose(r[0]);
      else setResults(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="sheet glass" aria-label="Pick a token" onClose={onClose} onCancel={onClose}>
      <div className="sheet-h">
        <div className="seg" role="group" aria-label="Chain">
          {CHAINS.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === chain} onClick={() => onChain(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <form
        className="sheet-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="sr-only" htmlFor="wk-q">
          Token, pool, link or name
        </label>
        <input
          id="wk-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={chain === 'solana' ? 'Paste a mint, pump.fun or DEX link, or search' : 'Paste a 0x contract or pool, or search'}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="candy-btn" disabled={busy}>
          {busy ? '…' : 'Read it'}
        </button>
      </form>
      {err && (
        <p className="sheet-msg" role="alert">
          {err}
        </p>
      )}
      {results ? (
        <div className="sheet-results">
          {results.length === 0 ? (
            <p className="sheet-msg">No indexed pools found. Brand-new pump.fun mints (…pump) can be pasted directly.</p>
          ) : (
            <ul className="disc-list">
              {results.slice(0, 12).map((c) => (
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
          )}
          <button type="button" className="link-btn" onClick={() => setResults(null)}>
            ← back to trending
          </button>
        </div>
      ) : (
        open && <Discover chain={chain} onPick={choose} geckoBase={geckoBase} pumpWs={pumpWs} />
      )}
    </dialog>
  );
}
