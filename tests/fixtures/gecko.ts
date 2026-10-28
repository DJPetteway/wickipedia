/** Response shapes per GeckoTerminal's public API docs (values illustrative). */
export const TRADES = {
  data: [
    {
      id: 'solana_312_5xTx1_0',
      type: 'trade',
      attributes: {
        block_number: 312,
        tx_hash: '5xTx1',
        tx_from_address: 'WaLLet1111111111111111111111111111111111111',
        from_token_amount: '2.5',
        to_token_amount: '1250000',
        price_from_in_currency_token: '1',
        price_to_in_currency_token: '0.000002',
        price_from_in_usd: '160',
        price_to_in_usd: '0.00032',
        block_timestamp: '2026-10-28T12:00:05Z',
        kind: 'buy',
        volume_in_usd: '400',
        from_token_address: 'So11111111111111111111111111111111111111112',
        to_token_address: 'MeMe11111111111111111111111111111111111pump',
      },
    },
    {
      id: 'solana_313_5xTx2_0',
      type: 'trade',
      attributes: {
        block_number: 313,
        tx_hash: '5xTx2',
        tx_from_address: 'WaLLet2222222222222222222222222222222222222',
        from_token_amount: '500000',
        to_token_amount: '0.99',
        price_from_in_currency_token: '0.0000019',
        price_to_in_currency_token: '1',
        price_from_in_usd: '0.000304',
        price_to_in_usd: '160',
        block_timestamp: '2026-10-28T12:00:07Z',
        kind: 'sell',
        volume_in_usd: '152',
        from_token_address: 'MeMe11111111111111111111111111111111111pump',
        to_token_address: 'So11111111111111111111111111111111111111112',
      },
    },
  ],
};

export const POOL = {
  data: {
    id: 'solana_PooL111111111111111111111111111111111111',
    type: 'pool',
    attributes: {
      address: 'PooL111111111111111111111111111111111111',
      name: 'WICK / SOL',
      base_token_price_usd: '0.00031',
      quote_token_price_usd: '160',
      reserve_in_usd: '84000.5',
      fdv_usd: '310000',
      market_cap_usd: null,
      pool_created_at: '2026-10-27T09:00:00Z',
      price_change_percentage: { m5: '1.5', h1: '-4.2', h6: '10', h24: '55.1' },
      transactions: { m5: { buys: 40, sells: 22, buyers: 31, sellers: 18 }, h1: { buys: 400, sells: 300, buyers: 210, sellers: 160 } },
      volume_usd: { m5: '5100', h1: '61000', h6: '200000', h24: '900000' },
    },
    relationships: {
      base_token: { data: { id: 'solana_MeMe11111111111111111111111111111111111pump', type: 'token' } },
      quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112', type: 'token' } },
      dex: { data: { id: 'pumpswap', type: 'dex' } },
    },
  },
  included: [
    { id: 'solana_MeMe11111111111111111111111111111111111pump', type: 'token', attributes: { address: 'MeMe11111111111111111111111111111111111pump', name: 'Wick Coin', symbol: 'WICK' } },
    { id: 'solana_So11111111111111111111111111111111111111112', type: 'token', attributes: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' } },
    { id: 'pumpswap', type: 'dex', attributes: { name: 'PumpSwap' } },
  ],
};

export const OHLCV = {
  data: {
    id: 'x',
    type: 'ohlcv_request_response',
    attributes: {
      ohlcv_list: [
        [1761652860, 0.00031, 0.00033, 0.0003, 0.00032, 1200],
        [1761652800, 0.0003, 0.00031, 0.00029, 0.00031, 900],
      ],
    },
  },
};
