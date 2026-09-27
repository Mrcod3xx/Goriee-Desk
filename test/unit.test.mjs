import test from "node:test";
import assert from "node:assert/strict";

// Re-usable indicator math implemented in pure JS to test core formulas
function calculateEMA(values, period) {
  const k = 2 / (period + 1);
  let previous = values[0];
  const result = [previous];
  for (let i = 1; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k);
    result.push(previous);
  }
  return result;
}

function calculateSMA(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calculateBollingerBands(values, period = 20, multiplier = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: mean + multiplier * std,
    middle: mean,
    lower: mean - multiplier * std,
  };
}

function calculateMACD(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = calculateEMA(values, fast);
  const slowEma = calculateEMA(values, slow);
  const macdLine = values.map((_, i) => fastEma[i] - slowEma[i]);
  const signalLine = calculateEMA(macdLine, signal);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

test("Quantitative Math: EMA smoothing formula accuracy", () => {
  const prices = [10, 11, 12, 13, 14, 15];
  const ema = calculateEMA(prices, 3);
  assert.equal(ema.length, prices.length);
  // k = 2 / (3 + 1) = 0.5
  // ema[0] = 10
  // ema[1] = 11*0.5 + 10*0.5 = 10.5
  // ema[2] = 12*0.5 + 10.5*0.5 = 11.25
  assert.equal(ema[0], 10);
  assert.equal(ema[1], 10.5);
  assert.equal(ema[2], 11.25);
});

test("Quantitative Math: RSI bounds and monotonicity", () => {
  // Monotonically increasing prices -> RSI should approach 100
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 5);
  const rsiRising = calculateRSI(rising, 14);
  assert.ok(rsiRising > 99, `RSI for rising series should be near 100, got ${rsiRising}`);

  // Monotonically falling prices -> RSI should approach 0
  const falling = Array.from({ length: 30 }, (_, i) => 200 - i * 5);
  const rsiFalling = calculateRSI(falling, 14);
  assert.ok(rsiFalling < 1, `RSI for falling series should be near 0, got ${rsiFalling}`);

  // Flat oscillating prices -> RSI should hover near 50
  const oscillating = Array.from({ length: 50 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -2));
  const rsiOscillating = calculateRSI(oscillating, 14);
  assert.ok(rsiOscillating > 40 && rsiOscillating < 60, `RSI should be centered, got ${rsiOscillating}`);
});

test("Quantitative Math: ATR volatility tracking", () => {
  const highs = [105, 107, 108, 110, 112];
  const lows = [95, 96, 97, 98, 100];
  const closes = [100, 102, 104, 106, 108];
  const atr = calculateATR(highs, lows, closes, 3);
  assert.ok(atr > 0, "ATR should be strictly positive");
  assert.ok(atr >= 10, "True range across 10-point bars should be around 10-12");
});

test("Quantitative Math: Bollinger Bands envelope calculation", () => {
  const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
  const bands = calculateBollingerBands(prices, 20, 2);
  assert.ok(bands !== null);
  assert.ok(bands.upper > bands.middle);
  assert.ok(bands.middle > bands.lower);
  assert.equal(Number((bands.upper - bands.middle).toFixed(4)), Number((bands.middle - bands.lower).toFixed(4)));
});

test("Quantitative Math: MACD histogram and crossover logic", () => {
  const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const res = calculateMACD(prices);
  assert.equal(res.macdLine.length, prices.length);
  assert.equal(res.signalLine.length, prices.length);
  assert.equal(res.histogram.length, prices.length);
  const lastIdx = prices.length - 1;
  assert.equal(
    Number(res.histogram[lastIdx].toFixed(4)),
    Number((res.macdLine[lastIdx] - res.signalLine[lastIdx]).toFixed(4))
  );
});

test("Risk & Sizing: Allocation presets and concentration risk rules", () => {
  const equity = 10_000;
  const cash = 8_000;
  
  // Available allocations based on available cash
  const p25 = Number((cash * 0.25).toFixed(2));
  const p50 = Number((cash * 0.50).toFixed(2));
  const p75 = Number((cash * 0.75).toFixed(2));
  const pMax = Number(cash.toFixed(2));

  assert.equal(p25, 2000);
  assert.equal(p50, 4000);
  assert.equal(p75, 6000);
  assert.equal(pMax, 8000);

  // Concentration alert rule: allocation > 25% of total equity
  const isConcentrated25 = p25 > equity * 0.25;
  const isConcentrated50 = p50 > equity * 0.25;
  assert.equal(isConcentrated25, false, "2000 is 20% of equity, not concentrated");
  assert.equal(isConcentrated50, true, "4000 is 40% of equity, triggers concentration warning");
});

