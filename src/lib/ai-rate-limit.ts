/**
 * Server-side pacing for the three LLM-backed routes (`/api/research`,
 * `/api/backtest`, `/api/copilot/chat`).
 *
 * Why this exists: the desk is public, the provider key is server-side, and
 * every one of these routes may hold a serverless function for up to 300s of
 * billable duration. The only throttle before this lived in localStorage
 * (`goriee.ai-cooldown.v1`), which any caller can bypass by not being a
 * browser. Input *shape* was already well validated; this is about volume.
 *
 * Two independent guards, both applied before any upstream call:
 *
 *  1. A fixed-window request budget per connection, measured over a minute and
 *     an hour. The hourly window is what stops a sustained loop; the minute
 *     window is what stops a burst.
 *  2. A global cap on requests in flight. A slow reasoning model can occupy a
 *     slot for minutes, so "requests per minute" alone badly underestimates
 *     the cost of a caller that never waits for a response. This cap is the
 *     guard that actually bounds concurrent billable duration.
 *
 * Deliberate limitations, so nobody is surprised later:
 *
 *  - The counters live in module scope, which on serverless means *per
 *    instance*, not globally. Requests from one connection usually land on the
 *    same warm instance, so this catches real-world abuse (a crawler, a retry
 *    loop, a curious visitor with `curl`). It will not catch a caller who
 *    deliberately sprays traffic to force scale-out. Swapping in Redis via
 *    `setRateLimitStore(...)` makes the *request budget* global without the
 *    routes changing; note that the concurrency slot is deliberately a plain
 *    counter and stays per-instance either way, so a global cap would need its
 *    own distributed counter.
 *  - Fixed windows allow up to 2x the limit straddling a boundary. The hourly
 *     cap bounds that, and the concurrency cap makes the burst harmless.
 *
 * Rejections are returned as plain objects rather than thrown, matching
 * `aiErrorResponse` in `ai-errors.ts`: the route decides how to serialise.
 *
 * The messages below are written to be shown verbatim. They intentionally
 * avoid the strings "429" and "rate limit", because `researchErrorMessage` in
 * `desk-shared.ts` rewrites any message matching `/\b429\b|rate.?limit/i` into
 * "The AI provider is temporarily limiting requests" — which would send the
 * user off to check a provider quota that has nothing to do with this.
 */

/** One fixed window's tally. `resetAt` is an epoch-ms timestamp. */
export type WindowHit = { count: number; resetAt: number };

/**
 * Storage seam. Implement this against Redis/Upstash to make the budget global
 * across instances; nothing else has to change.
 */
export type RateLimitStore = {
  /** Add `cost` to `key`'s tally for a window of `windowMs`, starting a new window if the old one expired. */
  record(key: string, windowMs: number, cost: number, now: number): WindowHit;
  /** Drop every counter. Used by tests. */
  clear(): void;
};

/** The rejection branch of {@link AiLimitDecision}. */
export type AiLimitDenial = { allowed: false; retryAt: number; error: string };

export type AiLimitDecision =
  | { allowed: true; remaining: number; resetAt: number }
  | AiLimitDenial;

export type AiBudget = {
  /** Per-connection requests allowed in a rolling minute. */
  perMinute: number;
  /** Per-connection requests allowed in a rolling hour. */
  perHour: number;
  /** Maximum requests executing an upstream LLM call at the same time. */
  concurrency: number;
};

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/**
 * A human clicks "Run research" and then waits 20-60s for a reasoning model.
 * Six in a minute is already far more than a person can trigger by hand, while
 * a `while true; do curl ...` loop hits the concurrency cap on its fifth
 * iteration and the hourly cap shortly after.
 */
export const DEFAULT_BUDGET: AiBudget = { perMinute: 6, perHour: 40, concurrency: 4 };

/**
 * Live web research fans out to several upstream news fetches per call, so it
 * is charged twice against the same budget instead of getting its own window.
 */
export const WEB_RESEARCH_COST = 2;

/**
 * Ceiling on distinct tracked keys. This module runs on a public URL, so an
 * attacker can invent unbounded keys just by rotating `x-forwarded-for`;
 * without this the limiter would itself become the memory leak.
 */
const MAX_TRACKED_KEYS = 10_000;

function createMemoryStore(): RateLimitStore {
  const counters = new Map<string, WindowHit>();
  return {
    record(key, windowMs, cost, now) {
      if (counters.size >= MAX_TRACKED_KEYS) prune(counters, now);
      const composite = `${key}:${windowMs}`;
      const existing = counters.get(composite);
      if (!existing || now >= existing.resetAt) {
        const fresh = { count: cost, resetAt: now + windowMs };
        counters.set(composite, fresh);
        return fresh;
      }
      existing.count += cost;
      return existing;
    },
    clear() {
      counters.clear();
    },
  };
}

