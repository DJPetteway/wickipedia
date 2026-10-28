import { useEffect, useState } from 'react';
import type { ChainId } from '../../engine/types';
import { findChain, geckoNetworkFor } from '../../sources/chains';
import { gecko, geckoClient } from '../../sources/gecko';
import { pumpHub, type NewLaunch } from '../../sources/pumpportal';
import { fromPool, type Candidate } from '../../sources/resolve';
import { fmtAge, fmtPct, fmtPx, fmtUsd } from '../format';

type Tab = 'trending' | 'new' | 'launches';

function useList(chain: ChainId, tab: Tab, geckoBase: string | undefined) {
  const [state, setState] = useState<{ items: Candidate[]; err: string | null; loading: boolean }>({ items: [], err: null, loading: true });
  useEffect(() => {
    if (tab === 'launches') return;
    let live = true;
    setState({ items: [], err: null, loading: true });
    const client = geckoClient(geckoBase);
    (async () => {
      try {
        const net = await geckoNetworkFor(findChain(chain)!, client);
        const pools = tab === 'trending' ? await gecko.trending(client, net) : await gecko.newPools(client, net);
        if (live) setState({ items: pools.map((p) => fromPool(chain, net, p)), err: null, loading: false });
      } catch (e) {
        if (live) setState({ items: [], err: e instanceof Error ? e.message : String(e), loading: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [chain, tab, geckoBase]);
  return state;
}

function useLaunches(active: boolean, pumpWs: string | undefined) {
  const [items, setItems] = useState<NewLaunch[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    const hub = pumpHub(pumpWs);
    const offMsg = hub.on((m) => {
      if (m.txType !== 'create') return;
      setItems((xs) =>
        [
          {
            mint: m.mint,
            name: m.name ?? '',
            symbol: m.symbol ?? '???',
            ts: Date.now(),
            marketCapSol: typeof m.marketCapSol === 'number' ? m.marketCapSol : null,
            initialBuySol: typeof m.solAmount === 'number' ? m.solAmount : null,
          },
          ...xs,
        ].slice(0, 25),
      );
    });
    const offStatus = hub.onStatus((s) => setOpen(s === 'open'));
    setOpen(hub.isOpen);
    const unsub = hub.subscribeNewTokens();
    return () => {
      offMsg();
      offStatus();
      unsub();
    };
  }, [active, pumpWs]);
  return { items, open };
}

export function Discover({
  chain,
  onPick,
  geckoBase,
  pumpWs,
}: {
  chain: ChainId;
  onPick: (c: Candidate) => void;
  geckoBase?: string;
  pumpWs?: string;
}) {
  const [tab, setTab] = useState<Tab>('trending');
  const effectiveTab = chain !== 'solana' && tab === 'launches' ? 'trending' : tab;
  const list = useList(chain, effectiveTab, geckoBase);
  const launches = useLaunches(effectiveTab === 'launches', pumpWs);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const chainDef = findChain(chain)!;

  return (
    <section className="discover" aria-labelledby="disc-h">
      <header className="disc-h">
        <h2 id="disc-h">
          On {chainDef.name}
        </h2>
        <div className="seg" role="tablist" aria-label="Discover">
          <button type="button" role="tab" aria-selected={effectiveTab === 'trending'} aria-pressed={effectiveTab === 'trending'} onClick={() => setTab('trending')}>
            trending
          </button>
          <button type="button" role="tab" aria-selected={effectiveTab === 'new'} aria-pressed={effectiveTab === 'new'} onClick={() => setTab('new')}>
            new pools
          </button>
          {chain === 'solana' && (
            <button type="button" role="tab" aria-selected={effectiveTab === 'launches'} aria-pressed={effectiveTab === 'launches'} onClick={() => setTab('launches')}>
              live pump.fun launches
            </button>
          )}
        </div>
      </header>
      <p className="caption">{chainDef.venues}</p>

      {effectiveTab === 'launches' ? (
        <>
          <p className="caption">{launches.open ? '● streaming new pump.fun tokens from PumpPortal' : 'connecting to PumpPortal…'} — brand-new launches are extremely risky.</p>
          {launches.items.length === 0 ? (
            <div className="empty">Waiting for the next launch…</div>
          ) : (
            <ul className="disc-list">
              {launches.items.map((l) => (
                <li key={l.mint}>
                  <button
                    type="button"
                    className="cand"
                    onClick={() =>
                      onPick({
                        chain: 'solana',
                        network: 'solana',
                        token: l.mint,
                        symbol: l.symbol,
                        name: l.name,
                        venue: 'pump.fun bonding curve',
                        model: 'BONDING_CURVE',
                        pumpCurve: true,
                        liquidityUsd: null,
                        volume24h: null,
                        priceUsd: null,
                        change24h: null,
                        createdAt: l.ts,
                      })
                    }
                  >
                    <strong>${l.symbol}</strong>
                    <span className="muted name">{l.name}</span>
                    <span className="num muted">{l.marketCapSol !== null ? `mcap ${l.marketCapSol.toFixed(0)} SOL` : ''}</span>
                    <span className="muted">{fmtAge(now - l.ts)} ago</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : list.loading ? (
        <div className="empty">Loading from GeckoTerminal…</div>
      ) : list.err ? (
        <div className="empty" role="alert">
          Couldn’t load: {list.err}. Free API limits are per-IP — try again in a moment.
        </div>
      ) : list.items.length === 0 ? (
        <div className="empty">Nothing listed right now.</div>
      ) : (
        <ul className="disc-list">
          {list.items.slice(0, 20).map((c) => (
            <li key={`${c.pool}`}>
              <button type="button" className="cand" onClick={() => onPick(c)}>
                <strong>${c.symbol}</strong>
                <span className="muted name">
                  {c.quoteSymbol ? `/${c.quoteSymbol} · ` : ''}
                  {c.venue}
                </span>
                <span className="num">{fmtPx(c.priceUsd)}</span>
                <span className={`num ${c.change24h === null ? 'muted' : c.change24h >= 0 ? 'up' : 'down'}`}>{c.change24h === null ? '' : `${fmtPct(c.change24h, 0)} 24h`}</span>
                <span className="num muted">{c.liquidityUsd ? `liq ${fmtUsd(c.liquidityUsd)}` : ''}</span>
                <span className="muted">{c.createdAt ? `${fmtAge(now - c.createdAt)} old` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
