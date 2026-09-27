import { getSpotMarket, getHistoricalSpotCandles } from "@/lib/bitget";
import { NextRequest, NextResponse } from "next/server";

const allowedIntervals = new Set(["15m", "1H", "4H", "1D"]);

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const interval = request.nextUrl.searchParams.get("interval") ?? "1H";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const startTimeParam = request.nextUrl.searchParams.get("startTime");
  const endTimeParam = request.nextUrl.searchParams.get("endTime");

  if (!/^[A-Z0-9]{5,20}$/i.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid market symbol." }, { status: 400 });
  }
  if (!allowedIntervals.has(interval)) {
    return NextResponse.json({ error: "Choose 15m, 1H, 4H, or 1D." }, { status: 400 });
  }

  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 180, 60), 1000) : 300;

  try {
    if (startTimeParam && endTimeParam) {
      const startAt = Number(startTimeParam);
      const endAt = Number(endTimeParam);
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt) {
        const candles = await getHistoricalSpotCandles(symbol, interval, startAt, endAt);
        if (candles.length > 0) {
          const last = candles[candles.length - 1];
          const market = {
            symbol: symbol.toUpperCase(),
            category: "SPOT" as const,
            interval,
            price: last.close,
            change24h: 0,
            high24h: Math.max(...candles.map((c) => c.high)),
            low24h: Math.min(...candles.map((c) => c.low)),
            volume24h: candles.reduce((s, c) => s + c.volume, 0),
            turnover24h: candles.reduce((s, c) => s + c.turnover, 0),
            asOf: last.time,
            candles,
          };
          return NextResponse.json({ market, source: "Bitget historical candles" });
        }
      }
    }

    const market = await getSpotMarket(symbol, interval, limit);
    return NextResponse.json({ market, source: "Bitget public spot API" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data is unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
