# Wickipedia — The Order Book Knows

> **Read the book. See the wick coming.**

Wickipedia is a real-time order-book intelligence agent for crypto. It reads live L2 order books and the aggressive trade tape from centralized exchanges, measures liquidity and flow, and tells you, in plain trader language, when the book is setting up for a move. It also flags when a setup falls apart.

It works as a **dashboard**, a **pop-out widget**, a **desktop alert tool** and a **headless agent** that can post to Discord or Slack. It doubles as a **wick explainer**: every reading comes with a short lesson on what it means and what it tends to look like on a candle.

```
WICKIPEDIA IS COOKING      Buy-side pressure is building near resistance.
THE WALL IS GETTING EATEN  Aggressive buyers consumed 62% of the ask wall at 67,012.50 ($410K traded into it).
FLOOR FORMING              $1.2M of market sells hit the bid (2.3σ above normal) and price moved only −0.8 bps.
LIQUIDITY JUST VANISHED    An ask wall of $380K was pulled with only 4% of it trading. This may be a liquidity withdrawal, not proof of a breakout.
WICK LOADING… ↑            Compression and directional order flow suggest an emerging setup.
BREAKOUT CONFIRMED ↑       Price crossed the configured trigger level with supporting confirmation.
FALSE ALARM                Price fell back through 67,020.00 within 15s — that was a wick, not a breakout.
```

Wickipedia only emits an alert when the engine has measured the condition. The numbers in each alert are the measurements that triggered it.

---

## Quick start

Requires **Node ≥ 22** (for the built-in `WebSocket` used by the headless agent).

```bash
npm install
npm run dev          # dashboard at http://localhost:5173
```

Pick a venue and pair in the header. Wickipedia connects straight from your browser to the exchange's public market-data endpoints. No API keys, no backend.

| Venue | Pairs (type any listed pair) | Notes |
|---|---|---|
| Binance | `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `DOGEUSDT`, `XRPUSDT`, `PEPEUSDT`, … | Not reachable from some regions (incl. the US). |
| Binance.US | `BTCUSDT`, `ETHUSDT`, … | Same protocol, thinner books. |
| Coinbase | `BTC-USD`, `ETH-USD`, `SOL-USD`, … | Advanced Trade public WebSocket. |

URL parameters make any view shareable: `?venue=coinbase&symbol=ETH-USD&view=widget`.

### Widget & alerts

- **Pop-out widget**: a compact window with the state, price, pressure, odds and latest alerts. You can also open `?view=widget` directly, e.g. on a second monitor or as a stream overlay (OBS browser source).
- **Enable alerts**: opt-in desktop notifications for high-severity events (rate-limited per alert type). The browser tab title also shows the live state (`IMMINENT↑ · 67,012.50 BTCUSDT`).

### Headless agent (terminal / Discord / Slack)

```bash
npm run agent -- --venue coinbase --symbol BTC-USD
npm run agent -- --venue binance --symbol SOLUSDT --webhook https://discord.com/api/webhooks/…
npm run agent -- --venue binance --symbol BTCUSDT --json > events.ndjson
npm run agent -- --help
```

The agent runs the same engine with no browser. Calibration counts persist in `./.wickipedia/` between runs, and `--record file.ndjson` captures raw venue messages for later analysis.

### Production build

```bash
npm run build        # static site in dist/ — host anywhere (GitHub Pages, Netlify, S3…)
npm run preview
```

---

## What's on screen

| # | Panel | What it shows |
|---|---|---|
| 1 | **Header** | Brand, venue/pair, market-data health pill. The pill shows LIVE / SYNCING / RESYNCING / STALE, latency, messages per second, time since the last message and resync count. |
| 2 | **Hero** | Live price, 1-min change, spread and book age; the setup state and why it changed; trigger, invalidation and 2-min range; the pressure gauge and its four components. |
| 3 | **Depth** | Cumulative bid/ask depth at ±0.1% to ±2%. Detected walls and the active trigger are drawn on it. Hover for size to any price. |
| 4 | **What the book is saying** | Plain-English reads generated from the current numbers. Each one links to its lesson. |
| 5 | **Book imbalance** | Imbalance at ±0.10%, ±0.25% and ±0.50% bands, plus microprice. |
| 6 | **Aggressive flow** | Taker buy vs sell notional over 10 s and 60 s, CVD, and OFI z-score with sparklines. |
| 7 | **Walls & absorption** | Detected walls with their status (holding / nibbled / eaten), recent floors and ceilings, and whether each is still holding. |
| 8 | **Breakout odds (calibrated)** | Up-first / down-first / no-break frequencies for 1 m, 5 m and 15 m, each with a credible range, sample size and base rate. Also floor and ceiling hold rates. |
| 9 | **Wick explainer** | 1-min candles with event markers. Hover or arrow-key through them to see each candle's anatomy (wick/body split, taker buy vs sell volume) and what it means. |
| 10 | **The feed** | Chronological log of every state transition and alert, with timestamps, the evidence behind it and a "why it matters" lesson. |
| — | **Wick School** | 13 short lessons: order books, imbalance, OFI, walls, absorption, coiling, reading wicks, how the odds are computed, and CEX vs DEX. |

The layout is dark and dense, and works from phone width up to ultrawide. Accessibility features:

- **Colorblind-safe color mode.** The default teal/rose is checked for adequate color-vision-deficiency separation, and a blue/orange mode is one click away.
- **Never color alone.** Every bid/ask reading also carries ▲/▼ arrows and text labels.
- **Keyboard support.** Charts and candles can be operated by keyboard, with visible focus rings.
- **Screen readers.** State changes are announced through `aria-live`, and meters and charts have text alternatives.
- **Motion and contrast settings.** `prefers-reduced-motion` and `forced-colors` are respected.

---

## How it works

```
 exchange WS + REST ──► feeds/  (protocol + sequencing)  ──►  engine/  (pure, deterministic)  ──►  UI / agent
                         ├ binance.ts  diff-depth + snapshot   ├ orderbook.ts   sorted L2 book
                         └ coinbase.ts level2 + market_trades  ├ sync.ts        sequencing rules
                                                               ├ engine.ts      features, score, detectors
                                                               ├ walls.ts       wall tracking
                                                               ├ stateMachine.ts setup states
                                                               ├ calibration.ts empirical odds
                                                               ├ copy.ts        alert wording
                                                               └ narrative.ts   plain-English reads