test("Trade Review: Cumulative P&L curve calculation", () => {
  const closedTrades = [
    { id: "1", closedAt: 1000, realizedPnl: 150 },
    { id: "2", closedAt: 2000, realizedPnl: -50 },
    { id: "3", closedAt: 3000, realizedPnl: 300 },
    { id: "4", closedAt: 4000, realizedPnl: 100 },
  ];

  let running = 0;
  const trajectory = closedTrades.map((t) => {
    running += t.realizedPnl;
    return { time: t.closedAt, cumulativePnl: running };
  });

  assert.equal(trajectory.length, 4);
  assert.equal(trajectory[0].cumulativePnl, 150);
  assert.equal(trajectory[1].cumulativePnl, 100);
  assert.equal(trajectory[2].cumulativePnl, 400);
  assert.equal(trajectory[3].cumulativePnl, 500);
});

test("CSV Export Serialization: Header and row formatting", () => {
  const trade = {
    symbol: "BTCUSDT",
    side: "BUY",
    entryPrice: 65432.1,
    exitPrice: 67890.5,
    size: 0.15,
    realizedPnl: 368.76,
    openedAt: 1711234567890,
    closedAt: 1711245678900,
  };

  const header = "Symbol,Side,Entry Price,Exit Price,Size,Realized PnL,Opened At,Closed At";
  const row = [
    trade.symbol,
    trade.side,
    trade.entryPrice.toFixed(2),
    trade.exitPrice.toFixed(2),
    trade.size.toFixed(4),
    trade.realizedPnl.toFixed(2),
    new Date(trade.openedAt).toISOString(),
    new Date(trade.closedAt).toISOString(),
  ].join(",");

  const csv = `${header}\n${row}\n`;
  assert.ok(csv.includes("BTCUSDT,BUY,65432.10,67890.50,0.1500,368.76"));
  assert.ok(csv.startsWith("Symbol,Side"));
});

test("Research-to-Backtest: Custom prompt generation from Bullish Research Brief", async () => {
  const { generateBacktestPromptFromResearch, getStrategyTypeFromResearch } = await import("../src/lib/research-strategy.ts");
  const bullishReport = {
    symbol: "BTCUSDT",
    interval: "1H",
    indicators: {
      ema20: 84500,
      ema50: 83100,
      rsi14: 56.4,
      support: 82000,
      resistance: 86500,
      rangePct: 1.8,
      regime: "Bullish structure",
    },
    summary: "BTCUSDT maintains strong bullish continuation with price consistently holding above EMA 20 and EMA 50.",
    bullCase: "Institutional ETF inflows and sustained volume continue to support higher lows.",
    bearCase: "A rejection at 86,500 resistance could trigger consolidation back to 82,000.",
    invalidation: "A drop below 82,000 support breaks the trend structure.",
    question: "Analyze Bitcoin market structure",
  };

  const strategy = getStrategyTypeFromResearch(bullishReport);
  assert.equal(strategy.kind, "ema_cross");
  assert.equal(strategy.title, "Bullish Trend Continuation");

  const prompt = generateBacktestPromptFromResearch(bullishReport);
  assert.ok(prompt.includes("BTCUSDT (1H)"), "Prompt should mention symbol and interval");
  assert.ok(prompt.includes("EMA"), "Prompt should contain EMA rule");
  assert.ok(prompt.includes("20-period EMA crosses above 50-period EMA"), "Should specify exact crossover parameters");
  assert.ok(prompt.includes("Institutional ETF inflows"), "Should incorporate salient bull case from brief");
});

test("Research-to-Backtest: Custom prompt generation from Oversold Dip Brief", async () => {
  const { generateBacktestPromptFromResearch, getStrategyTypeFromResearch } = await import("../src/lib/research-strategy.ts");
  const oversoldReport = {
    symbol: "ETHUSDT",
    interval: "4H",
    indicators: {
      ema20: 2600,
      ema50: 2750,
      rsi14: 31.8,
      support: 2520,
      resistance: 2800,
      rangePct: 2.1,
      regime: "Bearish structure",
    },
    summary: "ETH has experienced aggressive selling, pushing 14-period RSI to deep oversold territory near major support.",
    bullCase: "Exhaustion selling near $2,520 support sets up a strong mean-reversion opportunity.",
    bearCase: "Continued liquidation cascade could breach $2,520.",
    invalidation: "A close below $2,500 invalidates the bounce thesis.",
    question: "Check if ETH is oversold",
  };

  const strategy = getStrategyTypeFromResearch(oversoldReport);
  assert.equal(strategy.kind, "rsi_reversion");
  assert.equal(strategy.title, "Oversold Mean Reversion");

  const prompt = generateBacktestPromptFromResearch(oversoldReport);
  assert.ok(prompt.includes("ETHUSDT (4H)"));
  assert.ok(prompt.includes("RSI"), "Prompt should contain RSI rule");
  assert.ok(prompt.includes("drops below 32"), "Should specify entry below 32");
  assert.ok(prompt.includes("exceeds 60"), "Should specify exit above 60");
  assert.ok(prompt.includes("Exhaustion selling"), "Should cite brief thesis snippet");
});

