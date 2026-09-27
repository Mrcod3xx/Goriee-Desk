# Goriee AI Desk — Agent Handoff & Project Memory

> **Additional handoff (September 25):** Read [CODEX_HANDOFF_2026-09-25.md](CODEX_HANDOFF_2026-09-25.md) for the interrupted Codex reliability/backup/workflow batch, remaining issues and its limited verification. The historical test status below does not establish that this newer batch or concurrent edits are verified.

**Last Updated:** September 26, 2026 (reliability pass)  
**Status:** `npm test` green: 36 tests, 35 pass, 0 fail, 1 skipped (live-AI research test, opt-in via `GORIEE_RUN_LIVE_AI_TESTS=1`). 0 TypeScript errors. E2E suites unchanged (12 general/copilot, 9 trade replay). Project is now under git version control (`main`, baseline commit `8b7d7b3`).  
**Stack:** Next.js 15 (App Router, Turbopack), React 19, TypeScript, Vanilla CSS design system, Bitget Public Spot API.

---

## 🚀 Quick Start for Incoming Agents

```bash
# 1. Start development server (runs on port 3000)
npm run dev

# 2. Typecheck (0 errors)
npm run typecheck

# 3. Run full automated unit test suite (32 unit, Monte Carlo, and API tests)
npm test
# Note: test/api.test.mjs auto-starts `next dev` on 127.0.0.1:3000 if no server is
# already listening (needs network for the Bitget public API). Override the target
# with GORIEE_TEST_BASE_URL. The live LLM research test is skipped unless
# GORIEE_RUN_LIVE_AI_TESTS=1 is set (it calls a real paid provider).

# 4. Run general E2E and Strategy Copilot tests
npm run test:e2e

# 5. Run Trade Replay Studio E2E tests
node --test test/trade-replay-e2e.test.mjs

# 6. Check console errors across all 9 tabs
node test/check-console-errors.mjs
```

- **Project Root:** `C:\Users\Admin\Documents\Codex\2026-09-24\bitget-hackathon-q-a-chatgpt-conversation\outputs\goriee-ai-desk`
- **Obsidian Memory Vault:** `C:\Users\Admin\Documents\Obsidian Vault`
  - Core Changelog: `Code_Edits_Log.md`
  - Project Overview: `Goriee AI Desk.md`
  - Daily Note: `2026-09-26.md`

---

## 🏛️ Application Architecture & Navigation

The app is an institutional-grade crypto trading and research desk powered by Bitget public spot data and multi-model AI (NVIDIA NIM, OpenRouter, OpenAI, Claude). It strictly avoids private API keys and real-money execution.

### Navigation Structure (`view` state in `src/components/trading-desk.tsx`)

| Tab ID | Label | Key Features |
|---|---|---|
| `desk` | **Market desk** | Live Bitget candlestick/line chart, OHLCV hover crosshair, EMA 20/50 & S/R overlays, orderbook L2 depth ladder, 4-chart multi-timeframe matrix, "Ask the desk" AI prompt panel. |
| `scanner` | **Market scanner** | Real-time sorting by turnover, 24h gainers/decliners, search filter, tokenized RWA tags, and direct quick-action buttons (`Desk`, `Brief`, `Backtest`, `+ Watch`). |
| `research` | **Research** | Responsive 2-column workspace: hypothesis prompt with live char counter, 4 quick prompt chips, live market intelligence sidebar (ticker snapshot, AI scope checklist, recent briefs), and full-width report cards with bull/bear cases and invalidation levels. |
| `backtests` | **Backtests** | Natural language strategy compiler with 15s deterministic fallback race, candle replay (EMA crossover & RSI mean reversion), dual equity curve vs buy & hold, Institutional Credibility Scorecard (alpha, out-of-sample decay, breakeven fee ceiling), Monte Carlo simulation, and starter templates. |
| `replay` | **Trade replay** | Dedicated tape replay studio workspace. Historical candle-by-candle simulation, click-to-cut tape bar tool, docked playback transport console, TradingView-style interactive zoom/pan engine, dedicated right-rail chevron brackets (TP, SL, Mark), [2R]/[3R]/[BE] quick-snap chips, dynamic live trade trajectory lines, historical trade markers, discretionary order execution, and session performance scorecard. |
| `playbooks` | **Playbooks** | Dedicated library tab for saved algorithmic strategies. Search & filter bar, collection KPI metrics, institutional starter templates with 1-click "Add to Library" & "Load & run", "Use in Paper" deployment routing. |
| `paper` | **Paper account** | Simulated $10,000 portfolio ledger, 6 balance cards with monospace figures, Open Positions table with TP/SL/Trailing stop bracket pills, Daily Loss Guard capacity progress bar, Price & Risk Alerts, and Simulated Order Modal. Includes Trade Review tab with cumulative equity curve and CSV export. |
| `journal` | **Journal** | 4-card KPI metric strip (`SAVED BRIEFS`, `ANALYZED MARKETS`, `DOMINANT REGIME`, `STORAGE PRIVACY`), desktop Master-Detail split layout for instant brief inspection without modals, and 3 clickable starter briefs. |
| `settings` | **Settings** | 6-card interactive provider presets (NVIDIA NIM, OpenRouter, OpenAI, Claude, UnoRouter, Custom), round-trip connection ping/latency tester, local `.env.local` storage assurance card. |

---

## 📜 Complete Changelog of Work Done (September 25, 2026)

### 1. Strategy Playbooks Workspace Integration
- **Relocated from Sidebar to Primary Nav:** Created dedicated `playbooks` navigation item right next to `backtests` with a live count badge (`<span className="nav-count">{playbooks.length}</span>`).
- **Complete Library View:** Built search bar, market/timeframe/status filters, collection KPI row, and interactive strategy cards.
- **Paper Trading Deployment:** Added "Use in Paper" action that sets the active strategy, navigates directly to the Paper Desk, and launches an **Active Strategy Banner** with a direct `Trade <Symbol>` button.
- **Starter Templates:** Added 3 Institutional Starter Playbook templates (Classic 20/50 Trend Following, RSI Oversold Dip Reversal, High-Beta Trend Filter) with 1-click library save and lab backtest triggers, eliminating empty whitespace on first load.
- **Card Action Ergonomics:** Added `flex-wrap: wrap` and refined button sizing so all 4 buttons (`Load & run`, `Use in Paper`, `Edit in lab`, delete `×`) fit cleanly within card bounds across all screen widths.

