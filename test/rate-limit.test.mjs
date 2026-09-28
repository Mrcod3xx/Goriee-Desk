// Unit tests for the server-side AI rate limiter (src/lib/ai-rate-limit.ts).
//
// The limiter module is deliberately zero-import so Node's type stripping can
// load it directly — no `@/` alias, no next/server. The HTTP wrapper
// (ai-limit-response.ts) and the routes themselves are exercised by
// test/api.test.mjs against a real server instead.
import test, { beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MINUTE_MS,
  HOUR_MS,
  WEB_RESEARCH_COST,
  checkAiRateLimit,
  acquireAiSlot,
  aiSlotsInUse,
  aiBusyDecision,
  aiLimitBody,
  retryAfterSeconds,
  clientKeyFromHeaders,
  aiBudgetFromEnv,
  setRateLimitStore,
  resetAiRateLimitForTests,
} from "../src/lib/ai-rate-limit.ts";

// researchErrorMessage lives in desk-shared.ts, which is also Node-importable
// (type-only imports only). The guard there keeps our limiter's copy from being
// rewritten into "The AI provider is temporarily limiting requests".
import { researchErrorMessage } from "../src/components/desk-shared.ts";

/** Budget used by most cases: tiny numbers make the windows easy to reason about. */
const TEST_BUDGET = { perMinute: 3, perHour: 5, concurrency: 2 };

/** Frozen clock so fixed windows are deterministic. */
const NOW = 1_800_000_000_000;

beforeEach(() => {
  resetAiRateLimitForTests();
  for (const key of ["AI_RATE_LIMIT_DISABLED", "AI_RATE_LIMIT_PER_MINUTE", "AI_RATE_LIMIT_PER_HOUR", "AI_RATE_LIMIT_CONCURRENCY"]) {
    delete process.env[key];
  }
});

describe("checkAiRateLimit — per-connection budget", () => {
  test("allows requests under the minute limit and reports remaining budget", () => {
    const first = checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(first.allowed, true);
    if (first.allowed) {
      assert.equal(first.remaining, 2);
      assert.equal(first.resetAt, NOW + MINUTE_MS);
    }
    const second = checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(second.allowed, true);
    if (second.allowed) assert.equal(second.remaining, 1);
  });

  test("denies the request that crosses the minute limit, with a retryAt at window end", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET).allowed, true);
    }
    const denied = checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.equal(denied.retryAt, NOW + MINUTE_MS);
      assert.ok(denied.error.length > 20, "denial carries a human-readable message");
      // The copy must not trip researchErrorMessage's provider-429 rewrite.
      assert.equal(researchErrorMessage(denied.error), denied.error);
      assert.ok(!/\b429\b|rate.?limit/i.test(denied.error), "message avoids the 429/rate-limit rewrite trigger");
    }
  });

  test("the minute window resets after it expires", () => {
    for (let i = 0; i < 3; i++) checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET).allowed, false);
    // One ms into the next window: minute budget refills, hour budget still counts.
    const after = checkAiRateLimit("1.2.3.4", 1, NOW + MINUTE_MS + 1, TEST_BUDGET);
    assert.equal(after.allowed, true);
  });

  test("the hour limit denies even when the minute budget has refilled", () => {
    // 5 charges at minute boundaries: 3 in window one, 2 in window two (hour cap = 5).
    for (let i = 0; i < 3; i++) checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW + MINUTE_MS + 1, TEST_BUDGET).allowed, true);
    assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW + MINUTE_MS + 1, TEST_BUDGET).allowed, true);
    const denied = checkAiRateLimit("1.2.3.4", 1, NOW + MINUTE_MS + 2, TEST_BUDGET);
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.retryAt, NOW + HOUR_MS);
  });

  test("web research costs more budget than a plain request", () => {
    assert.equal(checkAiRateLimit("1.2.3.4", WEB_RESEARCH_COST, NOW, TEST_BUDGET).allowed, true); // 2 of 3
    const second = checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(second.allowed, true); // 3 of 3
    if (second.allowed) assert.equal(second.remaining, 0);
    assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET).allowed, false);
  });

  test("a single request costing more than the limit is denied immediately", () => {
    const denied = checkAiRateLimit("1.2.3.4", 99, NOW, TEST_BUDGET);
    assert.equal(denied.allowed, false);
  });

  test("distinct connections have independent budgets", () => {
    for (let i = 0; i < 3; i++) checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET).allowed, false);
    assert.equal(checkAiRateLimit("5.6.7.8", 1, NOW, TEST_BUDGET).allowed, true);
  });

  test("denials do not extend the lockout (fixed windows keep the original resetAt)", () => {
    for (let i = 0; i < 3; i++) checkAiRateLimit("1.2.3.4", 1, NOW, TEST_BUDGET);
    const first = checkAiRateLimit("1.2.3.4", 1, NOW + 10_000, TEST_BUDGET);
    const second = checkAiRateLimit("1.2.3.4", 1, NOW + 20_000, TEST_BUDGET);
    assert.equal(first.allowed, false);
    assert.equal(second.allowed, false);
    if (!first.allowed && !second.allowed) assert.equal(first.retryAt, second.retryAt);
  });
});

