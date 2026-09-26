import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.GORIEE_TEST_BASE_URL ?? "http://127.0.0.1:3000";
const READY_TIMEOUT_MS = Number(process.env.GORIEE_TEST_READY_TIMEOUT_MS ?? 120_000);
// Live LLM/web-research tests call a real paid provider and are slow/flaky.
// Opt in explicitly with GORIEE_RUN_LIVE_AI_TESTS=1.
const RUN_LIVE_AI_TESTS = process.env.GORIEE_RUN_LIVE_AI_TESTS === "1";

let devServer = null;

async function serverAlive() {
  try {
    const res = await fetch(`${BASE_URL}/api/ai-status`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function killDevServer() {
  if (!devServer) return;
  const pid = devServer.pid;
  devServer = null;
  if (process.platform === "win32") {
    if (pid) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else if (pid) {
    try { process.kill(-pid, "SIGTERM"); } catch { /* already exited */ }
  }
}

before(async () => {
  if (await serverAlive()) return; // reuse an already-running dev server
  const port = new URL(BASE_URL).port || "3000";
  devServer = spawn(
    process.execPath,
    [path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", port],
    {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
      detached: process.platform !== "win32",
      env: { ...process.env, PORT: port },
    },
  );
  devServer.on("exit", () => { devServer = null; });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverAlive()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  killDevServer();
  throw new Error(`Dev server did not become ready at ${BASE_URL} within ${READY_TIMEOUT_MS / 1000}s. Start it manually with "npm run dev" and re-run, or set GORIEE_TEST_BASE_URL.`);
});

after(() => {
  killDevServer();
});

test("API: Root HTML and Application Shell (GET /)", async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200, "Root should return 200 OK");
  const html = await res.text();
  assert.ok(html.includes("Goriee AI Desk"), "Page HTML should contain 'Goriee AI Desk'");
  assert.ok(html.includes("viewport"), "Page HTML should have viewport meta tag");
});

test("API: AI Status Endpoint (GET /api/ai-status)", async () => {
  const res = await fetch(`${BASE_URL}/api/ai-status`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(typeof data.configured === "boolean", "Configured should be boolean");
  assert.ok(typeof data.model === "string", "Model should be a string");
  assert.ok(typeof data.provider === "string", "Provider should be a string");
});

test("API: Watchlist Tickers Endpoint (GET /api/tickers)", async () => {
  const res = await fetch(`${BASE_URL}/api/tickers?symbols=BTCUSDT,ETHUSDT,SOLUSDT`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.quotes), "Should return array of quotes");
  assert.equal(data.quotes.length, 3, "Should return exactly 3 requested tickers");
  
  const btc = data.quotes.find((t) => t.symbol === "BTCUSDT");
  assert.ok(btc, "Should contain BTCUSDT");
  assert.ok(typeof btc.price === "number" && btc.price > 1000, "BTC price should be realistic");
  assert.ok(typeof btc.change24h === "number", "BTC 24h change should be numeric");
});

test("API: Market Candles Endpoint (GET /api/market)", async () => {
  const res = await fetch(`${BASE_URL}/api/market?symbol=BTCUSDT&interval=1H`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.market, "Response should have market property");
  assert.equal(data.market.symbol, "BTCUSDT");
  assert.ok(Array.isArray(data.market.candles), "Candles should be an array");
  assert.ok(data.market.candles.length >= 100, `Expected at least 100 candles, got ${data.market.candles.length}`);
  
  // Verify candle structure
  const firstCandle = data.market.candles[0];
  assert.ok(firstCandle.time > 0, "Candle time must be positive integer timestamp");
  assert.ok(firstCandle.open > 0, "Candle open must be positive");
  assert.ok(firstCandle.high >= firstCandle.low, "Candle high must be >= low");
  assert.ok(firstCandle.close > 0, "Candle close must be positive");
  assert.ok(firstCandle.volume >= 0, "Candle volume must be non-negative");

  // Verify chronological ascending order
  const lastCandle = data.market.candles.at(-1);
  assert.ok(lastCandle.time > firstCandle.time, "Candles must be sorted ascending in time");
});

test("API: Scanner Endpoint (GET /api/scanner)", async () => {
  const res = await fetch(`${BASE_URL}/api/scanner`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.markets), "Scanner should return markets array");
  assert.ok(data.markets.length >= 20, `Scanner should return at least 20 pairs, got ${data.markets.length}`);

  const item = data.markets[0];
  assert.ok(item.symbol.endsWith("USDT"), "Scanner tokens should end with USDT");
  assert.ok(typeof item.price === "number" && item.price > 0, "Price must be positive");
  assert.ok(typeof item.change24h === "number", "24h change must be numeric");
  assert.ok(typeof item.turnover24h === "number", "Turnover must be numeric");
});

test("API: Order Book & Market Depth Endpoint (GET /api/orderbook)", async () => {
  const res = await fetch(`${BASE_URL}/api/orderbook?symbol=BTCUSDT&limit=10`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.orderbook, "Should contain orderbook object");
  assert.equal(data.orderbook.symbol, "BTCUSDT");
  assert.ok(Array.isArray(data.orderbook.bids), "Bids should be an array");
  assert.ok(Array.isArray(data.orderbook.asks), "Asks should be an array");
  assert.ok(data.orderbook.bids.length > 0, "Bids array should not be empty");
  assert.ok(data.orderbook.asks.length > 0, "Asks array should not be empty");
  assert.ok(typeof data.orderbook.spread === "number" && data.orderbook.spread >= 0, "Spread must be non-negative");
  assert.ok(typeof data.orderbook.spreadBps === "number", "Spread in bps must be numeric");
  assert.ok(typeof data.orderbook.imbalancePct === "number", "Imbalance % must be numeric");
  assert.ok(data.orderbook.imbalancePct >= -100 && data.orderbook.imbalancePct <= 100, "Imbalance % must be between -100 and 100");
  assert.ok(data.orderbook.bestAsk >= data.orderbook.bestBid, "Best ask must be >= best bid");
});

test("API: Quantitative Backtest with Dual Curve & Robustness (POST /api/backtest - EMA)", { timeout: 120_000 }, async () => {
  const payload = {
    symbol: "BTCUSDT",
    interval: "1H",
    lookbackDays: 30,
    strategyPrompt: "Buy when EMA 20 crosses above EMA 50, exit when EMA 20 crosses below EMA 50",
    feeBps: 10,
    slippageBps: 5,
  };

  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 200, "Backtest should return 200 OK");
  const data = await res.json();

  assert.ok(data.result, "Response should have result object");
  const bt = data.result;
  assert.equal(bt.symbol, "BTCUSDT");
  assert.equal(bt.strategy.kind, "ema_cross");
  assert.equal(bt.strategy.fastPeriod, 20);
  assert.equal(bt.strategy.slowPeriod, 50);

  // Dual equity curve validation
  assert.ok(Array.isArray(bt.equity) && bt.equity.length > 50, "Equity curve should have points");
  const sampleEquity = bt.equity[0];
  assert.ok("time" in sampleEquity, "Equity point must have time");
  assert.ok("value" in sampleEquity, "Equity point must have strategy value");
  assert.ok("benchmarkValue" in sampleEquity, "Equity point must have benchmarkValue");

  // Institutional Robustness Scorecard validation
  assert.ok(bt.robustness, "Backtest must include robustness metrics");
  assert.ok(typeof bt.robustness.alphaPct === "number", "alphaPct must be numeric");
  assert.ok(typeof bt.robustness.breakevenFeeBps === "number" || bt.robustness.breakevenFeeBps === null, "breakevenFeeBps check");
  assert.ok(typeof bt.robustness.maxDrawdownDurationBars === "number", "maxDrawdownDurationBars must be numeric");
  assert.ok(["high", "moderate", "fragile"].includes(bt.robustness.robustnessRating), "robustnessRating must be valid tier");

  // Trades check
  assert.ok(Array.isArray(bt.trades), "Trades should be an array");
});

test("API: Quantitative Backtest Reversion (POST /api/backtest - RSI)", { timeout: 120_000 }, async () => {
  const payload = {
    symbol: "BTCUSDT",
    interval: "1H",
    lookbackDays: 30,
    strategyPrompt: "RSI 14 oversold entry below 30, exit above 70",
    feeBps: 10,
    slippageBps: 5,
  };

  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.result);
  assert.equal(data.result.strategy.kind, "rsi_reversion");
  assert.equal(data.result.strategy.rsiPeriod, 14);
  assert.equal(data.result.strategy.entryBelow, 30);
  assert.equal(data.result.strategy.exitAbove, 70);
});