test("Automated Rule Engine: evaluatePlaybookRule on RSI and EMA playbooks", async () => {
  const { evaluatePlaybookRule } = await import("../src/lib/bitget.ts");

  // Create simulated 50 candles with declining prices (RSI oversold)
  const baseTime = Date.now() - 50 * 3600 * 1000;
  const oversoldCandles = Array.from({ length: 50 }, (_, i) => {
    const price = 3000 - i * 15; // monotonically dropping
    return {
      time: baseTime + i * 3600 * 1000,
      open: price + 5,
      high: price + 10,
      low: price - 5,
      close: price,
      volume: 100,
      turnover: 100 * price,
    };
  });

  const rsiPrompt = "Buy when RSI (14) drops below 30. Exit when RSI (14) rises above 65.";
  const rsiResult = evaluatePlaybookRule(rsiPrompt, oversoldCandles);
  assert.equal(rsiResult.action, "buy");
  assert.ok(rsiResult.reason.includes("meeting buy trigger"));

  // Create simulated 50 candles with rising prices (RSI overbought)
  const overboughtCandles = Array.from({ length: 50 }, (_, i) => {
    const price = 2000 + i * 25; // rising fast
    return {
      time: baseTime + i * 3600 * 1000,
      open: price - 5,
      high: price + 10,
      low: price - 5,
      close: price,
      volume: 100,
      turnover: 100 * price,
    };
  });

  const rsiExitResult = evaluatePlaybookRule(rsiPrompt, overboughtCandles);
  assert.equal(rsiExitResult.action, "sell");
  assert.ok(rsiExitResult.reason.includes("meeting exit trigger"));
});

test("Parameter Matrix: calculates 2D parameter grid and robustness score", async () => {
  const { calculateParameterMatrix } = await import("../src/lib/parameter-matrix.ts");

  // Generate 80 candles of synthetic price wave
  const baseTime = Date.now() - 80 * 3600 * 1000;
  const candles = Array.from({ length: 80 }, (_, i) => {
    const price = 2000 + Math.sin(i / 5) * 150 + i * 2;
    return {
      time: baseTime + i * 3600 * 1000,
      open: price - 2,
      high: price + 10,
      low: price - 10,
      close: price,
      volume: 1000 + Math.abs(Math.sin(i)) * 500,
      turnover: 2000 * 1000,
    };
  });

  const emaResult = calculateParameterMatrix(candles, {
    kind: "ema_cross",
    feeBps: 10,
    slippageBps: 5,
    startingBalance: 10000,
  });

  assert.equal(emaResult.kind, "ema_cross");
  assert.equal(emaResult.labelA, "Fast EMA");
  assert.equal(emaResult.labelB, "Slow EMA");
  assert.ok(emaResult.cells.length > 0);
  assert.ok(emaResult.valuesA.length > 0);
  assert.ok(emaResult.valuesB.length > 0);
  assert.ok(typeof emaResult.robustnessScore === "number");
  assert.ok(typeof emaResult.isPlateau === "boolean");
  assert.ok(typeof emaResult.isCliff === "boolean");
  assert.ok(emaResult.bestCell !== undefined);
  assert.ok(typeof emaResult.bestCell.returnPct === "number");

  // RSI parameter matrix
  const rsiResult = calculateParameterMatrix(candles, {
    kind: "rsi_reversion",
    feeBps: 10,
    slippageBps: 5,
    startingBalance: 10000,
  });
  assert.equal(rsiResult.kind, "rsi_reversion");
  assert.equal(rsiResult.labelA, "RSI Entry Threshold");
  assert.equal(rsiResult.labelB, "RSI Exit Threshold");
  assert.ok(rsiResult.cells.length > 0);
});

test("Order Flow: calculates Intra-Candle Delta, CVD line and Buyer Aggression", async () => {
  const { calculateOrderFlow } = await import("../src/lib/order-flow.ts");

  const baseTime = Date.now() - 40 * 3600 * 1000;
  // Strong buyer aggression candles (close near high)
  const bullishCandles = Array.from({ length: 40 }, (_, i) => ({
    time: baseTime + i * 3600 * 1000,
    open: 100 + i * 2,
    high: 105 + i * 2,
    low: 99 + i * 2,
    close: 104.5 + i * 2, // near high
    volume: 500,
    turnover: 50000,
  }));

  const flow = calculateOrderFlow(bullishCandles);
  assert.equal(flow.bars.length, 40);
  assert.ok(flow.totalVolume > 0);
  assert.ok(flow.totalBuyVolume > flow.totalSellVolume, "Buyer volume should exceed seller volume");
  assert.ok(flow.buyerAggressionPct > 55, "Buyer aggression should be elevated (>55%)");
  assert.ok(flow.currentCvd > 0, "CVD should be positive during consistent upward pressure");
  assert.ok(
    ["Buyer Absorption", "Strong Buyer Dominance", "Balanced Flow"].includes(flow.regime),
    `Regime was: ${flow.regime}`
  );
});

