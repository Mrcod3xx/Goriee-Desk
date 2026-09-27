import { ema, type Candle } from "./bitget.ts";

export type StrategyPlan =
  | {
      supported: true;
      kind: "ema_cross";
      fastPeriod: number;
      slowPeriod: number;
      summary: string;
      rationale: string;
    }
  | {
      supported: true;
      kind: "rsi_reversion";
      rsiPeriod: number;
      entryBelow: number;
      exitAbove: number;
      summary: string;
      rationale: string;
    };

export type StrategyDraft = {
  supported: boolean;
  reason?: string;
  kind?: string;
  fastPeriod?: number;
  slowPeriod?: number;
  rsiPeriod?: number;
  entryBelow?: number;
  exitAbove?: number;
  summary?: string;
  rationale?: string;
};

export type CompletedTrade = {
  entryAt: number;
  exitAt: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
  barsHeld: number;
  /**
   * Why the simulation left the market. The rule engine has no bracket orders,
   * so the only honest answers are "the exit rule fired" or "the tape ended
   * while the position was still open". Never reported as a take-profit/stop.
   */
  exitReason?: "signal" | "end_of_data";
};

export type BacktestCosts = {
  feeBps: number;
  spreadBps: number;
  slippageBps: number;
};

export type BacktestPeriodSummary = {
  returnPct: number;
  buyAndHoldPct: number;
  maxDrawdownPct: number;
  closedTrades: number;
  barsTested: number;
};

export type BacktestRobustness = {
  alphaPct: number;
  outOfSampleDecayPct: number | null;
  breakevenFeeBps: number | null;
  maxDrawdownDurationBars: number;
  isStatisticallyFragile: boolean;
  robustnessRating: "high" | "moderate" | "fragile";
};

export type BacktestResult = {
  symbol: string;
  interval: string;
  strategy: StrategyPlan;
  startAt: number;
  endAt: number;
  startingBalance: number;
  endingBalance: number;
  returnPct: number;
  buyAndHoldPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  tradeCount: number;
  closedTrades: number;
  winRatePct: number;
  feePctPerFill: number;
  spreadBps: number;
  slippageBps: number;
  barsTested: number;
  equity: Array<{ time: number; value: number; benchmarkValue: number }>;
  trades: CompletedTrade[];
  candles?: Candle[];
  validation: {
    splitAt: number;
    inSample: BacktestPeriodSummary;
    outOfSample: BacktestPeriodSummary;
  } | null;
  robustness: BacktestRobustness;
};

