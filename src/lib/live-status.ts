/**
 * Shared liveness rules for the desk's data feed.
 *
 * This module is deliberately zero-import so Node's type stripping can load it
 * directly in `node --test` — no `@/` alias, no React, no DOM. The React hooks
 * that consume these rules live in `use-live-status.ts`.
 *
 * Three problems are solved here, in one place, because they were previously
 * solved three different ways by three different call sites:
 *
 * 1. **Is this quote new enough to act on?** Bracket fills were already gated
 *    on a 120s maximum age, paper orders had their own copy of the same check,
 *    and price alerts had none at all — so an alert could fire on a price that
 *    was minutes or hours old and permanently stamp `triggeredAt`. One rule now.
 *
 * 2. **How long until we reconnect?** The WebSocket retried on a flat 3s timer
 *    forever. A flat timer means every client that lost connectivity reconnects
 *    in lockstep the moment the server recovers, and forever means a parked tab
 *    retries until the heat death of the universe. Exponential backoff with
 *    jitter and an attempt cap instead.
 *
 * 3. **What do we tell the user?** The status badge was binary — connected or
 *    not — so "Bitget's WebSocket is down" and "you have no internet" looked
 *    identical, and neither looked different from "we are polling fine".
 */

/**
 * Maximum age of a Bitget quote that may still drive an irreversible action
 * (filling a bracket leg, triggering a price alert, recording a paper order).
 *
 * Two minutes matches the interval of the slowest polling loop with room to
 * spare, so under normal operation this never blocks anything. It only fires
 * when the feed has genuinely stopped.
 */
export const MAX_QUOTE_AGE_MS = 120_000;

/** First reconnect attempt waits about this long. */
export const RECONNECT_BASE_MS = 1_000;

/** Reconnect delay ceiling — never wait longer than this between attempts. */
export const RECONNECT_MAX_MS = 30_000;

/**
 * Attempt count at which we stop reconnecting on our own and hand over to REST
 * polling. Chosen so the delays sum to roughly two minutes of trying:
 * ~1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s.
 *
 * This is not "give up on live data". The socket is re-armed the moment the tab
 * becomes visible again or connectivity returns, so a backgrounded tab stops
 * burning retries while a foregrounded one keeps trying.
 */
export const RECONNECT_MAX_ATTEMPTS = 8;

/**
 * How far the jitter may pull a delay down from its exponential value.
 *
 * "Equal jitter" — half the delay is deterministic, half is random. Pure full
 * jitter can hand back a near-zero delay, which defeats the point of backing
 * off; equal jitter keeps a floor while still de-synchronising clients.
 */
const JITTER_FLOOR_RATIO = 0.5;

export type ReconnectDelayOptions = {
  baseMs?: number;
  maxMs?: number;
  /** Injectable so tests are deterministic. Must return a value in [0, 1). */
  random?: () => number;
};

/**
 * Exponential backoff with equal jitter.
 *
 * `attempt` is zero-based: the first retry is `attempt = 0`. Values are clamped
 * rather than throwing, because this runs inside a `setTimeout` callback during
 * an error path — the last thing a reconnect handler needs is a new exception.
 */
export function nextReconnectDelayMs(attempt: number, options: ReconnectDelayOptions = {}): number {
  const { baseMs = RECONNECT_BASE_MS, maxMs = RECONNECT_MAX_MS, random = Math.random } = options;

  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : RECONNECT_BASE_MS;
  const safeMax = Number.isFinite(maxMs) && maxMs >= safeBase ? maxMs : Math.max(safeBase, RECONNECT_MAX_MS);

  // `2 ** attempt` overflows to Infinity for large attempts; Math.min clamps it
  // back, but guard anyway so the multiplication never produces Infinity.
  const cappedAttempt = Math.min(safeAttempt, 32);
  const exponential = Math.min(safeMax, safeBase * Math.pow(2, cappedAttempt));

  const floor = exponential * JITTER_FLOOR_RATIO;
  const jittered = floor + random() * (exponential - floor);

  return Math.max(0, Math.round(jittered));
}

/** True while we should keep scheduling reconnect attempts on our own. */
export function shouldAttemptReconnect(attempt: number): boolean {
  return Number.isFinite(attempt) && Math.floor(attempt) < RECONNECT_MAX_ATTEMPTS;
}