test("Kelly Sizing & Volatility Squeeze: calculates fractional Kelly, risk capital and band compression", async () => {
  const { calculateKellySizing, detectVolatilitySqueeze } = await import("../src/lib/kelly-sizer.ts");

  // Kelly sizing test: 60% win rate, 2:1 RRR
  const sizing = calculateKellySizing({
    accountBalance: 10000,
    entryPrice: 50000,
    stopPrice: 48500, // 3% stop distance
    takeProfitPrice: 53000, // 6% profit distance => 2:1 RRR
    winRatePct: 60,
    maxRiskLimitPct: 2.5,
  });

  assert.equal(sizing.winRatePct, 60);
  assert.equal(sizing.rewardRiskRatio, 2);
  // Full Kelly: W - (1-W)/R = 0.60 - 0.40/2 = 0.40 (40%)
  // Half Kelly: 20%
  assert.equal(sizing.fullKellyFraction, 0.4);
  assert.equal(sizing.halfKellyFraction, 0.2);
  assert.equal(sizing.isViable, true);
  assert.equal(sizing.edgeRating, "High Edge");
  assert.equal(sizing.recommendedRiskPct, 2.5); // Capped by maxRiskLimitPct
  assert.equal(sizing.dollarRisk, 250); // 2.5% of 10,000
  assert.ok(sizing.positionSizeUsd > 0);
  assert.ok(sizing.positionQuantity > 0);

  // Volatility squeeze test
  const candles = Array.from({ length: 45 }, (_, i) => ({
    close: 100 + (i % 2 === 0 ? 0.2 : -0.2),
    high: 100.5,
    low: 99.5,
  }));
  const tightBands = {
    upper: 100.3,
    lower: 99.7,
    middle: 100,
  };
  const squeeze = detectVolatilitySqueeze(candles, tightBands);
  assert.ok(typeof squeeze.isSqueezed === "boolean");
  assert.ok(squeeze.bandwidthPct > 0);
  assert.ok(typeof squeeze.bandwidthPercentile === "number");
  assert.ok(squeeze.message.length > 0);
});

