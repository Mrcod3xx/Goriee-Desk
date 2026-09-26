"use client";

import { useEffect, useRef, useState } from "react";

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
    const safeSymbol = symbol.toUpperCase().trim();

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

    const connect = () => {
      if (isDisposed) return;
      cleanupWs();
      setStatus("connecting");

      try {
        const socket = new WebSocket("wss://ws.bitget.com/v2/ws/public");
        wsRef.current = socket;

        socket.onopen = () => {
          if (isDisposed) return;
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

        socket.onerror = () => {
          if (isDisposed) return;
          setStatus("fallback");
        };

        socket.onclose = () => {
          if (isDisposed) return;
          setStatus("offline");
          // Reconnect with 3s backoff
          retryTimerRef.current = window.setTimeout(() => {
            if (!isDisposed) connect();
          }, 3000);
        };
      } catch (err) {
        console.warn("Could not initiate Bitget WebSocket:", err);
        setStatus("fallback");
      }
    };

    connect();

    return () => {
      isDisposed = true;
      cleanupWs();
    };
  }, [symbol, enabled]);

  return { status };
}
