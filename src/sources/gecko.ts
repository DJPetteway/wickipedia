import type { Candle } from '../engine/candles';
import type { LiquidityModel, PoolState, Swap, WindowStats } from '../engine/types';
import { RateLimitedClient, type FetchLike } from './net';

/**
 * GeckoTerminal public API (free, no key, ~30 requests/min per IP).
 * Docs: https://apiguide.geckoterminal.com — responses are JSON:API shaped.
 */
export const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

let shared: RateLimitedClient | null = null;
/** One client per page so every caller shares the same request budget. */
export function geckoClient(base = GECKO_BASE, fetchFn?: FetchLike): RateLimitedClient {
  if (!shared || shared.base !== base) shared = new RateLimitedClient(base, 2_200, fetchFn);
  return shared;
}

// ------------------------------------------------------------------ shapes

interface Resource<A> {
  id: string;
  type: string;
  attributes: A;
  relationships?: Record<string, { data: { id: string; type: string } | null }>;
}

interface TradeAttrs {
  block_timestamp: string;
  tx_hash: string;
  tx_from_address?: string;
  kind: 'buy' | 'sell';
  from_token_amount: string;
  to_token_amount: string;
  price_from_in_usd: string;
  price_to_in_usd: string;
  volume_in_usd: string;
}

interface PoolAttrs {
  address: string;
  name: string;
  base_token_price_usd: string | null;
  quote_token_price_usd?: string | null;
  reserve_in_usd: string | null;
  fdv_usd: string | null;
  market_cap_usd: string | null;
  pool_created_at?: string | null;
  price_change_percentage?: Record<string, string | null>;
  transactions?: Record<string, { buys: number; sells: number; buyers?: number; sellers?: number }>;
  volume_usd?: Record<string, string | null>;
}

interface TokenAttrs {
  address: string;
  name: string;
  symbol: string;
}

interface DexAttrs {
  name: string;
}

const num = (x: string | null | undefined): number | null => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Strip a GeckoTerminal "network_address" id down to the address. */
export const idToAddress = (id: string): string => id.slice(id.indexOf('_') + 1);

// ------------------------------------------------------------------ parsers

/**
 * Trades for a pool. `kind` is from the trader's side on the pool's base
 * token: on a buy the base token is the "to" token, on a sell it's "from".
 * The tx hash doubles as the swap id so the same swap seen via another
 * source (e.g. PumpPortal's signature) is de-duplicated.
 */
export function parseTrades(json: unknown): Swap[] {
  const data = (json as { data?: Resource<TradeAttrs>[] })?.data ?? [];
  const out: Swap[] = [];
  for (const r of data) {
    const a = r.attributes;
    const buy = a.kind === 'buy';
    const priceUsd = num(buy ? a.price_to_in_usd : a.price_from_in_usd);
    const baseAmount = num(buy ? a.to_token_amount : a.from_token_amount);
    const usd = num(a.volume_in_usd);
    const ts = Date.parse(a.block_timestamp);
    if (priceUsd === null || baseAmount === null || usd === null || !Number.isFinite(ts)) continue;
    out.push({ id: a.tx_hash || r.id, ts, priceUsd, baseAmount, usd, side: buy ? 'buy' : 'sell', wallet: a.tx_from_address || undefined });
  }
  return out;
}

export function modelForDex(dexId: string | undefined): LiquidityModel {
  const d = (dexId ?? '').toLowerCase();
  if (!d) return 'UNKNOWN';
  if (/clmm|dlmm|whirlpool|concentrated|v3|v4|-cl\b|algebra|slipstream/.test(d)) return 'CONCENTRATED';
  return 'CPMM';
}

export interface ParsedPool {
  address: string;
  name: string;
  dexId: string | undefined;
  dexName: string | undefined;
  base: TokenAttrs | undefined;
  quote: TokenAttrs | undefined;
  createdAt: number | null;
  volume24h: number | null;
  state: PoolState;
}

function window(t: PoolAttrs['transactions'], k: string): WindowStats | undefined {
  const w = t?.[k];
  return w ? { buys: w.buys, sells: w.sells, buyers: w.buyers ?? 0, sellers: w.sellers ?? 0 } : undefined;
}

