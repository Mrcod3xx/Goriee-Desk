import { getSpotMarket } from "@/lib/bitget";
import { NextRequest, NextResponse } from "next/server";

const allowedIntervals = new Set(["15m", "1H", "4H", "1D"]);

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const interval = request.nextUrl.searchParams.get("interval") ?? "1H";

  if (!/^[A-Z0-9]{5,20}$/i.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid market symbol." }, { status: 400 });
  }
  if (!allowedIntervals.has(interval)) {
    return NextResponse.json({ error: "Choose 15m, 1H, 4H, or 1D." }, { status: 400 });
  }

  try {
    const market = await getSpotMarket(symbol, interval, 180);
    return NextResponse.json({ market, source: "Bitget public spot API" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data is unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