test("Portfolio Analytics: calculates Sharpe, Sortino, drawdown, daily P&L, rolling win rate and streaks", async () => {
  const {
    buildEquityCurve,
    buildDrawdownSeries,
    buildDailyPnl,
    buildRollingWinRate,
    buildAssetAllocation,
    computePortfolioMetrics,
  } = await import("../src/lib/portfolio-analytics.ts");

  const baseTime = 1710000000000;
  const dayMs = 24 * 3600 * 1000;

  // Mock closed trades: 4 wins, 2 losses
  const mockTrades = [
    {
      id: "t1",
      symbol: "BTCUSDT",
      quantity: 0.1,
      entryPrice: 60000,
      exitPrice: 62000,
      openedAt: baseTime,
      closedAt: baseTime + 2 * 3600 * 1000,
      grossPnl: 200,
      entryFee: 6,
      exitFee: 6.2,
      netPnl: 187.8,
      returnPct: 3.1,
    },
    {
      id: "t2",
      symbol: "ETHUSDT",
      quantity: 1,
      entryPrice: 3500,
      exitPrice: 3400,
      openedAt: baseTime + 5 * 3600 * 1000,
      closedAt: baseTime + 8 * 3600 * 1000,
      grossPnl: -100,
      entryFee: 3.5,
      exitFee: 3.4,
      netPnl: -106.9,
      returnPct: -3.05,
    },
    {
      id: "t3",
      symbol: "SOLUSDT",
      quantity: 10,
      entryPrice: 150,
      exitPrice: 165,
      openedAt: baseTime + dayMs,
      closedAt: baseTime + dayMs + 3 * 3600 * 1000,
      grossPnl: 150,
      entryFee: 1.5,
      exitFee: 1.65,
      netPnl: 146.85,
      returnPct: 9.78,
    },
    {
      id: "t4",
      symbol: "BTCUSDT",
      quantity: 0.05,
      entryPrice: 63000,
      exitPrice: 65000,
      openedAt: baseTime + dayMs + 4 * 3600 * 1000,
      closedAt: baseTime + dayMs + 7 * 3600 * 1000,
      grossPnl: 100,
      entryFee: 3.15,
      exitFee: 3.25,
      netPnl: 93.6,
      returnPct: 2.97,
    },
    {
      id: "t5",
      symbol: "SOLUSDT",
      quantity: 5,
      entryPrice: 160,
      exitPrice: 155,
      openedAt: baseTime + 2 * dayMs,
      closedAt: baseTime + 2 * dayMs + 2 * 3600 * 1000,
      grossPnl: -25,
      entryFee: 0.8,
      exitFee: 0.775,
      netPnl: -26.575,
      returnPct: -3.32,
    },
    {
      id: "t6",
      symbol: "BTCUSDT",
      quantity: 0.1,
      entryPrice: 64000,
      exitPrice: 66000,
      openedAt: baseTime + 2 * dayMs + 3 * 3600 * 1000,
      closedAt: baseTime + 2 * dayMs + 6 * 3600 * 1000,
      grossPnl: 200,
      entryFee: 6.4,
      exitFee: 6.6,
      netPnl: 187.0,
      returnPct: 2.92,
    },
  ];

  // 1. Equity curve calculation
  const startingCapital = 10000;
  const equityCurve = buildEquityCurve(mockTrades, startingCapital);
  assert.equal(equityCurve.length, 6);
  assert.equal(equityCurve[0].equity, 10000 + 187.8);
  const expectedFinalEquity = startingCapital + mockTrades.reduce((s, t) => s + t.netPnl, 0);
  assert.equal(Math.round(equityCurve[5].equity * 100) / 100, Math.round(expectedFinalEquity * 100) / 100);

  // 2. Drawdown series
  const drawdown = buildDrawdownSeries(equityCurve);
  assert.equal(drawdown.length, 6);
  assert.equal(drawdown[0].drawdown, 0); // At peak
  assert.ok(drawdown[1].drawdown < 0, "Drawdown after loss should be negative");
  assert.ok(drawdown[1].drawdownPct < 0, "Drawdown pct should be negative");

  // 3. Daily P&L calendar aggregation
  const daily = buildDailyPnl(mockTrades);
  assert.ok(daily.length >= 2, "Should aggregate across multiple dates");
  assert.ok(daily[0].tradeCount > 0);
  assert.ok(typeof daily[0].pnl === "number");

  // 4. Rolling win rate
  const rolling = buildRollingWinRate(mockTrades, 3);
  assert.equal(rolling.length, 4); // 6 trades, window 3 => 4 points
  assert.ok(rolling[0].winRate >= 0 && rolling[0].winRate <= 100);

  // 5. Asset allocation donut
  const openPositions = [
    { symbol: "BTCUSDT", quantity: 0.1, averageEntry: 60000 },
    { symbol: "ETHUSDT", quantity: 1, averageEntry: 4000 },
  ];
  const quotes = [
    { symbol: "BTCUSDT", price: 60000 },
    { symbol: "ETHUSDT", price: 4000 },
  ];
  const allocation = buildAssetAllocation(openPositions, quotes);
  assert.equal(allocation.length, 2);
  const totalPct = allocation.reduce((s, a) => s + a.pct, 0);
  assert.ok(Math.abs(totalPct - 100) < 0.01, "Allocations should sum to 100%");
  assert.equal(allocation[0].symbol, "BTCUSDT");
  assert.equal(allocation[0].pct, 60);
  assert.equal(allocation[1].symbol, "ETHUSDT");
  assert.equal(allocation[1].pct, 40);

  // 6. Quantitative Portfolio Metrics
  const metrics = computePortfolioMetrics(mockTrades, startingCapital);
  assert.equal(metrics.totalTrades, 6);
  assert.equal(metrics.totalWins, 4);
  assert.equal(metrics.totalLosses, 2);
  assert.equal(metrics.winRate, (4 / 6) * 100);
  assert.ok(metrics.totalReturn > 0);
  assert.ok(metrics.totalReturnPct > 0);
  assert.ok(metrics.sharpeRatio !== null && metrics.sharpeRatio > 0);
  assert.ok(metrics.sortinoRatio !== null && metrics.sortinoRatio > 0);
  assert.ok(metrics.profitFactor !== null && metrics.profitFactor > 1);
  assert.ok(metrics.payoffRatio !== null && metrics.payoffRatio > 0);
  assert.ok(metrics.expectancy > 0);
  assert.equal(metrics.bestTrade?.symbol, "BTCUSDT");
  assert.equal(metrics.bestTrade?.netPnl, 187.8);
  assert.equal(metrics.worstTrade?.symbol, "ETHUSDT");
  assert.equal(metrics.worstTrade?.netPnl, -106.9);
  assert.equal(metrics.longestWinStreak, 2);
  assert.equal(metrics.currentStreak.type, "win");
  assert.equal(metrics.currentStreak.length, 1);
});

