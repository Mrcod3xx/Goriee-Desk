import type { Candle } from "./bitget.ts";

/**
 * Pure, deterministic helpers for the Trade Replay Studio "review a historical
 * trade" experience.
 *
 * Everything in this module is side-effect free and derived only from data the
 * engines already recorded. It never invents a bracket level or an exit reason:
 * when the source data does not carry one, the result is `null` / `"unknown"`
 * so the UI can honestly say "not recorded" instead of guessing.
 */

/** Why a reviewed trade finally left the market. */
export type ReplayReviewOutcome =
  | "take_profit"
  | "stop_loss"
  | "trailing_stop"
  | "signal_exit"
  | "end_of_data"
  | "manual"
  | "unknown";

/** Where the replay playhead currently sits relative to the reviewed trade. */
export type ReplayReviewPhase = "pre-entry" | "in-trade" | "closed";

export const REPLAY_REVIEW_OUTCOME_LABELS: Record<ReplayReviewOutcome, string> = {
  take_profit: "Take Profit hit",
  stop_loss: "Stop Loss hit",
  trailing_stop: "Trailing stop hit",
  signal_exit: "Exit signal fired",
  end_of_data: "Closed at end of data",
  manual: "Closed manually",
  unknown: "Exit reason not recorded",
};

export const REPLAY_REVIEW_PHASE_LABELS: Record<ReplayReviewPhase, string> = {
  "pre-entry": "Awaiting entry",
  "in-trade": "Position open",
  closed: "Trade closed",
};

/** Exit reasons the paper engine can attribute to a closing fill. */
export type PaperExitReason = "take_profit" | "stop_loss" | "trailing_stop" | "manual" | "signal_exit";

/** Bracket levels captured at the moment a paper position was closed. */
export type PaperBracketSnapshot = {
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingStopPct?: number;
};

export type ReplayTargetTradeInput = {
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  exitPrice: number;
  side: "buy" | "sell";
  netPnl: number;
  returnPct: number;
  quantity?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  outcome?: ReplayReviewOutcome | null;
  exitNote?: string | null;
  /** Fallback bar count when the candle tape cannot resolve both bars. */
  barsHeld?: number | null;
};

export type ReplayTradeReview = {
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  quantity: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  hasBrackets: boolean;
  outcome: ReplayReviewOutcome;
  outcomeLabel: string;
  /** Candle index of the entry bar within the supplied tape, or null. */
  entryIndex: number | null;
  /** Candle index of the exit bar within the supplied tape, or null. */
  exitIndex: number | null;
  /** Bar-aligned entry timestamp (snapped to the tape when it resolves). */
  entryTime: number | null;
  /** Bar-aligned exit timestamp (snapped to the tape when it resolves). */
  exitTime: number | null;
  barsHeld: number | null;
  netPnl: number;
  returnPct: number;
  /** Per-unit distance from entry to the stop loss (direction aware). */
  riskPerUnit: number | null;
  /** Per-unit distance from entry to the take profit (direction aware). */
  rewardPerUnit: number | null;
  /** Realised result expressed in units of initial risk, or null when undefined. */
  rMultiple: number | null;
  /** Planned reward:risk ratio, or null when the stop distance is not usable. */
  riskRewardRatio: number | null;
};

