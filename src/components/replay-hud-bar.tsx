"use client";

import { useMemo } from "react";
import type { Candle } from "@/lib/bitget";
import type { ReplayWallet } from "@/types/replay";
import { calculateReplayEquity } from "@/lib/replay-engine";

interface ReplayHudBarProps {
  isCutMode: boolean;
  onToggleCutMode: () => void;
  onRewindBars: (barsBack: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  currentIndex: number;
  totalCandles: number;
  currentCandle: Candle | null;
  onScrubIndex: (index: number) => void;
  wallet: ReplayWallet;
  symbol: string;
  onQuickBuy: (amountUsd: number) => void;
  onQuickSell: (amountUsd: number) => void;
  onClosePosition: () => void;
  onExitReplay: () => void;
  targetTrade?: {
    id: string;
    symbol: string;
    openedAt: number;
    closedAt: number;
    entryPrice: number;
    exitPrice: number;
    netPnl: number;
    returnPct: number;
    side: "buy" | "sell";
    origin: "paper" | "backtests";
    strategyLabel?: string;
  } | null;
  onJumpToSetup?: () => void;
  onJumpToEntry?: () => void;
  onJumpToExit?: () => void;
  onExitReview?: () => void;
}

export function ReplayHudBar({
  isCutMode,
  onToggleCutMode,
  onRewindBars,
  isPlaying,
  onTogglePlay,
  onStepForward,
  speed,
  onSpeedChange,
  currentIndex,
  totalCandles,
  currentCandle,
  onScrubIndex,
  wallet,
  symbol,
  onQuickBuy,
  onQuickSell,
  onClosePosition,
  onExitReplay,
  targetTrade,
  onJumpToSetup,
  onJumpToEntry,
  onJumpToExit,
  onExitReview,
}: ReplayHudBarProps) {
  const currentPrice = currentCandle?.close || 0;
  const equity = useMemo(
    () => calculateReplayEquity(wallet, currentPrice),
    [wallet, currentPrice]
  );
  const netPnl = equity - wallet.startingCash;
  const returnPct = wallet.startingCash > 0 ? (netPnl / wallet.startingCash) * 100 : 0;

  const position = wallet.position;
  const unrealizedPnl = position && currentPrice > 0
    ? position.side === "buy"
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity
    : 0;

  const formattedDate = useMemo(() => {
    if (!currentCandle?.time) return "n/a";
    const date = new Date(currentCandle.time);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC";
  }, [currentCandle?.time]);

  return (
    <div className="replay-hud-container">
      {targetTrade && (
        <div className="replay-review-hud" role="region" aria-label="Trade Review Context">
          <div className="replay-review-hud-left">
            <span className="replay-review-tag">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="11 19 2 12 11 5 11 19" />
                <polygon points="22 19 13 12 22 5 22 19" />
              </svg>
              <span>{targetTrade.origin === "paper" ? "Paper Review" : "Backtest Review"}</span>
            </span>
            <strong className="replay-review-symbol">{targetTrade.symbol}</strong>
            <span className={`replay-review-side ${targetTrade.side === "buy" ? "is-long" : "is-short"}`}>
              {targetTrade.side === "buy" ? "LONG" : "SHORT"}
            </span>
            <span className="replay-review-metric">
              Entry: <strong>${targetTrade.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
            </span>
            <span className="replay-review-metric">
              Exit: <strong>${targetTrade.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
            </span>
            <span className={`replay-review-pnl ${targetTrade.netPnl >= 0 ? "tone-up" : "tone-down"}`}>
              {targetTrade.netPnl >= 0 ? "+" : ""}${targetTrade.netPnl.toFixed(2)} ({targetTrade.returnPct >= 0 ? "+" : ""}{targetTrade.returnPct.toFixed(2)}%)
            </span>
            {targetTrade.strategyLabel && (
              <span className="replay-review-strategy" title={targetTrade.strategyLabel}>
                {targetTrade.strategyLabel}
              </span>
            )}
          </div>
          <div className="replay-review-hud-actions">
            {onJumpToSetup && (
              <button
                type="button"
                className="replay-hud-action-btn"
                onClick={onJumpToSetup}
                title="Rewind to 25 candles before entry to inspect setup formation"
              >
                <span>Setup (-25b)</span>
              </button>
            )}
            {onJumpToEntry && (
              <button
                type="button"
                className="replay-hud-action-btn"
                onClick={onJumpToEntry}
                title="Jump directly to entry candle"
              >
                <span>Entry Bar</span>
              </button>
            )}
            {onJumpToExit && (
              <button
                type="button"
                className="replay-hud-action-btn"
                onClick={onJumpToExit}
                title="Jump directly to exit candle"
              >
                <span>Exit Bar</span>
              </button>
            )}
            {onExitReview && (
              <button
                type="button"
                className="replay-hud-exit-btn"
                onClick={onExitReview}
                title={`Return to ${targetTrade.origin === "paper" ? "Paper Review" : "Backtests"}`}
              >
                <span>Return to {targetTrade.origin === "paper" ? "Paper Review" : "Backtests"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="replay-hud-bar" role="region" aria-label="Trade Replay Controls">
        {/* Left Group: Replay Mode Badge, Cut Tool, and Quick Rewind */}
        <div className="replay-left-group">
          <div className="replay-mode-badge">
            <span className="replay-pulse-dot" />
            <span className="replay-badge-title">Replay Mode</span>
          </div>

          <button
            type="button"
            className={`replay-btn replay-cut-btn ${isCutMode ? "is-active" : ""}`}
            onClick={onToggleCutMode}
            title={isCutMode ? "Cut mode active: click a candle on the chart to rewind" : "Click to select a cut point on the chart"}
            aria-pressed={isCutMode}
          >
            <span>{isCutMode ? "Selecting Bar…" : "Cut Bar"}</span>
          </button>

          <div className="replay-rewind-chips">
            <button
              type="button"
              className="replay-chip"
              onClick={() => onRewindBars(24)}
              title="Rewind 24 bars back"
            >
              -24b
            </button>
            <button
              type="button"
              className="replay-chip"
              onClick={() => onRewindBars(50)}
              title="Rewind 50 bars back"
            >
              -50b
            </button>
          </div>
        </div>

        {/* Center Group: Playback Transport, Speed, and Timeline Scrubber */}
        <div className="replay-center-group">
          <div className="replay-transport-controls">
            <button
              type="button"
              className={`replay-play-btn ${isPlaying ? "is-playing" : ""}`}
              onClick={onTogglePlay}
              title={isPlaying ? "Pause playback (Space)" : "Play candle tape (Space)"}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>

            <button
              type="button"
              className="replay-step-btn"
              onClick={onStepForward}
              title="Advance 1 candle (Right Arrow or F)"
              aria-label="Step 1 bar forward"
              disabled={currentIndex >= totalCandles - 1}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>

            <div className="replay-speed-selector" role="group" aria-label="Playback speed">
              {[0.5, 1, 2, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`speed-chip ${speed === s ? "is-active" : ""}`}
                  onClick={() => onSpeedChange(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
        </div>

        <div className="replay-timeline-wrap">
          <div className="replay-timeline-meta">
            <span className="replay-timestamp">{formattedDate}</span>
            <span className="replay-bar-count">
              Bar {currentIndex + 1} / {totalCandles}
            </span>
          </div>
          <input
            type="range"
            className="replay-scrubber"
            min={0}
            max={Math.max(0, totalCandles - 1)}
            value={currentIndex}
            onChange={(e) => onScrubIndex(Number(e.target.value))}
            aria-label="Replay timeline scrubber"
          />
        </div>
      </div>

      {/* Right Group: Replay Wallet, Fast Execution, and Exit */}
      <div className="replay-right-group">
        <div className="replay-wallet-status">
          <div className="replay-equity-row">
            <span className="label">Replay Equity:</span>
            <strong className={`equity-val ${netPnl >= 0 ? "is-up" : "is-down"}`}>
              ${Math.round(equity).toLocaleString()} ({returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%)
            </strong>
          </div>
          {position ? (
            <div className="replay-position-indicator">
              <span className={`pos-tag ${position.side === "buy" ? "is-long" : "is-short"}`}>
                {position.side === "buy" ? "LONG" : "SHORT"}
              </span>
              <span className="pos-detail">
                {position.quantity.toFixed(4)} {symbol.replace("USDT", "")} @ ${position.entryPrice.toLocaleString()}
              </span>
              <span className={`pos-pnl ${unrealizedPnl >= 0 ? "is-up" : "is-down"}`}>
                ({unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)})
              </span>
            </div>
          ) : (
            <span className="no-pos-text">Flat · $0 in play</span>
          )}
        </div>

        <div className="replay-execution-actions">
          <button
            type="button"
            className="replay-buy-btn"
            onClick={() => onQuickBuy(250)}
            title="Buy $250 market at current replay bar price"
          >
            + Buy $250
          </button>
          <button
            type="button"
            className="replay-sell-btn"
            onClick={() => onQuickSell(250)}
            title="Sell / Short $250 market at current replay bar price"
          >
            - Sell $250
          </button>
          {position ? (
            <button
              type="button"
              className="replay-close-btn"
              onClick={onClosePosition}
              title="Close current replay position at market"
            >
              Close Position
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="replay-exit-btn"
          onClick={onExitReplay}
          title="Exit replay and review session scorecard"
        >
          Exit Replay
        </button>
      </div>
    </div>
  </div>
  );
}
