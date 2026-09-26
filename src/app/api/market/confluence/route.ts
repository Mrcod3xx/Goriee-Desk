import { getSpotMarket, ema, rsi, macd, atr, type Candle } from "@/lib/bitget";
import { NextRequest, NextResponse } from "next/server";

export type HorizonAnalysis = {
  interval: "15m" | "1H" | "4H" | "1D";
  price: number;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  macdHist: number | null;
  macdValue: number | null;
  macdSignal: number | null;
  atrVal: number | null;
  trendState: "Bullish" | "Bearish" | "Neutral";
  bias: "Bullish" | "Bearish" | "Neutral";
  score: number;
};

export type ConfluenceResult = {
  symbol: string;
  horizons: HorizonAnalysis[];
  confluenceScore: number; // 0 - 100
  direction: "Bullish" | "Bearish" | "Mixed";
  overallRegime: string;
  summary: string;
  asOf: number;
};

const intervals: Array<"15m" | "1H" | "4H" | "1D"> = ["15m", "1H", "4H", "1D"];
const horizonWeights: Record<string, number> = {
  "15m": 0.15,
  "1H": 0.25,
  "4H": 0.30,
  "1D": 0.30,
};

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();

  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid market symbol." }, { status: 400 });
  }

  try {
    const marketPromises = intervals.map((interval) =>
      getSpotMarket(symbol, interval, 80).catch((err) => {
        console.warn(`Confluence fetch failed for ${symbol} ${interval}:`, err?.message);
        return null;
      })
    );

    const results = await Promise.all(marketPromises);

    const horizons: HorizonAnalysis[] = [];
    let weightedScoreTotal = 0;
    let totalWeight = 0;

    results.forEach((market, idx) => {
      const interval = intervals[idx];
      if (!market || market.candles.length < 25) {
        return;
      }

      const candles = market.candles;
      const closes = candles.map((c) => c.close);
      const lastPrice = closes.at(-1) ?? market.price;

      const ema20s = ema(closes, 20);
      const ema50s = ema(closes, 50);
      const latestRsi = rsi(closes, 14);
      const macds = macd(closes, 12, 26, 9);
      const atrValue = atr(candles, 14);

      const latestEma20 = ema20s.at(-1) ?? null;
      const latestEma50 = ema50s.at(-1) ?? null;
      const latestMacd = macds.at(-1);

      // Scoring:
      // Trend: +1 if price > ema20 > ema50; -1 if price < ema20 < ema50
      let trendState: "Bullish" | "Bearish" | "Neutral" = "Neutral";
      let horizonScore = 0;

      if (latestEma20 !== null && latestEma50 !== null) {
        if (lastPrice >= latestEma20 && latestEma20 >= latestEma50) {
          trendState = "Bullish";
          horizonScore += 1;
        } else if (lastPrice <= latestEma20 && latestEma20 <= latestEma50) {
          trendState = "Bearish";
          horizonScore -= 1;
        } else if (lastPrice > latestEma20) {
          trendState = "Bullish";
          horizonScore += 0.5;
        } else if (lastPrice < latestEma20) {
          trendState = "Bearish";
          horizonScore -= 0.5;
        }
      }

      // RSI
      if (latestRsi !== null) {
        if (latestRsi >= 55) {
          horizonScore += 0.5;
        } else if (latestRsi <= 45) {
          horizonScore -= 0.5;
        }
      }

      // MACD
      if (latestMacd && latestMacd.histogram !== null) {
        if (latestMacd.histogram > 0 && (latestMacd.macd ?? 0) > (latestMacd.signal ?? 0)) {
          horizonScore += 0.5;
        } else if (latestMacd.histogram < 0 && (latestMacd.macd ?? 0) < (latestMacd.signal ?? 0)) {
          horizonScore -= 0.5;
        }
      }

      // Max score is +2, min is -2
      const normalizedScore = Math.max(-1, Math.min(1, horizonScore / 2));
      const horizonBias: "Bullish" | "Bearish" | "Neutral" =
        normalizedScore >= 0.25 ? "Bullish" : normalizedScore <= -0.25 ? "Bearish" : "Neutral";

      const weight = horizonWeights[interval] ?? 0.25;
      weightedScoreTotal += normalizedScore * weight;
      totalWeight += weight;

      horizons.push({
        interval,
        price: lastPrice,
        ema20: latestEma20,
        ema50: latestEma50,
        rsi14: latestRsi,
        macdHist: latestMacd?.histogram ?? null,
        macdValue: latestMacd?.macd ?? null,
        macdSignal: latestMacd?.signal ?? null,
        atrVal: atrValue,
        trendState,
        bias: horizonBias,
        score: Number(normalizedScore.toFixed(2)),
      });
    });

    if (horizons.length === 0) {
      return NextResponse.json(
        { error: "Insufficient timeframe candle history for confluence matrix." },
        { status: 502 }
      );
    }

    const finalScore = totalWeight > 0 ? weightedScoreTotal / totalWeight : 0;
    const absScore = Math.abs(finalScore);
    const confluencePercentage = Math.round(absScore * 100);

    const direction: "Bullish" | "Bearish" | "Mixed" =
      finalScore >= 0.2 ? "Bullish" : finalScore <= -0.2 ? "Bearish" : "Mixed";

    let overallRegime = "Neutral Consolidation / Mixed Timeframes";
    if (finalScore >= 0.6) {
      overallRegime = "Strong Bullish Confluence";
    } else if (finalScore >= 0.2) {
      overallRegime = "Moderate Bullish Alignment";
    } else if (finalScore <= -0.6) {
      overallRegime = "Strong Bearish Confluence";
    } else if (finalScore <= -0.2) {
      overallRegime = "Moderate Bearish Alignment";
    }

    const bullishCount = horizons.filter((h) => h.bias === "Bullish").length;
    const bearishCount = horizons.filter((h) => h.bias === "Bearish").length;

    const summary = `${bullishCount} of ${horizons.length} horizons show bullish bias (${bearishCount} bearish). ${
      direction === "Bullish"
        ? "Higher-timeframe trend aligns with momentum for long probability."
        : direction === "Bearish"
        ? "Higher-timeframe resistance dominates momentum for downside risk."
        : "Conflicting horizon signals suggest rangebound chop or impending breakout."
    }`;

    const confluenceData: ConfluenceResult = {
      symbol,
      horizons,
      confluenceScore: confluencePercentage,
      direction,
      overallRegime,
      summary,
      asOf: Date.now(),
    };

    return NextResponse.json({ confluence: confluenceData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute confluence.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
