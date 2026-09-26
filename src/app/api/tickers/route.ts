import { NextRequest, NextResponse } from "next/server";

const defaultSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export async function GET(request: NextRequest) {
  const requested = (request.nextUrl.searchParams.get("symbols") ?? defaultSymbols.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{5,20}$/.test(symbol));
  const symbols = [...new Set(requested)].slice(0, 50);

  if (!symbols.length) return NextResponse.json({ quotes: [], asOf: Date.now() });

  try {
    const response = await fetch(
      "https://api.bitget.com/api/v3/market/tickers?category=SPOT",
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error(`Bitget returned HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      code?: string;
      msg?: string;
      data?: Array<Record<string, unknown>>;
    };
    if (payload.code && payload.code !== "00000") throw new Error(payload.msg || "Bitget error.");

    const requestedSymbols = new Set(symbols);
    const quotes = (payload.data ?? [])
      .filter((row) => requestedSymbols.has(String(row.symbol).toUpperCase()))
      .map((row) => ({
        symbol: String(row.symbol),
        price: Number(row.lastPrice),
        change24h: Number(row.price24hPcnt) * 100,
      }));
    return NextResponse.json({ quotes, asOf: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Watchlist quotes are unavailable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
