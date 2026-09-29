import { NextResponse } from "next/server";
import {
  bitgetRetryAfterSeconds,
  isBitgetRateLimitError,
  BitgetHttpError,
  type BitgetRateLimitError,
} from "@/lib/bitget-http";

/**
 * Route-facing wrapper around the framework-agnostic Bitget resilience layer in
 * `bitget-http.ts`. Split out so that module stays zero-import and unit-testable
 * under `node --test`, while this one owns the HTTP shape — the same division as
 * `ai-rate-limit.ts` / `ai-limit-response.ts`.
 *
 * Every Bitget-backed route handler previously had a hand-rolled `catch` that
 * mapped *any* failure onto a `502`, so a rate limit looked identical to an
 * outage and the `Retry-After` Bitget sent us was thrown away. Use this instead:
 *
 *   } catch (error) {
 *     return bitgetErrorResponse(error, "Market data is unavailable.");
 *   }
 *
 * A throttle now becomes a real `429` carrying `Retry-After` and a `retryAt`
 * field, which lets the client back off on the server's schedule instead of
 * guessing, and lets anyone reading the network tab tell the two cases apart.
 */

/** HTTP status to answer with for a given Bitget failure. */
export function bitgetErrorStatus(error: unknown): number {
  return isBitgetRateLimitError(error) ? 429 : 502;
}

/**
 * Turn a Bitget failure into a response.
 *
 * @param fallback message used when `error` carries nothing user-presentable
 */
export function bitgetErrorResponse(error: unknown, fallback: string): NextResponse {
  if (isBitgetRateLimitError(error)) {
    const rateLimit = error as BitgetRateLimitError;
    const retryAfter = bitgetRetryAfterSeconds(rateLimit.retryAt);
    return NextResponse.json(
      {
        error: rateLimit.message,
        rateLimited: true,
        retryAt: rateLimit.retryAt ?? Date.now() + retryAfter * 1_000,
        retryAfterSeconds: retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const message =
    (error instanceof BitgetHttpError && error.message) ||
    (error instanceof Error && error.message) ||
    fallback;
  return NextResponse.json({ error: message }, { status: 502 });
}