function finitePositive(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function finiteNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Legacy paper fills only stored a human readable `exitNote`. The paper bracket
 * engine builds those notes with stable prefixes, so classify by exact prefix
 * rather than fuzzy keyword matching (a user typed note must not be guessed).
 */
export function classifyPaperExitNote(note: string | null | undefined): ReplayReviewOutcome | null {
  if (typeof note !== "string") return null;
  const value = note.trim();
  if (!value) return null;
  if (value.startsWith("Take-Profit hit at ")) return "take_profit";
  if (value.startsWith("Stop-Loss triggered at ")) return "stop_loss";
  if (value.startsWith("Trailing stop hit at ")) return "trailing_stop";
  if (value.startsWith("Rule Engine Exit: ")) return "signal_exit";
  return null;
}

export function resolveReplayReviewOutcome(
  outcome: ReplayReviewOutcome | null | undefined,
  exitNote: string | null | undefined
): ReplayReviewOutcome {
  if (outcome) return outcome;
  return classifyPaperExitNote(exitNote) ?? "unknown";
}

/**
 * Nearest-bar match by timestamp. Paper fills are stamped with `Date.now()`,
 * which never aligns exactly to a candle open time, so an exact `findIndex`
 * would silently miss the bar. Ties resolve to the earlier bar.
 */
export function findNearestBarIndex(
  candles: readonly Candle[] | null | undefined,
  time: number | null | undefined
): number | null {
  if (!candles || candles.length === 0) return null;
  const target = finiteNumber(time);
  if (target === null) return null;
  let bestIndex = 0;
  let bestDiff = Infinity;
  for (let index = 0; index < candles.length; index += 1) {
    const barTime = candles[index]?.time;
    if (typeof barTime !== "number" || !Number.isFinite(barTime)) continue;
    const diff = Math.abs(barTime - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Convert a bar index into a 0-100 position along the transport scrubber. */
export function barIndexToTimelinePct(index: number | null, totalBars: number): number | null {
  if (index === null || !Number.isFinite(index)) return null;
  if (!(totalBars > 1)) return null;
  const clamped = Math.max(0, Math.min(totalBars - 1, index));
  return (clamped / (totalBars - 1)) * 100;
}

/**
 * Resolve everything the Replay Studio needs to narrate one historical trade:
 * its bracket levels, its true exit reason, and where entry/exit sit on the tape.
 */
export function resolveTargetTradeReview(
  target: ReplayTargetTradeInput,
  candles?: readonly Candle[] | null
): ReplayTradeReview {
  const tape = Array.isArray(candles) ? candles : null;
  const entryIndex = tape ? findNearestBarIndex(tape, target.openedAt) : null;
  const exitIndex = tape ? findNearestBarIndex(tape, target.closedAt) : null;

  const entryTime = entryIndex !== null && tape
    ? finiteNumber(tape[entryIndex]?.time)
    : finiteNumber(target.openedAt);
  const exitTime = exitIndex !== null && tape
    ? finiteNumber(tape[exitIndex]?.time)
    : finiteNumber(target.closedAt);

  const entryPrice = finiteNumber(target.entryPrice) ?? 0;
  const exitPrice = finiteNumber(target.exitPrice) ?? 0;
  const takeProfitPrice = finitePositive(target.takeProfitPrice);
  const stopLossPrice = finitePositive(target.stopLossPrice);
  const quantity = finitePositive(target.quantity);
  const isLong = target.side !== "sell";
  const direction = isLong ? 1 : -1;

  const riskPerUnit = stopLossPrice !== null && entryPrice > 0
    ? (entryPrice - stopLossPrice) * direction
    : null;
  const rewardPerUnit = takeProfitPrice !== null && entryPrice > 0
    ? (takeProfitPrice - entryPrice) * direction
    : null;

  const usableRisk = riskPerUnit !== null && riskPerUnit > 0 ? riskPerUnit : null;
  const priceMove = entryPrice > 0 && exitPrice > 0 ? (exitPrice - entryPrice) * direction : null;

  let barsHeld: number | null = null;
  if (entryIndex !== null && exitIndex !== null) {
    barsHeld = Math.max(0, exitIndex - entryIndex);
  } else {
    const fallback = finiteNumber(target.barsHeld);
    barsHeld = fallback !== null && fallback >= 0 ? Math.round(fallback) : null;
  }

  const outcome = resolveReplayReviewOutcome(target.outcome, target.exitNote);

  return {
    side: isLong ? "buy" : "sell",
    entryPrice,
    exitPrice,
    quantity,
    takeProfitPrice,
    stopLossPrice,
    hasBrackets: takeProfitPrice !== null || stopLossPrice !== null,
    outcome,
    outcomeLabel: REPLAY_REVIEW_OUTCOME_LABELS[outcome],
    entryIndex,
    exitIndex,
    entryTime,
    exitTime,
    barsHeld,
    netPnl: finiteNumber(target.netPnl) ?? 0,
    returnPct: finiteNumber(target.returnPct) ?? 0,
    riskPerUnit,
    rewardPerUnit,
    rMultiple: usableRisk !== null && priceMove !== null ? priceMove / usableRisk : null,
    riskRewardRatio: usableRisk !== null && rewardPerUnit !== null ? rewardPerUnit / usableRisk : null,
  };
}

/**
 * Compare the playhead against the trade's own timestamps so the chart only
 * reveals a level once the tape has actually reached it (no hindsight spoilers).
 */
export function resolveReplayReviewPhase(
  review: Pick<ReplayTradeReview, "entryTime" | "exitTime">,
  revealedTime: number | null | undefined
): ReplayReviewPhase {
  const mark = finiteNumber(revealedTime);
  if (mark === null) return "pre-entry";
  if (review.entryTime === null) return "pre-entry";
  if (mark < review.entryTime) return "pre-entry";
  if (review.exitTime === null || mark < review.exitTime) return "in-trade";
  return "closed";
}

/** Floating P&L of the reviewed trade at the current playhead mark price. */
export function calculateReviewUnrealizedPnl(
  review: Pick<ReplayTradeReview, "side" | "entryPrice" | "quantity">,
  markPrice: number | null | undefined
): number | null {
  if (review.quantity === null) return null;
  const mark = finitePositive(markPrice);
  if (mark === null || !(review.entryPrice > 0)) return null;
  const direction = review.side === "sell" ? -1 : 1;
  return (mark - review.entryPrice) * direction * review.quantity;
}

/** Floating return percentage of the reviewed trade at the current mark price. */
export function calculateReviewUnrealizedPct(
  review: Pick<ReplayTradeReview, "side" | "entryPrice">,
  markPrice: number | null | undefined
): number | null {
  const mark = finitePositive(markPrice);
  if (mark === null || !(review.entryPrice > 0)) return null;
  const direction = review.side === "sell" ? -1 : 1;
  return ((mark - review.entryPrice) * direction / review.entryPrice) * 100;
}