### 2. Workspace Tabs Unused Space Overhaul
- **Research Workspace:** Replaced narrow 820px card with a responsive 2-column institutional layout (`.research-grid-layout`). Fixed the vertical height discrepancy between the form and the 3 right-hand context cards by adding `.research-main-column` with a companion **Quantitative Pre-Flight & Strategy Lenses** panel (`.research-preflight-card`). Includes visual RSI (14) momentum progress meter, 24h range slider, EMA 20/50 alignment vector, S/R envelope, and 4 one-click institutional strategy lenses (Elliott Wave Cycle, Wyckoff Market Structure, SMC & Liquidity, Quant Confluence). Reports render below at 100% container width with zero dead space.
- **Journal Workspace:** Added a 4-metric KPI row and a desktop Master-Detail Split Layout (`.journal-master-detail`) where clicking a saved brief immediately displays its hypothesis, metrics strip, desk summary, dual bull/bear thesis cards, and invalidation level in a sticky preview pane without popup dialogs.
- **Settings Workspace:** Upgraded provider selector into a 6-card interactive preset grid with model chips and description blurbs, added an interactive "Test connection / Ping" latency diagnostic, and added a Local Privacy Guarantee card.
- **Backtests Workspace:** Replaced empty results void with 4 one-click quantitative strategy templates (EMA Golden Cross, RSI Mean Reversion, High-Beta Pullback, Daily Macro Momentum).

### 3. Paper Account Complete Institutional Overhaul
- **Account Summary Cards:** Upgraded all 6 balance cards with uppercase label headers, category tags (`RESERVE`, `NET VALUE`, `OVERALL`, `CLOSED`, `FLOATING`, `LEDGER`), tabular monospace figures, hover lift, and green/red highlights.
- **Open Positions Panel:** Added icon empty state, token marks (`market-mark`), styled P&L badges (`.pnl-pill`), and TP/SL/Trail bracket pill tags.
- **Daily Loss Guard:** Built `🛡 RISK PROTOCOL` panel with an interactive capacity progress bar (`% used · $ remaining`), limit input, and dynamic status card.
- **Price & Risk Alerts:** Added `🔔 LIVE MONITORING` header badge, 2x2 grid with stacked labels, purpose badges, and full-width CTA.
- **Simulated Order Modal:** Upgraded side toggle with vivid Buy (emerald `#0c9a6b`) and Sell (crimson `#dc3545`) fills, market token pill, capital sizing presets (`25%`, `50%`, `75%`, `Max`), bracket order targets with RRR badge, and tactile confirmation button.

### 4. Button & Dropdown System Overhaul (Anti-Slop UI)
- Restyled all buttons across the application with institutional elevation, smooth transitions, high-contrast hover states, and click micro-interactions.
- Upgraded all `<select>` dropdowns across Market Scanner, Research, Strategy Builder, and Paper Desk with custom chevron indicators, hover/focus rings, and uniform 40px sizing.
- Fixed grid stacking bug where filter bar dropdowns cramped horizontally next to labels (`display: grid !important; gap: 6px;`).

### 5. Monte Carlo Equity Cone Overhaul
- Eliminated text collision in the Stochastic Equity Cone chart where "Start ($10,000)" collided directly with the median line (`p50`) at the origin.
- Replaced distorted SVG `<text>` elements with crisp HTML overlay scale markers (`.mc-y-scale`) and an HTML baseline tag pill (`.mc-scale-baseline-tag`).

### 6. Branded SVG Favicon & Zero Console Errors
- Implemented `src/app/icon.svg` matching Goriee's institutional forest-green and jade palette, eliminating 404s and achieving 0 console errors across all 8 tabs.

### 7. Sidebar Cutout Fix & 5 Advanced Institutional Trading Systems
- **Sidebar Cutout Annoyance Solved:** Identified root cause in Chromium viewport layout (`overflow-x: hidden` on root `html`/`body` unpinned the `height: 100vh` sticky sidebar when scrolling downward). Migrated to `overflow-x: clip` and reinforced `.sidebar` with `min-height: 100vh; height: 100dvh; max-height: 100dvh; position: sticky; top: 0; z-index: 5; flex-shrink: 0;`. Verified 100% full-height pinned sidebar on deep scroll.
- **Bollinger Bands & MACD Technical Overlays:** Added `bollingerBands()` and `macd()` indicators in `src/lib/bitget.ts`. Interactive `BB (20, 2)` and `MACD (12, 26, 9)` toggle buttons in `PriceChart` with shaded volatility envelope, zero-line, color-coded histogram, fast/signal lines, and crosshair value tracking.
- **Multi-Horizon Trend Confluence Matrix:** Aggregates `15m`, `1H`, `4H`, and `1D` Bitget candle streams in `/api/market/confluence`. Displays visual confluence meter bar, regime badge, 4 cross-timeframe indicator cards, and a 1-click "Seed into AI Brief" workflow.
- **Automated Paper Trading Rule Runner:** Evaluates active playbook rules against live candle closes (`evaluatePlaybookRule()`). Auto-executes simulated paper orders tagged `🤖 Automated Fill` and maintains an in-memory & persisted Execution Audit Log.
- **Real-Time Bitget Public WebSocket Streaming:** Connects to `wss://ws.bitget.com/v2/ws/public` for ticker price flashes (`flash-up`/`flash-down`) with `● WS Live` status badge and polling fallback.
- **Institutional Strategy Card Exporter:** Generates 1200×675 high-DPI canvas briefing cards with 1-click PNG download and Markdown copy from Research briefs and Backtests.

### 8. Backtests Workspace Institutional Overhaul: Chronological Holdout & Simulated Trades Table
- **Chronological Holdout Scorecard Overhaul (`.validation-panel`):**
  - Eliminated browser inline span concatenation (`bars-5.26%9 closed trades`) by restructuring the validation panel into a 2-card institutional walk-forward grid (`.validation-cards-grid`).
  - **In-Sample Card (70% Training Phase):** Green-accented card featuring bar count pill (`452 bars`), return % in large monospace hero typography, comparison against Buy & Hold benchmark with alpha badge, and metrics strip detailing closed trades count, max drawdown %, and benchmark return.
  - **Out-of-Sample Card (30% Unseen Validation Phase):** Blue-accented card displaying holdout retention, return % hero stat, alpha vs benchmark, and full out-of-sample drawdown metrics.
  - Added institutional fine-print callout with shield icon explaining fixed parameters across periods to prevent data-snooping bias.
- **Simulated Trades Full-Width Ledger Overhaul (`.simulated-trades-table`):**
  - Fixed squeezed table issue where trade logs only occupied ~40% width with a blank void on the right; upgraded table to `width: 100%` across the entire panel.
  - Added header summary chips:
    - `Wins / Losses` ratio (`2W / 4L` with colored text).
    - `Win Rate` percentage (`33.3%`).
    - `Total Net P&L` badge (`$468.43`).
  - Implemented trade index pill tags (`#6`, `#5`, etc.), `LONG` side badge pills, tabular monospace timestamps, bold entry/exit prices, profit/loss colored return & net P&L badges, duration bar chips, and subtle row hover states.
  - Verified across all screen sizes via headless Chrome with 0 errors.

---

