// Unit tests for the shared data-feed liveness rules (src/lib/live-status.ts).
//
// Like ai-rate-limit.ts and safe-storage.ts, this module is deliberately
// zero-import so Node's type stripping can load it directly — no `@/` alias,
// no React, no DOM. That is what makes these rules testable at all: the things
// they replaced were inline `Date.now() - x > 120_000` comparisons buried in a
// 6,700-line component, which nothing could assert on.
//
// The React hooks that consume these rules (use-live-status.ts) are not covered
// here; they are thin browser-API adapters around this logic.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUOTE_AGE_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MAX_ATTEMPTS,
  nextReconnectDelayMs,
  shouldAttemptReconnect,
  quoteAgeMs,
  isQuoteActionable,
  describeQuoteAge,
  resolveDataFeedState,
  dataFeedPresentation,
  shouldPoll,
  isAlertTriggered,
} from "../src/lib/live-status.ts";

/** Frozen clock so every age calculation is exact and deterministic. */
const NOW = 1_800_000_000_000;

describe("quoteAgeMs", () => {
  test("reports the exact age of a normal quote", () => {
    assert.equal(quoteAgeMs(NOW - 5_000, NOW), 5_000);
    assert.equal(quoteAgeMs(NOW, NOW), 0);
  });

  test("a missing timestamp is maximally stale, not fresh", () => {
    // The failure mode this guards: `asOf` is optional on Quote, and
    // `Date.now() - undefined` is NaN. NaN > 120_000 is false, so a naive
    // comparison treats an untimestamped quote as perfectly fresh and lets it
    // drive an irreversible action.
    assert.equal(quoteAgeMs(undefined, NOW), Infinity);
    assert.equal(quoteAgeMs(null, NOW), Infinity);
    assert.equal(Number.isNaN(quoteAgeMs(undefined, NOW)), false);
  });

  test("non-finite timestamps are maximally stale", () => {
    assert.equal(quoteAgeMs(NaN, NOW), Infinity);
    assert.equal(quoteAgeMs(Infinity, NOW), Infinity);
    assert.equal(quoteAgeMs(-Infinity, NOW), Infinity);
  });

  test("a future timestamp is stale, not negative", () => {
    // Bitget's clock and ours are not the same clock. Returning a negative age
    // would make the quote look freshly minted forever, so skew resolves to the
    // safe side: unproven means unactionable.
    assert.equal(quoteAgeMs(NOW + 60_000, NOW), Infinity);
  });

  test("defaults to the current wall clock", () => {
    const before = Date.now();
    assert.equal(quoteAgeMs(before), 0);
  });
});

describe("isQuoteActionable", () => {
  test("fresh quotes are actionable", () => {
    assert.equal(isQuoteActionable(NOW - 1_000, NOW), true);
    assert.equal(isQuoteActionable(NOW, NOW), true);
  });

  test("the threshold is inclusive at exactly MAX_QUOTE_AGE_MS", () => {
    // `<=`, not `<`. A quote that is exactly two minutes old is the last one we
    // will act on; documented here because an off-by-one in either direction is
    // invisible in normal operation and only shows up under load.
    assert.equal(isQuoteActionable(NOW - MAX_QUOTE_AGE_MS, NOW), true);
    assert.equal(isQuoteActionable(NOW - MAX_QUOTE_AGE_MS - 1, NOW), false);
  });

  test("stale quotes are rejected", () => {
    assert.equal(isQuoteActionable(NOW - 121_000, NOW), false);
    assert.equal(isQuoteActionable(NOW - 3_600_000, NOW), false);
    assert.equal(isQuoteActionable(undefined, NOW), false);
    assert.equal(isQuoteActionable(NOW + 60_000, NOW), false);
  });

  test("honours a custom threshold", () => {
    assert.equal(isQuoteActionable(NOW - 5_000, NOW, 10_000), true);
    assert.equal(isQuoteActionable(NOW - 15_000, NOW, 10_000), false);
  });

  test("a nonsense threshold falls back to the default", () => {
    // Runs inside a polling loop, so an invalid override must degrade to the
    // documented rule rather than throw or accept everything.
    for (const bad of [0, -1, NaN, Infinity]) {
      assert.equal(isQuoteActionable(NOW - 121_000, NOW, bad), false, `maxAgeMs=${bad} should stay strict`);
      assert.equal(isQuoteActionable(NOW - 1_000, NOW, bad), true, `maxAgeMs=${bad} should stay strict`);
    }
  });
});

