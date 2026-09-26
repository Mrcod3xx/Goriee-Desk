import test from "node:test";
import assert from "node:assert/strict";

// Test OrderBook logic
function parseOrderBook(symbol, rawBids = [], rawAsks = []) {
  const bidsParsed = rawBids
    .map(([p, s]) => ({ price: Number(p), size: Number(s) }))
    .filter((b) => Number.isFinite(b.price) && b.price > 0 && Number.isFinite(b.size) && b.size > 0)
    .sort((a, b) => b.price - a.price);

  const asksParsed = rawAsks
    .map(([p, s]) => ({ price: Number(p), size: Number(s) }))
    .filter((a) => Number.isFinite(a.price) && a.price > 0 && Number.isFinite(a.size) && a.size > 0)
    .sort((a, b) => a.price - b.price);

  let cumBid = 0;
  const bids = bidsParsed.map((b) => {
    cumBid += b.size;
    return { ...b, total: cumBid };
  });

  let cumAsk = 0;
  const asks = asksParsed.map((a) => {
    cumAsk += a.size;
    return { ...a, total: cumAsk };
  });

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? Math.max(0, bestAsk - bestBid) : 0;
  const midpoint = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestBid || bestAsk;
  const spreadBps = midpoint > 0 ? (spread / midpoint) * 10000 : 0;
  const totalBidVol = cumBid;
  const totalAskVol = cumAsk;
  const totalBookVol = totalBidVol + totalAskVol;
  const imbalancePct = totalBookVol > 0 ? ((totalBidVol - totalAskVol) / totalBookVol) * 100 : 0;

  return { symbol, bids, asks, bestBid, bestAsk, spread, spreadBps, midpoint, imbalancePct, totalBidVol, totalAskVol };
}

test("OrderBook: calculates spread, midpoint, cumulative depth, and imbalance correctly", () => {
  const rawBids = [[100, 2], [99, 3], [98, 5]];
  const rawAsks = [[101, 1], [102, 4], [103, 5]];
  const ob = parseOrderBook("BTCUSDT", rawBids, rawAsks);

  assert.equal(ob.bestBid, 100);
  assert.equal(ob.bestAsk, 101);
  assert.equal(ob.spread, 1);
  assert.equal(ob.midpoint, 100.5);
  assert.ok(Math.abs(ob.spreadBps - (1 / 100.5) * 10000) < 0.001);
  assert.equal(ob.totalBidVol, 10);
  assert.equal(ob.totalAskVol, 10);
  assert.equal(ob.imbalancePct, 0); // Balanced

  // Asymmetric test
  const heavyBids = [[100, 30]];
  const lightAsks = [[101, 10]];
  const obAsym = parseOrderBook("BTCUSDT", heavyBids, lightAsks);
  assert.equal(obAsym.imbalancePct, 50); // (30 - 10) / 40 * 100 = 50% buy pressure
});

// Test Monte Carlo simulation logic
function runMonteCarlo(trades, startingBalance = 10000, simulationsCount = 500) {
  if (trades.length === 0) {
    return { simulationsCount: 0, medianReturnPct: 0, probRuinPct: 0 };
  }
  const returns = trades.map((t) => t.returnPct);
  const finalReturns = [];
  const maxDrawdowns = [];

  for (let s = 0; s < simulationsCount; s++) {
    let balance = startingBalance;
    let peak = startingBalance;
    let maxDd = 0;
    for (let i = 0; i < returns.length; i++) {
      const pick = returns[Math.floor(Math.random() * returns.length)];
      balance = Math.max(1, balance * (1 + pick / 100));
      if (balance > peak) peak = balance;
      const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
    }
    finalReturns.push(((balance - startingBalance) / startingBalance) * 100);
    maxDrawdowns.push(maxDd);
  }
  finalReturns.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const p5 = finalReturns[Math.floor(0.05 * finalReturns.length)];
  const p50 = finalReturns[Math.floor(0.5 * finalReturns.length)];
  const p95 = finalReturns[Math.floor(0.95 * finalReturns.length)];
  const ruinCount = maxDrawdowns.filter((d) => d >= 50).length;
  const probRuin = (ruinCount / simulationsCount) * 100;

  return { simulationsCount, p5, p50, p95, probRuin };
}

test("Monte Carlo: simulates 500 iterations, bounds percentiles, and detects risk", () => {
  const profitableTrades = [
    { returnPct: 2.5 },
    { returnPct: -1.0 },
    { returnPct: 3.2 },
    { returnPct: 1.8 },
    { returnPct: -0.8 },
    { returnPct: 4.1 },
    { returnPct: -1.2 },
    { returnPct: 2.0 },
  ];
  const mc = runMonteCarlo(profitableTrades, 10000, 500);
  assert.equal(mc.simulationsCount, 500);
  assert.ok(mc.p50 > 0, "Median return should be positive for profitable trade set");
  assert.ok(mc.p95 >= mc.p50, "95th percentile should be >= 50th percentile");
  assert.ok(mc.p50 >= mc.p5, "50th percentile should be >= 5th percentile");
  assert.equal(mc.probRuin, 0, "Consistent small gains should have 0% ruin probability");
});

test("Bracket Orders: evaluates Take-Profit, Stop-Loss, and Trailing Stop triggers", () => {
  function checkBracketTriggers({ currentPrice, entryPrice, takeProfitPrice, stopLossPrice, trailingStopPct, peakPrice }) {
    if (takeProfitPrice && currentPrice >= takeProfitPrice) {
      return { triggered: true, reason: "tp", fillPrice: takeProfitPrice };
    }
    if (stopLossPrice && currentPrice <= stopLossPrice) {
      return { triggered: true, reason: "sl", fillPrice: stopLossPrice };
    }
    if (trailingStopPct && peakPrice) {
      const trailStop = peakPrice * (1 - trailingStopPct / 100);
      if (currentPrice <= trailStop) {
        return { triggered: true, reason: "trailing_stop", fillPrice: currentPrice, trailStop };
      }
    }
    return { triggered: false };
  }

  // TP trigger test
  const tpResult = checkBracketTriggers({
    currentPrice: 86000,
    entryPrice: 84000,
    takeProfitPrice: 85500,
    stopLossPrice: 83000,
  });
  assert.equal(tpResult.triggered, true);
  assert.equal(tpResult.reason, "tp");

  // SL trigger test
  const slResult = checkBracketTriggers({
    currentPrice: 82500,
    entryPrice: 84000,
    takeProfitPrice: 85500,
    stopLossPrice: 83000,
  });
  assert.equal(slResult.triggered, true);
  assert.equal(slResult.reason, "sl");

  // Trailing stop trigger test: Entry 84000, peaked at 90000, trailing stop 5% => trigger at 85500
  const trailResult = checkBracketTriggers({
    currentPrice: 85400,
    entryPrice: 84000,
    trailingStopPct: 5,
    peakPrice: 90000,
  });
  assert.equal(trailResult.triggered, true);
  assert.equal(trailResult.reason, "trailing_stop");
});
