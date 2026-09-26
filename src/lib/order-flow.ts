import type { Candle } from "./bitget";

export type OrderFlowBar = {
  time: number;
  buyVolume: number;
  sellVolume: number;
  deltaVolume: number;
  cvd: number;
};

export type OrderFlowAnalysis = {
  bars: OrderFlowBar[];
  currentDelta: number;
  currentCvd: number;
  totalVolume: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  buyerAggressionPct: number; // e.g. 56.4%
  regime: "Buyer Absorption" | "Seller Aggression" | "Balanced Flow" | "Strong Buyer Dominance";
  divergence: "Bullish CVD Divergence" | "Bearish CVD Divergence" | "Neutral Confluence";
};

/**
 * Calculates intra-candle order flow, Volume Delta, and Cumulative Volume Delta (CVD).
 * Based on price action positioning within the bar range:
 * Buy Volume Ratio = (Close - Low) / (High - Low), modulated by (Close - Open).
 */
export function calculateOrderFlow(candles: Candle[]): OrderFlowAnalysis {
  if (candles.length === 0) {
    return {
      bars: [],
      currentDelta: 0,
      currentCvd: 0,
      totalVolume: 0,
      totalBuyVolume: 0,
      totalSellVolume: 0,
      buyerAggressionPct: 50,
      regime: "Balanced Flow",
      divergence: "Neutral Confluence",
    };
  }

  const bars: OrderFlowBar[] = [];
  let runningCvd = 0;
  let totalVol = 0;
  let totalBuy = 0;
  let totalSell = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    let buyRatio = 0.5;

    if (range > 0) {
      // Primary weight from close relative to range
      const closePos = (c.close - c.low) / range;
      // Secondary weight from body direction (close vs open)
      const bodyRatio = (c.close - c.open) / range;
      buyRatio = Math.max(0.05, Math.min(0.95, closePos * 0.7 + (bodyRatio + 1) * 0.15));
    } else {
      buyRatio = c.close >= c.open ? 0.55 : 0.45;
    }

    const buyVol = c.volume * buyRatio;
    const sellVol = c.volume * (1 - buyRatio);
    const delta = buyVol - sellVol;
    runningCvd += delta;

    totalVol += c.volume;
    totalBuy += buyVol;
    totalSell += sellVol;

    bars.push({
      time: c.time,
      buyVolume: buyVol,
      sellVolume: sellVol,
      deltaVolume: delta,
      cvd: runningCvd,
    });
  }

  const buyerAggressionPct = totalVol > 0 ? (totalBuy / totalVol) * 100 : 50;

  let regime: OrderFlowAnalysis["regime"] = "Balanced Flow";
  if (buyerAggressionPct >= 55) {
    regime = "Strong Buyer Dominance";
  } else if (buyerAggressionPct <= 45) {
    regime = "Seller Aggression";
  } else if (runningCvd > 0) {
    regime = "Buyer Absorption";
  }

  // Detect Divergence over last 20 bars
  let divergence: OrderFlowAnalysis["divergence"] = "Neutral Confluence";
  if (candles.length >= 20) {
    const lookback = Math.min(25, candles.length);
    const startIdx = candles.length - lookback;
    const priceChange = candles[candles.length - 1].close - candles[startIdx].close;
    const cvdChange = bars[bars.length - 1].cvd - bars[startIdx].cvd;

    // Price falling or flat, but CVD strongly rising = Bullish absorption
    if (priceChange <= 0 && cvdChange > 0) {
      divergence = "Bullish CVD Divergence";
    } else if (priceChange >= 0 && cvdChange < 0) {
      divergence = "Bearish CVD Divergence";
    }
  }

  const currentDelta = bars.length > 0 ? bars[bars.length - 1].deltaVolume : 0;

  return {
    bars,
    currentDelta,
    currentCvd: runningCvd,
    totalVolume: totalVol,
    totalBuyVolume: totalBuy,
    totalSellVolume: totalSell,
    buyerAggressionPct: Number(buyerAggressionPct.toFixed(1)),
    regime,
    divergence,
  };
}
