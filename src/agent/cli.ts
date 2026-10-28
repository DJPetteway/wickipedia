/**
 * Wickipedia headless agent — same engine as the dashboard, no browser.
 *
 *   npm run agent -- --venue coinbase --symbol BTC-USD
 *   npm run agent -- --venue binance --symbol SOLUSDT --webhook https://discord.com/api/webhooks/…
 *
 * Prints alerts to the terminal, optionally POSTs them to a Discord/Slack-style
 * webhook, and keeps calibration counts in ./.wickipedia/ between runs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WickEngine, type KVStore } from '../engine/engine';
import { fmtPx } from '../engine/copy';
import type { Severity, WickEvent } from '../engine/types';
import { createFeed, findVenue, normalizeSymbol, VENUES } from '../feeds';

const { values: args } = parseArgs({
  options: {
    venue: { type: 'string', default: 'binance' },
    symbol: { type: 'string' },
    webhook: { type: 'string' },
    'min-severity': { type: 'string', default: 'notice' },
    json: { type: 'boolean', default: false },
    record: { type: 'string' },
    'status-every': { type: 'string', default: '30' },
    'data-dir': { type: 'string', default: '.wickipedia' },
    ws: { type: 'string' },
    rest: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`Wickipedia agent — read the book, see the wick coming.

Options:
  --venue <id>            ${VENUES.map((v) => v.id).join(' | ')} (default binance)
  --symbol <pair>         e.g. BTCUSDT (Binance) or BTC-USD (Coinbase)
  --webhook <url>         POST alerts as {"content","text"} (Discord & Slack compatible)
  --min-severity <level>  info | notice | alert (default notice)
  --json                  print events as NDJSON instead of pretty text
  --record <file>         append every raw venue message to an NDJSON file
  --status-every <sec>    status line cadence, 0 to disable (default 30)
  --data-dir <dir>        where calibration counts persist (default .wickipedia)
  --ws/--rest <url>       override venue endpoints (testing only)`);
  process.exit(0);
}

const venue = findVenue(args.venue!);
if (!venue) {
  console.error(`Unknown venue "${args.venue}". Try: ${VENUES.map((v) => v.id).join(', ')}`);
  process.exit(1);
}
const symbol = normalizeSymbol(venue, args.symbol ?? venue.symbols[0].id);
const rank: Record<Severity, number> = { info: 0, notice: 1, alert: 2 };
const minSev = (args['min-severity'] as Severity) in rank ? (args['min-severity'] as Severity) : 'notice';

// ------------------------------------------------------------------ storage
const dir = args['data-dir']!;
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = join(dir, 'calibration.json');
const fileStore: KVStore = {
  get(k) {
    try {
      return (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>)[k] ?? null;
    } catch {
      return null;
    }
  },
  set(k, v) {
    let all: Record<string, string> = {};
    try {
      all = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* first write */
    }
    all[k] = v;
    writeFileSync(file, JSON.stringify(all));
  },
};

// ------------------------------------------------------------------ output
const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2);
const bold = c(1);
const lime = c(92);
const red = c(91);
const teal = c(96);
const amber = c(93);

function printEvent(e: WickEvent) {
  if (args.json) {
    console.log(JSON.stringify({ type: 'event', venue: venue!.id, symbol, ...e }));
    return;
  }
  const t = new Date(e.ts).toISOString().slice(11, 19);
  const arrow = e.direction === 'up' ? teal('▲') : e.direction === 'down' ? red('▼') : ' ';
  const title = e.severity === 'alert' ? amber(bold(e.title)) : e.severity === 'notice' ? bold(e.title) : e.title;
  console.log(`${dim(t)} ${arrow} ${title}\n         ${e.body}`);
}

async function postWebhook(e: WickEvent) {
  if (!args.webhook) return;
  const text = `**${e.title}** · ${venue!.name} ${symbol}\n${e.body}`;
  try {
    const res = await fetch(args.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text, text }),
    });
    if (!res.ok) console.error(dim(`webhook HTTP ${res.status}`));
  } catch (err) {
    console.error(dim(`webhook failed: ${String(err)}`));
  }
}

// ------------------------------------------------------------------ run
const engine = new WickEngine({
  venueId: venue.id,
  venueName: venue.name,
  venueKind: venue.kind,
  symbol,
  store: fileStore,
  onEvent: (e) => {
    if (rank[e.severity] < rank[minSev]) return;
    printEvent(e);
    if (e.severity === 'alert') void postWebhook(e);
  },
});

const feed = createFeed(venue, symbol, engine, {
  wsBase: args.ws,
  restBase: args.rest,
  onRaw: args.record ? (ch, raw) => appendFileSync(args.record!, `${JSON.stringify({ t: Date.now(), ch, raw })}\n`) : undefined,
});

console.log(`${lime(bold('WICKIPEDIA'))} ${dim('— the order book knows')}\n${dim(`${venue.name} · ${symbol} · CEX L2 order book · ${venue.note}`)}`);
if (args.ws || args.rest) console.log(amber('custom endpoints in use — data is only as real as that endpoint'));
feed.start();

let lastStatus = 0;
const statusEvery = Number(args['status-every']) * 1000;
const timer = setInterval(() => {
  const s = engine.tick(Date.now());
  if (!statusEvery || s.now - lastStatus < statusEvery) return;
  lastStatus = s.now;
  if (args.json) {
    console.log(
      JSON.stringify({
        type: 'status',
        ts: s.now,
        valid: s.valid,
        mid: s.mid,
        state: s.setup.state,
        direction: s.setup.direction,
        score: s.score,
        trigger: s.setup.trigger,
        invalidation: s.setup.invalidation,
        estimates: s.estimates.map((e) => ({ h: e.horizonSec, ready: e.ready, n: e.n, counts: e.counts, ...(e.ready ? { up: e.up.p, down: e.down.p } : {}) })),
      }),
    );
    return;
  }
  if (!s.valid) {
    console.log(dim(`[${s.health.status}] ${s.invalidReason}`));
    return;
  }
  const est = s.estimates.find((e) => e.horizonSec === 300);
  const odds = est?.ready
    ? `5m ▲${(est.up.p * 100).toFixed(0)}% ▼${(est.down.p * 100).toFixed(0)}% (n=${est.n})`
    : `5m odds: calibrating (${est?.counts.up ?? 0}▲/${est?.counts.down ?? 0}▼/${est?.counts.flat ?? 0}· resolved)`;
  console.log(
    dim(
      `${fmtPx(s.mid!)} · ${s.setup.state}${s.setup.direction ? (s.setup.direction === 'up' ? '↑' : '↓') : ''} · pressure ${
        s.warmup.ready ? s.score.toFixed(2) : `warming ${s.warmup.have}/${s.warmup.need}s`
      } · ${odds} · ${s.health.messagesPerSec.toFixed(0)} msg/s`,
    ),
  );
}, 250);

const shutdown = () => {
  clearInterval(timer);
  feed.stop();
  engine.persistCalibration();
  console.log(dim('\ncalibration saved. bye.'));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
