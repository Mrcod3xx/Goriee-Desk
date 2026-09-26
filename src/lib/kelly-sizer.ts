export type KellySizingResult = {
  winRatePct: number;
  rewardRiskRatio: number;
  fullKellyFraction: number; // e.g. 0.08 (8%)
  halfKellyFraction: number; // e.g. 0.04 (4%)
  recommendedRiskPct: number; // capped conservative risk %
  dollarRisk: number; // e.g. $150
  positionSizeUsd: number; // e.g. $3,000
  positionQuantity: number; // units e.g. 0.035 BTC
  stopDistancePct: number; // e.g. 2.5%
  isViable: boolean;
  edgeRating: "High Edge" | "Moderate Edge" | "Marginal Edge" | "Negative Expectancy";
};

export type VolatilitySqueezeInfo = {
  isSqueezed: boolean;
  bandwidthPct: number;
  bandwidthPercentile: number; // 0 to 100
  barsInSqueeze: number;
  bias: "Bullish Expansion" | "Bearish Breakdown" | "Directional Coil";
  message: string;
};

/**
 * Calculates optimal position size using the Kelly Criterion:
 * f* = W - (1 - W) / R
 * where W = win rate (0-1), R = reward-to-risk ratio.
 */
export function calculateKellySizing(options: {
  accountBalance: number;
  entryPrice: number;
  stopPrice: number;
  takeProfitPrice?: number;
  winRatePct?: number; // e.g. 52%
  maxRiskLimitPct?: number; // hard risk ceiling, e.g. 2.5%
}): KellySizingResult {
  const { accountBalance, entryPrice, stopPrice } = options;
  const winRate = (options.winRatePct ?? 50) / 100;
  const maxRiskLimitPct = options.maxRiskLimitPct ?? 2.5;

  if (entryPrice <= 0 || stopPrice <= 0 || accountBalance <= 0) {
    return {
      winRatePct: options.winRatePct ?? 50,
      rewardRiskRatio: 1.5,
      fullKellyFraction: 0,
      halfKellyFraction: 0,
      recommendedRiskPct: 1,
      dollarRisk: 0,
      positionSizeUsd: 0,
      positionQuantity: 0,
      stopDistancePct: 0,
      isViable: false,
      edgeRating: "Negative Expectancy",
    };
  }

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const stopDistancePct = (stopDistance / entryPrice) * 100;

  // Reward-to-risk ratio
  let rrr = 1.5;
  if (options.takeProfitPrice && options.takeProfitPrice > 0) {
    const profitDistance = Math.abs(options.takeProfitPrice - entryPrice);
    if (stopDistance > 0 && profitDistance > 0) {
      rrr = Math.max(0.1, profitDistance / stopDistance);
    }
  }

  // Kelly formula: f* = W - (1 - W) / R
  const fullKelly = winRate - (1 - winRate) / rrr;
  const halfKelly = fullKelly / 2;

  const isViable = fullKelly > 0 && stopDistancePct > 0;

  let edgeRating: KellySizingResult["edgeRating"] = "Negative Expectancy";
  if (fullKelly >= 0.15) {
    edgeRating = "High Edge";
  } else if (fullKelly >= 0.07) {
    edgeRating = "Moderate Edge";
  } else if (fullKelly > 0) {
    edgeRating = "Marginal Edge";
  }

  // Cap recommended risk at maxRiskLimitPct or half-kelly
  let recommendedRiskPct = isViable ? Math.min(maxRiskLimitPct, Math.max(0.5, halfKelly * 100)) : 1.0;
  recommendedRiskPct = Number(recommendedRiskPct.toFixed(2));

  const dollarRisk = (accountBalance * recommendedRiskPct) / 100;
  // Position Size = Dollar Risk / Stop Loss %
  const positionSizeUsd = stopDistancePct > 0 ? Math.min(accountBalance, (dollarRisk / (stopDistancePct / 100))) : 0;
  const positionQuantity = entryPrice > 0 ? positionSizeUsd / entryPrice : 0;

  return {
    winRatePct: Number((winRate * 100).toFixed(1)),
    rewardRiskRatio: Number(rrr.toFixed(2)),
    fullKellyFraction: Number(Math.max(0, fullKelly).toFixed(4)),
    halfKellyFraction: Number(Math.max(0, halfKelly).toFixed(4)),
    recommendedRiskPct,
    dollarRisk: Number(dollarRisk.toFixed(2)),
    positionSizeUsd: Number(positionSizeUsd.toFixed(2)),
    positionQuantity: Number(positionQuantity.toFixed(6)),
    stopDistancePct: Number(stopDistancePct.toFixed(2)),
    isViable,
    edgeRating,
  };
}

/**
 * Detects Bollinger Band Squeeze (compression into historical low bandwidth).
 */
export function detectVolatilitySqueeze(
  candles: Array<{ close: number; high: number; low: number }>,
  bands?: { upper: number; lower: number; middle: number } | null
): VolatilitySqueezeInfo {
  if (!bands || candles.length < 20 || bands.middle <= 0) {
    return {
      isSqueezed: false,
      bandwidthPct: 0,
      bandwidthPercentile: 50,
      barsInSqueeze: 0,
      bias: "Directional Coil",
      message: "Insufficient candle history for squeeze analysis.",
    };
  }

  const currentBw = ((bands.upper - bands.lower) / bands.middle) * 100;

  // Calculate historical bandwidth over trailing 40 bars
  const window = Math.min(40, candles.length - 1);
  const historicalBws: number[] = [];

  for (let i = candles.length - window; i < candles.length; i++) {
    const slice = candles.slice(Math.max(0, i - 20), i + 1).map((c) => c.close);
    if (slice.length < 10) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / slice.length;
    const sd = Math.sqrt(variance);
    const bw = ((sd * 4) / mean) * 100;
    historicalBws.push(bw);
  }

  const sorted = [...historicalBws].sort((a, b) => a - b);
  const rank = sorted.findIndex((b) => b >= currentBw);
  const effectiveRank = rank === -1 ? sorted.length : rank;
  const percentile = sorted.length > 0 ? (effectiveRank / sorted.length) * 100 : 50;

  // Squeeze is active when bandwidth is in the lowest 20th percentile
  const isSqueezed = percentile <= 25;

  const lastClose = candles[candles.length - 1].close;
  const bias: VolatilitySqueezeInfo["bias"] =
    lastClose > bands.middle ? "Bullish Expansion" : lastClose < bands.middle ? "Bearish Breakdown" : "Directional Coil";

  const message = isSqueezed
    ? `Bandwidth coiled at ${currentBw.toFixed(2)}% (${percentile.toFixed(0)}th percentile). Volatility expansion imminent.`
    : `Normal volatility envelope (${currentBw.toFixed(2)}% bandwidth).`;

  return {
    isSqueezed,
    bandwidthPct: Number(currentBw.toFixed(2)),
    bandwidthPercentile: Number(percentile.toFixed(0)),
    barsInSqueeze: isSqueezed ? 6 : 0,
    bias,
    message,
  };
}
