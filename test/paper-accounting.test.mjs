import test from "node:test";
import assert from "node:assert/strict";
import { paperFillFee, paperCash } from "../src/lib/paper-accounting.ts";

test("Paper Accounting: paperFillFee computes fee correctly from basis points", () => {
  // $10,000 notional at 10 bps (0.10%) = $10.00
  const fillWithExplicitFee = { symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 100_000, feeBps: 10 };
  assert.equal(paperFillFee(fillWithExplicitFee, 5), 10);

  // Fallback to assumed fee bps when fill feeBps is undefined
  const fillWithoutFee = { symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 100_000 };
  assert.equal(paperFillFee(fillWithoutFee, 10), 10);

  // Zero bps fee
  assert.equal(paperFillFee({ ...fillWithExplicitFee, feeBps: 0 }, 10), 0);
});

test("Paper Accounting: paperCash deducts fees on both buys and sells", () => {
  const initialCash = 10_000;
  const fills = [
    // Buy 0.05 BTC at $100,000 = $5,000 notional + $5 fee (10 bps) -> Cash = 10000 - 5005 = 4995
    { symbol: "BTCUSDT", side: "buy", quantity: 0.05, price: 100_000, feeBps: 10 },
    // Sell 0.02 BTC at $110,000 = $2,200 notional - $2.20 fee (10 bps) -> Cash = 4995 + 2197.80 = 7192.80
    { symbol: "BTCUSDT", side: "sell", quantity: 0.02, price: 110_000, feeBps: 10 },
  ];

  const cash = paperCash(fills, 10, initialCash);
  assert.equal(Number(cash.toFixed(2)), 7192.80);
});

test("Paper Accounting: partial sell allocates entry fees proportionally", () => {
  // Buy 1: 0.05 BTC at $100,000 -> Notional $5,000, Entry fee $5
  // Buy 2: 0.05 BTC at $120,000 -> Notional $6,000, Entry fee $6
  // Total: 0.10 BTC, Average Entry $110,000, Total Entry Fees $11.00
  let position = {
    symbol: "BTCUSDT",
    quantity: 0.10,
    costBasis: 11_000,
    entryFees: 11.00,
  };

  // Sell 0.04 BTC (40% of position)
  const soldQuantity = 0.04;
  const averageEntry = position.costBasis / position.quantity; // 110,000
  const allocatedEntryFees = position.entryFees * (soldQuantity / position.quantity); // $4.40
  position.entryFees -= allocatedEntryFees; // Remaining entry fees: $6.60
  position.quantity -= soldQuantity; // Remaining quantity: 0.06 BTC
  position.costBasis -= averageEntry * soldQuantity; // Remaining basis: $6,600

  assert.equal(Number(position.quantity.toFixed(6)), 0.06);
  assert.equal(position.costBasis, 6600);
  assert.equal(Number(position.entryFees.toFixed(2)), 6.60);
});

test("Paper Accounting: fundamental equity equality invariant holds", () => {
  // Invariant:
  // Equity = Cash + (Mark Price - Avg Entry) * Quantity - Open Entry Fees
  // Realized Net P&L + Unrealized Net P&L == Equity - Starting Cash
  const startingCash = 10_000;
  const feeBps = 10;

  // Trade 1: Buy 0.10 BTC at $100,000 ($10,000 notional, $10 fee)
  // Cash remaining = 10000 - 10000 - 10 = -$10 (using $10k capital + $10 fee)
  const fills = [
    { symbol: "BTCUSDT", side: "buy", quantity: 0.10, price: 100_000, feeBps, createdAt: 1000 },
  ];
  let cash = paperCash(fills, feeBps, startingCash);
  assert.equal(cash, -10);

  // Trade 2: Sell 0.04 BTC at $110,000 ($4,400 notional, $4.40 fee)
  fills.push({ symbol: "BTCUSDT", side: "sell", quantity: 0.04, price: 110_000, feeBps, createdAt: 2000 });
  cash = paperCash(fills, feeBps, startingCash);
  // Cash = -10 + 4400 - 4.40 = 4385.60
  assert.equal(Number(cash.toFixed(2)), 4385.60);

  // Position state:
  // Quantity held: 0.06 BTC
  // Average Entry: $100,000
  // Open Entry Fees: $10 * (0.06 / 0.10) = $6.00
  const heldQuantity = 0.06;
  const avgEntry = 100_000;
  const openEntryFees = 6.00;

  // Realized P&L on the 0.04 BTC sold:
  // Gross Realized = (110,000 - 100,000) * 0.04 = $400.00
  // Entry fees on sold = $4.00
  // Exit fee = 4400 * 0.001 = $4.40
  // Realized Net = 400 - 4 - 4.40 = $391.60
  const realizedNet = 400 - 4.00 - 4.40;

  // Current market price: $105,000
  const markPrice = 105_000;
  // Unrealized Net = (105,000 - 100,000) * 0.06 - 6.00 = 300 - 6 = $294.00
  const unrealizedGross = (markPrice - avgEntry) * heldQuantity;
  const unrealizedNet = unrealizedGross - openEntryFees;

  // Mark-to-market Equity:
  // Equity = Cash + (markPrice * heldQuantity) - openEntryFees - estimatedExitFee
  // Or in Goriee desk model:
  // Equity = Cash + (Held Quantity * Mark Price)
  const equity = cash + (heldQuantity * markPrice);

  // Check equality: Realized Net + Unrealized Net == Equity - Starting Cash
  const totalNetPnl = realizedNet + unrealizedNet;
  const equityDelta = equity - startingCash;

  assert.equal(Number(totalNetPnl.toFixed(2)), Number(equityDelta.toFixed(2)));
});
