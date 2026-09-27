/**
 * Portfolio Analytics: Pure computation functions for paper trade performance analysis.
 * All functions are stateless and deterministic.
 */

export type ClosedTradeInput = {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: number;
  closedAt: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  netPnl: number;
  returnPct: number;
};

export type EquitySnapshot = {
  time: number;
  equity: number;
  tradeId: string;
  symbol: string;
  pnl: number;
};

export type DrawdownPoint = {
  time: number;
  peak: number;
  equity: number;
  drawdown: number;
  drawdownPct: number;
};

export type DailyPnl = {
  date: string; // YYYY-MM-DD
  pnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
};

export type RollingWinRate = {
  tradeIndex: number;
  winRate: number;
  time: number;
};

export type PortfolioMetrics = {
  totalReturn: number;
  totalReturnPct: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDuration: number; // milliseconds
  calmarRatio: number | null;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  payoffRatio: number | null;
  expectancy: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  avgHoldingPeriod: number; // milliseconds
  bestTrade: ClosedTradeInput | null;
  worstTrade: ClosedTradeInput | null;
  longestWinStreak: number;
  longestLoseStreak: number;
  currentStreak: { type: "win" | "loss" | "none"; length: number };
};

/**
 * Build a chronological equity curve from closed trades.
 */
export function buildEquityCurve(trades: ClosedTradeInput[], startingCapital: number): EquitySnapshot[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  let equity = startingCapital;
  return sorted.map((trade) => {
    equity += trade.netPnl;
    return {
      time: trade.closedAt,
      equity,
      tradeId: trade.id,
      symbol: trade.symbol,
      pnl: trade.netPnl,
    };
  });
}

/**
 * Compute drawdown series from equity curve.
 */
export function buildDrawdownSeries(equityCurve: EquitySnapshot[]): DrawdownPoint[] {
  let peak = equityCurve.length > 0 ? equityCurve[0].equity : 0;
  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = point.equity - peak;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    return {
      time: point.time,
      peak,
      equity: point.equity,
      drawdown,
      drawdownPct,
    };
  });
}

/**
 * Aggregate daily P&L for the calendar heatmap.
 */
