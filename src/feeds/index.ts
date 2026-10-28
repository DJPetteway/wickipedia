import type { WickEngine } from '../engine/engine';
import { BinanceFeed } from './binance';
import { CoinbaseFeed } from './coinbase';
import type { BaseFeed, FeedDeps } from './feed';
import type { VenueDef } from './venues';

export function createFeed(venue: VenueDef, symbol: string, engine: WickEngine, deps?: FeedDeps): BaseFeed {
  switch (venue.protocol) {
    case 'binance':
      return new BinanceFeed(venue, symbol, engine, deps);
    case 'coinbase':
      return new CoinbaseFeed(venue, symbol, engine, deps);
  }
}

export { VENUES, findVenue, normalizeSymbol } from './venues';
export type { VenueDef, SymbolDef } from './venues';