function rsiSeries(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return result;
  for (let index = period; index < values.length; index += 1) {
    let gains = 0;
    let losses = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const change = values[cursor] - values[cursor - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const averageGain = gains / period;
    const averageLoss = losses / period;
    result[index] = averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

export function validateStrategyDraft(draft: StrategyDraft, bars: number): StrategyPlan {
  const cleanText = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;

  if (!draft.supported) {
    throw new Error(cleanText(draft.reason, "Describe an EMA crossover or an RSI mean-reversion rule."));
  }

  if (draft.kind === "ema_cross") {
    const rawFast = Math.round(Number(draft.fastPeriod));
    const rawSlow = Math.round(Number(draft.slowPeriod));

    let fastPeriod = Number.isFinite(rawFast) && rawFast >= 2
      ? Math.max(2, Math.min(100, rawFast))
      : 20;

    let slowPeriod = Number.isFinite(rawSlow) && rawSlow > fastPeriod
      ? Math.max(fastPeriod + 1, Math.min(Math.min(300, bars - 3), rawSlow))
      : Math.min(Math.min(300, bars - 3), Math.max(fastPeriod + 1, 50));

    if (slowPeriod <= fastPeriod) {
      slowPeriod = Math.min(bars - 3, fastPeriod + 5);
      if (slowPeriod <= fastPeriod) {
        fastPeriod = Math.max(2, slowPeriod - 1);
      }
    }

    const wasAdjusted = (Number.isFinite(rawFast) && fastPeriod !== rawFast) ||
      (Number.isFinite(rawSlow) && slowPeriod !== rawSlow);

    const adjustmentNote = wasAdjusted
      ? ` (Periods normalized: fast EMA ${fastPeriod}, slow EMA ${slowPeriod}).`
      : "";

    return {
      supported: true,
      kind: "ema_cross",
      fastPeriod,
      slowPeriod,
      summary: `Enter long at the next candle open after EMA ${fastPeriod} crosses above EMA ${slowPeriod}; exit at the next open after it crosses below.`,
      rationale: cleanText(draft.rationale, "The AI mapped your prompt to an EMA crossover rule.") + adjustmentNote,
    };
  }

  if (draft.kind === "rsi_reversion") {
    const rawPeriod = Math.round(Number(draft.rsiPeriod));
    const rawEntry = Number(draft.entryBelow);
    const rawExit = Number(draft.exitAbove);

    const rsiPeriod = Number.isFinite(rawPeriod) && rawPeriod >= 2
      ? Math.min(Math.min(50, bars - 3), Math.max(2, rawPeriod))
      : 14;

    let entryBelow = Number.isFinite(rawEntry)
      ? Math.max(5, Math.min(49, Math.round(rawEntry * 10) / 10))
      : 30;

    let exitAbove = Number.isFinite(rawExit)
      ? Math.max(entryBelow + 1, Math.min(95, Math.round(rawExit * 10) / 10))
      : 70;

    if (exitAbove <= entryBelow) {
      exitAbove = Math.min(95, entryBelow + 10);
      if (exitAbove <= entryBelow) {
        entryBelow = Math.max(5, exitAbove - 10);
      }
    }

    const wasAdjusted = (Number.isFinite(rawEntry) && Math.abs(entryBelow - rawEntry) > 0.01) ||
      (Number.isFinite(rawExit) && Math.abs(exitAbove - rawExit) > 0.01) ||
      (Number.isFinite(rawPeriod) && rsiPeriod !== rawPeriod);

    const adjustmentNote = wasAdjusted
      ? ` (Thresholds normalized to valid bounds: RSI ${rsiPeriod}, entry below ${entryBelow}, exit above ${exitAbove}).`
      : "";

    return {
      supported: true,
      kind: "rsi_reversion",
      rsiPeriod,
      entryBelow,
      exitAbove,
      summary: `Enter long at the next candle open while RSI (${rsiPeriod}) is below ${entryBelow}; exit at the next open after RSI exceeds ${exitAbove}.`,
      rationale: cleanText(draft.rationale, "The AI mapped your prompt to an RSI mean-reversion rule.") + adjustmentNote,
    };
  }

  throw new Error("That prompt did not map to a supported strategy. Use an EMA crossover or RSI mean-reversion rule.");
}

function isEntry(plan: StrategyPlan, index: number, fast: Array<number | null>, slow: Array<number | null>, rsi: Array<number | null>) {
  if (plan.kind === "ema_cross") {
    const previousFast = fast[index - 2];
    const previousSlow = slow[index - 2];
    const currentFast = fast[index - 1];
    const currentSlow = slow[index - 1];
    return previousFast !== null && previousSlow !== null && currentFast !== null && currentSlow !== null &&
      previousFast <= previousSlow && currentFast > currentSlow;
  }
  const value = rsi[index - 1];
  return value !== null && value !== undefined && value < plan.entryBelow;
}

function isExit(plan: StrategyPlan, index: number, fast: Array<number | null>, slow: Array<number | null>, rsi: Array<number | null>) {
  if (plan.kind === "ema_cross") {
    const previousFast = fast[index - 2];
    const previousSlow = slow[index - 2];
    const currentFast = fast[index - 1];
    const currentSlow = slow[index - 1];
    return previousFast !== null && previousSlow !== null && currentFast !== null && currentSlow !== null &&
      previousFast >= previousSlow && currentFast < currentSlow;
  }
  const value = rsi[index - 1];
  return value !== null && value !== undefined && value > plan.exitAbove;
}

function periodsPerYear(interval: string): number {
  const milliseconds: Record<string, number> = {
    "15m": 15 * 60_000,
    "1H": 60 * 60_000,
    "4H": 4 * 60 * 60_000,
    "1D": 24 * 60 * 60_000,
  };
  return (365.25 * 24 * 60 * 60_000) / (milliseconds[interval] ?? 60 * 60_000);
}

function findBreakevenFeeBps(
  symbol: string,
  interval: string,
  candles: Candle[],
  strategy: StrategyPlan,
  costs: BacktestCosts,
): number | null {
  const zeroSim = runBacktestSimulation(symbol, interval, candles, strategy, { ...costs, feeBps: 0 }, false, false);
  if (zeroSim.returnPct <= 0) return 0;
  let low = 0;
  let high = 250;
  const highSim = runBacktestSimulation(symbol, interval, candles, strategy, { ...costs, feeBps: high }, false, false);
  if (highSim.returnPct > 0) return 250;
  for (let step = 0; step < 6; step += 1) {
    const mid = (low + high) / 2;
    const testSim = runBacktestSimulation(symbol, interval, candles, strategy, { ...costs, feeBps: mid }, false, false);
    if (testSim.returnPct > 0) low = mid;
    else high = mid;
  }
  return Math.round((low + high) / 2);
}

export function runBacktestSimulation(
  symbol: string,
  interval: string,
  candles: Candle[],
  strategy: StrategyPlan,
  costs: BacktestCosts = { feeBps: 10, spreadBps: 2, slippageBps: 5 },
  includeValidation = true,
  calculateBreakeven = true,
): BacktestResult {
  const closes = candles.map((candle) => candle.close);
  const fast = strategy.kind === "ema_cross" ? ema(closes, strategy.fastPeriod) : [];
  const slow = strategy.kind === "ema_cross" ? ema(closes, strategy.slowPeriod) : [];
  const rsi = strategy.kind === "rsi_reversion" ? rsiSeries(closes, strategy.rsiPeriod) : [];
  const warmup = strategy.kind === "ema_cross" ? strategy.slowPeriod + 1 : strategy.rsiPeriod + 1;
  const startingBalance = 10_000;
  const feeRate = costs.feeBps / 10_000;
  const executionImpact = (costs.spreadBps / 2 + costs.slippageBps) / 10_000;
  let cash = startingBalance;
  let units = 0;
  let committedCapital = 0;
  let entryPrice = 0;
  let entryAt = 0;
  let entryIndex = 0;
  let entries = 0;
  let wins = 0;
  const equity: Array<{ time: number; value: number; benchmarkValue: number }> = [];
  const trades: CompletedTrade[] = [];

  const firstPrice = candles[warmup] ? candles[warmup].open * (1 + executionImpact) : 0;
  const benchmarkUnits = firstPrice > 0 ? (startingBalance * (1 - feeRate)) / firstPrice : 0;

  for (let index = warmup; index < candles.length; index += 1) {
    const candleOpen = candles[index].open;
    if (units === 0 && cash > 0 && isEntry(strategy, index, fast, slow, rsi)) {
      committedCapital = cash;
      const executionPrice = candleOpen * (1 + executionImpact);
      units = (cash * (1 - feeRate)) / executionPrice;
      entryPrice = executionPrice;
      entryAt = candles[index].time;
      entryIndex = index;
      cash = 0;
      entries += 1;
    } else if (units > 0 && isExit(strategy, index, fast, slow, rsi)) {
      const executionPrice = candleOpen * (1 - executionImpact);
      const proceeds = units * executionPrice * (1 - feeRate);
      const pnl = proceeds - committedCapital;
      if (pnl > 0) wins += 1;
      trades.push({
        entryAt,
        exitAt: candles[index].time,
        entryPrice,
        exitPrice: executionPrice,
        pnl,
        returnPct: (pnl / committedCapital) * 100,
        barsHeld: index - entryIndex,
        exitReason: "signal",
      });
      cash = proceeds;
      units = 0;
      committedCapital = 0;
    }
    const currentBenchmark = benchmarkUnits > 0
      ? benchmarkUnits * candles[index].close * (1 - executionImpact) * (1 - feeRate)
      : startingBalance;
    equity.push({
      time: candles[index].time,
      value: cash + units * candles[index].close,
      benchmarkValue: currentBenchmark,
    });
  }

  const lastCandle = candles.at(-1)!;
  if (units > 0) {
    const executionPrice = lastCandle.close * (1 - executionImpact);
    const proceeds = units * executionPrice * (1 - feeRate);
    const pnl = proceeds - committedCapital;
    if (pnl > 0) wins += 1;
    trades.push({
      entryAt,
      exitAt: lastCandle.time,
      entryPrice,
      exitPrice: executionPrice,
      pnl,
      returnPct: (pnl / committedCapital) * 100,
      barsHeld: candles.length - 1 - entryIndex,
      exitReason: "end_of_data",
    });
    cash = proceeds;
    units = 0;
    if (equity.length) equity[equity.length - 1].value = cash;
  }

  let peak = startingBalance;
  let peakIndex = 0;
  let maxDrawdown = 0;
  let maxDrawdownDurationBars = 0;
  const returns: number[] = [];
  let previousEquity = startingBalance;
  for (let index = 0; index < equity.length; index += 1) {
    const point = equity[index];
    if (point.value >= peak) {
      maxDrawdownDurationBars = Math.max(maxDrawdownDurationBars, index - peakIndex);
      peak = point.value;
      peakIndex = index;
    } else {
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - point.value) / peak) * 100 : 0);
    }
    if (previousEquity > 0) returns.push(point.value / previousEquity - 1);
    previousEquity = point.value;
  }
  maxDrawdownDurationBars = Math.max(maxDrawdownDurationBars, equity.length > 0 ? equity.length - 1 - peakIndex : 0);

  const averageReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / (returns.length - 1) : 0;
  const standardDeviation = Math.sqrt(variance);
  const sharpeRatio = standardDeviation ? (averageReturn / standardDeviation) * Math.sqrt(periodsPerYear(interval)) : 0;
  const endingBalance = cash + units * lastCandle.close;
  const finalPrice = lastCandle.close * (1 - executionImpact);
  const buyAndHoldPct = firstPrice > 0
    ? ((finalPrice / firstPrice) * (1 - feeRate) ** 2 - 1) * 100
    : 0;
  const alphaPct = (endingBalance / startingBalance - 1) * 100 - buyAndHoldPct;
  const breakevenFeeBps = calculateBreakeven ? findBreakevenFeeBps(symbol, interval, candles, strategy, costs) : null;
  const isStatisticallyFragile = trades.length < 8;

  let validationData: BacktestResult["validation"] = null;
  let outOfSampleDecayPct: number | null = null;
  let robustnessRating: "high" | "moderate" | "fragile" = isStatisticallyFragile ? "fragile" : "moderate";

  if (includeValidation) {
    const splitIndex = Math.floor(candles.length * 0.7);
    const trainingCandles = candles.slice(0, splitIndex);
    const outOfSampleCandles = candles.slice(Math.max(0, splitIndex - warmup));
    if (trainingCandles.length > warmup + 10 && outOfSampleCandles.length > warmup + 10 && splitIndex < candles.length) {
      const training = runBacktestSimulation(symbol, interval, trainingCandles, strategy, costs, false, false);
      const outOfSample = runBacktestSimulation(symbol, interval, outOfSampleCandles, strategy, costs, false, false);
      validationData = {
        splitAt: candles[splitIndex].time,
        inSample: {
          returnPct: training.returnPct,
          buyAndHoldPct: training.buyAndHoldPct,
          maxDrawdownPct: training.maxDrawdownPct,
          closedTrades: training.closedTrades,
          barsTested: training.barsTested,
        },
        outOfSample: {
          returnPct: outOfSample.returnPct,
          buyAndHoldPct: outOfSample.buyAndHoldPct,
          maxDrawdownPct: outOfSample.maxDrawdownPct,
          closedTrades: outOfSample.closedTrades,
          barsTested: outOfSample.barsTested,
        },
      };

      if (training.returnPct > 0) {
        outOfSampleDecayPct = Math.round((outOfSample.returnPct / training.returnPct) * 100);
      }
      if (!isStatisticallyFragile) {
        if (training.returnPct > 10 && outOfSample.returnPct < -5) {
          robustnessRating = "fragile";
        } else if (trades.length >= 15 && outOfSample.returnPct > 0 && alphaPct > 0) {
          robustnessRating = "high";
        } else {
          robustnessRating = "moderate";
        }
      }
    }
  }

  const result: BacktestResult = {
    symbol,
    interval,
    strategy,
    startAt: candles[warmup].time,
    endAt: lastCandle.time,
    startingBalance,
    endingBalance,
    returnPct: (endingBalance / startingBalance - 1) * 100,
    buyAndHoldPct,
    maxDrawdownPct: maxDrawdown,
    sharpeRatio,
    tradeCount: entries,
    closedTrades: trades.length,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    feePctPerFill: feeRate * 100,
    spreadBps: costs.spreadBps,
    slippageBps: costs.slippageBps,
    barsTested: candles.length - warmup,
    equity,
    trades,
    validation: validationData,
    robustness: {
      alphaPct,
      outOfSampleDecayPct,
      breakevenFeeBps,
      maxDrawdownDurationBars,
      isStatisticallyFragile,
      robustnessRating,
    },
  };
  return result;
}