describe("describeQuoteAge", () => {
  test("formats each unit bucket", () => {
    assert.equal(describeQuoteAge(NOW - 3_000, NOW), "3s old");
    assert.equal(describeQuoteAge(NOW - 59_999, NOW), "59s old");
    assert.equal(describeQuoteAge(NOW - 60_000, NOW), "1m old");
    assert.equal(describeQuoteAge(NOW - 90_000, NOW), "1m old");
    assert.equal(describeQuoteAge(NOW - 3_599_000, NOW), "59m old");
    assert.equal(describeQuoteAge(NOW - 3_600_000, NOW), "1h old");
  });

  test("floors rather than rounds, so a label never overstates freshness", () => {
    assert.equal(describeQuoteAge(NOW - 119_999, NOW), "1m old");
  });

  test("an unknown timestamp says so instead of inventing an age", () => {
    assert.equal(describeQuoteAge(undefined, NOW), "timestamp unknown");
    assert.equal(describeQuoteAge(null, NOW), "timestamp unknown");
    assert.equal(describeQuoteAge(NOW + 60_000, NOW), "timestamp unknown");
  });

  test("every actionable quote has a finite description", () => {
    // The badge tooltip concatenates this onto the presentation title, so a
    // value of "Infinity" or "NaN" would reach the user.
    for (const offset of [0, 30_000, 60_000, MAX_QUOTE_AGE_MS]) {
      const text = describeQuoteAge(NOW - offset, NOW);
      assert.match(text, /^\d+(s|m|h) old$/);
    }
  });
});

describe("isAlertTriggered", () => {
  test("fires when the threshold is crossed on a fresh quote", () => {
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 100.5, quoteAsOf: NOW - 1_000, now: NOW }),
      true,
    );
    assert.equal(
      isAlertTriggered({ direction: "below", triggerPrice: 100, quotePrice: 99.5, quoteAsOf: NOW - 1_000, now: NOW }),
      true,
    );
  });

  test("the comparison is inclusive at the trigger price", () => {
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 100, quoteAsOf: NOW - 1_000, now: NOW }),
      true,
    );
    assert.equal(
      isAlertTriggered({ direction: "below", triggerPrice: 100, quotePrice: 100, quoteAsOf: NOW - 1_000, now: NOW }),
      true,
    );
  });

  test("does not fire when the threshold is not reached", () => {
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 99.5, quoteAsOf: NOW - 1_000, now: NOW }),
      false,
    );
    assert.equal(
      isAlertTriggered({ direction: "below", triggerPrice: 100, quotePrice: 100.5, quoteAsOf: NOW - 1_000, now: NOW }),
      false,
    );
  });

  test("THE BUG THIS CLOSED: a stale quote cannot trigger an alert", () => {
    // This is the case that was broken. `triggeredAt` is permanent and cannot
    // be undone, so the old ungated comparison consumed an alert on a price
    // that might have been dead for an hour. Concrete repro: polling stalls,
    // the quotes effect keeps the last price, the user adds an alert, and
    // adding it re-runs the effect — firing instantly against the dead price.
    const hourOld = NOW - 3_600_000;
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 100.5, quoteAsOf: hourOld, now: NOW }),
      false,
    );
    assert.equal(
      isAlertTriggered({ direction: "below", triggerPrice: 100, quotePrice: 99.5, quoteAsOf: hourOld, now: NOW }),
      false,
    );
    // ...but the very same alert fires once a fresh quote arrives. Skipping one
    // evaluation costs nothing; the next poll retries it.
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 100.5, quoteAsOf: NOW - 1_000, now: NOW }),
      true,
    );
  });

  test("an untimestamped quote cannot trigger an alert", () => {
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: 100.5, quoteAsOf: undefined, now: NOW }),
      false,
    );
    assert.equal(
      isAlertTriggered({ direction: "below", triggerPrice: 100, quotePrice: 99.5, quoteAsOf: null, now: NOW }),
      false,
    );
  });

  test("non-finite prices never trigger", () => {
    // A malformed quote must not fire an alert in either direction. Note that
    // `NaN >= 100` is already false, but `NaN <= 100` is also false — the
    // explicit guard matters for Infinity, which would otherwise pass both.
    for (const price of [NaN, Infinity, -Infinity]) {
      assert.equal(
        isAlertTriggered({ direction: "above", triggerPrice: price, quotePrice: 100.5, quoteAsOf: NOW - 1_000, now: NOW }),
        false,
        `triggerPrice=${price}`,
      );
      assert.equal(
        isAlertTriggered({ direction: "below", triggerPrice: price, quotePrice: 99.5, quoteAsOf: NOW - 1_000, now: NOW }),
        false,
        `triggerPrice=${price}`,
      );
    }
    assert.equal(
      isAlertTriggered({ direction: "above", triggerPrice: 100, quotePrice: Infinity, quoteAsOf: NOW - 1_000, now: NOW }),
      false,
    );
  });

  test("staleness is evaluated against the same clock as the age helpers", () => {
    // Consistency guard: the alert path and the bracket path must agree on what
    // "stale" means, or the badge can claim paused while fills keep happening.
    assert.equal(isAlertTriggered({
      direction: "above",
      triggerPrice: 100,
      quotePrice: 100.5,
      quoteAsOf: NOW - MAX_QUOTE_AGE_MS,
      now: NOW,
    }), true, "exactly at the limit is still actionable");
    assert.equal(isAlertTriggered({
      direction: "above",
      triggerPrice: 100,
      quotePrice: 100.5,
      quoteAsOf: NOW - MAX_QUOTE_AGE_MS - 1,
      now: NOW,
    }), false, "one ms past the limit is not");
  });
});

