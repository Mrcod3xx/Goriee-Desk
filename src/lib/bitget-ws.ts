"use client";

import { useEffect, useRef, useState } from "react";
import { nextReconnectDelayMs, shouldAttemptReconnect } from "@/lib/live-status";

export type WsTickerTick = {
  symbol: string;
  price: number;
  change24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  ts: number;
};

export type WsConnectionStatus = "connected" | "connecting" | "offline" | "fallback";

export function useBitgetTickerWs({
  symbol,
  enabled = true,
  onTick,
}: {
  symbol: string;
  enabled?: boolean;
  onTick: (tick: WsTickerTick) => void;
}) {
  const [status, setStatus] = useState<WsConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("WebSocket" in window)) {
      setStatus("fallback");
      return;
    }

    let isDisposed = false;
    let attempt = 0;
    const safeSymbol = symbol.toUpperCase().trim();

    const isHidden = () => typeof document !== "undefined" && document.hidden === true;

    const cleanupWs = () => {
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };

    /**
     * Schedule the next reconnect attempt.
     *
     * Backoff is exponential with jitter rather than the previous flat 3s. The
     * flat timer had two problems: every client that lost connectivity at once
     * retried in lockstep the moment Bitget recovered, and it retried forever,
     * so a tab left open on a dead network hammered the endpoint indefinitely.
     */
    const scheduleReconnect = () => {
      if (isDisposed || retryTimerRef.current !== null) return;

      // Suspend rather than schedule: a parked tab would otherwise burn the
      // entire attempt budget in the background and still be disconnected by
      // the time the user looked at it again. `visibilitychange` re-arms it.
      if (isHidden()) {
        setStatus("offline");
        return;
      }

      if (!shouldAttemptReconnect(attempt)) {
        // Out of attempts. REST polling in trading-desk covers the data, so
        // this is a graceful degradation, not a failure.
        setStatus("fallback");
        return;
      }

      const delay = nextReconnectDelayMs(attempt);
      attempt += 1;
      setStatus("offline");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        if (!isDisposed) connect();
      }, delay);
    };

    const connect = () => {
      if (isDisposed) return;
      cleanupWs();
      setStatus("connecting");

      try {
        const socket = new WebSocket("wss://ws.bitget.com/v2/ws/public");
        wsRef.current = socket;

        socket.onopen = () => {
          if (isDisposed) return;
          // A healthy connection resets the backoff, so the next drop starts
          // from ~1s again instead of inheriting a grown delay.
          attempt = 0;
          setStatus("connected");

          // Subscribe to SPOT ticker
          const subMsg = {
            op: "subscribe",
            args: [
              {
                instType: "SPOT",
                channel: "ticker",
                instId: safeSymbol,
              },
            ],
          };
          socket.send(JSON.stringify(subMsg));

          // Bitget ping heartbeat every 25 seconds
          pingTimerRef.current = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send("ping");
            }
          }, 25_000);
        };

        socket.onmessage = (event) => {
          if (isDisposed) return;
          if (event.data === "pong") {
            return;
          }

          try {
            const msg = JSON.parse(event.data);
            if (msg.event === "error") {
              console.warn("Bitget WS reported error:", msg);
              return;
            }

            if (
              (msg.action === "snapshot" || msg.action === "update") &&
              msg.arg?.channel === "ticker" &&
              Array.isArray(msg.data) &&
              msg.data.length > 0
            ) {
              const item = msg.data[0];
              const lastPrice = Number(item.lastPr || item.lastPrice || item.price);
              if (Number.isFinite(lastPrice) && lastPrice > 0) {
                const tick: WsTickerTick = {
                  symbol: safeSymbol,
                  price: lastPrice,
                  change24h: item.change24h ? Number(item.change24h) * 100 : undefined,
                  high24h: item.high24h ? Number(item.high24h) : undefined,
                  low24h: item.low24h ? Number(item.low24h) : undefined,
                  volume24h: item.baseVolume ? Number(item.baseVolume) : undefined,
                  ts: Number(item.ts) || Date.now(),
                };
                onTickRef.current(tick);
              }
            }
          } catch {
            // invalid JSON or non-ticker frame
          }
        };

        // Intentionally does not touch `status`. The WebSocket spec fires
        // `onclose` after every `onerror`, so setting state here produced two
        // renders and a visible badge flicker for a single dropped socket.
        // `onclose` owns the transition.
        socket.onerror = () => {
          if (isDisposed) return;
        };

        socket.onclose = () => {
          if (isDisposed) return;
          scheduleReconnect();
        };
      } catch (err) {
        console.warn("Could not initiate Bitget WebSocket:", err);
        setStatus("fallback");
      }
    };

    /**
     * Re-arm after a suspension. Called on becoming visible and on `online`.
     *
     * The attempt counter resets so a tab returning from the background, or a
     * network coming back, gets a full fresh budget rather than inheriting the
     * "given up" state it was left in.
     */
    const rearm = () => {
      if (isDisposed) return;
      if (isHidden()) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      attempt = 0;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      connect();
    };

    const handleVisibilityChange = () => {
      if (isDisposed || isHidden()) return;
      rearm();
    };

    connect();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", rearm);

    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", rearm);
      cleanupWs();
    };
  }, [symbol, enabled]);

  return { status };
}
