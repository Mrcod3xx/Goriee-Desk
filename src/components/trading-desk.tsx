"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ema, bollingerBands, macd, atr, getIndicatorSnapshot, evaluatePlaybookRule, type Candle, type MarketData, type SpotScanMarket } from "@/lib/bitget";
import type { BacktestResult as SimulationResult, CompletedTrade } from "@/lib/backtest";
import { ProviderSettings } from "@/components/provider-settings";
import { generateBacktestPromptFromResearch, getStrategyTypeFromResearch } from "@/lib/research-strategy";
import { OrderBookPanel } from "@/components/orderbook-panel";
import { MonteCarloPanel } from "@/components/monte-carlo-panel";
import { MultiChartGrid } from "@/components/multi-chart-grid";
import { paperCash, paperFillFee } from "@/lib/paper-accounting";
import { RequestRecovery } from "@/components/request-recovery";
import { WorkspaceBackup } from "@/components/workspace-backup";
import { MultiHorizonConfluencePanel } from "@/components/multi-horizon-confluence";
import { useBitgetTickerWs, type WsTickerTick } from "@/lib/bitget-ws";
import { StrategyCardModal, type CardExportData } from "@/components/strategy-card-modal";
import { CommandPalette } from "@/components/command-palette";
import { ParameterHeatmap } from "@/components/parameter-heatmap";
import { calculateParameterMatrix } from "@/lib/parameter-matrix";
import { calculateOrderFlow } from "@/lib/order-flow";
import { calculateKellySizing, detectVolatilitySqueeze } from "@/lib/kelly-sizer";
import { PortfolioAnalytics } from "@/components/portfolio-analytics";
import { StrategyCopilot } from "@/components/strategy-copilot";
import type { MarketContextSnapshot, PaperContextSnapshot } from "@/types/copilot";
import { ReplayHudBar } from "@/components/replay-hud-bar";
import { ReplayScorecardModal } from "@/components/replay-scorecard-modal";
import {
  createInitialReplayWallet,
  executeReplayOrder,
  closeReplayPosition,
  advanceReplayCandle,
  calculateReplayEquity,
  calculateReplayScorecard,
} from "@/lib/replay-engine";
import type { ReplayWallet } from "@/types/replay";

type View = "desk" | "scanner" | "research" | "backtests" | "replay" | "playbooks" | "paper" | "journal" | "settings";
type ScannerSort = "active" | "gainers" | "decliners";
type ScannerAssetType = "all" | "crypto" | "rwa";
type Report = {
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
type ResearchSource = { url: string; title: string; content: string };
type JournalItem = {
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
type PaperResearchRef = { id: string; question: string };
type PaperBacktestRef = { symbol: string; interval: string; summary: string; returnPct: number; capturedAt: number };
type PaperTrade = {
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
};
type ClosedPaperTrade = {
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
};
type PaperLedgerPosition = {
  quantity: number;
  costBasis: number;
  entryFeeBasis: number;
  entryTimeWeight: number;
  hasAssumedEntryFees: boolean;
  researchRefs: Map<string, PaperResearchRef>;
  backtestRefs: Map<string, PaperBacktestRef>;
  playbookNames: Set<string>;
};
type Quote = { symbol: string; price: number; change24h: number; asOf?: number };
type OpenPaperPosition = { symbol: string; quantity: number; averageEntry: number; entryFees: number };
type PaperAlert = {
  id: string;
  symbol: string;
  purpose: "price" | "stop" | "target";
  direction: "above" | "below";
  price: number;
  createdAt: number;
  triggeredAt: number | null;
};
type PaperBracket = {
  symbol: string;
  takeProfitPrice?: number;
  takeProfitPct?: number;
  stopLossPrice?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  peakPrice?: number;
  createdAt: number;
};
type StrategyPlaybook = {
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
type Instrument = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  symbolType: string;
  isRwa: string;
};
type BacktestResult = SimulationResult & {
  researchRef?: PaperResearchRef;
  model: string;
  dataSource: string;
  spreadSource: "fallback" | "current-order-book";
  lookbackDays: number;
  coverage?: { requestedStart: number; requestedEnd: number; firstCandle: number; lastCandle: number; receivedBars: number; expectedBars: number; missingInsideRange: number };
};

const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const STARTING_CASH = 10_000;
const STARTER_PLAYBOOKS: Array<Omit<StrategyPlaybook, "id" | "createdAt">> = [
  {
    name: "Classic 20/50 Trend Following",
    symbol: "BTCUSDT",
    interval: "1H",
    prompt: "Go long when the 20-period EMA crosses above the 50-period EMA. Exit when the 20 EMA crosses below the 50 EMA.",
    lookbackDays: 30,
    feeBps: 10,
    slippageBps: 5,
  },
  {
    name: "RSI Oversold Dip Reversal",
    symbol: "ETHUSDT",
    interval: "15m",
    prompt: "Buy when RSI (14) drops below 30. Exit when RSI (14) rises above 65.",
    lookbackDays: 30,
    feeBps: 10,
    slippageBps: 5,
  },
  {
    name: "High-Beta Trend Filter",
    symbol: "SOLUSDT",
    interval: "4H",
    prompt: "Go long when the 10-period EMA crosses above the 30-period EMA. Exit when the 10 EMA crosses below the 30 EMA.",
    lookbackDays: 90,
    feeBps: 10,
    slippageBps: 5,
  },
];
const intervalMsByName: Record<string, number> = {
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

function supportsBacktestWindow(interval: string, days: number) {
  const intervalMs = intervalMsByName[interval];
  if (!intervalMs) return false;
  const estimatedBars = Math.ceil(days * 24 * 60 * 60_000 / intervalMs);
  return estimatedBars >= 65 && estimatedBars <= 12_000;
}

const storageKeys = {
  journal: "goriee.journal.v1",
  paper: "goriee.paper.v1",
  watchlist: "goriee.watchlist.v1",
  paperAlerts: "goriee.paper-alerts.v1",
  paperRisk: "goriee.paper-risk.v1",
  paperFee: "goriee.paper-fee-bps.v1",
  playbooks: "goriee.playbooks.v1",
  activePlaybook: "goriee.active-paper-playbook.v1",
  paperBrackets: "goriee.paper-brackets.v1",
  autoRuleRunner: "goriee.auto-rule-runner.v1",
  ruleRunnerLogs: "goriee.rule-runner-logs.v1",
  aiCooldown: "goriee.ai-cooldown.v1",
};

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 4,
    maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 6,
  }).format(value);
}

function formatScannerPrice(value: number) {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
}

function formatMoney(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function tradeStrategyLabel(trade: ClosedPaperTrade) {
  return trade.playbookNames[0] ?? trade.backtestRefs[0]?.summary ?? "Manual paper";
}

function formatDate(value: number, includeTime = true) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function researchErrorMessage(message: string) {
  if (/no endpoints found that can handle the requested parameters/i.test(message)) {
    return "OpenRouter could not find an available route for this request. Review the selected model in AI settings, then try again.";
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return "The AI provider is temporarily limiting requests. Wait a moment, then try again.";
  }
  return message;
}

function safeRead<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
    research: <><path d="M4 18.5 9 13l3.5 3 7.5-9" /><path d="M15.5 7H20v4.5" /><path d="M4 21h16" /></>,
    backtest: <><path d="M4 18V9m5 9V5m5 13v-6m5 6V3" /><path d="M2.5 21h19" /></>,
    replay: <><polygon points="11 19 2 12 11 5 11 19" /><polygon points="22 19 13 12 22 5 22 19" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18m-5 5h2" /><path d="M6 5V3h12v2" /></>,
    journal: <><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v15l-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8L5 20V5a1.5 1.5 0 0 1 1-1.5Z" /><path d="M8 8h8M8 12h8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.8 9a7.5 7.5 0 0 1 12.7-2L20 9M4 17v-5h5" /><path d="M19.2 15a7.5 7.5 0 0 1-12.7 2L4 15" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    scan: <><path d="M5 8V5h3m8 0h3v3m0 8v3h-3m-8 0H5v-3" /><circle cx="12" cy="12" r="3.2" /><path d="M12 6v2m0 8v2M6 12h2m8 0h2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    playbook: <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" /><path d="M6 6h10M6 10h10" /><path d="m4 19.5a2.5 2.5 0 0 1 2.5-2.5H20" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    trending: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
    check: <><polyline points="20 6 9 17 4 12" /></>,
    alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    sparkles: <><path d="m12 3 1.9 4.8 4.8 1.9-4.8 1.9L12 16.5l-1.9-4.8L5.3 9.8l4.8-1.9L12 3z" /><path d="M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" /></>,
    info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></>,
    more: <><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /><circle cx="5" cy="12" r="1.75" /></>,
    wave: <path d="M2 12c3-4 6-4 9 0s6 4 9 0" />,
    columns: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18m6-18v18" /></>,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
    bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

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
};

function PriceChart({
  candles,
  label,
  height = 250,
  indicators,
  isCutMode = false,
  onCutCandle,
  replayBrackets,
  replayTrades,
  activePosition,
  targetTradeReference,
}: {
  candles: Candle[];
  label: string;
  height?: number;
  indicators?: {
    ema20: number | null;
    ema50: number | null;
    support: number;
    resistance: number;
  } | null;
  isCutMode?: boolean;
  onCutCandle?: (candle: Candle) => void;
  replayBrackets?: ReplayBracketConfig;
  replayTrades?: ReplayTradeMarker[];
  activePosition?: {
    side: "buy" | "sell";
    entryPrice: number;
    entryTime: number;
    quantity: number;
  } | null;
  targetTradeReference?: {
    entryPrice: number;
    exitPrice: number;
    side: "buy" | "sell";
    netPnl?: number;
    returnPct?: number;
    label?: string;
  } | null;
}) {
  const [chartMode, setChartMode] = useState<"candles" | "line">("candles");
  const [showEma, setShowEma] = useState(true);
  const [showBands, setShowBands] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showCvd, setShowCvd] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTradeMarkers, setShowTradeMarkers] = useState(true);
  const [draggingBracket, setDraggingBracket] = useState<"tp" | "sl" | null>(null);

  // TradingView-style Zoom & Pan viewport state
  const [visibleBars, setVisibleBars] = useState<number>(75);
  const [panOffset, setPanOffset] = useState<number>(0); // 0 = snapped to latest candle, >0 = panned to historical bars
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; initialPan: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draggingBracket) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraggingBracket(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draggingBracket]);

  const handleZoom = useCallback((direction: "in" | "out") => {
    setVisibleBars((prev) => {
      const step = Math.max(5, Math.round(prev * 0.2));
      const minBars = 15;
      const maxBars = Math.max(candles.length, 250);
      if (direction === "in") {
        return Math.max(minBars, prev - step);
      } else {
        return Math.min(maxBars, prev + step);
      }
    });
  }, [candles.length]);

  const handleResetZoomPan = useCallback(() => {
    setVisibleBars(Math.min(75, candles.length));
    setPanOffset(0);
  }, [candles.length]);

  // Non-passive wheel listener for smooth TradingView-style mouse wheel zoom
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.max(4, Math.round(visibleBars * 0.15));
      if (e.deltaY < 0) {
        setVisibleBars((prev) => Math.max(15, prev - step));
      } else if (e.deltaY > 0) {
        setVisibleBars((prev) => Math.min(Math.max(candles.length, 250), prev + step));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [visibleBars, candles.length]);

  const chartData = useMemo(() => {
    if (!candles || candles.length < 2) return null;

    const clampedVisible = Math.max(15, Math.min(visibleBars, candles.length));
    const maxPan = Math.max(0, candles.length - clampedVisible);
    const clampedPan = Math.max(0, Math.min(panOffset, maxPan));

    const endIdx = candles.length - clampedPan;
    const startIdx = Math.max(0, endIdx - clampedVisible);
    const rows = candles.slice(startIdx, endIdx);

    if (rows.length < 2) return null;

    const highs = rows.map((c) => c.high);
    const lows = rows.map((c) => c.low);
    const minLow = Math.min(...lows);
    const maxHigh = Math.max(...highs);

    const padTop = 22;
    const padBottom = showVolume ? 50 : 22;
    // 800px coordinate space with dedicated 145px right gutter for price scale & bracket tags
    const width = 800;
    const rightGutter = 145;
    const plotWidth = width - rightGutter;
    const usableHeight = height - padTop - padBottom;
    const spread = maxHigh - minLow || maxHigh * 0.01 || 1;

    const barWidth = plotWidth / rows.length;
    const bodyWidth = Math.max(2.5, Math.min(9.5, barWidth * 0.7));

    const maxVolume = Math.max(...rows.map((c) => c.volume)) || 1;
    const volAreaHeight = 36;

    const linePath = rows
      .map((candle, idx) => {
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - candle.close) / spread) * usableHeight;
        return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    const allCloses = candles.map((c) => c.close);
    const allEma20 = ema(allCloses, 20).slice(startIdx, endIdx);
    const allEma50 = ema(allCloses, 50).slice(startIdx, endIdx);

    const ema20Path = allEma20
      .map((val, idx) => {
        if (val === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val) / spread) * usableHeight;
        return `${idx === 0 || allEma20[idx - 1] === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const ema50Path = allEma50
      .map((val, idx) => {
        if (val === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val) / spread) * usableHeight;
        return `${idx === 0 || allEma50[idx - 1] === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    // Bollinger Bands (20, 2)
    const allBb = bollingerBands(allCloses, 20, 2).slice(startIdx, endIdx);
    const bbUpperPath = allBb
      .map((val, idx) => {
        if (!val || val.upper === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val.upper) / spread) * usableHeight;
        return `${idx === 0 || allBb[idx - 1]?.upper === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const bbLowerPath = allBb
      .map((val, idx) => {
        if (!val || val.lower === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val.lower) / spread) * usableHeight;
        return `${idx === 0 || allBb[idx - 1]?.lower === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const bbMiddlePath = allBb
      .map((val, idx) => {
        if (!val || val.middle === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val.middle) / spread) * usableHeight;
        return `${idx === 0 || allBb[idx - 1]?.middle === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    // Bollinger Bands Envelope Polygon
    const validBb = allBb
      .map((val, idx) => ({ val, idx }))
      .filter(({ val }) => val && val.upper !== null && val.lower !== null);

    let bbEnvelopePath = "";
    if (validBb.length > 1) {
      const topPts = validBb.map(({ val, idx }) => {
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val.upper!) / spread) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      const btmPts = [...validBb].reverse().map(({ val, idx }) => {
        const x = (idx + 0.5) * barWidth;
        const y = padTop + ((maxHigh - val.lower!) / spread) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      bbEnvelopePath = `M${topPts[0]} L${topPts.slice(1).join(" L")} L${btmPts.join(" L")} Z`;
    }

    // MACD (12, 26, 9)
    const allMacd = macd(allCloses, 12, 26, 9).slice(startIdx, endIdx);
    const validMacdVals: number[] = [];
    allMacd.forEach((m) => {
      if (m.macd !== null) validMacdVals.push(m.macd);
      if (m.signal !== null) validMacdVals.push(m.signal);
      if (m.histogram !== null) validMacdVals.push(m.histogram);
    });
    const maxMacdVal = validMacdVals.length > 0 ? Math.max(...validMacdVals.map(Math.abs), 0.0001) : 1;
    const macdHeight = 65;
    const macdMidY = macdHeight / 2;
    const macdScale = (macdHeight / 2 - 8) / maxMacdVal;

    const macdLinePath = allMacd
      .map((val, idx) => {
        if (val.macd === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = macdMidY - val.macd * macdScale;
        return `${idx === 0 || allMacd[idx - 1]?.macd === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const macdSignalPath = allMacd
      .map((val, idx) => {
        if (val.signal === null) return "";
        const x = (idx + 0.5) * barWidth;
        const y = macdMidY - val.signal * macdScale;
        return `${idx === 0 || allMacd[idx - 1]?.signal === null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");

    const supportY = indicators?.support
      ? padTop + ((maxHigh - indicators.support) / spread) * usableHeight
      : null;
    const resistanceY = indicators?.resistance
      ? padTop + ((maxHigh - indicators.resistance) / spread) * usableHeight
      : null;

    return {
      rows,
      minLow,
      maxHigh,
      width,
      height,
      padTop,
      padBottom,
      rightGutter,
      plotWidth,
      barWidth,
      bodyWidth,
      usableHeight,
      spread,
      linePath,
      ema20Path,
      ema50Path,
      allBb,
      bbUpperPath,
      bbLowerPath,
      bbMiddlePath,
      bbEnvelopePath,
      allMacd,
      macdLinePath,
      macdSignalPath,
      macdHeight,
      macdMidY,
      macdScale,
      supportY,
      resistanceY,
      maxVolume,
      volAreaHeight,
      positive: rows.at(-1)!.close >= rows[0].open,
    };
  }, [candles, height, showVolume, indicators, visibleBars, panOffset]);

  const orderFlow = useMemo(() => {
    return calculateOrderFlow(chartData?.rows ?? []);
  }, [chartData]);

  const squeeze = useMemo(() => {
    if (!candles || candles.length < 20 || !chartData?.allBb || chartData.allBb.length === 0) {
      return { isSqueezed: false, bandwidthPct: 0, bandwidthPercentile: 50, barsInSqueeze: 0, bias: "Directional Coil" as const, message: "Standard volatility" };
    }
    const lastBb = chartData.allBb[chartData.allBb.length - 1];
    return detectVolatilitySqueeze(
      candles,
      lastBb && lastBb.upper !== null && lastBb.lower !== null && lastBb.middle !== null
        ? { upper: lastBb.upper, lower: lastBb.lower, middle: lastBb.middle }
        : null
    );
  }, [candles, chartData]);

  const cvdStats = useMemo(() => {
    if (!orderFlow || orderFlow.bars.length === 0 || !chartData) return null;
    const cvdVals = orderFlow.bars.map((b) => b.cvd);
    const minCvd = Math.min(...cvdVals);
    const maxCvd = Math.max(...cvdVals);
    const cvdSpread = maxCvd - minCvd || 1;
    const cvdHeight = 65;
    const cvdMidY = cvdHeight / 2;

    const cvdLinePath = orderFlow.bars
      .map((b, idx) => {
        const x = (idx + 0.5) * chartData.barWidth;
        const y = 8 + ((maxCvd - b.cvd) / cvdSpread) * (cvdHeight - 16);
        return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return { minCvd, maxCvd, cvdSpread, cvdHeight, cvdMidY, cvdLinePath };
  }, [orderFlow, chartData]);

  // Replay Bracket Coordinates & Dynamic Metrics (calculated safely before any early return)
  const entryY = replayBrackets && replayBrackets.entryPrice > 0 && chartData
    ? chartData.padTop + ((chartData.maxHigh - replayBrackets.entryPrice) / chartData.spread) * chartData.usableHeight
    : null;

  const tpY = replayBrackets && replayBrackets.tpPrice && replayBrackets.tpPrice > 0 && chartData
    ? chartData.padTop + ((chartData.maxHigh - replayBrackets.tpPrice) / chartData.spread) * chartData.usableHeight
    : null;

  const slY = replayBrackets && replayBrackets.slPrice && replayBrackets.slPrice > 0 && chartData
    ? chartData.padTop + ((chartData.maxHigh - replayBrackets.slPrice) / chartData.spread) * chartData.usableHeight
    : null;

  // Target Trade Review Coordinates (for historical replay handoff)
  const targetEntryY = targetTradeReference && targetTradeReference.entryPrice > 0 && chartData
    ? chartData.padTop + ((chartData.maxHigh - targetTradeReference.entryPrice) / chartData.spread) * chartData.usableHeight
    : null;
  const targetExitY = targetTradeReference && targetTradeReference.exitPrice > 0 && chartData
    ? chartData.padTop + ((chartData.maxHigh - targetTradeReference.exitPrice) / chartData.spread) * chartData.usableHeight
    : null;

  const isBuy = replayBrackets?.side === "buy";
  const tpDist = replayBrackets && replayBrackets.tpPrice && replayBrackets.entryPrice > 0
    ? (isBuy ? replayBrackets.tpPrice - replayBrackets.entryPrice : replayBrackets.entryPrice - replayBrackets.tpPrice)
    : 0;
  const tpPnlPct = replayBrackets && replayBrackets.entryPrice > 0
    ? (tpDist / replayBrackets.entryPrice) * 100
    : 0;

  const slDist = replayBrackets && replayBrackets.slPrice && replayBrackets.entryPrice > 0
    ? (isBuy ? replayBrackets.entryPrice - replayBrackets.slPrice : replayBrackets.slPrice - replayBrackets.entryPrice)
    : 0;
  const slLossPct = replayBrackets && replayBrackets.entryPrice > 0
    ? (slDist / replayBrackets.entryPrice) * 100
    : 0;

  const rrRatio = slDist > 0 && tpDist > 0 ? (tpDist / slDist).toFixed(1) : null;

  const clampedEntryY = entryY !== null && chartData ? Math.max(chartData.padTop + 10, Math.min(height - chartData.padBottom - 10, entryY)) : null;
  const clampedTpY = tpY !== null && chartData ? Math.max(chartData.padTop + 10, Math.min(height - chartData.padBottom - 10, tpY)) : null;
  const clampedSlY = slY !== null && chartData ? Math.max(chartData.padTop + 10, Math.min(height - chartData.padBottom - 10, slY)) : null;

  const isSlAtBreakeven = Boolean(
    replayBrackets &&
    replayBrackets.isActivePosition &&
    replayBrackets.slPrice &&
    Math.abs(replayBrackets.slPrice - replayBrackets.entryPrice) < 0.01
  );

  const shouldHideEntryTag = Boolean(
    (clampedSlY !== null && clampedEntryY !== null && Math.abs(clampedSlY - clampedEntryY) < 22) ||
    (clampedTpY !== null && clampedEntryY !== null && Math.abs(clampedTpY - clampedEntryY) < 22)
  );

  const is2RActive = rrRatio !== null && Math.abs(Number(rrRatio) - 2.0) <= 0.1;
  const is3RActive = rrRatio !== null && Math.abs(Number(rrRatio) - 3.0) <= 0.1;

  // TradingView automatic collision avoidance: hide scale numbers that collide with active brackets
  const scaleLabels = useMemo(() => {
    if (!chartData) return [];
    const activeYs: number[] = [];
    if (!shouldHideEntryTag && clampedEntryY !== null) activeYs.push(clampedEntryY);
    if (clampedTpY !== null) activeYs.push(clampedTpY);
    if (clampedSlY !== null) activeYs.push(clampedSlY);

    return [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const y = chartData.padTop + fraction * chartData.usableHeight;
      const price = chartData.maxHigh - fraction * chartData.spread;
      const hasCollision = activeYs.some((actY) => Math.abs(actY - y) < 18);
      return { fraction, y, price, visible: !hasCollision };
    });
  }, [chartData, clampedEntryY, clampedTpY, clampedSlY, shouldHideEntryTag]);

  // Window-level dragging listener for ultra-smooth vertical bracket adjustments
  useEffect(() => {
    if (!draggingBracket) return;
    const handlePointerMove = (e: PointerEvent) => {
      const container = chartContainerRef.current?.querySelector(".chart-stage");
      if (!container || !chartData || !replayBrackets) return;
      const rect = container.getBoundingClientRect();
      const clientY = e.clientY - rect.top;
      const svgY = (clientY / rect.height) * height;
      const clampedY = Math.max(chartData.padTop, Math.min(height - chartData.padBottom, svgY));
      const rawPrice = chartData.maxHigh - ((clampedY - chartData.padTop) / chartData.usableHeight) * chartData.spread;
      const cleanPrice = Number(rawPrice.toFixed(2));

      if (draggingBracket === "tp" && replayBrackets.onUpdateTpPrice) {
        replayBrackets.onUpdateTpPrice(cleanPrice);
      } else if (draggingBracket === "sl" && replayBrackets.onUpdateSlPrice) {
        replayBrackets.onUpdateSlPrice(cleanPrice);
      }
    };

    const handlePointerUp = () => {
      setDraggingBracket(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingBracket, chartData, replayBrackets, height]);

  if (!chartData) return <div className="chart-empty">Waiting for candle data…</div>;

  const currentHover = hoverIndex !== null && chartData.rows[hoverIndex]
    ? chartData.rows[hoverIndex]
    : chartData.rows.at(-1)!;

  const currentMacd = hoverIndex !== null && chartData.allMacd[hoverIndex]
    ? chartData.allMacd[hoverIndex]
    : chartData.allMacd.at(-1);

  const currentDelta = hoverIndex !== null && orderFlow.bars[hoverIndex]
    ? orderFlow.bars[hoverIndex].deltaVolume
    : orderFlow.currentDelta;

  const barChange = currentHover.open > 0
    ? ((currentHover.close - currentHover.open) / currentHover.open) * 100
    : 0;

  const handlePointerDownBracket = (type: "tp" | "sl", e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingBracket(type);
  };

  const handlePointerDownChart = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBracket || isCutMode) return;
    const target = e.target as HTMLElement | SVGElement;
    if (target.closest?.(".bracket-handle-pill") || target.closest?.(".bracket-quick-chip")) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = { clientX: e.clientX, initialPan: panOffset };
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const handlePointerMoveChart = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBracket && replayBrackets && chartData) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clientY = e.clientY - rect.top;
      const svgY = (clientY / rect.height) * height;
      const clampedY = Math.max(chartData.padTop, Math.min(height - chartData.padBottom, svgY));
      const rawPrice = chartData.maxHigh - ((clampedY - chartData.padTop) / chartData.usableHeight) * chartData.spread;
      const cleanPrice = Number(rawPrice.toFixed(2));

      if (draggingBracket === "tp" && replayBrackets.onUpdateTpPrice) {
        replayBrackets.onUpdateTpPrice(cleanPrice);
      } else if (draggingBracket === "sl" && replayBrackets.onUpdateSlPrice) {
        replayBrackets.onUpdateSlPrice(cleanPrice);
      }
      return;
    }

    if (isPanning && panStartRef.current && chartData) {
      const deltaX = e.clientX - panStartRef.current.clientX;
      const barsDelta = Math.round(deltaX / Math.max(4, chartData.barWidth));
      const maxPan = Math.max(0, candles.length - visibleBars);
      const newPan = Math.max(0, Math.min(maxPan, panStartRef.current.initialPan + barsDelta));
      setPanOffset(newPan);
      return;
    }

    handleMouseMove(e as any);
  };

  const handlePointerUpChart = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBracket) {
      setDraggingBracket(null);
    }
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = event.clientX - rect.left;
    const svgX = (clientX / rect.width) * chartData.width;
    if (svgX < 0 || svgX > chartData.plotWidth) {
      return;
    }
    const index = Math.floor((svgX / chartData.plotWidth) * chartData.rows.length);
    if (index >= 0 && index < chartData.rows.length) {
      setHoverIndex(index);
    }
  };

  const handleMouseLeave = () => {
    if (!draggingBracket && !isPanning) {
      setHoverIndex(null);
    }
  };

  return (
    <div ref={chartContainerRef} className="chart-wrap price-chart-container">
      <div className="chart-top-bar">
        <div className="chart-hover-pill">
          <span className="hover-time">{formatDate(currentHover.time)}</span>
          <span className="hover-metric">O: <strong>{formatPrice(currentHover.open)}</strong></span>
          <span className="hover-metric">H: <strong>{formatPrice(currentHover.high)}</strong></span>
          <span className="hover-metric">L: <strong>{formatPrice(currentHover.low)}</strong></span>
          <span className="hover-metric">C: <strong>{formatPrice(currentHover.close)}</strong></span>
          <span className={`hover-change ${barChange >= 0 ? "tone-up" : "tone-down"}`}>
            {barChange >= 0 ? "+" : ""}{barChange.toFixed(2)}%
          </span>
          <span className="hover-metric hover-vol">Vol: <strong>{formatCompact(currentHover.volume)}</strong></span>
          {squeeze.isSqueezed ? (
            <span className="squeeze-radar-pill squeeze-active" title={squeeze.message}>
              <span className="squeeze-pulse" aria-hidden="true" /> SQUEEZE ({squeeze.bias})
            </span>
          ) : (
            <span className="squeeze-radar-pill squeeze-normal" title={squeeze.message}>
              Normal Vol
            </span>
          )}
        </div>
        <div className="chart-toggles">
          {/* TradingView-style Zoom In / Zoom Out and Pan Controls */}
          <div className="chart-zoom-group">
            <button
              type="button"
              className="chart-pill-btn zoom-btn zoom-out-btn"
              onClick={() => handleZoom("out")}
              title="Zoom Out (−) / Scroll Down: view more historical candles"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="chart-pill-btn zoom-btn zoom-level-btn"
              onClick={handleResetZoomPan}
              title="Reset Zoom & Pan (Auto-fit default 75 bars) / Double-click chart"
            >
              {chartData.rows.length}b
            </button>
            <button
              type="button"
              className="chart-pill-btn zoom-btn zoom-in-btn"
              onClick={() => handleZoom("in")}
              title="Zoom In (+) / Scroll Up: inspect close-up candle details"
              aria-label="Zoom in"
            >
              +
            </button>
            {panOffset > 0 && (
              <button
                type="button"
                className="chart-pill-btn snap-latest-btn"
                onClick={() => setPanOffset(0)}
                title="Snap back to latest live candle"
              >
                ⇥ Latest
              </button>
            )}
          </div>

          <div className="chart-mode-group">
            <button
              type="button"
              className={`chart-pill-btn ${chartMode === "candles" ? "active" : ""}`}
              onClick={() => setChartMode("candles")}
              aria-pressed={chartMode === "candles"}
            >
              Candles
            </button>
            <button
              type="button"
              className={`chart-pill-btn ${chartMode === "line" ? "active" : ""}`}
              onClick={() => setChartMode("line")}
              aria-pressed={chartMode === "line"}
            >
              Line
            </button>
          </div>
          <button
            type="button"
            className={`chart-pill-btn ${showEma ? "active" : ""}`}
            onClick={() => setShowEma((v) => !v)}
            aria-pressed={showEma}
            title="Toggle EMA 20 (Cyan) and EMA 50 (Amber)"
          >
            EMA 20/50
          </button>
          <button
            type="button"
            className={`chart-pill-btn bb-toggle-btn ${showBands ? "active" : ""}`}
            onClick={() => setShowBands((v) => !v)}
            aria-pressed={showBands}
            title="Toggle Bollinger Bands (20, 2)"
          >
            BB (20, 2)
          </button>
          <button
            type="button"
            className={`chart-pill-btn macd-toggle-btn ${showMacd ? "active" : ""}`}
            onClick={() => setShowMacd((v) => !v)}
            aria-pressed={showMacd}
            title="Toggle MACD indicator panel (12, 26, 9)"
          >
            MACD
          </button>
          <button
            type="button"
            className={`chart-pill-btn cvd-toggle-btn ${showCvd ? "active" : ""}`}
            onClick={() => setShowCvd((v) => !v)}
            aria-pressed={showCvd}
            title="Toggle Cumulative Volume Delta (CVD) order flow panel"
          >
            CVD
          </button>
          {indicators?.support ? (
            <button
              type="button"
              className={`chart-pill-btn ${showLevels ? "active" : ""}`}
              onClick={() => setShowLevels((v) => !v)}
              aria-pressed={showLevels}
              title="Toggle Support and Resistance levels"
            >
              S/R Levels
            </button>
          ) : null}
          <button
            type="button"
            className={`chart-pill-btn ${showVolume ? "active" : ""}`}
            onClick={() => setShowVolume((v) => !v)}
            aria-pressed={showVolume}
            title="Toggle volume bars"
          >
            Volume
          </button>
          {((replayTrades && replayTrades.length > 0) || activePosition) ? (
            <button
              type="button"
              className={`chart-pill-btn markers-toggle-btn ${showTradeMarkers ? "active" : ""}`}
              onClick={() => setShowTradeMarkers((v) => !v)}
              aria-pressed={showTradeMarkers}
              title="Toggle on-chart trade execution badges and trajectory vectors"
            >
              Markers {(replayTrades?.length ?? 0) > 0 ? `(${replayTrades!.length})` : ""}
            </button>
          ) : null}
        </div>
      </div>

      {/* Chart Stage: SVG Price Area + HTML Right Price Rail */}
      <div className="chart-stage" style={{ height }}>
        <svg
          className={`price-chart interactive-price-chart ${isCutMode ? "candle-cut-cursor" : ""} ${draggingBracket ? "is-bracket-dragging" : ""} ${isPanning ? "is-panning" : ""}`}
          viewBox={`0 0 ${chartData.width} ${height}`}
          role="img"
          aria-label={label}
          preserveAspectRatio="none"
          onPointerDown={handlePointerDownChart}
          onPointerMove={handlePointerMoveChart}
          onPointerUp={handlePointerUpChart}
          onPointerCancel={handlePointerUpChart}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleResetZoomPan}
          onClick={(e) => {
            if (isCutMode && onCutCandle && chartData) {
              const rect = e.currentTarget.getBoundingClientRect();
              const clientX = e.clientX - rect.left;
              const svgX = (clientX / rect.width) * chartData.width;
              if (svgX <= chartData.plotWidth) {
                const idx = Math.min(
                  chartData.rows.length - 1,
                  Math.max(0, Math.floor((svgX / chartData.plotWidth) * chartData.rows.length))
                );
                if (chartData.rows[idx]) {
                  onCutCandle(chartData.rows[idx]);
                }
              }
            }
          }}
        >
          {/* Horizontal grid lines */}
          {scaleLabels.map((item) => (
            <line key={item.fraction} x1="0" x2={chartData.plotWidth} y1={item.y} y2={item.y} className="chart-grid" />
          ))}

          {/* Right Gutter Separator Line */}
          <line
            x1={chartData.plotWidth}
            x2={chartData.plotWidth}
            y1={0}
            y2={height}
            className="chart-gutter-divider"
          />

          {/* Bollinger Bands Shaded Envelope */}
          {showBands && chartData.bbEnvelopePath ? (
            <path d={chartData.bbEnvelopePath} className="chart-bb-envelope" />
          ) : null}

          {/* Bollinger Bands Upper, Middle, Lower Lines */}
          {showBands && chartData.bbUpperPath ? (
            <path d={chartData.bbUpperPath} className="chart-bb-line chart-bb-upper" />
          ) : null}
          {showBands && chartData.bbMiddlePath ? (
            <path d={chartData.bbMiddlePath} className="chart-bb-line chart-bb-middle" />
          ) : null}
          {showBands && chartData.bbLowerPath ? (
            <path d={chartData.bbLowerPath} className="chart-bb-line chart-bb-lower" />
          ) : null}

          {showVolume && chartData.rows.map((candle, idx) => {
            const x = (idx + 0.5) * chartData.barWidth;
            const volHeight = (candle.volume / chartData.maxVolume) * chartData.volAreaHeight;
            const y = height - 18 - volHeight;
            const isUp = candle.close >= candle.open;
            return (
              <rect
                key={`vol-${candle.time}`}
                x={x - chartData.bodyWidth / 2}
                y={y}
                width={chartData.bodyWidth}
                height={Math.max(1, volHeight)}
                className={isUp ? "chart-vol-up" : "chart-vol-down"}
              />
            );
          })}

          {showLevels && chartData.resistanceY !== null && chartData.resistanceY >= 0 && chartData.resistanceY <= height ? (
            <g className="chart-level-group">
              <line
                x1="0"
                x2={chartData.plotWidth}
                y1={chartData.resistanceY}
                y2={chartData.resistanceY}
                className="chart-level-line chart-resistance-line"
              />
              <text x="8" y={chartData.resistanceY - 4} className="chart-level-text">
                Res {formatPrice(indicators!.resistance)}
              </text>
            </g>
          ) : null}

          {showLevels && chartData.supportY !== null && chartData.supportY >= 0 && chartData.supportY <= height ? (
            <g className="chart-level-group">
              <line
                x1="0"
                x2={chartData.plotWidth}
                y1={chartData.supportY}
                y2={chartData.supportY}
                className="chart-level-line chart-support-line"
              />
              <text x="8" y={chartData.supportY + 12} className="chart-level-text">
                Sup {formatPrice(indicators!.support)}
              </text>
            </g>
          ) : null}

          {chartMode === "candles" ? (
            chartData.rows.map((candle, idx) => {
              const x = (idx + 0.5) * chartData.barWidth;
              const wickTop = chartData.padTop + ((chartData.maxHigh - candle.high) / chartData.spread) * chartData.usableHeight;
              const wickBottom = chartData.padTop + ((chartData.maxHigh - candle.low) / chartData.spread) * chartData.usableHeight;
              const bodyTop = chartData.padTop + ((chartData.maxHigh - Math.max(candle.open, candle.close)) / chartData.spread) * chartData.usableHeight;
              const bodyBottom = chartData.padTop + ((chartData.maxHigh - Math.min(candle.open, candle.close)) / chartData.spread) * chartData.usableHeight;
              const isUp = candle.close >= candle.open;
              return (
                <g key={candle.time} className={isUp ? "candle-up" : "candle-down"}>
                  <line x1={x} x2={x} y1={wickTop} y2={wickBottom} className="candle-wick" />
                  <rect
                    x={x - chartData.bodyWidth / 2}
                    y={bodyTop}
                    width={chartData.bodyWidth}
                    height={Math.max(1.5, bodyBottom - bodyTop)}
                    rx="1"
                    className="candle-body"
                  />
                </g>
              );
            })
          ) : (
            <>
              <path
                d={`${chartData.linePath} L${chartData.plotWidth},${height - chartData.padBottom} L0,${height - chartData.padBottom} Z`}
                className={chartData.positive ? "chart-area chart-area-up" : "chart-area chart-area-down"}
              />
              <path
                d={chartData.linePath}
                className={chartData.positive ? "chart-line chart-line-up" : "chart-line chart-line-down"}
              />
            </>
          )}

          {showEma && chartData.ema20Path ? (
            <path d={chartData.ema20Path} className="chart-ema-line chart-ema-20" />
          ) : null}
          {showEma && chartData.ema50Path ? (
            <path d={chartData.ema50Path} className="chart-ema-line chart-ema-50" />
          ) : null}

          {/* Replay Closed Trades Trajectory Lines & Execution Pins */}
          {showTradeMarkers && replayTrades && replayTrades.length > 0 && (
            <g className="chart-trade-markers-layer">
              {replayTrades.map((t) => {
                const entryIdx = chartData.rows.findIndex((c) => c.time === t.entryTime);
                const exitIdx = chartData.rows.findIndex((c) => c.time === t.exitTime);
                if (entryIdx === -1 && exitIdx === -1) return null;

                const entryX = (entryIdx !== -1 ? entryIdx + 0.5 : 0) * chartData.barWidth;
                const entryCandleY = chartData.padTop + ((chartData.maxHigh - t.entryPrice) / chartData.spread) * chartData.usableHeight;

                const exitX = (exitIdx !== -1 ? exitIdx + 0.5 : chartData.rows.length - 0.5) * chartData.barWidth;
                const exitCandleY = chartData.padTop + ((chartData.maxHigh - t.exitPrice) / chartData.spread) * chartData.usableHeight;

                const isWin = t.pnl >= 0;

                return (
                  <g key={t.id} className={`chart-trade-execution-group ${isWin ? "trade-win" : "trade-loss"}`}>
                    <line
                      x1={entryX}
                      y1={entryCandleY}
                      x2={exitX}
                      y2={exitCandleY}
                      className={`chart-trade-trajectory-line ${isWin ? "trajectory-win" : "trajectory-loss"}`}
                    />
                    {entryIdx !== -1 && (
                      <g className="trade-pin-entry" transform={`translate(${entryX}, ${entryCandleY})`}>
                        <circle r="4" className={t.side === "buy" ? "pin-circle-buy" : "pin-circle-sell"} />
                        <rect
                          x="-30"
                          y={t.side === "buy" ? 8 : -22}
                          width="60"
                          height="16"
                          rx="3"
                          className={t.side === "buy" ? "pin-bg-buy" : "pin-bg-sell"}
                        />
                        <text
                          x="0"
                          y={t.side === "buy" ? 19 : -10}
                          textAnchor="middle"
                          className="pin-text"
                        >
                          {t.side === "buy" ? "▲ BUY" : "▼ SELL"}
                        </text>
                      </g>
                    )}
                    {exitIdx !== -1 && (
                      <g className="trade-pin-exit" transform={`translate(${exitX}, ${exitCandleY})`}>
                        <circle r="4" className={isWin ? "pin-circle-win" : "pin-circle-loss"} />
                        <rect
                          x="-40"
                          y={isWin ? -22 : 8}
                          width="80"
                          height="16"
                          rx="3"
                          className={isWin ? "pin-bg-win" : "pin-bg-loss"}
                        />
                        <text
                          x="0"
                          y={isWin ? -10 : 19}
                          textAnchor="middle"
                          className="pin-text"
                        >
                          {isWin ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Replay Active Position Trajectory Line */}
          {showTradeMarkers && activePosition && (
            <g className="chart-active-trade-layer">
              {(() => {
                const entryIdx = chartData.rows.findIndex((c) => c.time === activePosition.entryTime);
                if (entryIdx === -1) return null;
                const entryX = (entryIdx + 0.5) * chartData.barWidth;
                const entryYPos = chartData.padTop + ((chartData.maxHigh - activePosition.entryPrice) / chartData.spread) * chartData.usableHeight;

                const currIdx = chartData.rows.length - 1;
                const currX = (currIdx + 0.5) * chartData.barWidth;
                const currClose = chartData.rows[currIdx].close;
                const currYPos = chartData.padTop + ((chartData.maxHigh - currClose) / chartData.spread) * chartData.usableHeight;

                const isLong = activePosition.side === "buy";
                const inProfit = isLong ? currClose >= activePosition.entryPrice : currClose <= activePosition.entryPrice;

                return (
                  <g className="active-trade-group">
                    <line
                      x1={entryX}
                      y1={entryYPos}
                      x2={currX}
                      y2={currYPos}
                      className={`active-trajectory-line ${inProfit ? "trajectory-win" : "trajectory-loss"}`}
                    />
                    <g className="trade-pin-entry" transform={`translate(${entryX}, ${entryYPos})`}>
                      <circle r="5" className={isLong ? "pin-circle-buy-live" : "pin-circle-sell-live"} />
                      <rect
                        x="-42"
                        y={isLong ? 10 : -26}
                        width="84"
                        height="18"
                        rx="3"
                        className={isLong ? "pin-bg-buy-live" : "pin-bg-sell-live"}
                      />
                      <text
                        x="0"
                        y={isLong ? 23 : -13}
                        textAnchor="middle"
                        className="pin-text pin-text-live"
                      >
                        {isLong ? "▲ LIVE LONG" : "▼ LIVE SHORT"}
                      </text>
                    </g>
                  </g>
                );
              })()}
            </g>
          )}

          {/* Replay Bracket Lines & Risk Corridors in SVG */}
          {replayBrackets && entryY !== null && entryY >= 0 && entryY <= height && (
            <g className="chart-replay-brackets-layer">
              {/* Shaded Take Profit Corridor (confined to plotWidth) */}
              {tpY !== null && (
                <rect
                  x="0"
                  y={Math.min(entryY, tpY)}
                  width={chartData.plotWidth}
                  height={Math.max(1, Math.abs(entryY - tpY))}
                  className="bracket-corridor-tp"
                  pointerEvents="none"
                />
              )}
              {/* Shaded Stop Loss Corridor (confined to plotWidth) */}
              {slY !== null && (
                <rect
                  x="0"
                  y={Math.min(entryY, slY)}
                  width={chartData.plotWidth}
                  height={Math.max(1, Math.abs(entryY - slY))}
                  className="bracket-corridor-sl"
                  pointerEvents="none"
                />
              )}

              {/* Entry Price Dashed Line spanning full width */}
              <line
                x1="0"
                x2={chartData.width}
                y1={entryY}
                y2={entryY}
                className="bracket-line-entry"
              />

              {/* Take Profit Dashed Line spanning full width */}
              {tpY !== null && (
                <line
                  x1="0"
                  x2={chartData.width}
                  y1={tpY}
                  y2={tpY}
                  className="bracket-line-tp"
                />
              )}

              {/* Stop Loss Dashed Line spanning full width */}
              {slY !== null && (
                <line
                  x1="0"
                  x2={chartData.width}
                  y1={slY}
                  y2={slY}
                  className="bracket-line-sl"
                />
              )}
            </g>
          )}

          {/* Target Trade Historical Review Reference Guidelines & Corridor */}
          {targetTradeReference && targetEntryY !== null && targetExitY !== null && (
            <g className="chart-target-trade-layer" pointerEvents="none">
              <rect
                x="0"
                y={Math.min(targetEntryY, targetExitY)}
                width={chartData.plotWidth}
                height={Math.max(1, Math.abs(targetEntryY - targetExitY))}
                className={`target-trade-corridor ${(targetTradeReference.netPnl ?? 0) >= 0 ? "is-win" : "is-loss"}`}
              />
              <line
                x1="0"
                x2={chartData.width}
                y1={targetEntryY}
                y2={targetEntryY}
                className="target-trade-line-entry"
              />
              <line
                x1="0"
                x2={chartData.width}
                y1={targetExitY}
                y2={targetExitY}
                className="target-trade-line-exit"
              />
            </g>
          )}

          {/* Dual-Axis Crosshairs */}
          {hoverIndex !== null && hoverIndex < chartData.rows.length && (
            <g className="chart-crosshair-layer" pointerEvents="none">
              <line
                x1={(hoverIndex + 0.5) * chartData.barWidth}
                x2={(hoverIndex + 0.5) * chartData.barWidth}
                y1={chartData.padTop}
                y2={height - (showVolume ? 18 : chartData.padBottom)}
                className="chart-crosshair"
              />
              {(() => {
                const hoverCandle = chartData.rows[hoverIndex];
                const hoverY = chartData.padTop + ((chartData.maxHigh - hoverCandle.close) / chartData.spread) * chartData.usableHeight;
                return (
                  <line
                    x1="0"
                    x2={chartData.plotWidth}
                    y1={hoverY}
                    y2={hoverY}
                    className="chart-crosshair"
                    strokeDasharray="2 2"
                  />
                );
              })()}
            </g>
          )}

          {isCutMode && hoverIndex !== null && hoverIndex < chartData.rows.length && (
            <g className="cut-indicator-layer" pointerEvents="none">
              <line
                x1={(hoverIndex + 0.5) * chartData.barWidth}
                x2={(hoverIndex + 0.5) * chartData.barWidth}
                y1={chartData.padTop}
                y2={height - (showVolume ? 18 : chartData.padBottom)}
                className="candle-cut-guideline"
              />
              <rect
                x={Math.max(4, Math.min(chartData.plotWidth - 80, (hoverIndex + 0.5) * chartData.barWidth - 38))}
                y={chartData.padTop}
                width={76}
                height={18}
                rx="3"
                fill="rgba(5, 150, 105, 0.95)"
              />
              <text
                x={Math.max(4, Math.min(chartData.plotWidth - 80, (hoverIndex + 0.5) * chartData.barWidth - 38)) + 38}
                y={chartData.padTop + 13}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="10"
                fontWeight="bold"
                fontFamily="var(--font-mono, monospace)"
              >
                Cut Here
              </text>
            </g>
          )}
        </svg>

        {/* HTML Dedicated Right Price Rail & Chevron Tags */}
        <div className="chart-right-rail" style={{ width: chartData.rightGutter }}>
          {/* Background Price Scale Numbers with automatic collision clearance */}
          {scaleLabels.map((item) => item.visible ? (
            <div
              key={item.fraction}
              className="rail-scale-label"
              style={{ top: `${item.y}px` }}
            >
              ${formatPrice(item.price)}
            </div>
          ) : null)}

          {/* Replay Chevron Brackets */}
          {replayBrackets && (
            <>
              {/* Entry / Mark Chevron Tag (auto-suppressed if colliding with SL or TP to prevent overlap) */}
              {entryY !== null && !shouldHideEntryTag && (
                <div
                  className="rail-chevron-tag rail-tag-entry bracket-tag-entry"
                  style={{ top: `${clampedEntryY}px` }}
                >
                  <span className="rail-chevron-notch">◀</span>
                  <div className="rail-chevron-body bracket-tag-bg-entry">
                    <span className="rail-tag-kicker">{replayBrackets.isActivePosition ? "ENTRY" : "MARK"}</span>
                    <span className="rail-tag-val bracket-tag-text-entry">${formatPrice(replayBrackets.entryPrice)}</span>
                  </div>
                </div>
              )}

              {/* Take Profit Chevron Tag & Docked Chips */}
              {tpY !== null && (
                <div
                  className={`rail-chevron-tag rail-tag-tp bracket-group bracket-tp-group ${draggingBracket === "tp" ? "is-dragging" : ""}`}
                  style={{ top: `${clampedTpY}px` }}
                >
                  <div className="rail-docked-chips">
                    <button
                      type="button"
                      className={`bracket-quick-chip bracket-chip-2r ${is2RActive ? "active-chip" : ""}`}
                      onClick={(e) => { e.stopPropagation(); replayBrackets.onSnapRiskReward?.(2); }}
                      title="Snap Take Profit to 2R target"
                    >
                      2R
                    </button>
                    <button
                      type="button"
                      className={`bracket-quick-chip bracket-chip-3r ${is3RActive ? "active-chip" : ""}`}
                      onClick={(e) => { e.stopPropagation(); replayBrackets.onSnapRiskReward?.(3); }}
                      title="Snap Take Profit to 3R target"
                    >
                      3R
                    </button>
                  </div>
                  <div
                    className="rail-chevron-pill bracket-handle-pill"
                    onPointerDown={(e) => handlePointerDownBracket("tp", e)}
                    title="Drag vertically to adjust Take Profit target"
                  >
                    <span className="rail-chevron-notch notch-tp">◀</span>
                    <div className="rail-chevron-body bracket-pill-bg-tp">
                      <span className="rail-tag-kicker">TP</span>
                      <span className="rail-tag-val bracket-pill-text-tp">${formatPrice(replayBrackets.tpPrice!)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Stop Loss Chevron Tag & Docked Chips */}
              {slY !== null && (
                <div
                  className={`rail-chevron-tag rail-tag-sl bracket-group bracket-sl-group ${draggingBracket === "sl" ? "is-dragging" : ""} ${isSlAtBreakeven ? "is-breakeven" : ""}`}
                  style={{ top: `${clampedSlY}px` }}
                >
                  <div className="rail-docked-chips">
                    <button
                      type="button"
                      className={`bracket-quick-chip bracket-chip-be ${isSlAtBreakeven ? "active-chip" : ""}`}
                      onClick={(e) => { e.stopPropagation(); replayBrackets.onSnapBreakeven?.(); }}
                      title={isSlAtBreakeven ? "Stop Loss currently locked at Breakeven" : "Snap Stop Loss to Breakeven (Entry Price)"}
                    >
                      BE
                    </button>
                  </div>
                  <div
                    className="rail-chevron-pill bracket-handle-pill"
                    onPointerDown={(e) => handlePointerDownBracket("sl", e)}
                    title="Drag vertically to adjust Stop Loss trigger"
                  >
                    <span className="rail-chevron-notch notch-sl">◀</span>
                    <div className="rail-chevron-body bracket-pill-bg-sl">
                      <span className="rail-tag-kicker">{isSlAtBreakeven ? "BE · SL" : "SL"}</span>
                      <span className="rail-tag-val bracket-pill-text-sl">${formatPrice(replayBrackets.slPrice!)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Target Trade Historical Review Price Rail Tags */}
          {targetTradeReference && !replayBrackets && (
            <>
              {targetEntryY !== null && (
                <div
                  className="rail-chevron-tag rail-tag-target-entry"
                  style={{ top: `${Math.max(chartData.padTop + 10, Math.min(height - chartData.padBottom - 10, targetEntryY))}px` }}
                >
                  <span className="rail-chevron-notch notch-target-entry">◀</span>
                  <div className="rail-chevron-body target-tag-bg-entry">
                    <span className="rail-tag-kicker">HIST ENTRY</span>
                    <span className="rail-tag-val">${formatPrice(targetTradeReference.entryPrice)}</span>
                  </div>
                </div>
              )}
              {targetExitY !== null && (
                <div
                  className="rail-chevron-tag rail-tag-target-exit"
                  style={{ top: `${Math.max(chartData.padTop + 10, Math.min(height - chartData.padBottom - 10, targetExitY))}px` }}
                >
                  <span className="rail-chevron-notch notch-target-exit">◀</span>
                  <div className={`rail-chevron-body ${(targetTradeReference.netPnl ?? 0) >= 0 ? "target-tag-bg-win" : "target-tag-bg-loss"}`}>
                    <span className="rail-tag-kicker">HIST EXIT</span>
                    <span className="rail-tag-val">${formatPrice(targetTradeReference.exitPrice)}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Live Crosshair Price Badge */}
          {hoverIndex !== null && hoverIndex < chartData.rows.length && (
            <div
              className="rail-hover-badge"
              style={{
                top: `${chartData.padTop + ((chartData.maxHigh - chartData.rows[hoverIndex].close) / chartData.spread) * chartData.usableHeight}px`
              }}
            >
              <span className="rail-chevron-notch notch-hover">◀</span>
              <span className="rail-hover-val">${formatPrice(chartData.rows[hoverIndex].close)}</span>
            </div>
          )}
        </div>
      </div>

      {/* MACD Dedicated Indicator Sub-Panel */}
      {showMacd && (
        <div className="chart-macd-panel">
          <div className="chart-macd-header">
            <span className="macd-title">MACD (12, 26, 9)</span>
            <div className="macd-hover-readout">
              <span className="macd-val-macd">
                MACD: <strong>{currentMacd?.macd !== null && currentMacd?.macd !== undefined ? currentMacd.macd.toFixed(2) : "n/a"}</strong>
              </span>
              <span className="macd-val-signal">
                Signal: <strong>{currentMacd?.signal !== null && currentMacd?.signal !== undefined ? currentMacd.signal.toFixed(2) : "n/a"}</strong>
              </span>
              <span className={`macd-val-hist ${(currentMacd?.histogram ?? 0) >= 0 ? "tone-up" : "tone-down"}`}>
                Hist: <strong>{currentMacd?.histogram !== null && currentMacd?.histogram !== undefined ? (currentMacd.histogram >= 0 ? "+" : "") + currentMacd.histogram.toFixed(2) : "n/a"}</strong>
              </span>
            </div>
          </div>
          <svg
            className="interactive-macd-chart"
            viewBox={`0 0 ${chartData.width} ${chartData.macdHeight}`}
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Zero line */}
            <line
              x1="0"
              x2={chartData.width}
              y1={chartData.macdMidY}
              y2={chartData.macdMidY}
              className="chart-grid macd-zero-line"
            />

            {/* Histogram bars */}
            {chartData.allMacd.map((pt, idx) => {
              if (pt.histogram === null) return null;
              const x = (idx + 0.5) * chartData.barWidth;
              const barH = Math.abs(pt.histogram * chartData.macdScale);
              const y = pt.histogram >= 0 ? chartData.macdMidY - barH : chartData.macdMidY;
              const isPositive = pt.histogram >= 0;
              return (
                <rect
                  key={`macd-hist-${idx}`}
                  x={x - chartData.bodyWidth / 2}
                  y={y}
                  width={chartData.bodyWidth}
                  height={Math.max(1, barH)}
                  className={isPositive ? "macd-bar-up" : "macd-bar-down"}
                />
              );
            })}

            {/* MACD line (Fast) */}
            {chartData.macdLinePath && <path d={chartData.macdLinePath} className="chart-macd-line" />}

            {/* Signal line */}
            {chartData.macdSignalPath && <path d={chartData.macdSignalPath} className="chart-signal-line" />}

            {/* Crosshair */}
            {hoverIndex !== null && (
              <line
                x1={(hoverIndex + 0.5) * chartData.barWidth}
                x2={(hoverIndex + 0.5) * chartData.barWidth}
                y1={0}
                y2={chartData.macdHeight}
                className="chart-crosshair"
              />
            )}
          </svg>
        </div>
      )}

      {showCvd && cvdStats && (
        <div className="chart-macd-panel chart-cvd-panel">
          <div className="chart-macd-header">
            <span className="macd-title">Cumulative Volume Delta (CVD)</span>
            <div className="macd-hover-readout">
              <span className={`macd-val-hist ${currentDelta >= 0 ? "tone-up" : "tone-down"}`}>
                Delta: <strong>{currentDelta >= 0 ? "+" : ""}{formatCompact(currentDelta)}</strong>
              </span>
              <span>
                Aggression: <strong>{orderFlow.buyerAggressionPct}% Buy</strong>
              </span>
              <span className={`cvd-divergence-pill ${orderFlow.divergence.includes("Bullish") ? "cvd-bull-divergence" : orderFlow.divergence.includes("Bearish") ? "cvd-bear-divergence" : ""}`}>
                {orderFlow.divergence}
              </span>
            </div>
          </div>
          <svg
            className="interactive-macd-chart"
            viewBox={`0 0 ${chartData.width} ${cvdStats.cvdHeight}`}
            preserveAspectRatio="none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <line
              x1="0"
              x2={chartData.width}
              y1={cvdStats.cvdMidY}
              y2={cvdStats.cvdMidY}
              className="chart-grid macd-zero-line"
            />
            {cvdStats.cvdLinePath ? (
              <path d={cvdStats.cvdLinePath} className="chart-macd-line" stroke="#0c9a6b" strokeWidth="1.8" fill="none" />
            ) : null}
            {hoverIndex !== null && (
              <line
                x1={(hoverIndex + 0.5) * chartData.barWidth}
                x2={(hoverIndex + 0.5) * chartData.barWidth}
                y1={0}
                y2={cvdStats.cvdHeight}
                className="chart-crosshair"
              />
            )}
          </svg>
        </div>
      )}

      <div className="chart-scale">
        <span>{formatPrice(chartData.minLow)}</span>
        <div className="chart-legend-row">
          {showEma ? (
            <span className="chart-ema-legend">
              <small className="ema-20-dot">●</small> EMA 20
              <small className="ema-50-dot">●</small> EMA 50
            </span>
          ) : null}
          {showBands ? (
            <span className="chart-bb-legend">
              <small className="bb-band-dot">●</small> BB (20, 2)
            </span>
          ) : null}
          {showMacd ? (
            <span className="chart-macd-legend">
              <small className="macd-line-dot">●</small> MACD (12, 26)
              <small className="signal-line-dot">●</small> Signal (9)
            </span>
          ) : null}
          {showCvd ? (
            <span className="chart-macd-legend">
              <small className="ema-20-dot">●</small> CVD ({orderFlow.regime})
            </span>
          ) : null}
        </div>
        <span>{formatPrice(chartData.maxHigh)}</span>
      </div>
    </div>
  );
}

const LineChart = PriceChart;

function CumulativePnlChart({ trades }: { trades: ClosedPaperTrade[] }) {
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
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
    </div>
  );
}

export default function TradingDesk() {
  const [view, setView] = useState<View>("desk");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1H");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState("");

  // Trade Replay Simulator State
  const isReplayActive = view === "replay";
  const [isCutMode, setIsCutMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayWallet, setReplayWallet] = useState<ReplayWallet>(() => createInitialReplayWallet());
  const [scorecardModalOpen, setScorecardModalOpen] = useState(false);
  const [replayTicketSide, setReplayTicketSide] = useState<"buy" | "sell">("buy");
  const [replayTicketAmount, setReplayTicketAmount] = useState<number>(500);
  const [replayTicketTpPct, setReplayTicketTpPct] = useState<number>(2.0);
  const [replayTicketSlPct, setReplayTicketSlPct] = useState<number>(1.0);
  const [replayTargetTrade, setReplayTargetTrade] = useState<ReplayTargetTrade | null>(null);

  // Clamped market data for zero-hindsight simulation
  const activeMarket = useMemo(() => {
    if (!market) return null;
    if (!isReplayActive) return market;
    const clampedIndex = Math.max(0, Math.min(market.candles.length - 1, replayIndex));
    const sliced = market.candles.slice(0, clampedIndex + 1);
    const lastBar = sliced[sliced.length - 1] ?? market.candles[0];
    return {
      ...market,
      price: lastBar.close,
      asOf: lastBar.time,
      candles: sliced,
    };
  }, [market, isReplayActive, replayIndex]);

  const liveIndicators = useMemo(() => activeMarket ? getIndicatorSnapshot(activeMarket) : null, [activeMarket]);
  const [refreshCount, setRefreshCount] = useState(0);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [scannerMarkets, setScannerMarkets] = useState<SpotScanMarket[]>([]);
  const [scannerAsOf, setScannerAsOf] = useState(0);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerRefresh, setScannerRefresh] = useState(0);
  const [scannerQuery, setScannerQuery] = useState("");
  const [scannerSort, setScannerSort] = useState<ScannerSort>("active");
  const [scannerAssetType, setScannerAssetType] = useState<ScannerAssetType>("all");
  const [scannerMinTurnover, setScannerMinTurnover] = useState(0);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [instrumentList, setInstrumentList] = useState<Instrument[]>([]);
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [tokenRetry, setTokenRetry] = useState(0);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const [instrumentError, setInstrumentError] = useState("");
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState("");
  const requestBusy = useRef(false);
  const [aiRetryAtState, setAiRetryAtState] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = Number(window.localStorage.getItem("goriee.ai-cooldown.v1") || 0);
      return Number.isFinite(saved) && saved > Date.now() ? saved : 0;
    } catch {
      return 0;
    }
  });
  const aiRetryAt = aiRetryAtState;
  const setAiRetryAt = (timestamp: number) => {
    setAiRetryAtState(timestamp);
    try {
      if (timestamp > Date.now()) {
        window.localStorage.setItem(storageKeys.aiCooldown, String(timestamp));
      } else {
        window.localStorage.removeItem(storageKeys.aiCooldown);
      }
    } catch {}
  };
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const cooldownSeconds = Math.max(0, Math.ceil((aiRetryAt - clockNow) / 1000));
  const researchAbortRef = useRef<AbortController | null>(null);
  const backtestAbortRef = useRef<AbortController | null>(null);
  const closingAssets = useRef(new Set<string>());
  const [draftsReady, setDraftsReady] = useState(false);
  const [includeWebResearch, setIncludeWebResearch] = useState(false);
  const [journal, setJournal] = useState<JournalItem[]>([]);
  const [journalQuery, setJournalQuery] = useState("");
  const [selectedJournalItem, setSelectedJournalItem] = useState<JournalItem | null>(null);
  const [previewJournalId, setPreviewJournalId] = useState<string>("");
  const [journalTokenFilter, setJournalTokenFilter] = useState<string>("ALL");
  const [collapsedJournalClusters, setCollapsedJournalClusters] = useState<Record<string, boolean>>({});
  const journalCloseRef = useRef<HTMLButtonElement>(null);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [paperTab, setPaperTab] = useState<"account" | "review" | "analytics">("account");
  const [paperFeeBps, setPaperFeeBps] = useState(10);
  const [paperReviewSearch, setPaperReviewSearch] = useState("");
  const [paperReviewSymbol, setPaperReviewSymbol] = useState("all");
  const [paperReviewStrategy, setPaperReviewStrategy] = useState("all");
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderAmount, setOrderAmount] = useState("250");
  const [attachBracket, setAttachBracket] = useState(false);
  const [takeProfitPct, setTakeProfitPct] = useState("5.0");
  const [stopLossPct, setStopLossPct] = useState("2.5");
  const [trailingStopPct, setTrailingStopPct] = useState("0");
  const [paperBrackets, setPaperBrackets] = useState<Record<string, PaperBracket>>({});
  const [editingBracketSymbol, setEditingBracketSymbol] = useState<string | null>(null);
  const [bracketModalTp, setBracketModalTp] = useState("5.0");
  const [bracketModalSl, setBracketModalSl] = useState("2.5");
  const [bracketModalTrail, setBracketModalTrail] = useState("0");
  const [deskLayout, setDeskLayout] = useState<"single" | "grid">("single");
  const [deskRightTab, setDeskRightTab] = useState<"ask" | "orderbook">("ask");
  const [paperMessage, setPaperMessage] = useState("");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);
  const [paperAlerts, setPaperAlerts] = useState<PaperAlert[]>([]);
  const [alertSymbol, setAlertSymbol] = useState("BTCUSDT");
  const [alertPurpose, setAlertPurpose] = useState<PaperAlert["purpose"]>("price");
  const [alertDirection, setAlertDirection] = useState<PaperAlert["direction"]>("above");
  const [alertPrice, setAlertPrice] = useState("");
  const [dailyLossLimit, setDailyLossLimit] = useState(250);
  const [playbooks, setPlaybooks] = useState<StrategyPlaybook[]>([]);
  const [playbookName, setPlaybookName] = useState("");
  const [playbookMessage, setPlaybookMessage] = useState("");
  const [activePaperPlaybookId, setActivePaperPlaybookId] = useState("");
  const [playbookSearch, setPlaybookSearch] = useState("");
  const [playbookFilterSymbol, setPlaybookFilterSymbol] = useState("all");
  const [playbookFilterInterval, setPlaybookFilterInterval] = useState("all");
  const [playbookFilterStatus, setPlaybookFilterStatus] = useState<"all" | "active">("all");
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [seededResearchReport, setSeededResearchReport] = useState<Report | null>(null);
  const [strategyPrompt, setStrategyPrompt] = useState("Go long when the 20-period EMA crosses above the 50-period EMA. Exit when the 20 EMA crosses below the 50 EMA.");
  const [backtestDays, setBacktestDays] = useState(30);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [researchElapsed, setResearchElapsed] = useState(0);
  const [backtestElapsed, setBacktestElapsed] = useState(0);
  const [ruleRunnerActive, setRuleRunnerActive] = useState<boolean>(false);
  const [ruleRunnerLogs, setRuleRunnerLogs] = useState<Array<{ id: string; time: number; symbol: string; action: "buy" | "sell" | "hold"; message: string }>>([]);
  const [ruleRunnerEvaluating, setRuleRunnerEvaluating] = useState<boolean>(false);
  const [ruleRunnerPlaybookId, setRuleRunnerPlaybookId] = useState<string>("");
  const [cardExportData, setCardExportData] = useState<CardExportData | null>(null);
  const [cardModalOpen, setCardModalOpen] = useState<boolean>(false);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "j" || e.code === "KeyJ")) {
        e.preventDefault();
        setCopilotOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setCopilotOpen(false);
        setMobileMoreOpen(false);
        setOrderOpen(false);
        setCardModalOpen(false);
        setEditingBracketSymbol(null);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const parameterMatrix = useMemo(() => {
    if (!backtest || !market || market.candles.length < 35) return null;
    const isRsi = backtest.strategy.kind === "rsi_reversion" || strategyPrompt.toLowerCase().includes("rsi");
    return calculateParameterMatrix(market.candles, {
      kind: isRsi ? "rsi_reversion" : "ema_cross",
      feeBps,
      slippageBps,
      startingBalance: backtest.startingBalance,
    });
  }, [backtest, market, feeBps, slippageBps, strategyPrompt]);

  useEffect(() => {
    if (!researchLoading) {
      setResearchElapsed(0);
      return;
    }
    const startTime = Date.now();
    const timer = window.setInterval(() => {
      setResearchElapsed(Math.max(0, (Date.now() - startTime) / 1000));
    }, 100);
    return () => window.clearInterval(timer);
  }, [researchLoading]);

  useEffect(() => {
    if (!backtestLoading) {
      setBacktestElapsed(0);
      return;
    }
    const startTime = Date.now();
    const timer = window.setInterval(() => {
      setBacktestElapsed(Math.max(0, (Date.now() - startTime) / 1000));
    }, 100);
    return () => window.clearInterval(timer);
  }, [backtestLoading]);

  useEffect(() => {
    setJournal(safeRead<JournalItem[]>(storageKeys.journal, []));
    const drafts = safeRead<{ question?: string; strategy?: string }>("goriee.drafts.v1", {});
    if (typeof drafts.question === "string") setQuestion(drafts.question.slice(0, 600));
    if (typeof drafts.strategy === "string") setStrategyPrompt(drafts.strategy.slice(0, 600));
    setDraftsReady(true);
    setPaperTrades(safeRead<PaperTrade[]>(storageKeys.paper, []));
    const savedPaperFee = safeRead<number>(storageKeys.paperFee, 10);
    setPaperFeeBps(Number.isFinite(savedPaperFee) && savedPaperFee >= 0 && savedPaperFee <= 1000 ? savedPaperFee : 10);
    const savedAlerts = safeRead<PaperAlert[]>(storageKeys.paperAlerts, []);
    setPaperAlerts(Array.isArray(savedAlerts) ? savedAlerts.filter((alert) =>
      alert && typeof alert.id === "string" && /^[A-Z0-9]{5,20}$/.test(alert.symbol) &&
      Number.isFinite(alert.price) && alert.price > 0 &&
      (alert.direction === "above" || alert.direction === "below") &&
      ["price", "stop", "target"].includes(alert.purpose),
    ) : []);
    const savedRisk = safeRead<number>(storageKeys.paperRisk, 250);
    setDailyLossLimit(Number.isFinite(savedRisk) && savedRisk >= 1 && savedRisk <= 100_000 ? savedRisk : 250);
    const savedPlaybooks = safeRead<StrategyPlaybook[]>(storageKeys.playbooks, []);
    setPlaybooks(Array.isArray(savedPlaybooks) ? savedPlaybooks.filter((playbook) =>
      playbook && typeof playbook.id === "string" && typeof playbook.name === "string" &&
      /^[A-Z0-9]{5,20}$/.test(playbook.symbol) && typeof playbook.prompt === "string" && playbook.prompt.length >= 8 &&
      ["15m", "1H", "4H", "1D"].includes(playbook.interval) && [7, 30, 90, 180, 365].includes(playbook.lookbackDays),
    ).slice(0, 30) : []);
    setActivePaperPlaybookId(safeRead<string>(storageKeys.activePlaybook, ""));
    const savedBrackets = safeRead<Record<string, PaperBracket>>(storageKeys.paperBrackets, {});
    setPaperBrackets(savedBrackets && typeof savedBrackets === "object" ? savedBrackets : {});
    const savedWatchlist = safeRead<unknown>(storageKeys.watchlist, DEFAULT_WATCHLIST);
    const validWatchlist = Array.isArray(savedWatchlist)
      ? savedWatchlist.filter((asset): asset is string => typeof asset === "string" && /^[A-Z0-9]{5,20}$/.test(asset)).slice(0, 50)
      : DEFAULT_WATCHLIST;
    setWatchlist([...new Set(validWatchlist)]);
    setWatchlistReady(true);
    const savedAutoRunner = safeRead<boolean>(storageKeys.autoRuleRunner, false);
    setRuleRunnerActive(Boolean(savedAutoRunner));
    const savedRuleLogs = safeRead<Array<{ id: string; time: number; symbol: string; action: "buy" | "sell" | "hold"; message: string }>>(storageKeys.ruleRunnerLogs, []);
    setRuleRunnerLogs(Array.isArray(savedRuleLogs) ? savedRuleLogs.slice(0, 15) : []);
  }, []);

  useEffect(() => {
    if (!draftsReady) return;
    try { window.localStorage.setItem("goriee.drafts.v1", JSON.stringify({ question, strategy: strategyPrompt })); } catch { /* Inputs remain available in the current session. */ }
  }, [draftsReady, question, strategyPrompt]);

  useEffect(() => {
    let current = true;
    fetch("/api/ai-status", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (current && response.ok) {
          setAiConfigured(Boolean(payload.configured));
          setAiModel(typeof payload.model === "string" ? payload.model : "");
        }
      })
      .catch(() => {
        if (current) setAiConfigured(false);
    });
    return () => { current = false; };
  }, [view]);

  useEffect(() => {
    setResearchError("");
    setAiRetryAt(0);
  }, [aiModel]);

  useEffect(() => {
    setBacktest(null);
    setBacktestError("");
  }, [symbol, interval, strategyPrompt, backtestDays, feeBps, slippageBps]);

  useEffect(() => {
    if (!supportsBacktestWindow(interval, backtestDays)) {
      setBacktestDays(interval === "1D" ? 90 : 30);
    }
  }, [interval, backtestDays]);

  useEffect(() => {
    if ((!pickerOpen && !marketSearchOpen) || tokensLoaded) return;
    let current = true;
    setInstrumentLoading(true);
    setInstrumentError("");
    const loadInstruments = async () => {
      try {
        const response = await fetch("/api/tokens", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Bitget markets could not be loaded.");
        if (current) {
          setInstrumentList(payload.instruments ?? []);
          setTokensLoaded(true);
        }
      } catch (error) {
        if (current) setInstrumentError(error instanceof Error ? error.message : "Bitget markets could not be loaded.");
      } finally {
        if (current) setInstrumentLoading(false);
      }
    };
    void loadInstruments();
    return () => { current = false; };
  }, [pickerOpen, marketSearchOpen, tokensLoaded, tokenRetry]);

  useEffect(() => {
    let current = true;
    const load = async () => {
      setMarketLoading(true);
      setMarketError("");
      setMarket(null);
      try {
        const response = await fetch(`/api/market?symbol=${symbol}&interval=${interval}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Market data could not be loaded.");
        if (current) setMarket(payload.market as MarketData);
      } catch (error) {
        if (current) setMarketError(error instanceof Error ? error.message : "Market data could not be loaded.");
      } finally {
        if (current) setMarketLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [symbol, interval, refreshCount]);

  const cashBalance = useMemo(
    () => paperCash(paperTrades, paperFeeBps, STARTING_CASH),
    [paperTrades, paperFeeBps],
  );
  const openPositions = useMemo(() => {
    const balances = new Map<string, { quantity: number; costBasis: number; entryFees: number }>();
    [...paperTrades].sort((left, right) => left.createdAt - right.createdAt).forEach((trade) => {
      const position = balances.get(trade.symbol) ?? { quantity: 0, costBasis: 0, entryFees: 0 };
      if (trade.side === "buy") {
        position.quantity += trade.quantity;
        position.costBasis += trade.quantity * trade.price;
        position.entryFees += paperFillFee(trade, paperFeeBps);
      } else if (position.quantity > 0) {
        const soldQuantity = Math.min(position.quantity, trade.quantity);
        const averageEntry = position.costBasis / position.quantity;
        position.entryFees *= 1 - soldQuantity / position.quantity;
        position.quantity -= soldQuantity;
        position.costBasis = Math.max(0, position.costBasis - averageEntry * soldQuantity);
      }
      balances.set(trade.symbol, position);
    });
    return [...balances.entries()]
      .filter(([, position]) => position.quantity > 1e-8)
      .map(([asset, position]): OpenPaperPosition => ({
        symbol: asset,
        quantity: position.quantity,
        averageEntry: position.costBasis / position.quantity,
        entryFees: position.entryFees,
      }));
  }, [paperTrades, paperFeeBps]);
  const utcDayKey = new Date().toISOString().slice(0, 10);
  const realizedStats = useMemo(() => {
    const balances = new Map<string, { quantity: number; costBasis: number }>();
    let realizedPnl = 0;
    let realizedToday = 0;
    const utcDayStart = Date.parse(`${utcDayKey}T00:00:00.000Z`);
    [...paperTrades].sort((left, right) => left.createdAt - right.createdAt).forEach((trade) => {
      const position = balances.get(trade.symbol) ?? { quantity: 0, costBasis: 0 };
      if (trade.side === "buy") {
        position.quantity += trade.quantity;
        position.costBasis += trade.quantity * trade.price + paperFillFee(trade, paperFeeBps);
      } else if (position.quantity > 0) {
        const soldQuantity = Math.min(position.quantity, trade.quantity);
        const averageEntry = position.costBasis / position.quantity;
        const pnl = (trade.price - averageEntry) * soldQuantity - paperFillFee(trade, paperFeeBps);
        realizedPnl += pnl;
        if (trade.createdAt >= utcDayStart) realizedToday += pnl;
        position.quantity -= soldQuantity;
        position.costBasis = Math.max(0, position.costBasis - averageEntry * soldQuantity);
      }
      balances.set(trade.symbol, position);
    });
    return { realizedPnl, realizedToday };
  }, [paperTrades, utcDayKey, paperFeeBps]);
  const closedPaperTrades = useMemo(() => {
    const positions = new Map<string, PaperLedgerPosition>();
    const completed: ClosedPaperTrade[] = [];
    const chronological = [...paperTrades].sort((left, right) => left.createdAt - right.createdAt);
    const fillFee = (trade: PaperTrade) => {
      const hasSavedFee = typeof trade.feeBps === "number" && Number.isFinite(trade.feeBps) && trade.feeBps >= 0;
      const feeBps = hasSavedFee ? trade.feeBps! : paperFeeBps;
      return { fee: trade.quantity * trade.price * feeBps / 10_000, assumed: !hasSavedFee };
    };

    chronological.forEach((trade) => {
      if (!(trade.quantity > 0) || !(trade.price > 0)) return;
      const fee = fillFee(trade);
      if (trade.side === "buy") {
        const position = positions.get(trade.symbol) ?? {
          quantity: 0,
          costBasis: 0,
          entryFeeBasis: 0,
          entryTimeWeight: 0,
          hasAssumedEntryFees: false,
          researchRefs: new Map<string, PaperResearchRef>(),
          backtestRefs: new Map<string, PaperBacktestRef>(),
          playbookNames: new Set<string>(),
        };
        position.quantity += trade.quantity;
        position.costBasis += trade.quantity * trade.price;
        position.entryFeeBasis += fee.fee;
        position.entryTimeWeight += trade.quantity * trade.createdAt;
        position.hasAssumedEntryFees ||= fee.assumed;
        if (trade.researchRef?.id) position.researchRefs.set(trade.researchRef.id, trade.researchRef);
        if (trade.backtestRef) {
          const key = `${trade.backtestRef.symbol}:${trade.backtestRef.interval}:${trade.backtestRef.capturedAt}`;
          position.backtestRefs.set(key, trade.backtestRef);
        }
        if (trade.playbookName) position.playbookNames.add(trade.playbookName);
        positions.set(trade.symbol, position);
        return;
      }

      const position = positions.get(trade.symbol);
      if (!position || position.quantity <= 0) return;
      const quantity = Math.min(position.quantity, trade.quantity);
      const allocation = quantity / position.quantity;
      const entryPrice = position.costBasis / position.quantity;
      const openedAt = position.entryTimeWeight / position.quantity;
      const entryFee = position.entryFeeBasis * allocation;
      const exitFee = fee.fee;
      const grossPnl = (trade.price - entryPrice) * quantity;
      const netPnl = grossPnl - entryFee - exitFee;
      const entryOutlay = entryPrice * quantity + entryFee;
      completed.push({
        id: trade.id,
        exitTradeId: trade.id,
        symbol: trade.symbol,
        quantity,
        entryPrice,
        exitPrice: trade.price,
        openedAt: Math.round(openedAt),
        closedAt: trade.createdAt,
        grossPnl,
        entryFee,
        exitFee,
        netPnl,
        returnPct: entryOutlay > 0 ? netPnl / entryOutlay * 100 : 0,
        estimatedFees: position.hasAssumedEntryFees || fee.assumed,
        researchRefs: [...position.researchRefs.values()],
        backtestRefs: [...position.backtestRefs.values()],
        playbookNames: [...position.playbookNames],
        exitNote: trade.exitNote ?? "",
      });
      position.quantity -= quantity;
      position.costBasis = Math.max(0, position.costBasis - entryPrice * quantity);
      position.entryFeeBasis = Math.max(0, position.entryFeeBasis - entryFee);
      position.entryTimeWeight = Math.max(0, position.entryTimeWeight - openedAt * quantity);
      if (position.quantity <= 1e-8) positions.delete(trade.symbol);
    });
    return completed.sort((left, right) => right.closedAt - left.closedAt);
  }, [paperTrades, paperFeeBps]);
  const paperReviewStrategies = useMemo(
    () => [...new Set(closedPaperTrades.map(tradeStrategyLabel))].sort((left, right) => left.localeCompare(right)),
    [closedPaperTrades],
  );
  const filteredPaperReviews = useMemo(() => {
    const query = paperReviewSearch.trim().toLowerCase();
    return closedPaperTrades.filter((trade) => {
      const matchesSymbol = paperReviewSymbol === "all" || trade.symbol === paperReviewSymbol;
      const matchesStrategy = paperReviewStrategy === "all" || tradeStrategyLabel(trade) === paperReviewStrategy;
      const searchText = [trade.symbol, tradeStrategyLabel(trade), trade.exitNote, ...trade.researchRefs.map((ref) => ref.question), ...trade.backtestRefs.map((ref) => ref.summary)].join(" ").toLowerCase();
      return matchesSymbol && matchesStrategy && (!query || searchText.includes(query));
    });
  }, [closedPaperTrades, paperReviewSearch, paperReviewSymbol, paperReviewStrategy]);
  const filteredPlaybooks = useMemo(() => {
    return playbooks.filter((playbook) => {
      if (playbookFilterSymbol !== "all" && playbook.symbol !== playbookFilterSymbol) return false;
      if (playbookFilterInterval !== "all" && playbook.interval !== playbookFilterInterval) return false;
      if (playbookFilterStatus === "active" && playbook.id !== activePaperPlaybookId) return false;
      if (playbookSearch.trim()) {
        const query = playbookSearch.toLowerCase();
        const matchName = playbook.name.toLowerCase().includes(query);
        const matchSymbol = playbook.symbol.toLowerCase().includes(query);
        const matchPrompt = playbook.prompt.toLowerCase().includes(query);
        if (!matchName && !matchSymbol && !matchPrompt) return false;
      }
      return true;
    });
  }, [playbooks, playbookFilterSymbol, playbookFilterInterval, playbookFilterStatus, playbookSearch, activePaperPlaybookId]);
    const exportTradesCsv = () => {
    if (!closedPaperTrades.length) return;
    const headers = ["Symbol", "Opened", "Closed", "EntryPrice", "ExitPrice", "Quantity", "GrossPnL", "EntryFee", "ExitFee", "NetPnL", "ReturnPct", "Strategy", "ExitNote"];
    const rows = closedPaperTrades.map((t) => [
      t.symbol,
      new Date(t.openedAt).toISOString(),
      new Date(t.closedAt).toISOString(),
      t.entryPrice.toFixed(4),
      t.exitPrice.toFixed(4),
      t.quantity.toFixed(6),
      t.grossPnl.toFixed(2),
      t.entryFee.toFixed(2),
      t.exitFee.toFixed(2),
      t.netPnl.toFixed(2),
      t.returnPct.toFixed(2),
      `"${tradeStrategyLabel(t).replace(/"/g, '""')}"`,
      `"${(t.exitNote || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `goriee-paper-trades-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToastMessage("Trade ledger exported as CSV.");
  };

  const paperReviewStats = useMemo(() => {
    const winners = filteredPaperReviews.filter((trade) => trade.netPnl > 0);
    const losers = filteredPaperReviews.filter((trade) => trade.netPnl < 0);
    const grossWins = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
    const grossLosses = losers.reduce((sum, trade) => sum + trade.netPnl, 0);
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    [...filteredPaperReviews].sort((left, right) => left.closedAt - right.closedAt).forEach((trade) => {
      equity += trade.netPnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.min(maxDrawdown, equity - peak);
    });
    return {
      closed: filteredPaperReviews.length,
      netPnl: filteredPaperReviews.reduce((sum, trade) => sum + trade.netPnl, 0),
      winRate: filteredPaperReviews.length ? winners.length / filteredPaperReviews.length * 100 : null,
      averageWin: winners.length ? grossWins / winners.length : null,
      averageLoss: losers.length ? grossLosses / losers.length : null,
      profitFactor: grossLosses < 0 ? grossWins / Math.abs(grossLosses) : grossWins > 0 ? Infinity : null,
      maxDrawdown: filteredPaperReviews.length ? maxDrawdown : null,
      estimatedFees: filteredPaperReviews.reduce((sum, trade) => sum + trade.entryFee + trade.exitFee, 0),
    };
  }, [filteredPaperReviews]);
  const unrealizedPnl = useMemo(() => {
    if (openPositions.some((position) => !quotes.some((quote) => quote.symbol === position.symbol))) return null;
    return openPositions.reduce((sum, position) => {
      const quote = quotes.find((entry) => entry.symbol === position.symbol);
      return sum + (quote!.price - position.averageEntry) * position.quantity - position.entryFees;
    }, 0);
  }, [openPositions, quotes]);
  const accountEquity = useMemo(() => {
    if (openPositions.some((position) => !quotes.some((quote) => quote.symbol === position.symbol))) return null;
    return cashBalance + openPositions.reduce((sum, position) => {
      const quote = quotes.find((entry) => entry.symbol === position.symbol);
      return sum + quote!.price * position.quantity;
    }, 0);
  }, [cashBalance, openPositions, quotes]);
  const dailyLossLimitReached = realizedStats.realizedToday <= -dailyLossLimit;
  useEffect(() => {
    if (!watchlistReady) return;
    const untriggeredAlertSymbols = paperAlerts.filter((alert) => alert.triggeredAt === null).map((alert) => alert.symbol);
    const quoteSymbols = [...new Set([...openPositions.map((position) => position.symbol), ...untriggeredAlertSymbols, ...watchlist])].slice(0, 50);
    if (!quoteSymbols.length) {
      setQuotes([]);
      return;
    }
    let current = true;
    const refreshQuotes = async () => {
      const params = new URLSearchParams({ symbols: quoteSymbols.join(",") });
      try {
        const response = await fetch(`/api/tickers?${params}`, { cache: "no-store" });
        const payload = await response.json();
        if (response.ok && current) {
          const asOf = typeof payload.asOf === "number" ? payload.asOf : Date.now();
          const nextQuotes = ((payload.quotes ?? []) as Quote[]).map((q) => ({
            ...q,
            asOf: typeof q.asOf === "number" ? q.asOf : asOf,
          }));
          setQuotes(nextQuotes);
        }
      } catch {
        // Keep the last quote visible if a refresh fails.
      }
    };
    void refreshQuotes();
    const timer = window.setInterval(() => void refreshQuotes(), 60_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [watchlist, watchlistReady, openPositions, paperAlerts]);
  useEffect(() => {
    if (view !== "scanner") return;
    let current = true;
    let inFlight = false;
    const refreshScanner = async () => {
      if (inFlight) return;
      inFlight = true;
      setScannerLoading(true);
      setScannerError("");
      try {
        const response = await fetch("/api/scanner", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Bitget markets could not be scanned.");
        if (current) {
          setScannerMarkets(Array.isArray(payload.markets) ? payload.markets as SpotScanMarket[] : []);
          setScannerAsOf(typeof payload.asOf === "number" ? payload.asOf : Date.now());
        }
      } catch (error) {
        if (current) setScannerError(error instanceof Error ? error.message : "Bitget markets could not be scanned.");
      } finally {
        inFlight = false;
        if (current) setScannerLoading(false);
      }
    };
    void refreshScanner();
    const timer = window.setInterval(() => void refreshScanner(), 60_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [view, scannerRefresh]);
  useEffect(() => {
    const hits = paperAlerts.filter((alert) => {
      if (alert.triggeredAt !== null) return false;
      const quote = quotes.find((entry) => entry.symbol === alert.symbol);
      return quote && (alert.direction === "above" ? quote.price >= alert.price : quote.price <= alert.price);
    });
    if (!hits.length) return;
    const hitIds = new Set(hits.map((alert) => alert.id));
    const next = paperAlerts.map((alert) => hitIds.has(alert.id) ? { ...alert, triggeredAt: Date.now() } : alert);
    setPaperAlerts(next);
    window.localStorage.setItem(storageKeys.paperAlerts, JSON.stringify(next));
    const labels = hits.slice(0, 2).map((alert) => `${alert.symbol} ${alert.direction} ${formatPrice(alert.price)}`).join(" · ");
    setPaperMessage(`Paper alert reached: ${labels}${hits.length > 2 ? ` · +${hits.length - 2} more` : ""}`);
    window.setTimeout(() => setPaperMessage(""), 6000);
  }, [paperAlerts, quotes]);

  useEffect(() => {
    if (!openPositions.length || !quotes.length) return;
    openPositions.forEach((pos) => {
      const bracket = paperBrackets[pos.symbol];
      if (!bracket) return;
      const quote = quotes.find((entry) => entry.symbol === pos.symbol);
      if (!quote || !(quote.price > 0)) return;
      const quoteAge = quote.asOf ? Date.now() - quote.asOf : Infinity;
      if (quoteAge > 120_000) return;

      if (bracket.takeProfitPrice && quote.price >= bracket.takeProfitPrice) {
        void closePaperPosition(pos.symbol, `Take-Profit hit at ${formatMoney(quote.price)} (+${bracket.takeProfitPct ?? "target"}%)`);
        return;
      }

      if (bracket.stopLossPrice && quote.price <= bracket.stopLossPrice) {
        void closePaperPosition(pos.symbol, `Stop-Loss triggered at ${formatMoney(quote.price)} (-${bracket.stopLossPct ?? "invalidation"}%)`);
        return;
      }

      if (bracket.trailingStopPct && bracket.trailingStopPct > 0) {
        const peak = Math.max(bracket.peakPrice || pos.averageEntry, quote.price);
        const trailThreshold = peak * (1 - bracket.trailingStopPct / 100);
        if (quote.price <= trailThreshold) {
          void closePaperPosition(pos.symbol, `Trailing stop hit at ${formatMoney(quote.price)} (Peak was ${formatMoney(peak)})`);
          return;
        } else if (peak > (bracket.peakPrice || 0)) {
          setPaperBrackets((prev) => {
            const next = { ...prev, [pos.symbol]: { ...bracket, peakPrice: peak } };
            window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
            return next;
          });
        }
      }
    });
  }, [openPositions, quotes, paperBrackets]);

  const selectableSymbols = useMemo(
    () => [...new Set([symbol, ...watchlist, ...openPositions.map((position) => position.symbol), ...paperAlerts.filter((alert) => alert.triggeredAt === null).map((alert) => alert.symbol)])],
    [symbol, watchlist, openPositions, paperAlerts],
  );
  const filteredInstruments = useMemo(() => {
    const query = instrumentQuery.trim().toUpperCase();
    const matches = query
      ? instrumentList.filter((instrument) =>
          `${instrument.symbol} ${instrument.baseCoin} ${instrument.quoteCoin}`.toUpperCase().includes(query),
        )
      : instrumentList;
    return matches.slice(0, 80);
  }, [instrumentList, instrumentQuery]);
  const scannerMatches = useMemo(() => {
    const query = scannerQuery.trim().toUpperCase();
    const matches = scannerMarkets.filter((item) => {
      const matchesQuery = !query || `${item.baseCoin} ${item.symbol}`.toUpperCase().includes(query);
      const matchesAssetType = scannerAssetType === "all" || (scannerAssetType === "rwa" ? item.isRwa : !item.isRwa);
      return matchesQuery && matchesAssetType && item.turnover24h >= scannerMinTurnover;
    });
    return matches.sort((left, right) => {
      if (scannerSort === "gainers") return right.change24h - left.change24h;
      if (scannerSort === "decliners") return left.change24h - right.change24h;
      return right.turnover24h - left.turnover24h;
    });
  }, [scannerMarkets, scannerQuery, scannerAssetType, scannerMinTurnover, scannerSort]);
  const scannerResults = scannerMatches.slice(0, 60);
  const filteredJournal = useMemo(() => {
    const query = journalQuery.trim().toLowerCase();
    if (!query) return journal;
    return journal.filter((item) => `${item.symbol} ${item.question} ${item.summary}`.toLowerCase().includes(query));
  }, [journal, journalQuery]);
  const activeJournalPreview = useMemo(() => {
    const activeList = journalTokenFilter === "ALL"
      ? filteredJournal
      : filteredJournal.filter((item) => item.symbol === journalTokenFilter);
    if (previewJournalId) {
      const found = activeList.find((item) => item.id === previewJournalId);
      if (found) return found;
    }
    return activeList[0] ?? null;
  }, [previewJournalId, filteredJournal, journalTokenFilter]);

  const journalTokenCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    journal.forEach((item) => {
      counts[item.symbol] = (counts[item.symbol] || 0) + 1;
    });
    return counts;
  }, [journal]);

  const journalClusters = useMemo(() => {
    const list = journalTokenFilter === "ALL"
      ? filteredJournal
      : filteredJournal.filter((item) => item.symbol === journalTokenFilter);

    const map: Record<string, JournalItem[]> = {};
    list.forEach((item) => {
      if (!map[item.symbol]) map[item.symbol] = [];
      map[item.symbol].push(item);
    });

    return Object.entries(map).map(([sym, items]) => ({
      symbol: sym,
      items,
      count: items.length,
      latestItem: items[0],
    }));
  }, [filteredJournal, journalTokenFilter]);

  const toggleJournalCluster = (symbolName: string) => {
    setCollapsedJournalClusters((prev) => ({
      ...prev,
      [symbolName]: !prev[symbolName],
    }));
  };

  const journalDominantRegime = useMemo(() => {
    if (!journal.length) return "None recorded";
    const counts: Record<string, number> = {};
    journal.forEach((j) => {
      counts[j.regime] = (counts[j.regime] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return entries[0] ? entries[0][0] : "Mixed";
  }, [journal]);

  useEffect(() => {
    if (!selectedJournalItem && !orderOpen && !pickerOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (orderOpen) setOrderOpen(false);
        if (pickerOpen) setPickerOpen(false);
        if (selectedJournalItem) setSelectedJournalItem(null);
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    if (selectedJournalItem) journalCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [selectedJournalItem, orderOpen, pickerOpen]);

  function addToWatchlist(asset: string) {
    if (watchlist.includes(asset)) return;
    if (watchlist.length >= 50) {
      setPaperMessage("Your watchlist is full (50 markets). Remove one before adding another.");
      window.setTimeout(() => setPaperMessage(""), 3500);
      return;
    }
    const next = [asset, ...watchlist];
    setWatchlist(next);
    window.localStorage.setItem(storageKeys.watchlist, JSON.stringify(next));
    setPaperMessage(`${asset} added to your watchlist.`);
    window.setTimeout(() => setPaperMessage(""), 2500);
  }

  function selectMarket(asset: string) {
    setSymbol(asset);
    setInstrumentQuery("");
    setMarketSearchOpen(false);
    setPickerOpen(false);
  }

  function removeFromWatchlist(asset: string) {
    const next = watchlist.filter((entry) => entry !== asset);
    setWatchlist(next);
    window.localStorage.setItem(storageKeys.watchlist, JSON.stringify(next));
  }

  function addPaperAlert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = Number(alertPrice);
    if (!Number.isFinite(target) || target <= 0) return;
    if (paperAlerts.filter((alert) => alert.triggeredAt === null).length >= 50) {
      setPaperMessage("You can have up to 50 active paper alerts.");
      return;
    }
    const alert: PaperAlert = {
      id: crypto.randomUUID(),
      symbol: alertSymbol,
      purpose: alertPurpose,
      direction: alertDirection,
      price: target,
      createdAt: Date.now(),
      triggeredAt: null,
    };
    const next = [alert, ...paperAlerts];
    setPaperAlerts(next);
    window.localStorage.setItem(storageKeys.paperAlerts, JSON.stringify(next));
    setAlertPrice("");
    setPaperMessage(`${alert.symbol} ${alert.direction} ${formatPrice(alert.price)} alert added.`);
    window.setTimeout(() => setPaperMessage(""), 3500);
  }

  function removePaperAlert(id: string) {
    const next = paperAlerts.filter((alert) => alert.id !== id);
    setPaperAlerts(next);
    window.localStorage.setItem(storageKeys.paperAlerts, JSON.stringify(next));
  }

  function saveCurrentPlaybook() {
    const name = playbookName.trim();
    if (name.length < 2) {
      setPlaybookMessage("Give this playbook a name first.");
      return;
    }
    const item: StrategyPlaybook = {
      id: crypto.randomUUID(),
      name: name.slice(0, 48),
      symbol,
      interval,
      prompt: strategyPrompt.trim(),
      lookbackDays: backtestDays,
      feeBps,
      slippageBps,
      createdAt: Date.now(),
    };
    const next = [item, ...playbooks].slice(0, 30);
    setPlaybooks(next);
    window.localStorage.setItem(storageKeys.playbooks, JSON.stringify(next));
    setPlaybookName("");
    setPlaybookMessage(`“${item.name}” saved to your Playbooks library.`);
    window.setTimeout(() => setPlaybookMessage(""), 3500);
  }

  function deletePlaybook(id: string) {
    const next = playbooks.filter((playbook) => playbook.id !== id);
    setPlaybooks(next);
    window.localStorage.setItem(storageKeys.playbooks, JSON.stringify(next));
    if (activePaperPlaybookId === id) {
      setActivePaperPlaybookId("");
      window.localStorage.removeItem(storageKeys.activePlaybook);
    }
  }

  function loadPlaybook(playbook: StrategyPlaybook) {
    setSymbol(playbook.symbol);
    setInterval(playbook.interval);
    setStrategyPrompt(playbook.prompt);
    setBacktestDays(playbook.lookbackDays);
    setFeeBps(playbook.feeBps);
    setSlippageBps(playbook.slippageBps);
    setPlaybookMessage(`Loaded “${playbook.name}” into the strategy lab.`);
    window.setTimeout(() => setPlaybookMessage(""), 3500);
  }

  function usePlaybookInPaper(playbook: StrategyPlaybook) {
    setSymbol(playbook.symbol);
    setInterval(playbook.interval);
    setActivePaperPlaybookId(playbook.id);
    window.localStorage.setItem(storageKeys.activePlaybook, playbook.id);
    setPaperTab("account");
    setView("paper");
    setPaperMessage(`“${playbook.name}” is now active in your Paper Desk. Simulated fills on ${playbook.symbol} will be tagged with this playbook.`);
    window.setTimeout(() => setPaperMessage(""), 5000);
  }

  function deactivatePlaybookFromPaper(playbook: StrategyPlaybook) {
    if (activePaperPlaybookId === playbook.id) {
      setActivePaperPlaybookId("");
      window.localStorage.removeItem(storageKeys.activePlaybook);
      setPlaybookMessage(`Unpinned “${playbook.name}” from paper trading.`);
      window.setTimeout(() => setPlaybookMessage(""), 3500);
    }
  }

  function cancelResearch() {
    if (researchAbortRef.current) {
      researchAbortRef.current.abort();
      researchAbortRef.current = null;
    }
    requestBusy.current = false;
    setResearchLoading(false);
    setToastMessage("Research agent stopped.");
  }

  async function submitResearch(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (requestBusy.current || Date.now() < aiRetryAt) return;
    requestBusy.current = true;
    setResearchLoading(true);
    setResearchError("");

    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;

    try {
      const prompt = question.trim() || `Analyze ${symbol} on the ${interval} timeframe.`;
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ question: prompt, symbol, interval, includeWebResearch }),
      });
      const payload = await response.json().catch(() => { throw new Error("The server returned an unreadable response. Your prompt is saved; try again."); });
      if (!response.ok) {
        if (typeof payload.retryAt === "number") setAiRetryAt(payload.retryAt);
        throw new Error(payload.error ?? "Research could not be completed.");
      }
      const nextReport = payload.report as Report;
      setReport(nextReport);
      setQuestion(prompt);
      const item: JournalItem = {
        id: nextReport.id,
        question: nextReport.question,
        symbol: nextReport.symbol,
        interval: nextReport.interval,
        summary: nextReport.summary,
        regime: nextReport.indicators.regime,
        price: nextReport.market.price,
        createdAt: nextReport.createdAt,
        marketSnapshot: {
          change24h: nextReport.market.change24h,
          high24h: nextReport.market.high24h,
          low24h: nextReport.market.low24h,
          volume24h: nextReport.market.volume24h,
          turnover24h: nextReport.market.turnover24h,
          asOf: nextReport.market.asOf,
        },
        indicators: nextReport.indicators,
        bullCase: nextReport.bullCase,
        bearCase: nextReport.bearCase,
        invalidation: nextReport.invalidation,
        engine: nextReport.engine,
        commentary: nextReport.commentary,
        newsContext: nextReport.newsContext,
        sources: nextReport.sources,
        webResearchIncluded: nextReport.webResearchIncluded,
      };
      setJournal((previous) => {
        const next = [item, ...previous.filter((entry) => entry.id !== item.id)].slice(0, 30);
        window.localStorage.setItem(storageKeys.journal, JSON.stringify(next));
        return next;
      });
      setView("research");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setResearchError(error instanceof Error ? error.message : "Research could not be completed.");
    } finally {
      researchAbortRef.current = null;
      requestBusy.current = false;
      setResearchLoading(false);
    }
  }

  function cancelBacktest() {
    if (backtestAbortRef.current) {
      backtestAbortRef.current.abort();
      backtestAbortRef.current = null;
    }
    requestBusy.current = false;
    setBacktestLoading(false);
    setToastMessage("Backtest simulation stopped.");
  }

  async function runBacktest(playbook?: StrategyPlaybook, overrides?: { symbol?: string; interval?: string; prompt?: string; lookbackDays?: number; researchRef?: { id: string; question: string } }) {
    if (requestBusy.current || Date.now() < aiRetryAt) return;
    requestBusy.current = true;
    setBacktestLoading(true);
    setBacktestError("");
    setBacktest(null);

    backtestAbortRef.current?.abort();
    const controller = new AbortController();
    backtestAbortRef.current = controller;

    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbol: overrides?.symbol ?? playbook?.symbol ?? symbol,
          interval: overrides?.interval ?? playbook?.interval ?? interval,
          strategyPrompt: overrides?.prompt ?? playbook?.prompt ?? strategyPrompt,
          lookbackDays: overrides?.lookbackDays ?? playbook?.lookbackDays ?? backtestDays,
          feeBps: playbook?.feeBps ?? feeBps,
          slippageBps: playbook?.slippageBps ?? slippageBps,
        }),
      });
      const payload = await response.json().catch(() => { throw new Error("The server returned an unreadable response. Your strategy is saved; try again."); });
      if (!response.ok) {
        if (typeof payload.retryAt === "number") setAiRetryAt(payload.retryAt);
        throw new Error(payload.error ?? "Backtest could not be completed.");
      }
      const requestSymbol = overrides?.symbol ?? playbook?.symbol ?? symbol;
      const requestInterval = overrides?.interval ?? playbook?.interval ?? interval;
      const seededMatchesRequest = seededResearchReport
        && seededResearchReport.symbol === requestSymbol
        && seededResearchReport.interval === requestInterval;
      const researchRef = overrides?.researchRef
        ?? (seededMatchesRequest ? { id: seededResearchReport.id, question: seededResearchReport.question } : undefined)
        ?? playbook?.researchRef;
      setBacktest({ ...payload.result, ...(researchRef ? { researchRef } : {}) } as BacktestResult);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setBacktestError(error instanceof Error ? error.message : "Backtest could not be completed.");
    } finally {
      backtestAbortRef.current = null;
      requestBusy.current = false;
      setBacktestLoading(false);
    }
  }

  function handleBacktestFromReport(targetReport: Report) {
    const symbolToUse = targetReport.symbol;
    const intervalToUse = targetReport.interval;
    const promptToUse = generateBacktestPromptFromResearch(targetReport);

    setSymbol(symbolToUse);
    setInterval(intervalToUse);
    setStrategyPrompt(promptToUse);
    setSeededResearchReport(targetReport);
    setToastMessage(`Custom backtest hypothesis loaded from ${targetReport.symbol} research brief.`);
    setView("backtests");
    void runBacktest(undefined, {
      symbol: symbolToUse,
      interval: intervalToUse,
      prompt: promptToUse,
      lookbackDays: supportsBacktestWindow(intervalToUse, backtestDays) ? backtestDays : intervalToUse === "1D" ? 90 : 30,
      researchRef: { id: targetReport.id, question: targetReport.question },
    });
  }

  function paperFromBacktest() {
    if (!backtest) return;
    const plan = backtest.strategy;
    const prompt = plan.kind === "ema_cross"
      ? `Go long when the ${plan.fastPeriod}-period EMA crosses above the ${plan.slowPeriod}-period EMA. Exit when the ${plan.fastPeriod} EMA crosses below the ${plan.slowPeriod} EMA.`
      : `Buy when RSI (${plan.rsiPeriod}) is below ${plan.entryBelow}. Exit when RSI (${plan.rsiPeriod}) is above ${plan.exitAbove}.`;
    const playbook: StrategyPlaybook = {
      id: crypto.randomUUID(), name: `${backtest.symbol} ${plan.kind === "ema_cross" ? "EMA" : "RSI"} study`,
      symbol: backtest.symbol, interval: backtest.interval, prompt, lookbackDays: backtest.lookbackDays,
      feeBps: backtest.feePctPerFill * 100, slippageBps: backtest.slippageBps, createdAt: Date.now(),
      researchRef: backtest.researchRef,
      backtestRef: { symbol: backtest.symbol, interval: backtest.interval, summary: plan.summary, returnPct: backtest.returnPct, capturedAt: Date.now() },
    };
    if (playbooks.length >= 30) { setBacktestError("Your Playbook library is full. Remove one before saving this study to Paper."); return; }
    const next = [playbook, ...playbooks];
    window.localStorage.setItem(storageKeys.playbooks, JSON.stringify(next));
    setPlaybooks(next);
    setPaperFeeBps(playbook.feeBps);
    window.localStorage.setItem(storageKeys.paperFee, JSON.stringify(playbook.feeBps));
    usePlaybookInPaper(playbook);
    setPaperTab("account");
    setPaperMessage("Backtest saved to a playbook. Its research and result will follow your paper buys into Trade Review. Review the order before recording it.");
  }

  function placePaperOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!market || closingAssets.current.size || !Number.isFinite(Number(orderAmount)) || Number(orderAmount) <= 0) return;
    if (market.symbol !== symbol || Date.now() - market.asOf > 120_000) {
      setPaperMessage("Refresh the market quote before recording this order (maximum age: two minutes).");
      return;
    }
    const notional = Number(orderAmount);
    const quantity = notional / market.price;
    if (orderSide === "buy" && notional * (1 + paperFeeBps / 10_000) > cashBalance + 1e-8) {
      setPaperMessage("The virtual cash balance is too low for that order.");
      return;
    }
    if (orderSide === "buy" && dailyLossLimitReached) {
      setPaperMessage(`New paper buys are paused: realized P&L today has reached your ${formatMoney(dailyLossLimit)} daily loss limit. You can still sell or close positions.`);
      return;
    }
    if (orderSide === "sell") {
      const held = openPositions.find((position) => position.symbol === symbol)?.quantity ?? 0;
      if (quantity > held) {
        setPaperMessage(`Your paper account holds ${held.toFixed(6)} ${symbol.replace("USDT", "")} to sell.`);
        return;
      }
      if (quantity >= held - 1e-8) {
        setPaperBrackets((previous) => {
          if (!previous[symbol]) return previous;
          const next = { ...previous };
          delete next[symbol];
          window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
          return next;
        });
      }
    }
    const sourcePlaybook = playbooks.find((item) => item.id === activePaperPlaybookId);
    const trade: PaperTrade = {
      id: crypto.randomUUID(),
      symbol,
      side: orderSide,
      quantity,
      price: market.price,
      createdAt: Date.now(),
      feeBps: paperFeeBps,
      ...(orderSide === "buy" && sourcePlaybook?.symbol === symbol && sourcePlaybook.researchRef
        ? { researchRef: sourcePlaybook.researchRef }
        : orderSide === "buy" && report?.symbol === symbol && report.interval === interval
        ? { researchRef: { id: report.id, question: report.question } }
        : {}),
      ...(orderSide === "buy" && sourcePlaybook?.symbol === symbol && sourcePlaybook.backtestRef
        ? { backtestRef: sourcePlaybook.backtestRef }
        : orderSide === "buy" && backtest?.symbol === symbol
        ? { backtestRef: { symbol: backtest.symbol, interval: backtest.interval, summary: backtest.strategy.summary, returnPct: backtest.returnPct, capturedAt: Date.now() } }
        : {}),
      ...(orderSide === "buy" && sourcePlaybook?.symbol === symbol
        ? { playbookName: sourcePlaybook.name }
        : {}),
    };
    if (orderSide === "buy" && attachBracket && market) {
      const tpPct = Number(takeProfitPct) || 0;
      const slPct = Number(stopLossPct) || 0;
      const trPct = Number(trailingStopPct) || 0;
      const tpPrice = tpPct > 0 ? market.price * (1 + tpPct / 100) : undefined;
      const slPrice = slPct > 0 ? market.price * (1 - slPct / 100) : undefined;

      const bracket: PaperBracket = {
        symbol,
        takeProfitPrice: tpPrice,
        takeProfitPct: tpPct > 0 ? tpPct : undefined,
        stopLossPrice: slPrice,
        stopLossPct: slPct > 0 ? slPct : undefined,
        trailingStopPct: trPct > 0 ? trPct : undefined,
        peakPrice: market.price,
        createdAt: Date.now(),
      };

      setPaperBrackets((previous) => {
        const next = { ...previous, [symbol]: bracket };
        window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
        return next;
      });
    } else if (orderSide === "buy" && !attachBracket) {
      setPaperBrackets((previous) => {
        if (!previous[symbol]) return previous;
        const next = { ...previous };
        delete next[symbol];
        window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
        return next;
      });
    }

    setPaperTrades((previous) => {
      const next = [trade, ...previous];
      window.localStorage.setItem(storageKeys.paper, JSON.stringify(next));
      return next;
    });
    setOrderOpen(false);
    setPaperMessage(`${orderSide === "buy" ? "Buy" : "Sell"} recorded in your paper account.`);
    window.setTimeout(() => setPaperMessage(""), 3500);
  }

  async function closePaperPosition(asset: string, customExitNote?: string) {
    if (closingAssets.current.has(asset)) return;
    const position = openPositions.find((entry) => entry.symbol === asset);
    if (!position) {
      setPaperMessage(`There is no open ${asset} position to close.`);
      return;
    }

    closingAssets.current.add(asset);
    setClosingSymbol(asset);
    setPaperMessage("");
    try {
      const params = new URLSearchParams({ symbols: asset });
      const response = await fetch(`/api/tickers?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "A fresh Bitget quote is unavailable.");
      const quote = (payload.quotes as Quote[] | undefined)?.find((entry) => entry.symbol === asset);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
        throw new Error(`Bitget did not return a usable ${asset} quote.`);
      }

      const trade: PaperTrade = {
        id: crypto.randomUUID(),
        symbol: asset,
        side: "sell",
        quantity: position.quantity,
        price: quote.price,
        createdAt: Date.now(),
        feeBps: paperFeeBps,
        exitNote: customExitNote,
      };
      setPaperTrades((previous) => {
        const next = [trade, ...previous];
        window.localStorage.setItem(storageKeys.paper, JSON.stringify(next));
        return next;
      });
      setPaperBrackets((previous) => {
        if (!previous[asset]) return previous;
        const next = { ...previous };
        delete next[asset];
        window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
        return next;
      });
      const grossPnl = (quote.price - position.averageEntry) * position.quantity;
      const netPnl = grossPnl - position.entryFees - paperFillFee(trade, paperFeeBps);
      setPaperMessage(`${asset} paper position closed at ${formatMoney(quote.price)} · net P&L ${formatMoney(netPnl)} after estimated fees.`);
      window.setTimeout(() => setPaperMessage(""), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The paper position could not be closed.";
      setPaperMessage(`Could not close ${asset}: ${message}`);
      window.setTimeout(() => setPaperMessage(""), 5000);
    } finally {
      closingAssets.current.delete(asset);
      setClosingSymbol(closingAssets.current.values().next().value ?? null);
    }
  }

  function updatePaperExitNote(tradeId: string, note: string) {
    setPaperTrades((previous) => {
      const next = previous.map((trade) => trade.id === tradeId ? { ...trade, exitNote: note } : trade);
      window.localStorage.setItem(storageKeys.paper, JSON.stringify(next));
      return next;
    });
  }

  // WebSocket Live Ticker Integration
  const handleWsTick = useCallback((tick: WsTickerTick) => {
    setMarket((prev) => {
      if (!prev || prev.symbol !== tick.symbol) return prev;
      const oldPrice = prev.price;
      const newPrice = tick.price;
      if (newPrice !== oldPrice) {
        setPriceFlash(newPrice > oldPrice ? "up" : "down");
        window.setTimeout(() => setPriceFlash(null), 700);
      }
      return {
        ...prev,
        price: newPrice,
        change24h: tick.change24h !== undefined ? tick.change24h : prev.change24h,
        high24h: tick.high24h !== undefined ? tick.high24h : prev.high24h,
        low24h: tick.low24h !== undefined ? tick.low24h : prev.low24h,
        volume24h: tick.volume24h !== undefined ? tick.volume24h : prev.volume24h,
        asOf: tick.ts,
      };
    });
  }, []);

  const { status: wsStatus } = useBitgetTickerWs({
    symbol,
    enabled: true,
    onTick: handleWsTick,
  });

  const activePaperPlaybook = playbooks.find((playbook) => playbook.id === activePaperPlaybookId) ?? null;

  // Automated Paper Trading Rule Runner Engine
  const runRuleEvaluation = useCallback(async () => {
    if (ruleRunnerEvaluating) return;
    const targetPlaybook = (ruleRunnerPlaybookId
      ? playbooks.find((p) => p.id === ruleRunnerPlaybookId)
      : null) ?? activePaperPlaybook ?? playbooks[0] ?? STARTER_PLAYBOOKS[0];

    if (!targetPlaybook) return;

    setRuleRunnerEvaluating(true);
    try {
      const res = await fetch(`/api/market?symbol=${targetPlaybook.symbol}&interval=${targetPlaybook.interval}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.market?.candles) throw new Error(data.error || "Market data unavailable");

      const marketCandles = data.market.candles as Candle[];
      const evaluation = evaluatePlaybookRule(targetPlaybook.prompt, marketCandles);
      const currentPrice = data.market.price as number;

      const position = openPositions.find((p) => p.symbol === targetPlaybook.symbol);

      let actionTaken: "buy" | "sell" | "hold" = "hold";
      let logMsg = "";

      if (evaluation.action === "buy") {
        if (position && position.quantity > 0) {
          actionTaken = "hold";
          logMsg = `Buy trigger active (${evaluation.reason}), but ${targetPlaybook.symbol} position is already open. Holding.`;
        } else if (cashBalance < 50) {
          actionTaken = "hold";
          logMsg = `Buy trigger active (${evaluation.reason}), but insufficient virtual cash ($${cashBalance.toFixed(2)}).`;
        } else {
          const allocUsd = Math.max(50, Math.min(cashBalance * 0.1, 1000));
          const quantity = allocUsd / currentPrice;
          const trade: PaperTrade = {
            id: crypto.randomUUID(),
            symbol: targetPlaybook.symbol,
            side: "buy",
            quantity,
            price: currentPrice,
            createdAt: Date.now(),
            feeBps: targetPlaybook.feeBps || paperFeeBps,
            playbookName: `${targetPlaybook.name} [Auto-Fill]`,
          };
          setPaperBrackets((previous) => {
            if (!previous[targetPlaybook.symbol]) return previous;
            const next = { ...previous };
            delete next[targetPlaybook.symbol];
            window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
            return next;
          });
          setPaperTrades((prev) => {
            const next = [trade, ...prev];
            window.localStorage.setItem(storageKeys.paper, JSON.stringify(next));
            return next;
          });
          actionTaken = "buy";
          logMsg = `Rule Engine Fill: Bought ${quantity.toFixed(4)} ${targetPlaybook.symbol} at ${formatMoney(currentPrice)} (${evaluation.reason})`;
          setPaperMessage(logMsg);
        }
      } else if (evaluation.action === "sell") {
        if (position && position.quantity > 0) {
          void closePaperPosition(targetPlaybook.symbol, `Rule Engine Exit: ${evaluation.reason}`);
          actionTaken = "sell";
          logMsg = `Rule Engine Exit: Closed ${position.quantity.toFixed(4)} ${targetPlaybook.symbol} at ${formatMoney(currentPrice)} (${evaluation.reason})`;
        } else {
          actionTaken = "hold";
          logMsg = `Exit trigger active (${evaluation.reason}), but no open ${targetPlaybook.symbol} position.`;
        }
      } else {
        actionTaken = "hold";
        logMsg = `Hold: ${evaluation.reason} (${evaluation.metricSummary})`;
      }

      const newLog = {
        id: crypto.randomUUID(),
        time: Date.now(),
        symbol: targetPlaybook.symbol,
        action: actionTaken,
        message: logMsg,
      };

      setRuleRunnerLogs((prev) => {
        const next = [newLog, ...prev].slice(0, 15);
        window.localStorage.setItem(storageKeys.ruleRunnerLogs, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      console.warn("Rule runner evaluation error:", err);
    } finally {
      setRuleRunnerEvaluating(false);
    }
  }, [
    ruleRunnerEvaluating,
    ruleRunnerPlaybookId,
    playbooks,
    activePaperPlaybook,
    openPositions,
    cashBalance,
    paperFeeBps,
  ]);

  useEffect(() => {
    if (!ruleRunnerActive) return;
    const intervalId = window.setInterval(() => {
      void runRuleEvaluation();
    }, 45_000);
    return () => window.clearInterval(intervalId);
  }, [ruleRunnerActive, runRuleEvaluation]);

  // Snapshot Card Exporters
  const openResearchCardModal = () => {
    if (!report) return;
    const exportCard: CardExportData = {
      title: report.question,
      symbol: report.symbol,
      interval: report.interval,
      regime: report.indicators.regime,
      price: report.market.price,
      rsi: report.indicators.rsi14,
      ema20: report.indicators.ema20,
      ema50: report.indicators.ema50,
      support: report.indicators.support,
      resistance: report.indicators.resistance,
      summary: report.summary,
      bullCase: report.bullCase,
      bearCase: report.bearCase,
      invalidation: report.invalidation,
      engine: report.engine,
      asOf: report.createdAt,
    };
    setCardExportData(exportCard);
    setCardModalOpen(true);
  };

  const openBacktestCardModal = () => {
    if (!backtest) return;
    const strategy = backtest.strategy;
    const exitRuleDesc = strategy.kind === "ema_cross"
      ? `EMA ${strategy.fastPeriod} crosses below EMA ${strategy.slowPeriod}`
      : `RSI crosses above ${strategy.exitAbove}`;
    const exportCard: CardExportData = {
      title: `Backtest: ${strategy.summary}`,
      symbol: backtest.symbol,
      interval: backtest.interval,
      regime: `${backtest.returnPct >= 0 ? "Profitable" : "Drawdown"} Simulation`,
      summary: strategy.summary,
      bullCase: strategy.rationale,
      bearCase: `Max Drawdown: ${backtest.maxDrawdownPct.toFixed(1)}% across ${backtest.closedTrades} closed simulation trades.`,
      invalidation: `Exit condition: ${exitRuleDesc}`,
      engine: backtest.model,
      asOf: Date.now(),
      backtestReturnPct: backtest.returnPct,
      backtestWinRate: backtest.winRatePct,
      backtestProfitFactor: backtest.sharpeRatio,
      backtestMaxDrawdown: backtest.maxDrawdownPct,
    };
    setCardExportData(exportCard);
    setCardModalOpen(true);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  // Current visible replay candle
  const currentReplayCandle = useMemo(() => {
    if (!market || !market.candles || market.candles.length === 0) return null;
    const clamped = Math.max(0, Math.min(market.candles.length - 1, replayIndex));
    return market.candles[clamped] ?? null;
  }, [market, replayIndex]);

  const handleRewindBars = useCallback((barsBack: number) => {
    if (!market) return;
    setReplayIndex((prev) => Math.max(0, prev - barsBack));
    setIsReplayPlaying(false);
    setIsCutMode(false);
  }, [market]);

  const handleStepForward = useCallback(() => {
    if (!market) return;
    setReplayIndex((prev) => {
      if (prev >= market.candles.length - 1) return prev;
      const nextIdx = prev + 1;
      const nextCandle = market.candles[nextIdx];
      if (nextCandle) {
        setReplayWallet((w) => {
          const res = advanceReplayCandle(w, nextCandle);
          if (res.event) {
            setToastMessage(`Bracket triggered: ${res.event.reason === "take_profit" ? "Take Profit" : "Stop Loss"} (${res.event.pnl >= 0 ? "+" : ""}$${res.event.pnl.toFixed(2)})`);
          }
          return res.wallet;
        });
      }
      return nextIdx;
    });
  }, [market]);

  const handleScrubIndex = useCallback((index: number) => {
    if (!market) return;
    const clamped = Math.max(0, Math.min(market.candles.length - 1, index));
    setReplayIndex(clamped);
    setIsReplayPlaying(false);
    setIsCutMode(false);
  }, [market]);

  const handleReplayQuickBuy = useCallback((amountUsd = 250) => {
    if (!currentReplayCandle) return;
    setReplayWallet((w) =>
      executeReplayOrder(w, currentReplayCandle, symbol, "buy", amountUsd)
    );
    setToastMessage(`Replay BUY: Filled $${amountUsd} @ $${currentReplayCandle.close.toFixed(2)}`);
  }, [currentReplayCandle, symbol]);

  const handleReplayQuickSell = useCallback((amountUsd = 250) => {
    if (!currentReplayCandle) return;
    setReplayWallet((w) =>
      executeReplayOrder(w, currentReplayCandle, symbol, "sell", amountUsd)
    );
    setToastMessage(`Replay SELL: Filled $${amountUsd} @ $${currentReplayCandle.close.toFixed(2)}`);
  }, [currentReplayCandle, symbol]);

  const handleExecuteTicketOrder = useCallback(() => {
    if (!currentReplayCandle) return;
    const amountUsd = replayTicketAmount;
    if (amountUsd <= 0) {
      setToastMessage("Please enter a valid order size in USD.");
      return;
    }
    if (amountUsd > replayWallet.cash) {
      setToastMessage(`Insufficient replay cash balance ($${replayWallet.cash.toFixed(2)} available).`);
      return;
    }
    setReplayWallet((w) =>
      executeReplayOrder(
        w,
        currentReplayCandle,
        symbol,
        replayTicketSide,
        amountUsd,
        replayTicketTpPct,
        replayTicketSlPct
      )
    );
    setToastMessage(
      `Replay ${replayTicketSide.toUpperCase()}: Filled $${amountUsd} @ $${currentReplayCandle.close.toFixed(2)} (TP: +${replayTicketTpPct}%, SL: -${replayTicketSlPct}%)`
    );
  }, [currentReplayCandle, replayTicketAmount, replayWallet.cash, symbol, replayTicketSide, replayTicketTpPct, replayTicketSlPct]);

  const handleReplayClosePosition = useCallback(() => {
    if (!currentReplayCandle || !replayWallet.position) return;
    setReplayWallet((w) =>
      closeReplayPosition(w, currentReplayCandle.close, currentReplayCandle.time, "manual")
    );
    setToastMessage("Replay: Position closed at market price.");
  }, [currentReplayCandle, replayWallet.position]);

  const handleExitReplayClick = useCallback(() => {
    setIsReplayPlaying(false);
    setScorecardModalOpen(true);
  }, []);

  const handleRestartReplay = useCallback(() => {
    if (!market) return;
    setReplayWallet(createInitialReplayWallet());
    setReplayTargetTrade(null);
    const rewindStart = Math.max(0, market.candles.length - 25);
    setReplayIndex(rewindStart);
    setIsReplayPlaying(false);
    setIsCutMode(false);
    setScorecardModalOpen(false);
    setToastMessage("Replay session restarted with fresh $10,000 cash balance.");
  }, [market]);

  const handleCloseScorecard = useCallback(() => {
    setScorecardModalOpen(false);
    setIsReplayPlaying(false);
    setIsCutMode(false);
    if (replayTargetTrade) {
      const origin = replayTargetTrade.origin;
      setReplayTargetTrade(null);
      if (origin === "paper") {
        setPaperTab("review");
        setView("paper");
      } else {
        setView("backtests");
      }
    }
  }, [replayTargetTrade]);

  const handleExitTradeReview = useCallback(() => {
    setIsReplayPlaying(false);
    const origin = replayTargetTrade?.origin ?? "paper";
    setReplayTargetTrade(null);
    if (origin === "paper") {
      setPaperTab("review");
      setView("paper");
    } else {
      setView("backtests");
    }
  }, [replayTargetTrade]);

  const handleJumpToSetup = useCallback(() => {
    if (!market || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < market.candles.length; i++) {
      const diff = Math.abs(market.candles[i].time - replayTargetTrade.openedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    const setupIdx = Math.max(0, closestIdx - 25);
    setReplayIndex(setupIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to setup window (25 bars prior to entry)");
  }, [market, replayTargetTrade]);

  const handleJumpToEntry = useCallback(() => {
    if (!market || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < market.candles.length; i++) {
      const diff = Math.abs(market.candles[i].time - replayTargetTrade.openedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setReplayIndex(closestIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to trade entry bar");
  }, [market, replayTargetTrade]);

  const handleJumpToExit = useCallback(() => {
    if (!market || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < market.candles.length; i++) {
      const diff = Math.abs(market.candles[i].time - replayTargetTrade.closedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setReplayIndex(closestIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to trade exit bar");
  }, [market, replayTargetTrade]);

  const replayFromPaperTrade = useCallback((trade: ClosedPaperTrade) => {
    const target: ReplayTargetTrade = {
      id: trade.id,
      symbol: trade.symbol,
      interval: interval,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      quantity: trade.quantity,
      netPnl: trade.netPnl,
      returnPct: trade.returnPct,
      side: "buy",
      origin: "paper",
      strategyLabel: tradeStrategyLabel(trade),
    };
    setReplayTargetTrade(target);
    if (symbol !== trade.symbol) {
      setSymbol(trade.symbol);
    }
    setIsReplayPlaying(false);
    setView("replay");
    setToastMessage(`Loaded paper trade review for ${trade.symbol}`);
  }, [interval, symbol]);

  const replayFromBacktestTrade = useCallback((trade: CompletedTrade, testSymbol: string, testInterval: string, strategyPromptText?: string) => {
    const target: ReplayTargetTrade = {
      id: `backtest-${trade.entryAt}-${trade.exitAt}`,
      symbol: testSymbol,
      interval: testInterval,
      openedAt: trade.entryAt,
      closedAt: trade.exitAt,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      netPnl: trade.pnl,
      returnPct: trade.returnPct,
      side: "buy",
      origin: "backtests",
      strategyLabel: strategyPromptText ? (strategyPromptText.length > 50 ? strategyPromptText.slice(0, 48) + "…" : strategyPromptText) : "Quantitative Backtest Rule",
    };
    setReplayTargetTrade(target);
    if (symbol !== testSymbol) {
      setSymbol(testSymbol);
    }
    if (interval !== testInterval) {
      setInterval(testInterval);
    }
    setIsReplayPlaying(false);
    setView("replay");
    setToastMessage(`Loaded backtest trade replay for ${testSymbol} ${testInterval}`);
  }, [symbol, interval]);

  const replayScorecard = useMemo(() => {
    const currentPrice = currentReplayCandle?.close ?? 0;
    return calculateReplayScorecard(replayWallet, currentPrice);
  }, [replayWallet, currentReplayCandle]);

  const handleUpdateReplayTpPrice = useCallback((newPrice: number) => {
    if (replayWallet.position) {
      const pos = replayWallet.position;
      const isLong = pos.side === "buy";
      if ((isLong && newPrice > pos.entryPrice) || (!isLong && newPrice < pos.entryPrice)) {
        setReplayWallet((w) =>
          w.position ? { ...w, position: { ...w.position, takeProfitPrice: newPrice } } : w
        );
        const tpPct = Math.abs(((newPrice - pos.entryPrice) / pos.entryPrice) * 100);
        setReplayTicketTpPct(Number(tpPct.toFixed(1)));
      }
    } else if (currentReplayCandle) {
      const entry = currentReplayCandle.close;
      if (entry > 0) {
        const isLong = replayTicketSide === "buy";
        if ((isLong && newPrice > entry) || (!isLong && newPrice < entry)) {
          const pct = Math.abs(((newPrice - entry) / entry) * 100);
          setReplayTicketTpPct(Number(Math.max(0.1, pct).toFixed(1)));
        }
      }
    }
  }, [replayWallet.position, currentReplayCandle, replayTicketSide]);

  const handleUpdateReplaySlPrice = useCallback((newPrice: number) => {
    if (replayWallet.position) {
      const pos = replayWallet.position;
      setReplayWallet((w) =>
        w.position ? { ...w, position: { ...w.position, stopLossPrice: newPrice } } : w
      );
      const slPct = Math.abs(((newPrice - pos.entryPrice) / pos.entryPrice) * 100);
      setReplayTicketSlPct(Number(slPct.toFixed(1)));
    } else if (currentReplayCandle) {
      const entry = currentReplayCandle.close;
      if (entry > 0) {
        const isLong = replayTicketSide === "buy";
        if ((isLong && newPrice < entry) || (!isLong && newPrice > entry)) {
          const pct = Math.abs(((newPrice - entry) / entry) * 100);
          setReplayTicketSlPct(Number(Math.max(0.1, pct).toFixed(1)));
        }
      }
    }
  }, [replayWallet.position, currentReplayCandle, replayTicketSide]);

  const handleSnapBreakeven = useCallback(() => {
    if (replayWallet.position) {
      const entry = replayWallet.position.entryPrice;
      setReplayWallet((w) =>
        w.position ? { ...w, position: { ...w.position, stopLossPrice: entry } } : w
      );
      setToastMessage(`Stop Loss moved to Breakeven ($${formatPrice(entry)})`);
    } else {
      setReplayTicketSlPct(0.1);
      setToastMessage("Stop Loss set to tight 0.1% buffer");
    }
  }, [replayWallet.position]);

  const handleSnapRiskReward = useCallback((ratio: number) => {
    if (replayWallet.position) {
      const pos = replayWallet.position;
      const isLong = pos.side === "buy";
      const slPrice = pos.stopLossPrice ?? (isLong ? pos.entryPrice * 0.99 : pos.entryPrice * 1.01);
      const slDist = Math.abs(pos.entryPrice - slPrice);
      const targetTp = isLong ? pos.entryPrice + slDist * ratio : pos.entryPrice - slDist * ratio;
      setReplayWallet((w) =>
        w.position ? { ...w, position: { ...w.position, takeProfitPrice: targetTp } } : w
      );
      const tpPct = Math.abs(((targetTp - pos.entryPrice) / pos.entryPrice) * 100);
      setReplayTicketTpPct(Number(tpPct.toFixed(1)));
      setToastMessage(`Take Profit snapped to ${ratio}R target ($${formatPrice(targetTp)})`);
    } else if (currentReplayCandle) {
      const slPct = replayTicketSlPct > 0 ? replayTicketSlPct : 1.0;
      const newTpPct = Number((slPct * ratio).toFixed(1));
      setReplayTicketTpPct(newTpPct);
      setToastMessage(`Take Profit planned at ${ratio}R (+${newTpPct}%)`);
    }
  }, [replayWallet.position, currentReplayCandle, replayTicketSlPct]);

  const replayBracketsConfig: ReplayBracketConfig | undefined = useMemo(() => {
    if (!isReplayActive) return undefined;
    const isPos = Boolean(replayWallet.position);
    if (isPos && replayWallet.position) {
      return {
        side: replayWallet.position.side,
        entryPrice: replayWallet.position.entryPrice,
        tpPrice: replayWallet.position.takeProfitPrice ?? null,
        slPrice: replayWallet.position.stopLossPrice ?? null,
        sizeUsd: replayWallet.position.quantity * replayWallet.position.entryPrice,
        isActivePosition: true,
        onUpdateTpPrice: handleUpdateReplayTpPrice,
        onUpdateSlPrice: handleUpdateReplaySlPrice,
        onSnapBreakeven: handleSnapBreakeven,
        onSnapRiskReward: handleSnapRiskReward,
      };
    }
    if (currentReplayCandle) {
      const entry = currentReplayCandle.close;
      const isBuy = replayTicketSide === "buy";
      const tp = isBuy ? entry * (1 + replayTicketTpPct / 100) : entry * (1 - replayTicketTpPct / 100);
      const sl = isBuy ? entry * (1 - replayTicketSlPct / 100) : entry * (1 + replayTicketSlPct / 100);
      return {
        side: replayTicketSide,
        entryPrice: entry,
        tpPrice: tp,
        slPrice: sl,
        sizeUsd: replayTicketAmount,
        isActivePosition: false,
        onUpdateTpPrice: handleUpdateReplayTpPrice,
        onUpdateSlPrice: handleUpdateReplaySlPrice,
        onSnapBreakeven: handleSnapBreakeven,
        onSnapRiskReward: handleSnapRiskReward,
      };
    }
    return undefined;
  }, [
    isReplayActive,
    replayWallet.position,
    currentReplayCandle,
    replayTicketSide,
    replayTicketAmount,
    replayTicketTpPct,
    replayTicketSlPct,
    handleUpdateReplayTpPrice,
    handleUpdateReplaySlPrice,
    handleSnapBreakeven,
    handleSnapRiskReward,
  ]);

  // Initialize replay starting index when entering replay tab or loading a target trade
  useEffect(() => {
    if (view === "replay" && market?.candles?.length) {
      if (replayTargetTrade && market.symbol === replayTargetTrade.symbol) {
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < market.candles.length; i++) {
          const diff = Math.abs(market.candles[i].time - replayTargetTrade.openedAt);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const setupIdx = Math.max(0, closestIdx - 25);
        setReplayIndex(setupIdx);
      } else if (replayIndex === 0) {
        setReplayIndex(Math.max(0, market.candles.length - 25));
      }
    }
  }, [view, market?.candles?.length, market?.symbol, replayTargetTrade?.id]);

  // Pause playback and clear cut mode when switching views
  useEffect(() => {
    if (view !== "replay") {
      setIsReplayPlaying(false);
      setIsCutMode(false);
    }
  }, [view]);

  // Replay playback timer
  useEffect(() => {
    if (!isReplayActive || !isReplayPlaying || !market) return;
    const intervalMs = Math.max(100, Math.round(1000 / replaySpeed));
    const timer = window.setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= market.candles.length - 1) {
          setIsReplayPlaying(false);
          setToastMessage("Replay reached the end of history.");
          return prev;
        }
        const nextIdx = prev + 1;
        const nextCandle = market.candles[nextIdx];
        if (nextCandle) {
          setReplayWallet((w) => {
            const res = advanceReplayCandle(w, nextCandle);
            if (res.event) {
              setToastMessage(`Bracket triggered: ${res.event.reason === "take_profit" ? "Take Profit" : "Stop Loss"} (${res.event.pnl >= 0 ? "+" : ""}$${res.event.pnl.toFixed(2)})`);
            }
            return res.wallet;
          });
        }
        return nextIdx;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isReplayActive, isReplayPlaying, replaySpeed, market]);

  // Replay keyboard shortcuts
  useEffect(() => {
    if (!isReplayActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement?.tagName || ""
      );
      if (isInputFocused) return;

      if (e.code === "Space") {
        e.preventDefault();
        setIsReplayPlaying((prev) => !prev);
      } else if (e.code === "ArrowRight" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleStepForward();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setIsCutMode((prev) => !prev);
      } else if (e.code === "Escape") {
        if (isCutMode) {
          setIsCutMode(false);
        } else if (scorecardModalOpen) {
          setScorecardModalOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isReplayActive, isCutMode, scorecardModalOpen, handleStepForward]);

  const chartCandles = useMemo(() => {
    if (!market || !market.candles) return [];
    if (isReplayActive && !isCutMode && activeMarket) {
      return activeMarket.candles;
    }
    return market.candles;
  }, [market, isReplayActive, isCutMode, activeMarket]);

  const copilotMarketSnapshot: MarketContextSnapshot | undefined = useMemo(() => {
    const targetMarket = activeMarket;
    if (!targetMarket) return undefined;
    let squeeze = null;
    if (targetMarket.candles && targetMarket.candles.length >= 20) {
      const bands = bollingerBands(targetMarket.candles.map((c) => c.close), 20, 2);
      const lastBb = bands[bands.length - 1];
      if (lastBb && lastBb.upper !== null && lastBb.lower !== null && lastBb.middle !== null) {
        squeeze = detectVolatilitySqueeze(targetMarket.candles, { upper: lastBb.upper, lower: lastBb.lower, middle: lastBb.middle });
      }
    }
    return {
      symbol: targetMarket.symbol,
      interval,
      price: targetMarket.price,
      change24h: targetMarket.change24h,
      high24h: targetMarket.high24h,
      low24h: targetMarket.low24h,
      volume24h: targetMarket.volume24h,
      rsi: liveIndicators?.rsi14,
      ema20: liveIndicators?.ema20,
      ema50: liveIndicators?.ema50,
      regime: liveIndicators?.regime,
      support: liveIndicators?.support,
      resistance: liveIndicators?.resistance,
      bbSqueeze: squeeze?.isSqueezed,
      squeezeActive: squeeze?.isSqueezed,
      squeezeBias: squeeze?.bias,
    };
  }, [activeMarket, interval, liveIndicators]);

  const copilotPaperSnapshot: PaperContextSnapshot = useMemo(() => {
    if (isReplayActive) {
      const currentPrice = currentReplayCandle?.close ?? 0;
      const replayEquity = calculateReplayEquity(replayWallet, currentPrice);
      const position = replayWallet.position;
      const unrealizedPnl = position && currentPrice > 0
        ? position.side === "buy"
          ? (currentPrice - position.entryPrice) * position.quantity
          : (position.entryPrice - currentPrice) * position.quantity
        : 0;
      const winRate = replayWallet.closedTrades.length > 0
        ? (replayWallet.closedTrades.filter((t) => t.pnl > 0).length / replayWallet.closedTrades.length) * 100
        : 0;

      return {
        balance: replayWallet.cash,
        equity: replayEquity,
        openPositionsCount: position ? 1 : 0,
        unrealizedPnL: unrealizedPnl,
        winRate,
        positions: position ? [{
          symbol: position.symbol,
          side: (position.side === "buy" ? "long" : "short") as "long" | "short",
          size: position.quantity,
          entryPrice: position.entryPrice,
          unrealizedPnl,
          pnlPct: position.entryPrice > 0 ? (unrealizedPnl / (position.entryPrice * position.quantity)) * 100 : 0,
        }] : [],
      };
    }

    const unrealizedPnL = openPositions.reduce((sum, pos) => {
      const currentQuote = quotes.find((q) => q.symbol === pos.symbol);
      const currentPrice = currentQuote?.price ?? pos.averageEntry;
      return sum + (currentPrice - pos.averageEntry) * pos.quantity;
    }, 0);
    const winRate = closedPaperTrades.length > 0
      ? (closedPaperTrades.filter((t) => t.netPnl > 0).length / closedPaperTrades.length) * 100
      : 0;
    const equity = cashBalance + openPositions.reduce((sum, pos) => {
      const currentQuote = quotes.find((q) => q.symbol === pos.symbol);
      const currentPrice = currentQuote?.price ?? pos.averageEntry;
      return sum + currentPrice * pos.quantity;
    }, 0);

    return {
      balance: cashBalance,
      equity,
      openPositionsCount: openPositions.length,
      unrealizedPnL,
      winRate,
      positions: openPositions.map((pos) => {
        const currentQuote = quotes.find((q) => q.symbol === pos.symbol);
        const currentPrice = currentQuote?.price ?? pos.averageEntry;
        const uPnl = (currentPrice - pos.averageEntry) * pos.quantity;
        const pnlPct = pos.averageEntry > 0 ? ((currentPrice - pos.averageEntry) / pos.averageEntry) * 100 : 0;
        return {
          symbol: pos.symbol,
          side: "long" as const,
          size: pos.quantity,
          entryPrice: pos.averageEntry,
          unrealizedPnl: uPnl,
          pnlPct,
        };
      }),
    };
  }, [isReplayActive, replayWallet, currentReplayCandle, cashBalance, openPositions, quotes, closedPaperTrades]);

  const handleCopilotLoadOrder = useCallback((action: any) => {
    if (isReplayActive && currentReplayCandle) {
      const price = currentReplayCandle.close;
      const amountVal = Number(action.amount ?? action.amountUsd ?? 250);
      const side = action.side === "sell" ? "sell" : "buy";
      let tpPct: number | undefined;
      let slPct: number | undefined;
      if (action.takeProfitPrice && price > 0) {
        tpPct = Math.abs(((action.takeProfitPrice - price) / price) * 100);
      }
      if (action.stopLossPrice && price > 0) {
        slPct = Math.abs(((action.stopLossPrice - price) / price) * 100);
      }
      setReplayWallet((w) =>
        executeReplayOrder(
          w,
          currentReplayCandle,
          action.symbol || symbol,
          side,
          amountVal > 0 ? amountVal : 250,
          tpPct,
          slPct
        )
      );
      setToastMessage(`Replay order filled via Copilot: ${side.toUpperCase()} $${amountVal > 0 ? amountVal : 250} ${action.symbol || symbol} @ $${price.toFixed(2)}`);
      return;
    }

    if (action.symbol && action.symbol !== symbol) {
      selectMarket(action.symbol);
    }
    setOrderSide(action.side === "sell" ? "sell" : "buy");
    const amountVal = action.amount ?? action.amountUsd;
    if (amountVal !== undefined && amountVal !== null && Number(amountVal) > 0) {
      setOrderAmount(String(amountVal));
    }
    if (action.takeProfitPrice && market?.price) {
      const tpPct = Math.abs(((action.takeProfitPrice - market.price) / market.price) * 100);
      setTakeProfitPct(tpPct.toFixed(1));
      setAttachBracket(true);
    }
    if (action.stopLossPrice && market?.price) {
      const slPct = Math.abs(((action.stopLossPrice - market.price) / market.price) * 100);
      setStopLossPct(slPct.toFixed(1));
      setAttachBracket(true);
    }
    setOrderOpen(true);
    setToastMessage(`Copilot loaded ${action.side?.toUpperCase() ?? "BUY"} order ticket for ${action.symbol || symbol}`);
  }, [isReplayActive, currentReplayCandle, symbol, market]);

  const handleCopilotRunBacktest = useCallback((action: any) => {
    const targetSymbol = action.symbol || symbol;
    const targetInterval = action.interval || interval;
    const targetPrompt = action.strategyPrompt || strategyPrompt;
    const targetDays = action.lookbackDays || backtestDays;

    if (targetSymbol !== symbol) setSymbol(targetSymbol);
    if (targetInterval !== interval) setInterval(targetInterval);
    setStrategyPrompt(targetPrompt);
    setBacktestDays(targetDays);
    setView("backtests");

    void runBacktest(undefined, {
      symbol: targetSymbol,
      interval: targetInterval,
      prompt: targetPrompt,
      lookbackDays: targetDays,
    });
    setToastMessage(`Running backtest for ${targetSymbol} (${targetInterval})...`);
  }, [symbol, interval, strategyPrompt, backtestDays]);

  const handleCopilotSavePlaybook = useCallback((action: any) => {
    const newPlaybook: StrategyPlaybook = {
      id: crypto.randomUUID(),
      name: action.title || `Copilot Playbook (${action.symbol || symbol})`,
      symbol: action.symbol || symbol,
      interval: action.interval || interval,
      prompt: action.entryRules && action.exitRules
        ? `Entry: ${action.entryRules}. Exit: ${action.exitRules}`
        : action.entryRules || "Generated by AI Strategy Copilot",
      lookbackDays: 30,
      feeBps: 10,
      slippageBps: 5,
      createdAt: Date.now(),
    };
    const next = [newPlaybook, ...playbooks];
    setPlaybooks(next);
    window.localStorage.setItem(storageKeys.playbooks, JSON.stringify(next));
    setView("playbooks");
    setToastMessage(`Playbook "${newPlaybook.name}" saved successfully.`);
  }, [symbol, interval, playbooks]);

  const handleCopilotSelectMarket = useCallback((targetSymbol: string) => {
    selectMarket(targetSymbol);
    setView("desk");
    setToastMessage(`Switched terminal chart to ${targetSymbol}`);
  }, []);

  const handleCopilotExportJournal = useCallback((entry: { title: string; notes: string; symbol: string }) => {
    const item: JournalItem = {
      id: crypto.randomUUID(),
      question: entry.title,
      symbol: entry.symbol || symbol,
      interval,
      summary: entry.notes.slice(0, 400),
      regime: liveIndicators?.regime ?? "AI Strategy Copilot",
      price: market?.price ?? 0,
      createdAt: Date.now(),
      commentary: entry.notes,
      engine: aiModel ? `Copilot (${aiModel})` : "AI Strategy Copilot",
      indicators: liveIndicators ? {
        ema20: liveIndicators.ema20,
        ema50: liveIndicators.ema50,
        rsi14: liveIndicators.rsi14,
        support: liveIndicators.support,
        resistance: liveIndicators.resistance,
        rangePct: 0,
        regime: liveIndicators.regime,
      } : undefined,
    };
    setJournal((prev) => {
      const next = [item, ...prev].slice(0, 50);
      window.localStorage.setItem(storageKeys.journal, JSON.stringify(next));
      return next;
    });
    setView("journal");
    setToastMessage(`Strategy conversation exported to Trade Journal.`);
  }, [symbol, interval, liveIndicators, market, aiModel]);

  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "desk", label: "Market desk", icon: "grid" },
    { id: "scanner", label: "Market scanner", icon: "scan" },
    { id: "research", label: "Research", icon: "research" },
    { id: "backtests", label: "Backtests", icon: "backtest" },
    { id: "replay", label: "Trade replay", icon: "replay" },
    { id: "playbooks", label: "Playbooks", icon: "playbook" },
    { id: "paper", label: "Paper account", icon: "wallet" },
    { id: "journal", label: "Journal", icon: "journal" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];
  const isWatchlisted = watchlist.includes(symbol);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#desk" onClick={(event) => { event.preventDefault(); setView("desk"); }}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand-name">goriee<span>desk</span></span>
        </a>
        <div className="workspace-label">Workspace</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}>
              <Icon name={item.icon} size={17} /><span>{item.label}</span>
              {item.id === "playbooks" && playbooks.length > 0 ? <span className="nav-count">{playbooks.length}</span> : null}
              {item.id === "paper" && paperTrades.length > 0 ? <span className="nav-count">{paperTrades.length}</span> : null}
            </button>
          ))}
        </nav>

        <section className="watchlist" aria-labelledby="watchlist-title">
          <div className="section-heading"><h2 id="watchlist-title">Watchlist <span className="watchlist-count">{watchlist.length}/50</span></h2><button className="watchlist-add" onClick={() => { setInstrumentQuery(""); setPickerOpen(true); }}><Icon name="plus" size={12} /> Add token</button></div>
          <div className="watchlist-items">
            {watchlist.length ? watchlist.map((asset) => {
              const quote = quotes.find((row) => row.symbol === asset);
              const active = symbol === asset;
              return (
                <div key={asset} className="watch-entry">
                  <button className={`watch-row ${active ? "selected" : ""}`} onClick={() => setSymbol(asset)} aria-pressed={active}>
                    <span className={`coin-mark coin-${asset.slice(0, 3).toLowerCase()}`}>{asset.slice(0, 1)}</span>
                    <span className="watch-name"><strong>{asset.endsWith("USDT") ? asset.slice(0, -4) : asset}</strong><small>{asset}</small></span>
                    <span className="watch-price"><strong>{quote ? formatPrice(quote.price) : "n/a"}</strong><small className={(quote?.change24h ?? 0) >= 0 ? "tone-up" : "tone-down"}>{quote ? `${quote.change24h >= 0 ? "+" : ""}${quote.change24h.toFixed(2)}%` : ""}</small></span>
                  </button>
                  <button className="watch-remove" onClick={() => removeFromWatchlist(asset)} aria-label={`Remove ${asset} from watchlist`} title={`Remove ${asset}`}>×</button>
                </div>
              );
            }) : <div className="watchlist-empty">No saved markets yet.</div>}
          </div>
        </section>

        <div className="sidebar-bottom">
          <div className="safety-note"><span className="note-icon">i</span><p>Research and simulation only. You stay in control.</p></div>
          <div className="profile-row"><span className="profile-avatar">G</span><span><strong>Guest workspace</strong><small>Saved on this device</small></span></div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-sep">/</span><strong>{navItems.find((item) => item.id === view)?.label}</strong></div>
          <div className="topbar-actions">
            <button
              type="button"
              className="desk-copilot-header-btn"
              onClick={() => setCopilotOpen((prev) => !prev)}
              title="Open AI Strategy Copilot (Ctrl+J)"
            >
              <Icon name="cpu" size={13} />
              <span>AI Copilot</span>
              <kbd>Ctrl+J</kbd>
            </button>
            <button
              type="button"
              className="cmd-k-trigger"
              onClick={() => setPaletteOpen(true)}
              title="Open Bloomberg-style Command Palette (Ctrl+K)"
            >
              <Icon name="search" size={13} />
              <span>Quick search &amp; commands</span>
              <kbd>Ctrl+K</kbd>
            </button>
            <span className={`connection-state ${market ? "connected" : ""}`}><span className="state-dot" />{market ? "Bitget spot data" : "Connecting to Bitget"}</span>
            <button className="icon-button" onClick={() => setRefreshCount((count) => count + 1)} aria-label="Refresh market data" title="Refresh market data"><Icon name="refresh" /></button>
          </div>
        </header>

        <div className="page-content">
          {view === "desk" ? (
            <>
              <div className="page-heading desk-heading">
                <div><p className="page-kicker">Bitget USDT spot · human-led research</p><h1>The market, in context.</h1><p className="page-subtitle">Search online USDT spot markets, then keep the tokens you follow close at hand.</p></div>
                <div className="desk-heading-controls">
                  <div className="desk-view-toggle" role="group" aria-label="Terminal layout">
                    <button
                      type="button"
                      aria-pressed={deskLayout === "single"}
                      className={`view-mode-btn ${deskLayout === "single" ? "active" : ""}`}
                      onClick={() => setDeskLayout("single")}
                    >
                      <Icon name="grid" size={14} /> Single Terminal
                    </button>
                    <button
                      type="button"
                      aria-pressed={deskLayout === "grid"}
                      className={`view-mode-btn ${deskLayout === "grid" ? "active" : ""}`}
                      onClick={() => setDeskLayout("grid")}
                    >
                      <Icon name="scan" size={14} /> 4-Chart Matrix
                    </button>
                  </div>
                  <div className="desk-market-search" onBlur={(event) => { const nextTarget = event.relatedTarget; if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setMarketSearchOpen(false); }}>
                    <label className="desk-market-search-field"><Icon name="search" size={15} /><input type="search" aria-label="Search Bitget markets" placeholder="Search tokens or pairs" value={instrumentQuery} onFocus={() => setMarketSearchOpen(true)} onChange={(event) => { setInstrumentQuery(event.target.value); setMarketSearchOpen(true); }} /></label>
                    {marketSearchOpen && instrumentQuery.trim() ? <div className="desk-market-search-results" role="listbox" aria-label="Matching Bitget markets">
                      {instrumentLoading ? <div className="desk-search-message">Loading Bitget markets…</div> : instrumentError ? <div className="desk-search-message desk-search-error"><span>{instrumentError}</span><button type="button" onClick={() => { setInstrumentError(""); setTokenRetry((retry) => retry + 1); }}>Retry</button></div> : filteredInstruments.slice(0, 6).map((instrument) => <button type="button" className="desk-market-search-result" role="option" aria-selected="false" key={instrument.symbol} onClick={() => selectMarket(instrument.symbol)}><span><strong>{instrument.baseCoin}</strong><small>{instrument.symbol}</small></span><span className="desk-market-result-type">{instrument.isRwa === "YES" ? "Tokenized asset" : "Crypto"}</span></button>)}
                      {!instrumentLoading && !instrumentError && filteredInstruments.length === 0 ? <div className="desk-search-message">No matching online USDT market.</div> : null}
                      {!instrumentLoading && !instrumentError && filteredInstruments.length > 6 ? <button type="button" className="desk-search-browse" onClick={() => { setPickerOpen(true); setMarketSearchOpen(false); }}>Browse all matching markets <Icon name="arrow" size={14} /></button> : null}
                    </div> : null}
                  </div>
                  <label className="interval-control"><span>Chart interval</span><select value={interval} onChange={(event) => setInterval(event.target.value)} aria-label="Chart interval">{["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}</select></label>
                </div>
              </div>

              {deskLayout === "grid" ? (
                <MultiChartGrid
                  activeSymbol={symbol}
                  watchlist={watchlist}
                  onSelectSymbol={(s) => {
                    selectMarket(s);
                    setDeskLayout("single");
                  }}
                  onOpenOrder={(s) => {
                    selectMarket(s);
                    setOrderOpen(true);
                  }}
                />
              ) : (
                <>
                  {marketError && !market ? <div className="error-banner" role="alert"><div><strong>Market data could not load</strong><span>{marketError}</span></div><button className="button button-secondary" onClick={() => setRefreshCount((count) => count + 1)}>Try again</button></div> : null}

                  <section className="market-focus" aria-label={`${symbol} market overview`}>
                    <div className="focus-main">
                      <div className="asset-title">
                        <span className={`coin-mark coin-${symbol.slice(0, 3).toLowerCase()}`}>{symbol.slice(0, 1)}</span>
                        <div>
                          <h2>{symbol.endsWith("USDT") ? `${symbol.slice(0, -4)} / USDT` : symbol}</h2>
                          <span>Bitget spot market</span>
                        </div>
                        <span className="market-open">
                          <span className="state-dot" />
                          {market ? "Market data available" : marketLoading ? "Loading market data" : "Market data unavailable"}
                        </span>
                        <span
                          className={`ws-status-badge ${wsStatus === "connected" ? "ws-connected" : "ws-fallback"}`}
                          title={wsStatus === "connected" ? "Real-time streaming via wss://ws.bitget.com/v2/ws/public" : "Fallback REST polling"}
                        >
                          <span className={wsStatus === "connected" ? "pulse-dot-green" : "pulse-dot-gray"} />
                          {wsStatus === "connected" ? "WS Live" : "REST Polling"}
                        </span>
                      </div>
                      <div className="quote-line">
                        <strong className={priceFlash === "up" ? "flash-up" : priceFlash === "down" ? "flash-down" : ""}>
                          {market ? formatMoney(market.price) : marketLoading ? "Loading quote…" : "n/a"}
                        </strong>
                        {market ? <span className={`quote-change ${market.change24h >= 0 ? "tone-up" : "tone-down"}`}>{market.change24h >= 0 ? "+" : ""}{market.change24h.toFixed(2)}% <small>24h</small></span> : null}
                      </div>
                      <div className="micro-stats">
                        <Stat label="24h high" value={market ? formatMoney(market.high24h) : "n/a"} />
                        <Stat label="24h low" value={market ? formatMoney(market.low24h) : "n/a"} />
                        <Stat label="24h volume" value={market ? `${formatCompact(market.volume24h)} ${symbol.replace("USDT", "")}` : "n/a"} />
                        <Stat label="Turnover" value={market ? formatMoney(market.turnover24h, 0) : "n/a"} />
                      </div>
                    </div>
                    <div className="focus-source">
                      <span className="source-label">Source</span>
                      <strong>Bitget public API {wsStatus === "connected" ? "+ WebSocket Stream" : ""}</strong>
                      <span>{market ? `Updated ${formatDate(market.asOf)}` : marketLoading ? "Fetching latest data" : "Waiting for connection"}</span>
                      <div className="focus-source-actions">
                        <button className={`watch-toggle ${isWatchlisted ? "is-saved" : ""}`} onClick={() => isWatchlisted ? removeFromWatchlist(symbol) : addToWatchlist(symbol)} aria-pressed={isWatchlisted}>
                          {isWatchlisted ? <><Icon name="check" size={13} /> In watchlist</> : <><Icon name="plus" size={13} /> Add to watchlist</>}
                        </button>
                        <button className="button button-primary desk-quick-order-btn" onClick={() => { setOrderOpen(true); setPaperMessage(""); }}>
                          <Icon name="wallet" size={13} /> Quick order
                        </button>
                      </div>
                    </div>
                  </section>

                  <div className="work-grid">
                    <section className="panel chart-panel" aria-labelledby="chart-title">
                      <div className="panel-heading chart-heading">
                        <div>
                          <h2 id="chart-title">Price history</h2>
                          <p>
                            {symbol} · {interval} candles · latest 100 shown
                          </p>
                        </div>
                        <div className="chart-heading-actions">
                          <span className="chart-source">OHLCV · Bitget</span>
                        </div>
                      </div>

                      {market ? (
                        <PriceChart
                          candles={market.candles}
                          label={`${symbol} ${interval} price history from Bitget`}
                          indicators={liveIndicators}
                        />
                      ) : (
                        <div className="chart-placeholder">
                          {marketLoading ? (
                            <>
                              <span className="loader-ring" />Loading candles from Bitget…
                            </>
                          ) : (
                            "Price history appears when market data is available."
                          )}
                        </div>
                      )}

                      <div className="chart-footer">
                        <span>Recent candles</span>
                        <span>
                          {market?.candles.length
                            ? `${formatDate(market.candles.at(-100)?.time ?? market.candles[0].time, false)} to ${formatDate(market.candles.at(-1)!.time, false)}`
                            : "n/a"}
                        </span>
                      </div>
                    </section>

                    <section className="panel ask-panel" aria-labelledby="ask-title">
                      <div className="desk-tab-header" role="tablist" aria-label="Desk right workspace">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={deskRightTab === "ask"}
                          className={`desk-subtab-btn ${deskRightTab === "ask" ? "active" : ""}`}
                          onClick={() => setDeskRightTab("ask")}
                        >
                          <Icon name="research" size={14} /> Ask the Desk
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={deskRightTab === "orderbook"}
                          className={`desk-subtab-btn ${deskRightTab === "orderbook" ? "active" : ""}`}
                          onClick={() => setDeskRightTab("orderbook")}
                        >
                          <span className="live-pulse-dot" /> L2 Order Book &amp; Depth
                        </button>
                      </div>

                      {deskRightTab === "ask" ? (
                        <>
                          <div className="panel-heading"><div><h2 id="ask-title">Ask the desk</h2><p>Turn market data into a grounded brief, with optional live news.</p></div><span className="research-mark"><Icon name="research" size={16} /></span></div>
                          <form onSubmit={submitResearch} className="research-form">
                            <label htmlFor="research-question">What do you want to understand?</label>
                            <textarea id="research-question" rows={4} maxLength={600} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`Analyze ${symbol} on the ${interval} chart. Show both sides and what would change the read.`} />
                            <div className="prompt-examples"><span>Try:</span><button type="button" onClick={() => setQuestion(`Analyze ${symbol} on the ${interval} chart. Show both sides and what would change the read.`)}>Read the current structure</button><button type="button" onClick={() => setQuestion(`Summarize momentum and what would invalidate the current read for ${symbol}.`)}>Check momentum</button></div>
                            <label className="research-web-option"><input type="checkbox" checked={includeWebResearch} onChange={(event) => setIncludeWebResearch(event.target.checked)} /><span><strong>Include live news search</strong><small>Optional. Real-time market news headlines &amp; citations are gathered across all AI routers.</small></span></label>
                            {researchError ? (
                              <div className="research-error-group">
                                <div className="research-error-card" role="alert">
                                  <div>
                                    <strong>Research did not run</strong>
                                    <span>{researchErrorMessage(researchError)}</span>
                                  </div>
                                  <button type="button" onClick={() => setView("settings")}>Review AI settings</button>
                                </div>
                                <RequestRecovery retryAt={aiRetryAt} busy={researchLoading || backtestLoading} onRetry={() => void submitResearch()} />
                              </div>
                            ) : null}
                            <ModelReadiness configured={aiConfigured} model={aiModel} />
                            {researchLoading ? (
                              <ResearchLoadingStatus
                                symbol={symbol}
                                interval={interval}
                                elapsed={researchElapsed}
                                includeWebResearch={includeWebResearch}
                                aiModel={aiModel}
                                onStop={cancelResearch}
                              />
                            ) : null}
                            {researchLoading ? (
                              <div className="research-loading-actions">
                                <button className="button button-primary research-submit is-loading" type="button" disabled>
                                  <span className="button-spinner" />
                                  <span>Analyzing {symbol} ({researchElapsed.toFixed(1)}s)…</span>
                                </button>
                                <button
                                  type="button"
                                  className="button button-danger research-cancel-btn"
                                  onClick={cancelResearch}
                                  title="Stop research agent"
                                  aria-label="Stop research agent"
                                >
                                  <span className="stop-square" />
                                  <span>Stop Agent</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                className="button button-primary research-submit"
                                type="submit"
                                disabled={marketLoading || aiConfigured === false || requestBusy.current || cooldownSeconds > 0}
                              >
                                {cooldownSeconds > 0
                                  ? `Cooldown (${cooldownSeconds}s)`
                                  : requestBusy.current
                                  ? "Request in progress…"
                                  : <>Build research brief <Icon name="arrow" size={16} /></>}
                              </button>
                            )}
                          </form>
                          <div className="desk-note"><span className="note-icon">i</span><p>Indicators are calculated from fetched candles. The desk supports your judgment; it does not place live orders.</p></div>
                        </>
                      ) : (
                        <OrderBookPanel
                          symbol={symbol}
                          onPickPrice={(pickPrice) => {
                            if (market) {
                              setOrderAmount(String(Math.max(10, Math.round(pickPrice * 0.02))));
                            }
                            setOrderOpen(true);
                            setPaperMessage(`Selected ${formatPrice(pickPrice)} from order book.`);
                          }}
                        />
                      )}
                    </section>
                  </div>

                  <section className="below-grid">
                    <div className="panel market-reading">
                      <div className="panel-heading"><div><h2>Market reading</h2><p>Computed from the latest {interval} candles.</p></div><button className="text-button" onClick={() => setView("research")}>Open research <Icon name="arrow" size={14} /></button></div>
                      {market ? <div className="reading-row"><div className="reading-state"><span className={`regime-mark ${(liveIndicators?.regime ?? report?.indicators?.regime) === "Bullish structure" ? "regime-up" : (liveIndicators?.regime ?? report?.indicators?.regime) === "Bearish structure" ? "regime-down" : ""}`} /><div><strong>{liveIndicators?.regime ?? (report && report.symbol === symbol && report.interval === interval ? report.indicators.regime : "Ready for analysis")}</strong><span>{liveIndicators ? `Calculated from current ${interval} candles (RSI: ${liveIndicators.rsi14.toFixed(1)})` : "Run a research brief to calculate the trend structure"}</span></div></div><div className="reading-data"><span>Last price</span><strong>{formatMoney(market.price)}</strong></div><div className="reading-data"><span>24h move</span><strong className={market.change24h >= 0 ? "tone-up" : "tone-down"}>{market.change24h >= 0 ? "+" : ""}{market.change24h.toFixed(2)}%</strong></div></div> : <div className="quiet-empty">Market reading will appear once data is available.</div>}
                    </div>
                    <div className="panel recent-panel">
                      <div className="panel-heading"><div><h2>Recent research</h2><p>Your saved notes on this device.</p></div><button className="text-button" onClick={() => setView("journal")}>View journal <Icon name="arrow" size={14} /></button></div>
                      {journal.length ? <div className="recent-list">{journal.slice(0, 2).map((item) => <button key={item.id} className="recent-item" onClick={() => { setView("journal"); setSelectedJournalItem(item); }}><span><strong>{item.symbol}</strong><small>{formatDate(item.createdAt)}</small></span><span className="recent-summary">{item.summary}</span><Icon name="arrow" size={14} /></button>)}</div> : <div className="quiet-empty">No saved research yet. Start with a question above.</div>}
                    </div>
                  </section>

                  <MultiHorizonConfluencePanel
                    symbol={symbol}
                    onSeedBrief={(briefPrompt) => {
                      setQuestion(briefPrompt);
                      setView("research");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </>
              )}
            </>
          ) : null}

          {view === "scanner" ? (
            <>
              <div className="page-heading scanner-heading">
                <div><p className="page-kicker">Bitget USDT spot · public market data</p><h1>Find markets worth a closer look.</h1><p className="page-subtitle">Scan online spot pairs by turnover and 24-hour move, then open a chart or save a market.</p></div>
                <button className="button button-secondary scanner-refresh" onClick={() => setScannerRefresh((count) => count + 1)} disabled={scannerLoading}><Icon name="refresh" size={15} />{scannerLoading ? "Refreshing…" : "Refresh markets"}</button>
              </div>

              <section className="panel scanner-toolbar" aria-label="Market scanner filters">
                <div className="scanner-search-field"><Icon name="search" size={16} /><input type="search" aria-label="Search scanner markets" placeholder="Search symbol or token name" value={scannerQuery} onChange={(event) => setScannerQuery(event.target.value)} /></div>
                <label className="scanner-filter"><span>Asset type</span><select value={scannerAssetType} onChange={(event) => setScannerAssetType(event.target.value as ScannerAssetType)}><option value="all">All assets</option><option value="crypto">Crypto</option><option value="rwa">Tokenized assets</option></select></label>
                <label className="scanner-filter"><span>Min. 24h turnover</span><select value={scannerMinTurnover} onChange={(event) => setScannerMinTurnover(Number(event.target.value))}><option value={0}>Any turnover</option><option value={100_000}>$100K+</option><option value={1_000_000}>$1M+</option><option value={10_000_000}>$10M+</option></select></label>
              </section>

              <section className="scanner-workspace" aria-label="Scanned Bitget markets">
                <div className="scanner-results-toolbar">
                  <div className="scanner-sort-group" role="group" aria-label="Sort markets">
                    {([ ["active", "Most active"], ["gainers", "Top gainers"], ["decliners", "Top decliners"] ] as Array<[ScannerSort, string]>).map(([sort, label]) => <button type="button" key={sort} className={`scanner-sort-button ${scannerSort === sort ? "selected" : ""}`} onClick={() => setScannerSort(sort)} aria-pressed={scannerSort === sort}>{label}</button>)}
                  </div>
                  <span className="scanner-result-meta">{scannerMatches.length.toLocaleString()} markets{scannerAsOf ? ` · Updated ${formatDate(scannerAsOf)}` : ""}</span>
                </div>

                {scannerError ? <div className="panel scanner-state scanner-error" role="alert"><div><strong>{scannerMarkets.length ? "Could not refresh market scan" : "Market scan could not load"}</strong><span>{scannerError}</span></div><button type="button" className="button button-secondary" onClick={() => setScannerRefresh((count) => count + 1)}>Try again</button></div> : null}
                {!scannerError && scannerLoading && scannerMarkets.length === 0 ? <div className="panel scanner-state"><span className="loader-ring" />Loading Bitget spot markets…</div> : null}
                {!scannerError && !scannerLoading && scannerMarkets.length === 0 ? <div className="panel scanner-state">No online USDT spot markets were returned.</div> : null}
                {scannerMarkets.length > 0 && scannerMatches.length === 0 ? <div className="panel scanner-state">No markets match these filters. Try a shorter search or lower turnover threshold.</div> : null}

                {scannerResults.length > 0 ? <div className="panel scanner-results">
                  <div className="scanner-table-heading" aria-hidden="true"><span>Market</span><span>Last price</span><span>24h change</span><span>24h turnover</span><span>Actions</span></div>
                  {scannerResults.map((item) => {
                    const isSaved = watchlist.includes(item.symbol);
                    return <article className="scanner-row" key={item.symbol}>
                      <div className="scanner-market-cell"><span className={`coin-mark coin-${item.baseCoin.slice(0, 3).toLowerCase()}`}>{item.baseCoin.slice(0, 1)}</span><span className="scanner-market-name"><strong>{item.baseCoin}<small>/ USDT</small></strong><span>{item.symbol}{item.isRwa ? <em className="scanner-kind">Tokenized asset</em> : null}</span></span></div>
                      <div className="scanner-metric scanner-price"><span className="scanner-mobile-label">Last price</span><strong>{formatScannerPrice(item.price)}</strong></div>
                      <div className={`scanner-metric scanner-change ${item.change24h >= 0 ? "tone-up" : "tone-down"}`}><span className="scanner-mobile-label">24h change</span><strong>{formatPercent(item.change24h)}</strong></div>
                      <div className="scanner-metric scanner-turnover"><span className="scanner-mobile-label">24h turnover</span><strong>{formatMoney(item.turnover24h, 0)}</strong></div>
                      <div className="scanner-actions">
                        <button type="button" className="scanner-action-button scanner-action-open" onClick={() => { selectMarket(item.symbol); setView("desk"); }}>Desk</button>
                        <button type="button" className="scanner-action-button scanner-action-brief" onClick={() => { selectMarket(item.symbol); setView("research"); setQuestion(`Analyze ${item.symbol} on the 1H chart. Show both sides and what would change the read.`); }}>Brief</button>
                        <button type="button" className="scanner-action-button scanner-action-backtest" onClick={() => { selectMarket(item.symbol); setView("backtests"); }}>Backtest</button>
                        <button type="button" className={`scanner-action-button scanner-action-add ${isSaved ? "is-added" : ""}`} onClick={() => addToWatchlist(item.symbol)} disabled={isSaved || watchlist.length >= 50} title={watchlist.length >= 50 && !isSaved ? "Watchlist is full" : undefined}>{isSaved ? "Saved" : watchlist.length >= 50 ? "Full" : "+ Watch"}</button>
                      </div>
                    </article>;
                  })}
                  {scannerMatches.length > scannerResults.length ? <p className="scanner-truncation">Showing the first {scannerResults.length} markets. Search or add a turnover filter to narrow the list.</p> : null}
                </div> : null}
                <p className="scanner-footnote">Rankings use Bitget public ticker data and update about once a minute. This scanner reports activity and price movement; it does not make buy or sell recommendations.</p>
              </section>
            </>
          ) : null}

          {view === "research" ? (
            <>
              <div className="page-heading"><div><p className="page-kicker">Research workspace</p><h1>Ask a better market question.</h1><p className="page-subtitle">The model reads Bitget’s current ticker and completed candles. Turn on live search to add current news with source links.</p></div></div>
              <ModelReadiness configured={aiConfigured} model={aiModel} />
              <div className="research-grid-layout">
                <div className="research-main-column">
                  <section className="panel research-workspace">
                    <form onSubmit={submitResearch} className="research-form large-form">
                      <div className="research-form-header">
                        <label htmlFor="research-question-page">Research question &amp; hypothesis</label>
                        <span className="research-char-count">{question.length}/600</span>
                      </div>
                      <div className="research-controls">
                        <select value={symbol} onChange={(event) => setSymbol(event.target.value)} aria-label="Choose spot symbol">
                          {selectableSymbols.map((asset) => <option key={asset}>{asset}</option>)}
                        </select>
                        <select value={interval} onChange={(event) => setInterval(event.target.value)} aria-label="Choose timeframe">
                          {["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}
                        </select>
                        <button type="button" className="browse-markets-button" onClick={() => { setInstrumentQuery(""); setPickerOpen(true); }}>
                          <Icon name="search" size={13} /> Browse markets
                        </button>
                      </div>

                      <div className="research-prompt-chips" role="group" aria-label="Quick research prompt starters">
                        <span className="chips-label">Topics:</span>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Analyze ${symbol} on the ${interval} chart. Show both sides and what would change the read.`)}>Structure &amp; Trend</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Evaluate RSI momentum, 20/50 EMA structure, and volume confirmation on ${symbol} ${interval}.`)}>Momentum &amp; RSI</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Identify immediate support, overhead resistance, and structural invalidation levels for ${symbol} on ${interval}.`)}>Key Levels &amp; Stops</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Is ${symbol} compressing for a continuation breakout or showing distribution signs on ${interval}?`)}>Breakout vs Range</button>
                      </div>

                      <textarea
                        id="research-question-page"
                        rows={3}
                        maxLength={600}
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder={`Analyze ${symbol} on the ${interval} timeframe. Show support, resistance, and invalidation.`}
                      />

                      <label className={`research-web-option ${includeWebResearch ? "is-active" : ""}`}>
                        <input type="checkbox" checked={includeWebResearch} onChange={(event) => setIncludeWebResearch(event.target.checked)} />
                        <span>
                          <strong>Include live news &amp; web citations</strong>
                          <small>Optional. Real-time market news headlines &amp; citations are gathered across all AI routers.</small>
                        </span>
                      </label>

                      {researchError ? (
                        <div className="research-error-group">
                          <div className="research-error-card" role="alert">
                            <div>
                              <strong>Research did not run</strong>
                              <span>{researchErrorMessage(researchError)}</span>
                            </div>
                            <button type="button" onClick={() => setView("settings")}>Review AI settings</button>
                          </div>
                          <RequestRecovery retryAt={aiRetryAt} busy={researchLoading || backtestLoading} onRetry={() => void submitResearch()} />
                        </div>
                      ) : null}
                      {researchLoading ? (
                        <div className="research-loading-actions">
                          <button className="button button-primary research-submit-btn is-loading" type="button" disabled>
                            <span className="button-spinner" />
                            <span>Researching {symbol} ({researchElapsed.toFixed(1)}s)…</span>
                          </button>
                          <button
                            type="button"
                            className="button button-danger research-cancel-btn"
                            onClick={cancelResearch}
                            title="Stop research agent"
                            aria-label="Stop research agent"
                          >
                            <span className="stop-square" />
                            <span>Stop Agent</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          className="button button-primary research-submit-btn"
                          disabled={marketLoading || aiConfigured === false || requestBusy.current || cooldownSeconds > 0}
                          type="submit"
                        >
                          <Icon name="research" size={15} />
                          <span>
                            {cooldownSeconds > 0
                              ? `Cooldown (${cooldownSeconds}s)`
                              : requestBusy.current
                              ? "Request in progress…"
                              : `Research ${symbol} (${interval})`}
                          </span>
                        </button>
                      )}
                    </form>
                  </section>

                  {/* Quantitative Pre-Flight & Strategy Lenses Panel */}
                  <section className="panel research-preflight-card" aria-label="Quantitative signal pre-flight & institutional lenses">
                    <div className="preflight-card-header">
                      <div className="preflight-title">
                        <Icon name="trending" size={14} />
                        <strong>Quantitative Pre-Flight &amp; Strategy Lenses</strong>
                      </div>
                      <span className="preflight-pair-tag">{symbol} · {interval}</span>
                    </div>

                    <div className="preflight-metrics-grid">
                      {/* Metric 1: RSI (14) Momentum Meter */}
                      <div className="preflight-metric-box">
                        <div className="preflight-metric-top">
                          <span>RSI (14) Momentum</span>
                          <strong>{liveIndicators ? liveIndicators.rsi14.toFixed(1) : "n/a"}</strong>
                        </div>
                        <div className="preflight-progress-track">
                          <div
                            className={`preflight-progress-fill ${
                              liveIndicators && liveIndicators.rsi14 > 70
                                ? "fill-overbought"
                                : liveIndicators && liveIndicators.rsi14 < 30
                                  ? "fill-oversold"
                                  : "fill-neutral"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, liveIndicators ? liveIndicators.rsi14 : 50))}%` }}
                          />
                        </div>
                        <div className="preflight-track-labels">
                          <span>Oversold &lt;30</span>
                          <span>Neutral</span>
                          <span>Overbought &gt;70</span>
                        </div>
                      </div>

                      {/* Metric 2: 24h Range Position */}
                      <div className="preflight-metric-box">
                        <div className="preflight-metric-top">
                          <span>24h Range Position</span>
                          <strong>
                            {market && market.high24h > market.low24h
                              ? `${Math.round(((market.price - market.low24h) / (market.high24h - market.low24h)) * 100)}%`
                              : "n/a"}
                          </strong>
                        </div>
                        <div className="preflight-progress-track">
                          <div
                            className="preflight-progress-fill fill-range"
                            style={{
                              width: `${
                                market && market.high24h > market.low24h
                                  ? Math.min(100, Math.max(0, Math.round(((market.price - market.low24h) / (market.high24h - market.low24h)) * 100)))
                                  : 50
                              }%`,
                            }}
                          />
                        </div>
                        <div className="preflight-track-labels">
                          <span>Low: {market ? formatPrice(market.low24h) : "n/a"}</span>
                          <span>High: {market ? formatPrice(market.high24h) : "n/a"}</span>
                        </div>
                      </div>

                      {/* Metric 3: EMA 20 vs EMA 50 Vector */}
                      <div className="preflight-metric-box">
                        <div className="preflight-metric-top">
                          <span>EMA 20/50 Alignment</span>
                          <strong className={liveIndicators && liveIndicators.ema20 && liveIndicators.ema50 && liveIndicators.ema20 >= liveIndicators.ema50 ? "tone-up" : "tone-down"}>
                            {liveIndicators && liveIndicators.ema20 && liveIndicators.ema50
                              ? liveIndicators.ema20 >= liveIndicators.ema50 ? "Bullish Cross" : "Bearish Cross"
                              : "Computing"}
                          </strong>
                        </div>
                        <div className="preflight-sub-stats">
                          <span>20 EMA: <strong>{liveIndicators?.ema20 ? formatPrice(liveIndicators.ema20) : "n/a"}</strong></span>
                          <span>50 EMA: <strong>{liveIndicators?.ema50 ? formatPrice(liveIndicators.ema50) : "n/a"}</strong></span>
                        </div>
                      </div>

                      {/* Metric 4: Volatility & Key S/R */}
                      <div className="preflight-metric-box">
                        <div className="preflight-metric-top">
                          <span>Key S/R Envelope</span>
                          <strong>{liveIndicators ? `${formatPrice(liveIndicators.support)} to ${formatPrice(liveIndicators.resistance)}` : "n/a"}</strong>
                        </div>
                        <div className="preflight-sub-stats">
                          <span>Regime: <strong className="regime-tag">{liveIndicators?.regime ?? "Analyzing"}</strong></span>
                          <span>Avg Bar: <strong>{liveIndicators ? `${liveIndicators.rangePct.toFixed(2)}%` : "n/a"}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Institutional Strategy Frameworks */}
                    <div className="preflight-frameworks-section">
                      <div className="frameworks-heading">
                        <span>Institutional Strategy Lenses (Click to Seed Prompt)</span>
                      </div>
                      <div className="frameworks-grid">
                        <button
                          type="button"
                          className="framework-card-btn"
                          onClick={() => setQuestion(`Analyze ${symbol} on the ${interval} chart using Elliott Wave theory. Map the current impulse (waves 1-5) or corrective (A-B-C) structure, key Fibonacci retracement targets, and price levels that invalidate the count.`)}
                        >
                          <div className="framework-btn-header">
                            <span className="framework-icon"><Icon name="wave" size={15} /></span>
                            <strong>Elliott Wave Cycle</strong>
                          </div>
                          <p>Impulse vs corrective wave count with Fibonacci invalidation pivots.</p>
                        </button>

                        <button
                          type="button"
                          className="framework-card-btn"
                          onClick={() => setQuestion(`Assess ${symbol} on ${interval} using the Wyckoff Method. Determine whether current price action represents Accumulation (Phase C/Spring) or Distribution (UTAD), referencing volume spread.`)}
                        >
                          <div className="framework-btn-header">
                            <span className="framework-icon"><Icon name="columns" size={15} /></span>
                            <strong>Wyckoff Structure</strong>
                          </div>
                          <p>Phase assessment: Accumulation Spring vs Distribution UTAD with volume check.</p>
                        </button>

                        <button
                          type="button"
                          className="framework-card-btn"
                          onClick={() => setQuestion(`Analyze ${symbol} ${interval} through Smart Money Concepts (SMC). Identify unmitigated Fair Value Gaps (FVG), order blocks, and where institutional liquidity pools reside.`)}
                        >
                          <div className="framework-btn-header">
                            <span className="framework-icon"><Icon name="target" size={15} /></span>
                            <strong>SMC &amp; Liquidity</strong>
                          </div>
                          <p>Fair value gaps (FVG), order blocks, and institutional liquidity sweeps.</p>
                        </button>

                        <button
                          type="button"
                          className="framework-card-btn"
                          onClick={() => setQuestion(`Evaluate multi-indicator confluence on ${symbol} ${interval}. Compare 20/50 EMA slope, RSI momentum divergence, and Bollinger Band width to formulate a high-probability trade hypothesis.`)}
                        >
                          <div className="framework-btn-header">
                            <span className="framework-icon"><Icon name="bolt" size={15} /></span>
                            <strong>Quant Confluence</strong>
                          </div>
                          <p>20/50 EMA slope, RSI divergence, and Bollinger Band expansion check.</p>
                        </button>
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="research-context-sidebar" aria-label="Market context and scope">
                  {/* 1. Live Market Snapshot */}
                  <div className="panel research-context-card research-market-card">
                    <div className="context-card-header">
                      <div className="market-cell-wrap">
                        <span className="market-mark">{symbol.slice(0, 3)}</span>
                        <div>
                          <strong>{symbol}</strong>
                          <span className="market-spot-tag">Bitget Spot</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="desk-shortcut-btn"
                        onClick={() => setView("desk")}
                        title={`View ${symbol} interactive chart on Market Desk`}
                      >
                        Chart <Icon name="arrow" size={11} />
                      </button>
                    </div>

                    <div className="market-card-price-row">
                      <strong className="market-card-price">
                        {market ? formatMoney(market.price) : "Loading quote…"}
                      </strong>
                      {market ? (
                        <span className={`pnl-pill ${market.change24h >= 0 ? "pnl-up" : "pnl-down"}`}>
                          {market.change24h >= 0 ? "+" : ""}{market.change24h.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>

                    <div className="market-card-stats-grid">
                      <div>
                        <span>24h High</span>
                        <strong>{market ? formatMoney(market.high24h) : "n/a"}</strong>
                      </div>
                      <div>
                        <span>24h Low</span>
                        <strong>{market ? formatMoney(market.low24h) : "n/a"}</strong>
                      </div>
                      <div>
                        <span>24h Turnover</span>
                        <strong>{market ? formatCompact(market.turnover24h) : "n/a"}</strong>
                      </div>
                      <div>
                        <span>Regime</span>
                        <strong className="regime-tag">{liveIndicators ? liveIndicators.regime : "Analyzing…"}</strong>
                      </div>
                    </div>
                  </div>

                  {/* 2. AI Analysis Engine Scope */}
                  <div className="panel research-context-card research-scope-card">
                    <div className="scope-card-header">
                      <div>
                        <div className="scope-title">
                          <Icon name="shield" size={14} />
                          <strong>Data Fed to AI</strong>
                        </div>
                        <p className="scope-subtitle">Live exchange inputs injected into your prompt</p>
                      </div>
                      <span className="scope-model-pill" title={`Active model: ${aiModel ?? "Default"}`}>
                        {aiModel ? aiModel.split("/").pop() : "Model active"}
                      </span>
                    </div>
                    <ul className="scope-checklist">
                      <li>
                        <span className="scope-check"><Icon name="check" size={10} /></span>
                        <div>
                          <strong>Bitget Spot Candles</strong>
                          <small>100 completed {interval} bars with volume</small>
                        </div>
                      </li>
                      <li>
                        <span className="scope-check"><Icon name="check" size={10} /></span>
                        <div>
                          <strong>EMA 20 &amp; EMA 50 Alignment</strong>
                          <small>{liveIndicators && liveIndicators.ema20 ? `${formatMoney(liveIndicators.ema20)} vs ${formatMoney(liveIndicators.ema50 ?? 0)}` : "Computed per bar"}</small>
                        </div>
                      </li>
                      <li>
                        <span className="scope-check"><Icon name="check" size={10} /></span>
                        <div>
                          <strong>RSI (14) Momentum</strong>
                          <small>{liveIndicators ? `Current: ${liveIndicators.rsi14.toFixed(1)}` : "14-period Wilder smoothing"}</small>
                        </div>
                      </li>
                      <li>
                        <span className="scope-check"><Icon name="check" size={10} /></span>
                        <div>
                          <strong>Top-of-Book Spread &amp; Depth</strong>
                          <small>Current liquidity friction snapshot</small>
                        </div>
                      </li>
                    </ul>
                  </div>

                  {/* 3. Recent Saved Briefs */}
                  <div className="panel research-context-card research-recent-card">
                    <div className="recent-card-header">
                      <strong>Recent Saved Briefs</strong>
                      <button
                        type="button"
                        className="view-journal-link"
                        onClick={() => setView("journal")}
                      >
                        Journal ({journal.length}) <Icon name="arrow" size={11} />
                      </button>
                    </div>
                    {journal.length ? (
                      <div className="recent-briefs-list">
                        {journal.slice(-3).reverse().map((item) => (
                          <article
                            key={item.id}
                            className="recent-brief-item"
                            onClick={() => { setSelectedJournalItem(item); setView("journal"); }}
                          >
                            <div className="recent-brief-top">
                              <div className="recent-brief-asset">
                                <span className="asset-tag">{item.symbol}</span>
                                <span className="interval-tag">{item.interval}</span>
                              </div>
                              <span className="recent-brief-date">{formatDate(item.createdAt, false)}</span>
                            </div>
                            <p className="recent-brief-q">&ldquo;{item.question}&rdquo;</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="no-recent-briefs">
                        No saved briefs yet. Completed market research is automatically preserved in your Journal.
                      </p>
                    )}
                  </div>
                </aside>
              </div>

              {researchLoading ? (
                <ResearchLoadingSkeleton
                  symbol={symbol}
                  interval={interval}
                  elapsed={researchElapsed}
                  aiModel={aiModel}
                  includeWebResearch={includeWebResearch}
                  onStop={cancelResearch}
                />
              ) : report ? (
                <ReportPanel
                  report={report}
                  onPaper={() => { setOrderOpen(true); setPaperMessage(""); }}
                  onBacktest={handleBacktestFromReport}
                  onExportSnapshot={openResearchCardModal}
                />
              ) : (
                <section className="panel research-starter-guide" aria-label="Research starter guide">
                  <div className="guide-header">
                    <div className="guide-badge">
                      <Icon name="research" size={13} />
                      <span>Quantitative Research Framework</span>
                    </div>
                    <h2>Formulate an institutional market hypothesis.</h2>
                    <p>
                      The AI engine combines Bitget completed candle bars, exponential moving averages, and order book spread into a structured dual-thesis brief.
                    </p>
                  </div>
                  <div className="guide-cards-grid">
                    <div className="guide-card" onClick={() => setQuestion(`Analyze ${symbol} on the ${interval} chart. Show both sides and what would change the read.`)}>
                      <div className="guide-card-icon"><Icon name="trending" size={16} /></div>
                      <h3>Structure &amp; Multi-Horizon Trend</h3>
                      <p>Inspect higher-high progression, EMA 20/50 support shelves, and multi-day returns across 24h, 72h, and 168h windows.</p>
                      <span className="guide-card-action">Use hypothesis &rarr;</span>
                    </div>
                    <div className="guide-card" onClick={() => setQuestion(`Evaluate RSI momentum, 20/50 EMA structure, and volume confirmation on ${symbol} ${interval}.`)}>
                      <div className="guide-card-icon"><Icon name="scan" size={16} /></div>
                      <h3>Momentum &amp; Volume Exhaustion</h3>
                      <p>Detect RSI divergence, 20-bar volume acceleration, and whether recent tests of resistance happened on thin liquidity.</p>
                      <span className="guide-card-action">Use hypothesis &rarr;</span>
                    </div>
                    <div className="guide-card" onClick={() => setQuestion(`Identify immediate calculated support, overhead resistance, and structural invalidation levels for ${symbol} on the ${interval}.`)}>
                      <div className="guide-card-icon"><Icon name="shield" size={16} /></div>
                      <h3>Key Levels &amp; Trade Invalidation</h3>
                      <p>Define precise price markers where the prevailing directional bias fails, preventing high-slippage emotional exits.</p>
                      <span className="guide-card-action">Use hypothesis &rarr;</span>
                    </div>
                  </div>
                </section>
              )}
            </>
          ) : null}

          {view === "backtests" ? (
            <>
              <div className="page-heading"><div><p className="page-kicker">Strategy lab</p><h1>Test the rule, then inspect the trades.</h1><p className="page-subtitle">Describe an entry and exit. AI compiles it into a supported rule; the simulator calculates results from completed Bitget candles.</p></div></div>
              <ModelReadiness configured={aiConfigured} model={aiModel} />
              <form className="panel strategy-builder" onSubmit={(event) => { event.preventDefault(); void runBacktest(); }}>
                {seededResearchReport ? (
                  <div className="research-seed-banner">
                    <div className="seed-banner-content">
                      <span className="seed-badge"><Icon name="research" size={12} /> Seeded from Research Brief</span>
                      <span className="seed-title">{seededResearchReport.symbol} ({seededResearchReport.interval})</span>
                      <span className="seed-question">&ldquo;{seededResearchReport.question}&rdquo;</span>
                    </div>
                    <div className="seed-banner-actions">
                      <button type="button" className="seed-return-btn" onClick={() => setView("research")}>View brief</button>
                      <button type="button" className="seed-dismiss-btn" onClick={() => setSeededResearchReport(null)} title="Clear research hypothesis link" aria-label="Clear"><Icon name="close" size={11} /></button>
                    </div>
                  </div>
                ) : null}
                <div className="strategy-builder-controls">
                  <label className="strategy-symbol" htmlFor="backtest-symbol"><span>Market</span><select id="backtest-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)}>{selectableSymbols.map((asset) => <option key={asset}>{asset}</option>)}</select></label>
                  <label className="interval-control"><span>Test interval</span><select value={interval} onChange={(event) => { const nextInterval = event.target.value; setInterval(nextInterval); if (!supportsBacktestWindow(nextInterval, backtestDays)) setBacktestDays(nextInterval === "1D" ? 90 : 30); }} aria-label="Backtest interval">{["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label className="backtest-control"><span>History window</span><select value={backtestDays} onChange={(event) => setBacktestDays(Number(event.target.value))}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days} disabled={!supportsBacktestWindow(interval, days)}>{days} days</option>)}</select></label>
                  <label className="backtest-control"><span>Fee / fill (bps)</span><input type="number" min="0" max="1000" step="1" value={feeBps} onChange={(event) => setFeeBps(Number(event.target.value))} /></label>
                  <label className="backtest-control"><span>Slippage / fill (bps)</span><input type="number" min="0" max="1000" step="1" value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} /></label>
                  <button type="button" className="browse-markets-button" onClick={() => { setInstrumentQuery(""); setPickerOpen(true); }}><Icon name="search" size={13} /> Browse markets</button>
                </div>
                <label className="strategy-prompt-label" htmlFor="strategy-prompt">Describe the entry and exit rule</label>
                <textarea id="strategy-prompt" className="strategy-prompt-input" rows={3} maxLength={600} value={strategyPrompt} onChange={(event) => setStrategyPrompt(event.target.value)} placeholder="Example: Go long when the 20 EMA crosses above the 50 EMA; exit on the reverse cross." />
                <div className="strategy-builder-footer">
                  <p>Supports long-only EMA crossovers and RSI mean reversion. No leverage, shorts, or stop-loss / take-profit execution. Fills use the next candle open with {(feeBps / 100).toFixed(2)}% fee, current top-of-book spread when available, and {slippageBps} bps slippage per fill.</p>
                  {backtestLoading ? (
                    <div className="backtest-loading-actions">
                      <button type="button" className="button button-primary is-loading" disabled>
                        <span className="button-spinner" />
                        <span>Replaying candles ({backtestElapsed.toFixed(1)}s)…</span>
                      </button>
                      <button
                        type="button"
                        className="button button-danger research-cancel-btn"
                        onClick={cancelBacktest}
                        title="Stop backtest simulation"
                        aria-label="Stop backtest simulation"
                      >
                        <span className="stop-square" />
                        <span>Stop Backtest</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={aiConfigured === false || strategyPrompt.trim().length < 8 || !supportsBacktestWindow(interval, backtestDays) || requestBusy.current || cooldownSeconds > 0}
                    >
                      {cooldownSeconds > 0
                        ? `Cooldown (${cooldownSeconds}s)`
                        : requestBusy.current
                        ? "Simulation in progress…"
                        : "Compile rule & run backtest"}
                    </button>
                  )}
                </div>
                <div className="playbook-save-row"><label><span>Save as a reusable Playbook (in Playbooks tab)</span><input value={playbookName} onChange={(event) => setPlaybookName(event.target.value)} maxLength={48} placeholder="e.g. BTC EMA trend pullback" /></label><button type="button" className="button button-secondary" onClick={saveCurrentPlaybook} disabled={strategyPrompt.trim().length < 8}>Save Playbook</button><button type="button" className="button button-secondary" onClick={() => setView("playbooks")} title="View saved playbooks library"><Icon name="playbook" size={13} /> View Playbooks ({playbooks.length})</button></div>
                {playbookMessage ? <p className="playbook-message" role="status">{playbookMessage}</p> : null}
              </form>
              {backtestLoading ? (
                <BacktestLoadingStatus
                  symbol={symbol}
                  interval={interval}
                  days={backtestDays}
                  elapsed={backtestElapsed}
                  aiModel={aiModel}
                  onStop={cancelBacktest}
                />
              ) : null}
              {backtestError ? (
                <div className="research-error-group">
                  <div className="error-banner compact-error" role="alert">
                    <div>
                      <strong>Backtest could not run</strong>
                      <span>{backtestError}</span>
                    </div>
                    <button className="button button-secondary" onClick={() => setView("settings")}>AI settings</button>
                  </div>
                  <RequestRecovery retryAt={aiRetryAt} busy={researchLoading || backtestLoading} onRetry={() => void runBacktest()} />
                </div>
              ) : null}
              {backtest ? <>
                <section className="panel workflow-handoff"><div><h2>Continue this study in Paper</h2><p>Save the compiled rule and its results with your next simulated entry. Research links follow the trade into Review.</p></div><button type="button" className="button button-primary" onClick={paperFromBacktest}>Use tested strategy in Paper</button></section>
                <div className="backtest-meta-strip">
                  <div className="meta-chip meta-chip-market">
                    <Icon name="grid" size={12} />
                    <span className="chip-label"><strong>{backtest.symbol}</strong> ({backtest.interval})</span>
                    <span className="chip-sep">·</span>
                    <span>{backtest.lookbackDays}D Window</span>
                  </div>
                  <div className="meta-chip">
                    <Icon name="calendar" size={12} />
                    <span>{formatDate(backtest.startAt, false)} → {formatDate(backtest.endAt, false)}</span>
                  </div>
                  <div className="meta-chip">
                    <Icon name="check" size={12} />
                    <span><strong>{backtest.barsTested.toLocaleString()}</strong> completed bars (Bitget spot)</span>
                  </div>
                  <div className="meta-chip meta-chip-compiler">
                    <Icon name="cpu" size={12} />
                    <span>Rule compiled by <code>{backtest.model}</code></span>
                  </div>
                </div>

                {backtest.coverage ? (
                  <section className="panel coverage-report" aria-label="Data coverage audit">
                    <div className="coverage-header">
                      <div className="coverage-title-group">
                        <div className="coverage-tag">
                          <Icon name="database" size={12} />
                          <span>DATA INTEGRITY AUDIT</span>
                        </div>
                        <h2>Historical Data Coverage & Feed Health</h2>
                      </div>
                      <div className={`coverage-health-pill ${backtest.coverage.missingInsideRange === 0 ? "healthy" : "warning"}`}>
                        <span className="health-dot" />
                        <span>{backtest.coverage.missingInsideRange === 0 ? "100% Continuous Feed · 0 Gaps" : `${backtest.coverage.missingInsideRange} Missing Bars Detected`}</span>
                      </div>
                    </div>

                    <div className="coverage-stats-grid">
                      <div className="coverage-stat-card">
                        <div className="coverage-stat-top">
                          <span className="stat-label">Candles Received</span>
                          <span className="stat-pct">
                            {Math.min(100, Math.round((backtest.coverage.receivedBars / Math.max(1, backtest.coverage.expectedBars)) * 100))}%
                          </span>
                        </div>
                        <div className="stat-main-num">
                          <strong>{backtest.coverage.receivedBars.toLocaleString()}</strong>
                          <small>/ {backtest.coverage.expectedBars.toLocaleString()} expected</small>
                        </div>
                        <div className="coverage-bar-track">
                          <div
                            className="coverage-bar-fill"
                            style={{
                              width: `${Math.min(100, Math.round((backtest.coverage.receivedBars / Math.max(1, backtest.coverage.expectedBars)) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="coverage-stat-card">
                        <div className="coverage-stat-top">
                          <span className="stat-label">Feed Discontinuities</span>
                          <span className={`stat-badge ${backtest.coverage.missingInsideRange === 0 ? "badge-success" : "badge-warn"}`}>
                            {backtest.coverage.missingInsideRange === 0 ? "0 Gaps" : `${backtest.coverage.missingInsideRange} Gaps`}
                          </span>
                        </div>
                        <div className="stat-main-num">
                          <strong>{backtest.coverage.missingInsideRange}</strong>
                          <small>missing bars in window</small>
                        </div>
                        <span className="stat-subtext">
                          {backtest.coverage.missingInsideRange === 0 ? "Continuous candle timestamps" : "Gaps may distort historical fills"}
                        </span>
                      </div>

                      <div className="coverage-stat-card">
                        <div className="coverage-stat-top">
                          <span className="stat-label">Indicator Warmup</span>
                          <span className="stat-badge badge-neutral">Offset</span>
                        </div>
                        <div className="stat-main-num">
                          <strong>{backtest.coverage.receivedBars - backtest.barsTested}</strong>
                          <small>bars seeded</small>
                        </div>
                        <span className="stat-subtext">Initial history for EMA / RSI convergence</span>
                      </div>

                      <div className="coverage-stat-card">
                        <div className="coverage-stat-top">
                          <span className="stat-label">Archive Span</span>
                          <span className="stat-badge badge-neutral">Bitget Spot</span>
                        </div>
                        <div className="stat-date-span">
                          <span>{formatDate(backtest.coverage.firstCandle)}</span>
                          <span className="date-arrow">→</span>
                          <span>{formatDate(backtest.coverage.lastCandle)}</span>
                        </div>
                        <span className="stat-subtext">Requested: {formatDate(backtest.coverage.requestedStart, false)} → {formatDate(backtest.coverage.requestedEnd, false)}</span>
                      </div>
                    </div>

                    {backtest.coverage.missingInsideRange > 0 || backtest.coverage.receivedBars < backtest.coverage.expectedBars - 1 ? (
                      <div className="coverage-warning-banner" role="alert">
                        <Icon name="alert" size={14} />
                        <span>History is incomplete. Indicators and returns use available bars; gaps can change signals and results.</span>
                      </div>
                    ) : null}

                    <div className="coverage-audit-callout">
                      <Icon name="info" size={14} />
                      <p>
                        <strong>Holdout & Overfitting Protocol:</strong> Holdout results use the exact same compiled rule on an out-of-sample period to detect curve-fitting. Repeated parameter tuning after viewing holdout metrics erodes independence. The return ratio compares periods of different lengths and is not an annualized stability measure.
                      </p>
                    </div>
                  </section>
                ) : null}

                <section className="panel strategy-summary" aria-label="Compiled strategy rule">
                  <div className="strategy-summary-header">
                    <div className="strategy-summary-kicker">
                      <Icon name="sparkles" size={13} />
                      <span>COMPILED QUANTITATIVE RULE BLUEPRINT</span>
                    </div>
                    <div className="strategy-kind-badge">
                      <span className="kind-icon"><Icon name={backtest.strategy.kind === "ema_cross" ? "trending" : "refresh"} size={14} /></span>
                      <span className="kind-title">
                        {backtest.strategy.kind === "ema_cross" ? "EMA Trend Following" : "RSI Mean Reversion"}
                      </span>
                      <span className="kind-params">
                        {backtest.strategy.kind === "ema_cross"
                          ? `EMA ${backtest.strategy.fastPeriod} / ${backtest.strategy.slowPeriod}`
                          : `RSI (${backtest.strategy.rsiPeriod}) Entry <${backtest.strategy.entryBelow} / Exit >${backtest.strategy.exitAbove}`}
                      </span>
                    </div>
                  </div>

                  <div className="strategy-rule-card">
                    <div className="rule-card-label">Executable Rule Logic</div>
                    <h2 className="rule-summary-text">{backtest.strategy.summary}</h2>

                    <div className="rule-trigger-chips">
                      {backtest.strategy.kind === "ema_cross" ? (
                        <>
                          <span className="rule-chip entry">
                            <strong>Entry:</strong> Fast EMA ({backtest.strategy.fastPeriod}) crosses above Slow EMA ({backtest.strategy.slowPeriod})
                          </span>
                          <span className="rule-chip exit">
                            <strong>Exit:</strong> Fast EMA ({backtest.strategy.fastPeriod}) crosses below Slow EMA ({backtest.strategy.slowPeriod})
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="rule-chip entry">
                            <strong>Entry:</strong> RSI ({backtest.strategy.rsiPeriod}) drops below {backtest.strategy.entryBelow} (Oversold)
                          </span>
                          <span className="rule-chip exit">
                            <strong>Exit:</strong> RSI ({backtest.strategy.rsiPeriod}) exceeds {backtest.strategy.exitAbove} (Mean Reverted)
                          </span>
                        </>
                      )}
                      <span className="rule-chip execution">
                        <strong>Execution:</strong> Next candle open
                      </span>
                      <span className="rule-chip constraints">
                        <strong>Constraints:</strong> Long-only · Spot fills · No leverage
                      </span>
                    </div>
                  </div>

                  {backtest.strategy.rationale ? (
                    <div className="strategy-compiler-notes">
                      <div className="compiler-note-header">
                        <Icon name="shield" size={12} />
                        <span>Compiler Rationale & Parameters</span>
                      </div>
                      <p className="compiler-note-body">{backtest.strategy.rationale}</p>
                    </div>
                  ) : null}
                </section>
                <section className="backtest-grid">
                  <div className="panel backtest-chart-panel"><div className="panel-heading"><div><h2>Portfolio value</h2><p>Simulated account balance across the test window.</p></div></div><EquityChart points={backtest.equity} /></div>
                  <div className="panel metrics-panel"><div className="panel-heading"><div><h2>Result summary</h2><p>Computed from the simulated fills.</p></div></div><div className="result-balance"><span>Ending balance</span><strong>{formatMoney(backtest.endingBalance)}</strong><small className={backtest.returnPct >= 0 ? "tone-up" : "tone-down"}>{backtest.returnPct >= 0 ? "+" : ""}{backtest.returnPct.toFixed(2)}% strategy return</small></div><div className="result-metrics"><Stat label="Buy & hold" value={`${backtest.buyAndHoldPct >= 0 ? "+" : ""}${backtest.buyAndHoldPct.toFixed(2)}%`} tone={backtest.buyAndHoldPct >= 0 ? "up" : "down"} /><Stat label="Max drawdown" value={`−${backtest.maxDrawdownPct.toFixed(2)}%`} tone="down" /><Stat label="Closed trades" value={String(backtest.closedTrades)} /><Stat label="Win rate" value={backtest.closedTrades ? `${backtest.winRatePct.toFixed(1)}%` : "n/a"} /><Stat label="Sharpe ratio" value={backtest.sharpeRatio.toFixed(2)} /><Stat label="Fee per fill" value={`${backtest.feePctPerFill}%`} /><Stat label="Spread assumption" value={`${backtest.spreadBps.toFixed(2)} bps · ${backtest.spreadSource === "fallback" ? "fallback" : "current"}`} /><Stat label="Slippage / fill" value={`${backtest.slippageBps} bps`} /></div><p className="fine-print">Long-only, no leverage. Fills use next-bar opens, fees on each side, and half the current top-of-book spread plus slippage per fill. A current spread snapshot approximates historical execution; a 2 bps fallback is used if Bitget’s order book is unavailable. Open positions are liquidated at the final close. Results are simulations; historical performance does not predict future returns.</p></div>
                </section>
                {backtest.robustness ? (
                  <section className="panel backtest-credibility-panel" aria-label="Backtest robustness and credibility scorecard">
                    <div className="panel-heading">
                      <div>
                        <h2>Backtest evidence</h2>
                        <p>Cost sensitivity and sample diagnostics. Ratings are simple heuristics, not statistical confidence or a trading recommendation.</p>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={openBacktestCardModal}
                          style={{ padding: "0.35rem 0.75rem", fontSize: "0.78rem" }}
                          title="Export institutional strategy brief card PNG"
                        >
                          <Icon name="scan" size={13} /> Export Strategy Card
                        </button>
                        <span className={`rating-pill rating-${backtest.robustness.robustnessRating}`}>
                          {backtest.robustness.robustnessRating === "high"
                            ? "Positive sample checks"
                            : backtest.robustness.robustnessRating === "moderate"
                              ? "Mixed sample checks"
                              : "Limited or weak sample"}
                        </span>
                      </div>
                    </div>
                    <div className="credibility-grid">
                      <div className="credibility-cell">
                        <span>Strategy Alpha</span>
                        <strong className={backtest.robustness.alphaPct >= 0 ? "tone-up" : "tone-down"}>
                          {backtest.robustness.alphaPct >= 0 ? "+" : ""}{backtest.robustness.alphaPct.toFixed(2)}%
                        </strong>
                        <small>Excess return over holding spot through full cycle</small>
                      </div>
                      <div className="credibility-cell">
                        <span>Out-of-sample Retention</span>
                        <strong className={backtest.robustness.outOfSampleDecayPct !== null && backtest.robustness.outOfSampleDecayPct >= 70 ? "tone-up" : backtest.robustness.outOfSampleDecayPct !== null && backtest.robustness.outOfSampleDecayPct < 40 ? "tone-down" : ""}>
                          {backtest.robustness.outOfSampleDecayPct !== null ? `${backtest.robustness.outOfSampleDecayPct}%` : "n/a"}
                        </strong>
                        <small>{backtest.robustness.outOfSampleDecayPct !== null && backtest.robustness.outOfSampleDecayPct >= 70 ? "Preserved across unseen candles" : "Return decayed in holdout period"}</small>
                      </div>
                      <div className="credibility-cell">
                        <span>Breakeven Cost Ceiling</span>
                        <strong>
                          {backtest.robustness.breakevenFeeBps !== null ? `${backtest.robustness.breakevenFeeBps} bps` : "n/a"}
                        </strong>
                        <small>Max fee/fill before strategy loses net alpha</small>
                      </div>
                      <div className="credibility-cell">
                        <span>Max Drawdown Duration</span>
                        <strong>
                          {backtest.robustness.maxDrawdownDurationBars} bars
                        </strong>
                        <small>Longest streak spent underwater</small>
                      </div>
                    </div>
                    {backtest.robustness.isStatisticallyFragile ? (
                      <p className="credibility-warning">
                        <strong>Sample size notice:</strong> Only {backtest.closedTrades} trades occurred in this window. High variance may distort metrics; test over 90 to 365 days before drawing trading conclusions.
                      </p>
                    ) : null}
                  </section>
                ) : null}
                {backtest.validation ? (
                  <section className="panel validation-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Chronological holdout</h2>
                        <p>
                          70% earlier candles (Training) / 30% later candles (Holdout). Each period starts with an independent {formatMoney(backtest.startingBalance)} account; earlier candles warm up indicators before the holdout begins.
                        </p>
                      </div>
                      <span className="validation-date-pill">Holdout starts {formatDate(backtest.validation.splitAt, false)}</span>
                    </div>

                    <div className="validation-cards-grid">
                      {/* In-Sample Card */}
                      <div className="validation-card in-sample-card">
                        <div className="validation-card-top">
                          <div>
                            <span className="validation-phase-label">Training Phase (70%)</span>
                            <h3>In-Sample</h3>
                          </div>
                          <span className="bars-count-pill">{backtest.validation.inSample.barsTested} bars</span>
                        </div>
                        <div className="validation-hero-stat">
                          <span className="hero-stat-label">Strategy Return</span>
                          <span className={`hero-stat-value ${backtest.validation.inSample.returnPct >= 0 ? "tone-up" : "tone-down"}`}>
                            {formatPercent(backtest.validation.inSample.returnPct)}
                          </span>
                          <span className="hero-stat-benchmark">
                            vs {formatPercent(backtest.validation.inSample.buyAndHoldPct)} Buy &amp; Hold (Alpha: {formatPercent(backtest.validation.inSample.returnPct - backtest.validation.inSample.buyAndHoldPct)})
                          </span>
                        </div>
                        <div className="validation-metrics-strip">
                          <div className="val-metric-cell">
                            <span>Closed Trades</span>
                            <strong>{backtest.validation.inSample.closedTrades}</strong>
                          </div>
                          <div className="val-metric-cell">
                            <span>Max Drawdown</span>
                            <strong className="tone-down">-{backtest.validation.inSample.maxDrawdownPct.toFixed(2)}%</strong>
                          </div>
                          <div className="val-metric-cell">
                            <span>Benchmark B&amp;H</span>
                            <strong>{formatPercent(backtest.validation.inSample.buyAndHoldPct)}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Out-of-Sample Card */}
                      <div className="validation-card out-sample-card">
                        <div className="validation-card-top">
                          <div>
                            <span className="validation-phase-label">Validation Phase (30%)</span>
                            <h3>Out-of-Sample (Unseen)</h3>
                          </div>
                          <span className="bars-count-pill highlight-pill">{backtest.validation.outOfSample.barsTested} bars</span>
                        </div>
                        <div className="validation-hero-stat">
                          <span className="hero-stat-label">Holdout Return</span>
                          <span className={`hero-stat-value ${backtest.validation.outOfSample.returnPct >= 0 ? "tone-up" : "tone-down"}`}>
                            {formatPercent(backtest.validation.outOfSample.returnPct)}
                          </span>
                          <span className="hero-stat-benchmark">
                            vs {formatPercent(backtest.validation.outOfSample.buyAndHoldPct)} Buy &amp; Hold (Alpha: {formatPercent(backtest.validation.outOfSample.returnPct - backtest.validation.outOfSample.buyAndHoldPct)})
                          </span>
                        </div>
                        <div className="validation-metrics-strip">
                          <div className="val-metric-cell">
                            <span>Closed Trades</span>
                            <strong>{backtest.validation.outOfSample.closedTrades}</strong>
                          </div>
                          <div className="val-metric-cell">
                            <span>Max Drawdown</span>
                            <strong className="tone-down">-{backtest.validation.outOfSample.maxDrawdownPct.toFixed(2)}%</strong>
                          </div>
                          <div className="val-metric-cell">
                            <span>Benchmark B&amp;H</span>
                            <strong>{formatPercent(backtest.validation.outOfSample.buyAndHoldPct)}</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="validation-fine-print">
                      <Icon name="shield" size={14} />
                      <p>
                        The strategy parameters are compiled from your prompt and held constant across both periods without retrospective re-fitting. This is an objective single historical slice designed to expose overfitting, not a guarantee of future live execution.
                      </p>
                    </div>
                  </section>
                ) : null}
                <MonteCarloPanel trades={backtest.trades} startingBalance={backtest.startingBalance} />
                {parameterMatrix ? (
                  <ParameterHeatmap
                    matrix={parameterMatrix}
                    onApplyParameters={(paramA, paramB) => {
                      if (parameterMatrix.kind === "ema_cross") {
                        setStrategyPrompt(`Go long when the ${paramA}-period EMA crosses above the ${paramB}-period EMA. Exit when the ${paramA} EMA crosses below the ${paramB} EMA.`);
                      } else {
                        setStrategyPrompt(`Buy when RSI (14) drops below ${paramA}. Exit when RSI (14) rises above ${paramB}.`);
                      }
                      window.scrollTo({ top: 180, behavior: "smooth" });
                    }}
                  />
                ) : null}
                {backtest.trades.length > 0 && (() => {
                  const bestTrade = [...backtest.trades].sort((a, b) => b.pnl - a.pnl)[0];
                  const worstTrade = [...backtest.trades].sort((a, b) => a.pnl - b.pnl)[0];
                  return (
                    <div className="backtest-trade-highlights" aria-label="Trade replay highlights">
                      {bestTrade && (
                        <div className="panel backtest-highlight-card is-best">
                          <div className="highlight-header">
                            <span className="highlight-badge is-best">Best Simulated Trade</span>
                            <span className="highlight-time">{formatDate(bestTrade.entryAt)}</span>
                          </div>
                          <div className="highlight-body">
                            <div className="highlight-stat-main">
                              <strong className="tone-up">+{bestTrade.returnPct.toFixed(2)}%</strong>
                              <small className="tone-up">+{formatMoney(bestTrade.pnl)}</small>
                            </div>
                            <div className="highlight-meta-grid">
                              <div><span>Entry</span><strong>${formatPrice(bestTrade.entryPrice)}</strong></div>
                              <div><span>Exit</span><strong>${formatPrice(bestTrade.exitPrice)}</strong></div>
                              <div><span>Holding</span><strong>{bestTrade.barsHeld} bar{bestTrade.barsHeld === 1 ? "" : "s"}</strong></div>
                            </div>
                          </div>
                          <div className="highlight-footer">
                            <button
                              type="button"
                              className="button button-secondary highlight-replay-btn"
                              onClick={() => replayFromBacktestTrade(bestTrade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt)}
                              title="Replay this best trade bar-by-bar in Trade Replay Studio"
                            >
                              <Icon name="replay" size={13} />
                              <span>Replay Best Trade</span>
                            </button>
                          </div>
                        </div>
                      )}
                      {worstTrade && worstTrade.pnl < 0 && (
                        <div className="panel backtest-highlight-card is-worst">
                          <div className="highlight-header">
                            <span className="highlight-badge is-worst">Max Drawdown Trade</span>
                            <span className="highlight-time">{formatDate(worstTrade.entryAt)}</span>
                          </div>
                          <div className="highlight-body">
                            <div className="highlight-stat-main">
                              <strong className="tone-down">{worstTrade.returnPct.toFixed(2)}%</strong>
                              <small className="tone-down">{formatMoney(worstTrade.pnl)}</small>
                            </div>
                            <div className="highlight-meta-grid">
                              <div><span>Entry</span><strong>${formatPrice(worstTrade.entryPrice)}</strong></div>
                              <div><span>Exit</span><strong>${formatPrice(worstTrade.exitPrice)}</strong></div>
                              <div><span>Holding</span><strong>{worstTrade.barsHeld} bar{worstTrade.barsHeld === 1 ? "" : "s"}</strong></div>
                            </div>
                          </div>
                          <div className="highlight-footer">
                            <button
                              type="button"
                              className="button button-secondary highlight-replay-btn"
                              onClick={() => replayFromBacktestTrade(worstTrade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt)}
                              title="Inspect what broke during this drawdown trade in Trade Replay Studio"
                            >
                              <Icon name="replay" size={13} />
                              <span>Replay Drawdown Trade</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <section className="panel trade-log">
                  <div className="panel-heading">
                    <div>
                      <h2>Simulated trades</h2>
                      <p>
                        Showing the last {Math.min(20, backtest.trades.length)} of {backtest.trades.length} closed trade{backtest.trades.length === 1 ? "" : "s"} (newest execution first).
                      </p>
                    </div>
                    {backtest.trades.length > 0 ? (
                      <div className="trade-summary-chips">
                        <span className="trade-chip">
                          <small>Wins / Losses:</small>
                          <strong className="tone-up">{backtest.trades.filter((t) => t.pnl > 0).length}W</strong> / <strong className="tone-down">{backtest.trades.filter((t) => t.pnl < 0).length}L</strong>
                        </span>
                        <span className="trade-chip">
                          <small>Win Rate:</small>
                          <strong>{((backtest.trades.filter((t) => t.pnl > 0).length / backtest.trades.length) * 100).toFixed(1)}%</strong>
                        </span>
                        <span className="trade-chip">
                          <small>Total Net P&amp;L:</small>
                          <strong className={backtest.trades.reduce((sum, t) => sum + t.pnl, 0) >= 0 ? "tone-up" : "tone-down"}>
                            {formatMoney(backtest.trades.reduce((sum, t) => sum + t.pnl, 0))}
                          </strong>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {backtest.trades.length ? (
                    <div className="table-scroll">
                      <table className="simulated-trades-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Side</th>
                            <th>Opened</th>
                            <th>Closed</th>
                            <th style={{ textAlign: "right" }}>Entry Price</th>
                            <th style={{ textAlign: "right" }}>Exit Price</th>
                            <th style={{ textAlign: "right" }}>Return</th>
                            <th style={{ textAlign: "right" }}>Net P&amp;L</th>
                            <th style={{ textAlign: "center" }}>Duration</th>
                            <th style={{ textAlign: "center" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtest.trades
                            .slice(-20)
                            .reverse()
                            .map((trade, idx) => {
                              const tradeNum = backtest.trades.length - idx;
                              return (
                                <tr key={`${trade.entryAt}-${idx}`}>
                                  <td>
                                    <span className="trade-index-tag">#{tradeNum}</span>
                                  </td>
                                  <td>
                                    <span className="trade-side-pill side-long">LONG</span>
                                  </td>
                                  <td className="time-cell">
                                    <span className="time-primary">{formatDate(trade.entryAt)}</span>
                                  </td>
                                  <td className="time-cell">
                                    <span className="time-primary">{formatDate(trade.exitAt)}</span>
                                  </td>
                                  <td className="price-cell" style={{ textAlign: "right" }}>
                                    {formatPrice(trade.entryPrice)}
                                  </td>
                                  <td className="price-cell" style={{ textAlign: "right" }}>
                                    {formatPrice(trade.exitPrice)}
                                  </td>
                                  <td
                                    className={trade.returnPct >= 0 ? "tone-up" : "tone-down"}
                                    style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
                                  >
                                    {trade.returnPct >= 0 ? "+" : ""}
                                    {trade.returnPct.toFixed(2)}%
                                  </td>
                                  <td
                                    className={trade.pnl >= 0 ? "tone-up" : "tone-down"}
                                    style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
                                  >
                                    {formatMoney(trade.pnl)}
                                  </td>
                                  <td style={{ textAlign: "center" }}>
                                    <span className="bars-held-pill">{trade.barsHeld} bar{trade.barsHeld === 1 ? "" : "s"}</span>
                                  </td>
                                  <td style={{ textAlign: "center" }}>
                                    <button
                                      type="button"
                                      className="backtest-replay-row-btn"
                                      onClick={() => replayFromBacktestTrade(trade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt)}
                                      title="Replay this simulated trade on chart"
                                    >
                                      <Icon name="replay" size={12} />
                                      <span>Replay</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="table-empty">
                      <strong>No entries were triggered</strong>
                      <span>The compiled rule did not produce an entry in this candle window.</span>
                    </div>
                  )}
                </section>
              </> : (
                <section className="panel backtest-starter-panel" aria-label="Strategy templates">
                  <div className="panel-heading">
                    <div>
                      <div className="risk-heading-badge"><Icon name="backtest" size={12} /> <span>Strategy lab templates</span></div>
                      <h2>Select a quantitative rule template or describe your own.</h2>
                      <p>AI compiles your natural language description into a deterministic rule; completed Bitget candles simulate fills with realistic fees, slippage, and spread.</p>
                    </div>
                  </div>
                  <div className="strategy-templates-grid">
                    <div
                      className="strategy-template-card"
                      onClick={() => {
                        setSymbol("BTCUSDT");
                        setInterval("1H");
                        setBacktestDays(30);
                        setStrategyPrompt("Go long when the 20-period EMA crosses above the 50-period EMA. Exit when the 20 EMA crosses below the 50 EMA.");
                        window.scrollTo({ top: 180, behavior: "smooth" });
                      }}
                    >
                      <div className="template-card-header">
                        <span className="template-badge">EMA Crossover</span>
                        <span className="template-pair">BTCUSDT · 1H · 30d</span>
                      </div>
                      <h3>Classic 20/50 Trend Following</h3>
                      <p>Long-only trend capture using exponential moving averages. Enters on bullish golden cross; liquidates on reverse death cross.</p>
                      <div className="template-card-footer">
                        <span className="template-action-btn">Load template &rarr;</span>
                      </div>
                    </div>

                    <div
                      className="strategy-template-card"
                      onClick={() => {
                        setSymbol("ETHUSDT");
                        setInterval("15m");
                        setBacktestDays(14);
                        setStrategyPrompt("Enter long when 14-period RSI drops below 30 and crosses back above 30. Exit when RSI rises above 65.");
                        window.scrollTo({ top: 180, behavior: "smooth" });
                      }}
                    >
                      <div className="template-card-header">
                        <span className="template-badge">Mean Reversion</span>
                        <span className="template-pair">ETHUSDT · 15m · 14d</span>
                      </div>
                      <h3>RSI Oversold Bounce</h3>
                      <p>Exploits short-term liquidity purges. Buys oversold dips below RSI 30 upon re-entry; takes profits when momentum reaches 65.</p>
                      <div className="template-card-footer">
                        <span className="template-action-btn">Load template &rarr;</span>
                      </div>
                    </div>

                    <div
                      className="strategy-template-card"
                      onClick={() => {
                        setSymbol("SOLUSDT");
                        setInterval("4H");
                        setBacktestDays(90);
                        setStrategyPrompt("Go long when price is above the 50 EMA and the 20 EMA is rising. Exit when price closes below the 50 EMA.");
                        window.scrollTo({ top: 180, behavior: "smooth" });
                      }}
                    >
                      <div className="template-card-header">
                        <span className="template-badge">Trend Pullback</span>
                        <span className="template-pair">SOLUSDT · 4H · 90d</span>
                      </div>
                      <h3>High-Beta Trend Filter</h3>
                      <p>Filters for macro bullish regime on 4-hour candles. Catches dips into the 20 EMA while remaining protected by the 50 EMA baseline.</p>
                      <div className="template-card-footer">
                        <span className="template-action-btn">Load template &rarr;</span>
                      </div>
                    </div>

                    <div
                      className="strategy-template-card"
                      onClick={() => {
                        setSymbol("BTCUSDT");
                        setInterval("1D");
                        setBacktestDays(180);
                        setStrategyPrompt("Go long when EMA 9 crosses above EMA 21 on the daily chart. Exit on reverse cross with 5 bps slippage assumption.");
                        window.scrollTo({ top: 180, behavior: "smooth" });
                      }}
                    >
                      <div className="template-card-header">
                        <span className="template-badge">Macro Swing</span>
                        <span className="template-pair">BTCUSDT · 1D · 180d</span>
                      </div>
                      <h3>Daily Macro Momentum</h3>
                      <p>Tested over 180 days of Bitget daily spot candles. Captures sustained cyclical momentum while minimizing intraday noise.</p>
                      <div className="template-card-footer">
                        <span className="template-action-btn">Load template &rarr;</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          ) : null}

          {view === "replay" ? (
            <>
              <div className="page-heading replay-page-heading">
                <div>
                  <p className="page-kicker">HISTORICAL TAPE REPLAY // SIMULATION ENGINE</p>
                  <h1>Trade Replay Studio</h1>
                  <p className="page-subtitle">
                    Step candle-by-candle through historical Bitget market sessions, execute discretionary bracket orders, and inspect your tape discipline against real price action.
                  </p>
                </div>
                <div className="replay-header-actions">
                  <button
                    type="button"
                    className="replay-header-action-btn"
                    onClick={handleRestartReplay}
                    title="Reset replay session and restore starting $10,000 cash balance"
                  >
                    <Icon name="refresh" size={14} />
                    <span>Reset Capital ($10k)</span>
                  </button>
                  <button
                    type="button"
                    className="replay-header-scorecard-btn"
                    onClick={() => setScorecardModalOpen(true)}
                  >
                    <Icon name="backtest" size={14} />
                    <span>Performance Scorecard</span>
                    {replayWallet.closedTrades.length > 0 && (
                      <span className="replay-scorecard-badge">{replayWallet.closedTrades.length}</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Ribbon Controls: Symbol selector, Browse, Interval, and Tape As-Of readout */}
              <div className="panel replay-ribbon-bar">
                <div className="replay-ribbon-left">
                  <label className="replay-ribbon-label" htmlFor="replay-market-select">
                    <span>Market</span>
                    <select
                      id="replay-market-select"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      className="replay-ribbon-select"
                    >
                      {selectableSymbols.map((asset) => (
                        <option key={asset} value={asset}>{asset}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="browse-markets-button"
                    onClick={() => { setInstrumentQuery(""); setPickerOpen(true); }}
                  >
                    <Icon name="search" size={13} /> Browse
                  </button>
                  <div className="replay-interval-pills" role="radiogroup" aria-label="Replay candle interval">
                    {["1m", "5m", "15m", "1H", "4H", "1D"].map((intvl) => (
                      <button
                        key={intvl}
                        type="button"
                        className={`replay-interval-pill ${interval === intvl ? "active" : ""}`}
                        onClick={() => setInterval(intvl)}
                        role="radio"
                        aria-checked={interval === intvl}
                      >
                        {intvl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="replay-ribbon-right">
                  <div className="replay-tape-meta-chip">
                    <span className="replay-tape-meta-label">CURRENT MARK:</span>
                    <strong className="replay-tape-meta-price">
                      {currentReplayCandle ? `$${formatPrice(currentReplayCandle.close)}` : "--"}
                    </strong>
                    <span className="replay-tape-meta-time">
                      {currentReplayCandle ? formatDate(currentReplayCandle.time, false) : "Loading feed..."}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dedicated Historical Trade Review HUD Strip (when entering replay from a closed paper trade or backtest trade) */}
              {replayTargetTrade && (
                <div className="replay-review-hud" role="region" aria-label="Historical Trade Review Context">
                  <div className="replay-review-hud-left">
                    <span className="replay-review-tag">
                      <Icon name="replay" size={13} />
                      <span>{replayTargetTrade.origin === "paper" ? "Paper Review" : "Backtest Review"}</span>
                    </span>
                    <strong className="replay-review-symbol">{replayTargetTrade.symbol}</strong>
                    <span className={`replay-review-side ${replayTargetTrade.side === "buy" ? "is-long" : "is-short"}`}>
                      {replayTargetTrade.side === "buy" ? "LONG" : "SHORT"}
                    </span>
                    <span className="replay-review-metric">
                      Entry: <strong>${formatPrice(replayTargetTrade.entryPrice)}</strong>
                    </span>
                    <span className="replay-review-metric">
                      Exit: <strong>${formatPrice(replayTargetTrade.exitPrice)}</strong>
                    </span>
                    <span className={`replay-review-pnl ${replayTargetTrade.netPnl >= 0 ? "tone-up" : "tone-down"}`}>
                      {replayTargetTrade.netPnl >= 0 ? "+" : ""}{formatMoney(replayTargetTrade.netPnl)} ({replayTargetTrade.returnPct >= 0 ? "+" : ""}{replayTargetTrade.returnPct.toFixed(2)}%)
                    </span>
                    {replayTargetTrade.strategyLabel && (
                      <span className="replay-review-strategy" title={replayTargetTrade.strategyLabel}>
                        {replayTargetTrade.strategyLabel}
                      </span>
                    )}
                  </div>
                  <div className="replay-review-hud-actions">
                    <button
                      type="button"
                      className="button button-secondary replay-hud-action-btn"
                      onClick={handleJumpToSetup}
                      title="Rewind to 25 bars before trade entry to inspect setup formation"
                    >
                      <Icon name="history" size={13} />
                      <span>Setup (-25b)</span>
                    </button>
                    <button
                      type="button"
                      className="button button-secondary replay-hud-action-btn"
                      onClick={handleJumpToEntry}
                      title="Jump directly to entry bar"
                    >
                      <span>Entry Bar</span>
                    </button>
                    <button
                      type="button"
                      className="button button-secondary replay-hud-action-btn"
                      onClick={handleJumpToExit}
                      title="Jump directly to exit bar"
                    >
                      <span>Exit Bar</span>
                    </button>
                    <button
                      type="button"
                      className="button button-secondary replay-hud-exit-btn"
                      onClick={handleExitTradeReview}
                      title={`Return to ${replayTargetTrade.origin === "paper" ? "Paper Review" : "Backtests"}`}
                    >
                      <Icon name="close" size={13} />
                      <span>Return to {replayTargetTrade.origin === "paper" ? "Paper Review" : "Backtests"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Main 2-Column Replay Studio Grid */}
              <div className="replay-studio-grid">
                {/* Left Column: Price Chart + Docked Light Studio Transport Console */}
                <div className="replay-chart-column">
                  <section className="panel replay-chart-panel" aria-labelledby="replay-chart-heading">
                    <div className="panel-heading replay-chart-header">
                      <div>
                        <h2 id="replay-chart-heading">Historical Candlestick Action</h2>
                        <p className="replay-chart-subtitle">
                          {symbol} · {interval} · Bar {replayIndex + 1} of {market?.candles.length ?? 0}
                          {isCutMode ? " · [CUT MODE: click candle to rewind]" : ""}
                        </p>
                      </div>
                      <div className="replay-chart-header-actions">
                        <button
                          type="button"
                          className={`replay-cut-mode-btn ${isCutMode ? "is-active" : ""}`}
                          onClick={() => setIsCutMode((prev) => !prev)}
                          title="Toggle cut tool: click any bar on the chart to set starting point"
                          aria-pressed={isCutMode}
                        >
                          <span>{isCutMode ? "Selecting Bar..." : "Cut Bar Tool"}</span>
                        </button>
                        <span className="chart-source">Bitget Tape Feed</span>
                      </div>
                    </div>

                    {market ? (
                      <PriceChart
                        height={380}
                        candles={chartCandles}
                        label={`${symbol} ${interval} historical replay chart`}
                        indicators={liveIndicators}
                        isCutMode={isCutMode}
                        replayBrackets={replayBracketsConfig}
                        replayTrades={replayWallet.closedTrades}
                        activePosition={replayWallet.position}
                        targetTradeReference={replayTargetTrade ? {
                          entryPrice: replayTargetTrade.entryPrice,
                          exitPrice: replayTargetTrade.exitPrice,
                          side: replayTargetTrade.side,
                          netPnl: replayTargetTrade.netPnl,
                          returnPct: replayTargetTrade.returnPct,
                          label: replayTargetTrade.origin === "paper" ? "Paper Trade" : "Backtest Trade",
                        } : null}
                        onCutCandle={(candle) => {
                          if (!market) return;
                          const idx = market.candles.findIndex((c) => c.time === candle.time);
                          if (idx !== -1) {
                            setReplayIndex(idx);
                            setIsCutMode(false);
                            setIsReplayPlaying(false);
                            setToastMessage(`Cut replay tape at ${formatDate(candle.time, false)} (Bar #${idx + 1})`);
                          }
                        }}
                      />
                    ) : (
                      <div className="chart-placeholder">
                        {marketLoading ? (
                          <>
                            <span className="loader-ring" />Loading candles from Bitget…
                          </>
                        ) : (
                          "Historical candle action will render here."
                        )}
                      </div>
                    )}

                    {/* Docked Institutional Light Studio Transport Console */}
                    {market && (
                      <div className="replay-transport-dock" role="region" aria-label="Replay Playback Console">
                        {/* Timeline Scrubber */}
                        <div className="replay-dock-timeline">
                          <div className="replay-dock-timeline-labels">
                            <span className="timeline-bar-count">
                              Bar <strong>{replayIndex + 1}</strong> of <strong>{market.candles.length}</strong>
                            </span>
                            <span className="timeline-date-stamp">
                              {currentReplayCandle ? formatDate(currentReplayCandle.time, false) : "--"}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(0, market.candles.length - 1)}
                            value={Math.max(0, Math.min(market.candles.length - 1, replayIndex))}
                            onChange={(e) => handleScrubIndex(Number(e.target.value))}
                            className="replay-dock-scrubber"
                            aria-label="Replay timeline scrubber"
                          />
                        </div>

                        {/* Transport Toolbar Row */}
                        <div className="replay-dock-controls">
                          {/* Quick Rewind Chips */}
                          <div className="replay-dock-rewind-group">
                            <button
                              type="button"
                              className="replay-dock-chip"
                              onClick={() => handleRewindBars(50)}
                              title="Rewind 50 candles"
                            >
                              -50b
                            </button>
                            <button
                              type="button"
                              className="replay-dock-chip"
                              onClick={() => handleRewindBars(24)}
                              title="Rewind 24 candles"
                            >
                              -24b
                            </button>
                          </div>

                          {/* Play / Pause / Step Controls */}
                          <div className="replay-dock-playback-group">
                            <button
                              type="button"
                              className={`replay-dock-play-btn ${isReplayPlaying ? "is-playing" : ""}`}
                              onClick={() => setIsReplayPlaying((prev) => !prev)}
                              title={isReplayPlaying ? "Pause simulation playback (Space)" : "Start simulation playback (Space)"}
                              aria-pressed={isReplayPlaying}
                            >
                              <span className="playback-glyph">{isReplayPlaying ? "Pause" : "Play"}</span>
                              <span className="playback-label">{isReplayPlaying ? "Pause" : "Play"}</span>
                              <kbd className="playback-kbd">Space</kbd>
                            </button>

                            <button
                              type="button"
                              className="replay-dock-step-btn"
                              onClick={handleStepForward}
                              disabled={replayIndex >= market.candles.length - 1}
                              title="Advance 1 candle forward (→ or F)"
                            >
                              <span>Step 1 Bar ▶|</span>
                              <kbd className="playback-kbd">→</kbd>
                            </button>
                          </div>

                          {/* Playback Speed Selector */}
                          <div className="replay-dock-speed-group" role="radiogroup" aria-label="Playback speed">
                            {[0.5, 1, 2, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={`replay-dock-speed-chip ${replaySpeed === s ? "active" : ""}`}
                                onClick={() => setReplaySpeed(s)}
                                role="radio"
                                aria-checked={replaySpeed === s}
                              >
                                {s}x
                              </button>
                            ))}
                          </div>

                          {/* Cut Tool Shortcut */}
                          <button
                            type="button"
                            className={`replay-dock-cut-chip ${isCutMode ? "active" : ""}`}
                            onClick={() => setIsCutMode((prev) => !prev)}
                            title="Cut bar on chart (C)"
                          >
                            <span>Cut</span>
                            <kbd className="playback-kbd">C</kbd>
                          </button>
                        </div>

                        {/* Keyboard navigation hints */}
                        <div className="replay-dock-hints">
                          <span><kbd>Space</kbd> Play / Pause</span>
                          <span className="hint-sep">·</span>
                          <span><kbd>→</kbd> Step 1 Candle</span>
                          <span className="hint-sep">·</span>
                          <span><kbd>C</kbd> Cut Tool</span>
                          <span className="hint-sep">·</span>
                          <span><kbd>Esc</kbd> Cancel Cut / Close Modal</span>
                        </div>
                      </div>
                    )}
                  </section>
                </div>

                {/* Right Column: Account Status, Order Ticket, Active Position, & Session Closed Trades */}
                <div className="replay-sidebar-column">
                  {/* Account & Equity Card */}
                  <section className="panel replay-card" aria-labelledby="replay-account-heading">
                    <div className="replay-card-header">
                      <h3 id="replay-account-heading">Account &amp; Mark-to-Market Equity</h3>
                    </div>
                    <div className="replay-equity-hero">
                      <span className="replay-equity-label">NET EQUITY</span>
                      <strong className="replay-equity-value">
                        ${calculateReplayEquity(replayWallet, currentReplayCandle?.close ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                      <span className={`replay-equity-pnl ${(calculateReplayEquity(replayWallet, currentReplayCandle?.close ?? 0) - replayWallet.startingCash) >= 0 ? "tone-up" : "tone-down"}`}>
                        {(calculateReplayEquity(replayWallet, currentReplayCandle?.close ?? 0) - replayWallet.startingCash) >= 0 ? "+" : ""}
                        ${(calculateReplayEquity(replayWallet, currentReplayCandle?.close ?? 0) - replayWallet.startingCash).toFixed(2)}
                        {" ("}
                        {(((calculateReplayEquity(replayWallet, currentReplayCandle?.close ?? 0) - replayWallet.startingCash) / replayWallet.startingCash) * 100).toFixed(2)}
                        {"%)"}
                      </span>
                    </div>

                    <div className="replay-account-stats-grid">
                      <div className="account-stat-cell">
                        <span className="stat-label">Available Cash</span>
                        <strong className="stat-val">${replayWallet.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                      </div>
                      <div className="account-stat-cell">
                        <span className="stat-label">Realized PnL</span>
                        <strong className={`stat-val ${replayWallet.realizedPnl >= 0 ? "tone-up" : "tone-down"}`}>
                          {replayWallet.realizedPnl >= 0 ? "+" : ""}${replayWallet.realizedPnl.toFixed(2)}
                        </strong>
                      </div>
                      <div className="account-stat-cell">
                        <span className="stat-label">Unrealized PnL</span>
                        <strong className={`stat-val ${
                          replayWallet.position && currentReplayCandle
                            ? (replayWallet.position.side === "buy"
                                ? (currentReplayCandle.close - replayWallet.position.entryPrice) * replayWallet.position.quantity
                                : (replayWallet.position.entryPrice - currentReplayCandle.close) * replayWallet.position.quantity) >= 0
                              ? "tone-up"
                              : "tone-down"
                            : ""
                        }`}>
                          {replayWallet.position && currentReplayCandle
                            ? `${(replayWallet.position.side === "buy"
                                ? (currentReplayCandle.close - replayWallet.position.entryPrice) * replayWallet.position.quantity
                                : (replayWallet.position.entryPrice - currentReplayCandle.close) * replayWallet.position.quantity) >= 0 ? "+" : ""}$${(
                                replayWallet.position.side === "buy"
                                  ? (currentReplayCandle.close - replayWallet.position.entryPrice) * replayWallet.position.quantity
                                  : (replayWallet.position.entryPrice - currentReplayCandle.close) * replayWallet.position.quantity
                              ).toFixed(2)}`
                            : "$0.00"}
                        </strong>
                      </div>
                      <div className="account-stat-cell">
                        <span className="stat-label">Closed Trades</span>
                        <strong className="stat-val">{replayWallet.closedTrades.length}</strong>
                      </div>
                    </div>
                  </section>

                  {/* Discretionary Order Ticket */}
                  <section className="panel replay-card" aria-labelledby="replay-ticket-heading">
                    <div className="replay-card-header">
                      <h3 id="replay-ticket-heading">Discretionary Order Ticket</h3>
                      <span className="ticket-badge">Market Fill</span>
                    </div>

                    {/* Side Toggle: Long vs Short */}
                    <div className="replay-ticket-side-toggle" role="radiogroup" aria-label="Trade direction">
                      <button
                        type="button"
                        className={`ticket-side-btn buy-side ${replayTicketSide === "buy" ? "active" : ""}`}
                        onClick={() => setReplayTicketSide("buy")}
                        role="radio"
                        aria-checked={replayTicketSide === "buy"}
                      >
                        Long (Buy)
                      </button>
                      <button
                        type="button"
                        className={`ticket-side-btn sell-side ${replayTicketSide === "sell" ? "active" : ""}`}
                        onClick={() => setReplayTicketSide("sell")}
                        role="radio"
                        aria-checked={replayTicketSide === "sell"}
                      >
                        Short (Sell)
                      </button>
                    </div>

                    {/* Order Size Presets + Custom Input */}
                    <div className="replay-ticket-field">
                      <div className="ticket-field-header">
                        <label htmlFor="replay-order-amount">Order Size ($ USD)</label>
                        <div className="ticket-size-chips">
                          {[250, 500, 1000, 2500].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className={`ticket-size-chip ${replayTicketAmount === preset ? "active" : ""}`}
                              onClick={() => setReplayTicketAmount(preset)}
                            >
                              ${preset}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        id="replay-order-amount"
                        type="number"
                        min={10}
                        max={replayWallet.cash}
                        step={50}
                        value={replayTicketAmount}
                        onChange={(e) => setReplayTicketAmount(Math.max(10, Number(e.target.value)))}
                        className="replay-ticket-input"
                      />
                    </div>

                    {/* Bracket Presets: Take Profit & Stop Loss */}
                    <div className="replay-ticket-brackets">
                      <div className="ticket-bracket-col">
                        <div className="ticket-bracket-header">
                          <label htmlFor="replay-tp-input">Take Profit (%)</label>
                          <span className="bracket-target-price">
                            {currentReplayCandle
                              ? `$${formatPrice(
                                  replayTicketSide === "buy"
                                    ? currentReplayCandle.close * (1 + replayTicketTpPct / 100)
                                    : currentReplayCandle.close * (1 - replayTicketTpPct / 100)
                                )}`
                              : "--"}
                          </span>
                        </div>
                        <input
                          id="replay-tp-input"
                          type="number"
                          min={0.1}
                          max={100}
                          step={0.5}
                          value={replayTicketTpPct}
                          onChange={(e) => setReplayTicketTpPct(Math.max(0.1, Number(e.target.value)))}
                          className="replay-ticket-input"
                        />
                      </div>

                      <div className="ticket-bracket-col">
                        <div className="ticket-bracket-header">
                          <label htmlFor="replay-sl-input">Stop Loss (%)</label>
                          <span className="bracket-target-price">
                            {currentReplayCandle
                              ? `$${formatPrice(
                                  replayTicketSide === "buy"
                                    ? currentReplayCandle.close * (1 - replayTicketSlPct / 100)
                                    : currentReplayCandle.close * (1 + replayTicketSlPct / 100)
                                )}`
                              : "--"}
                          </span>
                        </div>
                        <input
                          id="replay-sl-input"
                          type="number"
                          min={0.1}
                          max={50}
                          step={0.5}
                          value={replayTicketSlPct}
                          onChange={(e) => setReplayTicketSlPct(Math.max(0.1, Number(e.target.value)))}
                          className="replay-ticket-input"
                        />
                      </div>
                    </div>

                    {/* Risk to Reward Ratio badge */}
                    <div className="replay-ticket-rrr-row">
                      <span className="rrr-label">Risk-to-Reward Ratio:</span>
                      <span className="rrr-badge">
                        {replayTicketSlPct > 0 ? `${(replayTicketTpPct / replayTicketSlPct).toFixed(1)} : 1 R:R` : "N/A"}
                      </span>
                    </div>

                    {/* Execute Button */}
                    <button
                      type="button"
                      className={`replay-ticket-execute-btn ${replayTicketSide === "buy" ? "buy-btn" : "sell-btn"}`}
                      onClick={handleExecuteTicketOrder}
                      disabled={!currentReplayCandle || replayTicketAmount > replayWallet.cash}
                    >
                      <span>
                        Execute {replayTicketSide === "buy" ? "Long" : "Short"} ${replayTicketAmount}
                        {currentReplayCandle ? ` @ $${formatPrice(currentReplayCandle.close)}` : ""}
                      </span>
                    </button>
                  </section>

                  {/* Active Position Card */}
                  <section className="panel replay-card" aria-labelledby="replay-position-heading">
                    <div className="replay-card-header">
                      <h3 id="replay-position-heading">Active Replay Position</h3>
                      {replayWallet.position && (
                        <span className={`position-badge ${replayWallet.position.side === "buy" ? "long-badge" : "short-badge"}`}>
                          {replayWallet.position.side === "buy" ? "LONG" : "SHORT"}
                        </span>
                      )}
                    </div>

                    {replayWallet.position ? (
                      <div className="replay-active-pos-body">
                        <div className="active-pos-metric-row">
                          <span className="label">Entry Price</span>
                          <strong className="val">${formatPrice(replayWallet.position.entryPrice)}</strong>
                        </div>
                        <div className="active-pos-metric-row">
                          <span className="label">Current Mark</span>
                          <strong className="val">${currentReplayCandle ? formatPrice(currentReplayCandle.close) : "--"}</strong>
                        </div>
                        <div className="active-pos-metric-row">
                          <span className="label">Size</span>
                          <strong className="val">
                            {replayWallet.position.quantity.toFixed(4)} {symbol.replace(/USDT?$/i, "")} (${(replayWallet.position.quantity * (currentReplayCandle?.close ?? replayWallet.position.entryPrice)).toFixed(2)})
                          </strong>
                        </div>
                        <div className="active-pos-metric-row">
                          <span className="label">Unrealized PnL</span>
                          <strong className={`val ${
                            currentReplayCandle
                              ? (replayWallet.position.side === "buy"
                                  ? currentReplayCandle.close - replayWallet.position.entryPrice
                                  : replayWallet.position.entryPrice - currentReplayCandle.close) >= 0
                                ? "tone-up"
                                : "tone-down"
                              : ""
                          }`}>
                            {currentReplayCandle
                              ? `${(replayWallet.position.side === "buy"
                                  ? currentReplayCandle.close - replayWallet.position.entryPrice
                                  : replayWallet.position.entryPrice - currentReplayCandle.close) >= 0 ? "+" : ""}$${(
                                  replayWallet.position.side === "buy"
                                    ? (currentReplayCandle.close - replayWallet.position.entryPrice) * replayWallet.position.quantity
                                    : (replayWallet.position.entryPrice - currentReplayCandle.close) * replayWallet.position.quantity
                                ).toFixed(2)} (${(
                                  ((replayWallet.position.side === "buy"
                                    ? currentReplayCandle.close - replayWallet.position.entryPrice
                                    : replayWallet.position.entryPrice - currentReplayCandle.close) /
                                    replayWallet.position.entryPrice) *
                                  100
                                ).toFixed(2)}%)`
                              : "--"}
                          </strong>
                        </div>

                        {/* TP / SL Target indicators */}
                        <div className="active-pos-brackets-row">
                          <div className="pos-bracket-cell">
                            <span className="bracket-title">TP Target:</span>
                            <span className="bracket-val">
                              {replayWallet.position.takeProfitPrice ? `$${formatPrice(replayWallet.position.takeProfitPrice)}` : "None"}
                            </span>
                          </div>
                          <div className="pos-bracket-cell">
                            <span className="bracket-title">SL Trigger:</span>
                            <span className="bracket-val">
                              {replayWallet.position.stopLossPrice ? `$${formatPrice(replayWallet.position.stopLossPrice)}` : "None"}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="replay-close-pos-btn"
                          onClick={handleReplayClosePosition}
                        >
                          Close Position @ Market
                        </button>
                      </div>
                    ) : (
                      <div className="replay-flat-state">
                        <p className="flat-title">Flat / No Open Position</p>
                        <p className="flat-desc">
                          Configure your bracket parameters in the order ticket above and click Execute to enter a simulated trade.
                        </p>
                      </div>
                    )}
                  </section>

                  {/* Session Closed Trades */}
                  <section className="panel replay-card" aria-labelledby="replay-trades-heading">
                    <div className="replay-card-header">
                      <h3 id="replay-trades-heading">Session Closed Trades ({replayWallet.closedTrades.length})</h3>
                      <button
                        type="button"
                        className="replay-scorecard-link-btn"
                        onClick={() => setScorecardModalOpen(true)}
                        disabled={replayWallet.closedTrades.length === 0}
                      >
                        View Scorecard &rarr;
                      </button>
                    </div>

                    {replayWallet.closedTrades.length > 0 ? (
                      <div className="replay-trades-mini-list">
                        {replayWallet.closedTrades.slice(-5).reverse().map((trade) => (
                          <div key={trade.id} className="replay-trade-item">
                            <div className="trade-item-left">
                              <span className={`trade-side-tag ${trade.side === "buy" ? "long-tag" : "short-tag"}`}>
                                {trade.side === "buy" ? "LONG" : "SHORT"}
                              </span>
                              <span className="trade-prices">
                                ${formatPrice(trade.entryPrice)} &rarr; ${formatPrice(trade.exitPrice)}
                              </span>
                            </div>
                            <div className="trade-item-right">
                              <span className={`trade-pnl ${trade.pnl >= 0 ? "tone-up" : "tone-down"}`}>
                                {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} ({trade.pnlPct >= 0 ? "+" : ""}{trade.pnlPct.toFixed(1)}%)
                              </span>
                              <span className={`trade-reason-tag reason-${trade.exitReason}`}>
                                {trade.exitReason === "take_profit" ? "TP Hit" : trade.exitReason === "stop_loss" ? "SL Hit" : "Manual"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="replay-empty-trades">
                        <span>No completed trades in this session yet.</span>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          ) : null}

          {view === "playbooks" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="page-kicker">Quantitative rules · stored in this browser</p>
                  <h1>Strategy Playbook Library</h1>
                  <p className="page-subtitle">
                    Saved algorithmic trading rules, market parameters, and backtested configurations ready for instant replay and paper execution.
                  </p>
                </div>
                <div className="desk-heading-controls">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setView("backtests")}
                  >
                    <Icon name="plus" size={14} /> New strategy rule
                  </button>
                </div>
              </div>

              {playbookMessage ? (
                <div className="playbook-banner" role="status">
                  <span>{playbookMessage}</span>
                </div>
              ) : null}

              <section className="panel playbooks-filter-bar" aria-label="Playbook filters">
                <label className="playbooks-search-field">
                  <span>Search playbooks</span>
                  <input
                    type="search"
                    value={playbookSearch}
                    onChange={(event) => setPlaybookSearch(event.target.value)}
                    placeholder="Search by strategy title, symbol, or prompt..."
                  />
                </label>
                <label>
                  <span>Market</span>
                  <select
                    value={playbookFilterSymbol}
                    onChange={(event) => setPlaybookFilterSymbol(event.target.value)}
                  >
                    <option value="all">All markets</option>
                    {[...new Set(playbooks.map((p) => p.symbol))].sort().map((asset) => (
                      <option key={asset} value={asset}>{asset}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Timeframe</span>
                  <select
                    value={playbookFilterInterval}
                    onChange={(event) => setPlaybookFilterInterval(event.target.value)}
                  >
                    <option value="all">All timeframes</option>
                    {["15m", "1H", "4H", "1D"].map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={playbookFilterStatus}
                    onChange={(event) => setPlaybookFilterStatus(event.target.value as "all" | "active")}
                  >
                    <option value="all">All playbooks</option>
                    <option value="active">Active in Paper only</option>
                  </select>
                </label>
              </section>

              <section className="playbooks-stats-row" aria-label="Playbook collection stats">
                <div className="panel playbook-stat-card">
                  <span>Saved Playbooks</span>
                  <strong>{playbooks.length} <small>/ 30</small></strong>
                  <small>Stored in this browser</small>
                </div>
                <div className="panel playbook-stat-card">
                  <span>Active in Paper Desk</span>
                  <strong className={activePaperPlaybook ? "tone-up" : ""}>
                    {activePaperPlaybook ? activePaperPlaybook.name : "None assigned"}
                  </strong>
                  <small>{activePaperPlaybook ? `${activePaperPlaybook.symbol} · ${activePaperPlaybook.interval}` : "Discretionary paper fills"}</small>
                </div>
                <div className="panel playbook-stat-card">
                  <span>Covered Markets</span>
                  <strong>{[...new Set(playbooks.map((p) => p.symbol))].length}</strong>
                  <small>Across saved strategies</small>
                </div>
              </section>

              <section className="playbooks-container" aria-label="Strategy Playbook Cards">
                {filteredPlaybooks.length ? (
                  <div className="playbooks-grid">
                    {filteredPlaybooks.map((playbook) => {
                      const isActiveInPaper = activePaperPlaybookId === playbook.id;
                      return (
                        <article key={playbook.id} className={`panel playbook-library-card ${isActiveInPaper ? "is-active-paper" : ""}`}>
                          <div className="playbook-library-card-header">
                            <div>
                              <div className="playbook-title-row">
                                <h2 className="playbook-library-card-title">{playbook.name}</h2>
                                {isActiveInPaper ? (
                                  <span className="playbook-active-badge">
                                    <span className="pulse-dot" /> Active in Paper
                                  </span>
                                ) : null}
                              </div>
                              <span className="playbook-created-date">Saved {formatDate(playbook.createdAt, false)}</span>
                            </div>
                            <span className="playbook-market-badge">
                              {playbook.symbol.replace("USDT", "")} · {playbook.interval}
                            </span>
                          </div>

                          <div className="playbook-prompt-container">
                            <span className="playbook-prompt-quote-mark">“</span>
                            <p className="playbook-prompt-text">{playbook.prompt}</p>
                          </div>

                          <div className="playbook-specs-grid">
                            <div className="playbook-spec-item">
                              <span className="spec-label">Lookback Window</span>
                              <strong className="spec-value">{playbook.lookbackDays} days</strong>
                            </div>
                            <div className="playbook-spec-item">
                              <span className="spec-label">Modeled Fee</span>
                              <strong className="spec-value">{playbook.feeBps} bps</strong>
                            </div>
                            <div className="playbook-spec-item">
                              <span className="spec-label">Modeled Slippage</span>
                              <strong className="spec-value">{playbook.slippageBps} bps</strong>
                            </div>
                          </div>

                          <div className="playbook-library-card-actions">
                            <button
                              type="button"
                              className="button button-primary playbook-btn-run"
                              onClick={() => {
                                setView("backtests");
                                loadPlaybook(playbook);
                                void runBacktest(playbook);
                              }}
                              title="Load parameters into Strategy Lab and execute simulation"
                            >
                              <Icon name="backtest" size={14} /> Load &amp; run
                            </button>
                            <button
                              type="button"
                              className={`button ${isActiveInPaper ? "button-secondary playbook-btn-active" : "button-secondary"}`}
                              onClick={() => usePlaybookInPaper(playbook)}
                              title={isActiveInPaper ? "Open this active strategy in Paper Desk" : "Deploy this strategy to Paper Desk and start trading"}
                            >
                              <Icon name="wallet" size={14} /> {isActiveInPaper ? "In Paper · Open" : "Use in Paper"}
                            </button>
                            {isActiveInPaper ? (
                              <button
                                type="button"
                                className="button button-ghost playbook-btn-unpin"
                                onClick={() => deactivatePlaybookFromPaper(playbook)}
                                title="Unpin this strategy from Paper Desk"
                              >
                                Unpin
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                loadPlaybook(playbook);
                                setView("backtests");
                              }}
                              title="Load parameters into builder to edit before testing"
                            >
                              Edit in lab
                            </button>
                            <button
                              type="button"
                              className="button button-ghost playbook-btn-delete"
                              onClick={() => deletePlaybook(playbook.id)}
                              aria-label={`Delete ${playbook.name}`}
                              title="Delete from saved playbooks"
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : playbooks.length ? (
                  <div className="panel table-empty">
                    <div className="empty-mark"><Icon name="search" size={20} /></div>
                    <strong>No playbooks match your filter.</strong>
                    <span>Try changing your search term, market, or timeframe filter.</span>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        setPlaybookSearch("");
                        setPlaybookFilterSymbol("all");
                        setPlaybookFilterInterval("all");
                        setPlaybookFilterStatus("all");
                      }}
                    >
                      Reset filters
                    </button>
                  </div>
                ) : (
                  <div className="playbooks-empty-flow">
                    <div className="empty-research">
                      <div className="empty-mark"><Icon name="playbook" size={24} /></div>
                      <h2>No saved playbooks yet.</h2>
                      <p>
                        Craft quantitative trading rules in the Backtests &amp; Strategy Lab and save them to build your custom playbook library, or jumpstart with our institutional starter templates below.
                      </p>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => setView("backtests")}
                      >
                        <Icon name="backtest" size={14} /> Build a custom rule in Lab
                      </button>
                    </div>

                    <div className="playbooks-starter-section">
                      <div className="starter-header">
                        <div className="risk-heading-badge">
                          <Icon name="playbook" size={12} />
                          <span>Institutional Playbook Templates</span>
                        </div>
                        <h3>Ready-to-deploy quantitative trading templates.</h3>
                        <p>Save directly to your browser library or load into the lab for simulation.</p>
                      </div>
                      <div className="playbooks-starter-grid">
                        {STARTER_PLAYBOOKS.map((starter) => (
                          <article key={starter.name} className="panel playbook-library-card starter-playbook-card">
                            <div className="playbook-library-card-header">
                              <div>
                                <h2 className="playbook-library-card-title">{starter.name}</h2>
                                <span className="playbook-created-date">Recommended template</span>
                              </div>
                              <span className="playbook-market-badge">
                                {starter.symbol.replace("USDT", "")} · {starter.interval}
                              </span>
                            </div>

                            <div className="playbook-prompt-container">
                              <span className="playbook-prompt-quote-mark">“</span>
                              <p className="playbook-prompt-text">{starter.prompt}</p>
                            </div>

                            <div className="playbook-specs-grid">
                              <div className="playbook-spec-item">
                                <span className="spec-label">Lookback Window</span>
                                <strong className="spec-value">{starter.lookbackDays} days</strong>
                              </div>
                              <div className="playbook-spec-item">
                                <span className="spec-label">Modeled Fee</span>
                                <strong className="spec-value">{starter.feeBps} bps</strong>
                              </div>
                              <div className="playbook-spec-item">
                                <span className="spec-label">Modeled Slippage</span>
                                <strong className="spec-value">{starter.slippageBps} bps</strong>
                              </div>
                            </div>

                            <div className="playbook-library-card-actions">
                              <button
                                type="button"
                                className="button button-primary"
                                onClick={() => {
                                  const item: StrategyPlaybook = {
                                    id: crypto.randomUUID(),
                                    ...starter,
                                    createdAt: Date.now(),
                                  };
                                  const next = [item, ...playbooks].slice(0, 30);
                                  setPlaybooks(next);
                                  window.localStorage.setItem(storageKeys.playbooks, JSON.stringify(next));
                                  setPlaybookMessage(`“${item.name}” added to your Playbook Library.`);
                                  window.setTimeout(() => setPlaybookMessage(""), 3500);
                                }}
                                title="Add this template to your saved Playbook Library"
                              >
                                <Icon name="plus" size={14} /> Add to Library
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => {
                                  loadPlaybook({ ...starter, id: "temp", createdAt: Date.now() });
                                  setView("backtests");
                                  void runBacktest({ ...starter, id: "temp", createdAt: Date.now() });
                                }}
                                title="Load into Strategy Lab and run simulation"
                              >
                                <Icon name="backtest" size={14} /> Load &amp; run
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : null}
          {view === "paper" ? (
            <>
              <div className="page-heading paper-heading"><div><p className="page-kicker">Simulation only · stored in this browser</p><h1>{paperTab === "review" ? "Review your paper trades." : paperTab === "analytics" ? "Portfolio performance analytics." : "Practice without touching a live account."}</h1><p className="page-subtitle">{paperTab === "review" ? "Inspect closed positions, estimated costs, and the research or strategy notes behind each entry." : paperTab === "analytics" ? "Sharpe ratio, drawdown analysis, equity curve, daily P&L calendar, and quantitative risk metrics." : "A local paper ledger with a virtual starting balance. It never submits orders to Bitget."}</p></div><div className="paper-heading-actions"><div className="paper-tab-toggle" role="tablist" aria-label="Paper account views"><button role="tab" aria-selected={paperTab === "account"} className={`paper-tab-btn${paperTab === "account" ? " paper-tab-active" : ""}`} onClick={() => setPaperTab("account")}><Icon name="wallet" size={13} /><span>Account</span></button><button role="tab" aria-selected={paperTab === "review"} className={`paper-tab-btn${paperTab === "review" ? " paper-tab-active" : ""}`} onClick={() => setPaperTab("review")}><Icon name="journal" size={13} /><span>Trade review</span><span className="paper-tab-badge">{closedPaperTrades.length}</span></button><button role="tab" aria-selected={paperTab === "analytics"} className={`paper-tab-btn${paperTab === "analytics" ? " paper-tab-active" : ""}`} onClick={() => setPaperTab("analytics")}><Icon name="backtest" size={13} /><span>Analytics</span></button></div>{paperTab === "review" && closedPaperTrades.length > 0 ? <button className="button button-secondary export-csv-btn" onClick={exportTradesCsv}>Export CSV</button> : null}{paperTab === "account" ? <button className="button button-primary" onClick={() => { setOrderOpen(true); setPaperMessage(""); }} disabled={closingSymbol !== null}>Record paper order</button> : null}</div></div>
              {paperTab === "review" ? (
                <>
                  <section className="panel paper-review-controls" aria-label="Trade review filters and fee assumption">
                    <label className="paper-review-search"><span>Search reviews</span><input type="search" value={paperReviewSearch} onChange={(event) => setPaperReviewSearch(event.target.value)} placeholder="Token, strategy, or note" /></label>
                    <label><span>Market</span><select value={paperReviewSymbol} onChange={(event) => setPaperReviewSymbol(event.target.value)}><option value="all">All markets</option>{[...new Set(closedPaperTrades.map((trade) => trade.symbol))].sort().map((asset) => <option key={asset}>{asset}</option>)}</select></label>
                    <label><span>Strategy</span><select value={paperReviewStrategy} onChange={(event) => setPaperReviewStrategy(event.target.value)}><option value="all">All strategies</option>{paperReviewStrategies.map((strategy) => <option key={strategy}>{strategy}</option>)}</select></label>
                    <label><span>Fee assumption · bps / fill</span><input type="number" min="0" max="1000" step="1" value={paperFeeBps} onChange={(event) => { const nextFee = Math.max(0, Math.min(1000, Number(event.target.value) || 0)); setPaperFeeBps(nextFee); window.localStorage.setItem(storageKeys.paperFee, JSON.stringify(nextFee)); }} /></label>
                  </section>
                  <p className="paper-review-method">Net results subtract estimated entry and exit fees. New fills save their fee assumption; older fills without one use the setting above. Paper fills do not model spread, slippage, or taxes.</p>
                  <CumulativePnlChart trades={filteredPaperReviews} />
                  <section className="paper-review-score-grid" aria-label="Filtered paper trade performance">
                    <div className="panel paper-review-stat"><span>Closed trades</span><strong>{paperReviewStats.closed}</strong><small>{filteredPaperReviews.length === closedPaperTrades.length ? "All recorded closes" : "Matching filters"}</small></div>
                    <div className="panel paper-review-stat"><span>Estimated net P&amp;L</span><strong className={paperReviewStats.netPnl >= 0 ? "tone-up" : "tone-down"}>{formatMoney(paperReviewStats.netPnl)}</strong><small>After modeled fees</small></div>
                    <div className="panel paper-review-stat"><span>Win rate</span><strong>{paperReviewStats.winRate === null ? "n/a" : `${paperReviewStats.winRate.toFixed(1)}%`}</strong><small>By closed position</small></div>
                    <div className="panel paper-review-stat"><span>Average win</span><strong className="tone-up">{paperReviewStats.averageWin === null ? "n/a" : formatMoney(paperReviewStats.averageWin)}</strong><small>Net of estimated fees</small></div>
                    <div className="panel paper-review-stat"><span>Average loss</span><strong className="tone-down">{paperReviewStats.averageLoss === null ? "n/a" : formatMoney(paperReviewStats.averageLoss)}</strong><small>Net of estimated fees</small></div>
                    <div className="panel paper-review-stat"><span>Profit factor</span><strong>{paperReviewStats.profitFactor === null ? "n/a" : Number.isFinite(paperReviewStats.profitFactor) ? paperReviewStats.profitFactor.toFixed(2) : "∞"}</strong><small>Net wins / net losses</small></div>
                    <div className="panel paper-review-stat"><span>Worst drawdown</span><strong className="tone-down">{paperReviewStats.maxDrawdown === null ? "n/a" : formatMoney(paperReviewStats.maxDrawdown)}</strong><small>Closed-trade equity curve</small></div>
                    <div className="panel paper-review-stat"><span>Estimated fees</span><strong>{formatMoney(paperReviewStats.estimatedFees)}</strong><small>Entry plus exit</small></div>
                  </section>

                  <section className="panel paper-review-list" aria-labelledby="paper-review-list-title">
                    <div className="panel-heading"><div><h2 id="paper-review-list-title">Closed trade journal</h2><p>{filteredPaperReviews.length} of {closedPaperTrades.length} completed position{closedPaperTrades.length === 1 ? "" : "s"}; newest first.</p></div></div>
                    {filteredPaperReviews.length ? <div className="paper-review-entries">{filteredPaperReviews.map((trade) => {
                      const relatedResearch = trade.researchRefs.map((reference) => ({ reference, journalItem: journal.find((entry) => entry.id === reference.id) }));
                      const strategy = tradeStrategyLabel(trade);
                      return <details className="paper-review-entry" key={trade.id}>
                        <summary>
                          <span className="paper-review-entry-title"><strong>{trade.symbol}</strong><small>{formatDate(trade.closedAt)} · {strategy}</small></span>
                          <span className="paper-review-entry-data"><small>{trade.quantity.toFixed(6)} units</small><small>{formatMoney(trade.entryPrice)} to {formatMoney(trade.exitPrice)}</small></span>
                          <span className={`paper-review-entry-result ${trade.netPnl >= 0 ? "tone-up" : "tone-down"}`}><strong>{formatMoney(trade.netPnl)}</strong><small>{formatPercent(trade.returnPct)} net</small></span>
                          <span className="paper-review-entry-actions">
                            <button
                              type="button"
                              className="paper-replay-quick-btn"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                replayFromPaperTrade(trade);
                              }}
                              title="Replay this trade bar-by-bar on the chart"
                            >
                              <Icon name="replay" size={12} />
                              <span>Replay</span>
                            </button>
                            <span className="paper-review-entry-toggle">Details <Icon name="chevronDown" size={12} /></span>
                          </span>
                        </summary>
                        <div className="paper-review-detail-body">
                          <div className="paper-review-detail-grid">
                            <div><span>Opened</span><strong>{formatDate(trade.openedAt)}</strong></div>
                            <div><span>Closed</span><strong>{formatDate(trade.closedAt)}</strong></div>
                            <div><span>Time held</span><strong>{formatDuration(trade.closedAt - trade.openedAt)}</strong></div>
                            <div><span>Quantity closed</span><strong>{trade.quantity.toFixed(6)} {trade.symbol.replace("USDT", "")}</strong></div>
                            <div><span>Gross P&amp;L</span><strong>{formatMoney(trade.grossPnl)}</strong></div>
                            <div><span>Entry fee estimate</span><strong>{formatMoney(trade.entryFee)}</strong></div>
                            <div><span>Exit fee estimate</span><strong>{formatMoney(trade.exitFee)}</strong></div>
                            <div><span>Net P&amp;L</span><strong className={trade.netPnl >= 0 ? "tone-up" : "tone-down"}>{formatMoney(trade.netPnl)}</strong></div>
                          </div>
                          {trade.estimatedFees ? <p className="paper-review-legacy-fee">This close uses the current fee assumption for one or more older fills that did not save a fee rate.</p> : null}
                          <div className="paper-review-actions-bar">
                            <button
                              type="button"
                              className="button button-secondary paper-replay-handoff-btn"
                              onClick={() => replayFromPaperTrade(trade)}
                              title={`Replay ${trade.symbol} trade bar-by-bar on the chart`}
                            >
                              <Icon name="replay" size={13} />
                              <span>Replay trade on chart</span>
                            </button>
                          </div>
                          {(relatedResearch.length > 0 || trade.backtestRefs.length > 0 || trade.playbookNames.length > 0) ? <div className="paper-review-sources">
                            <h3>Entry context</h3>
                            {trade.playbookNames.map((name) => <p key={name}><strong>Playbook:</strong> {name}</p>)}
                            {trade.backtestRefs.map((reference) => <p key={`${reference.capturedAt}-${reference.summary}`}><strong>Backtest:</strong> {reference.summary} · {formatPercent(reference.returnPct)} on {reference.symbol} {reference.interval} · saved {formatDate(reference.capturedAt)}</p>)}
                            {relatedResearch.map(({ reference, journalItem }) => <div className="paper-review-research-ref" key={reference.id}><p><strong>Research:</strong> {reference.question}</p>{journalItem ? <button className="journal-open" onClick={() => { setView("journal"); setSelectedJournalItem(journalItem); }}>Open saved brief <Icon name="arrow" size={13} /></button> : <small>Brief reference saved with the paper fill.</small>}</div>)}
                          </div> : <p className="paper-review-no-source">No research brief or playbook was linked to this entry. New paper buys can capture matching research and backtest context automatically.</p>}
                          <label className="paper-review-note"><span>Exit note</span><textarea rows={2} maxLength={400} value={trade.exitNote} onChange={(event) => updatePaperExitNote(trade.exitTradeId, event.target.value)} placeholder="What made you close this position? Save a short note for your next review." /><small>Saved on this device as you type.</small></label>
                        </div>
                      </details>;
                    })}</div> : closedPaperTrades.length ? <div className="table-empty"><strong>No closed trades match these filters.</strong><span>Clear the search or choose a different market or strategy.</span></div> : <div className="table-empty"><div className="empty-mark"><Icon name="journal" size={20} /></div><strong>No completed trades yet.</strong><span>Once a paper position is closed, its results and review notes will appear here.</span><button className="button button-secondary" onClick={() => setPaperTab("account")}>Back to paper account</button></div>}
                  </section>
                </>
              ) : paperTab === "analytics" ? (
                <PortfolioAnalytics
                  trades={closedPaperTrades}
                  startingCapital={STARTING_CASH}
                  openPositions={openPositions}
                  quotes={quotes}
                  cashBalance={cashBalance}
                />
              ) : (
                <>
              <div className="account-summary">
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Virtual cash</span>
                    <span className="balance-badge badge-reserve">Reserve</span>
                  </div>
                  <strong>{formatMoney(cashBalance)}</strong>
                  <small>Started with {formatMoney(STARTING_CASH)}</small>
                </div>
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Account equity</span>
                    <span className="balance-badge badge-equity">Net Value</span>
                  </div>
                  <strong>{accountEquity === null ? "Updating…" : formatMoney(accountEquity)}</strong>
                  <small>Cash plus current position values</small>
                </div>
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Total paper P&amp;L</span>
                    <span className={`balance-badge ${accountEquity === null ? "" : accountEquity >= STARTING_CASH ? "badge-profit" : "badge-loss"}`}>Overall</span>
                  </div>
                  <strong className={accountEquity === null ? "" : accountEquity >= STARTING_CASH ? "tone-up" : "tone-down"}>{accountEquity === null ? "n/a" : formatMoney(accountEquity - STARTING_CASH)}</strong>
                  <small>Marked to available live quotes</small>
                </div>
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Realized P&amp;L</span>
                    <span className={`balance-badge ${realizedStats.realizedPnl >= 0 ? "badge-profit" : "badge-loss"}`}>Closed</span>
                  </div>
                  <strong className={realizedStats.realizedPnl >= 0 ? "tone-up" : "tone-down"}>{formatMoney(realizedStats.realizedPnl)}</strong>
                  <small>Weighted average cost; after estimated fees</small>
                </div>
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Unrealized P&amp;L</span>
                    <span className={`balance-badge ${unrealizedPnl === null ? "" : unrealizedPnl >= 0 ? "badge-profit" : "badge-loss"}`}>Floating</span>
                  </div>
                  <strong className={unrealizedPnl === null ? "" : unrealizedPnl >= 0 ? "tone-up" : "tone-down"}>{unrealizedPnl === null ? "Updating…" : formatMoney(unrealizedPnl)}</strong>
                  <small>{openPositions.length} open market{openPositions.length === 1 ? "" : "s"}</small>
                </div>
                <div className="panel account-balance">
                  <div className="account-balance-top">
                    <span>Recorded orders</span>
                    <span className="balance-badge badge-ledger">Ledger</span>
                  </div>
                  <strong>{paperTrades.length}</strong>
                  <small>Saved on this device only</small>
                </div>
              </div>
              {activePaperPlaybook ? (
                <section className="panel active-playbook">
                  <div className="active-playbook-info">
                    <div className="active-playbook-badge-row">
                      <span className="strategy-tag"><Icon name="playbook" size={13} /> Active Strategy Rule</span>
                      <span className="playbook-pair-pill">{activePaperPlaybook.symbol} · {activePaperPlaybook.interval}</span>
                    </div>
                    <h2>{activePaperPlaybook.name}</h2>
                    <p>{activePaperPlaybook.prompt}</p>
                    <small>Simulated fills on {activePaperPlaybook.symbol} are automatically tagged under &ldquo;{activePaperPlaybook.name}&rdquo; in your journal.</small>
                  </div>
                  <div className="active-playbook-controls">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => {
                        setSymbol(activePaperPlaybook.symbol);
                        setInterval(activePaperPlaybook.interval);
                        setOrderSide("buy");
                        setOrderOpen(true);
                      }}
                      title={`Open paper order dialog for ${activePaperPlaybook.symbol}`}
                    >
                      <Icon name="wallet" size={13} /> Trade {activePaperPlaybook.symbol.replace("USDT", "")}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        setActivePaperPlaybookId("");
                        window.localStorage.removeItem(storageKeys.activePlaybook);
                        setPaperMessage(`Deactivated “${activePaperPlaybook.name}” from paper trading.`);
                        window.setTimeout(() => setPaperMessage(""), 3500);
                      }}
                    >
                      Clear playbook
                    </button>
                  </div>
                </section>
              ) : null}
              <section className="panel rule-runner-panel" aria-label="Automated playbook rule runner">
                <div className="rule-runner-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span className={`rule-runner-status-pill ${ruleRunnerActive ? "status-active" : "status-paused"}`}>
                        <span className={ruleRunnerActive ? "pulse-dot-green" : "pulse-dot-gray"} />
                        {ruleRunnerActive ? "Auto-Runner Active" : "Auto-Runner Paused"}
                      </span>
                      <span className="strategy-tag">
                        <Icon name="playbook" size={12} /> Paper Automation
                      </span>
                    </div>
                    <h2 style={{ fontSize: "1.1rem", margin: "0 0 2px 0", fontWeight: 700 }}>Automated Playbook Rule Runner</h2>
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      Monitors Bitget completed candle closes and automatically executes simulated paper fills when strategy criteria are triggered.
                    </p>
                  </div>
                  <div className="rule-runner-controls">
                    <button
                      type="button"
                      className={`button ${ruleRunnerActive ? "button-secondary" : "button-primary"}`}
                      onClick={() => {
                        const next = !ruleRunnerActive;
                        setRuleRunnerActive(next);
                        window.localStorage.setItem(storageKeys.autoRuleRunner, JSON.stringify(next));
                        setToastMessage(next ? "Automated Rule Runner activated." : "Automated Rule Runner paused.");
                      }}
                      style={{ padding: "0.45rem 0.9rem", fontSize: "0.82rem" }}
                    >
                      {ruleRunnerActive ? "Pause Runner" : "Start Runner"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void runRuleEvaluation()}
                      disabled={ruleRunnerEvaluating}
                      style={{ padding: "0.45rem 0.9rem", fontSize: "0.82rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      {ruleRunnerEvaluating ? "Evaluating…" : <><Icon name="bolt" size={13} /> Evaluate Now</>}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "0.82rem" }}>
                  <label htmlFor="playbook-select" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Target Playbook:</label>
                  <select
                    id="playbook-select"
                    value={ruleRunnerPlaybookId || (activePaperPlaybook?.id ?? "")}
                    onChange={(e) => setRuleRunnerPlaybookId(e.target.value)}
                    style={{ padding: "0.35rem 0.65rem", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", fontSize: "0.82rem", color: "var(--text)" }}
                  >
                    {(playbooks.length > 0 ? playbooks : STARTER_PLAYBOOKS.map((p, idx) => ({ ...p, id: `starter-${idx}`, createdAt: 0 }))).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.symbol} · {p.interval})
                      </option>
                    ))}
                  </select>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
                    • Evaluates every 30s • Maximum 1 open position per symbol • Simulated fills tagged with [Auto-Fill]
                  </span>
                </div>

                <div className="rule-runner-logs">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
                      Execution Audit Log ({ruleRunnerLogs.length})
                    </span>
                    {ruleRunnerLogs.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRuleRunnerLogs([]);
                          window.localStorage.removeItem(storageKeys.ruleRunnerLogs);
                        }}
                        style={{ background: "none", border: "none", fontSize: "0.76rem", color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}
                      >
                        Clear Log
                      </button>
                    ) : null}
                  </div>
                  {ruleRunnerLogs.length > 0 ? (
                    ruleRunnerLogs.map((log) => (
                      <div key={log.id} className="rule-log-item">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem" }}>
                            {new Date(log.time).toLocaleTimeString()}
                          </span>
                          <span className={`rule-log-action action-${log.action}`}>
                            {log.action}
                          </span>
                          <strong>{log.symbol}</strong>
                          <span style={{ color: "var(--text-secondary)" }}>{log.message}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      No automated executions recorded yet. Keep the runner active to automatically trade candle signals.
                    </p>
                  )}
                </div>
              </section>
              <section className="panel positions-panel">
                <div className="panel-heading"><div><h2>Open positions</h2><p>Position rows show gross P&amp;L. Account totals deduct entry fees; realized results also deduct exit fees. Brackets check sampled quotes about every minute while this page is running. They close at the next fetched quote, which can differ from the trigger; price moves between checks or while offline are missed.</p></div></div>
                {openPositions.length ? <div className="table-scroll"><table className="positions-table"><thead><tr><th>Market</th><th>Quantity</th><th>Average entry</th><th>Current quote</th><th>Unrealized P&amp;L</th><th>Return</th><th>Bracket (TP/SL)</th><th>Action</th></tr></thead><tbody>{openPositions.map((position) => {
                  const quote = quotes.find((entry) => entry.symbol === position.symbol);
                  const positionPnl = quote ? (quote.price - position.averageEntry) * position.quantity : null;
                  const returnPct = quote && position.averageEntry > 0 ? ((quote.price / position.averageEntry) - 1) * 100 : null;
                  const bracket = paperBrackets[position.symbol];
                  return <tr key={position.symbol}>
                    <td><div className="market-cell-wrap"><span className="market-mark">{position.symbol.slice(0, 3)}</span><strong>{position.symbol}</strong></div></td>
                    <td className="tabular-num">{position.quantity.toFixed(6)} {position.symbol.replace("USDT", "")}</td>
                    <td className="tabular-num">{formatMoney(position.averageEntry)}</td>
                    <td className="tabular-num">{quote ? formatMoney(quote.price) : "Loading quote…"}</td>
                    <td><span className={`pnl-pill ${positionPnl === null ? "" : positionPnl >= 0 ? "pnl-up" : "pnl-down"}`}>{positionPnl === null ? "n/a" : formatMoney(positionPnl)}</span></td>
                    <td><span className={`pnl-pill ${returnPct === null ? "" : returnPct >= 0 ? "pnl-up" : "pnl-down"}`}>{returnPct === null ? "n/a" : formatPercent(returnPct)}</span></td>
                    <td>
                      {bracket ? (
                        <div className="bracket-tag">
                          {quote && (!quote.asOf || clockNow - quote.asOf > 120_000) ? (
                            <span className="bracket-stale-badge" title="Bitget quote is older than 2 minutes. Bracket evaluation is paused until fresh quotes arrive.">
                              ● Quotes stale &gt;2m (Paused)
                            </span>
                          ) : null}
                          <div className="bracket-tag-pills">
                            {bracket.takeProfitPrice ? <span className="tag-tp">TP: ${formatPrice(bracket.takeProfitPrice)}</span> : null}
                            {bracket.stopLossPrice ? <span className="tag-sl">SL: ${formatPrice(bracket.stopLossPrice)}</span> : null}
                            {bracket.trailingStopPct ? <span className="tag-trail">Trail: {bracket.trailingStopPct}%</span> : null}
                          </div>
                          <button type="button" className="bracket-edit-btn" onClick={() => { setEditingBracketSymbol(position.symbol); setBracketModalTp(String(bracket.takeProfitPct ?? 5)); setBracketModalSl(String(bracket.stopLossPct ?? 2.5)); setBracketModalTrail(String(bracket.trailingStopPct ?? 0)); }}>Edit</button>
                        </div>
                      ) : (
                        <button type="button" className="bracket-edit-btn" onClick={() => { setEditingBracketSymbol(position.symbol); setBracketModalTp("5.0"); setBracketModalSl("2.5"); setBracketModalTrail("0"); }}>+ Set TP/SL</button>
                      )}
                    </td>
                    <td><button className="paper-close-button" onClick={() => void closePaperPosition(position.symbol)} disabled={closingSymbol !== null} aria-label={`Close ${position.symbol} paper position`}>{closingSymbol === position.symbol ? "Closing…" : "Close position"}</button></td>
                  </tr>;
                })}</tbody></table></div> : (
                  <div className="table-empty positions-empty">
                    <div className="empty-mark"><Icon name="wallet" size={22} /></div>
                    <strong>No open positions</strong>
                    <span>When you record a paper buy, live quotes, cost basis, unrealized P&amp;L, and bracket orders will be tracked here.</span>
                    <button
                      type="button"
                      className="button button-primary empty-action-btn"
                      onClick={() => { setOrderOpen(true); setPaperMessage(""); }}
                      disabled={closingSymbol !== null}
                    >
                      <Icon name="plus" size={13} /> Open paper position
                    </button>
                  </div>
                )}
              </section>
              <section className="paper-tools-grid">
                <div className="panel paper-risk-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="risk-heading-badge"><Icon name="shield" size={12} /> <span>Risk protocol</span></div>
                      <h2>Daily loss guard</h2>
                      <p>Pause new paper buys after realized losses for the current UTC day reach the limit.</p>
                    </div>
                  </div>
                  <label className="risk-limit-control" htmlFor="paper-loss-limit">
                    <span>Realized loss limit</span>
                    <div>
                      <span>$</span>
                      <input id="paper-loss-limit" type="number" min="1" max="100000" step="25" value={dailyLossLimit} onChange={(event) => { const value = Math.max(1, Math.min(100000, Number(event.target.value) || 1)); setDailyLossLimit(value); window.localStorage.setItem(storageKeys.paperRisk, JSON.stringify(value)); }} />
                      <span>USDT / UTC day</span>
                    </div>
                  </label>
                  {(() => {
                    const lossUsedPct = Math.min(100, Math.max(0, realizedStats.realizedToday < 0 ? Math.round((Math.abs(realizedStats.realizedToday) / dailyLossLimit) * 100) : 0));
                    const remainingBuffer = Math.max(0, dailyLossLimit - Math.max(0, -realizedStats.realizedToday));
                    return (
                      <div className="risk-meter-container">
                        <div className="risk-meter-header">
                          <span>Daily loss capacity</span>
                          <strong>{dailyLossLimitReached ? "100% capacity depleted" : `${lossUsedPct}% used · ${formatMoney(remainingBuffer)} remaining`}</strong>
                        </div>
                        <div className="risk-meter-track" role="progressbar" aria-valuenow={lossUsedPct} aria-valuemin={0} aria-valuemax={100}>
                          <div
                            className={`risk-meter-bar ${dailyLossLimitReached ? "bar-danger" : lossUsedPct >= 70 ? "bar-warning" : "bar-safe"}`}
                            style={{ width: `${Math.max(4, lossUsedPct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  <div className={dailyLossLimitReached ? "risk-state-card risk-reached" : "risk-state-card risk-normal"}>
                    <div className="risk-state-icon">
                      <Icon name={dailyLossLimitReached ? "alert" : "shield"} size={16} />
                    </div>
                    <div className="risk-state-text">
                      <strong>{dailyLossLimitReached ? "Daily Loss Limit Reached (Buys Paused)" : "Guard Active & Monitoring"}</strong>
                      <p>{dailyLossLimitReached
                        ? `Limit reached: today's realized result is ${formatMoney(realizedStats.realizedToday)}. New buys are paused; sells and position closes remain available.`
                        : `Realized today: ${formatMoney(realizedStats.realizedToday)}. Unrealized losses do not trigger this guard; monitor and close positions manually.`}</p>
                    </div>
                  </div>
                </div>
                <div className="panel alerts-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="risk-heading-badge"><Icon name="bell" size={12} /> <span>Live monitoring</span></div>
                      <h2>Price and risk alerts</h2>
                      <p>One-shot reminders for a price level, stop, or target.</p>
                    </div>
                  </div>
                  <form className="alert-form" onSubmit={addPaperAlert}>
                    <label><span>Market</span><select value={alertSymbol} onChange={(event) => setAlertSymbol(event.target.value)}>{selectableSymbols.map((asset) => <option key={asset}>{asset}</option>)}</select></label>
                    <label><span>Reminder type</span><select value={alertPurpose} onChange={(event) => setAlertPurpose(event.target.value as PaperAlert["purpose"])}><option value="price">Price watch</option><option value="stop">Stop-loss reminder</option><option value="target">Take-profit reminder</option></select></label>
                    <label><span>Trigger condition</span><select value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as PaperAlert["direction"])}><option value="above">Price rises to / above (≥)</option><option value="below">Price falls to / below (≤)</option></select></label>
                    <label><span>Target price (USDT)</span><input type="number" min="0.00000001" step="any" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} placeholder="e.g. 85000" required /></label>
                    <div className="alert-form-actions">
                      <button className="button button-primary alert-submit-btn" type="submit">
                        <Icon name="plus" size={13} /> Add alert
                      </button>
                    </div>
                  </form>
                  <p className="alert-note"><Icon name="bell" size={12} /> Alerts check Bitget quotes about once a minute while open. Stop and target alerts notify; they never close a position automatically.</p>
                  {paperAlerts.length ? (
                    <ul className="paper-alert-list">
                      {paperAlerts.map((alert) => (
                        <li key={alert.id} className="paper-alert-card">
                          <div className="alert-card-info">
                            <div className="alert-card-topline">
                              <strong className="alert-symbol">{alert.symbol}</strong>
                              <span className={`alert-purpose-badge purpose-${alert.purpose}`}>
                                {alert.purpose === "stop" ? "Stop reminder" : alert.purpose === "target" ? "Target reminder" : "Price watch"}
                              </span>
                              <span className="alert-direction-pill">{alert.direction === "above" ? "≥" : "≤"} ${formatPrice(alert.price)}</span>
                            </div>
                            <span className="alert-status-text">
                              {alert.triggeredAt ? `Reached ${formatDate(alert.triggeredAt)}` : "Watching live quote"}
                            </span>
                          </div>
                          <button className="button button-ghost alert-remove-btn" onClick={() => removePaperAlert(alert.id)} aria-label={`Remove ${alert.symbol} price alert`}>
                            <Icon name="close" size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="alert-empty-card">
                      <div className="empty-mark empty-mark-sm"><Icon name="bell" size={15} /></div>
                      <span>No saved alerts yet. Add a price level or stop trigger above.</span>
                    </div>
                  )}
                </div>
              </section>
              <section className="panel orders-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Paper order history</h2>
                    <p>Buy and sell fills are kept here, including position closes.</p>
                  </div>
                </div>
                {paperTrades.length ? (
                  <div className="table-scroll">
                    <table className="orders-table">
                      <thead>
                        <tr>
                          <th>Side</th>
                          <th>Market</th>
                          <th>Quantity</th>
                          <th>Simulated price</th>
                          <th>Notional</th>
                          <th>Recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paperTrades.map((trade) => (
                          <tr key={trade.id}>
                            <td>
                              <span className={`side-label side-${trade.side}`}>
                                {trade.side}
                              </span>
                            </td>
                            <td>
                              <div className="market-cell-wrap">
                                <span className="market-mark">{trade.symbol.slice(0, 3)}</span>
                                <strong>{trade.symbol}</strong>
                              </div>
                            </td>
                            <td className="tabular-num">{trade.quantity.toFixed(6)}</td>
                            <td className="tabular-num">{formatMoney(trade.price)}</td>
                            <td className="tabular-num">{formatMoney(trade.quantity * trade.price)}</td>
                            <td className="date-cell">{formatDate(trade.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="table-empty">
                    <div className="empty-mark"><Icon name="wallet" size={22} /></div>
                    <strong>No paper orders yet</strong>
                    <span>Record an order from a research brief or start one here.</span>
                    <button
                      type="button"
                      className="button button-secondary empty-action-btn"
                      onClick={() => { setOrderOpen(true); setPaperMessage(""); }}
                    >
                      <Icon name="plus" size={13} /> Record paper order
                    </button>
                  </div>
                )}
              </section>
                </>
              )}
            </>
          ) : null}
          {view === "journal" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="page-kicker">Saved on this device · client-side memory</p>
                  <h1>Research with a memory.</h1>
                  <p className="page-subtitle">Past market questions, snapshot quotes, and technical indicator regimes captured when each brief was built.</p>
                </div>
                <button className="button button-primary" onClick={() => setView("research")}>
                  <Icon name="research" size={14} /> Formulate new question
                </button>
              </div>

              <section className="playbooks-stats-row journal-stats-row" aria-label="Journal collection stats">
                <div className="panel playbook-stat-card">
                  <span>Saved Briefs</span>
                  <strong>{journal.length} <small>reports</small></strong>
                  <small>Recorded on this device</small>
                </div>
                <div className="panel playbook-stat-card">
                  <span>Analyzed Markets</span>
                  <strong>{[...new Set(journal.map((j) => j.symbol))].length} <small>tokens</small></strong>
                  <small>Covered spot instruments</small>
                </div>
                <div className="panel playbook-stat-card">
                  <span>Dominant Regime</span>
                  <strong className="regime-stat-highlight">{journalDominantRegime}</strong>
                  <small>Most frequent market structure</small>
                </div>
                <div className="panel playbook-stat-card">
                  <span>Storage Privacy</span>
                  <strong className="tone-up">100% Local</strong>
                  <small>Zero third-party cloud leaks</small>
                </div>
              </section>

              {journal.length === 0 ? (
                <div className="panel journal-empty-panel">
                  <div className="journal-empty-content">
                    <div className="empty-mark"><Icon name="journal" size={24} /></div>
                    <h2>Your research journal is ready.</h2>
                    <p>
                      Every time you formulate a market question in the Research Workspace, your hypothesis, Bitget price snapshot, technical indicators, and dual-thesis arguments are automatically filed here.
                    </p>
                    <div className="journal-starter-prompts">
                      <span className="starter-label">Start with a recommended market brief:</span>
                      <div className="starter-buttons-row">
                        <button
                          type="button"
                          className="button button-secondary starter-brief-btn"
                          onClick={() => {
                            setSymbol("BTCUSDT");
                            setInterval("1H");
                            setQuestion("Analyze BTCUSDT on the 1H chart. Show both sides and what would change the read.");
                            setView("research");
                          }}
                        >
                          <strong>BTCUSDT · 1H</strong>
                          <small>Trend structure &amp; invalidation &rarr;</small>
                        </button>
                        <button
                          type="button"
                          className="button button-secondary starter-brief-btn"
                          onClick={() => {
                            setSymbol("ETHUSDT");
                            setInterval("15m");
                            setQuestion("Evaluate RSI momentum, 20/50 EMA structure, and volume confirmation on ETHUSDT 15m.");
                            setView("research");
                          }}
                        >
                          <strong>ETHUSDT · 15m</strong>
                          <small>Intraday momentum &amp; volume &rarr;</small>
                        </button>
                        <button
                          type="button"
                          className="button button-secondary starter-brief-btn"
                          onClick={() => {
                            setSymbol("SOLUSDT");
                            setInterval("4H");
                            setQuestion("Is SOLUSDT compressing for a continuation breakout or showing distribution/exhaustion signs on 4H?");
                            setView("research");
                          }}
                        >
                          <strong>SOLUSDT · 4H</strong>
                          <small>Swing range &amp; breakout read &rarr;</small>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="journal-master-detail">
                  <section className="panel journal-panel journal-master-column" aria-label="Saved research briefs list">
                    <div className="panel-heading">
                      <div>
                        <h2>Research history</h2>
                        <p>{filteredJournal.length} of {journal.length} saved brief{journal.length === 1 ? "" : "s"} across {journalClusters.length} token cluster{journalClusters.length === 1 ? "" : "s"}</p>
                      </div>
                      <label className="journal-search">
                        <Icon name="search" size={15} />
                        <span className="visually-hidden">Search saved research</span>
                        <input
                          type="search"
                          value={journalQuery}
                          onChange={(event) => setJournalQuery(event.target.value)}
                          placeholder="Search token, question, or note..."
                        />
                      </label>
                    </div>

                    {Object.keys(journalTokenCounts).length > 1 ? (
                      <div className="journal-filter-pills" role="radiogroup" aria-label="Filter research briefs by token">
                        <button
                          type="button"
                          className={`journal-filter-pill ${journalTokenFilter === "ALL" ? "active" : ""}`}
                          onClick={() => setJournalTokenFilter("ALL")}
                          aria-pressed={journalTokenFilter === "ALL"}
                        >
                          All Tokens ({journal.length})
                        </button>
                        {Object.entries(journalTokenCounts).map(([sym, cnt]) => (
                          <button
                            key={sym}
                            type="button"
                            className={`journal-filter-pill ${journalTokenFilter === sym ? "active" : ""}`}
                            onClick={() => setJournalTokenFilter(sym)}
                            aria-pressed={journalTokenFilter === sym}
                          >
                            <span className={`pill-dot coin-${sym.slice(0, 3).toLowerCase()}`} />
                            {sym} ({cnt})
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {journalClusters.length ? (
                      <div className="journal-clusters-list">
                        {journalClusters.map((cluster) => {
                          const isCollapsed = Boolean(collapsedJournalClusters[cluster.symbol]);
                          return (
                            <div key={cluster.symbol} className="journal-cluster-block">
                              <div
                                className="journal-cluster-header"
                                onClick={() => toggleJournalCluster(cluster.symbol)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleJournalCluster(cluster.symbol);
                                  }
                                }}
                                aria-expanded={!isCollapsed}
                              >
                                <div className="cluster-header-left">
                                  <span className={`coin-mark coin-${cluster.symbol.slice(0, 3).toLowerCase()}`}>
                                    {cluster.symbol.slice(0, 1)}
                                  </span>
                                  <div className="cluster-title-wrap">
                                    <div className="cluster-title-line">
                                      <h3>{cluster.symbol}</h3>
                                      <span className="cluster-count-badge">
                                        {cluster.count} {cluster.count === 1 ? "brief" : "briefs"}
                                      </span>
                                    </div>
                                    <span className="cluster-latest-meta">
                                      Latest: {formatDate(cluster.latestItem.createdAt, false)} · {cluster.latestItem.interval} · {cluster.latestItem.regime}
                                    </span>
                                  </div>
                                </div>
                                <div className="cluster-header-right">
                                  <span className="cluster-price">{formatMoney(cluster.latestItem.price)}</span>
                                  <span className={`cluster-chevron ${isCollapsed ? "is-collapsed" : ""}`}>
                                    <Icon name="chevronDown" size={14} />
                                  </span>
                                </div>
                              </div>

                              {!isCollapsed ? (
                                <div className="journal-cluster-items">
                                  {cluster.items.map((item) => {
                                    const isSelected = activeJournalPreview?.id === item.id;
                                    const regimeLower = (item.regime || "").toLowerCase();
                                    const regimeClass = regimeLower.includes("bull")
                                      ? "regime-bull"
                                      : regimeLower.includes("bear")
                                      ? "regime-bear"
                                      : "regime-mixed";

                                    return (
                                      <article
                                        className={`journal-row ${isSelected ? "is-selected-row" : ""}`}
                                        key={item.id}
                                        onClick={() => setPreviewJournalId(item.id)}
                                        role="button"
                                        tabIndex={0}
                                        aria-selected={isSelected}
                                        aria-label={`Research brief for ${item.symbol}, captured ${formatDate(item.createdAt, false)}. Click to view in side panel.`}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setPreviewJournalId(item.id);
                                          }
                                        }}
                                      >
                                        <div className="journal-date">
                                          <strong>{formatDate(item.createdAt, false)}</strong>
                                          <span>{formatDate(item.createdAt).split(" ").slice(-2).join(" ")}</span>
                                        </div>
                                        <div className="journal-copy">
                                          <div className="journal-meta">
                                            <strong>{item.symbol}</strong>
                                            <span className="interval-tag">{item.interval}</span>
                                            <span className={`regime-pill ${regimeClass}`}>{item.regime}</span>
                                            {isSelected ? (
                                              <span className="journal-viewing-badge">
                                                <Icon name="check" size={11} /> Viewing in preview
                                              </span>
                                            ) : null}
                                          </div>
                                          <h4 className="journal-thesis-title" title={item.summary}>
                                            {item.summary || "No summary captured for this brief."}
                                          </h4>
                                          <div className="journal-inquiry-meta" title={item.question}>
                                            <span className="inquiry-label">Prompt:</span>
                                            <span className="inquiry-text">&ldquo;{item.question}&rdquo;</span>
                                          </div>
                                        </div>
                                        <div className="journal-actions">
                                          <span className="journal-price">{formatMoney(item.price)}</span>
                                          <button
                                            type="button"
                                            className="journal-open"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedJournalItem(item);
                                            }}
                                            title="Open full expanded modal"
                                            aria-label={`Open full modal for ${item.symbol}`}
                                          >
                                            Full Modal <Icon name="arrow" size={12} />
                                          </button>
                                          <span className={`journal-selection-hint ${isSelected ? "is-active" : ""}`}>
                                            {isSelected ? "Active in preview" : "Click row to preview"}
                                          </span>
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="table-empty journal-no-results">
                        <strong>No matching notes.</strong>
                        <span>Try another token symbol or clear your search query.</span>
                      </div>
                    )}
                  </section>

                  {activeJournalPreview ? (
                    <aside className="panel journal-detail-pane" aria-label="Journal brief detail preview">
                      <div className="detail-pane-header">
                        <div className="detail-pane-title-group">
                          <div className="market-cell-wrap">
                            <span className="market-mark">{activeJournalPreview.symbol.slice(0, 3)}</span>
                            <div>
                              <div className="detail-pane-symbol-row">
                                <h2>{activeJournalPreview.symbol}</h2>
                                <span className="interval-tag">{activeJournalPreview.interval}</span>
                                <span className="regime-pill">{activeJournalPreview.regime}</span>
                              </div>
                              <span className="detail-pane-date">Captured {formatDate(activeJournalPreview.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="detail-pane-price-badge">
                          <span>Quote at capture</span>
                          <strong>{formatMoney(activeJournalPreview.price)}</strong>
                        </div>
                      </div>

                      <div className="detail-pane-question-box">
                        <span className="detail-pane-q-label">Research Hypothesis:</span>
                        <p>&ldquo;{activeJournalPreview.question}&rdquo;</p>
                      </div>

                      {activeJournalPreview.indicators ? (
                        <div className="detail-pane-indicators-row">
                          <div>
                            <span>RSI (14)</span>
                            <strong>{activeJournalPreview.indicators.rsi14.toFixed(1)}</strong>
                          </div>
                          <div>
                            <span>EMA 20</span>
                            <strong>{activeJournalPreview.indicators.ema20 ? formatPrice(activeJournalPreview.indicators.ema20) : "n/a"}</strong>
                          </div>
                          <div>
                            <span>EMA 50</span>
                            <strong>{activeJournalPreview.indicators.ema50 ? formatPrice(activeJournalPreview.indicators.ema50) : "n/a"}</strong>
                          </div>
                          <div>
                            <span>Support</span>
                            <strong>{formatPrice(activeJournalPreview.indicators.support)}</strong>
                          </div>
                          <div>
                            <span>Resistance</span>
                            <strong>{formatPrice(activeJournalPreview.indicators.resistance)}</strong>
                          </div>
                        </div>
                      ) : null}

                      <div className="detail-pane-section">
                        <h3>Desk read summary</h3>
                        <p>{activeJournalPreview.summary}</p>
                      </div>

                      <div className="detail-pane-thesis-grid">
                        <div className="detail-pane-thesis-card thesis-bull">
                          <div className="thesis-heading">
                            <span className="thesis-symbol">+</span>
                            <h3>Bull case</h3>
                          </div>
                          <p>{activeJournalPreview.bullCase || "Captured read indicates upward support shelf."}</p>
                        </div>
                        <div className="detail-pane-thesis-card thesis-bear">
                          <div className="thesis-heading">
                            <span className="thesis-symbol">−</span>
                            <h3>Bear case</h3>
                          </div>
                          <p>{activeJournalPreview.bearCase || "Risk factors include rejection from resistance."}</p>
                        </div>
                      </div>

                      {activeJournalPreview.invalidation ? (
                        <div className="invalidation-note">
                          <strong>Invalidation Level</strong>
                          <p>{activeJournalPreview.invalidation}</p>
                        </div>
                      ) : null}

                      <div className="detail-pane-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => {
                            const rep: Report = {
                              id: activeJournalPreview.id,
                              question: activeJournalPreview.question,
                              symbol: activeJournalPreview.symbol,
                              interval: activeJournalPreview.interval,
                              market: {
                                symbol: activeJournalPreview.symbol,
                                category: "SPOT",
                                interval: activeJournalPreview.interval,
                                price: activeJournalPreview.price,
                                change24h: activeJournalPreview.marketSnapshot?.change24h ?? 0,
                                high24h: activeJournalPreview.marketSnapshot?.high24h ?? activeJournalPreview.price,
                                low24h: activeJournalPreview.marketSnapshot?.low24h ?? activeJournalPreview.price,
                                volume24h: activeJournalPreview.marketSnapshot?.volume24h ?? 0,
                                turnover24h: activeJournalPreview.marketSnapshot?.turnover24h ?? 0,
                                asOf: activeJournalPreview.createdAt,
                                candles: [],
                              },
                              indicators: activeJournalPreview.indicators ?? {
                                ema20: null,
                                ema50: null,
                                rsi14: 50,
                                support: activeJournalPreview.price * 0.98,
                                resistance: activeJournalPreview.price * 1.02,
                                rangePct: 2,
                                regime: activeJournalPreview.regime,
                              },
                              summary: activeJournalPreview.summary,
                              bullCase: activeJournalPreview.bullCase ?? "",
                              bearCase: activeJournalPreview.bearCase ?? "",
                              invalidation: activeJournalPreview.invalidation ?? "",
                              engine: "journal-cache",
                              commentary: null,
                              createdAt: activeJournalPreview.createdAt,
                            };
                            handleBacktestFromReport(rep);
                          }}
                        >
                          <Icon name="backtest" size={14} /> Backtest in Lab
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            setSymbol(activeJournalPreview.symbol);
                            setInterval(activeJournalPreview.interval);
                            setOrderSide("buy");
                            setOrderOpen(true);
                          }}
                        >
                          <Icon name="wallet" size={14} /> Simulate Order
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setSelectedJournalItem(activeJournalPreview)}
                        >
                          Pop out modal
                        </button>
                      </div>
                    </aside>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
          {view === "settings" ? <><ProviderSettings /><WorkspaceBackup /></> : null}
        </div>
        <footer className="app-footer"><span>Goriee AI Desk</span><span>Research support · not financial advice</span><span>Bitget public market data</span></footer>
      </section>

      {orderOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOrderOpen(false);
          }}
        >
          <section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title">
            <div className="modal-heading">
              <div>
                <p className="page-kicker">Paper account simulation</p>
                <h2 id="order-title">Record a simulated order</h2>
              </div>
              <button className="icon-button" onClick={() => setOrderOpen(false)} aria-label="Close order form">
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-description">This records a local simulation at the latest displayed Bitget quote. No live order is submitted to an exchange.</p>
            <form onSubmit={placePaperOrder}>
              <label className="form-label">Order Side</label>
              <div className="side-toggle">
                <button
                  type="button"
                  className={orderSide === "buy" ? "selected-buy" : ""}
                  onClick={() => setOrderSide("buy")}
                >
                  Buy / Long
                </button>
                <button
                  type="button"
                  className={orderSide === "sell" ? "selected-sell" : ""}
                  onClick={() => setOrderSide("sell")}
                >
                  Sell / Close
                </button>
              </div>
              <label className="form-label" htmlFor="order-market">Market</label>
              <div className="readonly-field" id="order-market">
                <div className="market-readonly-badge">
                  <span className="market-mark">{symbol.slice(0, 3)}</span>
                  <strong>{symbol}</strong>
                </div>
                <span className="market-readonly-type">Spot · Live Quote</span>
              </div>
              <label className="form-label" htmlFor="order-amount">Order value (USDT)</label>
              <div className="input-prefix">
                <span>$</span>
                <input
                  id="order-amount"
                  type="number"
                  min="1"
                  max={orderSide === "buy" ? cashBalance / (1 + paperFeeBps / 10000) : undefined}
                  step="1"
                  value={orderAmount}
                  onChange={(event) => setOrderAmount(event.target.value)}
                  placeholder="Order amount in USDT"
                  required
                />
              </div>
              {orderSide === "buy" && cashBalance > 0 ? (
                <div className="sizing-presets">
                  {[0.25, 0.5, 0.75, 1].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className="sizing-btn"
                      onClick={() => setOrderAmount(String(Math.max(0, Math.floor(cashBalance * pct / (1 + paperFeeBps / 10000)))))}
                    >
                      {pct === 1 ? "Max" : `${pct * 100}%`}
                    </button>
                  ))}
                </div>
              ) : null}
              {orderSide === "buy" ? (
                <div className="kelly-sizer-card">
                  <div className="kelly-sizer-top">
                    <span className="kelly-title-tag" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><Icon name="shield" size={13} /> Dynamic Kelly Risk Sizer</span>
                    <span className="kelly-edge-badge">Capital Preservation</span>
                  </div>
                  {(() => {
                    const stopPct = parseFloat(stopLossPct) || 2.5;
                    const tpPct = parseFloat(takeProfitPct) || 5.0;
                    const curPrice = market ? market.price : 1;
                    const sizing = calculateKellySizing({
                      accountBalance: cashBalance,
                      entryPrice: curPrice,
                      stopPrice: curPrice * (1 - stopPct / 100),
                      takeProfitPrice: curPrice * (1 + tpPct / 100),
                      winRatePct: 52,
                    });
                    const recommendedDollar = Math.max(10, Math.min(Math.floor(cashBalance), Math.round(sizing.positionSizeUsd)));

                    return (
                      <>
                        <div className="kelly-metrics-grid">
                          <div className="kelly-metric-cell">
                            <span>Half-Kelly Risk</span>
                            <strong>{sizing.recommendedRiskPct}%</strong>
                          </div>
                          <div className="kelly-metric-cell">
                            <span>Dollar at Risk</span>
                            <strong>${sizing.dollarRisk}</strong>
                          </div>
                          <div className="kelly-metric-cell">
                            <span>Optimal Size</span>
                            <strong>${recommendedDollar.toLocaleString()}</strong>
                          </div>
                          <div className="kelly-metric-cell">
                            <span>Reward/Risk</span>
                            <strong>{sizing.rewardRiskRatio}:1</strong>
                          </div>
                        </div>
                        <div className="kelly-actions-row">
                          <span>Calculated from {stopPct}% stop loss &amp; {tpPct}% target</span>
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            onClick={() => setOrderAmount(String(recommendedDollar))}
                          >
                            Apply Kelly Size (${recommendedDollar})
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : null}
              {orderSide === "buy" ? (
                <div className="bracket-toggle-section">
                  <label className="bracket-checkbox-label">
                    <input
                      type="checkbox"
                      checked={attachBracket}
                      onChange={(e) => setAttachBracket(e.target.checked)}
                    />
                    <span>Attach Bracket Order (Auto Take-Profit &amp; Stop-Loss)</span>
                  </label>
                  {attachBracket ? (
                    <>
                      <div className="bracket-fields-grid">
                        <label className="bracket-field-wrap">
                          <span>Take Profit (+%)</span>
                          <input
                            type="number"
                            min="0.1"
                            max="500"
                            step="0.5"
                            value={takeProfitPct}
                            onChange={(e) => setTakeProfitPct(e.target.value)}
                            placeholder="5.0"
                          />
                        </label>
                        <label className="bracket-field-wrap">
                          <span>Stop Loss (-%)</span>
                          <input
                            type="number"
                            min="0.1"
                            max="99"
                            step="0.5"
                            value={stopLossPct}
                            onChange={(e) => setStopLossPct(e.target.value)}
                            placeholder="2.5"
                          />
                        </label>
                        <label className="bracket-field-wrap">
                          <span>Trailing Stop (%)</span>
                          <input
                            type="number"
                            min="0"
                            max="50"
                            step="0.5"
                            value={trailingStopPct}
                            onChange={(e) => setTrailingStopPct(e.target.value)}
                            placeholder="0 (off)"
                          />
                        </label>
                      </div>
                      {market && Number(takeProfitPct) > 0 && Number(stopLossPct) > 0 ? (
                        <div className="bracket-preview-badge">
                          <span>Target: ${formatPrice(market.price * (1 + Number(takeProfitPct) / 100))}</span>
                          <span>Stop: ${formatPrice(market.price * (1 - Number(stopLossPct) / 100))}</span>
                          <span>RRR: 1 : {(Number(takeProfitPct) / Number(stopLossPct)).toFixed(1)}</span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {orderSide === "buy" && Number(orderAmount) > (accountEquity || cashBalance) * 0.25 ? (
                <p className="concentration-warning">Concentration notice: commits &gt;25% of account equity.</p>
              ) : null}
              <div className="order-estimate">
                <div className="order-estimate-row">
                  <span>Indicative price</span>
                  <strong>{market ? formatMoney(market.price) : "Loading…"}</strong>
                </div>
                <div className="order-estimate-row">
                  <span>Estimated quantity</span>
                  <strong>{market && Number(orderAmount) ? (Number(orderAmount) / market.price).toFixed(6) : "n/a"} {symbol.replace("USDT", "")}</strong>
                </div>
                <div className="order-estimate-row">
                  <span>Virtual cash after order</span>
                  <strong>{market ? formatMoney(cashBalance + (orderSide === "buy" ? -1 : 1) * Number(orderAmount) - Number(orderAmount) * paperFeeBps / 10000) : "n/a"}</strong>
                </div>
              </div>
              {paperMessage && orderOpen ? <p className="inline-error" role="alert">{paperMessage}</p> : null}
              <button className="button button-primary modal-submit" type="submit" disabled={!market}>
                <Icon name={orderSide === "buy" ? "plus" : "trending"} size={14} />
                {orderSide === "buy" ? "Confirm simulated buy" : "Confirm simulated sell"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
      {editingBracketSymbol ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingBracketSymbol(null);
          }}
        >
          <section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="bracket-edit-title">
            <div className="modal-heading">
              <div>
                <p className="page-kicker">Automated risk management</p>
                <h2 id="bracket-edit-title">Bracket settings · {editingBracketSymbol}</h2>
              </div>
              <button className="icon-button" onClick={() => setEditingBracketSymbol(null)} aria-label="Close bracket form">
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-description">
              Simulated auto-execution occurs when Bitget quotes hit your target or stop levels.
            </p>
            <div className="bracket-fields-grid" style={{ marginBottom: "14px" }}>
              <label className="bracket-field-wrap">
                <span>Take Profit (+%)</span>
                <input
                  type="number"
                  min="0.1"
                  max="500"
                  step="0.5"
                  value={bracketModalTp}
                  onChange={(e) => setBracketModalTp(e.target.value)}
                  placeholder="5.0"
                />
              </label>
              <label className="bracket-field-wrap">
                <span>Stop Loss (-%)</span>
                <input
                  type="number"
                  min="0.1"
                  max="99"
                  step="0.5"
                  value={bracketModalSl}
                  onChange={(e) => setBracketModalSl(e.target.value)}
                  placeholder="2.5"
                />
              </label>
              <label className="bracket-field-wrap">
                <span>Trailing Stop (%)</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={bracketModalTrail}
                  onChange={(e) => setBracketModalTrail(e.target.value)}
                  placeholder="0 (off)"
                />
              </label>
            </div>
            {(() => {
              const pos = openPositions.find((p) => p.symbol === editingBracketSymbol);
              const quote = quotes.find((q) => q.symbol === editingBracketSymbol);
              const basePrice = quote?.price ?? pos?.averageEntry ?? 0;
              const tp = Number(bracketModalTp) || 0;
              const sl = Number(bracketModalSl) || 0;
              return basePrice > 0 && tp > 0 && sl > 0 ? (
                <div className="bracket-preview-badge" style={{ marginBottom: "16px" }}>
                  <span>Target: ${formatPrice(basePrice * (1 + tp / 100))}</span>
                  <span>Stop: ${formatPrice(basePrice * (1 - sl / 100))}</span>
                  <span>RRR: 1 : {(tp / sl).toFixed(1)}</span>
                </div>
              ) : null;
            })()}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPaperBrackets((prev) => {
                    const next = { ...prev };
                    delete next[editingBracketSymbol];
                    window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
                    return next;
                  });
                  setEditingBracketSymbol(null);
                  setToastMessage(`Bracket removed for ${editingBracketSymbol}.`);
                }}
              >
                Clear bracket
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const pos = openPositions.find((p) => p.symbol === editingBracketSymbol);
                  const quote = quotes.find((q) => q.symbol === editingBracketSymbol);
                  const basePrice = pos?.averageEntry ?? quote?.price ?? 0;
                  const tp = Number(bracketModalTp) || 0;
                  const sl = Number(bracketModalSl) || 0;
                  const tr = Number(bracketModalTrail) || 0;

                  const nextBracket: PaperBracket = {
                    symbol: editingBracketSymbol,
                    takeProfitPrice: tp > 0 ? basePrice * (1 + tp / 100) : undefined,
                    takeProfitPct: tp > 0 ? tp : undefined,
                    stopLossPrice: sl > 0 ? basePrice * (1 - sl / 100) : undefined,
                    stopLossPct: sl > 0 ? sl : undefined,
                    trailingStopPct: tr > 0 ? tr : undefined,
                    peakPrice: basePrice,
                    createdAt: Date.now(),
                  };

                  setPaperBrackets((prev) => {
                    const next = { ...prev, [editingBracketSymbol]: nextBracket };
                    window.localStorage.setItem(storageKeys.paperBrackets, JSON.stringify(next));
                    return next;
                  });
                  setEditingBracketSymbol(null);
                  setToastMessage(`Bracket saved for ${editingBracketSymbol}!`);
                }}
              >
                Save bracket
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {selectedJournalItem ? <div className="modal-backdrop journal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJournalItem(null); }}><section className="order-modal journal-detail-modal" role="dialog" aria-modal="true" aria-labelledby="journal-detail-title" aria-describedby="journal-detail-description"><div className="modal-heading"><div><p className="page-kicker">Saved research · {selectedJournalItem.interval}</p><h2 id="journal-detail-title">{selectedJournalItem.symbol}</h2></div><button ref={journalCloseRef} className="icon-button" onClick={() => setSelectedJournalItem(null)} aria-label="Close journal details"><Icon name="close" /></button></div><p className="journal-detail-question" id="journal-detail-description">{selectedJournalItem.question}</p><div className="journal-detail-stamp"><span>Brief saved {formatDate(selectedJournalItem.createdAt)}</span><span>{selectedJournalItem.engine ? `Model: ${selectedJournalItem.engine}` : "Market source: Bitget public data"}</span></div>
        <div className="journal-snapshot-grid">
          <div><span>Captured price</span><strong>{formatMoney(selectedJournalItem.price)}</strong></div>
          <div><span>24h move</span><strong className={selectedJournalItem.marketSnapshot && selectedJournalItem.marketSnapshot.change24h < 0 ? "tone-down" : "tone-up"}>{selectedJournalItem.marketSnapshot ? formatPercent(selectedJournalItem.marketSnapshot.change24h) : "n/a"}</strong></div>
          <div><span>24h high / low</span><strong>{selectedJournalItem.marketSnapshot ? `${formatPrice(selectedJournalItem.marketSnapshot.high24h)} / ${formatPrice(selectedJournalItem.marketSnapshot.low24h)}` : "Not saved"}</strong></div>
          <div><span>24h volume</span><strong>{selectedJournalItem.marketSnapshot ? formatCompact(selectedJournalItem.marketSnapshot.volume24h) : "Not saved"}</strong></div>
        </div>
        <div className="journal-detail-layout">
          <section className="journal-detail-section journal-detail-summary"><h3>Desk summary</h3><p>{selectedJournalItem.summary}</p></section>
          {selectedJournalItem.commentary ? <section className="journal-detail-section journal-detail-summary"><h3>AI commentary</h3><p>{selectedJournalItem.commentary}</p></section> : null}
          <section className="journal-detail-section"><h3>Bull case</h3><p>{selectedJournalItem.bullCase ?? "This older journal entry does not include the full analysis. New briefs save it automatically."}</p></section>
          <section className="journal-detail-section"><h3>Bear case</h3><p>{selectedJournalItem.bearCase ?? "This older journal entry does not include the full analysis. New briefs save it automatically."}</p></section>
          <section className="journal-detail-section journal-detail-invalidation"><h3>What would invalidate this view</h3><p>{selectedJournalItem.invalidation ?? "No invalidation level was saved for this entry."}</p></section>
          {selectedJournalItem.webResearchIncluded ? <section className="journal-detail-section journal-news-context"><h3>News and event context</h3><p>{selectedJournalItem.newsContext || "The search did not return a relevant source for this brief."}</p><CitationList sources={selectedJournalItem.sources ?? []} /></section> : null}
        </div>
        {selectedJournalItem.indicators ? <section className="journal-indicators"><h3>Indicators at capture</h3><div className="journal-indicator-grid"><div><span>Market regime</span><strong>{selectedJournalItem.indicators.regime}</strong></div><div><span>RSI (14)</span><strong>{selectedJournalItem.indicators.rsi14.toFixed(1)}</strong></div><div><span>EMA 20</span><strong>{selectedJournalItem.indicators.ema20 === null ? "n/a" : formatPrice(selectedJournalItem.indicators.ema20)}</strong></div><div><span>EMA 50</span><strong>{selectedJournalItem.indicators.ema50 === null ? "n/a" : formatPrice(selectedJournalItem.indicators.ema50)}</strong></div><div><span>Support</span><strong>{formatPrice(selectedJournalItem.indicators.support)}</strong></div><div><span>Resistance</span><strong>{formatPrice(selectedJournalItem.indicators.resistance)}</strong></div><div><span>Range</span><strong>{formatPercent(selectedJournalItem.indicators.rangePct)}</strong></div></div></section> : <p className="journal-legacy-note">This entry was saved before full research details were available. New briefs include the market snapshot, indicators, bull and bear cases, and invalidation notes.</p>}
        {selectedJournalItem.marketSnapshot ? <p className="journal-capture-source">Snapshot captured {formatDate(selectedJournalItem.marketSnapshot.asOf)} · 24h turnover {formatCompact(selectedJournalItem.marketSnapshot.turnover24h)} USDT</p> : null}
      </section></div> : null}
      {pickerOpen ? <div className="modal-backdrop token-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}><section className="token-picker" role="dialog" aria-modal="true" aria-labelledby="token-picker-title" aria-describedby="token-picker-description"><div className="modal-heading"><div><p className="page-kicker">Bitget spot markets</p><h2 id="token-picker-title">Find a token to follow.</h2></div><button className="icon-button" onClick={() => setPickerOpen(false)} aria-label="Close market picker"><Icon name="close" /></button></div><p className="modal-description" id="token-picker-description">Search online USDT spot pairs from Bitget. Add markets to your watchlist or open one directly.</p><label className="token-search"><Icon name="search" size={17} /><span className="visually-hidden">Search tokens and market pairs</span><input autoFocus type="search" value={instrumentQuery} onChange={(event) => setInstrumentQuery(event.target.value)} placeholder="Search by token or pair, e.g. XRP or DOGE" /></label><div className="token-list-meta" aria-live="polite">{instrumentLoading ? "Loading Bitget spot markets…" : instrumentError ? "Market list unavailable" : tokensLoaded ? `${instrumentList.length.toLocaleString()} online USDT spot markets` : "Loading markets…"}</div>{instrumentError ? <div className="token-error" role="alert"><span>{instrumentError}</span><button className="button button-secondary" onClick={() => { setInstrumentError(""); setTokenRetry((retry) => retry + 1); }}>Retry</button></div> : null}<div className="instrument-list" role="list" aria-label="Available Bitget USDT spot markets">{filteredInstruments.map((instrument) => { const saved = watchlist.includes(instrument.symbol); return <article className="instrument-row" role="listitem" key={instrument.symbol}><span className="instrument-mark">{instrument.baseCoin.slice(0, 1)}</span><span className="instrument-info"><strong>{instrument.baseCoin}</strong><small>{instrument.symbol}</small></span><span className={`instrument-type ${instrument.isRwa === "YES" ? "rwa-type" : ""}`}>{instrument.isRwa === "YES" ? "Tokenized asset" : "Crypto"}</span><button className="instrument-open" onClick={() => selectMarket(instrument.symbol)}>Open</button><button className={`instrument-add ${saved ? "added" : ""}`} onClick={() => addToWatchlist(instrument.symbol)} disabled={saved}>{saved ? "Added" : "+ Add"}</button></article>; })}{!instrumentLoading && !instrumentError && filteredInstruments.length === 0 ? <div className="token-empty">{tokensLoaded ? "No matching online USDT spot market. Try another token symbol." : "Markets will appear here once loaded."}</div> : null}</div>{instrumentList.length > 80 && !instrumentQuery ? <p className="token-list-hint">Showing the first 80 markets. Search by token name to find others.</p> : null}<div className="token-picker-footer"><span>Markets and prices are provided by Bitget’s public spot API.</span><span>Watchlist saved in this browser</span></div></section></div> : null}
      {paperMessage && !orderOpen ? <div className="toast" role="status">{paperMessage}</div> : null}
      {toastMessage ? <div className="toast" role="status">{toastMessage}</div> : null}
      <StrategyCardModal
        open={cardModalOpen}
        onClose={() => setCardModalOpen(false)}
        data={cardExportData}
      />
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        symbols={(() => {
          const baseSymbols = instrumentList.length > 0
            ? instrumentList.map((i) => i.symbol)
            : Array.from(new Set([
                ...selectableSymbols,
                ...quotes.map((q) => q.symbol),
                "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "SUIUSDT", "PEPEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "NEARUSDT", "BNBUSDT"
              ]));
          return baseSymbols.map((sym) => {
            const q = quotes.find((row) => row.symbol === sym);
            return {
              symbol: sym,
              price: q ? q.price : sym === symbol && market ? market.price : 0,
              change24h: q ? q.change24h : sym === symbol && market ? market.change24h : 0,
            };
          });
        })()}
        currentSymbol={symbol}
        currentPrice={market ? market.price : 0}
        onSelectSymbol={(sym) => selectMarket(sym)}
        onNavigate={(newView) => {
          if (newView === "paper-analytics") {
            setView("paper");
            setPaperTab("analytics");
          } else {
            setView(newView as View);
          }
        }}
        onOpenOrderModal={(side) => {
          setOrderSide(side);
          setOrderOpen(true);
        }}
        onTriggerBacktest={() => {
          window.scrollTo({ top: 180, behavior: "smooth" });
        }}
        onExportSnapshot={() => {
          if (report) {
            setCardExportData({
              title: report.question,
              symbol: report.symbol,
              interval: report.interval,
              price: report.market.price,
              rsi: report.indicators.rsi14,
              ema20: report.indicators.ema20,
              ema50: report.indicators.ema50,
              support: report.indicators.support,
              resistance: report.indicators.resistance,
              regime: report.indicators.regime,
              summary: report.summary,
              bullCase: report.bullCase,
              bearCase: report.bearCase,
              invalidation: report.invalidation,
              engine: report.engine,
              asOf: report.createdAt,
            });
            setCardModalOpen(true);
          }
        }}
        onToggleMatrix={() => setDeskLayout((prev) => (prev === "single" ? "grid" : "single"))}
        onSetInterval={(int) => setInterval(int)}
      />

      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-bottom-btn ${view === "desk" ? "active" : ""}`}
          onClick={() => { setView("desk"); setMobileMoreOpen(false); }}
        >
          <Icon name="grid" size={19} />
          <span>Desk</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-btn ${view === "scanner" ? "active" : ""}`}
          onClick={() => { setView("scanner"); setMobileMoreOpen(false); }}
        >
          <Icon name="scan" size={19} />
          <span>Scanner</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-btn ${view === "research" ? "active" : ""}`}
          onClick={() => { setView("research"); setMobileMoreOpen(false); }}
        >
          <Icon name="research" size={19} />
          <span>Research</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-btn ${view === "paper" ? "active" : ""}`}
          onClick={() => { setView("paper"); setMobileMoreOpen(false); }}
        >
          <Icon name="wallet" size={19} />
          <span>Paper</span>
          {paperTrades.length > 0 ? <span className="mobile-nav-badge">{paperTrades.length}</span> : null}
        </button>
        <button
          type="button"
          className={`mobile-bottom-btn ${mobileMoreOpen || ["backtests", "replay", "playbooks", "journal", "settings"].includes(view) ? "active" : ""}`}
          onClick={() => setMobileMoreOpen((prev) => !prev)}
          aria-expanded={mobileMoreOpen}
          aria-label="More views and tools"
        >
          <Icon name="more" size={19} />
          <span>More</span>
        </button>
      </nav>

      {mobileMoreOpen ? (
        <div className="mobile-more-overlay" onClick={() => setMobileMoreOpen(false)}>
          <div className="mobile-more-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Additional Navigation">
            <div className="mobile-more-handle" />
            <div className="mobile-more-header">
              <h3>Workspace Navigation</h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMobileMoreOpen(false)}
                aria-label="Close drawer"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="mobile-more-grid">
              <button
                type="button"
                className={`mobile-more-item ${view === "replay" ? "active" : ""}`}
                onClick={() => { setView("replay"); setMobileMoreOpen(false); }}
              >
                <div className="mobile-more-icon"><Icon name="replay" size={18} /></div>
                <div className="mobile-more-text">
                  <strong>Trade Replay Studio</strong>
                  <small>Zero-hindsight tape simulation &amp; bracket practice</small>
                </div>
              </button>
              <button
                type="button"
                className={`mobile-more-item ${view === "backtests" ? "active" : ""}`}
                onClick={() => { setView("backtests"); setMobileMoreOpen(false); }}
              >
                <div className="mobile-more-icon"><Icon name="backtest" size={18} /></div>
                <div className="mobile-more-text">
                  <strong>Strategy Lab &amp; Backtests</strong>
                  <small>Monte Carlo stress tests &amp; parameter matrix</small>
                </div>
              </button>
              <button
                type="button"
                className={`mobile-more-item ${view === "playbooks" ? "active" : ""}`}
                onClick={() => { setView("playbooks"); setMobileMoreOpen(false); }}
              >
                <div className="mobile-more-icon"><Icon name="playbook" size={18} /></div>
                <div className="mobile-more-text">
                  <strong>Algorithmic Playbooks</strong>
                  <small>Pre-built strategies &amp; rule engines</small>
                </div>
                {playbooks.length > 0 ? <span className="nav-count">{playbooks.length}</span> : null}
              </button>
              <button
                type="button"
                className={`mobile-more-item ${view === "journal" ? "active" : ""}`}
                onClick={() => { setView("journal"); setMobileMoreOpen(false); }}
              >
                <div className="mobile-more-icon"><Icon name="journal" size={18} /></div>
                <div className="mobile-more-text">
                  <strong>Research Journal</strong>
                  <small>Saved research briefs &amp; regime catalog</small>
                </div>
              </button>
              <button
                type="button"
                className={`mobile-more-item ${view === "settings" ? "active" : ""}`}
                onClick={() => { setView("settings"); setMobileMoreOpen(false); }}
              >
                <div className="mobile-more-icon"><Icon name="settings" size={18} /></div>
                <div className="mobile-more-text">
                  <strong>Terminal Settings</strong>
                  <small>API configurations &amp; model selection</small>
                </div>
              </button>
            </div>

            <div className="mobile-more-footer">
              <button
                type="button"
                className="button button-secondary mobile-cmd-k-btn"
                onClick={() => { setMobileMoreOpen(false); setCopilotOpen(true); }}
                style={{ marginBottom: "8px" }}
              >
                <Icon name="cpu" size={14} />
                <span>AI Strategy Copilot (Ctrl+J)</span>
              </button>
              <button
                type="button"
                className="button button-secondary mobile-cmd-k-btn"
                onClick={() => { setMobileMoreOpen(false); setPaletteOpen(true); }}
              >
                <Icon name="search" size={14} />
                <span>Search Markets &amp; Commands (Ctrl+K)</span>
              </button>
              <div className="mobile-more-status">
                <span className={`connection-state ${market ? "connected" : ""}`}>
                  <span className="state-dot" />
                  {market ? "Bitget Spot Live" : "Connecting"}
                </span>
                <span className="mobile-guest-tag">Guest Workspace</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="floating-copilot-trigger"
        onClick={() => setCopilotOpen((prev) => !prev)}
        aria-label="Toggle AI Strategy Copilot (Ctrl+J)"
        title="Toggle AI Strategy Copilot (Ctrl+J)"
      >
        <span className="floating-copilot-sparkle"><Icon name="cpu" size={14} /></span>
        <span className="floating-copilot-label">AI Copilot</span>
        <span className="floating-copilot-badge">Live</span>
      </button>

      <StrategyCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        symbol={symbol}
        interval={interval}
        activeView={view}
        marketSnapshot={copilotMarketSnapshot}
        paperSnapshot={copilotPaperSnapshot}
        aiConfigured={aiConfigured}
        aiModel={aiModel}
        cooldownSeconds={cooldownSeconds}
        onSetCooldown={setAiRetryAt}
        onLoadOrder={handleCopilotLoadOrder}
        onRunBacktest={handleCopilotRunBacktest}
        onSavePlaybook={handleCopilotSavePlaybook}
        onSelectMarket={handleCopilotSelectMarket}
        onExportToJournal={handleCopilotExportJournal}
      />

      <ReplayScorecardModal
        isOpen={scorecardModalOpen}
        scorecard={replayScorecard}
        closedTrades={replayWallet.closedTrades}
        symbol={symbol}
        interval={interval}
        onRestartReplay={handleRestartReplay}
        onClose={handleCloseScorecard}
      />
    </main>
  );
}

function ReportPanel({ report, onPaper, onBacktest, onExportSnapshot }: { report: Report; onPaper: () => void; onBacktest: (report: Report) => void; onExportSnapshot?: () => void }) {
  const { indicators, market } = report;
  const strategyInfo = getStrategyTypeFromResearch(report);
  const customPrompt = generateBacktestPromptFromResearch(report);
  return (
    <article className="panel report-panel">
      <div className="report-topline"><div><p className="page-kicker">Research brief · {report.symbol} · {report.interval}</p><h2>{report.question}</h2></div><span className="engine-label">{report.engine}</span></div>
      <div className="report-facts"><Stat label="Last price" value={formatMoney(market.price)} /><Stat label="24h change" value={`${market.change24h >= 0 ? "+" : ""}${market.change24h.toFixed(2)}%`} tone={market.change24h >= 0 ? "up" : "down"} /><Stat label="RSI (14)" value={indicators.rsi14.toFixed(1)} /><Stat label="Recent range" value={`${formatPrice(indicators.support)} to ${formatPrice(indicators.resistance)}`} /></div>
      <div className="report-source"><span className="source-check"><Icon name="check" size={12} /></span><span>Bitget spot candles and ticker</span><time dateTime={new Date(market.asOf).toISOString()}>Data timestamp: {formatDate(market.asOf)}</time></div>
      <div className="report-summary"><span className="summary-label">Current read</span><p>{report.summary}</p>{report.commentary ? <p className="llm-commentary">{report.commentary}</p> : null}</div>
      {report.webResearchIncluded ? <section className="news-context"><div><span className="summary-label">Live research</span><h3>News and event context</h3></div><p>{report.newsContext || "The search did not return a relevant source for this brief."}</p><CitationList sources={report.sources ?? []} /></section> : null}
      <div className="thesis-grid"><section className="thesis-card thesis-bull"><div className="thesis-heading"><span className="thesis-symbol">+</span><h3>What could support price</h3></div><p>{report.bullCase}</p></section><section className="thesis-card thesis-bear"><div className="thesis-heading"><span className="thesis-symbol">−</span><h3>What could weaken the read</h3></div><p>{report.bearCase}</p></section></div>
      <div className="report-levels"><div><span>EMA 20</span><strong>{indicators.ema20 ? formatPrice(indicators.ema20) : "n/a"}</strong></div><div><span>EMA 50</span><strong>{indicators.ema50 ? formatPrice(indicators.ema50) : "n/a"}</strong></div><div><span>Recent range</span><strong>{indicators.rangePct.toFixed(2)}% average bar range</strong></div></div>
      <div className="invalidation-note"><strong>What would change this read</strong><p>{report.invalidation}</p></div>
      <div className="research-strategy-card">
        <div className="strategy-card-top">
          <div className="strategy-card-meta">
            <span className="strategy-tag"><Icon name="backtest" size={13} /> Quantitative Hypothesis</span>
            <h3>{strategyInfo.title}</h3>
            <p>{strategyInfo.rationale}</p>
          </div>
          <button
            className="button button-primary backtest-brief-btn"
            type="button"
            onClick={() => onBacktest(report)}
          >
            <Icon name="backtest" size={15} /> Make a backtest from brief →
          </button>
        </div>
        <div className="strategy-card-formula">
          <span className="formula-label">Custom Strategy Prompt for Simulator:</span>
          <code>{customPrompt}</code>
        </div>
      </div>
      <div className="report-actions">
        <button className="button button-secondary" onClick={onPaper}>Prepare paper order</button>
        <button
          className="button button-primary backtest-brief-btn"
          type="button"
          onClick={() => onBacktest(report)}
        >
          <Icon name="backtest" size={15} /> Make a backtest
        </button>
        {onExportSnapshot ? (
          <button
            className="button button-secondary export-brief-btn"
            type="button"
            onClick={onExportSnapshot}
            title="Export high-resolution strategy graphic"
          >
            <Icon name="scan" size={14} /> Export Card (PNG)
          </button>
        ) : null}
        <button
          className="button button-secondary export-brief-btn"
          type="button"
          onClick={() => {
            const md = `# Research Brief: ${report.symbol} (${report.interval})\n\n**Question:** ${report.question}\n**Timestamp:** ${new Date(report.createdAt).toISOString()}\n**Market Price:** ${report.market.price}\n**24h Move:** ${report.market.change24h.toFixed(2)}%\n**Regime:** ${report.indicators.regime}\n**RSI (14):** ${report.indicators.rsi14.toFixed(1)}\n\n## Summary\n${report.summary}\n\n## Bull Case\n${report.bullCase}\n\n## Bear Case\n${report.bearCase}\n\n## Invalidation Level\n${report.invalidation}\n\n${report.newsContext ? `## News & Events\n${report.newsContext}\n` : ""}\n## Strategy Hypothesis (Custom Prompt)\n${customPrompt}\n\n---\n*Generated with Goriee AI Desk & Bitget public spot data*`;
            navigator.clipboard.writeText(md).then(() => alert("Copied research brief to clipboard as Markdown!")).catch(() => {});
          }}
        >
          Copy Brief (MD)
        </button>
        <span>Research preview · no automated or live execution</span>
      </div>
    </article>
  );
}

function CitationList({ sources }: { sources: ResearchSource[] }) {
  const safeSources = sources.filter((source) => /^https?:\/\//i.test(source.url));
  if (!safeSources.length) return <p className="citation-empty">No source links were returned by the web search.</p>;
  return <ul className="citation-list">{safeSources.map((source, index) => <li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}<span aria-hidden="true"> ↗</span></a>{source.content ? <p>{source.content}</p> : null}</li>)}</ul>;
}

function ModelReadiness({ configured, model }: { configured: boolean | null; model: string }) {
  const state = configured === null ? "checking" : configured ? "ready" : "missing";
  return (
    <div className={`model-readiness model-${state}`} role="status">
      {configured === null
        ? "Checking server-side AI configuration…"
        : configured
          ? `AI model configured: ${model}. Analysis uses the supplied Bitget market data.`
          : "AI is not configured. Add LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL to the server .env.local file, then restart the app. The key stays on the server."}
    </div>
  );
}

function ResearchLoadingStatus({
  symbol,
  interval,
  elapsed,
  includeWebResearch,
  aiModel,
  onStop,
}: {
  symbol: string;
  interval: string;
  elapsed: number;
  includeWebResearch: boolean;
  aiModel: string;
  onStop?: () => void;
}) {
  const stages = [
    {
      id: "market",
      label: "Fetch Market Data",
      shortLabel: "Candles",
      description: `Bitget ${symbol} ticker, 100 completed ${interval} candles & spread`,
    },
    {
      id: "indicators",
      label: "Calculate Indicators",
      shortLabel: "Signals",
      description: "RSI (14), EMA 20/50 cross, ATR volatility & volume ratio",
    },
    {
      id: "reasoning",
      label: includeWebResearch ? "Web Search & Synthesis" : "Deep Reasoning",
      shortLabel: includeWebResearch ? "Search" : "Reason",
      description: includeWebResearch
        ? "Querying reputable live financial sources & news context"
        : `Deep quantitative analysis via ${aiModel || "configured model"}`,
    },
    {
      id: "thesis",
      label: "Formulate Thesis",
      shortLabel: "Thesis",
      description: "Structuring bull case, bear case & invalidation levels",
    },
  ];

  let activeIndex = 0;
  if (elapsed >= 1.5 && elapsed < 3.8) activeIndex = 1;
  else if (elapsed >= 3.8 && elapsed < 16.0) activeIndex = 2;
  else if (elapsed >= 16.0) activeIndex = 3;

  const currentStage = stages[activeIndex];

  return (
    <div className="research-loading-card" role="status" aria-live="polite">
      <div className="research-loading-header">
        <div className="research-loading-pulse">
          <span className="pulse-beacon">
            <span className="pulse-ring" />
            <span className="pulse-dot" />
          </span>
          <div className="research-loading-title-group">
            <strong>Analyzing {symbol} · {interval}</strong>
            <span className="research-loading-subtitle">{currentStage.label}</span>
          </div>
        </div>
        <div className="research-loading-meta">
          {aiModel ? <span className="model-chip">{aiModel}</span> : null}
          <span className="research-timer-badge">{elapsed.toFixed(1)}s</span>
          {onStop ? (
            <button
              type="button"
              className="research-stop-btn"
              onClick={onStop}
              title="Stop research agent"
              aria-label="Stop research agent"
            >
              <span className="stop-square" />
              <span>Stop Agent</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="research-progress-track">
        <div className="research-progress-bar" />
      </div>

      <div className="research-stage-banner">
        <span className="stage-mini-spinner" />
        <div className="stage-copy">
          <span className="stage-name">{currentStage.label}</span>
          <span className="stage-detail">{currentStage.description}</span>
        </div>
      </div>

      <div className="research-stages-pipeline">
        {stages.map((stage, idx) => {
          const isDone = idx < activeIndex;
          const isActive = idx === activeIndex;
          return (
            <div
              key={stage.id}
              className={`pipeline-step ${isDone ? "is-done" : isActive ? "is-active" : "is-pending"}`}
            >
              <span className="step-indicator">
                {isDone ? <Icon name="check" size={11} /> : isActive ? <span className="step-spinner" /> : idx + 1}
              </span>
              <span className="step-name">{stage.shortLabel}</span>
            </div>
          );
        })}
      </div>

      <p className="research-model-hint">
        {aiModel.includes("glm") || aiModel.includes("nvidia")
          ? "NVIDIA NIM MoE models perform comprehensive chain-of-thought analysis before outputting the structured brief (~10 to 25s)."
          : "Grounded in Bitget public spot data. The model computes structural support, resistance, and invalidation conditions."}
      </p>
    </div>
  );
}

function ResearchLoadingSkeleton({
  symbol,
  interval,
  elapsed,
  aiModel,
  includeWebResearch,
  onStop,
}: {
  symbol: string;
  interval: string;
  elapsed: number;
  aiModel: string;
  includeWebResearch: boolean;
  onStop?: () => void;
}) {
  return (
    <article className="panel report-panel research-skeleton-card" role="status" aria-live="polite">
      <div className="skeleton-topline">
        <div className="skeleton-header-left">
          <div className="skeleton-pill skeleton-shimmer" style={{ width: 140, height: 16 }} />
          <div className="skeleton-title skeleton-shimmer" style={{ width: "70%", height: 26, marginTop: 6 }} />
        </div>
        <div className="skeleton-timer-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="skeleton-timer-badge">
            <span className="pulse-beacon">
              <span className="pulse-ring" />
              <span className="pulse-dot" />
            </span>
            <span>Reasoning ({elapsed.toFixed(1)}s)</span>
          </div>
          {onStop ? (
            <button
              type="button"
              className="research-stop-btn"
              onClick={onStop}
              title="Stop research agent"
              aria-label="Stop research agent"
            >
              <span className="stop-square" />
              <span>Stop Agent</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="skeleton-stage-row">
        <span className="stage-mini-spinner" />
        <span>
          {elapsed < 1.8
            ? `Fetching Bitget ${symbol} candles & order book spread…`
            : elapsed < 4.2
              ? `Computing technical indicators (RSI 14, EMA 20/50, ATR)…`
              : elapsed < 16
                ? includeWebResearch
                  ? "Querying live web sources and analyzing market context…"
                  : `Running deep quantitative reasoning via ${aiModel || "AI model"}…`
                : `Synthesizing institutional bull/bear cases & invalidation levels…`}
        </span>
      </div>

      <div className="skeleton-progress-track">
        <div className="skeleton-progress-bar" />
      </div>

      <div className="skeleton-facts-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-fact skeleton-shimmer" />
        ))}
      </div>

      <div className="skeleton-summary-block">
        <div className="skeleton-label skeleton-shimmer" style={{ width: 90, height: 12, marginBottom: 8 }} />
        <div className="skeleton-line skeleton-shimmer" style={{ width: "100%", height: 14, marginBottom: 6 }} />
        <div className="skeleton-line skeleton-shimmer" style={{ width: "92%", height: 14, marginBottom: 6 }} />
        <div className="skeleton-line skeleton-shimmer" style={{ width: "80%", height: 14 }} />
      </div>

      <div className="skeleton-thesis-grid">
        <div className="skeleton-thesis-card skeleton-shimmer">
          <div className="skeleton-line skeleton-shimmer" style={{ width: "50%", height: 16, marginBottom: 12 }} />
          <div className="skeleton-line skeleton-shimmer" style={{ width: "100%", height: 12, marginBottom: 6 }} />
          <div className="skeleton-line skeleton-shimmer" style={{ width: "88%", height: 12 }} />
        </div>
        <div className="skeleton-thesis-card skeleton-shimmer">
          <div className="skeleton-line skeleton-shimmer" style={{ width: "50%", height: 16, marginBottom: 12 }} />
          <div className="skeleton-line skeleton-shimmer" style={{ width: "100%", height: 12, marginBottom: 6 }} />
          <div className="skeleton-line skeleton-shimmer" style={{ width: "85%", height: 12 }} />
        </div>
      </div>

      <div className="skeleton-invalidation skeleton-shimmer" style={{ height: 60 }} />
    </article>
  );
}

function BacktestLoadingStatus({
  symbol,
  interval,
  days,
  elapsed,
  aiModel,
  onStop,
}: {
  symbol: string;
  interval: string;
  days: number;
  elapsed: number;
  aiModel: string;
  onStop?: () => void;
}) {
  const steps = [
    { label: "Compile rule", shortLabel: "Rule", desc: `Translating strategy with ${aiModel || "AI model"}` },
    { label: "Fetch candles", shortLabel: "Candles", desc: `Replaying ${days} days of Bitget ${symbol} ${interval} data` },
    { label: "Simulate fills", shortLabel: "Fills", desc: "Executing bar opens with fee, spread & slippage" },
    { label: "Robustness audit", shortLabel: "Audit", desc: "Calculating alpha, drawdowns & out-of-sample decay" },
  ];

  let currentStepIdx = 0;
  if (elapsed >= 3.5 && elapsed < 7.5) currentStepIdx = 1;
  else if (elapsed >= 7.5 && elapsed < 15.0) currentStepIdx = 2;
  else if (elapsed >= 15.0) currentStepIdx = 3;

  const currentStep = steps[currentStepIdx];

  return (
    <div className="panel backtest-loading-card" role="status" aria-live="polite">
      <div className="backtest-loading-header">
        <div className="backtest-loading-title">
          <span className="pulse-beacon">
            <span className="pulse-ring" />
            <span className="pulse-dot" />
          </span>
          <div>
            <strong>Replaying Strategy Simulation</strong>
            <span className="backtest-loading-subtitle">{symbol} · {interval} · {days}-day history</span>
          </div>
        </div>
        <div className="backtest-loading-timer" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="research-timer-badge">{elapsed.toFixed(1)}s</span>
          {onStop ? (
            <button
              type="button"
              className="research-stop-btn"
              onClick={onStop}
              title="Stop backtest simulation"
              aria-label="Stop backtest simulation"
            >
              <span className="stop-square" />
              <span>Stop Backtest</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="research-progress-track">
        <div className="research-progress-bar" />
      </div>

      <div className="backtest-stage-info">
        <span className="stage-mini-spinner" />
        <div>
          <span className="stage-name">{currentStep.label}</span>
          <span className="stage-detail">{currentStep.desc}</span>
        </div>
      </div>

      <div className="research-stages-pipeline">
        {steps.map((step, idx) => {
          const isDone = idx < currentStepIdx;
          const isActive = idx === currentStepIdx;
          return (
            <div key={step.label} className={`pipeline-step ${isDone ? "is-done" : isActive ? "is-active" : "is-pending"}`}>
              <span className="step-indicator">
                {isDone ? <Icon name="check" size={11} /> : isActive ? <span className="step-spinner" /> : idx + 1}
              </span>
              <span className="step-name">{step.shortLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EquityChart({ points }: { points: BacktestResult["equity"] }) {
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
}
