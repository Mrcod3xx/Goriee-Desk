import { getSpotOrderBook } from "@/lib/orderbook";
import { bitgetErrorResponse } from "@/lib/bitget-response";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 15;

  if (!/^[A-Z0-9]{5,20}$/i.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid market symbol." }, { status: 400 });
  }

  try {
    const orderbook = await getSpotOrderBook(symbol, limit);
    return NextResponse.json({ orderbook, source: "Bitget L2 orderbook" });
  } catch (error) {
    // This panel polls every 3 seconds, so it is the caller most likely to hit
    // Bitget's limit. A 429 + Retry-After lets it back off instead of hammering.
    return bitgetErrorResponse(error, "Order book data is unavailable.");
  }
}
