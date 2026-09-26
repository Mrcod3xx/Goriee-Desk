"use client";

import { CopilotAction } from "@/types/copilot";

interface CopilotActionCardProps {
  action: CopilotAction;
  onExecute: (action: CopilotAction) => void;
  disabled?: boolean;
}

export function CopilotActionCard({ action, onExecute, disabled }: CopilotActionCardProps) {
  if (action.type === "order") {
    const isBuy = action.side.toLowerCase() === "buy";
    const rrr =
      action.price && action.takeProfitPrice && action.stopLossPrice
        ? Math.abs(action.takeProfitPrice - action.price) /
          Math.max(0.0001, Math.abs(action.price - action.stopLossPrice))
        : null;

    return (
      <div className={`copilot-action-card copilot-order-card ${isBuy ? "is-buy" : "is-sell"}`}>
        <div className="copilot-card-badge">
          <span className="copilot-card-tag">{isBuy ? "PROPOSED LONG" : "PROPOSED SHORT"}</span>
          <span className="copilot-card-sym">{action.symbol}</span>
        </div>

        <div className="copilot-card-metrics">
          {action.price ? (
            <div className="copilot-card-metric">
              <span className="metric-label">Entry</span>
              <strong className="metric-val">${action.price.toLocaleString()}</strong>
            </div>
          ) : null}
          {action.takeProfitPrice ? (
            <div className="copilot-card-metric">
              <span className="metric-label">Take Profit</span>
              <strong className="metric-val is-profit">${action.takeProfitPrice.toLocaleString()}</strong>
            </div>
          ) : null}
          {action.stopLossPrice ? (
            <div className="copilot-card-metric">
              <span className="metric-label">Stop Loss</span>
              <strong className="metric-val is-loss">${action.stopLossPrice.toLocaleString()}</strong>
            </div>
          ) : null}
          {rrr !== null ? (
            <div className="copilot-card-metric">
              <span className="metric-label">R:R Ratio</span>
              <strong className="metric-val">{rrr.toFixed(2)} : 1</strong>
            </div>
          ) : null}
          {action.kellySizePercent ? (
            <div className="copilot-card-metric">
              <span className="metric-label">Kelly Sizing</span>
              <strong className="metric-val">{action.kellySizePercent}% Equity</strong>
            </div>
          ) : null}
        </div>

        {action.reason ? <p className="copilot-card-reason">{action.reason}</p> : null}

        <button
          type="button"
          className="copilot-execute-btn button button-primary"
          disabled={disabled}
          onClick={() => onExecute(action)}
        >
          Load into Order Ticket →
        </button>
      </div>
    );
  }

  if (action.type === "backtest") {
    return (
      <div className="copilot-action-card copilot-backtest-card">
        <div className="copilot-card-badge">
          <span className="copilot-card-tag tag-backtest">BACKTEST HYPOTHESIS</span>
          <span className="copilot-card-sym">{action.symbol} ({action.interval})</span>
          <span className="copilot-card-extra">{action.days}D Window</span>
        </div>

        <div className="copilot-card-snippet">
          <span className="snippet-label">Compiled Rule:</span>
          <p className="snippet-text">"{action.strategyPrompt}"</p>
        </div>

        {action.reason ? <p className="copilot-card-reason">{action.reason}</p> : null}

        <button
          type="button"
          className="copilot-execute-btn button button-primary"
          disabled={disabled}
          onClick={() => onExecute(action)}
        >
          Run Backtest in Tab →
        </button>
      </div>
    );
  }

  if (action.type === "playbook") {
    return (
      <div className="copilot-action-card copilot-playbook-card">
        <div className="copilot-card-badge">
          <span className="copilot-card-tag tag-playbook">PLAYBOOK ALERT</span>
          <span className="copilot-card-sym">{action.symbol}</span>
        </div>

        <h4 className="copilot-card-title">{action.name}</h4>

        <div className="copilot-card-snippet">
          <span className="snippet-label">Trigger Condition:</span>
          <p className="snippet-text">{action.conditions}</p>
        </div>

        {action.reason ? <p className="copilot-card-reason">{action.reason}</p> : null}

        <button
          type="button"
          className="copilot-execute-btn button button-primary"
          disabled={disabled}
          onClick={() => onExecute(action)}
        >
          Save to Playbooks →
        </button>
      </div>
    );
  }

  if (action.type === "market") {
    return (
      <div className="copilot-action-card copilot-market-card">
        <div className="copilot-card-badge">
          <span className="copilot-card-tag tag-market">MARKET INSPECTION</span>
          <span className="copilot-card-sym">{action.symbol}</span>
        </div>

        {action.reason ? <p className="copilot-card-reason">{action.reason}</p> : null}

        <button
          type="button"
          className="copilot-execute-btn button button-secondary"
          disabled={disabled}
          onClick={() => onExecute(action)}
        >
          Switch Chart to {action.symbol} →
        </button>
      </div>
    );
  }

  return null;
}