## 💾 LocalStorage Data Schemas

All user-generated state is stored locally in the browser under versioned keys:

| Storage Key | Schema Type | Description |
|---|---|---|
| `goriee.playbooks.v1` | `StrategyPlaybook[]` (max 30) | User's saved quantitative strategies. |
| `goriee.active-paper-playbook.v1` | `string` (UUID) | ID of strategy actively deployed to Paper Desk. |
| `goriee.paper.v1` | `PaperTrade[]` | Paper trades ledger (fills, closes, fees). |
| `goriee.paper-brackets.v1` | `PaperBracket[]` | TP/SL/Trailing stop bracket orders. |
| `goriee.paper-alerts.v1` | `PaperAlert[]` (max 50) | Price, stop, and target alerts. |
| `goriee.paper-risk.v1` | `number` (1-100000, USD) | Daily loss guard limit, stored as a plain number (default 250). |
| `goriee.watchlist.v1` | `string[]` (max 50) | User's tracked market symbols. |
| `goriee.journal.v1` | `SavedResearchBrief[]` | Historical saved research reports. |
| `goriee.auto-rule-runner.v1` | `boolean` | Automated paper rule runner enabled flag. |
| `goriee.rule-runner-logs.v1` | `Array<{ id, time, symbol, action, message }>` | Automated execution audit log (last ~15 entries loaded). |
| `goriee_copilot_sessions_v1` | `CopilotSession[]` | AI Strategy Copilot chat threads (note: underscore key format, managed in `strategy-copilot.tsx`). |

All 13 keys above are covered by the workspace backup allowlist in `src/lib/workspace-backup.ts` (round-trip, validation, and restore behavior tested by `test/workspace-backup.test.mjs`).

---

## 🎨 Design Tokens & Conventions

- **Colors:**
  - Deep Institutional Forest Green: `#0f442c` / `#172b24`
  - Emerald / Jade Accent: `#0c9a6b` (active borders, primary buttons, badges)
  - Jade Soft Tint: `#e3f4ec` / `#dcf5e7` (active card backgrounds, badge fills)
  - Profit / Positive Alpha: `#087b56` / `#83d7ad`
  - Loss / Drawdown: `#b64c50` / `#ef9d9d`
  - Line / Border Strong: `#d2ddd5`
- **Typography & Layout:**
  - Font families: Inter/system sans for UI; monospace for tabular figures, prices, bps, and percentages.
  - SVG Typography Rule: **Never render `<text>` inside aspect-ratio stretching SVGs**. Vector paths in SVG; all text in overlaid HTML elements.
  - Spacing & Grids: 16px grid gap; 10px-12px card border radius; 40px standard input height.

---

## 🧪 Verification & Test Commands

- **Unit & Math Tests:** `test/unit.test.mjs` (17 tests: EMA, RSI, ATR, Bollinger, MACD, sizing presets, cumulative P&L, CSV export, Research-to-Backtest prompt generation, playbook rule evaluation, parameter matrix & robustness scoring, order flow CVD calculation & buyer aggression, dynamic Kelly sizing & volatility squeeze detection).
- **Quant & Orderbook Tests:** `test/monte-carlo-orderbook.test.mjs` (Order book spread & imbalance, Monte Carlo 500-run simulation & percentiles, bracket order evaluation).
- **Browser E2E Tests:** `test/e2e.test.mjs` and `test/verify-four-features.mjs` (Headless browser verification of Bloomberg-style Ctrl+K Omnibar, CVD oscillator, Volatility Squeeze Radar, 2D Parameter Sensitivity Heatmap, and Dynamic Kelly Sizer).
- **Console Error Audit:** `test/check-console-errors.mjs` (Navigates to all 8 tabs and asserts 0 runtime JS errors).
- **Visual Screenshots:** Saved in `test/screenshots/` (over 45 high-resolution screenshots documenting every state, omnibar search, heatmap metric switch, and order ticket modal).

---

## 🚀 9. Four Institutional Quantitative Systems (Sprint 9)

### 9.1 Parameter Sensitivity Heatmap & Overfitting Detection
- **Files:** `src/lib/parameter-matrix.ts`, `src/components/parameter-heatmap.tsx`, `src/app/globals.css`.
- **Purpose:** Runs a walk-forward 2D parameter grid simulation across historical Bitget candles (Fast EMA 10–25 × Slow EMA 35–80 or RSI Entry 20–35 × RSI Exit 50–70).
- **Alpha vs Noise:** Calculates net return %, win rate %, trade count, max drawdown %, and profit factor for each combination.
- **Robustness Classification:** Detects whether the current parameter set sits on a contiguous **Robust Green Plateau** (≥60% profitable neighbors) or is an isolated, overfitted **Fragile Cliff** (≤35% profitable neighbors).
- **Interactive UI:** Metric switcher (`Net Return %`, `Win Rate %`, `Max Drawdown`, `Profit Factor`), cell hover statistics inspection, gold star badge for optimal settings, and 1-click **"Apply to Strategy"** button that updates the prompt and scrolls to the builder.

### 9.2 Bloomberg-Style `Ctrl+K` / `Cmd+K` Omnibar Command Palette
- **Files:** `src/components/command-palette.tsx`, `src/app/globals.css`.
- **Trigger:** Global keyboard listener (`Ctrl+K` / `Cmd+K`) or Topbar header button (`Quick search & commands Ctrl+K`).
- **Features:**
  - Multi-category instant search: Navigation routes, Quick Actions, and Live Spot Markets.
  - Keyboard navigation with `↑`, `↓`, `Enter`, and `Escape`.
  - **Natural Language Sizing Calculator:** Type queries like `"risk $250 2%"` to instantly compute position sizing in dollars and token quantities using the Kelly Criterion engine.
  - Quick action shortcuts: Export high-DPI strategy card, toggle 4-chart matrix, switch timeframes (15m/1H/1D), trigger backtest, or open paper order tickets.

### 9.3 Volatility Squeeze Radar & Dynamic Kelly Risk Sizer
- **Files:** `src/lib/kelly-sizer.ts`, `src/components/trading-desk.tsx`, `src/app/globals.css`.
- **Volatility Squeeze Radar:** Detects Bollinger Bandwidth percentile compression (lowest 25th percentile of historical volatility). Displays dynamic status badge (`🔥 SQUEEZE (Bearish Breakdown)` / `Bullish Expansion` / `Directional Coil`) in the candlestick header to warn of impending expansion volatility.
- **Dynamic Kelly Risk Sizer:** Embedded directly into the Paper Account order ticket modal. Computes full Kelly fraction (\(f^* = W - \frac{1-W}{R}\)), half-Kelly conservative fraction, exact dollar risk capital based on user stop distance, and optimal position size in USD and underlying crypto units. Includes 1-click **"Apply Kelly Size"** button.

