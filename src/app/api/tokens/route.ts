import { NextResponse } from "next/server";
import { bitgetRequest } from "@/lib/bitget-http";
import { bitgetErrorResponse } from "@/lib/bitget-response";

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
    const payload = await bitgetRequest<Array<Partial<SpotInstrument>>>(
      "/api/v3/market/instruments?category=SPOT",
    );

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
    return bitgetErrorResponse(error, "Bitget markets could not be loaded.");
  }
}
