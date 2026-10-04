import { getLLMConfiguration, getLLMProvider, isCustomLLM } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";

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

export async function GET(request: NextRequest) {
  const custom = isCustomLLM(request.headers);
  const configuration = getLLMConfiguration(request.headers);
  const baseUrl = configuration?.baseUrl ?? process.env.LLM_BASE_URL?.trim() ?? "";
  return NextResponse.json({
    configured: Boolean(configuration),
    model: configuration?.model ?? null,
    baseUrl: publicBaseUrl(baseUrl),
    provider: getLLMProvider(baseUrl),
    keyConfigured: Boolean(configuration?.apiKey ?? process.env.LLM_API_KEY?.trim()),
    editable: true,
    isCustom: custom,
  });
}
