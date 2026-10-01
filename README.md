# Goriee AI Desk

A research-first trading desk prototype for the Bitget AI Base Camp Hackathon. It fetches public Bitget spot market data, calculates indicators on the server, and records paper trades in the browser. It does not place live orders.

![Market desk on a desktop viewport](screenshots/desktop-desk.png)

## Contents

- [What this is (and what it is not)](#what-this-is-and-what-it-is-not)
- [Workspace tour](#workspace-tour)
- [Tech stack](#tech-stack)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [API routes](#api-routes)
- [Browser data storage](#browser-data-storage)
- [Testing](#testing)
- [Screenshots](#screenshots)
- [Limitations and disclaimers](#limitations-and-disclaimers)
- [Related documentation](#related-documentation)

## What this is (and what it is not)

**It is:** a single-page trading research terminal that combines live Bitget public market data (REST plus WebSocket), server-side indicator math, LLM-driven research briefs, a natural-language backtester, a trade replay studio, and a paper trading ledger stored in your browser.

**It is not:** an exchange client. The app never touches private Bitget API keys, never signs requests, and never submits real orders. Every position, fill, and balance you see is simulated locally.

## Workspace tour

The app is organized into nine workspaces, reachable from the sidebar on desktop, an icon rail on tablet, and a bottom navigation bar with a "More" sheet on mobile.

| Workspace | What you can do there |
|---|---|
| **Market desk** | Search online Bitget USDT spot pairs (including tokenized RWA assets). Interactive candlestick/line chart with OHLCV crosshair inspection, EMA 20/50 overlays, Bollinger Bands (20, 2), MACD (12, 26, 9), support/resistance levels, volume bars, a CVD order-flow oscillator, a volatility squeeze radar, an L2 order book depth ladder, and a 4-chart multi-timeframe matrix. |
| **Market scanner** | Sort live tickers by 24h change or turnover, filter by asset type (Crypto vs. Tokenized), search, and jump straight to Desk, AI Brief, or Backtest for any row. Add markets to the watchlist in one click. |
| **Research** | Write a hypothesis, attach live market context (ticker snapshot, indicator pre-flight with RSI meter, 24h range, EMA alignment, S/R envelope), and generate an AI brief grounded in Bitget ticker data and completed candles. Reports include bull/bear theses, invalidation levels, optional live news search, Markdown export, and a shareable strategy card PNG. Four strategy lenses are available (Elliott Wave, Wyckoff, SMC & Liquidity, Quant Confluence). |
| **Backtests** | Describe a strategy in plain language; an LLM compiles it into a deterministic rule set (EMA crossover and RSI mean reversion families) with a 15-second fallback race. Runs replay historical Bitget candles with configurable fees/slippage and sampled order book spread. Outputs: dual equity curve vs. buy & hold, in-sample/out-of-sample walk-forward cards, Institutional Credibility Scorecard (alpha, retention decay, breakeven fee ceiling), Monte Carlo equity cone, a 2D parameter sensitivity heatmap with overfitting detection (robust plateau vs. fragile cliff), and a full simulated trades ledger. |
| **Trade replay** | Replay historical tape candle by candle with zoom/pan, a click-to-cut tape bar, playback transport controls, TP/SL/Mark brackets, [2R]/[3R]/[BE] quick snaps, discretionary order entry, and an end-of-session performance scorecard. |
| **Playbooks** | Save, search, and filter your strategy library. Three institutional starter templates are included. Deploy any playbook to the paper account ("Use in Paper") or send it to the backtest lab. An optional rule runner evaluates active playbook rules against live candle closes and logs simulated fills to an execution audit log. |
| **Paper account** | $10,000 virtual starting balance. Six account summary cards, an open positions table with TP/SL/trailing bracket pills, a Daily Loss Guard with capacity bar, price and risk alerts, and a simulated order ticket with capital presets (25%, 50%, 75%, Max), concentration alerts, and a dynamic Kelly sizer. Sub-tabs: Account, Trade Review (cumulative realized P&L curve, metrics, CSV export), and Analytics (Sharpe/Sortino/Calmar, expectancy, drawdown waterfall, rolling win rate, allocation donut, daily P&L calendar heatmap, streak tracking). |
| **Journal** | Saved research briefs with market snapshots and indicator history, a KPI strip, and a master-detail split layout for instant inspection without dialogs. |
| **Settings** | Six provider presets (NVIDIA NIM, OpenRouter, OpenAI, Claude, UnoRouter, Custom), a round-trip connection ping with latency readout, and a local storage privacy notice. |

Global extras: a Bloomberg-style command palette on `Ctrl+K` / `Cmd+K` (navigation, quick actions, live market search, and a natural-language position sizing calculator like `risk $250 2%`), live WebSocket ticker flashes with polling fallback, and workspace backup/restore for all local data.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3.6 (App Router, Turbopack) |
| UI | React 19.3.0, TypeScript 7, vanilla CSS design system (no component library) |
| Market data | Bitget public spot REST API and `wss://ws.bitget.com/v2/ws/public` |
| AI | Any OpenAI-compatible chat completions endpoint, configured at runtime |
| Charts | Hand-built SVG/HTML charts (no charting dependency) |
| Testing | `node --test` plus Puppeteer-core driving headless Chrome |
| Storage | Browser localStorage only; no database, no accounts |

## Run locally

### Prerequisites

- Node.js 20.9 or later (Next.js 16 requirement)
- npm
- Network access to Bitget's public API for live market data
- Google Chrome installed for the E2E suites (Puppeteer-core attaches to a local Chrome)

### Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Public market data requires no Bitget API key, and the core desk, scanner, paper account, and replay features work without any AI configuration.

### Enable AI features (optional)

To enable AI research, the Strategy Copilot, and natural-language backtest rules, copy `.env.example` to `.env.local` and set an OpenAI-compatible chat completions endpoint:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model
```

The API key is read only by server routes and is never sent to the browser. Do not paste it into the chat UI or commit `.env.local`. Providers can also be switched at runtime from the Settings workspace.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `LLM_BASE_URL` | `.env.local` | Base URL of an OpenAI-compatible chat completions endpoint. Required for AI research and natural-language backtests. |
| `LLM_API_KEY` | `.env.local` | Server-side API key. Never exposed to the browser. |
| `LLM_MODEL` | `.env.local` | Model name passed to the endpoint. |
| `GORIEE_TEST_BASE_URL` | test runs | Overrides the base URL that `test/api.test.mjs` targets (default: `127.0.0.1:3000`, auto-started if nothing is listening). |
| `GORIEE_RUN_LIVE_AI_TESTS=1` | test runs | Opt-in flag that enables the live LLM research test, which calls a real paid provider. Skipped by default. |

## Project structure

```
src/
  app/               # Next.js App Router: layout, page, error boundaries, OG image
    api/             # 11 server route handlers (see API routes below)
  components/        # React components: trading-desk.tsx (main shell), price-chart.tsx,
                     #   orderbook-panel.tsx, strategy-copilot.tsx, command-palette.tsx,
                     #   parameter-heatmap.tsx, portfolio-analytics.tsx, replay HUD, ...
  lib/               # Server + shared logic: bitget.ts (REST & indicators), bitget-ws.ts,
                     #   backtest.ts, monte-carlo.ts, parameter-matrix.ts, kelly-sizer.ts,
                     #   order-flow.ts, orderbook.ts, paper-accounting.ts, replay-engine.ts,
                     #   portfolio-analytics.ts, rule-runner.ts, llm.ts, safe-storage.ts,
                     #   workspace-backup.ts, rate limiting and error handling helpers
  types/             # Shared TypeScript types
test/                # node:test suites (unit, API, E2E) plus verification scripts
  screenshots/       # High-resolution captures produced by test runs
docs/                # Intent notes and specs (reliability & safeguards)
screenshots/         # Viewport captures used in this README
PROJECT_MEMORY.md    # Detailed agent handoff: architecture, changelog, conventions
TODO.md              # Refinement backlog
```

## API routes

All routes are server-side. Market routes proxy and normalize Bitget public endpoints; AI routes call the configured LLM provider with the key held on the server.

| Route | Purpose |
|---|---|
| `GET /api/market` | Candle and ticker data for a single market. |
| `GET /api/market/confluence` | Multi-horizon (15m, 1H, 4H, 1D) trend confluence aggregation. |
| `GET /api/tickers` | Live ticker list for the desk and watchlist. |
| `GET /api/scanner` | Ranked market scanner feed (change, turnover, asset type). |
| `GET /api/orderbook` | L2 order book snapshot, spread and imbalance. |
| `GET /api/tokens` | Tokenized asset (RWA) metadata. |
| `POST /api/research` | AI research brief grounded in ticker data, completed candles, and calculated indicators. |
| `POST /api/backtest` | Natural-language strategy compilation and candle replay. |
| `POST /api/copilot/chat` | Strategy Copilot chat turns. |
| `GET /api/settings` | Server-side provider configuration status. |
| `GET /api/ai-status` | AI availability and rate-limit status for the UI. |

## Browser data storage

All user state lives in localStorage under versioned keys. Nothing is sent to a server, and the workspace backup feature covers every key below (round-trip tested in `test/workspace-backup.test.mjs`).

| Key | Contents |
|---|---|
| `goriee.watchlist.v1` | Watched symbols (max 50). |
| `goriee.playbooks.v1` | Saved strategy playbooks (max 30). |
| `goriee.active-paper-playbook.v1` | ID of the playbook deployed to the paper desk. |
| `goriee.paper.v1` | Paper trade ledger (fills, closes, fees). |
| `goriee.paper-brackets.v1` | TP/SL/trailing bracket orders. |
| `goriee.paper-alerts.v1` | Price, stop, and target alerts (max 50). |
| `goriee.paper-risk.v1` | Daily loss guard limit in USD (default 250). |
| `goriee.journal.v1` | Saved research briefs. |
| `goriee.auto-rule-runner.v1` | Automated rule runner on/off flag. |
| `goriee.rule-runner-logs.v1` | Automated execution audit log. |
| `goriee_copilot_sessions_v1` | Strategy Copilot chat threads. |

## Testing

The repository ships an automated multi-tier suite built on `node:test`.

```bash
# Unit, math, and API integration tests (fast)
npm test

# Unit/math only, without the API suite
npm run test:unit

# Headless Chrome end-to-end tests (general UI + Strategy Copilot)
npm run test:e2e

# Everything above in one run
npm run test:all

# Trade Replay Studio E2E (separate suite)
node --test test/trade-replay-e2e.test.mjs

# Console error audit: visits every tab and asserts zero runtime JS errors
node test/check-console-errors.mjs

# Typecheck and production build
npm run typecheck
npm run build
```

What each tier covers:

- **Unit & math** (`test/unit.test.mjs`): EMA, RSI, ATR, Bollinger, MACD, sizing presets, cumulative P&L, CSV export, research-to-backtest prompt generation, playbook rule evaluation, parameter matrix robustness scoring, order flow CVD, Kelly sizing, squeeze detection.
- **Quant & order book** (`test/monte-carlo-orderbook.test.mjs`): spread/imbalance math, 500-run Monte Carlo percentiles, bracket order evaluation.
- **Paper accounting & lifecycle** (`test/paper-accounting.test.mjs`, `test/bracket-lifecycle.test.mjs`): ledger arithmetic and TP/SL/trailing bracket state transitions.
- **Storage safety** (`test/safe-storage.test.mjs`, `test/workspace-backup.test.mjs`): quota handling, backup allowlist round-trip, validation, and restore.
- **Rate limiting & live status** (`test/rate-limit.test.mjs`, `test/live-status.test.mjs`).
- **HTTP layer** (`test/bitget-http.test.mjs`): Bitget client behavior and response handling.
- **API integration** (`test/api.test.mjs`): exercises the route handlers against a running dev server (auto-started if needed; requires network for Bitget public data).
- **Browser E2E** (`test/e2e.test.mjs`, `test/copilot-e2e.test.mjs`, `test/trade-replay-e2e.test.mjs`): Puppeteer-core drives headless Chrome through interactive flows (chart toggles, crosshair inspection, scanner search, backtest runs, order modal presets, trade review, replay transport, copilot chat) and writes verification screenshots to `test/screenshots/`.

The most recent recorded run (September 29, 2026, see [PROJECT_MEMORY.md](PROJECT_MEMORY.md)): 157 tests, 156 pass, 0 fail, 1 skipped (the skip is the live-AI test, opt-in via `GORIEE_RUN_LIVE_AI_TESTS=1`), and 0 TypeScript errors.

There are also many one-off `verify-*.mjs` and `inspect-*.mjs` scripts in `test/` used during development for visual checks; they are not part of the suites above.

## Screenshots

Captured from headless Chrome runs, stored in `screenshots/`:

| Viewport | Views |
|---|---|
| Desktop (1440x900) | `desktop-desk.png`, `desktop-scanner.png`, `desktop-paper-analytics.png` |
| Tablet (768x1024) | `tablet-desk.png` |
| Mobile (390x844) | `mobile-desk.png`, `mobile-scanner.png`, `mobile-paper-analytics.png`, `mobile-more-drawer.png`, `mobile-order-modal.png` |

## Limitations and disclaimers

- Market conditions, indicator values, and backtest results are for research and demonstration only. Historical performance does not predict future results. Nothing here is financial advice.
- Backtests are long-only spot simulations with configurable fee/slippage parameters and current order book spread sampling; open positions are marked at the final close.
- The paper account is a local simulation. Balances and fills persist only in your browser and are lost if you clear site data without exporting a workspace backup.
- The app never connects to a private Bitget account and never submits real orders.
- Bitget's public candle API supplies historical price data. This app runs its own transparent candle-based simulation rather than claiming to invoke private Playbook execution.
- AI features depend on a third-party LLM endpoint you configure; output quality and availability vary by provider, and the live Bitget rate limits apply to market data polling.

## Related documentation

- [PROJECT_MEMORY.md](PROJECT_MEMORY.md): full architecture notes, design tokens, storage schemas, and the complete changelog.
- [TODO.md](TODO.md): current refinement backlog.
- [docs/intent/reliability-and-safeguards.md](docs/intent/reliability-and-safeguards.md) and [docs/specs/SPEC-reliability-and-safeguards.md](docs/specs/SPEC-reliability-and-safeguards.md): reliability intent and specification.
- [AI_AGENT_HANDOVER.md](AI_AGENT_HANDOVER.md), [AI_SWITCHING_HANDOUT.md](AI_SWITCHING_HANDOUT.md), [CODEX_HANDOFF_2026-09-25.md](CODEX_HANDOFF_2026-09-25.md): agent handoff history.
