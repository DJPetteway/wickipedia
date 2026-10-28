/**
 * Wickipedia headless agent — same engine as the dashboard, no browser.
 *
 *   npm run agent -- --chain solana --token <mint | pool | link>
 *   npm run agent -- --chain solana --token <mint> --webhook https://discord.com/api/webhooks/…
 *
 * Prints alerts to the terminal, optionally POSTs them to a Discord/Slack-style
 * webhook, and keeps calibration counts in ./.wickipedia/ between runs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fmtPct, fmtPx, fmtUsd } from '../engine/copy';
import { PoolEngine, type KVStore } from '../engine/poolEngine';
import type { ChainId, Severity, WickEvent } from '../engine/types';
import { CHAINS, findChain } from '../sources/chains';
import { GECKO_BASE, geckoClient } from '../sources/gecko';
import { sourceInfo, startMarket } from '../sources/market';
import { resolveInput, toMarketRef } from '../sources/resolve';

const { values: args } = parseArgs({
  options: {
    chain: { type: 'string', default: 'solana' },
    token: { type: 'string' },
    webhook: { type: 'string' },
    'min-severity': { type: 'string', default: 'notice' },
    json: { type: 'boolean', default: false },
    'status-every': { type: 'string', default: '30' },
    'data-dir': { type: 'string', default: '.wickipedia' },
    api: { type: 'string' },
    pumpws: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || !args.token) {
  console.log(`Wickipedia agent — read the chain, see the wick coming.

Options:
  --chain <id>            ${CHAINS.map((c) => c.id).join(' | ')} (default solana)
  --token <x>             token mint/contract, pool address, pump.fun/DEX link, or a name to search
  --webhook <url>         POST alerts as {"content","text"} (Discord & Slack compatible)
  --min-severity <level>  info | notice | alert (default notice)
  --json                  print events as NDJSON instead of pretty text
  --status-every <sec>    status line cadence, 0 to disable (default 30)
  --data-dir <dir>        where calibration counts persist (default .wickipedia)
  --api / --pumpws <url>  override GeckoTerminal / PumpPortal endpoints (testing only)`);
  process.exit(args.help ? 0 : 1);
}

const chain = findChain(args.chain!);
if (!chain) {
  console.error(`Unknown chain "${args.chain}". Try: ${CHAINS.map((c) => c.id).join(', ')}`);
  process.exit(1);
}
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

async function main() {
  const client = geckoClient(args.api ?? GECKO_BASE);
  const candidates = await resolveInput(args.token!, chain!.id as ChainId, client);
  if (!candidates.length) {
    console.error(`Nothing found for "${args.token}" on ${chain!.name}.`);
    process.exit(1);
  }
  const pick = candidates[0];
  const market = toMarketRef(pick);
  const plan = { pumpCurve: pick.pumpCurve };

  const printEvent = (e: WickEvent) => {
    if (args.json) {
      console.log(JSON.stringify({ type: 'event', chain: market.chain, token: market.token, ...e }));
      return;
    }
    const t = new Date(e.ts).toISOString().slice(11, 19);
    const arrow = e.direction === 'up' ? teal('▲') : e.direction === 'down' ? red('▼') : ' ';
    const title = e.severity === 'alert' ? amber(bold(e.title)) : e.severity === 'notice' ? bold(e.title) : e.title;
    console.log(`${dim(t)} ${arrow} ${title}\n         ${e.body}`);
  };

  const postWebhook = async (e: WickEvent) => {
    if (!args.webhook) return;
    const text = `**${e.title}** · $${market.symbol} (${market.venue})\n${e.body}`;
    try {
      const res = await fetch(args.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
      if (!res.ok) console.error(dim(`webhook HTTP ${res.status}`));
    } catch (err) {
      console.error(dim(`webhook failed: ${String(err)}`));
    }
  };

  const engine = new PoolEngine({
    market,
    source: sourceInfo(plan, !!market.pool),
    store: fileStore,
    onEvent: (e) => {
      if (rank[e.severity] < rank[minSev]) return;
      printEvent(e);
      if (e.severity === 'alert') void postWebhook(e);
    },
  });

  console.log(`${lime(bold('WICKIPEDIA'))} ${dim('— the chain knows')}`);
  console.log(dim(`$${market.symbol} · ${market.name} · ${market.venue} · ${chain!.name}${candidates.length > 1 ? ` (deepest of ${candidates.length} markets)` : ''}`));
  if (args.api || args.pumpws) console.log(amber('custom endpoints in use — data is only as real as that endpoint'));

  const stop = startMarket(engine, plan, { geckoBase: args.api, pumpWs: args.pumpws });

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
          price: s.price,
          state: s.setup.state,
          direction: s.setup.direction,
          score: s.score,
          flow5m: { buyUsd: s.flow.buyUsdLong, sellUsd: s.flow.sellUsdLong, buyers: s.flow.buyersLong, sellers: s.flow.sellersLong },
          curveProgress: s.pool?.curve?.progress ?? null,
          estimates: s.estimates.map((e) => ({ h: e.horizonSec, ready: e.ready, n: e.n, counts: e.counts, ...(e.ready ? { up: e.up.p, down: e.down.p } : {}) })),
        }),
      );
      return;
    }
    if (!s.valid) {
      console.log(dim(`[${s.health.status}] ${s.invalidReason}`));
      return;
    }
    const f = s.flow;
    const curve = s.pool?.curve ? ` · curve ${(s.pool.curve.progress * 100).toFixed(1)}%` : '';
    const net = f.netImpactLong !== null ? ` (≈${fmtPct(f.netImpactLong)})` : '';
    console.log(
      dim(
        `${fmtPx(s.price)} · ${s.setup.state}${s.setup.direction ? (s.setup.direction === 'up' ? '↑' : '↓') : ''} · pressure ${
          s.warmup.ready ? s.score.toFixed(2) : `warming ${s.warmup.have}/${s.warmup.need}s`
        } · 5m ${fmtUsd(f.buyUsdLong)} in / ${fmtUsd(f.sellUsdLong)} out${net} · ${f.buyersLong}▲/${f.sellersLong}▼ wallets${curve}`,
      ),
    );
  }, 250);

  const shutdown = () => {
    clearInterval(timer);
    stop();
    engine.persistCalibration();
    console.log(dim('\ncalibration saved. bye.'));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(red(String(e instanceof Error ? e.message : e)));
  process.exit(1);
});
