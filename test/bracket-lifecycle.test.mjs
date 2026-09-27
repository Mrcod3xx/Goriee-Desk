import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulator of the Goriee bracket evaluation engine from trading-desk.tsx
 */
function evaluatePaperBrackets({
  openPositions,
  quotes,
  brackets,
  now = Date.now(),
  staleThresholdMs = 120_000,
}) {
  const triggered = [];
  const updatedBrackets = { ...brackets };

  for (const pos of openPositions) {
    const bracket = updatedBrackets[pos.symbol];
    if (!bracket) continue;

    const quote = quotes.find((q) => q.symbol === pos.symbol);
    if (!quote || !(quote.price > 0)) continue;

    // Stale quote guard (exact invariant from trading-desk.tsx)
    const quoteAge = quote.asOf ? now - quote.asOf : Infinity;
    if (quoteAge > staleThresholdMs) {
      continue; // Paused due to stale quote
    }

    // Take-Profit check
    if (bracket.takeProfitPrice && quote.price >= bracket.takeProfitPrice) {
      triggered.push({
        symbol: pos.symbol,
        reason: "take_profit",
        price: quote.price,
        target: bracket.takeProfitPrice,
      });
      delete updatedBrackets[pos.symbol];
      continue;
    }

    // Stop-Loss check
    if (bracket.stopLossPrice && quote.price <= bracket.stopLossPrice) {
      triggered.push({
        symbol: pos.symbol,
        reason: "stop_loss",
        price: quote.price,
        target: bracket.stopLossPrice,
      });
      delete updatedBrackets[pos.symbol];
      continue;
    }

    // Trailing Stop check
    if (bracket.trailingStopPct && bracket.trailingStopPct > 0) {
      const peak = Math.max(bracket.peakPrice || pos.averageEntry, quote.price);
      const trailThreshold = peak * (1 - bracket.trailingStopPct / 100);
      if (quote.price <= trailThreshold) {
        triggered.push({
          symbol: pos.symbol,
          reason: "trailing_stop",
          price: quote.price,
          peak,
          threshold: trailThreshold,
        });
        delete updatedBrackets[pos.symbol];
      } else if (peak > (bracket.peakPrice || 0)) {
        updatedBrackets[pos.symbol] = { ...bracket, peakPrice: peak };
      }
    }
  }

  return { triggered, updatedBrackets };
}

/**
 * Pure simulator of manual order placement bracket lifecycle from trading-desk.tsx
 */
function simulateOrderBracketLifecycle({
  orderSide,
  symbol,
  quantity,
  heldQuantity,
  attachBracket,
  bracketConfig,
  currentBrackets,
  marketPrice,
  now = Date.now(),
}) {
  const nextBrackets = { ...currentBrackets };

  if (orderSide === "sell") {
    // If selling all held quantity (or within floating precision)
    if (quantity >= heldQuantity - 1e-8) {
      delete nextBrackets[symbol];
    }
  } else if (orderSide === "buy") {
    if (attachBracket && bracketConfig) {
      nextBrackets[symbol] = {
        symbol,
        takeProfitPrice: bracketConfig.tpPrice,
        stopLossPrice: bracketConfig.slPrice,
        trailingStopPct: bracketConfig.trailingStopPct,
        peakPrice: marketPrice,
        createdAt: now,
      };
    } else {
      // Unbracketed buy: purge preexisting orphan brackets
      delete nextBrackets[symbol];
    }
  }

  return nextBrackets;
}

test("Bracket Lifecycle: triggers take-profit when quote is fresh (<= 120s)", () => {
  const now = 1_700_000_000_000;
  const positions = [{ symbol: "BTCUSDT", quantity: 0.1, averageEntry: 100_000, entryFees: 1 }];
  const brackets = {
    BTCUSDT: { symbol: "BTCUSDT", takeProfitPrice: 105_000, stopLossPrice: 95_000, createdAt: now - 30_000 },
  };
  const quotes = [
    { symbol: "BTCUSDT", price: 105_500, change24h: 5.5, asOf: now - 15_000 }, // 15s old -> fresh
  ];

  const result = evaluatePaperBrackets({ openPositions: positions, quotes, brackets, now });
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0].reason, "take_profit");
  assert.equal(result.triggered[0].price, 105_500);
  assert.equal(result.updatedBrackets.BTCUSDT, undefined, "Bracket must be pruned upon trigger");
});

