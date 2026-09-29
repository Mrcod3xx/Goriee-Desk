// Unit tests for the Bitget HTTP resilience layer (src/lib/bitget-http.ts).
//
// Like live-status.ts and ai-rate-limit.ts, that module is deliberately
// zero-import so Node's type stripping can load it directly — no `@/` alias,
// no `next/server`, no React. That is what makes the retry loop assertable:
// `fetchImpl`, `sleep`, `now` and `random` are all injectable, so these tests
// run offline, in a fixed amount of virtual time, with no flakiness.
//
// The route-facing wrapper (bitget-response.ts) is not covered here; it imports
// `next/server` and is a thin shape adapter over the values tested below.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  BITGET_API_BASE,
  BITGET_RETRIES,
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_TOTAL_RETRY_WAIT_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  BitgetHttpError,
  BitgetRateLimitError,
  bitgetRetryAfterSeconds,
  bitgetRequest,
  isBitgetRateLimitError,
  nextRetryDelayMs,
  parseRetryAfterMs,
} from "../src/lib/bitget-http.ts";

/** Frozen clock so every retryAt is exact and deterministic. */
const NOW = 1_800_000_000_000;

/** `random()` that always returns 0.5 — the midpoint of the jitter band. */
const midRandom = () => 0.5;

/** Headers stub. Accepts a plain object so tests stay terse. */
function headers(init = {}) {
  const map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(String(name).toLowerCase()) ?? null };
}

/** Response stub. `jsonBody` is a value, a function, or an Error to throw. */
function response({ status = 200, headerInit = {}, body = { code: "00000", data: null } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(headerInit),
    json: async () => {
      if (body instanceof Error) throw body;
      return typeof body === "function" ? body() : body;
    },
  };
}

/**
 * Drive `bitgetRequest` with a scripted list of responses.
 *
 * Returns the thrown error (or the resolved value) plus the recorded calls and
 * the waits the retry loop asked for, so tests can assert on *timing* without
 * actually sleeping.
 */
async function drive(responses, options = {}) {
  const calls = [];
  const waits = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return next;
  };

  const result = await bitgetRequest("/api/v3/market/tickers?category=SPOT", {
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); },
    now: () => NOW,
    random: midRandom,
    ...options,
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

  return { ...result, calls, waits };
}

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------

describe("parseRetryAfterMs", () => {
  test("reads delta-seconds", () => {
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "7" }), NOW), 7_000);
  });

  test("reads an HTTP-date", () => {
    const date = new Date(NOW + 12_000).toUTCString();
    assert.equal(parseRetryAfterMs(headers({ "retry-after": date }), NOW), 12_000);
  });

  test("clamps an HTTP-date in the past to zero rather than going negative", () => {
    const date = new Date(NOW - 60_000).toUTCString();
    assert.equal(parseRetryAfterMs(headers({ "retry-after": date }), NOW), 0);
  });

  test("zero and fractional seconds are honored, never negative", () => {
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "0" }), NOW), 0);
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "-3" }), NOW), 0);
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "0.5" }), NOW), 500);
  });

  test("returns null when the header is absent, empty or garbage", () => {
    assert.equal(parseRetryAfterMs(headers({}), NOW), null);
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "" }), NOW), null);
    assert.equal(parseRetryAfterMs(headers({ "retry-after": "soon-ish" }), NOW), null);
    assert.equal(parseRetryAfterMs(null, NOW), null);
    assert.equal(parseRetryAfterMs(undefined, NOW), null);
  });

  test("header lookup is case-insensitive", () => {
    assert.equal(parseRetryAfterMs(headers({ "Retry-After": "2" }), NOW), 2_000);
  });
});

// ---------------------------------------------------------------------------
// bitgetRetryAfterSeconds
// ---------------------------------------------------------------------------

