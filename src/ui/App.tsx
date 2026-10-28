import { useEffect, useMemo, useState } from 'react';
import { writeArticle } from '../engine/article';
import type { ChainId, LiquidityModel } from '../engine/types';
import { findChain, geckoNetworkFor } from '../sources/chains';
import { gecko, geckoClient } from '../sources/gecko';
import { fromPool, resolveInput, type Candidate } from '../sources/resolve';
import { ArticleCard } from './components/ArticleCard';
import { Gauge } from './components/Gauge';
import { Ticker } from './components/Ticker';
import { SearchBox } from './components/SearchBox';
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

const STAGE_WORD = {
  DISCOVERY: 'DISCOVERY',
  LOADING: 'LOADING',
  BUILDING: 'BUILDING',
  NEUTRAL: 'NEUTRAL',
  DISTRIBUTION: 'SUPPLY',
  NO_DATA: 'WARMING UP',
} as const;

export function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [chain, setChain] = useState<ChainId>(() => findChain(params.get('chain') ?? '')?.id ?? 'solana');
  const [market, setMarket] = useState<Candidate | null>(() => candidateFromUrl(params));
  // Endpoint overrides exist for local testing against the mock; they are always flagged on screen.
  const sources = useMemo(() => ({ geckoBase: params.get('api') ?? undefined, pumpWs: params.get('pumpws') ?? undefined }), [params]);
  const custom = !!(sources.geckoBase || sources.pumpWs);
  const client = () => geckoClient(sources.geckoBase);

  // A shared link with just ?chain=…&token=… resolves to the deepest market.
  useEffect(() => {
    const token = params.get('token');
    if (market || !token) return;
    resolveInput(token, chain, client())
      .then((r) => r[0] && pick(r[0]))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { snap } = useWickipedia(market, sources, () => undefined);
  const article = snap ? writeArticle(snap) : null;
  const d = snap?.discovery;
  const ready = !!snap && snap.valid && !!d?.ready;
  const word = !snap || !snap.valid ? 'NO DATA' : STAGE_WORD[d!.stage];

  useEffect(() => {
    document.title = snap && article ? `${fmtPx(snap.price)} $${snap.market.symbol} · ${article.verdict} · Wickipedia` : 'Wickipedia — the free market encyclopedia';
  }, [snap, article?.verdict]);

  function pick(c: Candidate) {
    setMarket(c);
    setChain(c.chain);
    writeParams(c, c.chain);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const degen = async () => {
    const net = await geckoNetworkFor(findChain(chain)!, client());
    const pools = (await gecko.trending(client(), net)).slice(0, 8);
    if (!pools.length) throw new Error('Nothing trending right now.');
    pick(fromPool(chain, net, pools[Math.floor(Math.random() * pools.length)]));
  };

  const live = !!snap && snap.valid && snap.health.status === 'live';
  const age = snap?.health.lastMessageAt ? snap.now - snap.health.lastMessageAt : null;
  const search = (
    <SearchBox
      chain={chain}
      onChain={setChain}
      onSearch={(q) => resolveInput(q, chain, client())}
      onPick={pick}
      onDegen={degen}
      geckoBase={sources.geckoBase}
      pumpWs={sources.pumpWs}
      home={!market}
    />
  );

  return (
    <div className={`app ${article ? `tone-${article.tone}` : ''}`}>
      <div className="blobs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      {market && (
        <header className="bar">
          <button type="button" className="wordmark" onClick={() => { setMarket(null); writeParams(null, chain); }} aria-label="Wickipedia home">
            wick<span>ipedia</span>
          </button>
          <span className="bar-sym">
            ${market.symbol} <span className="muted">{fmtPx(snap?.price)}</span>
          </span>
          <span
            className={`dot ${live ? 'live' : snap ? 'off' : ''}`}
            role="status"
            title={snap ? `${snap.health.source} · ${snap.health.status} · updated ${fmtAge(age)} ago` : ''}
            aria-label={snap ? `Data ${live ? 'live' : snap.health.status}, updated ${fmtAge(age)} ago` : 'No token'}
          />
          {custom && <span className="custom">mock data</span>}
        </header>
      )}

      <main className="stage">
        {snap && article ? (
          <>
            <Gauge score={d?.score ?? 0} ready={ready} word={word} />
            <ArticleCard a={article} />
            {search}
          </>
        ) : (
          <section className="home">
            <h1 className="home-logo">
              Wick<span>ipedia</span>
            </h1>
            <p className="home-tag">The Free Market Encyclopedia</p>
            {search}
            {custom && <span className="custom">mock data</span>}
          </section>
        )}
      </main>

      <footer className="fine">never certain · not financial advice</footer>
      {snap && <Ticker items={snap.activity} now={snap.now} />}
    </div>
  );
}
