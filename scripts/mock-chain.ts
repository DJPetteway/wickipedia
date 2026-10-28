/**
 * LOCAL TEST TOOL — a fake on-chain data provider that speaks the
 * GeckoTerminal REST shapes and the PumpPortal WebSocket shapes. It exists so
 * the full pipeline (sources → engine → UI) can be exercised offline and in
 * CI. Everything it serves is synthetic. The app only uses it when you pass
 * ?api=…&pumpws=… and then shows a "custom endpoint" badge.
 *
 *   npm run mock
 *   open "http://localhost:5173/?api=http://localhost:8787&pumpws=ws://localhost:8787/api/data"
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const CYCLE = Number(process.env.MOCK_CYCLE ?? 300);
const SOL_USD = 150;
const SOL = 'So11111111111111111111111111111111111111112';
const TOKEN = 'MockWick1111111111111111111111111111111111';
const POOL = 'MockPooL1111111111111111111111111111111111';
const CURVE_MINT = 'MockCurve111111111111111111111111111111pump';

let seed = 11;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddr = () => Array.from({ length: 44 }, () => B58[Math.floor(rnd() * B58.length)]).join('');
const wallets = Array.from({ length: 60 }, fakeAddr);
const start = Date.now();

// ------------------------------------------------------------------ CPMM pool
const pool = { x: 400_000_000, y: 60_000 }; // base units, USD quote
interface Trade {
  id: string;
  ts: number;
  side: 'buy' | 'sell';
  usd: number;
  base: number;
  price: number;
  wallet: string;
}
const trades: Trade[] = [];
let n = 0;
const price = () => pool.y / pool.x;

function swap(side: 'buy' | 'sell', usd: number, wallet: string) {
  const k = pool.x * pool.y;
  let base: number;
  if (side === 'buy') {
    const y2 = pool.y + usd;
    base = pool.x - k / y2;
    pool.y = y2;
    pool.x = k / y2;
  } else {
    base = usd / price();
    const x2 = pool.x + base;
    const y2 = k / x2;
    usd = pool.y - y2;
    pool.x = x2;
    pool.y = y2;
  }
  trades.push({ id: `mocktx${n++}`, ts: Date.now(), side, usd, base, price: usd / base, wallet });
  if (trades.length > 2000) trades.shift();
}

function regime() {
  const t = ((Date.now() - start) / 1000) % CYCLE;
  if (t < CYCLE * 0.4) return 'calm';
  if (t < CYCLE * 0.6) return 'floor';
  if (t < CYCLE * 0.7) return 'pull';
  return 'pump';
}
let pulled = false;
setInterval(() => {
  const r = regime();
  const w = () => wallets[Math.floor(rnd() * wallets.length)];
  if (r !== 'pull') pulled = false;
  if (r === 'calm' && rnd() < 0.35) swap(rnd() < 0.5 ? 'buy' : 'sell', 30 + rnd() * 250, w());
  if (r === 'floor') {
    if (rnd() < 0.5) swap('sell', 200 + rnd() * 500, w());
    if (rnd() < 0.33) swap('buy', 200 + rnd() * 450, w());
  }
  if (r === 'pull') {
    if (!pulled) {
      pulled = true;
      pool.x *= 0.65;
      pool.y *= 0.65; // LP removes 35% of both sides — price unchanged
    }
    if (rnd() < 0.25) swap(rnd() < 0.4 ? 'buy' : 'sell', 30 + rnd() * 150, w());
  }
  if (r === 'pump') {
    if (rnd() < 0.55) swap('buy', 100 + rnd() * 600, w());
    if (rnd() < 0.15) swap('sell', 50 + rnd() * 200, w());
    if (rnd() < 0.02) swap('buy', 3000 + rnd() * 2000, wallets[0]);
  }
}, 500);

// ------------------------------------------------------------------ pump curve
const curve = { vSol: 30, vTokens: 1_073_000_000 };

// ------------------------------------------------------------------ REST
const tokenRes = (address: string, name: string, symbol: string) => ({ id: `solana_${address}`, type: 'token', attributes: { address, name, symbol } });
const included = [
  tokenRes(TOKEN, 'Mock Wick', 'MWICK'),
  tokenRes(SOL, 'Wrapped SOL', 'SOL'),
  tokenRes(CURVE_MINT, 'Mock Curve', 'MCURVE'),
  { id: 'pumpswap', type: 'dex', attributes: { name: 'PumpSwap' } },
  { id: 'pump-fun', type: 'dex', attributes: { name: 'Pump.fun' } },
];

function poolRes() {
  const p = price();
  const since = (ms: number) => trades.filter((t) => t.ts > Date.now() - ms);
  const stats = (ms: number) => {
    const ts = since(ms);
    const b = ts.filter((t) => t.side === 'buy');
    const s = ts.filter((t) => t.side === 'sell');
    return { buys: b.length, sells: s.length, buyers: new Set(b.map((t) => t.wallet)).size, sellers: new Set(s.map((t) => t.wallet)).size };
  };
  return {
    id: `solana_${POOL}`,
    type: 'pool',
    attributes: {
      address: POOL,
      name: 'MWICK / SOL',
      base_token_price_usd: String(p),
      quote_token_price_usd: String(SOL_USD),
      reserve_in_usd: String(pool.y * 2),
      fdv_usd: String(p * 1e9),
      market_cap_usd: null,
      pool_created_at: new Date(start - 3 * 3600_000).toISOString(),
      price_change_percentage: { m5: '1.2', h1: '-3.4', h6: '12', h24: '48' },
      transactions: { m5: stats(300_000), h1: stats(3_600_000) },
      volume_usd: { m5: '0', h1: '0', h6: '0', h24: '250000' },
    },
    relationships: {
      base_token: { data: { id: `solana_${TOKEN}`, type: 'token' } },
      quote_token: { data: { id: `solana_${SOL}`, type: 'token' } },
      dex: { data: { id: 'pumpswap', type: 'dex' } },
    },
  };
}

function curvePoolRes() {
  const r = poolRes();
  return {
    ...r,
    id: `solana_CurvePooL`,
    attributes: { ...r.attributes, address: 'CurvePooL1111111111111111111111111111111111', name: 'MCURVE / SOL', base_token_price_usd: String((curve.vSol / curve.vTokens) * SOL_USD), reserve_in_usd: String((curve.vSol - 30) * SOL_USD) },
    relationships: { ...r.relationships, base_token: { data: { id: `solana_${CURVE_MINT}`, type: 'token' } }, dex: { data: { id: 'pump-fun', type: 'dex' } } },
  };
}

function tradeRes(t: Trade) {
  const buy = t.side === 'buy';
  return {
    id: `solana_${t.id}`,
    type: 'trade',
    attributes: {
      tx_hash: t.id,
      tx_from_address: t.wallet,
      kind: t.side,
      block_timestamp: new Date(t.ts).toISOString().replace(/\.\d+Z$/, 'Z'),
      from_token_amount: String(buy ? t.usd / SOL_USD : t.base),
      to_token_amount: String(buy ? t.base : t.usd / SOL_USD),
      price_from_in_usd: String(buy ? SOL_USD : t.price),
      price_to_in_usd: String(buy ? t.price : SOL_USD),
      volume_in_usd: String(t.usd),
    },
  };
}

function ohlcv(aggregate: number, limit: number) {
  const rows: number[][] = [];
  const step = 60 * aggregate;
  let px = price() * 0.8;
  const now = Math.floor(Date.now() / 1000 / step) * step;
  for (let i = Math.min(limit, 100); i > 0; i--) {
    const o = px;
    const c = o * (1 + (rnd() - 0.47) * 0.04);
    rows.push([now - i * step, o, Math.max(o, c) * (1 + rnd() * 0.02), Math.min(o, c) * (1 - rnd() * 0.02), c, 1000 + rnd() * 5000]);
    px = c;
  }
  return rows.reverse();
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  const send = (o: unknown) => res.end(JSON.stringify(o));
  if (p === '/networks') return send({ data: [{ id: 'solana', attributes: { name: 'Solana' } }, { id: 'arbitrum', attributes: { name: 'Arbitrum' } }, { id: 'robinhood-chain', attributes: { name: 'Robinhood Chain' } }] });
  if (/\/(trending_pools|new_pools)$/.test(p) || p === '/search/pools') return send({ data: [poolRes(), curvePoolRes()], included });
  if (p.endsWith(`/tokens/${TOKEN}/pools`)) return send({ data: [poolRes()], included });
  if (p.endsWith(`/tokens/${CURVE_MINT}/pools`)) return send({ data: [curvePoolRes()], included });
  if (p.endsWith(`/pools/${POOL}`)) return send({ data: poolRes(), included });
  if (p.endsWith(`/pools/${POOL}/trades`)) return send({ data: trades.slice(-300).reverse().map(tradeRes) });
  if (p.endsWith(`/pools/${POOL}/ohlcv/minute`)) return send({ data: { attributes: { ohlcv_list: ohlcv(Number(url.searchParams.get('aggregate') ?? 1), Number(url.searchParams.get('limit') ?? 60)) } } });
  if (p.includes('/token_price/')) return send({ data: { attributes: { token_prices: { [SOL]: String(SOL_USD) } } } });
  res.statusCode = 404;
  send({ errors: [{ status: '404', title: 'Not Found' }] });
});

// ------------------------------------------------------------------ PumpPortal-shaped WS
const wss = new WebSocketServer({ server, path: '/api/data' });
const subs = new Map<WebSocket, { newTokens: boolean; keys: Set<string> }>();
wss.on('connection', (ws) => {
  subs.set(ws, { newTokens: false, keys: new Set() });
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    const s = subs.get(ws)!;
    if (m.method === 'subscribeNewToken') s.newTokens = true;
    if (m.method === 'unsubscribeNewToken') s.newTokens = false;
    if (m.method === 'subscribeTokenTrade') for (const k of m.keys ?? []) s.keys.add(k);
    if (m.method === 'unsubscribeTokenTrade') for (const k of m.keys ?? []) s.keys.delete(k);
    ws.send(JSON.stringify({ message: 'Successfully subscribed.' }));
  });
  ws.on('close', () => subs.delete(ws));
});

let launch = 0;
setInterval(() => {
  // a steady bid walking the curve toward graduation, with some sells
  const buy = rnd() < 0.7;
  const sol = buy ? 0.1 + rnd() * 1.2 : 0.05 + rnd() * 0.6;
  const k = curve.vSol * curve.vTokens;
  let tokens: number;
  if (buy) {
    const v2 = curve.vSol + sol;
    tokens = curve.vTokens - k / v2;
    curve.vSol = v2;
    curve.vTokens = k / v2;
  } else {
    const v2 = Math.max(30.01, curve.vSol - sol);
    tokens = k / v2 - curve.vTokens;
    curve.vSol = v2;
    curve.vTokens = k / v2;
  }
  if (curve.vSol > 112) Object.assign(curve, { vSol: 30, vTokens: 1_073_000_000 }); // restart the demo before graduating
  const msg = {
    signature: `mocksig${n++}`,
    mint: CURVE_MINT,
    traderPublicKey: wallets[Math.floor(rnd() * wallets.length)],
    txType: buy ? 'buy' : 'sell',
    tokenAmount: tokens,
    solAmount: sol,
    vTokensInBondingCurve: curve.vTokens,
    vSolInBondingCurve: curve.vSol,
    marketCapSol: (curve.vSol / curve.vTokens) * 1e9,
    pool: 'pump',
  };
  for (const [ws, s] of subs) if (s.keys.has(CURVE_MINT)) ws.send(JSON.stringify(msg));
}, 1500);

setInterval(() => {
  launch++;
  const msg = {
    signature: `mocklaunch${launch}`,
    mint: `MockLaunch${String(launch).padStart(4, '0')}${'1'.repeat(26)}pump`,
    traderPublicKey: wallets[0],
    txType: 'create',
    solAmount: rnd() * 2,
    vTokensInBondingCurve: 1_000_000_000,
    vSolInBondingCurve: 32,
    marketCapSol: 32,
    name: `Mock Launch ${launch}`,
    symbol: `MOCK${launch}`,
    pool: 'pump',
  };
  for (const [ws, s] of subs) if (s.newTokens) ws.send(JSON.stringify(msg));
}, 6000);

server.listen(PORT, () => console.log(`[mock-chain] SYNTHETIC GeckoTerminal + PumpPortal shapes on http://localhost:${PORT} (ws /api/data). Test use only.`));
