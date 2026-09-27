# AI AGENT HANDOVER & CONTEXT SPECIFICATION
> **Copy-paste this file directly into your next AI Coding Agent (Cursor, Claude Code, Windsurf, Codex, ChatGPT, Aider, etc.) to immediately resume development without losing context or introducing regressions.**

---

## 1. Quick Prompt for the Next AI Agent

If you are starting a new conversation with an AI coding agent, copy and paste this exact prompt:

```markdown
You are taking over development of the "Goriee AI Desk" codebase.
Please read AI_AGENT_HANDOVER.md in the project root first.
It contains the full architectural overview, current working state, critical invariants, key file paths, and testing instructions.
All 39 unit tests and TypeScript typechecks currently pass.
Let me know when you have read the handover document and are ready to continue.
```

---

## 2. Project Mission & Technology Stack

**Project Name**: Goriee AI Desk (`goriee-ai-desk`)  
**Domain**: Quantitative Crypto Trading Terminal, Strategy Backtester, and Historical Tape Replay Studio powered by live Bitget spot market feeds and multi-provider AI (DeepSeek, OpenAI, Claude, NVIDIA, and local Ollama).

### Core Stack
- **Framework**: Next.js 15 (App Router, React 19)
- **Language**: TypeScript (`strict: true`, clean type contracts)
- **Styling**: Vanilla CSS Design System with CSS Custom Properties (`src/app/globals.css`). **Tailwind CSS is NOT used.**
- **Host OS**: Windows. Run npm commands with `cmd.exe /c "npm run ..."` to avoid PowerShell execution policy blocks.
- **Dev Server**: Running locally on `http://localhost:3000`. Do NOT terminate or restart the dev server unless explicitly requested.

---

## 3. Strict Development Rules & Quality Standards

1. **Anti-Slop Guidelines (`/antislop`)**:
   - **NO decorative emojis** in UI components or code (use clean inline SVGs or semantic HTML).
   - High-contrast typography and WCAG AA accessibility compliance.
   - Clean, institutional, dark forest-green & slate design aesthetic.
   - Never use placeholder math or random number generators for quantitative trading metrics. All math must be derived deterministically.
2. **Quality Gates (Must Always Pass)**:
   - TypeScript Check: `cmd.exe /c "npm run typecheck"` -> **0 errors**.
   - Unit Tests: `cmd.exe /c "npm run test:unit"` -> **39/39 passing**.
3. **No Unnecessary Dependencies**:
   - Keep dependencies lightweight. Calculations (EMA, RSI, Bollinger Bands, ATR, MACD, Order Flow CVD, Kelly Sizing, Monte Carlo) are built natively in `src/lib/`.

---

## 4. Current State & Recently Solved Features

### A. Trade Replay Studio Historical Tape Fix (Completed & Verified)
- **Problem Fixed**: When users clicked "Replay" on backtested trades, the chart was blank showing `"Waiting for candle data..."` at `Bar 1 of 180`, and the play button rendered `"Play Play Space"`.
- **Solution Applied**:
  - `/api/backtest` now carries `candles?: Candle[]` (720 historical candles for 30 days) in the JSON response payload.
  - In `src/components/trading-desk.tsx`, added `effectiveMarket` memo that prioritizes `replayTargetTrade.candles` over the live 180-bar Bitget feed.
  - `closestIdx` matches the trade's exact entry bar (e.g. Bar 492), and `setupIdx` automatically rewinds 25 bars prior (`Bar 467 of 719`), rendering full candlestick action.
  - `PriceChart` supports `candles.length >= 1` cleanly without blanking.
  - Play button glyph replaced with clean inline SVG icon (eliminating duplicated "Play Play Space").
  - Automated Chrome headless test: `node test/verify-backtest-replay-fix.mjs` verifies 153 rendered candlestick rects and accurate navigation.

### B. AI Provider Switching & Informative Handout (Completed & Verified)
- **Feature Added**:
  - `ProviderSettings` in `src/components/provider-settings.tsx` updated with an interactive **AI Model Switcher & Operator Handout** panel.
  - 1-click quick-fill cards for **DeepSeek R1**, **DeepSeek V3**, **OpenAI GPT-4o-mini**, **Claude 3.5 Sonnet**, **NVIDIA Llama 3.3**, and **Local Ollama**.
  - One-click `.env.local` configuration copying.
  - `AI_SWITCHING_HANDOUT.md` created in project root with full provider matrix and setup instructions.
  - Automated Chrome headless test: `node test/verify-ai-handout.mjs` passes with 0 errors.

---

## 5. Architectural Directory & File Map