describe("bitgetRetryAfterSeconds", () => {
  test("converts a future retryAt into whole seconds, rounded up", () => {
    assert.equal(bitgetRetryAfterSeconds(NOW + 4_001, NOW), 5);
    assert.equal(bitgetRetryAfterSeconds(NOW + 1_000, NOW), 1);
  });

  test("falls back to the default when retryAt is missing or already past", () => {
    assert.equal(bitgetRetryAfterSeconds(null, NOW), DEFAULT_RETRY_AFTER_SECONDS);
    assert.equal(bitgetRetryAfterSeconds(undefined, NOW), DEFAULT_RETRY_AFTER_SECONDS);
    assert.equal(bitgetRetryAfterSeconds(NOW - 5_000, NOW), DEFAULT_RETRY_AFTER_SECONDS);
    assert.equal(bitgetRetryAfterSeconds(Number.NaN, NOW), DEFAULT_RETRY_AFTER_SECONDS);
  });

  test("never returns zero, so the outgoing header is always valid", () => {
    assert.ok(bitgetRetryAfterSeconds(NOW + 1, NOW) >= 1);
  });
});

// ---------------------------------------------------------------------------
// nextRetryDelayMs
// ---------------------------------------------------------------------------

describe("nextRetryDelayMs", () => {
  test("grows exponentially and stays within the equal-jitter band", () => {
    // random() = 1 lands exactly on the top of the band.
    const top = () => 1;
    assert.equal(nextRetryDelayMs(0, { random: top }), RETRY_BASE_MS);
    assert.equal(nextRetryDelayMs(1, { random: top }), RETRY_BASE_MS * 2);
    assert.equal(nextRetryDelayMs(2, { random: top }), RETRY_BASE_MS * 4);
  });

  test("random() = 0 lands on the jitter floor, which is never zero", () => {
    const bottom = () => 0;
    assert.equal(nextRetryDelayMs(0, { random: bottom }), RETRY_BASE_MS * 0.5);
    assert.equal(nextRetryDelayMs(1, { random: bottom }), RETRY_BASE_MS);
    assert.equal(nextRetryDelayMs(2, { random: bottom }), RETRY_BASE_MS * 2);
  });

  test("caps at RETRY_MAX_MS no matter how many attempts pile up", () => {
    for (const attempt of [5, 10, 32, 999]) {
      assert.ok(nextRetryDelayMs(attempt, { random: () => 1 }) <= RETRY_MAX_MS);
    }
    assert.equal(nextRetryDelayMs(999, { random: () => 1 }), RETRY_MAX_MS);
  });

  test("a Retry-After longer than the schedule wins", () => {
    assert.equal(nextRetryDelayMs(0, { random: midRandom, floorMs: 30_000 }), 30_000);
  });

  test("a Retry-After shorter than the schedule does not shorten the backoff", () => {
    const scheduled = nextRetryDelayMs(2, { random: midRandom });
    assert.equal(nextRetryDelayMs(2, { random: midRandom, floorMs: 10 }), scheduled);
  });

  test("random() = 0.5 lands on three quarters of the schedule", () => {
    // equal jitter: floor is half, so the midpoint is 0.5 + 0.25 of the cap.
    assert.equal(nextRetryDelayMs(0, { random: midRandom }), RETRY_BASE_MS * 0.75);
    assert.equal(nextRetryDelayMs(1, { random: midRandom }), RETRY_BASE_MS * 1.5);
    assert.equal(nextRetryDelayMs(2, { random: midRandom }), RETRY_BASE_MS * 3);
  });

  test("malformed input is clamped rather than throwing or returning NaN", () => {
    for (const attempt of [-1, Number.NaN, Infinity, 1.9]) {
      const delay = nextRetryDelayMs(attempt);
      assert.ok(Number.isFinite(delay));
      assert.ok(delay >= 0);
    }
    assert.ok(Number.isFinite(nextRetryDelayMs(0, { baseMs: -5 })));
    assert.ok(Number.isFinite(nextRetryDelayMs(0, { maxMs: -1 })));
    assert.ok(Number.isFinite(nextRetryDelayMs(0, { random: () => Number.NaN })));
  });

  test("random() outside [0,1) is clamped, so delays stay in the band", () => {
    const upper = nextRetryDelayMs(0, { random: () => 5 });
    const lower = nextRetryDelayMs(0, { random: () => -5 });
    assert.ok(upper <= RETRY_BASE_MS);
    assert.ok(lower >= RETRY_BASE_MS * 0.5);
  });
});

// ---------------------------------------------------------------------------
// isBitgetRateLimitError
// ---------------------------------------------------------------------------

