"use client";

import { useEffect, useRef, useState } from "react";
import {
  dataFeedPresentation,
  resolveDataFeedState,
  type DataFeedPresentation,
  type DataFeedState,
} from "@/lib/live-status";

/**
 * React bindings for the liveness rules in `live-status.ts`.
 *
 * Every hook here is SSR-safe: the initial state is computed without touching
 * `window`, `document` or `navigator`, and browser APIs are only read inside
 * `useEffect` or guarded by `typeof`. That matters because `trading-desk.tsx`
 * is a client component that still renders once on the server during
 * prerendering — reading `document.hidden` at module or render scope would
 * throw there.
 */

/**
 * Is the tab visible and should background work be happening?
 *
 * Returns `true` during the server render so the first client pass matches the
 * prerendered HTML, then corrects itself in the effect. The one-frame delay is
 * invisible and avoids a hydration mismatch.
 */
export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return visible;
}

/** Tracks `navigator.onLine` plus the `online` / `offline` events. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // Some browsers leave `onLine` undefined; treat that as connected, since a
    // false "offline" banner is far more disruptive than a missing true one.
    const sync = () => setOnline(typeof navigator.onLine === "boolean" ? navigator.onLine : true);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}

export type ConnectionStatus = {
  online: boolean;
  /** Tab is visible; polling is permitted. */
  visible: boolean;
  feed: DataFeedState;
  presentation: DataFeedPresentation;
};

/**
 * Fold connectivity, WebSocket state and quote freshness into one status.
 *
 * `quoteAgeMs` is passed in as a number rather than a timestamp so this hook
 * stays free of "which clock field means what" knowledge — that ambiguity is
 * real in this codebase (see `use-live-status` callers: `Quote.asOf` is fetch
 * time, `market.asOf` is a candle close) and resolving it belongs at the call
 * site, not here.
 *
 * `paused` tells the resolver that polling is deliberately suspended, so a
 * backgrounded tab does not report its own power saving as a data outage.
 */
export function useConnectionStatus(input: {
  wsConnected: boolean;
  quoteAgeMs: number;
  paused?: boolean;
  maxAgeMs?: number;
}): ConnectionStatus {
  const online = useOnlineStatus();
  const visible = useDocumentVisibility();

  const feed = resolveDataFeedState({
    online,
    wsConnected: input.wsConnected,
    quoteAgeMs: input.quoteAgeMs,
    // Nothing can go stale while we are not polling, and nothing can go stale
    // while the tab is hidden either — both are intentional suspensions.
    paused: input.paused ?? !visible,
    maxAgeMs: input.maxAgeMs,
  });

  return { online, visible, feed, presentation: dataFeedPresentation(feed) };
}

/**
 * Bump a counter when the network comes back.
 *
 * Polling loops list this in their deps so a reconnect re-runs the effect and
 * fetches *immediately*, rather than waiting out the remainder of a 60s
 * interval — after an outage the user should not stare at pre-outage prices
 * for up to another minute.
 *
 * Visibility is deliberately **not** a trigger here. Callers gate their loops
 * on `shouldPoll`, and `pollingEnabled` already flips false→true when the tab
 * is shown, which re-runs the effect on its own. Firing on both transitions
 * would send every request twice on each alt-tab back.
 *
 * Fires on transitions only, never on mount: the effects already do their
 * initial fetch on first render.
 */
export function useOnlineResumeToken(): number {
  const [token, setToken] = useState(0);
  const previous = useRef<boolean | null>(null);
  const online = useOnlineStatus();

  useEffect(() => {
    const last = previous.current;
    previous.current = online;
    if (last === false && online) setToken((count) => count + 1);
  }, [online]);

  return token;
}
