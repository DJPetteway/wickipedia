import type { VenueKind } from '../engine/types';

export interface SymbolDef {
  /** Venue-native id, e.g. BTCUSDT or BTC-USD. */
  id: string;
  base: string;
  quote: string;
}

export interface VenueDef {
  id: string;
  name: string;
  kind: VenueKind;
  protocol: 'binance' | 'coinbase';
  ws: string;
  rest: string;
  symbols: SymbolDef[];
  note: string;
}

const s = (id: string, base: string, quote: string): SymbolDef => ({ id, base, quote });

export const VENUES: VenueDef[] = [
  {
    id: 'binance',
    name: 'Binance',
    kind: 'CEX_ORDER_BOOK',
    protocol: 'binance',
    ws: 'wss://stream.binance.com:9443',
    rest: 'https://api.binance.com',
    symbols: [
      s('BTCUSDT', 'BTC', 'USDT'),
      s('ETHUSDT', 'ETH', 'USDT'),
      s('SOLUSDT', 'SOL', 'USDT'),
      s('DOGEUSDT', 'DOGE', 'USDT'),
      s('XRPUSDT', 'XRP', 'USDT'),
      s('PEPEUSDT', 'PEPE', 'USDT'),
      s('WIFUSDT', 'WIF', 'USDT'),
    ],
    note: 'Spot L2 diff-depth @100ms synced to a REST snapshot by update id. Not available in some regions (e.g. the US).',
  },
  {
    id: 'binanceus',
    name: 'Binance.US',
    kind: 'CEX_ORDER_BOOK',
    protocol: 'binance',
    ws: 'wss://stream.binance.us:9443',
    rest: 'https://api.binance.us',
    symbols: [s('BTCUSDT', 'BTC', 'USDT'), s('ETHUSDT', 'ETH', 'USDT'), s('SOLUSDT', 'SOL', 'USDT'), s('DOGEUSDT', 'DOGE', 'USDT')],
    note: 'Same protocol as Binance, US venue. Thinner books — walls and imbalances mean less here.',
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    kind: 'CEX_ORDER_BOOK',
    protocol: 'coinbase',
    ws: 'wss://advanced-trade-ws.coinbase.com',
    rest: 'https://api.coinbase.com',
    symbols: [
      s('BTC-USD', 'BTC', 'USD'),
      s('ETH-USD', 'ETH', 'USD'),
      s('SOL-USD', 'SOL', 'USD'),
      s('DOGE-USD', 'DOGE', 'USD'),
      s('XRP-USD', 'XRP', 'USD'),
    ],
    note: 'Advanced Trade level2 + market_trades (public). Full-book snapshot over WebSocket, sequence-checked.',
  },
];

export function findVenue(id: string): VenueDef | undefined {
  return VENUES.find((v) => v.id === id);
}

/** Parse a user-supplied symbol into the venue's native format. */
export function normalizeSymbol(venue: VenueDef, raw: string): string {
  const up = raw.trim().toUpperCase().replace(/[\s/_]/g, venue.protocol === 'coinbase' ? '-' : '');
  if (venue.protocol === 'binance') return up.replace(/-/g, '');
  return up;
}
