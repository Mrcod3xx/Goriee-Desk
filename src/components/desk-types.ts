import type { Candle, MarketData } from "@/lib/bitget";
import type { BacktestResult as SimulationResult } from "@/lib/backtest";
import type { PaperBracketSnapshot, PaperExitReason, ReplayReviewOutcome } from "@/lib/replay-review";

export type View = "desk" | "scanner" | "research" | "backtests" | "replay" | "playbooks" | "paper" | "journal" | "settings";
export type ScannerSort = "active" | "gainers" | "decliners";
export type ScannerAssetType = "all" | "crypto" | "rwa";
export type Report = {
  id: string;
  question: string;
  symbol: string;
  interval: string;
  market: MarketData;
  indicators: {
    ema20: number | null;
    ema50: number | null;
    rsi14: number;
    support: number;
    resistance: number;
    rangePct: number;
    regime: string;
  };
  summary: string;
  bullCase: string;
  bearCase: string;
  invalidation: string;
  newsContext?: string;
  sources?: ResearchSource[];
  webResearchIncluded?: boolean;
  engine: string;
  commentary: string | null;
  createdAt: number;
};
export type ResearchSource = { url: string; title: string; content: string };
export type JournalItem = {
  id: string;
  question: string;
  symbol: string;
  interval: string;
  summary: string;
  regime: string;
  price: number;
  createdAt: number;
  marketSnapshot?: {
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    turnover24h: number;
    asOf: number;
  };
  indicators?: Report["indicators"];
  bullCase?: string;
  bearCase?: string;
  invalidation?: string;
  engine?: string;
  commentary?: string | null;
  newsContext?: string;
  sources?: ResearchSource[];
  webResearchIncluded?: boolean;
};
export type PaperResearchRef = { id: string; question: string };
export type PaperBacktestRef = { symbol: string; interval: string; summary: string; returnPct: number; capturedAt: number };
export type PaperTrade = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  createdAt: number;
  feeBps?: number;
  researchRef?: PaperResearchRef;
  backtestRef?: PaperBacktestRef;
  playbookName?: string;
  exitNote?: string;
  /** Structured exit attribution captured at close time (new fills only). */
  exitReason?: PaperExitReason;
  /** Bracket levels exactly as they stood when the position was closed. */
  bracketSnapshot?: PaperBracketSnapshot;
};
export type ClosedPaperTrade = {
  id: string;
  exitTradeId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: number;
  closedAt: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  netPnl: number;
  returnPct: number;
  estimatedFees: boolean;
  researchRefs: PaperResearchRef[];
  backtestRefs: PaperBacktestRef[];
  playbookNames: string[];
  exitNote: string;
  /** Resolved exit attribution; falls back to "unknown" for legacy records. */
  outcome: ReplayReviewOutcome;
  /** Take-profit level recorded at close, or null when none was ever set. */
  takeProfitPrice: number | null;
  /** Stop-loss level recorded at close, or null when none was ever set. */
  stopLossPrice: number | null;
};
export type PaperLedgerPosition = {
  quantity: number;
  costBasis: number;
  entryFeeBasis: number;
  entryTimeWeight: number;
  hasAssumedEntryFees: boolean;
  researchRefs: Map<string, PaperResearchRef>;
  backtestRefs: Map<string, PaperBacktestRef>;
  playbookNames: Set<string>;
};
export type Quote = { symbol: string; price: number; change24h: number; asOf?: number };
export type OpenPaperPosition = { symbol: string; quantity: number; averageEntry: number; entryFees: number };
export type PaperAlert = {
  id: string;
  symbol: string;
  purpose: "price" | "stop" | "target";
  direction: "above" | "below";
  price: number;
  createdAt: number;
  triggeredAt: number | null;
};
export type PaperBracket = {
  symbol: string;
  takeProfitPrice?: number;
  takeProfitPct?: number;
  stopLossPrice?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  peakPrice?: number;
  createdAt: number;
};
export type StrategyPlaybook = {
  id: string;
  name: string;
  symbol: string;
  interval: string;
  prompt: string;
  lookbackDays: number;
  feeBps: number;
  slippageBps: number;
  createdAt: number;
  researchRef?: PaperResearchRef;
  backtestRef?: PaperBacktestRef;
};
export type Instrument = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  symbolType: string;
  isRwa: string;
};
export type BacktestResult = SimulationResult & {
  researchRef?: PaperResearchRef;
  model: string;
  dataSource: string;
  spreadSource: "fallback" | "current-order-book";
  lookbackDays: number;
  coverage?: { requestedStart: number; requestedEnd: number; firstCandle: number; lastCandle: number; receivedBars: number; expectedBars: number; missingInsideRange: number };
};

export type ReplayBracketConfig = {
  side: "buy" | "sell";
  entryPrice: number;
  tpPrice: number | null;
  slPrice: number | null;
  sizeUsd: number;
  isActivePosition: boolean;
  onUpdateTpPrice?: (price: number) => void;
  onUpdateSlPrice?: (price: number) => void;
  onSnapBreakeven?: () => void;
  onSnapRiskReward?: (rrRatio: number) => void;
};

export type ReplayTradeMarker = {
  id: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
  pnlPct: number;
  exitReason?: string;
};

export type ReplayTargetTrade = {
  id: string;
  symbol: string;
  interval?: string;
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  exitPrice: number;
  quantity?: number;
  netPnl: number;
  returnPct: number;
  side: "buy" | "sell";
  origin: "paper" | "backtests";
  strategyLabel?: string;
  candles?: Candle[];
  /** Bracket levels carried over from the source engine, when it recorded any. */
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  /** True exit attribution carried over from the source engine, when known. */
  outcome?: ReplayReviewOutcome | null;
  exitNote?: string | null;
};
