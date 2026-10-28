import { parseBinanceTrade } from '../src/feeds/binance';
import { parseCoinbaseTrade } from '../src/feeds/coinbase';
import { normalizeSymbol, findVenue } from '../src/feeds/venues';

describe('trade parsing — aggressor side', () => {
  it('Binance: m=true means the buyer was maker, so the taker sold', () => {
    const base = { e: 'aggTrade' as const, E: 1, s: 'BTCUSDT', a: 7, p: '100.5', q: '0.2', T: 1000 };
    expect(parseBinanceTrade({ ...base, m: true }).aggressor).toBe('sell');
    expect(parseBinanceTrade({ ...base, m: false })).toEqual({ ts: 1000, price: 100.5, size: 0.2, aggressor: 'buy', id: 7 });
  });

  it('Coinbase: side is the maker side, so BUY means a taker sold', () => {
    const base = { trade_id: '1', product_id: 'BTC-USD', price: '50000', size: '0.01', time: '2026-01-01T00:00:00.000Z' };
    expect(parseCoinbaseTrade({ ...base, side: 'BUY' }).aggressor).toBe('sell');
    expect(parseCoinbaseTrade({ ...base, side: 'SELL' }).aggressor).toBe('buy');
    expect(parseCoinbaseTrade({ ...base, side: 'SELL' }).ts).toBe(Date.parse(base.time));
  });
});

describe('symbol normalization', () => {
  it('maps user input to venue formats', () => {
    expect(normalizeSymbol(findVenue('binance')!, 'btc/usdt')).toBe('BTCUSDT');
    expect(normalizeSymbol(findVenue('binance')!, 'eth-usdt')).toBe('ETHUSDT');
    expect(normalizeSymbol(findVenue('coinbase')!, 'sol usd')).toBe('SOL-USD');
  });
});