export function buildDailyPnl(trades: ClosedTradeInput[]): DailyPnl[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const dailyMap = new Map<string, DailyPnl>();

  sorted.forEach((trade) => {
    const date = new Date(trade.closedAt).toISOString().slice(0, 10);
    const existing = dailyMap.get(date) ?? { date, pnl: 0, tradeCount: 0, wins: 0, losses: 0 };
    existing.pnl += trade.netPnl;
    existing.tradeCount += 1;
    if (trade.netPnl > 0) existing.wins += 1;
    else if (trade.netPnl < 0) existing.losses += 1;
    dailyMap.set(date, existing);
  });

  return [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculate rolling win rate over a sliding window.
 */
export function buildRollingWinRate(trades: ClosedTradeInput[], window: number = 10): RollingWinRate[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  if (sorted.length < window) return [];

  const results: RollingWinRate[] = [];
  for (let i = window - 1; i < sorted.length; i++) {
    const slice = sorted.slice(i - window + 1, i + 1);
    const wins = slice.filter((t) => t.netPnl > 0).length;
    results.push({
      tradeIndex: i,
      winRate: (wins / window) * 100,
      time: sorted[i].closedAt,
    });
  }
  return results;
}

/**
 * Calculate asset allocation from open positions.
 */
export function buildAssetAllocation(
  positions: Array<{ symbol: string; quantity: number; averageEntry: number }>,
  quotes: Array<{ symbol: string; price: number }>,
): Array<{ symbol: string; value: number; pct: number; color: string }> {
  const COLORS = [
    "#0c9a6b", "#2d8659", "#4a7c6b", "#087b56", "#1a6b4a",
    "#5b9e7d", "#3d8b6e", "#6aab88", "#2a7d5a", "#48a87a",
  ];

  const items = positions
    .map((pos) => {
      const quote = quotes.find((q) => q.symbol === pos.symbol);
      const price = quote?.price ?? pos.averageEntry;
      return { symbol: pos.symbol, value: pos.quantity * price };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item, idx) => ({
    symbol: item.symbol,
    value: item.value,
    pct: total > 0 ? (item.value / total) * 100 : 0,
    color: COLORS[idx % COLORS.length],
  }));
}

/**
 * Compute full portfolio metrics from trade history.
 */
export function computePortfolioMetrics(
  trades: ClosedTradeInput[],
  startingCapital: number,
): PortfolioMetrics {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const totalTrades = sorted.length;

  if (totalTrades === 0) {
    return {
      totalReturn: 0, totalReturnPct: 0,
      sharpeRatio: null, sortinoRatio: null,
      maxDrawdown: 0, maxDrawdownPct: 0, maxDrawdownDuration: 0,
      calmarRatio: null,
      winRate: 0, avgWin: 0, avgLoss: 0,
      profitFactor: null, payoffRatio: null, expectancy: 0,
      totalTrades: 0, totalWins: 0, totalLosses: 0,
      avgHoldingPeriod: 0,
      bestTrade: null, worstTrade: null,
      longestWinStreak: 0, longestLoseStreak: 0,
      currentStreak: { type: "none", length: 0 },
    };
  }

  const winners = sorted.filter((t) => t.netPnl > 0);
  const losers = sorted.filter((t) => t.netPnl < 0);
  const totalReturn = sorted.reduce((sum, t) => sum + t.netPnl, 0);
  const totalReturnPct = startingCapital > 0 ? (totalReturn / startingCapital) * 100 : 0;

  const grossWins = winners.reduce((sum, t) => sum + t.netPnl, 0);
  const grossLosses = Math.abs(losers.reduce((sum, t) => sum + t.netPnl, 0));
  const avgWin = winners.length > 0 ? grossWins / winners.length : 0;
  const avgLoss = losers.length > 0 ? -grossLosses / losers.length : 0;
  const winRate = (winners.length / totalTrades) * 100;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;
  const payoffRatio = grossLosses > 0 && losers.length > 0 && winners.length > 0
    ? avgWin / Math.abs(avgLoss) : null;
  const expectancy = totalReturn / totalTrades;

  // Sharpe & Sortino (annualized, using trade returns)
  const returns = sorted.map((t) => t.returnPct / 100);
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);

  // Approximate annualization: use avg trades per year based on actual span
  const spanMs = sorted.length > 1 ? sorted[sorted.length - 1].closedAt - sorted[0].closedAt : 0;
  const spanDays = spanMs / (24 * 60 * 60 * 1000) || 1;
  const tradesPerYear = (sorted.length / spanDays) * 365;
  const annFactor = Math.sqrt(tradesPerYear);

  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * annFactor : null;
  const sortinoRatio = downsideDev > 0 ? (meanReturn / downsideDev) * annFactor : null;

  // Max drawdown
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  let ddStart = 0;
  let maxDDDuration = 0;
  let currentDDStart = 0;

  sorted.forEach((trade) => {
    equity += trade.netPnl;
    if (equity > peak) {
      if (currentDDStart > 0) {
        maxDDDuration = Math.max(maxDDDuration, trade.closedAt - currentDDStart);
      }
      peak = equity;
      currentDDStart = 0;
    } else if (currentDDStart === 0 && equity < peak) {
      currentDDStart = trade.closedAt;
    }
    const dd = equity - peak;
    if (dd < maxDD) {
      maxDD = dd;
      maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  });

  const calmarRatio = maxDDPct < 0 ? totalReturnPct / Math.abs(maxDDPct) : null;

  // Best/worst trade
  const bestTrade = sorted.reduce<ClosedTradeInput | null>(
    (best, t) => (!best || t.netPnl > best.netPnl ? t : best), null,
  );
  const worstTrade = sorted.reduce<ClosedTradeInput | null>(
    (worst, t) => (!worst || t.netPnl < worst.netPnl ? t : worst), null,
  );

  // Streaks
  let longestWinStreak = 0;
  let longestLoseStreak = 0;
  let currentWinStreak = 0;
  let currentLoseStreak = 0;
  sorted.forEach((trade) => {
    if (trade.netPnl > 0) {
      currentWinStreak++;
      currentLoseStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    } else if (trade.netPnl < 0) {
      currentLoseStreak++;
      currentWinStreak = 0;
      longestLoseStreak = Math.max(longestLoseStreak, currentLoseStreak);
    }
  });

  const lastTrade = sorted[sorted.length - 1];
  const currentStreak: PortfolioMetrics["currentStreak"] = lastTrade
    ? lastTrade.netPnl > 0
      ? { type: "win", length: currentWinStreak }
      : lastTrade.netPnl < 0
        ? { type: "loss", length: currentLoseStreak }
        : { type: "none", length: 0 }
    : { type: "none", length: 0 };

  // Average holding period
  const avgHoldingPeriod = sorted.reduce((sum, t) => sum + (t.closedAt - t.openedAt), 0) / totalTrades;

  return {
    totalReturn, totalReturnPct,
    sharpeRatio, sortinoRatio,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, maxDrawdownDuration: maxDDDuration,
    calmarRatio,
    winRate, avgWin, avgLoss,
    profitFactor, payoffRatio, expectancy,
    totalTrades, totalWins: winners.length, totalLosses: losers.length,
    avgHoldingPeriod,
    bestTrade, worstTrade,
    longestWinStreak, longestLoseStreak,
    currentStreak,
  };
}