### 9.4 Order Flow Cumulative Volume Delta (CVD) & Buyer Aggression
- **Files:** `src/lib/order-flow.ts`, `src/components/trading-desk.tsx`, `src/app/globals.css`.
- **Intra-Candle Delta:** Deconstructs candle volume into buyer vs seller initiated volume using price positioning within the high-low bar range modulated by close-open displacement.
- **CVD Oscillator Panel:** Continuous Cumulative Volume Delta curve rendered as a dedicated sub-panel beneath candlestick volume bars, complete with live Buyer Aggression % and Bullish/Bearish CVD Divergence detection.

---

## 📊 10. Portfolio Analytics Dashboard (Sprint 10)

- **Files:** `src/lib/portfolio-analytics.ts`, `src/components/portfolio-analytics.tsx`, `src/components/trading-desk.tsx`, `src/components/command-palette.tsx`, `src/app/globals.css`.
- **Navigation:** Accessible via the Paper account view segmented sub-tab (`Account` | `Trade review · N` | `Analytics`), or directly via the `Ctrl+K` Command Palette (`Go to Portfolio analytics`).
- **Core Analytics Engine (`src/lib/portfolio-analytics.ts`):**
  - **Equity Curve & Area Trajectory:** Chronological cumulative equity snapshots from all closed paper positions with starting capital baseline ($10,000) and fill-rate adjustments.
  - **Peak-to-Trough Drawdown Waterfall:** Underwater curve quantifying peak equity erosion in both dollar terms and percentage.
  - **Risk-Adjusted Ratios:** Annualized Sharpe Ratio (\(\mu / \sigma \times \sqrt{N}\)), Sortino Ratio (downside risk penalty only), and Calmar Ratio (Net Return % / Max Drawdown %).
  - **Trade Expectancy & Payoff:** Expected dollar value per trade fill (\(E = \text{Win\%} \times \text{AvgWin} - \text{Loss\%} \times \text{AvgLoss}\)), Payoff Ratio (Win/Loss magnitude), and Profit Factor.
  - **Sliding-Window Rolling Win Rate:** 10-trade sliding window line with a 50% breakeven baseline to track strategy decay or momentum.
  - **Position Allocation Donut:** Real-time capital allocation breakdown across open positions with interactive legend, color-coded rings, and percentage weights.
  - **GitHub-Style Daily P&L Calendar Heatmap:** Multi-week calendar matrix with 4-level color intensity scales for daily profits (emerald `#0c9a6b` to `#dcf5e7`) and losses (crimson `#b64c50` to `#fce8e8`).
  - **Best & Worst Trade Showcase:** Highlight cards showing peak winner and steepest drawdown with entry/exit prices, holding duration, and percentage return.
  - **Streak & Behavioral Tracking:** Longest win streak, longest losing streak, current streak direction, and average trade holding time.
- **Anti-Slop UI & UX Overhaul (`antislop-ui`, `antislop-code`, `ui-ux-pro-max`):**
  - Zero decorative emoji across UI text, buttons, tags, or cards; replaced with crisp, accessible SVG icons (`trending`, `shield`, `database`, `clock`, `alert`).
  - Interactive SVG crosshairs and live inspection readout strips above the charts with tabular monospace metrics.
  - Centered notional total inside the SVG Donut chart hole (`$2,297.98 TOTAL NOTIONAL`).
  - Removed decorative left stripes on highlight cards in favor of semantic top status tags (`Peak Realized Gain` / `Max Adverse Trade`).
  - Keyboard focus rings (`tabIndex={0}`) on calendar cells and legend items.
  - Explicit inquiry-driven chart headers replacing vague labels.
- **Verification:** 18 automated tests passing (unit tests for all math formulas, Monte Carlo stress testing, and headless Chrome browser E2E test with 0 console errors). Visual screenshots captured at `test/screenshots/13-portfolio-analytics-dashboard.png` and `14-portfolio-analytics-fullpage.png`.

---

## 🎨 11. Complete Responsive UI/UX Pro Max & Anti-Slop Overhaul (Sprint 11)

- **Files:** `src/components/trading-desk.tsx`, `src/components/portfolio-analytics.tsx`, `src/app/globals.css`, `test/verify-responsive-overhaul.mjs`.
- **Design Archetype:** Institutional Quantitative Terminal (Energy 2 / Rhythm 2 / Motion 1) using deep forest green (`#0f442c`), obsidian slate (`#172b24`), jade green (`#0c9a6b`), and crisp tabular typography.
- **Adaptive Multi-Viewport Architecture:**
  - **Desktop (≥930px):** Full institutional left sidebar (brand mark, workspace status, primary navigation, live watchlist with direct sparklines and quick remove, guest persistence tag). Multi-column work grids with real-time order books, OHLCV charts, and research workspaces.
  - **Tablet (641px–860px):** Compact 58px vertical icon rail with tooltips. Dynamic 1-column responsive reflow for `.work-grid`, allowing candlestick charts and quantitative panels to utilize the full width without cramping or overlapping.
  - **Mobile (≤640px):** 
    - Dedicated fixed **Bottom Navigation Bar** (`.mobile-bottom-nav`) featuring the top 4 primary trading destinations (`Desk`, `Scanner`, `Research`, `Paper` with live trade badge) + a tactile **"More"** button.
    - **Slide-Up "More" Sheet (`.mobile-more-sheet`):** Smooth animated drawer providing direct access to secondary tools (`Strategy Lab & Backtests`, `Algorithmic Playbooks`, `Research Journal`, `Terminal Settings`), quick Ctrl+K omnibar launch, and live connection status.
    - **Mobile Bottom-Sheet Modal Reflow:** `.order-modal`, `.card-modal-content`, and `.picker-dialog` automatically pin to the bottom edge with 20px top rounded corners, 44px touch targets, and full touch-scroll containment.
    - **Responsive Data Grids:** Automatic card reflow for `.scanner-table` and `.trades-table`, converting tabular rows into readable, touch-friendly token cards with clear action buttons (`Desk`, `Brief`, `Backtest`, `+ Watch`).
- **Strict Anti-Slop Hygiene (`antislop-ui`, `antislop-code`, `antislop-human`):**
  - Completely purged decorative emojis across all pages (`🔥`, `🤖`, `🌊`, `🏛️`, `🎯`, `⚡`, `📈`, `🔄`, `🛡️`).
  - Replaced with accessible, semantic SVG icons (`wave`, `columns`, `target`, `bolt`, `shield`, `trending`, `refresh`, `check`, `alert`).
  - Replaced fake left decorative card borders with semantic top badges and clean Swiss tabular alignment.
  - Squeeze radar indicator updated to an animated CSS pulse dot (`.squeeze-pulse`) rather than an emoji.
