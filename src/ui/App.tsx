import { useEffect, useMemo, useState } from 'react';
import { consult } from '../engine/oracle';
import type { ChainId, LiquidityModel } from '../engine/types';
import { findChain } from '../sources/chains';
import { geckoClient } from '../sources/gecko';
import { resolveInput, type Candidate } from '../sources/resolve';
import { EightBall } from './components/EightBall';
import { Gauge } from './components/Gauge';
import { TokenSheet } from './components/TokenSheet';
import { fmtAge, fmtPx } from './format';
import { useWickipedia } from './useWickipedia';

// ------------------------------------------------------------------ URL state

function candidateFromUrl(p: URLSearchParams): Candidate | null {
  const chain = findChain(p.get('chain') ?? '')?.id;
  const token = p.get('token');
  if (!chain || !token || !p.get('venue')) return null;
  return {
    chain,
    network: p.get('net') ?? findChain(chain)!.geckoNetwork ?? chain,
    token,
    pool: p.get('pool') ?? undefined,
    symbol: p.get('sym') ?? '???',
    name: p.get('name') ?? '',
    quoteSymbol: p.get('quote') ?? undefined,
    venue: p.get('venue')!,
    model: (p.get('model') as LiquidityModel) ?? 'UNKNOWN',
    pumpCurve: p.get('curve') === '1',
    liquidityUsd: null,
    volume24h: null,
    priceUsd: null,
    change24h: null,
    createdAt: null,
  };
}

function writeParams(c: Candidate | null, chain: ChainId) {
  const p = new URLSearchParams(location.search);
  for (const k of ['chain', 'token', 'pool', 'net', 'sym', 'name', 'quote', 'venue', 'model', 'curve']) p.delete(k);
  p.set('chain', chain);
  if (c) {
    const set = (k: string, v?: string) => v && p.set(k, v);
    set('token', c.token);
    set('pool', c.pool);
    set('net', c.network);
    set('sym', c.symbol);
    set('name', c.name);
    set('quote', c.quoteSymbol);
    set('venue', c.venue);
    set('model', c.model);
    if (c.pumpCurve) p.set('curve', '1');
  }
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

export function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [chain, setChain] = useState<ChainId>(() => findChain(params.get('chain') ?? '')?.id ?? 'solana');
  const [market, setMarket] = useState<Candidate | null>(() => candidateFromUrl(params));
  const [sheet, setSheet] = useState(() => !candidateFromUrl(params) && !params.get('token'));
  // Endpoint overrides exist for local testing against the mock; they are always flagged on screen.
  const sources = useMemo(() => ({ geckoBase: params.get('api') ?? undefined, pumpWs: params.get('pumpws') ?? undefined }), [params]);
  const custom = !!(sources.geckoBase || sources.pumpWs);

  // A shared link with just ?chain=…&token=… resolves to the deepest market.
  useEffect(() => {
    const token = params.get('token');
    if (market || !token) return;
    resolveInput(token, chain, geckoClient(sources.geckoBase))
      .then((r) => (r[0] ? pick(r[0]) : setSheet(true)))
      .catch(() => setSheet(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { snap } = useWickipedia(market, sources, () => undefined);
  const oracle = snap ? consult(snap) : null;

  useEffect(() => {
    document.title = snap ? `${fmtPx(snap.price)} $${snap.market.symbol} · ${oracle?.answer ?? ''} · Wickipedia` : 'Wickipedia — the chain knows';
  }, [snap, oracle?.answer]);

  function pick(c: Candidate) {
    setMarket(c);
    setChain(c.chain);
    writeParams(c, c.chain);
    setSheet(false);
  }

  const live = !!snap && snap.valid && snap.health.status === 'live';
  const age = snap?.health.lastMessageAt ? snap.now - snap.health.lastMessageAt : null;
  const dir = snap?.setup.direction;

  return (
    <div className={`app ${oracle ? `tone-${oracle.tone}` : ''}`}>
      <div className="blobs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="bar">
        <span className="wordmark" aria-label="Wickipedia">
          wick<span>ipedia</span>
        </span>
        <button type="button" className="token-pill glass" onClick={() => setSheet(true)} aria-haspopup="dialog">
          {market ? (
            <>
              <strong>${market.symbol}</strong>
              <span className="pill-px">{fmtPx(snap?.price)}</span>
              <span className="pill-venue">{market.venue}</span>
            </>
          ) : (
            <strong>Pick a token</strong>
          )}
          <span aria-hidden="true">▾</span>
        </button>
        <span
          className={`dot ${live ? 'live' : snap ? 'off' : ''}`}
          role="status"
          title={snap ? `${snap.health.source} · ${snap.health.status}${custom ? ' · custom endpoint' : ''} · updated ${fmtAge(age)} ago` : 'no token'}
          aria-label={snap ? `Data ${live ? 'live' : snap.health.status}, updated ${fmtAge(age)} ago` : 'No token selected'}
        />
        {custom && <span className="custom">mock data</span>}
      </header>

      <main className="stage">
        {snap && oracle ? (
          <>
            <Gauge
              score={snap.score}
              ready={snap.valid && snap.warmup.ready}
              parts={snap.scoreParts}
              warmup={snap.valid && !snap.warmup.ready ? snap.warmup : null}
            />
            <EightBall oracle={oracle} />
            {dir && snap.setup.state !== 'NEUTRAL' && <span className="sr-only">Setup {snap.setup.state}, direction {dir}</span>}
          </>
        ) : (
          <section className="empty-stage">
            <EightBall
              oracle={{
                key: 'idle',
                answer: 'ASK ME ABOUT A TOKEN',
                tone: 'hazy',
                detail: 'Pick a token on Solana (pump.fun, PumpSwap, Raydium, StonkFun), Robinhood Chain or Arbitrum. I read the swaps, not the vibes.',
                odds: null,
              }}
            />
            <button type="button" className="candy-btn big" onClick={() => setSheet(true)}>
              Pick a token
            </button>
          </section>
        )}
      </main>

      <footer className="fine">Reads on-chain swaps & liquidity. Never certain. Not financial advice.</footer>

      <TokenSheet
        open={sheet}
        chain={chain}
        onChain={(c) => setChain(c)}
        onSearch={(q) => resolveInput(q, chain, geckoClient(sources.geckoBase))}
        onPick={pick}
        onClose={() => setSheet(false)}
        geckoBase={sources.geckoBase}
        pumpWs={sources.pumpWs}
      />
    </div>
  );
}
