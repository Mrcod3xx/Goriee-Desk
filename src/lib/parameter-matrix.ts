import type { Candle } from "./bitget";

export type MatrixCell = {
  paramA: number; // e.g. Fast EMA or RSI Entry
  paramB: number; // e.g. Slow EMA or RSI Exit
  returnPct: number;
  winRatePct: number;
  tradeCount: number;
  maxDrawdownPct: number;
  profitFactor: number;
  isSelected?: boolean;
};

export type ParameterMatrixResult = {
  kind: "ema_cross" | "rsi_reversion";
  labelA: string; // e.g. "Fast EMA" or "RSI Entry Level"
  labelB: string; // e.g. "Slow EMA" or "RSI Exit Level"
  valuesA: number[];
  valuesB: number[];
  cells: MatrixCell[][]; // rows are valuesA, columns are valuesB
  robustnessScore: number; // percentage of cells with returnPct > 0
  isPlateau: boolean;
  isCliff: boolean;
  bestCell: MatrixCell;
};

// Fast EMA calculation for arbitrary series
function computeEMASeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length);
  if (values.length === 0) return result;
  
  let current = values[0];
  result[0] = current;
  for (let i = 1; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
    result[i] = current;
  }
  return result;
}

// Fast RSI calculation
function computeRSISeries(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return result;
}

/**
 * Fast client-side parameter grid simulation across completed Bitget candles.
 */
export function calculateParameterMatrix(
  candles: Candle[],
  options: {
    kind: "ema_cross" | "rsi_reversion";
    selectedParamA?: number;
    selectedParamB?: number;
    feeBps?: number;
    slippageBps?: number;
    startingBalance?: number;
  }
): ParameterMatrixResult {
  const feeBps = options.feeBps ?? 10;
  const slippageBps = options.slippageBps ?? 5;
  const startingBalance = options.startingBalance ?? 10_000;
  const totalCostRate = (feeBps + slippageBps) / 10_000;

  const closes = candles.map((c) => c.close);
  const opens = candles.map((c) => c.open);

  const isEma = options.kind === "ema_cross";
  const valuesA = isEma ? [10, 15, 20, 25] : [25, 28, 30, 32, 35];
  const valuesB = isEma ? [35, 50, 65, 80] : [55, 60, 65, 70];

  const labelA = isEma ? "Fast EMA" : "RSI Entry Threshold";
  const labelB = isEma ? "Slow EMA" : "RSI Exit Threshold";

  // Precompute series for fast grid evaluation
  const emaCache = new Map<number, number[]>();
  if (isEma) {
    const allPeriods = Array.from(new Set([...valuesA, ...valuesB]));
    for (const p of allPeriods) {
      emaCache.set(p, computeEMASeries(closes, p));
    }
  }

  const rsiSeries = isEma ? [] : computeRSISeries(closes, 14);

  const cells: MatrixCell[][] = [];
  let totalProfitable = 0;
  let totalEvaluated = 0;
  let bestCell: MatrixCell = {
    paramA: valuesA[0],
    paramB: valuesB[0],
    returnPct: -Infinity,
    winRatePct: 0,
    tradeCount: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
  };

  for (let r = 0; r < valuesA.length; r++) {
    const row: MatrixCell[] = [];
    const a = valuesA[r];

    for (let c = 0; c < valuesB.length; c++) {
      const b = valuesB[c];

      // Simulate strategy across candles
      let cash = startingBalance;
      let units = 0;
      let entryPrice = 0;
      let trades: Array<{ pnl: number; returnPct: number }> = [];
      let peakCash = startingBalance;
      let maxDrawdown = 0;

      const warmup = isEma ? Math.max(a, b) + 2 : 16;

      for (let i = warmup; i < candles.length - 1; i++) {
        let enterSignal = false;
        let exitSignal = false;

        if (isEma) {
          const fast = emaCache.get(a)!;
          const slow = emaCache.get(b)!;
          // Golden cross: fast crosses above slow
          enterSignal = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
          // Death cross: fast crosses below slow
          exitSignal = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
        } else {
          // RSI mean reversion
          enterSignal = rsiSeries[i] < a;
          exitSignal = rsiSeries[i] > b;
        }

        // Fill occurs at NEXT bar open
        const fillPrice = opens[i + 1];

        if (units === 0 && enterSignal) {
          const effectiveEntry = fillPrice * (1 + totalCostRate);
          units = cash / effectiveEntry;
          entryPrice = effectiveEntry;
          cash = 0;
        } else if (units > 0 && exitSignal) {
          const effectiveExit = fillPrice * (1 - totalCostRate);
          const grossPnl = units * (effectiveExit - entryPrice);
          const tradeReturn = (effectiveExit - entryPrice) / entryPrice * 100;
          cash = units * effectiveExit;
          units = 0;
          trades.push({ pnl: grossPnl, returnPct: tradeReturn });

          if (cash > peakCash) peakCash = cash;
          const dd = ((peakCash - cash) / peakCash) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }
      }

      // Close open trade at the end if any
      if (units > 0) {
        const lastPrice = closes[closes.length - 1] * (1 - totalCostRate);
        const finalPnl = units * (lastPrice - entryPrice);
        const tradeReturn = (lastPrice - entryPrice) / entryPrice * 100;
        cash = units * lastPrice;
        units = 0;
        trades.push({ pnl: finalPnl, returnPct: tradeReturn });
      }

      const returnPct = ((cash - startingBalance) / startingBalance) * 100;
      const wins = trades.filter((t) => t.pnl > 0).length;
      const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      const grossWins = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
      const grossLosses = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 1;

      const isSelected =
        options.selectedParamA !== undefined &&
        options.selectedParamB !== undefined &&
        options.selectedParamA === a &&
        options.selectedParamB === b;

      const cell: MatrixCell = {
        paramA: a,
        paramB: b,
        returnPct: Number(returnPct.toFixed(2)),
        winRatePct: Number(winRatePct.toFixed(1)),
        tradeCount: trades.length,
        maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        isSelected,
      };

      if (returnPct > 0) totalProfitable++;
      totalEvaluated++;

      if (returnPct > bestCell.returnPct) {
        bestCell = cell;
      }

      row.push(cell);
    }
    cells.push(row);
  }

  const robustnessScore = totalEvaluated > 0 ? (totalProfitable / totalEvaluated) * 100 : 0;
  const isPlateau = robustnessScore >= 60;
  const isCliff = robustnessScore <= 35;

  return {
    kind: options.kind,
    labelA,
    labelB,
    valuesA,
    valuesB,
    cells,
    robustnessScore: Number(robustnessScore.toFixed(1)),
    isPlateau,
    isCliff,
    bestCell,
  };
}
