import { getSpotScanMarkets } from "@/lib/bitget";
import { bitgetErrorResponse } from "@/lib/bitget-response";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await getSpotScanMarkets();
    return NextResponse.json({ markets, asOf: Date.now(), source: "Bitget public spot API" });
  } catch (error) {
    return bitgetErrorResponse(error, "Bitget markets could not be scanned.");
  }
}