- **Accessibility & Touch Target Invariants:**
  - Mandatory `:focus-visible` ring (`2px solid #0c9a6b; outline-offset: 2px`) across all interactive buttons, inputs, selects, and links.
  - Standardized form controls: 1px `#c8d8cf` border, `#172b24` text, minimum 40–44px touch heights.
  - Zero horizontal overflow (`html, body { overflow-x: hidden; max-width: 100vw; }`).
- **Comprehensive Headless Browser Verification:**
  - Verified across Desktop (1440x900), Tablet (768x1024), and Mobile (390x844 iPhone 14) via `test/verify-responsive-overhaul.mjs`.
  - Zero uncaught console or page errors across all viewports.
  - 18/18 quant/unit tests passing.
  - Multi-viewport screenshots recorded in `screenshots/` (`desktop-desk.png`, `desktop-scanner.png`, `desktop-paper-analytics.png`, `tablet-desk.png`, `mobile-desk.png`, `mobile-scanner.png`, `mobile-paper-analytics.png`, `mobile-more-drawer.png`, `mobile-order-modal.png`).

---

## 🔍 12. Search Bar, Sticky Sidebar Cutout, & Journal Token Clustering (Sprint 12)

- **Search Bar Double-Border Fix:**
  - Reset nested search inputs inside `.desk-market-search-field input`, `.journal-search input`, `.scanner-search-field input`, and `.palette-input-wrap input` to `border: none !important; background: transparent !important; min-height: 0 !important; box-shadow: none !important;`.
  - The outer container retains the sole clean border, search icon, and focus ring.
- **Sidebar Sticky Cutout Fix:**
  - Replaced `overflow-x: hidden;` with modern `overflow-x: clip;` on `html, body`. `overflow-x: clip` prevents horizontal scrollbars without breaking CSS `position: sticky`.
  - Added `align-self: flex-start;` to `.sidebar` so it pins seamlessly to the viewport throughout deep page scrolling on desktop with zero white cutout below `Guest workspace`.
- **Research History Token Clustering & Filter Pills:**
  - Replaced flat unorganized research history with **Token/Asset Clusters** (`BTCUSDT · N briefs`, `RSPYUSDT · N briefs`).
  - Each cluster features an institutional header card with token coin-mark, symbol name, brief count badge, latest research timestamp, latest price, and a smooth collapsible chevron toggle (`is-collapsed`).
  - Added an interactive **Token Filter Pills strip** (`All Tokens (N)`, `BTCUSDT (N)`, `RSPYUSDT (N)`) allowing instant 1-click filtering across all research briefs.
- **Verification:**
  - Headless browser automated verification (`test/verify-fixes.mjs`): 0 console errors, sidebar sticky confirmed across 1200px scroll, clean search bar captured, and cluster expand/collapse tested.
  - Visual screenshots saved in `screenshots/` (`fix-search-bar.png`, `fix-sidebar-sticky.png`, `fix-journal-clusters.png`, `fix-journal-clusters-collapsed.png`).
  - 18/18 unit/quant tests pass, TypeScript 0 errors.

---

## ⚡ 13. AI Strategy Copilot Chat (Sprint 13)

- **Persistent Context-Aware Side Drawer:**
  - Fast, non-blocking side drawer (`.copilot-drawer`) accessible via `Ctrl+J`, Topbar `AI Copilot` button, and bottom-right `.floating-copilot-trigger`.
  - Seamlessly reflows into an animated bottom sheet (`max-height: 88dvh`, `border-radius: 18px 18px 0 0`) on mobile viewports (≤640px).
- **Live Bitget Context Injection with Toggle Pills:**
  - Three dynamic indicator pills above the chat input:
    1. `[Symbol @ Live Price]` (e.g. `● BTCUSDT $83,862.72`)
    2. `[Regime: RSI / EMA / BB Squeeze]` (e.g. `● Regime: RSI 30`)
    3. `[Paper Portfolio Balance]` (e.g. `● Paper: $10,000`)
  - Traders can toggle pills on/off to selectively feed real-time terminal context to the AI router without manual typing.
- **1-Click Interactive Execution Action Cards (`<action_card>`):**
  - **Proposed Order Card (`type: "order"`):** Displays Side, Entry, Take Profit, Stop Loss, Reward-to-Risk ratio, Kelly Sizing %, and reason. Clicking **"Load into Order Ticket →"** opens the native simulated Order Modal pre-populated with exact notional, side, and auto-bracket TP/SL parameters.
  - **Proposed Backtest Card (`type: "backtest"`):** Displays Symbol, Interval, Lookback Window, and Rule Logic. Clicking **"Run Backtest in Lab →"** routes directly to the Strategy Lab and executes candle replay.
  - **Playbook Rule Card (`type: "playbook"`):** Displays Trigger Type and Rule Conditions. Clicking **"Save to Playbooks →"** stores the strategy in `localStorage` and opens the Playbook library.
  - **Market Switch Card (`type: "market"`):** Displays Target Symbol and Rationale. Clicking **"View Market Chart →"** immediately updates the active terminal ticker.
- **Multi-Thread Session Persistence & Trade Journal Export:**
  - Complete session history stored locally in `localStorage` under `goriee_copilot_sessions_v1`.
  - Multi-thread dropdown selector with `+ New` conversation button, auto-naming, and thread deletion.
  - **Export to Trade Journal:** 1-click export sends any strategy conversation into the Trade Journal (`localStorage.setItem(storageKeys.journal)`) tagged with regime, timestamp, and AI commentary.
- **Streaming Backend Architecture (`/api/copilot/chat`):**
  - Next.js App Router streaming route utilizing Web `ReadableStream` and Server-Sent Events (SSE).
  - Multi-provider support (Anthropic `content_block_delta` and OpenAI/OpenRouter/Nvidia/GLM `choices.delta.content`).
  - Structured prompt injection (`src/lib/copilot-prompt.ts`) and card parsing (`parseCopilotResponse`).
- **Verification & Testing:**
  - Unit tests in `test/unit.test.mjs` verifying prompt compilation, context injection, and card parsing (20/20 tests passing).
  - Headless browser E2E test in `test/copilot-e2e.test.mjs` verifying hotkeys (`Ctrl+J`, `Escape`), drawer trigger buttons, mobile 390px sheet reflow, and 1-click Order Ticket execution (4/4 E2E tests passing).

---

## 🛑 14. Living Thinking Animations & Universal Agent Stop Buttons (Sprint 14)

