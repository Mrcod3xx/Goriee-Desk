"use client";

import { useEffect, useState } from "react";
import type { ConfluenceResult } from "@/app/api/market/confluence/route";

export function MultiHorizonConfluencePanel({
  symbol,
  onSeedBrief,
}: {
  symbol: string;
  onSeedBrief: (prompt: string) => void;
}) {
  const [data, setData] = useState<ConfluenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/market/confluence?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed to load confluence data");
        if (active) setData(payload.confluence);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Confluence calculation failed");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [symbol, refreshIndex]);

  const handleSeed = () => {
    if (!data) return;
    const h15m = data.horizons.find((h) => h.interval === "15m");
    const h1h = data.horizons.find((h) => h.interval === "1H");
    const h4h = data.horizons.find((h) => h.interval === "4H");
    const h1d = data.horizons.find((h) => h.interval === "1D");

    const prompt = `Synthesize multi-horizon trend confluence for ${data.symbol}. Overall alignment is ${data.confluenceScore}% ${data.direction} (${data.overallRegime}).
- 15m: ${h15m?.bias ?? "n/a"} (RSI: ${h15m?.rsi14?.toFixed(1) ?? "n/a"}, MACD Hist: ${h15m?.macdHist !== null && h15m?.macdHist !== undefined ? h15m.macdHist.toFixed(2) : "n/a"})
- 1H: ${h1h?.bias ?? "n/a"} (RSI: ${h1h?.rsi14?.toFixed(1) ?? "n/a"}, MACD Hist: ${h1h?.macdHist !== null && h1h?.macdHist !== undefined ? h1h.macdHist.toFixed(2) : "n/a"})
- 4H: ${h4h?.bias ?? "n/a"} (RSI: ${h4h?.rsi14?.toFixed(1) ?? "n/a"}, MACD Hist: ${h4h?.macdHist !== null && h4h?.macdHist !== undefined ? h4h.macdHist.toFixed(2) : "n/a"})
- 1D: ${h1d?.bias ?? "n/a"} (RSI: ${h1d?.rsi14?.toFixed(1) ?? "n/a"}, MACD Hist: ${h1d?.macdHist !== null && h1d?.macdHist !== undefined ? h1d.macdHist.toFixed(2) : "n/a"})
Identify key cross-timeframe support/resistance confluence zones, high-probability execution setups, and invalidation criteria.`;

    onSeedBrief(prompt);
  };

  return (
    <div className="panel confluence-panel" aria-label="Multi-Horizon Trend Confluence Matrix">
      <div className="panel-heading">
        <div>
          <h2>Multi-Horizon Trend Confluence Matrix</h2>
          <p>Real-time cross-horizon alignment across 15m, 1H, 4H, and 1D timeframes.</p>
        </div>
        <div className="confluence-actions">
          <button
            type="button"
            className="button button-secondary confluence-refresh-btn"
            onClick={() => setRefreshIndex((c) => c + 1)}
            disabled={loading}
            title="Refresh confluence calculations"
          >
            {loading ? "Calculating…" : "Refresh Matrix"}
          </button>
          {data ? (
            <button
              type="button"
              className="button button-primary confluence-seed-btn"
              onClick={handleSeed}
              title="Send multi-horizon findings directly to the AI Research Brief"
            >
              Seed into AI Brief →
            </button>
          ) : null}
        </div>
      </div>

      {loading && !data ? (
        <div className="confluence-loading">
          <span className="loader-ring" />
          <span>Computing multi-horizon EMA, RSI, and MACD alignment across Bitget spot order flow…</span>
        </div>
      ) : null}

      {error ? (
        <div className="confluence-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => setRefreshIndex((c) => c + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="confluence-summary-bar">
            <div className="confluence-score-box">
              <div className="score-meter-wrap">
                <div
                  className={`score-meter-fill ${
                    data.direction === "Bullish"
                      ? "score-up"
                      : data.direction === "Bearish"
                      ? "score-down"
                      : "score-mixed"
                  }`}
                  style={{ width: `${Math.max(12, data.confluenceScore)}%` }}
                />
              </div>
              <div className="score-label-row">
                <span className="confluence-score-value">
                  <strong>{data.confluenceScore}%</strong> Confluence
                </span>
                <span
                  className={`confluence-dir-badge ${
                    data.direction === "Bullish"
                      ? "badge-up"
                      : data.direction === "Bearish"
                      ? "badge-down"
                      : "badge-mixed"
                  }`}
                >
                  {data.overallRegime}
                </span>
              </div>
            </div>
            <p className="confluence-text-summary">{data.summary}</p>
          </div>

          <div className="confluence-grid">
            {data.horizons.map((h) => {
              const isBull = h.bias === "Bullish";
              const isBear = h.bias === "Bearish";
              return (
                <div
                  key={h.interval}
                  className={`confluence-horizon-card ${
                    isBull ? "card-bullish" : isBear ? "card-bearish" : "card-neutral"
                  }`}
                >
                  <div className="horizon-card-header">
                    <span className="horizon-tf-pill">{h.interval}</span>
                    <span
                      className={`horizon-bias-badge ${
                        isBull ? "tone-up" : isBear ? "tone-down" : "tone-neutral"
                      }`}
                    >
                      {h.bias}
                    </span>
                  </div>

                  <div className="horizon-metrics">
                    <div className="horizon-metric-row">
                      <span>Price</span>
                      <strong>
                        {h.price >= 1000
                          ? `$${h.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `$${h.price.toFixed(4)}`}
                      </strong>
                    </div>

                    <div className="horizon-metric-row">
                      <span>EMA Trend</span>
                      <strong className={isBull ? "tone-up" : isBear ? "tone-down" : ""}>
                        {h.trendState}
                      </strong>
                    </div>

                    <div className="horizon-metric-row">
                      <span>RSI (14)</span>
                      <strong
                        className={
                          (h.rsi14 ?? 50) >= 55
                            ? "tone-up"
                            : (h.rsi14 ?? 50) <= 45
                            ? "tone-down"
                            : ""
                        }
                      >
                        {h.rsi14 !== null ? h.rsi14.toFixed(1) : "n/a"}
                      </strong>
                    </div>

                    <div className="horizon-metric-row">
                      <span>MACD Hist</span>
                      <strong
                        className={
                          (h.macdHist ?? 0) >= 0 ? "tone-up" : "tone-down"
                        }
                      >
                        {h.macdHist !== null
                          ? `${h.macdHist >= 0 ? "+" : ""}${h.macdHist.toFixed(2)}`
                          : "n/a"}
                      </strong>
                    </div>

                    <div className="horizon-metric-row">
                      <span>ATR (14)</span>
                      <span className="atr-subtle">
                        {h.atrVal !== null ? `$${h.atrVal.toFixed(2)}` : "n/a"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