```
goriee-ai-desk/
├── AI_AGENT_HANDOVER.md         # THIS HANDOVER DOCUMENT FOR INCOMING AI AGENTS
├── AI_SWITCHING_HANDOUT.md      # User guide for switching AI models (DeepSeek, Claude, Ollama, etc.)
├── package.json                 # Project dependencies & scripts
├── src/
│   ├── app/
│   │   ├── globals.css          # Master design system & tokens (12,000+ lines of custom CSS)
│   │   ├── layout.tsx           # Root Next.js layout
│   │   ├── page.tsx             # Root page rendering TradingDesk component
│   │   └── api/                 # Server Route Handlers
│   │       ├── ai-status/       # Returns current configured LLM provider & connectivity
│   │       ├── backtest/        # Runs quant simulation & LLM strategy compilation
│   │       ├── copilot/         # Real-time streaming / JSON trade advisor
│   │       ├── market/          # Bitget spot candles & historical tape queries
│   │       ├── orderbook/       # Real-time L2 orderbook snapshot & depth calculation
│   │       ├── research/        # Bullish/Bearish fundamental & technical AI research
│   │       ├── settings/        # Writes LLM credentials to .env.local
│   │       └── tickers/         # Top Bitget volume & price tickers
│   ├── components/
│   │   ├── trading-desk.tsx     # Core monolithic workspace (Desk, Scanner, Backtests, Replay, Paper)
│   │   ├── provider-settings.tsx# AI Provider settings & Handout component
│   │   ├── parameter-heatmap.tsx# 2D Parameter robustness matrix
│   │   ├── monte-carlo.tsx      # Monte Carlo distribution visualizer
│   │   └── workspace-backup.tsx # Workspace export / restore JSON manager
│   └── lib/
│       ├── bitget.ts            # Bitget public REST API wrapper (Candles, Tickers, Depth)
│       ├── llm.ts               # Multi-provider LLM connector (OpenRouter, OpenAI, Claude, Ollama)
│       ├── backtest.ts          # Core quantitative engine (RSI, EMA, Bollinger, MACD, trades)
│       ├── paper-accounting.ts  # Cash balance, margin, fee deduction, trade journaling
│       └── ai-errors.ts         # Resilient retry & error formatting for AI endpoints
└── test/
    ├── unit.test.mjs            # 39 primary unit tests
    ├── verify-backtest-replay-fix.mjs # Headless Chrome test for trade replay handoff
    └── verify-ai-handout.mjs    # Headless Chrome test for AI Handout UI
```

---

## 6. How Key Workflows Function

### 1. Natural Language Prompt -> Backtest Compilation
1. User enters natural English prompt (e.g. *"Buy when RSI drops below 30 and EMA 20 crosses EMA 50. Exit when RSI rises above 70"*).
2. Client posts to `/api/backtest`.
3. `/api/backtest` uses `src/lib/llm.ts` with structured JSON schema (`StrategyDraft`).
4. If AI is offline, deterministic regex fallback `compileDeterministicFallback()` parses RSI & EMA parameters.
5. Bitget historical candles are fetched via `getHistoricalSpotCandles` in `src/lib/bitget.ts`.
6. `runBacktestSimulation()` in `src/lib/backtest.ts` iterates candle-by-candle with fee/slippage modeling.
7. Result returns metrics, trade list, and the complete candle array (`result.candles`).

### 2. Backtest Trade -> Trade Replay Studio Handoff
1. In Backtests view, user clicks **"Replay Best Trade"** or **"Replay"** on a trade row.
2. `replayFromBacktestTrade()` in `src/components/trading-desk.tsx` creates `target: ReplayTargetTrade` containing `openedAt`, `entryPrice`, `exitPrice`, and `candles: backtest.candles`.
3. View switches to `"replay"`.
4. `effectiveMarket` adopts the 720+ historical candles.
5. `replayIndex` calculates `setupIdx = Math.max(0, closestIdx - 25)`, positioning tape 25 bars prior to entry.
6. User can play/pause with <kbd>Space</kbd>, step 1 candle forward with <kbd>→</kbd>, cut tape with <kbd>C</kbd>, or place bracket paper orders against historical price action.

### 3. AI Copilot (Discretionary Assistant)
1. Floating Copilot bar at the bottom-right of the desk.
2. Gathers `copilotMarketSnapshot` (RSI, EMA, Bollinger Squeeze, Order Flow) and `copilotPaperSnapshot` (Equity, Positions, Win Rate).
3. Streams contextual advice and can generate ready-to-fill order action objects (`handleCopilotLoadOrder`).

---

## 7. Recommended Next Work Items

Based on the project's development roadmap, the following areas are prime candidates for further enhancement:

1. **Mobile & Tablet Responsive Refinement**:
   - Improve drawer behavior for the Trade Replay transport dock on small screens (< 768px).
2. **Additional Chart Overlays**:
   - Render MACD histogram sub-pane or Volume Profile directly on the Replay PriceChart.
3. **Trade Journal Export to PDF / Notion / CSV**:
   - Enhance the Journal tab with formatted Markdown or PDF export of completed paper and replay sessions.
4. **Custom Indicator Alerts & Webhooks**:
   - Provide browser notifications or simulated audio alerts when Bollinger Squeezes or EMA crossovers trigger.

---

## 8. Verification Commands Cheat Sheet

Run these commands in terminal to verify workspace integrity at any time:

```powershell
# 1. Run full unit test suite (39 tests)
cmd.exe /c "npm run test:unit"

# 2. Check TypeScript types
cmd.exe /c "npm run typecheck"

# 3. Verify Backtest Trade Replay Fix in Headless Chrome
node test/verify-backtest-replay-fix.mjs

# 4. Verify AI Handout in Headless Chrome
node test/verify-ai-handout.mjs

# 5. Check AI endpoint connection status
node -e "fetch('http://localhost:3000/api/ai-status').then(r=>r.json()).then(console.log)"
```

---
*End of Handover Document. All systems are operational, clean, and passing tests.*
