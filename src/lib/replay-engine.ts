import type { Candle } from "./bitget.ts";
import type { ReplayPosition, ReplayScorecard, ReplayTrade, ReplayWallet } from "../types/replay.ts";

export function createInitialReplayWallet(startingCash = 10000): ReplayWallet {
  return {
    startingCash,
    cash: startingCash,
    position: null,
    realizedPnl: 0,
    closedTrades: [],
  };
}

export function executeReplayOrder(
  wallet: ReplayWallet,
  candle: Candle,
  symbol: string,
  side: "buy" | "sell",
  amountUsd: number,
  tpPct?: number,
  slPct?: number
): ReplayWallet {
  if (amountUsd <= 0 || candle.close <= 0) return wallet;

  let updatedWallet = { ...wallet };

  // If an opposite position exists, close it first
  if (updatedWallet.position && updatedWallet.position.side !== side) {
    updatedWallet = closeReplayPosition(updatedWallet, candle.close, candle.time, "manual");
  }

  const availableCash = updatedWallet.cash;
  const effectiveAmount = Math.min(amountUsd, Math.max(0, availableCash));
  if (effectiveAmount < 5) return updatedWallet; // Minimum order size $5

  const qty = effectiveAmount / candle.close;
  const entryPrice = candle.close;

  let takeProfitPrice: number | undefined;
  let stopLossPrice: number | undefined;

  if (typeof tpPct === "number" && tpPct > 0) {
    takeProfitPrice = side === "buy" ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);
  }
  if (typeof slPct === "number" && slPct > 0) {
    stopLossPrice = side === "buy" ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
  }

  if (updatedWallet.position) {
    const totalQty = updatedWallet.position.quantity + qty;
    const avgPrice = (updatedWallet.position.quantity * updatedWallet.position.entryPrice + effectiveAmount) / totalQty;
    updatedWallet.position = {
      symbol,
      side,
      quantity: totalQty,
      entryPrice: avgPrice,
      entryTime: updatedWallet.position.entryTime,
      takeProfitPrice: takeProfitPrice || updatedWallet.position.takeProfitPrice,
      stopLossPrice: stopLossPrice || updatedWallet.position.stopLossPrice,
    };
    updatedWallet.cash -= effectiveAmount;
  } else {
    updatedWallet.position = {
      symbol,
      side,
      quantity: qty,
      entryPrice,
      entryTime: candle.time,
      takeProfitPrice,
      stopLossPrice,
    };
    updatedWallet.cash -= effectiveAmount;
  }

  return updatedWallet;
}

export function closeReplayPosition(
  wallet: ReplayWallet,
  exitPrice: number,
  exitTime: number,
  exitReason: "manual" | "take_profit" | "stop_loss" = "manual"
): ReplayWallet {
  if (!wallet.position) return wallet;

  const pos = wallet.position;
  const isLong = pos.side === "buy";
  const grossPnl = isLong
    ? (exitPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - exitPrice) * pos.quantity;

  const exitNotional = exitPrice * pos.quantity;
  const fee = exitNotional * 0.0005; // 5 bps simulated taker fee
  const netPnl = grossPnl - fee;
  const costBasis = pos.entryPrice * pos.quantity;
  const pnlPct = costBasis > 0 ? (netPnl / costBasis) * 100 : 0;

  const closedTrade: ReplayTrade = {
    id: "rtrade_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    exitPrice,
    quantity: pos.quantity,
    pnl: netPnl,
    pnlPct,
    entryTime: pos.entryTime,
    exitTime,
    exitReason,
  };

  return {
    ...wallet,
    cash: wallet.cash + costBasis + netPnl,
    realizedPnl: wallet.realizedPnl + netPnl,
    position: null,
    closedTrades: [closedTrade, ...wallet.closedTrades],
  };
}

export function advanceReplayCandle(
  wallet: ReplayWallet,
  candle: Candle
): { wallet: ReplayWallet; event?: { type: "bracket_triggered"; reason: "take_profit" | "stop_loss"; pnl: number } } {
  if (!wallet.position) return { wallet };

  const pos = wallet.position;
  const isLong = pos.side === "buy";

  if (isLong) {
    if (pos.takeProfitPrice && candle.high >= pos.takeProfitPrice) {
      const nextWallet = closeReplayPosition(wallet, pos.takeProfitPrice, candle.time, "take_profit");
      const trade = nextWallet.closedTrades[0];
      return {
        wallet: nextWallet,
        event: { type: "bracket_triggered", reason: "take_profit", pnl: trade ? trade.pnl : 0 },
      };
    }
    if (pos.stopLossPrice && candle.low <= pos.stopLossPrice) {
      const nextWallet = closeReplayPosition(wallet, pos.stopLossPrice, candle.time, "stop_loss");
      const trade = nextWallet.closedTrades[0];
      return {
        wallet: nextWallet,
        event: { type: "bracket_triggered", reason: "stop_loss", pnl: trade ? trade.pnl : 0 },
      };
    }
  } else {
    // Short
    if (pos.takeProfitPrice && candle.low <= pos.takeProfitPrice) {
      const nextWallet = closeReplayPosition(wallet, pos.takeProfitPrice, candle.time, "take_profit");
      const trade = nextWallet.closedTrades[0];
      return {
        wallet: nextWallet,
        event: { type: "bracket_triggered", reason: "take_profit", pnl: trade ? trade.pnl : 0 },
      };
    }
    if (pos.stopLossPrice && candle.high >= pos.stopLossPrice) {
      const nextWallet = closeReplayPosition(wallet, pos.stopLossPrice, candle.time, "stop_loss");
      const trade = nextWallet.closedTrades[0];
      return {
        wallet: nextWallet,
        event: { type: "bracket_triggered", reason: "stop_loss", pnl: trade ? trade.pnl : 0 },
      };
    }
  }

  return { wallet };
}

export function calculateReplayEquity(wallet: ReplayWallet, currentPrice: number): number {
  if (!wallet.position) return wallet.cash;
  const pos = wallet.position;
  const isLong = pos.side === "buy";
  const unrealized = isLong
    ? (currentPrice - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - currentPrice) * pos.quantity;
  return wallet.cash + pos.entryPrice * pos.quantity + unrealized;
}

export function calculateReplayScorecard(wallet: ReplayWallet, currentPrice: number): ReplayScorecard {
  const totalTrades = wallet.closedTrades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let bestTradePnl = 0;
  let worstTradePnl = 0;

  wallet.closedTrades.forEach((t) => {
    if (t.pnl > 0) {
      winningTrades++;
      grossWins += t.pnl;
      if (t.pnl > bestTradePnl) bestTradePnl = t.pnl;
    } else if (t.pnl < 0) {
      losingTrades++;
      grossLosses += Math.abs(t.pnl);
      if (t.pnl < worstTradePnl) worstTradePnl = t.pnl;
    }
  });

  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : 0;
  const endingEquity = calculateReplayEquity(wallet, currentPrice);
  const netPnl = endingEquity - wallet.startingCash;
  const returnPct = wallet.startingCash > 0 ? (netPnl / wallet.startingCash) * 100 : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    netPnl,
    returnPct,
    bestTradePnl,
    worstTradePnl,
    startingCapital: wallet.startingCash,
    endingEquity,
  };
}