describe("resolveDataFeedState", () => {
  const fresh = { quoteAgeMs: 1_000 };
  const stale = { quoteAgeMs: Infinity };

  test("a connected socket with fresh data is live", () => {
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, ...fresh }), "live");
  });

  test("REST polling with fresh data is healthy, not an error", () => {
    // The badge used to render this in amber alongside genuine outages. A
    // working fallback is not a degraded state.
    assert.equal(resolveDataFeedState({ online: true, wsConnected: false, ...fresh }), "polling");
  });

  test("no connectivity beats every other signal", () => {
    // Strict priority: a dead network explains a closed socket and a stale
    // quote alike, so reporting anything else would be reporting a symptom.
    assert.equal(resolveDataFeedState({ online: false, wsConnected: true, ...fresh }), "offline");
    assert.equal(resolveDataFeedState({ online: false, wsConnected: false, ...stale }), "offline");
  });

  test("a stalled feed beats a socket that claims to be open", () => {
    // A socket can report OPEN while no ticks arrive — a half-open connection
    // through a proxy is the common cause. Trusting the socket here would print
    // "WS Live" over data that stopped ten minutes ago, which is the single
    // worst thing this badge could do.
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, ...stale }), "stalled");
  });

  test("an Infinity age counts as stalled", () => {
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: Infinity }), "stalled");
    assert.equal(resolveDataFeedState({ online: true, wsConnected: false, quoteAgeMs: NaN }), "stalled");
  });

  test("pausing suppresses stalled but never masks offline", () => {
    // A hidden tab is *supposed* to let quotes age — that is the point of
    // suspending the loops. Flagging our own power saving as a data outage
    // would greet every returning user with an alarm that fixes itself.
    assert.equal(resolveDataFeedState({ online: true, wsConnected: false, paused: true, ...stale }), "polling");
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, paused: true, ...stale }), "live");
    assert.equal(resolveDataFeedState({ online: false, wsConnected: false, paused: true, ...stale }), "offline");
  });

  test("honours a custom staleness threshold", () => {
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: 5_000, maxAgeMs: 1_000 }), "stalled");
    assert.equal(resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: 500, maxAgeMs: 1_000 }), "live");
  });

  /*
    Regression guard for the bug that shipped in 07a2f64. Before the first
    fetch resolves, `market` is null and the call site passes Infinity — which
    this resolver then read as "no data for two minutes" and reported an amber
    role="alert" "Data Stalled" badge beside a "Loading market data" spinner,
    on every single page load. It was visible in the *prerendered* HTML, so it
    was not even a hydration flash — it was the first thing a visitor saw.
  */
  describe("first paint (no quote has arrived yet)", () => {
    const firstPaint = { online: true, wsConnected: false, quoteAgeMs: Infinity, awaitingFirstQuote: true };

    test("THE BUG THIS CLOSED: an awaiting feed is not stalled", () => {
      assert.notEqual(resolveDataFeedState(firstPaint), "stalled");
      // Matches the pre-feature behaviour: `wsStatus` starts as "connecting",
      // so the old binary badge rendered the REST Polling variant here.
      assert.equal(resolveDataFeedState(firstPaint), "polling");
      assert.equal(dataFeedPresentation(resolveDataFeedState(firstPaint)).label, "REST Polling");
    });

    test("first paint is announced as status, never as alert", () => {
      assert.equal(dataFeedPresentation(resolveDataFeedState(firstPaint)).role, "status");
    });

    test("first paint raises no banner", () => {
      assert.equal(dataFeedPresentation(resolveDataFeedState(firstPaint)).banner, false);
    });

    test("awaiting suppresses stalled regardless of socket state", () => {
      assert.equal(resolveDataFeedState({ ...firstPaint, wsConnected: true }), "live");
      assert.equal(resolveDataFeedState({ ...firstPaint, quoteAgeMs: NaN }), "polling");
    });

    test("awaiting never masks offline — connectivity is known independently", () => {
      // A user with no internet should get the banner on first paint, not only
      // once a fetch has had a chance to time out.
      assert.equal(resolveDataFeedState({ ...firstPaint, online: false }), "offline");
      assert.equal(dataFeedPresentation(resolveDataFeedState({ ...firstPaint, online: false })).banner, true);
    });

    test("a feed that HAS delivered and then aged out still reports stalled", () => {
      // The guard must be scoped to first paint only. If awaitingFirstQuote
      // were sticky, stall detection would be silently disabled forever — the
      // exact class of bug the feature exists to prevent.
      assert.equal(
        resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: Infinity, awaitingFirstQuote: false }),
        "stalled"
      );
      assert.equal(
        resolveDataFeedState({ online: true, wsConnected: false, quoteAgeMs: 999_000, awaitingFirstQuote: false }),
        "stalled"
      );
    });

    test("the flag defaults to false so existing callers keep detecting stalls", () => {
      // Every call that omits it must behave exactly as before the fix.
      assert.equal(resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: Infinity }), "stalled");
      assert.equal(resolveDataFeedState({ online: true, wsConnected: false, quoteAgeMs: Infinity }), "stalled");
    });

    test("awaiting and paused are independent suppressions", () => {
      assert.equal(resolveDataFeedState({ ...firstPaint, paused: true }), "polling");
      assert.equal(resolveDataFeedState({ online: true, wsConnected: true, quoteAgeMs: Infinity, paused: true }), "live");
    });
  });
});

