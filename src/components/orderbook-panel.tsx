"use client";

import { useEffect, useState } from "react";
import { useDocumentVisibility } from "@/components/use-live-status";
import { shouldPoll } from "@/lib/live-status";
import type { OrderBookData } from "@/lib/orderbook";

type OrderBookPanelProps = {
  symbol: string;
  onPickPrice?: (price: number) => void;
};

export function OrderBookPanel({ symbol, onPickPrice }: OrderBookPanelProps) {
  const [data, setData] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const documentVisible = useDocumentVisibility();
  // The tightest loop in the app: 3s, and it self-reschedules from `finally`,
  // so it survived everything — including the tab being closed behind another
  // window for hours. 1,200 requests/hour per parked tab against a single
  // upstream rate limit the visible tab also needs. Gated like the desk's own
  // loops; the effect re-running on tab-show fetches immediately, so returning
  // users see fresh depth rather than a 3s-old snapshot.
  const pollingEnabled = shouldPoll({ visible: documentVisible });

  useEffect(() => {
    if (!pollingEnabled) return;
    let active = true;
    let timer: NodeJS.Timeout | null = null;

    async function fetchBook() {
      try {
        const res = await fetch(`/api/orderbook?symbol=${symbol}&limit=10`, { cache: "no-store" });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (active) {
          setData(json.orderbook);
          setError("");
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Order book unavailable");
          setLoading(false);
        }
      } finally {
        if (active) {
          timer = setTimeout(fetchBook, 3000);
        }
      }
    }

    setLoading(true);
    fetchBook();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, pollingEnabled]);

  const bids = data?.bids.slice(0, 8) ?? [];
  const asks = (data?.asks.slice(0, 8) ?? []).slice().reverse(); // display lowest ask closest to midpoint

  const imbalance = data ? data.imbalancePct : 0;
  const isBidImbalance = imbalance >= 0;
  const bidPct = Math.round(50 + imbalance / 2);
  const askPct = 100 - bidPct;

  return (
    <div className="panel orderbook-panel" aria-label="Level 2 Order Book & Depth Ladder">
      <div className="panel-heading orderbook-heading">
        <div>
          <h3>L2 Depth Ladder</h3>
          <p>Real-time Bitget order book &amp; micro-spread</p>
        </div>
        <div className="orderbook-meta">
          {/*
            This panel polls REST every 3s; it never opened a WebSocket, so the
            old `title="Live stream active"` described something that does not
            exist — and kept claiming it while the tab was hidden and the data
            was frozen. The title now states the real mechanism and the real
            paused state, and the dot is dimmed while suspended so the panel
            does not look live when it is not fetching.
          */}
          <span
            className={`live-pulse-dot${pollingEnabled ? "" : " paused"}`}
            title={
              pollingEnabled
                ? "Refreshing every 3s from the Bitget REST order book"
                : "Paused while this tab is in the background — resumes automatically"
            }
          />
          <span className="orderbook-spread">
            {data ? (
              <>
                Spread: <strong>${data.spread.toFixed(data.spread < 1 ? 4 : 2)}</strong>{" "}
                <small>({data.spreadBps.toFixed(2)} bps)</small>
              </>
            ) : (
              "Connecting…"
            )}
          </span>
        </div>
      </div>

      {/* Order Book Imbalance (OBI) Gauge */}
      <div className="obi-gauge-container" title="Order Book Imbalance: Net buying vs selling pressure in top levels">
        <div className="obi-label-row">
          <span className="obi-bids-label">
            Bids {bidPct}% ({(data?.totalBidVol ?? 0).toFixed(3)} {symbol.replace("USDT", "")})
          </span>
          <span className={`obi-bias-badge ${isBidImbalance ? "bias-bull" : "bias-bear"}`}>
            {isBidImbalance ? "+" : ""}{imbalance.toFixed(1)}% {isBidImbalance ? "Buy Wall" : "Sell Wall"}
          </span>
          <span className="obi-asks-label">
            {askPct}% Asks ({(data?.totalAskVol ?? 0).toFixed(3)} {symbol.replace("USDT", "")})
          </span>
        </div>
        <div className="obi-bar-track">
          <div className="obi-bar-bids" style={{ width: `${bidPct}%` }} />
          <div className="obi-bar-asks" style={{ width: `${askPct}%` }} />
        </div>
      </div>

      {loading && !data ? (
        <div className="orderbook-loading">
          <span className="loader-ring" />
          <span>Streaming Bitget order book…</span>
        </div>
      ) : error && !data ? (
        <div className="orderbook-error">
          <span>{error}</span>
        </div>
      ) : asks.length === 0 && bids.length === 0 ? (
        <div className="orderbook-empty">
          <p>No active market depth returned for {symbol}.</p>
          <small>Select a high-volume market (e.g. BTC, ETH, SOL) to inspect live depth.</small>
        </div>
      ) : (
        <div className="orderbook-ladder">
          <div className="ladder-header">
            <span>Price (USDT)</span>
            <span>Size</span>
            <span>Total Depth</span>
          </div>

          {/* Asks (Sells) - highest at top, lowest closest to spread */}
          <div className="ladder-asks">
            {asks.map((ask) => (
              <button
                type="button"
                key={`ask-${ask.price}`}
                className="ladder-row ask-row"
                onClick={() => onPickPrice?.(ask.price)}
                title={`Click to fill paper order at $${ask.price.toFixed(2)}`}
              >
                <div className="depth-fill ask-depth" style={{ width: `${ask.depthPct}%` }} />
                <span className="ladder-price ask-price">{ask.price.toFixed(ask.price < 1 ? 4 : 2)}</span>
                <span className="ladder-size">{ask.size.toFixed(4)}</span>
                <span className="ladder-total">{ask.total.toFixed(4)}</span>
              </button>
            ))}
          </div>

          {/* Midpoint Spread Divider */}
          <div className="ladder-midpoint">
            <span className="midpoint-label">MID</span>
            <strong className="midpoint-price">
              ${(data?.midpoint ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </strong>
            <span className="midpoint-hint">Click any price to prefill order</span>
          </div>

          {/* Bids (Buys) - highest closest to spread, lowest at bottom */}
          <div className="ladder-bids">
            {bids.map((bid) => (
              <button
                type="button"
                key={`bid-${bid.price}`}
                className="ladder-row bid-row"
                onClick={() => onPickPrice?.(bid.price)}
                title={`Click to fill paper order at $${bid.price.toFixed(2)}`}
              >
                <div className="depth-fill bid-depth" style={{ width: `${bid.depthPct}%` }} />
                <span className="ladder-price bid-price">{bid.price.toFixed(bid.price < 1 ? 4 : 2)}</span>
                <span className="ladder-size">{bid.size.toFixed(4)}</span>
                <span className="ladder-total">{bid.total.toFixed(4)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
