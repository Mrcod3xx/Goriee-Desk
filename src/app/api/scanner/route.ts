import { getSpotScanMarkets } from "@/lib/bitget";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await getSpotScanMarkets();
    return NextResponse.json({ markets, asOf: Date.now(), source: "Bitget public spot API" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bitget markets could not be scanned.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