describe("dataFeedPresentation", () => {
  test("each state has a distinct, non-empty label", () => {
    // The whole point of the refactor: four states must not collapse into two.
    const states = ["live", "polling", "stalled", "offline"];
    const labels = states.map((state) => dataFeedPresentation(state).label);
    assert.equal(new Set(labels).size, states.length, `labels must be distinct, got ${labels.join(" / ")}`);
    const modifiers = states.map((state) => dataFeedPresentation(state).modifier);
    assert.equal(new Set(modifiers).size, states.length, `CSS modifiers must be distinct, got ${modifiers.join(" / ")}`);
    for (const label of labels) assert.ok(label.length > 0);
  });

  test("only offline raises a banner", () => {
    // A stalled feed is already legible in the badge, and a tab left open
    // overnight should not greet the user with an alarm for something that
    // recovers on the next poll.
    assert.equal(dataFeedPresentation("offline").banner, true);
    for (const state of ["live", "polling", "stalled"]) {
      assert.equal(dataFeedPresentation(state).banner, false, `${state} must not banner`);
    }
  });

  test("a banner carries a title and a detail", () => {
    const { bannerTitle, bannerDetail } = dataFeedPresentation("offline");
    assert.ok(bannerTitle.length > 0);
    assert.ok(bannerDetail.length > 0);
    // The banner must reassure about the thing a user actually fears when the
    // desk goes dark: that their saved work is gone.
    assert.match(bannerDetail, /intact/i);
  });

  test("degraded states are announced to assistive tech", () => {
    assert.equal(dataFeedPresentation("live").role, "status");
    assert.equal(dataFeedPresentation("polling").role, "status");
    assert.equal(dataFeedPresentation("stalled").role, "alert");
    assert.equal(dataFeedPresentation("offline").role, "alert");
  });

  test("every state maps to a pulse-dot class that exists in globals.css", () => {
    const dots = ["live", "polling", "stalled", "offline"].map((state) => dataFeedPresentation(state).dot);
    assert.deepEqual(dots, ["pulse-dot-green", "pulse-dot-gray", "pulse-dot-amber", "pulse-dot-red"]);
  });

  test("an unknown state degrades to polling rather than throwing", () => {
    // This runs during render, so a bad value must not blank the page.
    const fallback = dataFeedPresentation("nonsense");
    assert.deepEqual(fallback, dataFeedPresentation("polling"));
  });
});

