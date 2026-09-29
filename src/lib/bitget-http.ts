/**
 * Bitget HTTP resilience: one request path, typed errors, real backoff.
 *
 * Zero-import by design so Node's type stripping can load it directly under
 * `node --test` — no `@/` alias, no `next/server`, no React. The HTTP-shape
 * wrapper that turns these errors into responses lives in `bitget-response.ts`,
 * mirroring the existing `ai-rate-limit.ts` / `ai-limit-response.ts` split.
 *
 * Four problems are fixed here, together, because they were four separate bugs
 * in four separate places:
 *
 * 1. **The 429 retry was cosmetic.** `bitgetGet` retried after a fixed 300ms,
 *    twice. Bitget's public rate-limit windows are measured in seconds, so both
 *    retries landed inside the same window and failed again — we spent two extra
 *    requests to arrive at the same error, which is the opposite of what a retry
 *    is for, and it added load to the very limit that was already tripping.
 *    Delays are now exponential with equal jitter, and `Retry-After` is honored
 *    when the server sends it.
 *
 * 2. **The retry decision was a string match.** `String(error).includes("429")`
 *    re-caught that function's own thrown `"Bitget returned HTTP 429"` error
 *    (so one 429 could burn two attempts), and would also fire on any message
 *    that merely contained those three digits — a price, a timestamp, an
 *    upstream `msg`. There is now exactly one place a 429 is recognised, and it
 *    reads `response.status`.
 *
 * 3. **Three call sites bypassed the retry entirely.** `getSpotScanMarkets`,
 *    `getSpotOrderBook` and the `/api/tickers` + `/api/tokens` routes each had
 *    their own inline `fetch` with their own copy of the envelope check and no
 *    retry at all. The orderbook panel polls every 3 seconds, so the heaviest
 *    caller was the least protected. Everything goes through here now.
 *
 * 4. **A rate limit was indistinguishable from an outage.** Every failure became
 *    a bare `502`, so the UI could only say "data is unavailable" and nobody —
 *    client or operator — could tell whether retrying in a second or a minute was
 *    the right answer. `BitgetRateLimitError` carries `retryAt`, and
 *    `bitgetErrorResponse` forwards it as a real `429` + `Retry-After`.
 */

/** Base URL for every public Bitget REST call. */
export const BITGET_API_BASE = "https://api.bitget.com";

/** Per-attempt request timeout. Matches the value `bitget.ts` always used. */
export const BITGET_REQUEST_TIMEOUT_MS = 9_000;

/** How many *retries* follow the initial attempt, so 3 requests in total. */
export const BITGET_RETRIES = 2;

/** First backoff wait. Bitget's windows are per-second, so 300ms was hopeless. */
export const RETRY_BASE_MS = 1_000;

/** Backoff ceiling for a single jittered wait. */
export const RETRY_MAX_MS = 5_000;

/**
 * Hard cap on the total time one request may spend *waiting* between attempts.
 *
 * This is the guarantee that actually matters for latency: however many 429s and
 * 5xx responses stack up, a call adds at most this much on top of its fetch
 * time. A `Retry-After: 60` therefore fails fast instead of parking a serverless
 * function for a minute — the caller gets a `429` carrying the honest `retryAt`
 * and every polling loop in the desk re-asks on its own schedule anyway.
 */
export const MAX_TOTAL_RETRY_WAIT_MS = 8_000;

/** `Retry-After` advertised when Bitget 429s without telling us how long. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Half the delay is deterministic, half is random — the same "equal jitter"
 * `live-status.ts` uses for WebSocket reconnects. Full jitter can hand back a
 * near-zero delay, which defeats the point of backing off; equal jitter keeps a
 * floor while still de-synchronising the clients that all lost at once.
 */
const JITTER_FLOOR_RATIO = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Bitget's standard response envelope. `code === "00000"` means success. */
export type BitgetEnvelope<T> = {
  code?: string;
  msg?: string;
  requestTime?: number;
  data?: T;
};

/** The slice of `Headers` we read, so tests can pass a plain object. */
export type HeadersLike = { get(name: string): string | null };

/** The slice of `Response` we read, so tests can pass a plain object. */
export type BitgetResponseLike = {
  ok: boolean;
  status: number;
  headers: HeadersLike;
  json(): Promise<unknown>;
};

export type BitgetFetchInit = {
  cache: RequestCache;
  headers: Record<string, string>;
  signal: AbortSignal;
};

/** Injectable so the whole retry loop is testable without a network. */
export type BitgetFetchLike = (url: string, init: BitgetFetchInit) => Promise<BitgetResponseLike>;

