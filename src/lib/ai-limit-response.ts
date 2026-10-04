import { NextResponse } from "next/server";
import {
  acquireAiSlot,
  aiBusyDecision,
  aiLimitBody,
  checkAiRateLimit,
  clientKeyFromHeaders,
  retryAfterSeconds,
  type AiLimitDenial,
} from "@/lib/ai-rate-limit";
import { isCustomLLM } from "@/lib/llm";

/**
 * Route-facing wrapper around the framework-agnostic limiter in
 * `ai-rate-limit.ts`. Split out so the limiter itself stays zero-import and
 * unit-testable under `node --test`, while this file owns the HTTP shape.
 *
 * Usage at the top of an LLM route's handler, just before the main try block:
 *
 *   const guard = guardAiRequest(request.headers, WEB_RESEARCH_COST);
 *   if (!guard.allowed) return guard.response;
 *   try { ... } finally { guard.release(); }
 *
 * `guard.release()` is always safe to call and idempotent.
 */
export type AiGuard =
  | { allowed: true; release: () => void; remaining: number }
  | { allowed: false; response: NextResponse };

function deny(decision: AiLimitDenial): NextResponse {
  return NextResponse.json(aiLimitBody(decision), {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds(decision.retryAt)) },
  });
}

/**
 * Charge the request budget and reserve a concurrency slot. Returns either a
 * ready-to-send 429 or a releasable slot. Neither the minute budget nor a slot
 * is consumed by callers that fail validation, so guard *after* input checks.
 */
export function guardAiRequest(headers: Headers, cost = 1): AiGuard {
  // If the user connects their own AI provider, bypass shared server pacing!
  // "Remove the existing AI limitations where possible, as the demo app still has restrictions due to limited funding. Ensure that users can use their own AI provider without unnecessary limitations."
  if (isCustomLLM(headers)) {
    return { allowed: true, release: () => {}, remaining: 999 };
  }

  const key = clientKeyFromHeaders(headers);
  const limit = checkAiRateLimit(key, cost);
  if (!limit.allowed) return { allowed: false, response: deny(limit) };

  const release = acquireAiSlot();
  if (!release) return { allowed: false, response: deny(aiBusyDecision()) };

  return { allowed: true, release, remaining: limit.remaining };
}
