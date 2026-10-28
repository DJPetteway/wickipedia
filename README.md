# Wickipedia — the chain knows

> **Read the chain. See the wick coming.**

Wickipedia is a shiny toy with a serious engine inside. Pick a token and you see exactly two things:

1. **A candy gauge.** A glossy jelly bead slides between **SELLERS** and **BUYERS**, with one big word under it (BUYERS / BALANCED / SELLERS).
2. **A magic 8-ball.** It answers in real time from live swaps, pool liquidity and bonding curves:

```
ASK AGAIN LATER · OUTLOOK GOOD · SIGNS POINT UP · WICK LOADING… · IT WENT
FLOOR FORMING · LIQUIDITY VANISHED · WHALE APED IN · JUST ONE WALLET · FAKEOUT · REPLY HAZY
```

The 8-ball never says "certain", and with no data it says **CANNOT SAY NOW**. The evidence behind each answer is kept for screen readers and the hover tooltip ("$9.8K of sells hit the pool… should have moved price −31%, it moved −4%…").

A tiny **micro changelog** at the bottom shows what the engine is doing right now, for example:
- `pulled 300 swaps → 4 new, 296 deduped`
- `floor scan: $2.1K sells in 120s · 0.6σ — normal selling`
- `curve reserves read · 57.5% full`
- `calibration · 41 outcomes counted · 12 in flight`

Every line is a real processing step, not decoration.

## Where it reads

| Chain | Venues | Data |
|---|---|---|
| **Solana** | pump.fun bonding curves, PumpSwap, Raydium (AMM / CLMM / LaunchLab, which is what **StonkFun** launches on), Meteora, Orca | GeckoTerminal (pools, swaps, liquidity) + PumpPortal (real-time pump.fun curve trades) |
| **Robinhood Chain** (Arbitrum Orbit L2) | DEX pools indexed by GeckoTerminal | GeckoTerminal, with the network id found automatically |
| **Arbitrum One** | Uniswap, Camelot, … | GeckoTerminal |

Both data sources are free and need no API keys. The data layer is pluggable (`src/sources/market.ts`), so a paid real-time provider can be added later without touching the engine.

These are **DEX pools and bonding curves, not order books**. There are no bids or asks to read. Wickipedia measures what actually moves price on-chain: swaps (side, size, wallet), liquidity, and curve reserves.

## Use it

### On your phone / public site (GitHub Pages)

The repo ships a Pages workflow (`.github/workflows/pages.yml`). It builds, tests and deploys `main`. One-time setup:

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge this branch into `main` (or run the "deploy to GitHub Pages" workflow by hand).
3. Open **https://djpetteway.github.io/wickipedia/** on your phone. To add it to your home screen:
   - **iPhone:** Share → *Add to Home Screen*
   - **Android:** ⋮ → *Install app*

   It then opens full-screen like an app.

Links are shareable. The URL carries the token, e.g. `…/wickipedia/?chain=solana&token=<mint>`.

### Locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Tap the token pill at the top and choose one of these:
- paste a mint / contract / pool address
- paste a pump.fun, DexScreener or GeckoTerminal link
- search by name
- tap something from *trending*, *new pools* or *live pump.fun launches*

### Headless agent (terminal / Discord / Slack)

```bash
npm run agent -- --chain solana --token <mint-or-link>
npm run agent -- --chain solana --token <mint> --webhook https://discord.com/api/webhooks/…
npm run agent -- --help
```

## How it works

```
GeckoTerminal (poll ~6s) ─┐
PumpPortal (WebSocket)  ──┼─► sources/ ─► engine/poolEngine.ts ─► gauge + 8-ball (UI)  /  agent
                          │                ├ amm.ts          exact x·y=k + pump.fun curve math
                          │                ├ stateMachine.ts setup states
                          │                ├ calibration.ts  empirical odds
                          │                └ oracle.ts       8-ball answers
```

### The pressure gauge (what the bead shows)

The bead position is a score in [−1, 1]. It is a fixed, documented blend; **it is not a probability**:

| Part | Weight | Definition |
|---|---|---|
| Flow 1m | 30% | (buy $ − sell $) / total over the last minute |
| Flow 5m | 25% | the same over 5 minutes |
| Wallets | 20% | (distinct buyers − sellers) / total over 5 minutes |
| vs Liq | 25% | tanh(net 5-min $ ÷ $ needed to move price 2% on this pool) |

The weights are renormalised when a source doesn't report wallets or liquidity.

### Detectors (all thresholds in `src/engine/config.ts`)

- **Floors under sell pressure.** On a pool we can compute exactly how far gross selling *should* have moved price. A floor is called when all of these hold for at least 10 seconds:
  - sells are ≥1.5σ above normal and ≥2.5× typical volume;
  - sells are ≥55% of flow, spread across the 2-minute window;
  - price moved less than 35% of the implied move.

  Ceilings are the mirror image. Each floor and ceiling is tracked afterwards to see whether it held.
- **Liquidity pulls (rug radar).** In a constant-product pool, USD liquidity naturally scales with √price, and that effect is removed first. Then ≥20% of liquidity vanishing within 3 minutes means LP was pulled.
- **Whale prints:** single swaps ≥ max($2K, 1% of liquidity), with the price impact they imply.
- **One-wallet markets:** one wallet is ≥50% of one side's 5-minute volume.
- **Bids / exits stacking:** ≥8 distinct wallets on one side and ≥2× the other side, while price holds.
- **Graduation.** pump.fun curve progress and SOL-to-graduate come from pump.fun's published curve constants. They are labelled as estimates, because launchpads change parameters.
- **Setup state machine:** `NEUTRAL → WATCHING → COILING → IMMINENT → BREAKOUT / FAILED → COOLDOWN`. The trigger and invalidation levels come from the prior 5-minute range. A breakout needs price through the trigger *and* 1-minute flow agreeing.

### Where the odds come from

The engine calibrates itself instead of predicting:

1. **Sampling.** Every 15 s it records the score bucket and price, then sets barriers at ±max(0.5%, 1σ·√h) for 5 m, 15 m and 1 h horizons.
2. **Labelling.** Whichever barrier price touches first is the outcome.
3. **Reporting.** The engine computes the smoothed frequency for readings like the current one, but only once the effective sample size is ≥10. Until then there is no percentage at all. The odds feed the oracle's evidence text, and the agent prints them.
4. **Storage.** Counts are stored per token in the browser, so the odds start empty and sharpen the longer you run.

### Data integrity

- **Paused signals.** If a source goes quiet for 45 s, signals pause and the 8-ball says why.
- **Discarded samples.** In-flight calibration samples that span a data hole are discarded, not guessed.
- **De-duplication.** Swaps are de-duplicated by transaction hash, so polling overlap or two sources never double count.
- **Old swaps.** Swaps older than 10 minutes only feed candles, never live flow.
- **Rate limits.** The free GeckoTerminal limit (~30 req/min) is shared per IP; the client spaces requests and backs off on HTTP 429.

## Development

```bash
npm test             # vitest: AMM math, parsers, resolution, rate limiter, engine detectors, state machine, calibration, oracle
npm run typecheck
npm run mock         # LOCAL TEST TOOL: synthetic GeckoTerminal + PumpPortal on :8787
```

Run the app against the mock (all prices are synthetic, and the UI shows a **mock data** badge):

```
http://localhost:5173/?api=http://localhost:8787&pumpws=ws://localhost:8787/api/data
```

### Honest limitations

- **Not tested against the live APIs yet.** The build environment couldn't reach GeckoTerminal or PumpPortal. The parsers follow their documented formats and are tested against fixtures and the mock.
- **Not tick-by-tick.** GeckoTerminal data is polled, so it is near-real-time. pump.fun curve trades via PumpPortal are real-time.
- **Robinhood Chain coverage** depends on GeckoTerminal indexing it. If it isn't listed yet, the app says so instead of showing anything.
- **Rough impact on concentrated pools.** For concentrated-liquidity pools (CLMM / DLMM / v3), impact from reported liquidity is an approximation.
- **Heuristic thresholds.** Detector thresholds are hand-set, not fitted. The calibrated odds tell you how well they work on a given token.

---

*Wickipedia reads the chain; it doesn't know the future. Memecoins can go to zero in minutes. Not financial advice.*