describe("shouldPoll", () => {
  test("polls only when visible and enabled", () => {
    assert.equal(shouldPoll({ visible: true }), true);
    assert.equal(shouldPoll({ visible: true, enabled: true }), true);
    assert.equal(shouldPoll({ visible: false }), false);
    assert.equal(shouldPoll({ visible: true, enabled: false }), false);
    assert.equal(shouldPoll({ visible: false, enabled: false }), false);
  });

  test("enabled defaults to true", () => {
    // Callers that have no separate enable flag pass only `visible`.
    assert.equal(shouldPoll({ visible: true, enabled: undefined }), true);
  });

  test("deliberately ignores connectivity", () => {
    // Documented decision, asserted so it cannot be "fixed" by accident.
    // `navigator.onLine` is unreliable in both directions: true behind a
    // captive portal with no real route out, and false on flaky mobile radios
    // that are actually working. A false negative here would silently freeze
    // the entire desk, which is far worse than sending a request that fails and
    // surfaces an error. Offline is handled by the banner plus an immediate
    // refresh on the `online` event.
    //
    // Comments are stripped before matching so that documenting the decision
    // inside the function body cannot fail the assertion that enforces it.
    const code = shouldPoll.toString().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const global of ["navigator", "onLine", "document", "window"]) {
      assert.equal(
        code.includes(global),
        false,
        `shouldPoll must stay pure and must not read ${global}`,
      );
    }
  });

  test("is a pure function of its arguments", () => {
    // Purity is what makes it safe to call during render and to put its result
    // in an effect dependency array: an impure gate would tear the polling
    // intervals down and rebuild them on unrelated renders.
    for (let i = 0; i < 5; i += 1) {
      assert.equal(shouldPoll({ visible: true }), true);
      assert.equal(shouldPoll({ visible: false }), false);
    }
  });
});

describe("nextReconnectDelayMs", () => {
  const noJitter = { random: () => 0 };
  const fullJitter = { random: () => 1 };

  test("grows exponentially with attempt", () => {
    // With random()=0 the delay sits on its floor, which is half the
    // exponential value — "equal jitter", so the growth rate stays visible.
    const delays = [0, 1, 2, 3].map((attempt) => nextReconnectDelayMs(attempt, noJitter));
    assert.deepEqual(delays, [500, 1_000, 2_000, 4_000]);
  });

  test("caps at RECONNECT_MAX_MS", () => {
    assert.equal(nextReconnectDelayMs(20, noJitter), RECONNECT_MAX_MS / 2);
    assert.equal(nextReconnectDelayMs(20, fullJitter), RECONNECT_MAX_MS);
    assert.equal(nextReconnectDelayMs(1_000, fullJitter), RECONNECT_MAX_MS);
  });

  test("a very large attempt does not overflow to Infinity", () => {
    // 2 ** attempt overflows well before 1000; the exponent is clamped so the
    // multiplication stays finite. A NaN delay would make setTimeout fire
    // immediately, turning the backoff into a hot reconnect loop.
    for (const attempt of [32, 33, 64, 1e9, Number.MAX_SAFE_INTEGER]) {
      const delay = nextReconnectDelayMs(attempt, fullJitter);
      assert.equal(Number.isFinite(delay), true, `attempt=${attempt}`);
      assert.ok(delay <= RECONNECT_MAX_MS, `attempt=${attempt} gave ${delay}`);
    }
  });

  test("jitter stays inside its band for every attempt", () => {
    // Equal jitter: half deterministic, half random. The floor matters — pure
    // full jitter can return near-zero, which defeats the point of backing off
    // and lets a client hammer a recovering server.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
      const low = nextReconnectDelayMs(attempt, noJitter);
      const high = nextReconnectDelayMs(attempt, fullJitter);
      assert.equal(low, Math.round(exponential / 2), `attempt=${attempt} floor`);
      assert.equal(high, Math.round(exponential), `attempt=${attempt} ceiling`);
      assert.ok(low > 0, `attempt=${attempt} floor must stay positive, got ${low}`);
      assert.ok(low <= high, `attempt=${attempt}`);
    }
  });

  test("jitter actually varies the delay", () => {
    // The reason jitter exists: without it every client that lost connectivity
    // reconnects in lockstep the moment the server recovers.
    const delays = new Set(
      Array.from({ length: 20 }, () => nextReconnectDelayMs(4)),
    );
    assert.ok(delays.size > 1, "default Math.random must de-synchronise clients");
  });

  test("returns integers", () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(Number.isInteger(nextReconnectDelayMs(attempt)), true);
    }
  });

  test("negative and non-finite attempts are clamped, not thrown", () => {
    // This runs inside a setTimeout callback on an error path. The last thing a
    // reconnect handler needs is a new exception escaping from it.
    const zero = nextReconnectDelayMs(0, noJitter);
    assert.equal(nextReconnectDelayMs(-5, noJitter), zero);
    assert.equal(nextReconnectDelayMs(NaN, noJitter), zero);
    assert.equal(nextReconnectDelayMs(Infinity, noJitter), zero);
    assert.equal(nextReconnectDelayMs(2.7, noJitter), nextReconnectDelayMs(2, noJitter), "floors fractional attempts");
  });

  test("honours injected base and ceiling", () => {
    assert.equal(nextReconnectDelayMs(0, { baseMs: 100, maxMs: 400, random: () => 1 }), 100);
    assert.equal(nextReconnectDelayMs(5, { baseMs: 100, maxMs: 400, random: () => 1 }), 400);
  });

  test("nonsense bounds fall back to the defaults", () => {
    const expected = nextReconnectDelayMs(3, noJitter);
    assert.equal(nextReconnectDelayMs(3, { baseMs: 0, random: () => 0 }), expected);
    assert.equal(nextReconnectDelayMs(3, { baseMs: -100, random: () => 0 }), expected);
    assert.equal(nextReconnectDelayMs(3, { baseMs: NaN, random: () => 0 }), expected);
    // A ceiling below the base would invert the backoff, so it is ignored.
    assert.equal(nextReconnectDelayMs(3, { maxMs: 1, random: () => 0 }), expected);
  });

  test("the full retry budget sums to roughly two minutes", () => {
    // The intent behind RECONNECT_MAX_ATTEMPTS: try hard for about two minutes,
    // then hand over to REST polling, which keeps the desk working anyway.
    let total = 0;
    for (let attempt = 0; shouldAttemptReconnect(attempt); attempt += 1) {
      total += nextReconnectDelayMs(attempt, fullJitter);
    }
    assert.ok(total >= 100_000, `expected ~2min of trying, got ${total}ms`);
    assert.ok(total <= 180_000, `expected ~2min of trying, got ${total}ms`);
  });
});

