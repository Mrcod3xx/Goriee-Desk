# Goriee AI Desk

A research-first trading desk prototype for the Bitget AI Base Camp Hackathon. It fetches public Bitget spot market data, calculates indicators on the server, and records paper trades in the browser. It does not place live orders.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Public market data requires no Bitget API key.

To enable AI research and natural-language backtest rules, copy `.env.example` to `.env.local` and set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` for an OpenAI-compatible chat completions endpoint. The API key is read only by server routes and is never sent to the browser. Do not paste it into the chat or commit `.env.local`.

## Built-in flows

- **Market desk:** searchable online Bitget USDT spot pairs, including supported tokenized assets (RWA); interactive price chart toggling between Candlesticks and Line views, anchored volume bars, dynamic EMA 20/50 indicator lines, support/resistance levels, and hover inspection.
- **Watchlist:** personal watchlist with live quotes, add/remove controls, and browser-local persistence (up to 50 markets).
- **Market scanner:** sort by 24h change, turnover, or asset type (Crypto vs. Tokenized assets) with 1-click shortcuts to Desk, AI Brief, or Backtest.
- **AI research:** analysis grounded in Bitget ticker data and completed candles, with calculated indicators, timestamps, bull/bear theses, invalidation levels, optional live news search (via OpenRouter), and 1-click Markdown export.
- **Backtesting & Institutional Credibility:** natural-language strategy compilation for EMA crossovers and RSI mean reversion, replayed over historical Bitget candles with configurable fee/slippage inputs and live Bitget order book spread sampling. Includes dual-line equity curves (Strategy vs. Buy & Hold Benchmark with Alpha), out-of-sample retention decay, breakeven fee analysis, and drawdown duration tracking.
- **Paper account & Trade review:** $10,000 virtual starting balance, simulated fills, position closes, capital allocation presets (25%, 50%, 75%, Max), concentration alerts, and a comprehensive Trade Review with cumulative realized P&L trajectory curves, performance metrics, and CSV export.
- **Research journal:** saved locally in the browser with market snapshots and indicator history.

## Verification & Testing

The repository includes a comprehensive, automated multi-tier test suite:

```bash
# Run unit & API integration tests (fast, ~3.5s)
npm test

# Run headless Chrome browser end-to-end tests (~14s)
npm run test:e2e

# Run all test suites
npm run test:all

# Typecheck and production build
npm run typecheck
npm run build
```

The E2E test runs headlessly with Google Chrome via Puppeteer, clicking through all interactive UI states (candlestick chart toggles, crosshair inspection, scanner search, backtest simulations, modal presets, and trade reviews) and generating high-resolution verification screenshots under `test/screenshots/`.

## Notes

Market conditions, indicator values, and backtest results are for research and demonstration. Backtests are long-only spot simulations with configurable fee/slippage parameters and current order book spread sampling; open positions are marked at the final close. Historical performance does not predict future results. The app never connects to a private Bitget account or submits real orders.

Bitget's public candle API supplies historical price data. This app runs its own transparent candle-based simulation rather than claiming to invoke private Playbook execution.