/**
 * Drop expired windows first; if that is not enough, evict oldest-inserted.
 * Map iteration order is insertion order, so the front is the stalest key.
 */
function prune(counters: Map<string, WindowHit>, now: number): void {
  for (const [key, hit] of counters) {
    if (now >= hit.resetAt) counters.delete(key);
  }
  while (counters.size >= MAX_TRACKED_KEYS) {
    const oldest = counters.keys().next();
    if (oldest.done) break;
    counters.delete(oldest.value);
  }
}

let store: RateLimitStore = createMemoryStore();

/**
 * Replace the counter store — pass `null` to restore the in-memory default.
 * This is the seam for a global (Redis) budget; the routes never see it.
 */
export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next ?? createMemoryStore();
}

function intFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Budget with env overrides, read per call so tests and deploys can tune it. */
export function aiBudgetFromEnv(): AiBudget {
  if (process.env.AI_RATE_LIMIT_DISABLED === "1") {
    return { perMinute: Number.MAX_SAFE_INTEGER, perHour: Number.MAX_SAFE_INTEGER, concurrency: Number.MAX_SAFE_INTEGER };
  }
  return {
    perMinute: intFromEnv("AI_RATE_LIMIT_PER_MINUTE", DEFAULT_BUDGET.perMinute),
    perHour: intFromEnv("AI_RATE_LIMIT_PER_HOUR", DEFAULT_BUDGET.perHour),
    concurrency: intFromEnv("AI_RATE_LIMIT_CONCURRENCY", DEFAULT_BUDGET.concurrency),
  };
}

/**
 * Identify a connection. On Vercel `x-forwarded-for` is always populated and
 * holds the client IP first; `x-real-ip` covers other hosts. When neither is
 * present — local `next dev` — every request shares one bucket, which is the
 * safe direction: it can only ever be stricter, never looser.
 *
 * The value is attacker-controllable, so it is length-capped before use as a
 * Map key and never logged or echoed back.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  const candidate = first || headers.get("x-real-ip")?.trim() || "";
  if (!candidate) return "local";
  return candidate.slice(0, 64);
}

/**
 * Charge `cost` against the caller's minute and hour budgets.
 *
 * A request that is denied still lands in the counters it already passed. That
 * is harmless here: with fixed windows a denial cannot push `resetAt` later,
 * so a rejected caller never extends their own lockout.
 */
export function checkAiRateLimit(key: string, cost = 1, now = Date.now(), budget = aiBudgetFromEnv()): AiLimitDecision {
  const windows: Array<{ windowMs: number; limit: number }> = [
    { windowMs: MINUTE_MS, limit: budget.perMinute },
    { windowMs: HOUR_MS, limit: budget.perHour },
  ];
  let minuteCount = 0;
  let minuteResetAt = now + MINUTE_MS;
  for (const { windowMs, limit } of windows) {
    const hit = store.record(key, windowMs, cost, now);
    if (hit.count > limit) {
      return {
        allowed: false,
        retryAt: hit.resetAt,
        error:
          "The desk is pacing AI requests from this connection to protect the shared provider budget. Your input is saved; the countdown shows when you can run this again.",
      };
    }
    if (windowMs === MINUTE_MS) {
      minuteCount = hit.count;
      minuteResetAt = hit.resetAt;
    }
  }
  return { allowed: true, remaining: Math.max(0, budget.perMinute - minuteCount), resetAt: minuteResetAt };
}

/**
 * Take a concurrency slot, or `null` if the cap is already reached.
 * The returned function releases it and is idempotent, so a `finally` block can
 * call it without caring whether release already happened.
 */
let inFlight = 0;

export function acquireAiSlot(budget = aiBudgetFromEnv()): (() => void) | null {
  if (inFlight >= budget.concurrency) return null;
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** Requests currently holding a slot. Useful in logs and tests. */
export function aiSlotsInUse(): number {
  return inFlight;
}

export function aiBusyDecision(retryAt: number = Date.now() + 20_000): AiLimitDenial {
  return {
    allowed: false,
    retryAt,
    error:
      "The desk is already running the maximum number of AI requests at once. Your input is saved; try again in a moment.",
  };
}

/**
 * JSON body for a rejection. `retryAt` is what the client reads:
 * `trading-desk.tsx` and `strategy-copilot.tsx` both feed it straight into the
 * existing cooldown state, which drives the `<RequestRecovery>` countdown and
 * disables the submit button. No frontend change was needed for this.
 */
export function aiLimitBody(decision: AiLimitDenial): { error: string; retryAt: number } {
  return { error: decision.error, retryAt: decision.retryAt };
}

/** Whole seconds until `retryAt`, for the standard `Retry-After` header. */
export function retryAfterSeconds(retryAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((retryAt - now) / 1000));
}

/** Test seam: clear counters, release slots, restore the in-memory store. */
export function resetAiRateLimitForTests(): void {
  store.clear();
  setRateLimitStore(null);
  inFlight = 0;
}