test("API: Backtest Error Handling (POST /api/backtest - Invalid Inputs)", async () => {
  // Empty payload
  const resEmpty = await fetch(`${BASE_URL}/api/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(resEmpty.status, 400, "Empty payload should return 400 Bad Request");

  // Unsupported interval
  const resBadInterval = await fetch(`${BASE_URL}/api/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: "BTCUSDT",
      interval: "99m",
      lookbackDays: 30,
      strategyPrompt: "EMA 20 crossing EMA 50",
    }),
  });
  assert.equal(resBadInterval.status, 400, "Invalid interval should return 400 Bad Request");
});

test("API: Research Error Handling (POST /api/research - Invalid Inputs)", async () => {
  const resBadSymbol = await fetch(`${BASE_URL}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: "INVALID_SYMBOL_$$$",
      interval: "1H",
    }),
  });
  assert.equal(resBadSymbol.status, 400, "Invalid symbol format should return 400");
  const data = await resBadSymbol.json();
  assert.ok(data.error.includes("Choose a supported spot symbol"), "Error message should guide user");
});

test("API: Live Web Research Synthesis across AI Routers (POST /api/research)", { timeout: 160_000, skip: !RUN_LIVE_AI_TESTS && "live AI test skipped (set GORIEE_RUN_LIVE_AI_TESTS=1 to run)" }, async () => {
  let res = await fetch(`${BASE_URL}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: "BTCUSDT",
      interval: "1H",
      includeWebResearch: true,
      question: "Analyze Bitcoin market structure and recent institutional sentiment",
    }),
  });

  if (res.status === 502) {
    // Retry once in case of remote model queue spike
    await new Promise((r) => setTimeout(r, 2500));
    res = await fetch(`${BASE_URL}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "BTCUSDT",
        interval: "1H",
        includeWebResearch: true,
        question: "Analyze Bitcoin market structure",
      }),
    });
  }

  assert.equal(res.status, 200, "Research with live web search should succeed with 200 OK");
  const data = await res.json();
  assert.ok(data.report, "Response should contain report object");
  assert.equal(data.report.webResearchIncluded, true, "webResearchIncluded must be true");
  assert.ok(typeof data.report.summary === "string" && data.report.summary.length > 20, "Summary must be present");
  assert.ok(typeof data.report.bullCase === "string", "Bull case must be present");
  assert.ok(typeof data.report.bearCase === "string", "Bear case must be present");
  assert.ok(typeof data.report.invalidation === "string", "Invalidation must be present");
  assert.ok(Array.isArray(data.report.sources), "Sources should be an array of citations");
  assert.ok(data.report.sources.length > 0, "Should include live news citations");
  assert.ok(data.report.sources[0].url.startsWith("http"), "Source URL must be valid HTTP/HTTPS");
});