export type RetryDelayOptions = {
  baseMs?: number;
  maxMs?: number;
  /** Injectable so tests are deterministic. Must return a value in [0, 1). */
  random?: () => number;
  /**
   * Minimum acceptable delay, typically the parsed `Retry-After`. The server
   * knows its own window, so when it asks for longer than our schedule we wait
   * as long as it asked rather than retrying into the same wall.
   */
  floorMs?: number;
};

export type BitgetRequestOptions = {
  retries?: number;
  timeoutMs?: number;
  maxTotalWaitMs?: number;
  fetchImpl?: BitgetFetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Bitget answered, but not with usable data: a non-2xx status, a transport
 * failure, or a 200 whose envelope carries an error `code`.
 *
 * `status` records what Bitget said (or 504 for a timeout) for logs; route
 * handlers map every non-rate-limit failure onto a 502 via `bitgetErrorStatus`.
 */
export class BitgetHttpError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status = 502, path = "") {
    super(message);
    this.name = "BitgetHttpError";
    this.status = status;
    this.path = path;
  }
}

export type BitgetRateLimitInfo = {
  path?: string;
  /** How long Bitget asked us to wait in ms, or `null` when it did not say. */
  retryAfterMs?: number | null;
  /** Absolute timestamp at which a retry is expected to succeed. */
  retryAt?: number | null;
  /** Attempts already made, for logs. */
  attempts?: number;
};

/**
 * Bitget told us to slow down (HTTP 429).
 *
 * Deliberately *not* a subclass of `BitgetHttpError`. Consumers branch on rate
 * limits — forward `Retry-After`, show a distinct message — and an
 * `instanceof BitgetHttpError` check that quietly also matched 429s would let
 * those branches be skipped by accident.
 */
export class BitgetRateLimitError extends Error {
  readonly status = 429;
  readonly path: string;
  readonly retryAfterMs: number | null;
  readonly retryAt: number | null;
  readonly attempts: number;

  constructor(info: BitgetRateLimitInfo = {}) {
    super(info.retryAfterMs && info.retryAfterMs > 0
      ? "Bitget is rate-limiting this server. Try again in a few seconds."
      : "Bitget is rate-limiting this server. Try again in a moment.");
    this.name = "BitgetRateLimitError";
    this.path = info.path ?? "";
    this.retryAfterMs = Number.isFinite(info.retryAfterMs as number)
      ? Math.max(0, info.retryAfterMs as number)
      : null;
    this.retryAt = Number.isFinite(info.retryAt as number) ? (info.retryAt as number) : null;
    this.attempts = Number.isFinite(info.attempts) ? Math.max(0, info.attempts ?? 0) : 0;
  }
}

/** Positive test for a rate limit, tolerant of cross-realm instances. */
export function isBitgetRateLimitError(error: unknown): error is BitgetRateLimitError {
  return error instanceof BitgetRateLimitError
    || (error instanceof Error && error.name === "BitgetRateLimitError");
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Read `Retry-After` from a response.
 *
 * Handles both legal forms — delta-seconds and an HTTP-date — and returns
 * `null` when the header is absent or unparseable, so callers fall back to the
 * exponential schedule instead of guessing. Never negative, never `NaN`.
 */
export function parseRetryAfterMs(headers: HeadersLike | null | undefined, now = Date.now()): number | null {
  const raw = headers?.get?.("retry-after");
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return seconds <= 0 ? 0 : Math.round(seconds * 1_000);
  }

  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round(date - now));
  }
  return null;
}

