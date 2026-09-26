"use client";

import { useMemo, useState } from "react";
import type { CompletedTrade } from "@/lib/backtest";
import { runMonteCarloSimulation, type MonteCarloResult } from "@/lib/monte-carlo";

type MonteCarloPanelProps = {
  trades: CompletedTrade[];
  startingBalance?: number;
};

export function MonteCarloPanel({ trades, startingBalance = 10000 }: MonteCarloPanelProps) {
  const [jitterBps, setJitterBps] = useState(5);
  const [reseedKey, setReseedKey] = useState(0);

  const simulation: MonteCarloResult = useMemo(() => {
    // reseedKey allows user to trigger a fresh 1000-run simulation
    void reseedKey;
    return runMonteCarloSimulation(trades, startingBalance, 1000, jitterBps);
  }, [trades, startingBalance, jitterBps, reseedKey]);

  if (trades.length < 2) {
    return (
      <div className="panel monte-carlo-panel">
        <div className="panel-heading">
          <div>
            <h3>Monte Carlo Stress Test</h3>
            <p>1,000 bootstrap simulations require at least 2 completed backtest trades.</p>
          </div>
        </div>
        <div className="quiet-empty">
          Run a strategy backtest with sufficient trade signals to generate a Monte Carlo risk cone.
        </div>
      </div>
    );
  }

  // SVG Fan Chart calculation
  const trajectory = simulation.fanTrajectory;
  const chartHeight = 180;
  const chartWidth = 600;
  const padding = { top: 12, bottom: 12, left: 4, right: 4 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const maxVal = Math.max(...trajectory.map((t) => t.p95), startingBalance * 1.05);
  const minVal = Math.min(...trajectory.map((t) => t.p5), startingBalance * 0.95);
  const valRange = maxVal - minVal || 1;

  const stepCount = Math.max(1, trajectory.length - 1);

  function getX(index: number) {
    return padding.left + (index / stepCount) * innerWidth;
  }

  function getY(val: number) {
    return padding.top + innerHeight - ((val - minVal) / valRange) * innerHeight;
  }

  // Generate SVG path for a percentile curve
  function makeLinePath(key: keyof (typeof trajectory)[0]) {
    return trajectory
      .map((step, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx).toFixed(1)} ${getY(step[key]).toFixed(1)}`)
      .join(" ");
  }

  // Area between p5 and p95 (90% confidence cone)
  const outerConePath = (() => {
    if (trajectory.length < 2) return "";
    const top = trajectory.map((step, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx).toFixed(1)} ${getY(step.p95).toFixed(1)}`).join(" ");
    const bottom = trajectory
      .slice()
      .reverse()
      .map((step, idx) => `L ${getX(trajectory.length - 1 - idx).toFixed(1)} ${getY(step.p5).toFixed(1)}`)
      .join(" ");
    return `${top} ${bottom} Z`;
  })();

  // Area between p25 and p75 (IQR cone)
  const innerConePath = (() => {
    if (trajectory.length < 2) return "";
    const top = trajectory.map((step, idx) => `${idx === 0 ? "M" : "L"} ${getX(idx).toFixed(1)} ${getY(step.p75).toFixed(1)}`).join(" ");
    const bottom = trajectory
      .slice()
      .reverse()
      .map((step, idx) => `L ${getX(trajectory.length - 1 - idx).toFixed(1)} ${getY(step.p25).toFixed(1)}`)
      .join(" ");
    return `${top} ${bottom} Z`;
  })();

  const baselineY = getY(startingBalance);
  const baselinePct = Math.max(6, Math.min(94, (baselineY / chartHeight) * 100));

  return (
    <section className="panel monte-carlo-panel" aria-label="Monte Carlo Risk Analysis">
      <div className="panel-heading mc-heading">
        <div>
          <h3>Monte Carlo Stochastic Stress Test</h3>
          <p>
            1,000 bootstrap resamplings of {trades.length} trades with ±{jitterBps} bps randomized execution jitter
          </p>
        </div>
        <div className="mc-controls">
          <label className="mc-jitter-selector">
            <span>Slippage noise:</span>
            <select
              value={jitterBps}
              onChange={(e) => setJitterBps(Number(e.target.value))}
              aria-label="Slippage noise bps"
            >
              <option value={2}>±2 bps (Tight)</option>
              <option value={5}>±5 bps (Standard)</option>
              <option value={10}>±10 bps (Stress test)</option>
            </select>
          </label>
          <button
            type="button"
            className="button button-secondary mc-reseed-btn"
            onClick={() => setReseedKey((k) => k + 1)}
          >
            ↻ Resample 1,000 Paths
          </button>
        </div>
      </div>

      {/* Stress Verdict Banner */}
      <div className={`mc-verdict-banner rating-${simulation.stressRating.toLowerCase()}`}>
        <span className="mc-badge">{simulation.stressRating.toUpperCase()} PROFILE</span>
        <p className="mc-verdict-text">{simulation.stressVerdict}</p>
      </div>

      {/* Key Metric Tiles */}
      <div className="mc-metrics-grid">
        <div className="panel mc-stat-card">
          <span className="mc-stat-label">95% Value at Risk (VaR)</span>
          <strong className={`mc-stat-value ${simulation.var95ReturnPct >= 0 ? "tone-up" : "tone-down"}`}>
            {simulation.var95ReturnPct >= 0 ? "+" : ""}
            {simulation.var95ReturnPct.toFixed(1)}%
          </strong>
          <small className="mc-stat-desc">5th percentile return floor</small>
        </div>

        <div className="panel mc-stat-card">
          <span className="mc-stat-label">Conditional VaR (CVaR 95%)</span>
          <strong className={`mc-stat-value ${simulation.cvar95ReturnPct >= 0 ? "tone-up" : "tone-down"}`}>
            {simulation.cvar95ReturnPct >= 0 ? "+" : ""}
            {simulation.cvar95ReturnPct.toFixed(1)}%
          </strong>
          <small className="mc-stat-desc">Expected Shortfall (tail loss)</small>
        </div>

        <div className="panel mc-stat-card">
          <span className="mc-stat-label">Worst Drawdown (95th Pct)</span>
          <strong className="mc-stat-value tone-warn">{simulation.p95MaxDrawdownPct.toFixed(1)}%</strong>
          <small className="mc-stat-desc">Median DD: {simulation.medianMaxDrawdownPct.toFixed(1)}%</small>
        </div>

        <div className="panel mc-stat-card">
          <span className="mc-stat-label">Probability of Ruin</span>
          <strong
            className={`mc-stat-value ${simulation.probRuinPct > 0 ? "tone-down" : "tone-up"}`}
          >
            {simulation.probRuinPct.toFixed(1)}%
          </strong>
          <small className="mc-stat-desc">Severe (&gt;25% DD): {simulation.probSevereDrawdownPct.toFixed(1)}%</small>
        </div>
      </div>

      {/* SVG Fan Chart */}
      {/* SVG Fan Chart */}
      <div className="mc-chart-wrapper">
        <div className="mc-chart-header">
          <span className="mc-chart-title">Stochastic Equity Cone (90% Confidence Envelope)</span>
          <div className="mc-legend">
            <span className="legend-item"><span className="swatch baseline-swatch" />Start (${startingBalance.toLocaleString()})</span>
            <span className="legend-item"><span className="swatch cone-outer" />90% CI (5th–95th)</span>
            <span className="legend-item"><span className="swatch cone-inner" />50% IQR (25th–75th)</span>
            <span className="legend-item"><span className="swatch line-median" />Median Path (50th)</span>
          </div>
        </div>

        <div className="mc-chart-stage">
          {/* Y-axis labels positioned neatly on the left */}
          <div className="mc-y-scale" aria-hidden="true">
            <span className="mc-scale-val mc-scale-top">${Math.round(maxVal).toLocaleString()}</span>
            <span className="mc-scale-baseline-tag" style={{ top: `${baselinePct}%` }}>
              ${startingBalance.toLocaleString()}
            </span>
            <span className="mc-scale-val mc-scale-bottom">${Math.round(minVal).toLocaleString()}</span>
          </div>

          {/* SVG Plot area */}
          <div className="mc-svg-plot-area">
            <svg
              className="mc-fan-svg"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Monte Carlo Equity Envelope Chart"
            >
              <defs>
                <linearGradient id="mcConeOuter" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0c9a6b" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#0c9a6b" stopOpacity="0.05" />
                </linearGradient>
                <linearGradient id="mcConeInner" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0c9a6b" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#0c9a6b" stopOpacity="0.12" />
                </linearGradient>
              </defs>

              {/* Baseline starting balance line */}
              <line
                x1={0}
                y1={baselineY}
                x2={chartWidth}
                y2={baselineY}
                stroke="#c2d5c8"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />

              {/* Outer cone: p5 to p95 */}
              <path d={outerConePath} fill="url(#mcConeOuter)" />

              {/* Inner cone: p25 to p75 */}
              <path d={innerConePath} fill="url(#mcConeInner)" />

              {/* 5th percentile line */}
              <path d={makeLinePath("p5")} fill="none" stroke="#b64c50" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.85" />

              {/* 95th percentile line */}
              <path d={makeLinePath("p95")} fill="none" stroke="#0c9a6b" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.85" />

              {/* Median line */}
              <path d={makeLinePath("p50")} fill="none" stroke="#0c9a6b" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        {/* X Axis ticks */}
        <div className="mc-x-footer" aria-hidden="true">
          <span>Trade #0</span>
          <span>Trade #{trades.length}</span>
        </div>
      </div>
    </section>
  );
}