test("Regression & Edge Cases: Volatility squeeze percentile, Safe Kelly RRR, and Matrix selection", async () => {
  const { detectVolatilitySqueeze, calculateKellySizing } = await import("../src/lib/kelly-sizer.ts");
  const { calculateParameterMatrix } = await import("../src/lib/parameter-matrix.ts");
  const { computePortfolioMetrics } = await import("../src/lib/portfolio-analytics.ts");

  // 1. Squeeze ranking when current bandwidth exceeds all trailing candles (must be 100th percentile, NOT 0th)
  const flatCandles = Array.from({ length: 40 }, () => ({
    close: 100,
    high: 100.1,
    low: 99.9,
  }));
  const hugeBand = { upper: 120, lower: 80, middle: 100 }; // 40% bandwidth, much higher than 0.2%
  const expansionSqueeze = detectVolatilitySqueeze(flatCandles, hugeBand);
  assert.equal(expansionSqueeze.bandwidthPercentile, 100, "Highest bandwidth must be 100th percentile");
  assert.equal(expansionSqueeze.isSqueezed, false, "Expansion must not be labeled as squeezed");

  // 2. Kelly calculation when TP == Entry (0 profit distance)
  const safeKelly = calculateKellySizing({
    accountBalance: 10000,
    entryPrice: 100,
    stopPrice: 95,
    winRatePct: 60,
    takeProfitPrice: 100,
  });
  assert.ok(Number.isFinite(safeKelly.rewardRiskRatio), "RRR must remain finite");
  assert.ok(Number.isFinite(safeKelly.fullKellyFraction), "Kelly fraction must remain finite");
  assert.ok(Number.isFinite(safeKelly.positionSizeUsd), "Position size must remain finite");

  // 3. Parameter matrix cell selection when no parameter is explicitly selected
  const candles = Array.from({ length: 50 }, (_, i) => ({
    time: 1700000000000 + i * 60000,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100.5 + i * 0.1,
    volume: 1000,
  }));
  const matrix = calculateParameterMatrix(candles, {
    kind: "rsi_reversion",
    startingBalance: 10000,
  });
  const anySelected = matrix.cells.some((c) => c.isSelected);
  assert.equal(anySelected, false, "No cell should be selected if selectedParam is omitted");

  // 4. Portfolio metrics when trades have 100% win rate (0 losses)
  const allWinTrades = [
    { id: "w1", symbol: "BTCUSDT", quantity: 1, entryPrice: 60000, exitPrice: 62000, openedAt: 1000, closedAt: 2000, grossPnl: 2000, entryFee: 10, exitFee: 10, netPnl: 1980, returnPct: 3.3 },
    { id: "w2", symbol: "ETHUSDT", quantity: 10, entryPrice: 3000, exitPrice: 3200, openedAt: 3000, closedAt: 4000, grossPnl: 2000, entryFee: 10, exitFee: 10, netPnl: 1980, returnPct: 6.6 },
  ];
  const winMetrics = computePortfolioMetrics(allWinTrades, 10000);
  assert.equal(winMetrics.winRate, 100);
  assert.equal(winMetrics.profitFactor, null, "Profit factor must be null when there are zero losses");
});

test("Copilot: buildCopilotSystemPrompt and parseCopilotResponse", async () => {
  const { buildCopilotSystemPrompt, parseCopilotResponse } = await import("../src/lib/copilot-prompt.ts");

  // 1. Prompt generation with full context snapshot
  const prompt = buildCopilotSystemPrompt({
    symbol: "BTCUSDT",
    interval: "1H",
    activeView: "desk",
    includeTokenContext: true,
    includeTechnicalContext: true,
    includePortfolioContext: true,
    marketSnapshot: {
      symbol: "BTCUSDT",
      interval: "1H",
      price: 64250,
      change24h: 3.45,
      high24h: 65100,
      low24h: 62800,
      volume24h: 1250000,
      rsi: 58.4,
      ema20: 63800,
      ema50: 62500,
      bbSqueeze: true,
      squeezeBias: "Bullish Expansion",
    },
    paperSnapshot: {
      balance: 9500,
      equity: 10450,
      openPositionsCount: 1,
      unrealizedPnL: 950,
      winRate: 66.7,
      positions: [
        { symbol: "BTCUSDT", side: "long", size: 0.15, entryPrice: 62000, unrealizedPnl: 337.5, pnlPct: 3.63 },
      ],
    },
  });

  assert.ok(prompt.includes("BTCUSDT"), "System prompt should include active symbol");
  assert.ok(prompt.includes("64,250") || prompt.includes("64250"), "System prompt should include price");
  assert.ok(prompt.includes("RSI(14): 58.4"), "System prompt should include RSI");
  assert.ok(prompt.includes("Bullish Alignment"), "System prompt should detect bullish EMA alignment");
  assert.ok(prompt.includes("ACTIVE SQUEEZE"), "System prompt should detect active squeeze");
  assert.ok(prompt.includes("$9,500") || prompt.includes("9500"), "System prompt should include paper balance");

  // 2. Response parsing with embedded action cards
  const rawResponse = `Based on the 1H bullish momentum and the active Bollinger Band squeeze, here is the recommended trade setup:

<action_card>
{
  "type": "order",
  "symbol": "BTCUSDT",
  "side": "buy",
  "amount": 500,
  "takeProfitPrice": 67000,
  "stopLossPrice": 63200,
  "kellySizePercent": 3.5,
  "reason": "Coiling into volatility expansion with 2.8:1 reward-to-risk ratio"
}
</action_card>

Keep your risk capped at 3.5% of total capital.`;

  const parsed = parseCopilotResponse(rawResponse);
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].type, "order");
  if (parsed.actions[0].type === "order") {
    assert.equal(parsed.actions[0].symbol, "BTCUSDT");
    assert.equal(parsed.actions[0].side, "buy");
    assert.equal(parsed.actions[0].amount, 500);
    assert.equal(parsed.actions[0].takeProfitPrice, 67000);
    assert.equal(parsed.actions[0].stopLossPrice, 63200);
  }
  assert.ok(!parsed.cleanContent.includes("<action_card>"), "Cleaned content should not contain action_card tags");
  assert.ok(parsed.cleanContent.includes("Based on the 1H bullish momentum"), "Cleaned content should preserve conversational text");
  assert.ok(parsed.cleanContent.includes("Keep your risk capped"), "Cleaned content should preserve trailing text");

  // 3. Response parsing with backtest action card
  const backtestResponse = `Let's test this hypothesis over the last 30 days:
<action_card>
{
  "type": "backtest",
  "symbol": "ETHUSDT",
  "interval": "15m",
  "days": 30,
  "strategyPrompt": "Go long when 20 EMA crosses above 50 EMA and RSI < 60",
  "reason": "Verify expectancy before committing capital"
}
</action_card>`;

  const parsedBacktest = parseCopilotResponse(backtestResponse);
  assert.equal(parsedBacktest.actions.length, 1);
  assert.equal(parsedBacktest.actions[0].type, "backtest");
  if (parsedBacktest.actions[0].type === "backtest") {
    assert.equal(parsedBacktest.actions[0].symbol, "ETHUSDT");
    assert.equal(parsedBacktest.actions[0].interval, "15m");
    assert.equal(parsedBacktest.actions[0].days, 30);
  }
});

