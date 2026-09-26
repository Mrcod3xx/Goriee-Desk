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
    if (!currentCandle?.time) return "—";
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
          <span className="btn-icon">✂</span>
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
            {isPlaying ? "⏸" : "▶"}
          </button>

          <button
            type="button"
            className="replay-step-btn"
            onClick={onStepForward}
            title="Advance 1 candle (Right Arrow or F)"
            aria-label="Step 1 bar forward"
            disabled={currentIndex >= totalCandles - 1}
          >
            ▶|
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
              ✕ Close
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
  );
}