function parsePoolResource(r: Resource<PoolAttrs>, included: Resource<TokenAttrs | DexAttrs>[]): ParsedPool {
  const a = r.attributes;
  const find = <T,>(rel: string) => {
    const id = r.relationships?.[rel]?.data?.id;
    return id ? (included.find((i) => i.id === id)?.attributes as T | undefined) : undefined;
  };
  const dexId = r.relationships?.dex?.data?.id;
  const pc = a.price_change_percentage ?? {};
  const pct = (k: string) => {
    const v = num(pc[k]);
    return v === null ? undefined : v / 100;
  };
  return {
    address: a.address,
    name: a.name,
    dexId,
    dexName: find<DexAttrs>('dex')?.name,
    base: find<TokenAttrs>('base_token') ?? (r.relationships?.base_token?.data ? { address: idToAddress(r.relationships.base_token.data.id), name: '', symbol: '' } : undefined),
    quote: find<TokenAttrs>('quote_token'),
    createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    volume24h: num(a.volume_usd?.h24),
    state: {
      priceUsd: num(a.base_token_price_usd),
      liquidityUsd: num(a.reserve_in_usd),
      fdvUsd: num(a.fdv_usd),
      mcapUsd: num(a.market_cap_usd),
      model: modelForDex(dexId),
      window: { m5: window(a.transactions, 'm5'), h1: window(a.transactions, 'h1') },
      priceChangePct: { m5: pct('m5'), h1: pct('h1'), h24: pct('h24') },
    },
  };
}

export function parsePool(json: unknown): ParsedPool | null {
  const j = json as { data?: Resource<PoolAttrs>; included?: Resource<TokenAttrs | DexAttrs>[] };
  if (!j?.data?.attributes) return null;
  return parsePoolResource(j.data, j.included ?? []);
}

export function parsePools(json: unknown): ParsedPool[] {
  const j = json as { data?: Resource<PoolAttrs>[]; included?: Resource<TokenAttrs | DexAttrs>[] };
  return (j?.data ?? []).filter((r) => r?.attributes).map((r) => parsePoolResource(r, j.included ?? []));
}

/** `ohlcv_list` rows are [unix seconds, o, h, l, c, volume USD], newest first. */
export function parseOhlcv(json: unknown): Candle[] {
  const rows = (json as { data?: { attributes?: { ohlcv_list?: number[][] } } })?.data?.attributes?.ohlcv_list ?? [];
  return rows
    .map((r) => ({ t: r[0] * 1000, o: r[1], h: r[2], l: r[3], c: r[4], buyVol: 0, sellVol: 0, volUsd: Number(r[5]) || 0, live: false }))
    .filter((c) => [c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

export function parseNetworks(json: unknown): { id: string; name: string }[] {
  return ((json as { data?: Resource<{ name: string }>[] })?.data ?? []).map((r) => ({ id: r.id, name: r.attributes?.name ?? r.id }));
}

export function parseTokenPrice(json: unknown, address: string): number | null {
  const prices = (json as { data?: { attributes?: { token_prices?: Record<string, string> } } })?.data?.attributes?.token_prices ?? {};
  const hit = Object.entries(prices).find(([k]) => k.toLowerCase() === address.toLowerCase());
  return hit ? num(hit[1]) : null;
}

// ------------------------------------------------------------------ requests

const INC = 'include=base_token,quote_token,dex';

export const gecko = {
  pool: (c: RateLimitedClient, net: string, pool: string) => c.get(`/networks/${net}/pools/${pool}?${INC}`).then(parsePool),
  trades: (c: RateLimitedClient, net: string, pool: string) => c.get(`/networks/${net}/pools/${pool}/trades`).then(parseTrades),
  ohlcv: (c: RateLimitedClient, net: string, pool: string, aggregate: 1 | 5 = 1, limit = 90) =>
    c.get(`/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=${aggregate}&limit=${limit}&currency=usd`).then(parseOhlcv),
  tokenPools: (c: RateLimitedClient, net: string, token: string) => c.get(`/networks/${net}/tokens/${token}/pools?${INC}`).then(parsePools),
  search: (c: RateLimitedClient, net: string, q: string) => c.get(`/search/pools?query=${encodeURIComponent(q)}&network=${net}&${INC}`).then(parsePools),
  trending: (c: RateLimitedClient, net: string) => c.get(`/networks/${net}/trending_pools?${INC}`).then(parsePools),
  newPools: (c: RateLimitedClient, net: string) => c.get(`/networks/${net}/new_pools?${INC}`).then(parsePools),
  networks: (c: RateLimitedClient, page: number) => c.get(`/networks?page=${page}`).then(parseNetworks),
  tokenPrice: (c: RateLimitedClient, net: string, token: string) => c.get(`/simple/networks/${net}/token_price/${token}`).then((j) => parseTokenPrice(j, token)),
};