describe("shouldAttemptReconnect", () => {
  test("stops at the documented attempt cap", () => {
    assert.equal(shouldAttemptReconnect(0), true);
    assert.equal(shouldAttemptReconnect(RECONNECT_MAX_ATTEMPTS - 1), true);
    assert.equal(shouldAttemptReconnect(RECONNECT_MAX_ATTEMPTS), false);
    assert.equal(shouldAttemptReconnect(RECONNECT_MAX_ATTEMPTS + 50), false);
  });

  test("the cap is finite, so a parked tab cannot retry forever", () => {
    // The old code retried on a flat 3s timer with no cap — a tab left open all
    // weekend retried all weekend. This is the assertion that pins that down.
    assert.ok(Number.isFinite(RECONNECT_MAX_ATTEMPTS));
    assert.ok(RECONNECT_MAX_ATTEMPTS > 0, "must try at least once");
    assert.ok(RECONNECT_MAX_ATTEMPTS < 100, "must actually stop");
  });

  test("negative and non-finite attempts do not reconnect", () => {
    assert.equal(shouldAttemptReconnect(-1), true, "negative floors below the cap");
    assert.equal(shouldAttemptReconnect(NaN), false);
    assert.equal(shouldAttemptReconnect(Infinity), false);
  });
});

describe("the constants the component relies on", () => {
  test("the staleness threshold is two minutes", () => {
    // trading-desk.tsx renders "Quotes stale >{MAX_QUOTE_AGE_MS / 60000}m", so
    // this value is user-visible copy as well as a gate. Changing it must change
    // both together — which is exactly why it is now one constant instead of
    // three inline `120_000` literals.
    assert.equal(MAX_QUOTE_AGE_MS, 120_000);
    assert.equal(MAX_QUOTE_AGE_MS / 60_000, 2);
  });

  test("backoff bounds are sane and ordered", () => {
    assert.ok(RECONNECT_BASE_MS > 0);
    assert.ok(RECONNECT_MAX_MS >= RECONNECT_BASE_MS);
  });
});