/**
 * Age of a quote in milliseconds.
 *
 * An absent, non-finite or future-dated timestamp yields `Infinity`, which
 * reads as "maximally stale" — the safe direction for every gate below. A
 * future timestamp can happen: the server clocks and Bitget's are not the same
 * clock, and treating a skew as "fresh" would let an action through unverified.
 */
export function quoteAgeMs(asOf: number | null | undefined, now: number = Date.now()): number {
  if (typeof asOf !== "number" || !Number.isFinite(asOf)) return Infinity;
  const age = now - asOf;
  return age < 0 ? Infinity : age;
}

/**
 * May this quote drive an irreversible action?
 *
 * Deliberately strict: an unproven timestamp is a stale timestamp. Alert
 * triggers and bracket fills write `triggeredAt` permanently and cannot be
 * undone, so a false negative (skipping one evaluation and catching it on the
 * next poll) is far cheaper than a false positive (firing on a dead price).
 */
export function isQuoteActionable(
  asOf: number | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = MAX_QUOTE_AGE_MS,
): boolean {
  const limit = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : MAX_QUOTE_AGE_MS;
  return quoteAgeMs(asOf, now) <= limit;
}

/** Human-readable form of the same check, for tooltips and aria labels. */
export function describeQuoteAge(asOf: number | null | undefined, now: number = Date.now()): string {
  const age = quoteAgeMs(asOf, now);
  if (!Number.isFinite(age)) return "timestamp unknown";
  const seconds = Math.floor(age / 1_000);
  if (seconds < 60) return `${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h old`;
}

/**
 * What the data feed is doing, from the user's point of view.
 *
 * - `live`      — WebSocket streaming and the data is current.
 * - `polling`   — REST fallback, working as intended. Not an error.
 * - `stalled`   — we are online but nothing has arrived within the max age.
 * - `offline`   — the browser reports no connectivity at all.
 *
 * The old badge could only express `live` versus "everything else", which is
 * why a dead network and a healthy REST fallback looked identical.
 */
export type DataFeedState = "live" | "polling" | "stalled" | "offline";

export type DataFeedInput = {
  /** `navigator.onLine`. */
  online: boolean;
  /** WebSocket reports an open, subscribed socket. */
  wsConnected: boolean;
  /** Age of the newest quote we hold, in ms. May be `Infinity`. */
  quoteAgeMs: number;
  /**
   * True when polling is intentionally suspended because the tab is hidden.
   *
   * Suppresses `stalled`. Quotes are *supposed* to go stale in a background
   * tab — that is the whole point of pausing — and flagging our own power
   * saving as a data outage would be worse than saying nothing.
   */
  paused?: boolean;
  /**
   * True until the very first quote has arrived.
   *
   * Also suppresses `stalled`, but for the opposite reason: before the first
   * fetch resolves an `Infinity` age means "nothing yet", not "nothing for two
   * minutes". Conflating the two is what made the first cut of this feature
   * prerender an amber `role="alert"` badge beside a "Loading market data"
   * spinner on every page load.
   */
  awaitingFirstQuote?: boolean;
  /** Override for the staleness threshold. Defaults to `MAX_QUOTE_AGE_MS`. */
  maxAgeMs?: number;
};

/**
 * Collapse the raw signals into one state.
 *
 * Ordering is a strict priority: a disconnected network explains every other
 * symptom, so it wins; a stalled feed explains a missing WebSocket tick, so it
 * comes next. Reporting the most specific cause first is what stops the badge
 * from claiming "WS Live" while no data has arrived for ten minutes.
 *
 * Two conditions suppress `stalled` and nothing else: an intentional
 * suspension (`paused`) and a feed that has never delivered a quote
 * (`awaitingFirstQuote`). Both make the quote age meaningless rather than
 * alarming. `offline` still wins under both, because connectivity is known
 * independently of the market data — a user with no internet should get the
 * banner on first paint, not a minute later.
 */
export function resolveDataFeedState(input: DataFeedInput): DataFeedState {
  const {
    online,
    wsConnected,
    paused = false,
    awaitingFirstQuote = false,
    maxAgeMs = MAX_QUOTE_AGE_MS,
  } = input;
  const age = Number.isFinite(input.quoteAgeMs) ? input.quoteAgeMs : Infinity;

  if (!online) return "offline";
  if (!awaitingFirstQuote && !paused && age > maxAgeMs) return "stalled";
  if (wsConnected) return "live";
  return "polling";
}

