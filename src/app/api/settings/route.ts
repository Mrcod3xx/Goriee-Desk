import { getLLMProvider } from "@/lib/llm";
import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingNames = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"] as const;

function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLocalSameOrigin(request: Request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !origin) return false;

  try {
    const originUrl = new URL(origin);
    const requestHost = new URL(`http://${host}`);
    return isLoopback(originUrl.hostname) && originUrl.host === requestHost.host;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) return null;
    if (url.pathname.includes("//")) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" || !isLocalSameOrigin(request)) {
    return NextResponse.json({ error: "Provider settings can only be changed from this app's local development server." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Settings must be sent as valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Provider settings are missing." }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const baseUrl = normalizeBaseUrl(values.baseUrl);
  const model = typeof values.model === "string" ? values.model.trim() : "";
  const submittedKey = typeof values.apiKey === "string" ? values.apiKey.trim() : "";
  if (!baseUrl) return NextResponse.json({ error: "Enter a valid HTTPS base URL. HTTP is allowed only for localhost routers." }, { status: 400 });
  if (!model || model.length > 160 || /[\r\n]/.test(model)) return NextResponse.json({ error: "Enter a model ID up to 160 characters." }, { status: 400 });
  if (/[\r\n]/.test(submittedKey) || submittedKey.length > 4096) return NextResponse.json({ error: "The API key format is invalid." }, { status: 400 });

  const currentBaseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const currentKey = process.env.LLM_API_KEY?.trim() ?? "";
  const apiKey = submittedKey || (baseUrl === currentBaseUrl ? currentKey : "");
  if (!apiKey) return NextResponse.json({ error: "Enter an API key for this provider. Leave it blank only when keeping the current provider key." }, { status: 400 });

  const persisted = {
    LLM_BASE_URL: baseUrl,
    LLM_MODEL: model,
    LLM_API_KEY: apiKey,
  };
  const filePath = path.join(process.cwd(), ".env.local");
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    // A new local setup may not have an env file yet.
  }

  const nextLines: string[] = [];
  const written = new Set<string>();
  for (const line of existing.split(/\r?\n/)) {
    const match = line.match(/^\s*(LLM_BASE_URL|LLM_MODEL|LLM_API_KEY)\s*=/);
    if (!match) {
      nextLines.push(line);
      continue;
    }
    const name = match[1] as keyof typeof persisted;
    if (written.has(name)) continue;
    nextLines.push(`${name}=${JSON.stringify(persisted[name])}`);
    written.add(name);
  }
  for (const name of settingNames) {
    if (!written.has(name)) nextLines.push(`${name}=${JSON.stringify(persisted[name])}`);
  }

  await writeFile(filePath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, { encoding: "utf8", mode: 0o600 });
  for (const name of settingNames) process.env[name] = persisted[name];
  return NextResponse.json({
    configured: true,
    model,
    baseUrl,
    provider: getLLMProvider(baseUrl),
    keyConfigured: true,
    editable: true,
  });
}
