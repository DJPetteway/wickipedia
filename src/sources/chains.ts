import type { ChainId } from '../engine/types';
import { gecko } from './gecko';
import type { RateLimitedClient } from './net';

export interface ChainDef {
  id: ChainId;
  name: string;
  /** GeckoTerminal network id; null when it must be discovered at runtime. */
  geckoNetwork: string | null;
  /** Regex used to discover the network id from GeckoTerminal's /networks list. */
  discover?: RegExp;
  addressPattern: RegExp;
  venues: string;
  native: { symbol: string; address: string } | null;
}

export const CHAINS: ChainDef[] = [
  {
    id: 'solana',
    name: 'Solana',
    geckoNetwork: 'solana',
    addressPattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    venues: 'pump.fun · PumpSwap · Raydium (incl. LaunchLab / StonkFun) · Meteora · Orca',
    native: { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' },
  },
  {
    id: 'robinhood',
    name: 'Robinhood Chain',
    geckoNetwork: null,
    discover: /robinhood/i,
    addressPattern: /^0x[0-9a-fA-F]{40}$/,
    venues: 'DEX pools on Robinhood Chain (Arbitrum Orbit L2)',
    native: null,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum One',
    geckoNetwork: 'arbitrum',
    addressPattern: /^0x[0-9a-fA-F]{40}$/,
    venues: 'Uniswap · Camelot · other Arbitrum DEXes',
    native: null,
  },
];

export const findChain = (id: string): ChainDef | undefined => CHAINS.find((c) => c.id === id);

const discovered = new Map<ChainId, string>();

/** Resolve a chain's GeckoTerminal network id, discovering it from /networks when needed. */
export async function geckoNetworkFor(chain: ChainDef, client: RateLimitedClient): Promise<string> {
  if (chain.geckoNetwork) return chain.geckoNetwork;
  const hit = discovered.get(chain.id);
  if (hit) return hit;
  for (let page = 1; page <= 10; page++) {
    const nets = await gecko.networks(client, page);
    const m = nets.find((n) => chain.discover!.test(n.name) || chain.discover!.test(n.id));
    if (m) {
      discovered.set(chain.id, m.id);
      return m.id;
    }
    if (nets.length === 0) break;
  }
  throw new Error(`GeckoTerminal does not list ${chain.name} yet`);
}
