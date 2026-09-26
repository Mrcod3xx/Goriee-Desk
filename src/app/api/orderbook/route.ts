import { getSpotOrderBook } from "@/lib/orderbook";
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
    const message = error instanceof Error ? error.message : "Order book data is unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
