import { findChain } from '../src/sources/chains';
import { modelForDex, parseOhlcv, parsePool, parseTokenPrice, parseTrades } from '../src/sources/gecko';
import { RateLimitedClient } from '../src/sources/net';
import { parsePumpTrade } from '../src/sources/pumpportal';
import { extractAddress, isPumpCurveDex, resolveInput, venueLabel } from '../src/sources/resolve';
import { OHLCV, POOL, TRADES } from './fixtures/gecko';

describe('GeckoTerminal parsing', () => {
  it('reads trades with base-token price, side, size and wallet', () => {
    const [buy, sell] = parseTrades(TRADES);
    expect(buy).toEqual({
      id: '5xTx1',
      ts: Date.parse('2026-10-28T12:00:05Z'),
      priceUsd: 0.00032,
      baseAmount: 1250000,
      usd: 400,
      side: 'buy',
      wallet: 'WaLLet1111111111111111111111111111111111111',
    });
    // on a sell the base token is the "from" side
    expect(sell.priceUsd).toBe(0.000304);
    expect(sell.baseAmount).toBe(500000);
    expect(sell.side).toBe('sell');
  });

  it('reads pool state, tokens and dex', () => {
    const p = parsePool(POOL)!;
    expect(p.base?.symbol).toBe('WICK');
    expect(p.quote?.symbol).toBe('SOL');
    expect(p.dexName).toBe('PumpSwap');
    expect(p.state).toMatchObject({ priceUsd: 0.00031, liquidityUsd: 84000.5, fdvUsd: 310000, mcapUsd: null, model: 'CPMM' });
    expect(p.state.window?.m5).toEqual({ buys: 40, sells: 22, buyers: 31, sellers: 18 });
    expect(p.state.priceChangePct?.h24).toBeCloseTo(0.551);
  });

  it('reads OHLCV oldest-first', () => {
    const c = parseOhlcv(OHLCV);
    expect(c.map((x) => x.t)).toEqual([1761652800000, 1761652860000]);
    expect(c[1]).toMatchObject({ o: 0.00031, h: 0.00033, l: 0.0003, c: 0.00032, live: false });
  });

  it('classifies liquidity models by dex id', () => {
    expect(modelForDex('raydium')).toBe('CPMM');
    expect(modelForDex('raydium-clmm')).toBe('CONCENTRATED');
    expect(modelForDex('meteora-dlmm')).toBe('CONCENTRATED');
    expect(modelForDex('uniswap_v3_arbitrum')).toBe('CONCENTRATED');
    expect(modelForDex('camelot')).toBe('CPMM');
    expect(isPumpCurveDex('pump-fun')).toBe(true);
    expect(isPumpCurveDex('pumpswap')).toBe(false);
    expect(venueLabel('raydium-launchlab')).toMatch(/StonkFun/);
  });

  it('reads token prices case-insensitively', () => {
    const j = { data: { attributes: { token_prices: { so11111111111111111111111111111111111111112: '161.2' } } } };
    expect(parseTokenPrice(j, 'So11111111111111111111111111111111111111112')).toBe(161.2);
  });
});

describe('PumpPortal parsing', () => {
  it('turns a curve trade into a USD swap and curve state', () => {
    const { swap, curve } = parsePumpTrade(
      {
        signature: 'sig1',
        mint: 'MeMe11111111111111111111111111111111111pump',
        traderPublicKey: 'Trader1',
        txType: 'buy',
        tokenAmount: 1_000_000,
        solAmount: 0.05,
        vSolInBondingCurve: 60,
        vTokensInBondingCurve: 536_500_000,
        marketCapSol: 111.8,
      },
      150,
      1000,
    );
    expect(swap).toMatchObject({ id: 'sig1', side: 'buy', usd: 7.5, wallet: 'Trader1', ts: 1000 });
    expect(swap!.priceUsd).toBeCloseTo((0.05 / 1_000_000) * 150);
    expect(curve!.progress).toBeCloseTo((1_073_000_000 - 536_500_000) / 793_100_000);
    expect(curve!.solToGraduate).toBeGreaterThan(0);
  });

  it('creates no swap for non-trade messages', () => {
    expect(parsePumpTrade({ signature: 's', mint: 'm', txType: 'create' }, 150, 0).swap).toBeNull();
  });
});

describe('input resolution', () => {
  const sol = findChain('solana')!;
  it('extracts addresses from links', () => {
    const mint = 'MeMe11111111111111111111111111111111111pump';
    expect(extractAddress(mint, sol)).toBe(mint);
    expect(extractAddress(`https://pump.fun/coin/${mint}`, sol)).toBe(mint);
    expect(extractAddress(`https://dexscreener.com/solana/${mint}?foo=1`, sol)).toBe(mint);
    expect(extractAddress('bonk', sol)).toBeNull();
    expect(extractAddress('https://arbiscan.io/token/0x912CE59144191C1204E64559FE8253a0e49E6548', findChain('arbitrum')!)).toBe(
      '0x912CE59144191C1204E64559FE8253a0e49E6548',
    );
  });

  const client = (routes: Record<string, unknown>) =>
    new RateLimitedClient('http://x', 0, async (url) => {
      const path = url.replace('http://x', '').split('?')[0];
      const hit = Object.entries(routes).find(([k]) => path === k);
      return hit ? { ok: true, status: 200, json: async () => hit[1] } : { ok: false, status: 404, json: async () => ({}) };
    });

  it('finds the deepest pool for a token', async () => {
    const shallow = structuredClone(POOL.data);
    shallow.attributes.reserve_in_usd = '10';
    shallow.attributes.address = 'Shallow';
    const c = await resolveInput('MeMe11111111111111111111111111111111111pump', 'solana', client({
      '/networks/solana/tokens/MeMe11111111111111111111111111111111111pump/pools': { data: [shallow, POOL.data], included: POOL.included },
    }));
    expect(c[0].pool).toBe('PooL111111111111111111111111111111111111');
    expect(c[0].venue).toBe('PumpSwap');
    expect(c[0].pumpCurve).toBe(false);
  });

  it('falls back to the live pump.fun curve for an un-indexed …pump mint', async () => {
    const c = await resolveInput('NewMint1111111111111111111111111111111pump', 'solana', client({}));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ pumpCurve: true, model: 'BONDING_CURVE', venue: 'pump.fun bonding curve' });
  });

  it('discovers the Robinhood Chain network id from /networks', async () => {
    const cl = client({
      '/networks': { data: [{ id: 'eth', attributes: { name: 'Ethereum' } }, { id: 'robinhood-chain', attributes: { name: 'Robinhood Chain' } }] },
      '/search/pools': { data: [POOL.data], included: POOL.included },
    });
    const c = await resolveInput('wick', 'robinhood', cl);
    expect(c[0].network).toBe('robinhood-chain');
  });
});

describe('RateLimitedClient', () => {
  it('spaces requests and backs off on 429', async () => {
    let t = 0;
    const calls: number[] = [];
    let n = 0;
    const throttled: boolean[] = [];
    const c = new RateLimitedClient(
      'http://x',
      1000,
      async () => {
        calls.push(t);
        n++;
        return n === 2 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ n }) };
      },
      () => t,
      async (ms) => {
        t += ms;
      },
    );
    c.onThrottle = (x) => throttled.push(x);
    await c.get('/a');
    await expect(c.get('/b')).rejects.toThrow('429');
    await c.get('/c');
    expect(calls).toEqual([0, 1000, 31000]);
    expect(throttled).toEqual([true, false]);
  });
});