- **Eliminated "Frozen / Stuck" Feel with Living Institutional Animations:**
  - Prior state: During Time To First Token (TTFT) latency (1–3s), Copilot displayed a blank line with a static green square, causing users to feel the interface was frozen or stuck.
  - Upgraded state: Introduced a multi-stage living thinking state (`.copilot-thinking-state`) rendered immediately upon query submission:
    1. **Pulsing Radar Aura Beacon (`.thinking-beacon`, `.thinking-pulse-ring`, `.thinking-pulse-dot`):** Glowing emerald orb with expanding ping wave signaling active computation.
    2. **Dynamic Stage Status Text:** Seamlessly cycles based on elapsed time:
       - `0.0s – 1.8s`: "Reading market quote & order book depth"
       - `1.8s – 3.8s`: "Evaluating technical confluence & regime"
       - `3.8s+`: "Synthesizing strategy thesis & actions"
    3. **Animated Wave Dots (`.thinking-dots-anim .dot`):** Staggered keyframe wave dots indicating active pipeline streaming.
    4. **Shimmer Wave Skeleton Bars (`.thinking-shimmer-wave .shimmer-bar`):** 3 horizontal tiered gradient skeleton bars with smooth continuous horizontal shimmer (`@keyframes shimmerWave`).
    5. **Pulsing Stream Cursor (`.stream-cursor`):** Upgraded from a static block to a rhythmic emerald glow pulse (`@keyframes glowPulseCursor`) with 10px soft shadow.
- **Universal Agent Stop / Cancel Architecture (`AbortController`):**
  - **Strategy Copilot:**
    - Header strip: Added `.copilot-stop-strip-btn` (`■ Stop`) with live elapsed timer badge (`0.4s`).
    - Input area: When `isStreaming` is active, the send button transforms into an active, high-contrast crimson Stop button (`.copilot-stop-btn`).
    - Clicking Stop triggers `abortControllerRef.current.abort()`, halts the fetch stream, gracefully saves any partial output with a subtle footnote `*(Generation stopped by user)*`, and resets the input bar immediately.
  - **Market Desk ("Ask the desk" panel):**
    - Submit actions row: When `researchLoading` is true, displays `.research-loading-actions` with an active `■ Stop Agent` button (`.research-cancel-btn`).
    - `ResearchLoadingStatus`: Top-right metadata strip features a dedicated `■ Stop Agent` button (`.research-stop-btn`).
    - Gracefully halts the research agent without scary error banners, resets `requestBusy`, and notifies with toast `"Research agent stopped."`.
  - **Research Tab:**
    - Primary form submit row: Displays `.research-loading-actions` with `■ Stop Agent` button.
    - `ResearchLoadingSkeleton`: Topline status badge provides `■ Stop Agent` button.
  - **Backtests Tab:**
    - Strategy builder footer: When `backtestLoading` is true, renders `■ Stop Backtest` button.
    - `BacktestLoadingStatus`: Timer badge displays `■ Stop Backtest` button.
- **Design Tokens & Accessibility Compliance (`ui-ux-pro-max`, `antislop`):**
  - Institutional crimson styling (`.button-danger`: `#c53030` to `#9b1c1c` with `#dc2626` hover, crisp `#771d1d` border, WCAG AAA contrast).
  - 44px minimum touch targets on mobile and desktop.
---

## 🚀 11. Trade Replay Simulator (Historical Backplay & Discretionary Tape Trainer) (Sprint 11)

- **Architecture & Pure Engine:**
  - `src/types/replay.ts`: Type contracts for `ReplayPosition`, `ReplayTrade`, `ReplayWallet`, `ReplayScorecard`, and `ReplaySessionState`.
  - `src/lib/replay-engine.ts`: Pure algorithmic simulation functions:
    - `createInitialReplayWallet(10000)`: Isolated $10,000 cash starting wallet, separated completely from paper trading.
    - `executeReplayOrder(wallet, candle, symbol, side, amountUsd, tpPct?, slPct?)`: Instant fills at candle close with bracket order attachments.
    - `closeReplayPosition(wallet, exitPrice, exitTime, exitReason)`: Market closures with simulated 5 bps taker fee and P&L tracking.
    - `advanceReplayCandle(wallet, candle)`: Bar-by-bar high/low bracket trigger checks (`take_profit` on high, `stop_loss` on low).
    - `calculateReplayEquity(wallet, currentPrice)`: Dynamic mark-to-market equity valuation.
    - `calculateReplayScorecard(wallet, currentPrice)`: Institutional scorecard calculation (Win Rate %, Profit Factor, Net P&L, Best/Worst Trade, Return %).
- **Market Desk Chart Integration (`src/components/trading-desk.tsx`):**
  - **Chart Header Trigger:** `⏮ Replay` button in `.panel-heading.chart-heading` with active state toggle and tooltip.
  - **Floating Glass HUD Bar (`src/components/replay-hud-bar.tsx`):** Docked right on top of the price chart with emerald glassmorphism (`backdrop-filter: blur(14px)`), pulsing `REPLAY MODE` beacon, `✂ Cut Bar` button, quick rewind chips (`-24b`, `-50b`), transport controls (`▶`/`⏸` play/pause, `▶|` step 1 bar), speed toggles (`0.5x`, `1x`, `2x`, `5x`), timeline scrubber, UTC timestamp, Replay Equity readout, quick discretionary buttons (`+ Buy $250`, `- Sell $250`, `✕ Close`), and `Exit Replay`.
  - **Click-to-Cut Interaction on SVG Chart:** Clicking `Cut Bar` activates interactive crosshair cursor (`candle-cut-cursor`) and dashed guideline (`.candle-cut-guideline`) with `✂ Cut Here` tooltip tag. Clicking any candle clamps `replayIndex` to that bar and immediately slices future candles off the chart.
  - **Zero-Hindsight AI Copilot Isolation:** When Replay Mode is active, `activeMarket` clamps candles to `market.candles.slice(0, replayIndex + 1)`. All indicators (EMA 20/50, RSI 14, Bollinger Bands, CVD, S/R) and AI Copilot snapshots (`copilotMarketSnapshot`, `copilotPaperSnapshot`) compute strictly from data up to $t \le t_{replay}$, completely eliminating hindsight bias. Copilot trade card orders execute directly into `replayWallet`.
  - **Replay Session Scorecard Modal (`src/components/replay-scorecard-modal.tsx`):** Institutional modal displaying 5 KPI metric cards (Net P&L, Win Rate %, Profit Factor, Best Trade, Ending Equity) and a detailed closed trades log table with "Practice Again" and "Return to Live Market" actions.
  - **Keyboard Shortcuts:** `Space` for Play/Pause, `ArrowRight` or `F` for Step 1 Bar, `Escape` to cancel Cut mode or close Scorecard.
- **Verification & Testing:**
  - 0 TypeScript errors (`npx tsc --noEmit`).
  - 21/21 unit/quant tests passing (`npm run test:unit`).
  - 7/7 E2E tests passing in `test/trade-replay-e2e.test.mjs`.
  - Verified visual screenshots in `test/screenshots/` (`01-replay-hud-active.png`, `02-replay-cut-guideline.png`, `02-replay-after-cut.png`, `03-replay-step-forward.png`, `04-replay-position-active.png`, `05-replay-copilot-isolated.png`, `06-replay-scorecard-modal.png`).

