/**
 * LOCAL TEST TOOL — a fake exchange that speaks the Binance spot protocol
 * (REST /api/v3/depth + /api/v3/klines, WS /stream with depthUpdate +
 * aggTrade). It exists so the full pipeline (sync → engine → UI) can be
 * exercised offline and in CI. Its prices are synthetic and it is never used
 * unless you explicitly point the app at it with ?ws=…&rest=…, in which case
 * the UI shows a "custom endpoint" badge.
 *
 *   npm run mock            # http://localhost:8787 + ws://localhost:8787
 *   open "http://localhost:5173/?venue=binance&symbol=MOCKUSDT&ws=ws://localhost:8787&rest=http://localhost:8787"
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const TICK = 0.5;
const CYCLE_SEC = Number(process.env.MOCK_CYCLE ?? 240);

let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const expRand = (mean: number) => -Math.log(1 - rnd()) * mean;
const round = (p: number) => Math.round(p / TICK) * TICK;

const bids = new Map<number, number>();
const asks = new Map<number, number>();
let updateId = 1_000_000;
let changed = { b: new Map<number, number>(), a: new Map<number, number>() };
const start = Date.now();

function setLevel(side: 'b' | 'a', p: number, q: number) {
  const book = side === 'b' ? bids : asks;
  const qty = Math.max(0, +q.toFixed(4));
  if (qty === 0) book.delete(p);
  else book.set(p, qty);
  changed[side].set(p, qty);
}

const bestBid = () => Math.max(...bids.keys());
const bestAsk = () => Math.min(...asks.keys());

function init(mid: number) {
  for (let i = 0; i < 300; i++) {
    bids.set(round(mid - TICK / 2 - i * TICK), +(0.2 + expRand(0.8)).toFixed(4));
    asks.set(round(mid + TICK / 2 + i * TICK), +(0.2 + expRand(0.8)).toFixed(4));
  }
}
init(67_000);

type Regime = 'calm' | 'floor' | 'coil' | 'breakout';
function regime(): Regime {
  const t = ((Date.now() - start) / 1000) % CYCLE_SEC;
  if (t < CYCLE_SEC * 0.4) return 'calm';
  if (t < CYCLE_SEC * 0.6) return 'floor';
  if (t < CYCLE_SEC * 0.8) return 'coil';
  return 'breakout';
}

interface Fill {
  price: number;
  qty: number;
  aggressor: 'buy' | 'sell';
}

function execute(aggressor: 'buy' | 'sell', qty: number, absorb: boolean): Fill[] {
  const fills: Fill[] = [];
  let left = qty;
  while (left > 1e-6) {
    const side = aggressor === 'buy' ? 'a' : 'b';
    const book = side === 'a' ? asks : bids;
    const px = side === 'a' ? bestAsk() : bestBid();
    const avail = book.get(px)!;
    const take = Math.min(avail, left);
    fills.push({ price: px, qty: +take.toFixed(4), aggressor });
    left -= take;
    // In the floor regime a passive buyer refills the bid every time it's hit.
    if (absorb && side === 'b') setLevel(side, px, avail + 0.2);
    else setLevel(side, px, avail - take);
  }
  return fills;
}

function maintain() {
  // keep ladders deep and the spread tight
  const bb = bestBid();
  const ba = bestAsk();
  if (ba - bb > TICK * 1.5) {
    if (rnd() < 0.5) setLevel('b', round(bb + TICK), 0.2 + expRand(0.5));
    else setLevel('a', round(ba - TICK), 0.2 + expRand(0.5));
  }
  const lo = Math.min(...bids.keys());
  const hi = Math.max(...asks.keys());
  if (bids.size < 300) setLevel('b', round(lo - TICK), 0.2 + expRand(0.8));
  if (asks.size < 300) setLevel('a', round(hi + TICK), 0.2 + expRand(0.8));
  if (bids.size > 320) setLevel('b', lo, 0);
  if (asks.size > 320) setLevel('a', hi, 0);
}

function noise(scale = 1) {
  for (let i = 0; i < 6; i++) {
    const side = rnd() < 0.5 ? 'b' : 'a';
    const k = Math.floor(expRand(12));
    const p = side === 'b' ? round(bestBid() - k * TICK) : round(bestAsk() + k * TICK);
    const book = side === 'b' ? bids : asks;
    const cur = book.get(p) ?? 0;
    setLevel(side, p, Math.max(0.05, cur + (rnd() - 0.5) * 0.6 * scale));
  }
}

let wallPlaced = false;

function step(): Fill[] {
  const r = regime();
  const fills: Fill[] = [];
  noise(r === 'coil' ? 0.4 : 1);
  if (r !== 'breakout') wallPlaced = false;

  const n = r === 'calm' ? (rnd() < 0.6 ? 1 : 0) : r === 'coil' ? (rnd() < 0.5 ? 1 : 0) : 2;
  for (let i = 0; i < n; i++) {
    let buyBias = 0.5;
    let size = expRand(0.15);
    if (r === 'floor') {
      buyBias = 0.12;
      size = expRand(0.6);
    }
    if (r === 'coil') {
      buyBias = 0.62;
      size = expRand(0.08);
    }
    if (r === 'breakout') {
      buyBias = 0.85;
      size = expRand(0.5);
    }
    const aggr = rnd() < buyBias ? 'buy' : 'sell';
    // calm regime random-walks: a slight bias toward whichever side is thinner
    fills.push(...execute(aggr, +size.toFixed(4), r === 'floor'));
  }

  if (r === 'coil') {
    // bids stack under price
    const p = round(bestBid() - Math.floor(rnd() * 8) * TICK);
    setLevel('b', p, (bids.get(p) ?? 0) + 0.35);
  }
  if (r === 'breakout' && !wallPlaced) {
    wallPlaced = true;
    const p = round(bestAsk() + 6 * TICK);
    setLevel('a', p, 25);
  }
  maintain();
  return fills;
}

// ------------------------------------------------------------------ servers

const klines = () => {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const mid = (bestBid() + bestAsk()) / 2;
  let px = mid - 40;
  return Array.from({ length: 60 }, (_, i) => {
    const o = px;
    const c = o + (rnd() - 0.48) * 20;
    const h = Math.max(o, c) + rnd() * 12;
    const l = Math.min(o, c) - rnd() * 12;
    px = c;
    const v = 5 + rnd() * 20;
    return [now - (60 - i) * 60_000, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), v.toFixed(3), 0, 0, 0, (v * (0.3 + rnd() * 0.4)).toFixed(3)];
  });
};

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname === '/api/v3/depth') {
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const b = [...bids.entries()].sort((x, y) => y[0] - x[0]).slice(0, limit);
    const a = [...asks.entries()].sort((x, y) => x[0] - y[0]).slice(0, limit);
    res.end(JSON.stringify({ lastUpdateId: updateId, bids: b.map(([p, q]) => [p.toFixed(1), q.toFixed(4)]), asks: a.map(([p, q]) => [p.toFixed(1), q.toFixed(4)]) }));
    return;
  }
  if (url.pathname === '/api/v3/klines') {
    res.end(JSON.stringify(klines()));
    return;
  }
  res.statusCode = 404;
  res.end('{"msg":"not found"}');
});

const wss = new WebSocketServer({ server });
const clients = new Set<{ ws: WebSocket; symbol: string }>();
wss.on('connection', (ws, req) => {
  const streams = new URL(req.url ?? '/', 'http://x').searchParams.get('streams') ?? '';
  const symbol = (streams.split('@')[0] || 'mockusdt').toUpperCase();
  const c = { ws, symbol };
  clients.add(c);
  ws.on('close', () => clients.delete(c));
});

let aggId = 1;
setInterval(() => {
  changed = { b: new Map(), a: new Map() };
  const fills = step();
  const now = Date.now();
  const U = updateId + 1;
  updateId += Math.max(1, changed.b.size + changed.a.size);
  const depth = {
    e: 'depthUpdate',
    E: now,
    U,
    u: updateId,
    b: [...changed.b.entries()].map(([p, q]) => [p.toFixed(1), q.toFixed(4)]),
    a: [...changed.a.entries()].map(([p, q]) => [p.toFixed(1), q.toFixed(4)]),
  };
  for (const c of clients) {
    const s = c.symbol.toLowerCase();
    for (const f of fills) {
      c.ws.send(
        JSON.stringify({
          stream: `${s}@aggTrade`,
          data: { e: 'aggTrade', E: now, s: c.symbol, a: aggId++, p: f.price.toFixed(1), q: f.qty.toFixed(4), f: 0, l: 0, T: now, m: f.aggressor === 'sell', M: true },
        }),
      );
    }
    c.ws.send(JSON.stringify({ stream: `${s}@depth@100ms`, data: { ...depth, s: c.symbol } }));
  }
}, 100);

server.listen(PORT, () => {
  console.log(`[mock-exchange] SYNTHETIC Binance-protocol market on http://localhost:${PORT} (ws same port). Test use only.`);
});
