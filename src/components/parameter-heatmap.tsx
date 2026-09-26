"use client";

import React, { useState } from "react";
import type { ParameterMatrixResult, MatrixCell } from "@/lib/parameter-matrix";

export function ParameterHeatmap({
  matrix,
  onApplyParameters,
}: {
  matrix: ParameterMatrixResult;
  onApplyParameters?: (paramA: number, paramB: number) => void;
}) {
  const [activeMetric, setActiveMetric] = useState<"return" | "winRate" | "drawdown" | "profitFactor">("return");
  const [hoveredCell, setHoveredCell] = useState<MatrixCell | null>(null);

  const { cells, valuesA, valuesB, labelA, labelB, robustnessScore, isPlateau, isCliff, bestCell } = matrix;

  function getCellColor(cell: MatrixCell): string {
    if (activeMetric === "return") {
      if (cell.returnPct > 10) return "#0c9a6b"; // strong dark green
      if (cell.returnPct > 5) return "#22c55e"; // bright green
      if (cell.returnPct > 0) return "#86efac"; // light green
      if (cell.returnPct > -3) return "#fde047"; // neutral yellow
      if (cell.returnPct > -8) return "#fca5a5"; // soft red
      return "#ef4444"; // strong red
    }
    if (activeMetric === "winRate") {
      if (cell.winRatePct >= 65) return "#0c9a6b";
      if (cell.winRatePct >= 50) return "#22c55e";
      if (cell.winRatePct >= 40) return "#86efac";
      return "#fca5a5";
    }
    if (activeMetric === "drawdown") {
      if (cell.maxDrawdownPct <= 5) return "#0c9a6b";
      if (cell.maxDrawdownPct <= 10) return "#86efac";
      if (cell.maxDrawdownPct <= 15) return "#fde047";
      return "#ef4444";
    }
    // profit factor
    if (cell.profitFactor >= 2.0) return "#0c9a6b";
    if (cell.profitFactor >= 1.3) return "#22c55e";
    if (cell.profitFactor >= 1.0) return "#86efac";
    return "#fca5a5";
  }

  function getCellTextColor(cell: MatrixCell): string {
    if (activeMetric === "return") {
      if (cell.returnPct > 5 || cell.returnPct < -8) return "#ffffff";
      return "#172b24";
    }
    if (activeMetric === "winRate") {
      return cell.winRatePct >= 50 ? "#ffffff" : "#172b24";
    }
    return "#172b24";
  }

  function renderCellValue(cell: MatrixCell): string {
    if (activeMetric === "return") {
      return `${cell.returnPct >= 0 ? "+" : ""}${cell.returnPct.toFixed(1)}%`;
    }
    if (activeMetric === "winRate") {
      return `${cell.winRatePct.toFixed(0)}%`;
    }
    if (activeMetric === "drawdown") {
      return `-${cell.maxDrawdownPct.toFixed(1)}%`;
    }
    return `${cell.profitFactor.toFixed(2)}x`;
  }

  return (
    <section className="panel parameter-heatmap-panel" aria-label="Strategy sensitivity matrix">
      <div className="panel-heading">
        <div>
          <div className="heatmap-header-tag">
            <span className="tag-icon">⊞</span>
            <span>Parameter Robustness Heatmap · Overfitting Detection</span>
          </div>
          <h2>Parameter Sensitivity Surface</h2>
          <p>
            Simulating parameter sweeps across completed Bitget candles. Robust quantitative systems show a contiguous green plateau; fragile overfitted rules appear as isolated spikes surrounded by losses.
          </p>
        </div>

        <div className="heatmap-controls">
          <div className="metric-toggle-group">
            <button
              type="button"
              className={`metric-btn ${activeMetric === "return" ? "is-active" : ""}`}
              onClick={() => setActiveMetric("return")}
            >
              Net Return %
            </button>
            <button
              type="button"
              className={`metric-btn ${activeMetric === "winRate" ? "is-active" : ""}`}
              onClick={() => setActiveMetric("winRate")}
            >
              Win Rate %
            </button>
            <button
              type="button"
              className={`metric-btn ${activeMetric === "drawdown" ? "is-active" : ""}`}
              onClick={() => setActiveMetric("drawdown")}
            >
              Max Drawdown
            </button>
            <button
              type="button"
              className={`metric-btn ${activeMetric === "profitFactor" ? "is-active" : ""}`}
              onClick={() => setActiveMetric("profitFactor")}
            >
              Profit Factor
            </button>
          </div>
        </div>
      </div>

      <div className="heatmap-robustness-banner">
        <div className="robustness-stat-left">
          <span className="robustness-score-value">{robustnessScore}%</span>
          <div className="robustness-score-meta">
            <strong>Parameter Robustness Score</strong>
            <span>{robustnessScore}% of tested parameter pairs achieved positive historical net P&amp;L</span>
          </div>
        </div>

        <div className="robustness-badge-container">
          {isPlateau ? (
            <span className="robustness-status-pill status-plateau">
              ✓ ROBUST PARAMETER PLATEAU (Low Curve-Fitting Risk)
            </span>
          ) : isCliff ? (
            <span className="robustness-status-pill status-cliff">
              ⚠️ HIGH OVERFITTING RISK (Fragile Cliff)
            </span>
          ) : (
            <span className="robustness-status-pill status-neutral">
              ● MODERATE SENSITIVITY (Mixed Regimes)
            </span>
          )}
        </div>
      </div>

      <div className="heatmap-table-container">
        <div className="heatmap-axis-label-vertical">{labelA}</div>

        <div className="heatmap-matrix-wrapper">
          <div className="heatmap-axis-label-horizontal">{labelB}</div>

          <table className="heatmap-table">
            <thead>
              <tr>
                <th className="heatmap-corner-th">{labelA} \ {labelB}</th>
                {valuesB.map((b) => (
                  <th key={`col-${b}`} className="heatmap-col-th">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((row, rIdx) => {
                const a = valuesA[rIdx];
                return (
                  <tr key={`row-${a}`}>
                    <th className="heatmap-row-th">{a}</th>
                    {row.map((cell) => {
                      const bg = getCellColor(cell);
                      const textColor = getCellTextColor(cell);
                      const isHovered = hoveredCell === cell;
                      const isBest = cell.paramA === bestCell.paramA && cell.paramB === bestCell.paramB;

                      return (
                        <td
                          key={`cell-${cell.paramA}-${cell.paramB}`}
                          className={`heatmap-cell ${cell.isSelected ? "is-selected-cell" : ""} ${isBest ? "is-best-cell" : ""}`}
                          style={{ backgroundColor: bg, color: textColor }}
                          onMouseEnter={() => setHoveredCell(cell)}
                          onClick={() => {
                            if (onApplyParameters) {
                              onApplyParameters(cell.paramA, cell.paramB);
                            }
                          }}
                          title={`${labelA}: ${cell.paramA} | ${labelB}: ${cell.paramB} | Return: ${cell.returnPct}% | WinRate: ${cell.winRatePct}%`}
                        >
                          <div className="cell-content">
                            <span className="cell-primary-val">{renderCellValue(cell)}</span>
                            <span className="cell-sub-val">{cell.tradeCount} trades</span>
                          </div>
                          {isBest ? <span className="cell-best-indicator" title="Optimal Combination">★</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspection Footer */}
      <div className="heatmap-inspection-footer">
        {hoveredCell ? (
          <div className="inspection-card is-active">
            <div className="inspection-title">
              <strong>{labelA}: {hoveredCell.paramA}</strong> &amp; <strong>{labelB}: {hoveredCell.paramB}</strong>
              {hoveredCell.paramA === bestCell.paramA && hoveredCell.paramB === bestCell.paramB ? (
                <span className="best-tag">★ Optimal Historical Settings</span>
              ) : null}
            </div>
            <div className="inspection-stats-strip">
              <span>Return: <strong className={hoveredCell.returnPct >= 0 ? "tone-up" : "tone-down"}>{hoveredCell.returnPct >= 0 ? "+" : ""}{hoveredCell.returnPct}%</strong></span>
              <span>Win Rate: <strong>{hoveredCell.winRatePct}%</strong></span>
              <span>Trades: <strong>{hoveredCell.tradeCount}</strong></span>
              <span>Max Drawdown: <strong className="tone-down">-{hoveredCell.maxDrawdownPct}%</strong></span>
              <span>Profit Factor: <strong>{hoveredCell.profitFactor}x</strong></span>
            </div>
            {onApplyParameters ? (
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => onApplyParameters(hoveredCell.paramA, hoveredCell.paramB)}
              >
                Apply ({hoveredCell.paramA} / {hoveredCell.paramB}) to Strategy
              </button>
            ) : null}
          </div>
        ) : (
          <div className="inspection-card is-placeholder">
            <span>Hover over any matrix cell to inspect Sharpe, drawdown, and win-rate statistics. Click to select.</span>
          </div>
        )}
      </div>
    </section>
  );
}