---

## 🏛️ 15. Trade Replay Studio Dedicated Workspace (Sprint 15)

- **Dedicated Primary Navigation Tab:**
  - Migrated Trade Replay from a floating HUD over the Market Desk to a dedicated 5th primary navigation tab (`Trade replay`, `id: "replay"`).
  - Market Desk was completely cleansed of the floating HUD and `.chart-replay-btn` to restore clean market surveillance.
- **Two-Column Institutional Studio Workspace:**
  - **Left Stage (Chart & Transport):**
    - High-density candlestick chart equipped with the interactive click-to-cut tool, indicators bar (EMA 20/50, Bollinger Bands, MACD, CVD, S/R, Volume), and zoom controls.
    - Docked transport console below chart: timeline scrubber, Play/Pause toggle, Step 1 Bar, speed multipliers (`0.5x`, `1x`, `2x`, `5x`), quick rewind buttons (`-24b`, `-50b`), Cut tool trigger, and hotkey legend.
  - **Right Rail (Trading & Performance):**
    - **Account Equity Card:** Live net equity hero display, available cash, realized PnL, unrealized PnL, closed trades count.
    - **Discretionary Order Ticket Card:** Long/Short side toggle, preset sizing chips (`$250`, `$500`, `$1000`, `$2500`), TP% and SL% inputs with automated dollar target calculations and dynamic Risk-to-Reward ratio badge, and high-contrast execution button.
    - **Active Replay Position Card:** Open trade tracker displaying entry price, live mark, notional size, unrealized PnL pill, and instant market close button.
    - **Session Closed Trades Card:** Mini history table linking to the full Performance Scorecard modal.
- **Zero-Hindsight AI Strategy Copilot:**
  - Strict historical isolation: candles and indicators are clamped to $t \le t_{replay}$, guaranteeing zero future data leakage. Strategy Copilot action cards execute directly into the replay wallet.

---

## 🎯 16. On-Chart Interactive Bracket Corridors & Dynamic Trajectories (Sprint 16)

- **Draggable Visual Bracket Corridors:**
  - **Take Profit:** Emerald dashed line spanning chart with semi-transparent profit corridor (`rgba(16, 185, 129, 0.08)`) and draggable handle pill showing target price, percentage gain, and R:R ratio.
  - **Stop Loss:** Crimson dashed line with shaded risk corridor (`rgba(244, 63, 94, 0.08)`) and draggable handle pill showing stop price and loss percentage.
  - **Dynamic Dragging:** Pointer events drag handles vertically with live price clamping within chart boundaries and bi-directional synchronization with order ticket inputs.
- **Quick-Snap Risk Multiple Chips:**
  - Take Profit handle features docked `[2R]` and `[3R]` chips for 1-click risk-multiple targeting.
  - Stop Loss handle features a docked `[BE]` chip to snap stop loss directly to breakeven (entry price).
- **Dynamic Active Position Trajectory Vector:**
  - Animated dotted vector connects the exact entry candle to the live playback candle.
  - Dynamically shifts color based on unrealized PnL: emerald for in-profit positions, crimson for in-loss.
  - Live pulse entry pin (`▲ LIVE LONG` / `▼ LIVE SHORT`).
- **Historical Execution Markers & Trajectory Vectors:**
  - Completed trades plot on-chart entry execution pins (`▲ BUY`) and exit pins (`✕ +$X.XX`) with connecting trajectory lines.
  - Chart toolbar `[👁 Markers]` toggle allows hiding or revealing historical markers anytime.

---

## 📈 17. TradingView-Style Zoom, Pan Engine & HTML Price Rail (Sprint 17)

- **Dedicated HTML Right Price Rail (Eliminating SVG Text Stretching):**
  - Solved root cause of text distortion where `preserveAspectRatio="none"` on SVG stretched `<text>` elements horizontally across wide screens.
  - Created `.chart-right-rail` overlay hosting the price scale and bracket handles with native subpixel font rendering and tabular monospace figures.
- **TradingView Directional Chevrons:**
  - Take Profit: `◀ TP $...` with docked `[2R]` and `[3R]` quick-snap chips.
  - Stop Loss: `◀ SL $...` with docked `[BE]` chip.
  - Current Mark: `◀ MARK $...` pointing at current price.
- **Automatic Collision Clearance & Breakeven Overlap Prevention:**
  - Background scale price labels within 18px of an active chevron are automatically hidden to prevent overlapping text.
  - When Stop Loss is moved or snapped to Breakeven (exact entry price), the redundant Entry tag is cleanly suppressed, and the Stop Loss tag updates to `◀ BE · SL $...` with a glowing `.bracket-chip-be.active-chip` pill.
- **TradingView-Style Zoom & Pan Engine:**
  - Non-passive mouse wheel / trackpad pinch zoom (15 to 250 visible bars) without page scroll.
  - Chart toolbar zoom controls: `[−]`, `{N}b` (auto-fit reset), and `[+]`.
  - Horizontal drag panning across historical tape data with a `[⇥ Latest]` button to snap right back to the newest bar.
  - Slicing of indicators (`ema20`, `ema50`, `bollingerBands`, `macd`, `orderFlow`) using `(startIdx, endIdx)` to ensure indicator continuity across all zoom levels.

---

## 🛡️ 18. Full Codebase Bug Fix & Design Audit (/antislop & /ui-styling) (Sprint 18)

- **Bug Fixes:**
  - **React Hook Ordering Violation in `PriceChart`:** Fixed early return (`if (!chartData) return ...`) positioned before `useMemo(scaleLabels)` and `useEffect(draggingBracket)`, eliminating `"Rendered more hooks than during the previous render."` crashes.
  - **Backtest Compiler Network Stall & Timeout:** Added a 15-second race between external LLM and `compileDeterministicFallback` in `src/app/api/backtest/route.ts`. Drops response times from 120s+ to 11–15s with 100% deterministic reliability.
  - **Outdated E2E Test Assertion:** Updated `test/e2e.test.mjs` to match anti-slop statistical ratings (`"Positive sample checks"`, `"Mixed sample checks"`, `"Limited or weak sample"`).
- **Anti-Slop & UI Styling Verification:**
  - **0 Console Errors:** Verified across all 9 workspace tabs via `test/check-console-errors.mjs`.
  - **0 DOM Anomalies:** Verified via `test/audit-webapp.mjs` (0 NaN, 0 undefined, 0 null, 0 [object Object]).
  - **0 Horizontal Overflow:** Verified across Desktop (1440px), Tablet (768px), and Mobile (390px) viewports via `test/verify-responsive-overhaul.mjs`.
  - **Button States:** Verified hover, active, focus-visible, and disabled states across all buttons via `test/verify-all-buttons.mjs`.
  - **Punctuation & Typography:** Tabular monospace figures across all financial data, zero unescaped unicode em dashes (`\u2014`) in copy.