test("Trade Replay Simulator: execution, bracket triggers, and scorecard calculations", async () => {
  const {
    createInitialReplayWallet,
    executeReplayOrder,
    closeReplayPosition,
    advanceReplayCandle,
    calculateReplayEquity,
    calculateReplayScorecard,
  } = await import("../src/lib/replay-engine.ts");

  // 1. Initial wallet setup
  const wallet0 = createInitialReplayWallet(10000);
  assert.equal(wallet0.cash, 10000);
  assert.equal(wallet0.position, null);
  assert.equal(wallet0.closedTrades.length, 0);

  // 2. Execute buy order with 5% TP and 2.5% SL
  const entryCandle = { time: 1000, open: 60000, high: 60500, low: 59800, close: 60000, volume: 100, turnover: 6000000 };
  const wallet1 = executeReplayOrder(wallet0, entryCandle, "BTCUSDT", "buy", 1000, 5, 2.5);

  assert.equal(wallet1.cash, 9000);
  assert.ok(wallet1.position !== null);
  assert.equal(wallet1.position.side, "buy");
  assert.equal(wallet1.position.entryPrice, 60000);
  assert.equal(wallet1.position.quantity, 1000 / 60000);
  assert.equal(wallet1.position.takeProfitPrice, 63000);
  assert.equal(wallet1.position.stopLossPrice, 58500);

  // 3. Advance candle without trigger (within range 59000 - 62000)
  const bar2 = { time: 2000, open: 60000, high: 62000, low: 59500, close: 61500, volume: 120, turnover: 7200000 };
  const adv1 = advanceReplayCandle(wallet1, bar2);
  assert.equal(adv1.event, undefined);
  assert.ok(adv1.wallet.position !== null);
  const eq1 = calculateReplayEquity(adv1.wallet, 61500);
  assert.ok(eq1 > 10000, `Equity should reflect unrealized profit: ${eq1}`);

  // 4. Advance candle that hits Take-Profit (high = 63500 >= 63000)
  const bar3 = { time: 3000, open: 61500, high: 63500, low: 61000, close: 63200, volume: 200, turnover: 12000000 };
  const adv2 = advanceReplayCandle(adv1.wallet, bar3);
  assert.ok(adv2.event !== undefined);
  assert.equal(adv2.event?.type, "bracket_triggered");
  assert.equal(adv2.event?.reason, "take_profit");
  assert.equal(adv2.wallet.position, null);
  assert.equal(adv2.wallet.closedTrades.length, 1);
  assert.ok(adv2.wallet.closedTrades[0].pnl > 0);
  assert.ok(adv2.wallet.cash > 10000);

  // 5. Short order that triggers Stop-Loss
  const bar4 = { time: 4000, open: 63200, high: 63400, low: 62800, close: 63000, volume: 150, turnover: 9000000 };
  const walletShort = executeReplayOrder(adv2.wallet, bar4, "BTCUSDT", "sell", 1000, 3, 2);
  assert.equal(walletShort.position?.side, "sell");
  assert.equal(walletShort.position?.stopLossPrice, 63000 * 1.02); // 64260

  const bar5 = { time: 5000, open: 63000, high: 64500, low: 62900, close: 64400, volume: 300, turnover: 19000000 };
  const adv3 = advanceReplayCandle(walletShort, bar5);
  assert.ok(adv3.event !== undefined);
  assert.equal(adv3.event?.reason, "stop_loss");
  assert.equal(adv3.wallet.closedTrades.length, 2);

  // 6. Scorecard calculation
  const scorecard = calculateReplayScorecard(adv3.wallet, 64400);
  assert.equal(scorecard.totalTrades, 2);
  assert.equal(scorecard.winningTrades, 1);
  assert.equal(scorecard.losingTrades, 1);
  assert.equal(scorecard.winRate, 50);
  assert.ok(scorecard.profitFactor > 0);
});