test("Bracket Lifecycle: PAUSES execution when quote is stale (> 120s)", () => {
  const now = 1_700_000_000_000;
  const positions = [{ symbol: "BTCUSDT", quantity: 0.1, averageEntry: 100_000, entryFees: 1 }];
  const brackets = {
    BTCUSDT: { symbol: "BTCUSDT", takeProfitPrice: 105_000, stopLossPrice: 95_000, createdAt: now - 300_000 },
  };
  // Quote price has reached Take-Profit, BUT the quote was fetched 150 seconds ago (>120s limit)
  const quotes = [
    { symbol: "BTCUSDT", price: 106_000, change24h: 6.0, asOf: now - 150_000 },
  ];

  const result = evaluatePaperBrackets({ openPositions: positions, quotes, brackets, now });
  assert.equal(result.triggered.length, 0, "Stale quote must not trigger order closure");
  assert.ok(result.updatedBrackets.BTCUSDT, "Bracket must remain intact while paused");
});

test("Bracket Lifecycle: PAUSES execution when quote asOf is missing", () => {
  const now = 1_700_000_000_000;
  const positions = [{ symbol: "BTCUSDT", quantity: 0.1, averageEntry: 100_000, entryFees: 1 }];
  const brackets = {
    BTCUSDT: { symbol: "BTCUSDT", stopLossPrice: 95_000, createdAt: now - 60_000 },
  };
  const quotes = [
    { symbol: "BTCUSDT", price: 94_000, change24h: -6.0 }, // No asOf timestamp
  ];

  const result = evaluatePaperBrackets({ openPositions: positions, quotes, brackets, now });
  assert.equal(result.triggered.length, 0, "Missing asOf timestamp must not trigger order closure");
});

test("Bracket Lifecycle: trailing stop updates peak on rise and triggers on drop (fresh quote)", () => {
  const now = 1_700_000_000_000;
  const positions = [{ symbol: "ETHUSDT", quantity: 2, averageEntry: 3_000, entryFees: 0.6 }];
  let brackets = {
    ETHUSDT: { symbol: "ETHUSDT", trailingStopPct: 5, peakPrice: 3_000, createdAt: now - 60_000 },
  };

  // Price rises to 3,500 (peak should update, no trigger)
  let quotes = [{ symbol: "ETHUSDT", price: 3_500, change24h: 16.6, asOf: now - 10_000 }];
  let result = evaluatePaperBrackets({ openPositions: positions, quotes, brackets, now });
  assert.equal(result.triggered.length, 0);
  assert.equal(result.updatedBrackets.ETHUSDT.peakPrice, 3_500);

  // Price drops to 3,300 (threshold is 3,500 * 0.95 = 3,325; 3,300 <= 3,325 triggers exit)
  brackets = result.updatedBrackets;
  quotes = [{ symbol: "ETHUSDT", price: 3_300, change24h: 10.0, asOf: now - 5_000 }];
  result = evaluatePaperBrackets({ openPositions: positions, quotes, brackets, now });
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0].reason, "trailing_stop");
  assert.equal(result.updatedBrackets.ETHUSDT, undefined);
});

test("Bracket Lifecycle: full manual sell purges bracket", () => {
  const existingBrackets = {
    BTCUSDT: { symbol: "BTCUSDT", takeProfitPrice: 105_000, stopLossPrice: 95_000, createdAt: 1000 },
  };

  // Full sell of 0.5 BTC
  const afterFullSell = simulateOrderBracketLifecycle({
    orderSide: "sell",
    symbol: "BTCUSDT",
    quantity: 0.5,
    heldQuantity: 0.5,
    attachBracket: false,
    currentBrackets: existingBrackets,
    marketPrice: 100_000,
  });
  assert.equal(afterFullSell.BTCUSDT, undefined, "Full sell must remove active bracket");

  // Partial sell of 0.2 BTC out of 0.5 BTC retains bracket
  const afterPartialSell = simulateOrderBracketLifecycle({
    orderSide: "sell",
    symbol: "BTCUSDT",
    quantity: 0.2,
    heldQuantity: 0.5,
    attachBracket: false,
    currentBrackets: existingBrackets,
    marketPrice: 100_000,
  });
  assert.ok(afterPartialSell.BTCUSDT, "Partial sell must keep bracket active");
});

test("Bracket Lifecycle: unbracketed new buy purges preexisting orphan bracket", () => {
  // Stale orphan bracket left over from old activity
  const existingBrackets = {
    SOLUSDT: { symbol: "SOLUSDT", takeProfitPrice: 250, stopLossPrice: 180, createdAt: 500 },
  };

  // User buys SOL without attaching a bracket
  const afterBuy = simulateOrderBracketLifecycle({
    orderSide: "buy",
    symbol: "SOLUSDT",
    quantity: 10,
    heldQuantity: 0,
    attachBracket: false,
    currentBrackets: existingBrackets,
    marketPrice: 200,
  });
  assert.equal(afterBuy.SOLUSDT, undefined, "Unbracketed new buy must clear stale orphan bracket");
});