- **Verification Results:**
  - 32/32 unit/quant/API tests passing (`npm test`).
  - 12/12 general E2E & Copilot tests passing (`npm run test:e2e`).
  - 9/9 Trade Replay E2E tests passing (`node --test test/trade-replay-e2e.test.mjs`).
  - 0 TypeScript errors (`npx tsc --noEmit`).

---

## 🔧 19. Reliability Pass (September 26, 2026)

- **Version control initialized:** The project had a `.gitignore` but no repository. `git init` on branch `main` with baseline commit `8b7d7b3` (288 files). Commit after every change batch from now on.
- **`npm test` made honest and self-contained:**
  - `test/api.test.mjs` previously failed with `ECONNREFUSED` (11 tests) unless a dev server was already running on port 3000 — the "100% green" claims in older sections assumed a manually started server. It now probes `GORIEE_TEST_BASE_URL` (default `http://127.0.0.1:3000`), auto-spawns `next dev` when nothing is listening, waits up to 120s for readiness, and kills the spawned server afterward (Windows: `taskkill /T /F` on the process tree).
  - The live LLM "Web Research Synthesis" test calls a real paid provider (took 121s and failed on provider latency during this pass). It is now skipped by default; opt in with `GORIEE_RUN_LIVE_AI_TESTS=1`.
  - Current verified state: **36 tests, 35 pass, 0 fail, 1 skipped**; `tsc --noEmit` clean.
- **Workspace backup completed (closes handoff item):** `src/lib/workspace-backup.ts` was missing 3 actively used keys — `goriee.auto-rule-runner.v1` (boolean), `goriee.rule-runner-logs.v1` (audit log array), and `goriee_copilot_sessions_v1` (Copilot threads). Added with validators (loose object shape for copilot sessions/messages so future fields do not invalidate backups), duplicate-ID checks extended, and the Settings UI copy updated. New `test/workspace-backup.test.mjs` (4 tests) covers allowlist, round-trip, rejection of invalid/duplicate payloads, and restore semantics. Restore-failure message no longer promises the rollback succeeded.
- **Research-provenance race fixed (closes handoff item #2):** `handleBacktestFromReport()` used to `setSeededResearchReport(report)` and call `runBacktest()` in the same closure; the result merge read the *stale* state, so a backtest could be tagged with the previous report. `runBacktest` overrides now accept an explicit `researchRef`, which `handleBacktestFromReport` passes directly; the seeded-report fallback additionally requires symbol AND interval to match the request.
- **Doc corrections:** `goriee.paper-risk.v1` is stored as a plain number (older sections said `{ dailyLossLimit: number }`); the deterministic backtest fallback compiler is still wired in as the 15s race fallback in `src/app/api/backtest/route.ts` (the Sept 25 handoff claimed its call was removed — it was not).
- **Still open (from `CODEX_HANDOFF_2026-09-25.md`):** All 5 handoff items (AI recovery & provenance #1/#2, cooldown UX #3, restore quota & runner safety #4, bracket safeguards #5, paper accounting #6) are now closed in Sprint 19 and 20. Outstanding architectural tech debt: pin `package.json` deps (currently `"latest"`), add ESLint, decompose the 7,700-line `trading-desk.tsx` and 11,600-line `globals.css`, and prune one-off `test/verify-*.mjs` scripts and committed screenshots.

---

## 🛡️ 20. Comprehensive Reliability & Safeguards Release (Sprint 20 - September 27, 2026)

- **Closed all remaining items from `CODEX_HANDOFF_2026-09-25.md` (#3, #4, #5, #6):**
  - **Bracket Lifecycle & Freshness Guard (Closes Handoff #5):**
    - Updated `src/app/api/tickers/route.ts` to return an `asOf` epoch timestamp per quote and in the top-level payload.
    - Added `asOf?: number` to `Quote` type in `src/components/trading-desk.tsx`.
    - In the background bracket evaluation loop, quotes older than 120s (`Date.now() - quote.asOf > 120_000`) or quotes with missing timestamps automatically pause execution.
    - Added `.bracket-stale-badge` amber indicator in the Paper Account table: `● Quotes stale >2m (Paused)`.
    - Full manual sells (`quantity >= held - 1e-8`) immediately prune `paperBrackets[symbol]`.
    - Unbracketed new buys (`orderSide === "buy" && !attachBracket`) and auto-rule-runner fills evict orphan/stale brackets on that symbol.
    - Created `test/bracket-lifecycle.test.mjs` (6/6 tests passing) verifying fresh execution, stale quote pause, missing timestamp handling, trailing stop updates, and bracket pruning on full/unbracketed orders.
  - **Persistent Cooldown UX & Dynamic Buttons (Closes Handoff #3):**
    - Added `storageKeys.aiCooldown = "goriee.ai-cooldown.v1"` to persist provider rate-limit wait times across page reloads.
    - Added 1-second interval ticker for `cooldownSeconds = Math.max(0, Math.ceil((aiRetryAt - now) / 1000))`.
    - Wired cooldown disabled state and dynamic labels across all AI submit action buttons:
      - Desk "Ask the desk" submit button: `⏳ Cooldown (${cooldownSeconds}s)`.
      - Research Tab submit button: `⏳ Cooldown (${cooldownSeconds}s)`.
      - Backtest Strategy Builder submit button: `⏳ Cooldown (${cooldownSeconds}s)`.
      - Copilot input send button & `Enter` handler: disabled with countdown label and tooltip.
  - **Atomic Workspace Restore & Storage Quota Probing (Closes Handoff #4):**
    - In `src/lib/workspace-backup.ts`: added pre-flight probe write to `__goriee_quota_probe__` before wiping storage. If quota is exceeded, throws `"Browser storage quota exceeded. The backup is too large to restore in this browser."` before touching existing keys.
    - Supported empty workspace `{ data: {} }` backups cleanly in `parseWorkspaceBackup`.
    - In `src/components/workspace-backup.tsx`: automatically pauses auto-rule-runner before restore and provides honest rollback error reporting.
    - Extended `test/workspace-backup.test.mjs` (6/6 tests passing) to verify empty backup restore and simulated quota probe rejection.
  - **Paper Accounting Test Suite (Closes Handoff #6):**
    - Created `test/paper-accounting.test.mjs` (4/4 tests passing) verifying `paperFillFee`, `paperCash` deductions on both buys and sells, proportional entry fee allocation on partial sells, and the fundamental equity accounting invariant: Realized Net + Unrealized Net == Equity - Starting Cash.
  - **Verified Test Suite Status:**
    - Full test suite: **48 tests (47 pass, 0 fail, 1 skipped)** (`npm test`).
    - Unit test suite: **37/37 pass** (`npm run test:unit`).
    - TypeScript: **0 errors** (`npx tsc --noEmit`).


