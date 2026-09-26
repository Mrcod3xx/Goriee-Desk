import { getLLMConfiguration, getLLMProvider } from "@/lib/llm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function publicBaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export async function GET() {
  const configuration = getLLMConfiguration();
  const baseUrl = configuration?.baseUrl ?? process.env.LLM_BASE_URL?.trim() ?? "";
  return NextResponse.json({
    configured: Boolean(configuration),
    model: configuration?.model ?? null,
    baseUrl: publicBaseUrl(baseUrl),
    provider: getLLMProvider(baseUrl),
    keyConfigured: Boolean(process.env.LLM_API_KEY?.trim()),
    editable: process.env.NODE_ENV === "development",
  });
}