export type DataFeedPresentation = {
  /** Short label for the badge. */
  label: string;
  /** Longer explanation for the `title` tooltip. */
  title: string;
  /** CSS modifier appended to `.ws-status-badge`. */
  modifier: string;
  /** Pulse-dot colour class. */
  dot: string;
  /**
   * Whether to raise a page-level banner. `stalled` does not: it is already
   * visible in the badge, and a tab that has simply been left open overnight
   * should not greet the user with an alarm.
   */
  banner: boolean;
  bannerTitle: string;
  bannerDetail: string;
  /** `role` for the badge — `status` for calm states, `alert` for bad ones. */
  role: "status" | "alert";
};

/**
 * Single source of truth for how each feed state is presented.
 *
 * Kept as a table rather than scattered ternaries in JSX: the previous badge
 * had two independent `wsStatus === "connected"` checks that could drift apart,
 * and four states now need copy, colour, ARIA role and banner behaviour each.
 */
const DATA_FEED_PRESENTATION: Record<DataFeedState, DataFeedPresentation> = {
  live: {
    label: "WS Live",
    title: "Real-time streaming via wss://ws.bitget.com/v2/ws/public",
    modifier: "ws-connected",
    dot: "pulse-dot-green",
    banner: false,
    bannerTitle: "",
    bannerDetail: "",
    role: "status",
  },
  polling: {
    label: "REST Polling",
    title: "Streaming unavailable — refreshing from the Bitget REST API instead",
    modifier: "ws-fallback",
    dot: "pulse-dot-gray",
    banner: false,
    bannerTitle: "",
    bannerDetail: "",
    role: "status",
  },
  stalled: {
    label: "Data Stalled",
    title: "No fresh Bitget quote has arrived in over two minutes. Automated fills and alerts are paused until data resumes.",
    modifier: "ws-stalled",
    dot: "pulse-dot-amber",
    banner: false,
    bannerTitle: "",
    bannerDetail: "",
    role: "alert",
  },
  offline: {
    label: "Offline",
    title: "This browser has no network connection. Market data will resume automatically.",
    modifier: "ws-offline",
    dot: "pulse-dot-red",
    banner: true,
    bannerTitle: "You appear to be offline",
    bannerDetail:
      "Market data, alerts and paper fills are paused. Everything saved on this device is intact — the desk will pick up where it left off once your connection returns.",
    role: "alert",
  },
};

/** Presentation for a feed state. */
export function dataFeedPresentation(state: DataFeedState): DataFeedPresentation {
  return DATA_FEED_PRESENTATION[state] ?? DATA_FEED_PRESENTATION.polling;
}

/**
 * Should the background polling loops run right now?
 *
 * Visibility only. `navigator.onLine` is intentionally *not* a factor: the flag
 * is unreliable in both directions (true behind a captive portal with no real
 * internet, false on flaky mobile networks), and gating on a false negative
 * would silently freeze the desk for a user who does have connectivity. Offline
 * is handled by the banner plus an immediate refresh on the `online` event —
 * a failed poll is harmless and self-heals, a suppressed one is not.
 */
export function shouldPoll(input: { visible: boolean; enabled?: boolean }): boolean {
  const { visible, enabled = true } = input;
  return enabled && visible;
}

/**
 * Decide whether an incoming alert should fire.
 *
 * Extracted because this is the check that was missing entirely. The alert
 * effect compares a stored trigger price against a cached quote; without a
 * freshness gate it will fire on whatever the last successfully fetched price
 * happened to be, however old, and the trigger is permanent.
 */
export function isAlertTriggered(input: {
  direction: "above" | "below";
  triggerPrice: number;
  quotePrice: number;
  quoteAsOf: number | null | undefined;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  const { direction, triggerPrice, quotePrice, quoteAsOf, now = Date.now(), maxAgeMs = MAX_QUOTE_AGE_MS } = input;

  if (!Number.isFinite(triggerPrice) || !Number.isFinite(quotePrice)) return false;
  if (!isQuoteActionable(quoteAsOf, now, maxAgeMs)) return false;

  return direction === "above" ? quotePrice >= triggerPrice : quotePrice <= triggerPrice;
}
