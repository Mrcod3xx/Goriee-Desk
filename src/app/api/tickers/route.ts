import { NextRequest, NextResponse } from "next/server";
import { bitgetRequest } from "@/lib/bitget-http";
import { bitgetErrorResponse } from "@/lib/bitget-response";

const defaultSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export async function GET(request: NextRequest) {
  const requested = (request.nextUrl.searchParams.get("symbols") ?? defaultSymbols.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{5,20}$/.test(symbol));
  const symbols = [...new Set(requested)].slice(0, 50);

  if (!symbols.length) return NextResponse.json({ quotes: [], asOf: Date.now() });

  try {
    // Shares the retry/backoff and `Retry-After` handling every other Bitget
    // call uses; this one used to be a bare fetch with no retry at all.
    const payload = await bitgetRequest<Array<Record<string, unknown>>>(
      "/api/v3/market/tickers?category=SPOT",
    );

    const requestedSymbols = new Set(symbols);
    const asOf = Date.now();
    const quotes = (payload.data ?? [])
      .filter((row) => requestedSymbols.has(String(row.symbol).toUpperCase()))
      .map((row) => ({
        symbol: String(row.symbol),
        price: Number(row.lastPrice),
        change24h: Number(row.price24hPcnt) * 100,
        asOf,
      }));
    return NextResponse.json({ quotes, asOf });
  } catch (error) {
    return bitgetErrorResponse(error, "Watchlist quotes are unavailable.");
  }
}
