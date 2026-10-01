"use client";

import { memo, useMemo } from "react";
import type { ClosedPaperTrade, BacktestResult } from "@/components/desk-types";
import { formatMoney, formatDate } from "@/components/desk-shared";

// These three are pure presentational charts fed referentially stable props
// (closedPaperTrades is a useMemo, backtest.equity/backtest.trades come straight
// off state). Memoizing them stops the SVG path recomputation from running on
// every WebSocket price tick.
export const CumulativePnlChart = memo(function CumulativePnlChart({ trades }: { trades: ClosedPaperTrade[] }) {
  const data = useMemo(() => {
    if (trades.length < 2) return null;
    const chronological = [...trades].sort((a, b) => a.closedAt - b.closedAt);
    let running = 0;
    const series = chronological.map((trade) => {
      running += trade.netPnl;
      return { time: trade.closedAt, pnl: running, symbol: trade.symbol };
    });
    const values = series.map((s) => s.pnl);
    const minPnl = Math.min(0, ...values);
    const maxPnl = Math.max(0, ...values);
    const spread = maxPnl - minPnl || 1;
    const width = 640;
    const height = 135;
    const padTop = 16;
    const padBottom = 22;
    const usableHeight = height - padTop - padBottom;
    const zeroY = padTop + ((maxPnl - 0) / spread) * usableHeight;

    const path = series
      .map((s, idx) => {
        const x = (idx / (series.length - 1)) * width;
        const y = padTop + ((maxPnl - s.pnl) / spread) * usableHeight;
        return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return {
      series,
      path,
      zeroY,
      width,
      height,
      minPnl,
      maxPnl,
      finalPnl: running,
    };
  }, [trades]);

  if (!data) return null;
  const isPositive = data.finalPnl >= 0;

  return (
    <section className="panel cumulative-pnl-panel" aria-label="Cumulative realized P&L trajectory">
      <div className="panel-heading">
        <div>
          <h2>Cumulative Realized P&amp;L Trajectory</h2>
          <p>Closed-trade performance curve across {trades.length} completed positions.</p>
        </div>
        <div className="cumulative-badge">
          <span>Net Result</span>
          <strong className={isPositive ? "tone-up" : "tone-down"}>
            {formatMoney(data.finalPnl)}
          </strong>
        </div>
      </div>
      <div className="cumulative-chart-wrap">
        <svg
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="cumulative-chart-svg"
          preserveAspectRatio="none"
          role="img"
          aria-label="Cumulative P&L curve"
        >
          <line x1="0" x2={data.width} y1={data.zeroY} y2={data.zeroY} className="chart-zero-line" />
          <path
            d={data.path}
            className={`chart-line ${isPositive ? "chart-line-up" : "chart-line-down"}`}
          />
        </svg>
        <div className="chart-scale">
          <span>{formatMoney(data.minPnl)}</span>
          <span className="zero-scale-label">Baseline $0.00</span>
          <span>{formatMoney(data.maxPnl)}</span>
        </div>
        <div className="chart-footer">
          <span>{formatDate(data.series[0].time, false)}</span>
          <span>{formatDate(data.series.at(-1)!.time, false)}</span>
        </div>
      </div>
    </section>
  );
});

export const Stat = memo(function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
    </div>
  );
});

export const EquityChart = memo(function EquityChart({ points }: { points: BacktestResult["equity"] }) {
  const values = points.map((point) => point.value);
  if (values.length < 2) return <div className="chart-empty">Not enough candles to draw a curve.</div>;
  const benchmarkValues = points.map((p) => p.benchmarkValue ?? p.value);
  const allVals = [...values, ...benchmarkValues];
  const low = Math.min(...allVals);
  const high = Math.max(...allVals);
  const spread = high - low || 1;
  const width = 640;
  const height = 250;
  const strategyLine = values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1) * width).toFixed(2)},${(height - 16 - (value - low) / spread * (height - 32)).toFixed(2)}`).join(" ");
  const benchmarkLine = benchmarkValues.map((value, index) => `${index ? "L" : "M"}${(index / (benchmarkValues.length - 1) * width).toFixed(2)},${(height - 16 - (value - low) / spread * (height - 32)).toFixed(2)}`).join(" ");
  const strategyReturn = values[0] > 0 ? ((values.at(-1)! / values[0]) - 1) * 100 : 0;
  const benchmarkReturn = benchmarkValues[0] > 0 ? ((benchmarkValues.at(-1)! / benchmarkValues[0]) - 1) * 100 : 0;
  const alpha = strategyReturn - benchmarkReturn;
  return (
    <div className="equity-chart-wrap">
      <div className="equity-chart-legend">
        <div className="legend-item strategy-legend">
          <span className="legend-swatch swatch-strategy" />
          <span>Strategy: <strong>{formatMoney(values.at(-1)!)}</strong> <small className={strategyReturn >= 0 ? "tone-up" : "tone-down"}>({strategyReturn >= 0 ? "+" : ""}{strategyReturn.toFixed(2)}%)</small></span>
        </div>
        <div className="legend-item benchmark-legend">
          <span className="legend-swatch swatch-benchmark" />
          <span>Buy &amp; Hold: <strong>{formatMoney(benchmarkValues.at(-1)!)}</strong> <small className={benchmarkReturn >= 0 ? "tone-up" : "tone-down"}>({benchmarkReturn >= 0 ? "+" : ""}{benchmarkReturn.toFixed(2)}%)</small></span>
        </div>
        <span className={`alpha-pill ${alpha >= 0 ? "tone-up" : "tone-down"}`}>
          Alpha: {alpha >= 0 ? "+" : ""}{alpha.toFixed(2)}%
        </span>
      </div>
      <svg className="price-chart equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Backtest portfolio value vs buy and hold benchmark" preserveAspectRatio="none">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="chart-grid" />
        <path d={benchmarkLine} className="chart-benchmark-line" />
        <path d={strategyLine} className="chart-line chart-line-up" />
      </svg>
      <div className="chart-scale"><span>{formatMoney(low)}</span><span>{formatMoney(high)}</span></div>
      <div className="chart-footer"><span>{formatDate(points[0].time, false)}</span><span>{formatDate(points.at(-1)!.time, false)}</span></div>
    </div>
  );
});
