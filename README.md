# Wickipedia — the chain knows

> **Read the chain. See the wick coming.**

Wickipedia is a shiny toy with a serious engine inside. Search a token like you'd search Google, and you get a wiki-style entry that answers one question:

> **Is the sell side thin enough that buy pressure could knock this into price discovery — and is anything hiding that would sell into it?**

The page has three parts:

1. **The discovery meter.** A glossy candy gauge runs from **SUPPLY** to **DISCOVERY**, with one word under it: SUPPLY / NEUTRAL / BUILDING / LOADING / DISCOVERY.
2. **The article.** It reads like an encyclopedia entry ("From Wickipedia, the free market encyclopedia"):
   - **Read:** the verdict (*In price discovery · Price discovery loading · Building toward the high · No discovery setup · Distribution risk*) and a short prose summary built only from measured numbers.
   - **Verification:** the checklist below, each line with ✓ / ✗ / –.
   - **Infobox:** price, VWAP, recent high, Fib 0.618, next Fib target, $ needed to reach the high, liquidity or bonding-curve progress.
   - **Hatnote and references:** a hatnote for fresh alerts (a whale sell, an LP pull, a floor forming), and references saying where the data came from.
3. **The search.** A clean Google-style box under the article, with **Wickipedia Search** and **I'm Feeling Degen** (a random trending token). Suggestions show trending pools, new pools and live pump.fun launches.

A tiny **micro changelog** pinned to the bottom shows what the engine is processing right now, for example:
- `pulled 300 swaps → 4 new, 296 deduped`
- `discovery scan · 5/6 checks · loading`
- `distribution sweep · clean`
- `overhead supply 4% · VWAP $0.0₂129 · fib pos 0.91`

Every line is a real processing step.

### The discovery checks

On a DEX there is no literal order book. The sell side a buyer has to chew through is the pool's curve, plus *overhead supply* (holders who bought higher and may sell into a rally). Wickipedia measures both:

| Check | Passes when |
|---|---|
| **Thin sell side** | 5 min of buying ≥ half the $ needed to push price +10% on this pool's curve (x·y=k; exact on bonding curves) |
| **Buyers can reach the high** | Net 5-min buying covers ≥50% of the $ needed to reach the recent swing high — or price is already above it |
| **Little overhead supply** | ≤15% of the last ~8 h of volume traded above the current price (volume-by-price from 5-minute candles) |
| **Above VWAP** | Price > the ~8 h volume-weighted average price |
| **Fib structure** | Price is at or above the 0.618 retracement of the swing (low → high); above the high, the next 1.272 / 1.618 extension is the target |
| **No hidden distribution** | None of these: whale sells in 15 min, one wallet ≥40% of selling, sellers ≥45% of volume on green candles, price up while CVD falls (bearish divergence), an LP pull in 30 min, sellers outnumbering buyers 1.5:1 |

The verdict is set by these rules:
- **Distribution risk:** ≥2 distribution flags.
- **In price discovery:** above the prior high, distribution clean, and buyers ahead.
- **Loading:** all but one known check pass, with distribution clean.
- **Building:** at least half of the known checks pass.
- **No discovery setup:** anything else.

The meter is a fixed weighted blend of the checks. It is not a probability, and unknown checks are left out rather than guessed.

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
PumpPortal (WebSocket)  ──┼─► sources/ ─► engine/poolEngine.ts ─► meter + article (UI)  /  agent
                          │                ├ amm.ts          exact x·y=k + pump.fun curve math
                          │                ├ stateMachine.ts setup states
                          │                ├ calibration.ts  empirical odds
                          │                ├ discovery.ts    thin asks · overhead supply · VWAP · Fib · distribution
                          │                └ article.ts      the wiki-style read
```

### Flow pressure (feeds the setup state machine and the agent)

The flow-pressure score is in [−1, 1]. It is a fixed, documented blend; **it is not a probability**:

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
3. **Reporting.** The engine computes the smoothed frequency for readings like the current one, but only once the effective sample size is ≥10. Until then there is no percentage at all. The agent prints them.
4. **Storage.** Counts are stored per token in the browser, so the odds start empty and sharpen the longer you run.

### Data integrity

- **Paused signals.** If a source goes quiet for 45 s, signals pause and the article says why.
- **Discarded samples.** In-flight calibration samples that span a data hole are discarded, not guessed.
- **De-duplication.** Swaps are de-duplicated by transaction hash, so polling overlap or two sources never double count.
- **Old swaps.** Swaps older than 10 minutes only feed candles, never live flow.
- **Rate limits.** The free GeckoTerminal limit (~30 req/min) is shared per IP; the client spaces requests and backs off on HTTP 429.

## Development

```bash
npm test             # vitest: AMM math, parsers, resolution, rate limiter, engine detectors, state machine, calibration, discovery checks, article
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