test("Quantitative Backtest: validateStrategyDraft resiliently normalizes RSI and EMA bounds", async () => {
  const { validateStrategyDraft } = await import("../src/lib/backtest.ts");

  // 1. Standard RSI strategy
  const stdRsi = validateStrategyDraft({
    supported: true,
    reason: "",
    kind: "rsi_reversion",
    fastPeriod: null,
    slowPeriod: null,
    rsiPeriod: 14,
    entryBelow: 30,
    exitAbove: 70,
    summary: "",
    rationale: "Prompted RSI reversion",
  }, 100);
  assert.equal(stdRsi.kind, "rsi_reversion");
  assert.equal(stdRsi.rsiPeriod, 14);
  assert.equal(stdRsi.entryBelow, 30);
  assert.equal(stdRsi.exitAbove, 70);

  // 2. Out-of-bounds RSI thresholds (like the issue reported: entry 45, exit 85)
  const oobRsi = validateStrategyDraft({
    supported: true,
    reason: "",
    kind: "rsi_reversion",
    fastPeriod: null,
    slowPeriod: null,
    rsiPeriod: 14,
    entryBelow: 45,
    exitAbove: 85,
    summary: "",
    rationale: "High boundary RSI test",
  }, 100);
  assert.equal(oobRsi.kind, "rsi_reversion");
  assert.equal(oobRsi.entryBelow, 45);
  assert.equal(oobRsi.exitAbove, 85);
  assert.ok(oobRsi.supported);

  // 3. Extreme RSI thresholds clamped safely without throwing
  const extremeRsi = validateStrategyDraft({
    supported: true,
    reason: "",
    kind: "rsi_reversion",
    fastPeriod: null,
    slowPeriod: null,
    rsiPeriod: 1, // too low -> clamped to 2
    entryBelow: 3, // too low -> clamped to 5
    exitAbove: 99, // too high -> clamped to 95
    summary: "",
    rationale: "Extreme bounds test",
  }, 100);
  assert.equal(extremeRsi.kind, "rsi_reversion");
  assert.equal(extremeRsi.rsiPeriod, 14);
  assert.equal(extremeRsi.entryBelow, 5);
  assert.equal(extremeRsi.exitAbove, 95);
  assert.ok(extremeRsi.rationale.includes("Thresholds normalized to valid bounds"));

  // 4. Inverted RSI thresholds (exit <= entry) auto-corrected
  const invertedRsi = validateStrategyDraft({
    supported: true,
    reason: "",
    kind: "rsi_reversion",
    fastPeriod: null,
    slowPeriod: null,
    rsiPeriod: 14,
    entryBelow: 40,
    exitAbove: 35,
    summary: "",
    rationale: "Inverted test",
  }, 100);
  assert.ok(invertedRsi.exitAbove > invertedRsi.entryBelow);

  // 5. Out-of-bounds EMA crossover normalized without crashing
  const oobEma = validateStrategyDraft({
    supported: true,
    reason: "",
    kind: "ema_cross",
    fastPeriod: 55,
    slowPeriod: 220,
    rsiPeriod: null,
    entryBelow: null,
    exitAbove: null,
    summary: "",
    rationale: "EMA crossover",
  }, 300);
  assert.equal(oobEma.kind, "ema_cross");
  assert.equal(oobEma.fastPeriod, 55);
  assert.equal(oobEma.slowPeriod, 220);
  assert.ok(oobEma.slowPeriod > oobEma.fastPeriod);

  // 6. Unsupported rule rejects with informative reason
  assert.throws(
    () => validateStrategyDraft({
      supported: false,
      reason: "Shorts with leverage are unsupported.",
      kind: "unsupported",
      fastPeriod: null,
      slowPeriod: null,
      rsiPeriod: null,
      entryBelow: null,
      exitAbove: null,
      summary: "",
      rationale: "",
    }, 100),
    /Shorts with leverage are unsupported/
  );
});





