import { NextResponse } from "next/server";

export type SpotInstrument = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  symbolType: string;
  isRwa: string;
  status: string;
};

export async function GET() {
  try {
    const response = await fetch(
      "https://api.bitget.com/api/v3/market/instruments?category=SPOT",
      { cache: "no-store", signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) throw new Error(`Bitget returned HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      code?: string;
      msg?: string;
      data?: Array<Partial<SpotInstrument>>;
    };
    if (payload.code && payload.code !== "00000") throw new Error(payload.msg || "Bitget error.");

    const instruments = (payload.data ?? [])
      .filter((instrument) => instrument.status === "online" && instrument.quoteCoin === "USDT")
      .map((instrument) => ({
        symbol: String(instrument.symbol ?? ""),
        baseCoin: String(instrument.baseCoin ?? ""),
        quoteCoin: "USDT",
        symbolType: String(instrument.symbolType ?? "crypto"),
        isRwa:
          (String(instrument.isRwa ?? "").toUpperCase() === "YES" ||
          String(instrument.symbolType ?? "").toLowerCase() === "stock")
            ? "YES"
            : "NO",
        status: String(instrument.status ?? ""),
      }))
      .filter((instrument) => instrument.symbol && instrument.baseCoin)
      .sort((a, b) => a.baseCoin.localeCompare(b.baseCoin));

    return NextResponse.json({ instruments, asOf: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bitget markets could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