describe("concurrency slots", () => {
  test("hands out slots up to the cap, then refuses", () => {
    const a = acquireAiSlot(TEST_BUDGET);
    const b = acquireAiSlot(TEST_BUDGET);
    assert.ok(a && b, "first two slots granted");
    assert.equal(aiSlotsInUse(), 2);
    assert.equal(acquireAiSlot(TEST_BUDGET), null, "cap reached");
  });

  test("releasing a slot makes it available again", () => {
    const a = acquireAiSlot(TEST_BUDGET);
    acquireAiSlot(TEST_BUDGET);
    assert.equal(acquireAiSlot(TEST_BUDGET), null);
    a?.();
    assert.equal(aiSlotsInUse(), 1);
    const c = acquireAiSlot(TEST_BUDGET);
    assert.ok(c, "slot reclaimed after release");
  });

  test("release is idempotent — a finally block can call it twice safely", () => {
    const a = acquireAiSlot(TEST_BUDGET);
    assert.equal(aiSlotsInUse(), 1);
    a?.();
    a?.();
    a?.();
    assert.equal(aiSlotsInUse(), 0);
    // And the pool never goes negative, which would silently over-admit later.
    assert.ok(acquireAiSlot(TEST_BUDGET));
    assert.ok(acquireAiSlot(TEST_BUDGET));
    assert.equal(acquireAiSlot(TEST_BUDGET), null);
  });

  test("resetAiRateLimitForTests frees stranded slots", () => {
    acquireAiSlot(TEST_BUDGET);
    acquireAiSlot(TEST_BUDGET);
    assert.equal(aiSlotsInUse(), 2);
    resetAiRateLimitForTests();
    assert.equal(aiSlotsInUse(), 0);
  });

  test("aiBusyDecision produces a 429-shaped body the client understands", () => {
    const decision = aiBusyDecision(NOW + 20_000);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      const body = aiLimitBody(decision);
      assert.equal(typeof body.error, "string");
      assert.equal(body.retryAt, NOW + 20_000);
      // The client stores retryAt verbatim (trading-desk setAiRetryAt), and
      // RequestRecovery renders a countdown from it — it must be epoch ms.
      assert.ok(body.retryAt > 1e12, "retryAt is epoch milliseconds");
      assert.equal(researchErrorMessage(body.error), body.error, "copy survives the client-side rewrite");
    }
  });
});

