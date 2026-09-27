"use client";

import type { ReplayScorecard, ReplayTrade } from "@/types/replay";

interface ReplayScorecardModalProps {
  isOpen: boolean;
  scorecard: ReplayScorecard;
  closedTrades: ReplayTrade[];
  symbol: string;
  interval: string;
  onRestartReplay: () => void;
  onClose: () => void;
}

export function ReplayScorecardModal({
  isOpen,
  scorecard,
  closedTrades,
  symbol,
  interval,
  onRestartReplay,
  onClose,
}: ReplayScorecardModalProps) {
  if (!isOpen) return null;

  return (
    <div className="replay-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="replay-scorecard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="replay-modal-header">
          <div className="modal-title-group">
            <div>
              <h3>Replay Session Scorecard</h3>
              <p className="modal-subtitle">
                Historical Simulation Performance · {symbol} ({interval})
              </p>
            </div>
          </div>
          <button
            type="button"
            className="replay-modal-close-btn"
            onClick={onClose}
            aria-label="Close scorecard"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {/* 5 KPI Scorecard Metrics */}
        <div className="replay-scorecard-grid">
          <div className="scorecard-metric-card">
            <span className="metric-label">Net P&amp;L</span>
            <strong className={`metric-value ${scorecard.netPnl >= 0 ? "is-up" : "is-down"}`}>
              {scorecard.netPnl >= 0 ? "+" : ""}${scorecard.netPnl.toFixed(2)}
            </strong>
            <span className="metric-sub">
              {scorecard.returnPct >= 0 ? "+" : ""}{scorecard.returnPct.toFixed(2)}% on capital
            </span>
          </div>

          <div className="scorecard-metric-card">
            <span className="metric-label">Win Rate</span>
            <strong className="metric-value">
              {scorecard.winRate.toFixed(1)}%
            </strong>
            <span className="metric-sub">
              {scorecard.winningTrades}W / {scorecard.losingTrades}L of {scorecard.totalTrades}
            </span>
          </div>

          <div className="scorecard-metric-card">
            <span className="metric-label">Profit Factor</span>
            <strong className="metric-value">
              {scorecard.profitFactor >= 99 ? "∞" : scorecard.profitFactor.toFixed(2)}
            </strong>
            <span className="metric-sub">Gross win / loss ratio</span>
          </div>

          <div className="scorecard-metric-card">
            <span className="metric-label">Best Trade</span>
            <strong className="metric-value is-up">
              {scorecard.bestTradePnl > 0 ? `+$${scorecard.bestTradePnl.toFixed(2)}` : "$0.00"}
            </strong>
            <span className="metric-sub">Peak winning fill</span>
          </div>

          <div className="scorecard-metric-card">
            <span className="metric-label">Ending Equity</span>
            <strong className="metric-value">
              ${Math.round(scorecard.endingEquity).toLocaleString()}
            </strong>
            <span className="metric-sub">From $10,000 start</span>
          </div>
        </div>

        {/* Closed Trades History */}
        <div className="replay-trades-section">
          <h4>Session Trade Log ({closedTrades.length})</h4>
          {closedTrades.length > 0 ? (
            <div className="replay-table-wrap">
              <table className="replay-trades-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Entry Price</th>
                    <th>Exit Price</th>
                    <th>Quantity</th>
                    <th>Realized P&amp;L</th>
                    <th>Exit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className={`trade-side-pill ${t.side === "buy" ? "is-long" : "is-short"}`}>
                          {t.side === "buy" ? "LONG" : "SHORT"}
                        </span>
                      </td>
                      <td>${t.entryPrice.toLocaleString()}</td>
                      <td>${t.exitPrice.toLocaleString()}</td>
                      <td>{t.quantity.toFixed(4)}</td>
                      <td className={`pnl-cell ${t.pnl >= 0 ? "is-up" : "is-down"}`}>
                        <strong>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</strong>
                        <small>({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%)</small>
                      </td>
                      <td>
                        <span className="exit-reason-badge">
                          {t.exitReason === "take_profit" ? "Take Profit" : t.exitReason === "stop_loss" ? "Stop Loss" : "Manual Close"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="no-trades-copy">
              No orders were placed during this replay session. Use <code>+ Buy</code> or <code>- Sell</code> while replaying historical candles to practice discretionary execution.
            </p>
          )}
        </div>

        <div className="replay-modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onRestartReplay}
          >
            Practice Again
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onClose}
          >
            Return to Live Market
          </button>
        </div>
      </div>
    </div>
  );
}