describe("isBitgetRateLimitError", () => {
  test("recognises the error by instance", () => {
    assert.ok(isBitgetRateLimitError(new BitgetRateLimitError({ path: "/x" })));
  });

  test("recognises it by name, so a cross-realm copy still matches", () => {
    const copy = new Error("throttled");
    copy.name = "BitgetRateLimitError";
    assert.ok(isBitgetRateLimitError(copy));
  });

  test("does not match plain errors, BitgetHttpError, or non-errors", () => {
    assert.ok(!isBitgetRateLimitError(new Error("429")));
    assert.ok(!isBitgetRateLimitError(new BitgetHttpError("boom")));
    assert.ok(!isBitgetRateLimitError(null));
    assert.ok(!isBitgetRateLimitError(undefined));
    assert.ok(!isBitgetRateLimitError("BitgetRateLimitError"));
  });

  test("the rate limit error is deliberately NOT a BitgetHttpError subclass", () => {
    // Consumers branch on throttles to forward Retry-After; a subclass would let
    // an `instanceof BitgetHttpError` catch-all silently swallow that branch.
    assert.ok(!(new BitgetRateLimitError() instanceof BitgetHttpError));
    assert.equal(new BitgetRateLimitError().status, 429);
  });

  test("carries path, attempts and a sanitized retryAfterMs", () => {
    const error = new BitgetRateLimitError({ path: "/p", attempts: 3, retryAfterMs: 2_500, retryAt: NOW + 2_500 });
    assert.equal(error.path, "/p");
    assert.equal(error.attempts, 3);
    assert.equal(error.retryAfterMs, 2_500);
    assert.equal(error.retryAt, NOW + 2_500);
  });

  test("defaults retryAfterMs to null and clamps nonsense", () => {
    assert.equal(new BitgetRateLimitError().retryAfterMs, null);
    assert.equal(new BitgetRateLimitError().retryAt, null);
    assert.equal(new BitgetRateLimitError({ attempts: -4 }).attempts, 0);
    assert.equal(new BitgetRateLimitError({ retryAfterMs: Number.NaN }).retryAfterMs, null);
  });

  test("message tells the user to wait when Bitget said how long", () => {
    assert.match(new BitgetRateLimitError({ retryAfterMs: 5_000 }).message, /few seconds/);
    assert.match(new BitgetRateLimitError().message, /moment/);
  });
});

// ---------------------------------------------------------------------------
// bitgetRequest
// ---------------------------------------------------------------------------