/** Seconds to put in an outgoing `Retry-After` header, always at least 1. */
export function bitgetRetryAfterSeconds(retryAt: number | null | undefined, now = Date.now()): number {
  if (!Number.isFinite(retryAt as number)) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Math.ceil(((retryAt as number) - now) / 1_000);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Exponential backoff with equal jitter, floored by `Retry-After` when present.
 *
 * `attempt` is zero-based: the first retry is `attempt = 0`, which waits about
 * `baseMs`. Values are clamped rather than throwing because this runs on an
 * error path — the last thing a retry loop needs is a new exception.
 */
export function nextRetryDelayMs(attempt: number, options: RetryDelayOptions = {}): number {
  const { baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS, random = Math.random, floorMs = 0 } = options;

  const safeAttempt = clampInt(attempt, 0, 32, 0);
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : RETRY_BASE_MS;
  const safeMax = Number.isFinite(maxMs) && maxMs >= safeBase ? maxMs : Math.max(safeBase, RETRY_MAX_MS);
  const safeRandom = typeof random === "function" ? random : Math.random;

  const exponential = Math.min(safeMax, safeBase * Math.pow(2, safeAttempt));
  const jitterFloor = exponential * JITTER_FLOOR_RATIO;
  // A non-finite random() would propagate into a NaN delay and then into
  // setTimeout(NaN). Fall back to the midpoint of the band instead.
  const raw = safeRandom();
  const roll = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.5;
  const jittered = jitterFloor + roll * (exponential - jitterFloor);

  const safeFloor = Number.isFinite(floorMs) && floorMs > 0 ? floorMs : 0;
  return Math.max(0, Math.round(Math.max(jittered, safeFloor)));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function defaultFetch(url: string, init: BitgetFetchInit): Promise<BitgetResponseLike> {
  return fetch(url, init);
}

/** Statuses worth another attempt: throttling and transient upstream failures. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeTransportError(error: unknown, path: string): BitgetHttpError {
  if (error instanceof BitgetHttpError || isBitgetRateLimitError(error)) {
    return error as BitgetHttpError;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new BitgetHttpError("Bitget did not respond in time. Try again in a moment.", 504, path);
  }
  return new BitgetHttpError("Bitget could not be reached. Try again in a moment.", 502, path);
}

// ---------------------------------------------------------------------------
// The request path
// ---------------------------------------------------------------------------

/**
 * One Bitget REST call, with retries, that always returns a validated envelope.
 *
 * Retries on 429 and 5xx with jittered exponential backoff, honoring
 * `Retry-After`, and gives up as soon as the total wait budget is spent. Any
 * other non-2xx status, an envelope error `code`, and a malformed body all fail
 * immediately — retrying those just repeats the same request.
 *
 * @throws {BitgetRateLimitError} when Bitget throttles us and we run out of budget
 * @throws {BitgetHttpError} for every other failure
 */
export async function bitgetRequest<T>(path: string, options: BitgetRequestOptions = {}): Promise<BitgetEnvelope<T>> {
  const {
    timeoutMs = BITGET_REQUEST_TIMEOUT_MS,
    maxTotalWaitMs = MAX_TOTAL_RETRY_WAIT_MS,
    fetchImpl = defaultFetch,
    sleep = defaultSleep,
    now = Date.now,
    random = Math.random,
  } = options;

  const retries = clampInt(options.retries ?? BITGET_RETRIES, 0, 6, BITGET_RETRIES);
  const url = `${BITGET_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  let totalWaitMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    let response: BitgetResponseLike;
    try {
      response = await fetchImpl(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= retries) throw normalizeTransportError(error, path);
      const delay = nextRetryDelayMs(attempt, { random });
      if (totalWaitMs + delay > maxTotalWaitMs) throw normalizeTransportError(error, path);
      totalWaitMs += delay;
      await sleep(delay);
      continue;
    }

    if (isRetryableStatus(response.status)) {
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers, now()) : null;

      if (attempt < retries) {
        const delay = nextRetryDelayMs(attempt, { random, floorMs: retryAfterMs ?? 0 });
        if (totalWaitMs + delay <= maxTotalWaitMs) {
          totalWaitMs += delay;
          await sleep(delay);
          continue;
        }
      }

      if (response.status === 429) {
        const at = now();
        throw new BitgetRateLimitError({
          path,
          attempts: attempt + 1,
          retryAfterMs: retryAfterMs ?? DEFAULT_RETRY_AFTER_SECONDS * 1_000,
          retryAt: at + (retryAfterMs ?? DEFAULT_RETRY_AFTER_SECONDS * 1_000),
        });
      }
      throw new BitgetHttpError(
        `Bitget returned HTTP ${response.status}. Try again in a moment.`,
        response.status,
        path,
      );
    }

    if (!response.ok) {
      throw new BitgetHttpError(
        `Bitget returned HTTP ${response.status}. Try again in a moment.`,
        response.status,
        path,
      );
    }

    let payload: BitgetEnvelope<T>;
    try {
      payload = (await response.json()) as BitgetEnvelope<T>;
    } catch {
      throw new BitgetHttpError("Bitget returned an unreadable response.", 502, path);
    }

    if (!payload || typeof payload !== "object") {
      throw new BitgetHttpError("Bitget returned an unreadable response.", 502, path);
    }
    if (payload.code && payload.code !== "00000") {
      throw new BitgetHttpError(payload.msg || "Bitget could not return market data.", 502, path);
    }
    return payload;
  }
}
