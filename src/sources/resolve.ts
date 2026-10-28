import type { ChainId, LiquidityModel, MarketRef } from '../engine/types';
import { findChain, geckoNetworkFor, type ChainDef } from './chains';
import { gecko, type ParsedPool } from './gecko';
import { HttpError, type RateLimitedClient } from './net';

/** A market the user can pick. */
export interface Candidate {
  chain: ChainId;
  network: string;
  token: string;
  pool?: string;
  symbol: string;
  name: string;
  quoteSymbol?: string;
  venue: string;
  dexId?: string;
  model: LiquidityModel;
  /** Live pump.fun bonding curve via PumpPortal. */
  pumpCurve: boolean;
  liquidityUsd: number | null;
  volume24h: number | null;
  priceUsd: number | null;
  change24h: number | null;
  createdAt: number | null;
}

export const isPumpCurveDex = (dexId?: string) => /pump-?fun/i.test(dexId ?? '') && !/swap|amm/i.test(dexId ?? '');

export function venueLabel(dexId?: string, dexName?: string): string {
  const d = (dexId ?? '').toLowerCase();
  if (isPumpCurveDex(d)) return 'pump.fun bonding curve';
  if (/launchlab/.test(d)) return 'Raydium LaunchLab curve (incl. StonkFun)';
  if (/pumpswap|pump-?amm/.test(d)) return 'PumpSwap';
  return dexName || dexId || 'DEX pool';
}

export function fromPool(chain: ChainId, network: string, p: ParsedPool): Candidate {
  const pumpCurve = isPumpCurveDex(p.dexId);
  return {
    chain,
    network,
    token: p.base?.address ?? '',
    pool: p.address,
    symbol: p.base?.symbol || p.name.split('/')[0]?.trim() || '???',
    name: p.base?.name || p.name,
    quoteSymbol: p.quote?.symbol,
    venue: venueLabel(p.dexId, p.dexName),
    dexId: p.dexId,
    model: pumpCurve ? 'BONDING_CURVE' : p.state.model,
    pumpCurve,
    liquidityUsd: p.state.liquidityUsd,
    volume24h: p.volume24h,
    priceUsd: p.state.priceUsd,
    change24h: p.state.priceChangePct?.h24 ?? null,
    createdAt: p.createdAt,
  };
}

export function toMarketRef(c: Candidate): MarketRef {
  return {
    chain: c.chain,
    network: c.network,
    token: c.token,
    pool: c.pool,
    symbol: c.symbol,
    name: c.name,
    venue: c.venue,
    model: c.model,
    quoteSymbol: c.quoteSymbol,
  };
}

/** Pull an address out of a pasted link (pump.fun, DexScreener, GeckoTerminal, Birdeye, Solscan, Arbiscan…). */
export function extractAddress(input: string, chain: ChainDef): string | null {
  const t = input.trim();
  if (chain.addressPattern.test(t)) return t;
  const parts = t.split(/[/?#&=\s]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (chain.addressPattern.test(parts[i])) return parts[i];
  return null;
}

const is404 = (e: unknown) => e instanceof HttpError && e.status === 404;

/**
 * Turn whatever the user typed — a mint/contract, a pool address, a link, or
 * a name — into a ranked list of markets.
 */
export async function resolveInput(input: string, chainId: ChainId, client: RateLimitedClient): Promise<Candidate[]> {
  const chain = findChain(chainId)!;
  const network = await geckoNetworkFor(chain, client);
  const addr = extractAddress(input, chain);

  if (!addr) {
    const q = input.trim();
    if (q.length < 2) return [];
    return (await gecko.search(client, network, q)).map((p) => fromPool(chainId, network, p));
  }

  let pools: ParsedPool[] = [];
  try {
    pools = await gecko.tokenPools(client, network, addr);
  } catch (e) {
    if (!is404(e)) throw e;
  }
  if (pools.length === 0) {
    try {
      const p = await gecko.pool(client, network, addr);
      if (p) pools = [p];
    } catch (e) {
      if (!is404(e)) throw e;
    }
  }
  const out = pools.map((p) => fromPool(chainId, network, p)).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));

  // pump.fun mints (…pump) that are still on the curve get the real-time PumpPortal feed.
  if (chainId === 'solana' && /pump$/.test(addr) && !out.some((c) => c.pumpCurve) && !out.some((c) => /pumpswap|raydium/i.test(c.venue))) {
    out.unshift({
      chain: 'solana',
      network,
      token: addr,
      symbol: '???',
      name: 'pump.fun token',
      venue: 'pump.fun bonding curve',
      model: 'BONDING_CURVE',
      pumpCurve: true,
      liquidityUsd: null,
      volume24h: null,
      priceUsd: null,
      change24h: null,
      createdAt: null,
    });
  }
  return out;
}