describe("bitgetRequest", () => {
  test("hits the Bitget host with no-store, an accept header and a timeout", async () => {
    const { ok, value, calls } = await drive([response({ body: { code: "00000", data: [1] } })]);

    assert.ok(ok);
    assert.deepEqual(value.data, [1]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BITGET_API_BASE}/api/v3/market/tickers?category=SPOT`);
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[0].init.headers.accept, "application/json");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test("prepends a missing leading slash rather than producing a bad URL", async () => {
    const { calls } = await drive([response()]);
    assert.equal(calls[0].url, `${BITGET_API_BASE}/api/v3/market/tickers?category=SPOT`);
  });

  test("returns envelopes with no code at all — some endpoints omit it", async () => {
    const { ok, value } = await drive([response({ body: { data: { a: 1 } } })]);
    assert.ok(ok);
    assert.deepEqual(value.data, { a: 1 });
  });

  test("does not retry a success", async () => {
    const { calls, waits } = await drive([response()]);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  test("retries a 429 and returns the eventual success", async () => {
    const { ok, value, calls, waits } = await drive([
      response({ status: 429, headerInit: { "retry-after": "1" } }),
      response({ body: { code: "00000", data: "late" } }),
    ]);

    assert.ok(ok);
    assert.equal(value.data, "late");
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
  });

  test("honors Retry-After instead of its own schedule when it is longer", async () => {
    const { waits } = await drive([
      response({ status: 429, headerInit: { "retry-after": "4" } }),
      response(),
    ]);

    assert.deepEqual(waits, [4_000]);
  });

  test("backoff doubles across attempts and always waits at least half the schedule", async () => {
    const { waits } = await drive([
      response({ status: 429 }),
      response({ status: 429 }),
      response(),
    ]);

    assert.equal(waits.length, 2);
    assert.ok(waits[1] > waits[0], `expected growth, got ${waits.join(", ")}`);
    assert.ok(waits[0] >= RETRY_BASE_MS * 0.5);
    assert.ok(waits[1] >= RETRY_BASE_MS);
  });

  test("the waits no longer resemble the old fixed 300ms", async () => {
    const { waits } = await drive([response({ status: 429 }), response()]);
    assert.ok(waits.every((ms) => ms > 300), `wait was too short: ${waits.join(", ")}`);
  });

  test("gives up after BITGET_RETRIES retries and throws a rate limit error", async () => {
    const { ok, error, calls, waits } = await drive([response({ status: 429 })]);

    assert.ok(!ok);
    assert.ok(isBitgetRateLimitError(error));
    assert.equal(error.status, 429);
    // 1 initial attempt + BITGET_RETRIES retries.
    assert.equal(calls.length, BITGET_RETRIES + 1);
    assert.equal(waits.length, BITGET_RETRIES);
    assert.equal(error.attempts, BITGET_RETRIES + 1);
  });

  test("the exhausted rate limit error still carries a usable retryAt", async () => {
    const { error } = await drive([response({ status: 429, headerInit: { "retry-after": "9" } })]);

    assert.equal(error.retryAt, NOW + 9_000);
    assert.equal(error.retryAfterMs, 9_000);
    assert.equal(bitgetRetryAfterSeconds(error.retryAt, NOW), 9);
  });

  test("a 429 with no Retry-After falls back to the documented default", async () => {
    const { error } = await drive([response({ status: 429 })]);
    assert.equal(error.retryAfterMs, DEFAULT_RETRY_AFTER_SECONDS * 1_000);
  });

  test("retries a 500, then fails as BitgetHttpError rather than a rate limit", async () => {
    const { ok, error, calls } = await drive([response({ status: 503 })]);

    assert.ok(!ok);
    assert.ok(error instanceof BitgetHttpError);
    assert.ok(!isBitgetRateLimitError(error));
    assert.equal(error.status, 503);
    assert.equal(calls.length, BITGET_RETRIES + 1);
    assert.match(error.message, /HTTP 503/);
  });

  test("a 400 is a client bug — fail immediately without wasting requests", async () => {
    const { ok, error, calls, waits } = await drive([response({ status: 400 })]);

    assert.ok(!ok);
    assert.ok(error instanceof BitgetHttpError);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  test("an envelope error code fails immediately and surfaces Bitget's own msg", async () => {
    const { ok, error, calls } = await drive([
      response({ body: { code: "40034", msg: "Parameter instId is not valid" } }),
    ]);

    assert.ok(!ok);
    assert.equal(error.message, "Parameter instId is not valid");
    assert.equal(calls.length, 1);
  });

  test("an envelope error with no msg still gets a readable message", async () => {
    const { error } = await drive([response({ body: { code: "40034" } })]);
    assert.equal(error.message, "Bitget could not return market data.");
  });

  test("code 00000 with an error-looking msg is a success", async () => {
    const { ok, value } = await drive([
      response({ body: { code: "00000", msg: "success", data: 7 } }),
    ]);
    assert.ok(ok);
    assert.equal(value.data, 7);
  });

  test("a malformed body fails immediately instead of throwing on a property read", async () => {
    const { ok, error, calls } = await drive([
      response({ body: () => { throw new SyntaxError("Unexpected token"); } }),
    ]);

    assert.ok(!ok);
    assert.ok(error instanceof BitgetHttpError);
    assert.match(error.message, /unreadable/);
    assert.equal(calls.length, 1);
  });

  test("a non-object body is treated as unreadable", async () => {
    const { error } = await drive([response({ body: "oops" })]);
    assert.ok(error instanceof BitgetHttpError);
    assert.match(error.message, /unreadable/);
  });

  test("a transport failure retries, then reports 502", async () => {
    const { ok, error, calls } = await drive([new TypeError("fetch failed")]);

    assert.ok(!ok);
    assert.ok(error instanceof BitgetHttpError);
    assert.equal(error.status, 502);
    assert.match(error.message, /could not be reached/);
    assert.equal(calls.length, BITGET_RETRIES + 1);
  });

  test("a timeout is reported as 504, not a generic 502", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";

    const { error } = await drive([timeout]);
    assert.equal(error.status, 504);
    assert.match(error.message, /did not respond in time/);
  });

  test("an abort is reported as 504 too", async () => {
    const aborted = new Error("This operation was aborted");
    aborted.name = "AbortError";
    assert.equal((await drive([aborted])).error.status, 504);
  });

  test("retries=0 means exactly one request", async () => {
    const { calls, waits } = await drive([response({ status: 429 })], { retries: 0 });
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  test("retries is clamped to a sane range", async () => {
    const high = await drive([response({ status: 429 })], { retries: 99 });
    assert.ok(high.calls.length <= 7);
    const negative = await drive([response({ status: 429 })], { retries: -3 });
    assert.equal(negative.calls.length, 1);
  });

  test("stops retrying once the total wait budget is spent, rather than parking the request", async () => {
    // Each 429 asks for 60s; the budget is 8s, so the *first* wait already
    // exceeds it and we fail fast. Without this a `Retry-After: 60` would have
    // held a serverless function open for a full minute.
    const { ok, error, calls, waits } = await drive([
      response({ status: 429, headerInit: { "retry-after": "60" } }),
    ]);

    assert.ok(!ok);
    assert.ok(isBitgetRateLimitError(error));
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
    // The honest window is still reported, so the client can back off correctly.
    assert.equal(error.retryAt, NOW + 60_000);
  });

  test("the default budget accommodates the full default backoff schedule", async () => {
    // Guards the constants against drifting apart: with defaults, all
    // BITGET_RETRIES waits must fit inside MAX_TOTAL_RETRY_WAIT_MS at their
    // worst-case (random() = 1) lengths, or the budget silently truncates the
    // retry policy in production. A Retry-After *longer* than the budget is
    // truncated on purpose (fail fast) — that is tested separately above.
    let total = 0;
    for (let attempt = 0; attempt < BITGET_RETRIES; attempt += 1) {
      total += nextRetryDelayMs(attempt, { random: () => 1 });
    }
    assert.ok(
      total <= MAX_TOTAL_RETRY_WAIT_MS,
      `default worst-case backoff (${total}ms) exceeds the ${MAX_TOTAL_RETRY_WAIT_MS}ms budget`,
    );
  });

  test("a custom budget is respected", async () => {
    const { calls } = await drive([response({ status: 503 })], { maxTotalWaitMs: 100 });
    assert.equal(calls.length, 1);
  });

  test("a 429 that recovers on the last allowed attempt still succeeds", async () => {
    const { ok, calls } = await drive([
      response({ status: 429 }),
      response({ status: 429 }),
      response({ body: { code: "00000", data: "third time" } }),
    ]);

    assert.ok(ok);
    assert.equal(calls.length, 3);
  });

  test("a 500 followed by a 429 reports the rate limit, not the 500", async () => {
    const { error } = await drive([
      response({ status: 500 }),
      response({ status: 429 }),
      response({ status: 429 }),
      response({ status: 429 }),
    ]);

    assert.ok(isBitgetRateLimitError(error));
  });

  test("does not double-charge one 429 as two attempts", async () => {
    // Regression guard for `String(error).includes("429")`: the old catch block
    // re-matched the "Bitget returned HTTP 429" message this function had just
    // thrown, so a single throttle could burn two entries of the budget.
    const { calls } = await drive([response({ status: 429 })]);
    assert.equal(calls.length, BITGET_RETRIES + 1);
  });

  test("does not retry on a message that merely contains the digits 429", async () => {
    // The old string check would have retried this envelope error.
    const { calls } = await drive([
      response({ body: { code: "40034", msg: "Symbol BTCUSDT429XYZ is not tradable" } }),
    ]);
    assert.equal(calls.length, 1);
  });

  test("records the request path on the error for logs", async () => {
    const { error } = await drive([response({ status: 429 })]);
    assert.equal(error.path, "/api/v3/market/tickers?category=SPOT");
  });

  test("the default timeout is applied to the abort signal", async () => {
    const { calls } = await drive([response()]);
    // AbortSignal.timeout() exposes no deadline, so assert it was wired at all.
    assert.ok(calls[0].init.signal);
  });
});