```

The **engine is the source of truth**. It is pure TypeScript with no I/O, and every timestamp is passed in, so it behaves identically in the browser, in the Node agent and in tests. The UI only renders what the engine measured.

### Data integrity

- **Binance:** a diff-depth stream is synced to a REST snapshot following the documented update-id rules. Buffered events are bridged into the snapshot, and any `U ≠ prev u + 1` gap triggers a rebuild.
- **Coinbase:** a full-book WebSocket snapshot is followed by absolute updates. `sequence_num` is checked on every message, and a gap triggers a reconnect.
- **Signals pause whenever the book can't be trusted:** not yet synced, crossed, resyncing, or silent for 10 s. The UI and agent say why, and the setup state resets. In-flight calibration samples that span a data hole are discarded rather than guessed.
- **Aggressor side comes from the venue:** Binance `m` (buyer is maker → taker sold); Coinbase `side`, which is documented as the maker side.
- **Latency is approximate.** It is shown as local receive time minus exchange event time, so it includes your clock offset.

### Signals

| Signal | Definition |
|---|---|
| Imbalance | `(bidQty − askQty)/(bidQty + askQty)` within N bps of mid |
| Microprice | `(ask·bidSize + bid·askSize)/(bidSize + askSize)` |
| OFI | Cont–Kukanov–Stoikov best-quote order-flow imbalance, 10 s sum ÷ mean L1 depth, z-scored against the pair's own last 5 min |
| Flow delta | `(takerBuy − takerSell)/(takerBuy + takerSell)` notional, 10 s and 60 s; CVD in base units |
| Volatility | Std of 1 s log returns. **Compression** = 1-min σ ÷ 10-min σ |
| Walls | Level ≥ 6× the median level size within ±1.5%, alive ≥ 3 s. **Eaten** = ≥ 50% gone and ≥ 50% of the drop explained by taker trades at the level. **Vanished** = ≥ 70% gone and ≤ 20% of it traded |
| Floor (ceiling) | Over 30 s: taker sell (buy) notional ≥ 1.5σ above its own baseline, ≥ 60% of volume, sustained in ≥ half the seconds. Price moves less than max(3 bps, 0.5σ√30 s), and near-touch bid (ask) depth stays ≥ 80% |
| Stacking | Near-touch depth +30% in 30 s, imbalance ≥ 25% on that side, and the opposing aggression fails to move price |

The **pressure score** in [−1, 1] is a fixed, documented blend: 30% imbalance, 25% OFI, 30% flow, 15% microprice. It drives the state machine. **It is not a probability.** All thresholds live in [`src/engine/config.ts`](src/engine/config.ts).

### Setup state machine

`NEUTRAL → WATCHING → COILING → IMMINENT → BREAKOUT → COOLDOWN`, with `FAILED` as the exit when a setup breaks its invalidation level or a breakout snaps back inside the range (a fakeout wick).

- **Trigger and invalidation** are the edges of the prior 2-minute range. They freeze once the setup coils.
- **IMMINENT requires** compression, aligned pressure ≥ 0.45, price near the trigger, and a supporting book event in the last 30 s (wall eaten, floor or ceiling, stacking).
- **BREAKOUT requires** price through the trigger *and* 10 s flow agreeing.

Every transition carries a reason string built from the numbers that caused it. Those strings are what the feed shows.

### Where the percentages come from

The engine calibrates itself instead of predicting:

1. **Sampling.** Every 10 s it records the pressure-score bucket and mid, then sets symmetric barriers at ±max(2 bps, 1σ·√h) for h = 1, 5 and 15 min (triple-barrier labelling).
2. **Labelling.** Whichever barrier price touches first is the outcome. If neither is touched, the outcome is *no break*.
3. **Reporting.** The UI shows the Dirichlet(1,1,1)-smoothed frequency of each outcome for the **current** bucket, with an 80% credible range, the raw `n`, and the **effective** `n` (discounted because overlapping horizons are autocorrelated). It also shows the base rate across all buckets for comparison.
4. **Thresholds.** Below `n_eff = 10` the estimate is labelled *calibrating*. With zero samples, no number is shown.

Counts are stored per venue and pair (browser `localStorage`, or `.wickipedia/` for the agent), so estimates sharpen the longer you run. Floors and ceilings are tracked the same way: did price stay on the right side of the level over each horizon?

**No LLM sets any number.** The headlines and plain-English reads are deterministic templates filled with measured values. You could add an LLM summarizer on top of the event feed, but it must never set or alter a probability.

### CEX order books ≠ DEX pools

Wickipedia reads **centralized-exchange limit order books**: discrete resting orders from many participants. A **DEX AMM pool** (Uniswap-style) has no order book. Its liquidity is a pricing curve (x·y=k, or concentrated LP ranges), so walls, absorption and OFI don't exist there in the same form. Wickipedia doesn't ingest, show or infer DEX liquidity, and every view is labelled `CEX L2 book`.

---

## Development

```bash
npm test             # vitest — engine, sync rules, parsers, calibration, walls, state machine, feeds
npm run typecheck
npm run mock         # LOCAL TEST TOOL: synthetic Binance-protocol exchange on :8787
```

The mock exchange cycles through calm, absorption, coiling and breakout regimes so you can exercise the whole pipeline offline:

```
http://localhost:5173/?venue=binance&symbol=MOCKUSDT&ws=ws://localhost:8787&rest=http://localhost:8787
```

Its prices are synthetic. The app only uses it when you pass `ws`/`rest` overrides, and then the health pill shows a **custom endpoint** badge.

### Honest limitations

- The browser connects directly to exchanges, so availability depends on your region and network. Binance.com is blocked in the US; use Binance.US or Coinbase.
- Detector thresholds are hand-set heuristics for liquid spot pairs, not parameters fitted to data. The calibrated odds tell you how well they work on your pair. Thin pairs produce noisier walls and imbalances.
- Order books can be spoofed. A wall that vanishes may never have been meant to trade, and Wickipedia says so.
- Calibration starts empty. Expect "calibrating" for the first ~20 min at 1 m and longer at 5 and 15 m.

---

*Wickipedia describes what the order book is doing. It is not financial advice and nothing here guarantees a move.*
