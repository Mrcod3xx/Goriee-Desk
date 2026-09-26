"use client";

import { useEffect, useState } from "react";
import type { MarketData } from "@/lib/bitget";
import { getIndicatorSnapshot } from "@/lib/bitget";

type MultiChartGridProps = {
  activeSymbol: string;
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onOpenOrder: (symbol: string) => void;
};

type MiniTerminalState = {
  symbol: string;
  interval: string;
  market: MarketData | null;
  loading: boolean;
  error: string;
};

const DEFAULT_GRID_ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"];

export function MultiChartGrid({
  activeSymbol,
  watchlist,
  onSelectSymbol,
  onOpenOrder,
}: MultiChartGridProps) {
  // Build 4 unique symbols, starting with activeSymbol, then popular or watchlist
  const initialSymbols = [
    activeSymbol,
    ...DEFAULT_GRID_ASSETS.filter((s) => s !== activeSymbol),
    ...watchlist.filter((s) => s !== activeSymbol && !DEFAULT_GRID_ASSETS.includes(s)),
  ].slice(0, 4);

  const [terminals, setTerminals] = useState<MiniTerminalState[]>(() =>
    initialSymbols.map((symbol) => ({
      symbol,
      interval: "1H",
      market: null,
      loading: true,
      error: "",
    }))
  );

  // Sync if activeSymbol changes
  useEffect(() => {
    setTerminals((prev) => {
      const exists = prev.some((t) => t.symbol === activeSymbol);
      if (exists) return prev;
      const next = [...prev];
      next[0] = { ...next[0], symbol: activeSymbol, loading: true, market: null };
      return next;
    });
  }, [activeSymbol]);

  // Fetch data for each terminal
  useEffect(() => {
    let cancelled = false;

    terminals.forEach((term, index) => {
      if (term.market && term.market.symbol === term.symbol && term.market.interval === term.interval) {
        return; // already loaded
      }

      fetch(`/api/market?symbol=${term.symbol}&interval=${term.interval}`, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          if (!cancelled && json.market) {
            setTerminals((prev) => {
              const copy = [...prev];
              if (copy[index]) {
                copy[index] = { ...copy[index], market: json.market, loading: false, error: "" };
              }
              return copy;
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setTerminals((prev) => {
              const copy = [...prev];
              if (copy[index]) {
                copy[index] = {
                  ...copy[index],
                  loading: false,
                  error: err instanceof Error ? err.message : "Load failed",
                };
              }
              return copy;
            });
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [terminals]);

  function handleIntervalChange(index: number, newInterval: string) {
    setTerminals((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], interval: newInterval, loading: true };
      return copy;
    });
  }

  function handleSymbolChange(index: number, newSymbol: string) {
    setTerminals((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], symbol: newSymbol.toUpperCase(), loading: true, market: null };
      return copy;
    });
  }

  return (
    <div className="multi-chart-grid" aria-label="Institutional Multi-Terminal 2x2 Grid">
      {terminals.map((term, idx) => {
        const market = term.market;
        const indicators = market ? getIndicatorSnapshot(market) : null;
        const candles = market?.candles.slice(-35) ?? [];

        // Mini SVG Candlestick rendering
        const minPrice = candles.length ? Math.min(...candles.map((c) => c.low)) : 0;
        const maxPrice = candles.length ? Math.max(...candles.map((c) => c.high)) : 1;
        const range = maxPrice - minPrice || 1;
        const svgW = 320;
        const svgH = 100;
        const candleW = candles.length ? Math.max(3, Math.floor(svgW / candles.length) - 2) : 5;

        return (
          <div key={`terminal-${idx}-${term.symbol}`} className="panel mini-terminal-card">
            {/* Header */}
            <div className="mini-term-header">
              <div className="mini-term-title">
                <input
                  type="text"
                  className="mini-symbol-input"
                  value={term.symbol}
                  onChange={(e) => handleSymbolChange(idx, e.target.value)}
                  onBlur={(e) => {
                    const val = e.target.value.trim().toUpperCase();
                    if (val && !val.endsWith("USDT")) {
                      handleSymbolChange(idx, `${val}USDT`);
                    }
                  }}
                  title="Edit pair symbol"
                />
                <select
                  value={term.interval}
                  onChange={(e) => handleIntervalChange(idx, e.target.value)}
                  className="mini-interval-select"
                  aria-label="Interval"
                >
                  <option value="15m">15m</option>
                  <option value="1H">1H</option>
                  <option value="4H">4H</option>
                  <option value="1D">1D</option>
                </select>
              </div>

              <div className="mini-term-actions">
                <button
                  type="button"
                  className="button button-secondary mini-focus-btn"
                  onClick={() => onSelectSymbol(term.symbol)}
                  title="Focus this asset in primary terminal"
                >
                  Focus Desk ↗
                </button>
                <button
                  type="button"
                  className="button button-primary mini-trade-btn"
                  onClick={() => onOpenOrder(term.symbol)}
                  title="Open paper trade order"
                >
                  Trade
                </button>
              </div>
            </div>

            {/* Price & Regime Bar */}
            <div className="mini-term-quote">
              <div>
                <strong className="mini-price">
                  {market
                    ? `$${market.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: market.price < 1 ? 4 : 2 })}`
                    : term.loading
                    ? "Loading…"
                    : "n/a"}
                </strong>
                {market ? (
                  <span className={`mini-change ${market.change24h >= 0 ? "tone-up" : "tone-down"}`}>
                    {market.change24h >= 0 ? "+" : ""}
                    {market.change24h.toFixed(2)}%
                  </span>
                ) : null}
              </div>

              {indicators ? (
                <div className="mini-regime-wrap">
                  <span
                    className={`regime-pill ${
                      indicators.regime === "Bullish structure"
                        ? "pill-bull"
                        : indicators.regime === "Bearish structure"
                        ? "pill-bear"
                        : "pill-neutral"
                    }`}
                  >
                    {indicators.regime.replace(" structure", "")}
                  </span>
                  <small className="mini-rsi">RSI: {indicators.rsi14.toFixed(0)}</small>
                </div>
              ) : null}
            </div>

            {/* Candlestick SVG */}
            <div className="mini-chart-container">
              {term.loading && !market ? (
                <div className="mini-chart-loading">
                  <span className="loader-ring" />
                  <span>Loading {term.symbol}…</span>
                </div>
              ) : term.error && !market ? (
                <div className="mini-chart-error">{term.error}</div>
              ) : (
                <svg
                  className="mini-candlestick-svg"
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  preserveAspectRatio="none"
                >
                  {candles.map((candle, cIdx) => {
                    const x = (cIdx / candles.length) * svgW + candleW / 2;
                    const isUp = candle.close >= candle.open;
                    const highY = svgH - ((candle.high - minPrice) / range) * svgH;
                    const lowY = svgH - ((candle.low - minPrice) / range) * svgH;
                    const openY = svgH - ((candle.open - minPrice) / range) * svgH;
                    const closeY = svgH - ((candle.close - minPrice) / range) * svgH;
                    const bodyTop = Math.min(openY, closeY);
                    const bodyH = Math.max(2, Math.abs(closeY - openY));
                    const color = isUp ? "#0c9a6b" : "#b64c50";

                    return (
                      <g key={`c-${candle.time}`}>
                        {/* Wick */}
                        <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1" />
                        {/* Body */}
                        <rect
                          x={x - candleW / 2}
                          y={bodyTop}
                          width={candleW}
                          height={bodyH}
                          fill={color}
                          rx="1"
                        />
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>

            {/* Footer metrics */}
            <div className="mini-term-footer">
              <span>H: ${market?.high24h.toFixed(market?.high24h < 1 ? 4 : 2) ?? "-"}</span>
              <span>L: ${market?.low24h.toFixed(market?.low24h < 1 ? 4 : 2) ?? "-"}</span>
              <span>Vol: {market ? (market.turnover24h / 1e6).toFixed(1) : "-"}M</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