describe("clientKeyFromHeaders", () => {
  test("takes the first x-forwarded-for entry (the real client)", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" });
    assert.equal(clientKeyFromHeaders(headers), "203.0.113.9");
  });

  test("falls back to x-real-ip, then to a shared local bucket", () => {
    assert.equal(clientKeyFromHeaders(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
    assert.equal(clientKeyFromHeaders(new Headers()), "local");
  });

  test("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.7" });
    assert.equal(clientKeyFromHeaders(headers), "203.0.113.9");
  });

  test("caps the key length — the header is attacker-controlled", () => {
    const headers = new Headers({ "x-forwarded-for": "a".repeat(500) });
    assert.equal(clientKeyFromHeaders(headers).length, 64);
  });

  test("trims whitespace around the forwarded entry", () => {
    const headers = new Headers({ "x-forwarded-for": "  203.0.113.9 , 70.41.3.18" });
    assert.equal(clientKeyFromHeaders(headers), "203.0.113.9");
  });
});

describe("aiBudgetFromEnv", () => {
  test("uses documented defaults with a clean environment", () => {
    const budget = aiBudgetFromEnv();
    assert.equal(budget.perMinute, 6);
    assert.equal(budget.perHour, 40);
    assert.equal(budget.concurrency, 4);
  });

  test("honours positive integer overrides", () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "2";
    process.env.AI_RATE_LIMIT_PER_HOUR = "9";
    process.env.AI_RATE_LIMIT_CONCURRENCY = "1";
    assert.deepEqual(aiBudgetFromEnv(), { perMinute: 2, perHour: 9, concurrency: 1 });
  });

  test("ignores junk values instead of disabling itself", () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "0";
    process.env.AI_RATE_LIMIT_PER_HOUR = "-5";
    process.env.AI_RATE_LIMIT_CONCURRENCY = "banana";
    const budget = aiBudgetFromEnv();
    assert.equal(budget.perMinute, 6);
    assert.equal(budget.perHour, 40);
    assert.equal(budget.concurrency, 4);
  });

  test("AI_RATE_LIMIT_DISABLED=1 lifts every cap (test/dev escape hatch)", () => {
    process.env.AI_RATE_LIMIT_DISABLED = "1";
    const budget = aiBudgetFromEnv();
    for (let i = 0; i < 500; i++) {
      assert.equal(checkAiRateLimit("1.2.3.4", 1, NOW, budget).allowed, true);
    }
    assert.ok(acquireAiSlot(budget));
  });
});

describe("retryAfterSeconds", () => {
  test("converts an epoch-ms retryAt into whole seconds, minimum 1", () => {
    assert.equal(retryAfterSeconds(NOW + 45_200, NOW), 46);
    assert.equal(retryAfterSeconds(NOW + 1_000, NOW), 1);
    assert.equal(retryAfterSeconds(NOW + 100, NOW), 1);
    assert.equal(retryAfterSeconds(NOW - 5_000, NOW), 1, "past timestamps still yield a valid header");
  });
});

describe("setRateLimitStore — the Redis seam", () => {
  test("routes every charge through a custom store", () => {
    const calls = [];
    const counters = new Map();
    setRateLimitStore({
      record(key, windowMs, cost, now) {
        calls.push({ key, windowMs, cost });
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
    });

    assert.equal(checkAiRateLimit("9.9.9.9", 1, NOW, TEST_BUDGET).allowed, true);
    // One record call per configured window (minute + hour).
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => c.windowMs).sort((a, b) => a - b),
      [MINUTE_MS, HOUR_MS],
    );

    setRateLimitStore(null); // back to the in-memory default
    assert.equal(checkAiRateLimit("9.9.9.9", 1, NOW, TEST_BUDGET).allowed, true, "fresh store starts empty");
  });
});

describe("researchErrorMessage guard (desk-shared.ts)", () => {
  test("the desk's own pacing copy is never rewritten to blame the provider", () => {
    for (const message of [
      "The desk is pacing AI requests from this connection to protect the shared provider budget. Your input is saved; the countdown shows when you can run this again.",
      "The desk is already running the maximum number of AI requests at once. Your input is saved; try again in a moment.",
    ]) {
      assert.equal(researchErrorMessage(message), message);
    }
  });

  test("genuine provider 429s are still rewritten as before", () => {
    assert.equal(
      researchErrorMessage("NVIDIA NIM has temporarily limited requests (HTTP 429)."),
      "The AI provider is temporarily limiting requests. Wait a moment, then try again.",
    );
  });
});
