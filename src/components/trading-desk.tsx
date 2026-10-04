"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { bollingerBands, getIndicatorSnapshot, evaluatePlaybookRule } from "@/lib/bitget";
import type { Candle, MarketData, SpotScanMarket } from "@/lib/bitget";
import type { CompletedTrade } from "@/lib/backtest";
import { generateBacktestPromptFromResearch } from "@/lib/research-strategy";
import { calculateKellySizing, detectVolatilitySqueeze } from "@/lib/kelly-sizer";
import { paperCash, paperFillFee } from "@/lib/paper-accounting";
import { useBitgetTickerWs } from "@/lib/bitget-ws";
import type { WsTickerTick } from "@/lib/bitget-ws";
import { calculateParameterMatrix } from "@/lib/parameter-matrix";
import { createInitialReplayWallet, executeReplayOrder, closeReplayPosition, advanceReplayCandle, calculateReplayEquity, calculateReplayScorecard } from "@/lib/replay-engine";
import type { ReplayWallet } from "@/types/replay";
import type { MarketContextSnapshot, PaperContextSnapshot } from "@/types/copilot";
import { REPLAY_REVIEW_PHASE_LABELS, barIndexToTimelinePct, calculateReviewUnrealizedPct, calculateReviewUnrealizedPnl, resolveReplayReviewOutcome, resolveReplayReviewPhase, resolveTargetTradeReview } from "@/lib/replay-review";
import type { PaperBracketSnapshot, PaperExitReason, ReplayReviewPhase, ReplayTradeReview } from "@/lib/replay-review";
import { ProviderSettings } from "@/components/provider-settings";
import { OrderBookPanel } from "@/components/orderbook-panel";
import { MonteCarloPanel } from "@/components/monte-carlo-panel";
import { MultiChartGrid } from "@/components/multi-chart-grid";
import { RequestRecovery } from "@/components/request-recovery";
import { WorkspaceBackup } from "@/components/workspace-backup";
import { MultiHorizonConfluencePanel } from "@/components/multi-horizon-confluence";
import { StrategyCardModal } from "@/components/strategy-card-modal";
import type { CardExportData } from "@/components/strategy-card-modal";
import { CommandPalette } from "@/components/command-palette";
import { ParameterHeatmap } from "@/components/parameter-heatmap";
import { PortfolioAnalytics } from "@/components/portfolio-analytics";
import { StrategyCopilot } from "@/components/strategy-copilot";
import { ReplayScorecardModal } from "@/components/replay-scorecard-modal";
import type { View, ScannerSort, ScannerAssetType, Report, JournalItem, PaperResearchRef, PaperBacktestRef, PaperTrade, ClosedPaperTrade, PaperLedgerPosition, Quote, OpenPaperPosition, PaperAlert, PaperBracket, StrategyPlaybook, Instrument, BacktestResult, ReplayBracketConfig, ReplayTargetTrade } from "@/components/desk-types";
import { DEFAULT_WATCHLIST, STARTING_CASH, STARTER_PLAYBOOKS, supportsBacktestWindow, storageKeys, formatPrice, formatScannerPrice, formatMoney, formatPercent, formatCompact, formatDuration, tradeStrategyLabel, formatDate, researchErrorMessage, safeRead, getCustomLlmHeaders, hasCustomLlm } from "@/components/desk-shared";
import { DemoNoticeModal } from "@/components/demo-notice-modal";
import { Icon } from "@/components/desk-icon";
import { ErrorBoundary } from "@/components/error-boundary";
import { useConnectionStatus, useDocumentVisibility, useOnlineResumeToken } from "@/components/use-live-status";
import { MAX_QUOTE_AGE_MS, describeQuoteAge, isAlertTriggered, isQuoteActionable, quoteAgeMs, shouldPoll } from "@/lib/live-status";
import { safeRemove, safeWrite, safeWriteJson, subscribeToStorageFailures, registerQuotaRelief } from "@/lib/safe-storage";
import type { StorageFailureReason } from "@/lib/safe-storage";
import { relieveStorageQuota, describeDroppedStores } from "@/lib/storage-relief";
import { PriceChart } from "@/components/price-chart";
import { CumulativePnlChart, Stat, EquityChart } from "@/components/desk-charts";
import { ReportPanel, CitationList, ModelReadiness, ResearchLoadingStatus, ResearchLoadingSkeleton, BacktestLoadingStatus } from "@/components/research-panels";

export type { ReplayBracketConfig, ReplayTradeMarker, ReplayTargetTrade } from "@/components/desk-types";

export default function TradingDesk() {
  const [view, setView] = useState<View>("desk");
  const [symbol, setSymbol] = useState("BTCUSDT");
  // Deliberately NOT named `interval` / `setInterval`: a setter called
  // `setInterval` shadows `window.setInterval` for the whole component, and a
  // bare `setInterval(fn, ms)` then silently calls the React state setter
  // instead of scheduling a timer. React would invoke `fn` as an updater with
  // the previous state, so the timer never runs and state becomes `undefined`
  // — no error, no warning, just a chart that stops refreshing. Every timer in
  // this file is written `window.setInterval(...)` for the same reason.
  // Enforced by test/unit.test.mjs → "no timer global is shadowed".
  const [chartInterval, setChartInterval] = useState("1H");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketError, setMarketError] = useState("");
  /*
    `marketLoading` means "we have no dataset to show yet", NOT "a fetch is in
    flight". The difference is user-visible: it gates the Copilot submit buttons
    below, so treating a silent background refresh as loading used to disable
    them for the duration of every 60 s poll.
  */
  const [marketLoading, setMarketLoading] = useState(true);
  /*
    The `symbol:interval:tapeLimit` key of the dataset `market` currently holds.

    Needed to tell a *new dataset* from a *background refresh* of the dataset
    already on screen. A ref rather than state because it only ever changes
    alongside `market`, and the polling closure must read its live value without
    being re-subscribed to it.
  */
  const loadedMarketRef = useRef<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  // Trade Replay Simulator State
  const isReplayActive = view === "replay";
  const [isCutMode, setIsCutMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const replayIndexRef = useRef(replayIndex);
  replayIndexRef.current = replayIndex;
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayWallet, setReplayWallet] = useState<ReplayWallet>(() => createInitialReplayWallet());
  const [scorecardModalOpen, setScorecardModalOpen] = useState(false);
  const [replayTicketSide, setReplayTicketSide] = useState<"buy" | "sell">("buy");
  const [replayTicketAmount, setReplayTicketAmount] = useState<number>(500);
  const [replayTicketTpPct, setReplayTicketTpPct] = useState<number>(2.0);
  const [replayTicketSlPct, setReplayTicketSlPct] = useState<number>(1.0);
  const [replayTargetTrade, setReplayTargetTrade] = useState<ReplayTargetTrade | null>(null);

  // Effective market dataset: uses replayTargetTrade.candles if replaying a specific historical trade, otherwise live market
  const effectiveMarket = useMemo<MarketData | null>(() => {
    if (view === "replay" && replayTargetTrade?.candles && replayTargetTrade.candles.length > 0) {
      const c = replayTargetTrade.candles;
      const last = c[c.length - 1];
      return {
        symbol: replayTargetTrade.symbol,
        category: "SPOT" as const,
        interval: replayTargetTrade.interval ?? chartInterval,
        price: last.close,
        change24h: 0,
        high24h: c.reduce((max, bar) => (bar.high > max ? bar.high : max), -Infinity),
        low24h: c.reduce((min, bar) => (bar.low < min ? bar.low : min), Infinity),
        volume24h: c.reduce((sum, bar) => sum + bar.volume, 0),
        turnover24h: c.reduce((sum, bar) => sum + bar.turnover, 0),
        asOf: last.time,
        candles: c,
      };
    }
    return market;
  }, [view, replayTargetTrade, market, chartInterval]);

  // Clamped market data for zero-hindsight simulation
  const activeMarket = useMemo(() => {
    if (!effectiveMarket) return null;
    if (!isReplayActive) return effectiveMarket;
    const clampedIndex = Math.max(0, Math.min(effectiveMarket.candles.length - 1, replayIndex));
    const sliced = effectiveMarket.candles.slice(0, clampedIndex + 1);
    const lastBar = sliced[sliced.length - 1] ?? effectiveMarket.candles[0];
    return {
      ...effectiveMarket,
      price: lastBar.close,
      asOf: lastBar.time,
      candles: sliced,
    };
  }, [effectiveMarket, isReplayActive, replayIndex]);

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
    // The cooldown is a convenience, not the source of truth: aiRetryAtState
    // already holds it for this session. A failure here must never escape into
    // the click handler that called us.
    if (timestamp > Date.now()) {
      safeWrite(storageKeys.aiCooldown, String(timestamp));
    } else {
      safeRemove(storageKeys.aiCooldown);
    }
  };
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /*
    Background-tab and connectivity awareness.

    Four independent loops used to keep firing while the tab was hidden: three
    60s intervals below plus the 3s orderbook recursion. Every parked tab was
    therefore a permanent source of Bitget calls and Vercel function
    invocations producing data nobody was looking at — which also spent rate
    limit that the *foreground* tab needed, so a handful of abandoned tabs
    could push the visible one into HTTP 429s.

    `pollingEnabled` is the single gate. It is in every loop's deps, so hiding
    the tab tears the intervals down and showing it again re-runs the effect —
    which fetches immediately instead of waiting out a stale interval. A user
    returning after ten minutes sees a current price at once.

    Declared up here, ahead of the loops that consume it, because the WebSocket
    hook lives further down the file.
  */
  const documentVisible = useDocumentVisibility();
  const pollingEnabled = shouldPoll({ visible: documentVisible });
  const resumeToken = useOnlineResumeToken();
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  useEffect(() => {
    try {
      const acknowledged = window.localStorage.getItem(storageKeys.demoDisclaimer);
      if (acknowledged !== "true") {
        setDisclaimerOpen(true);
      }
    } catch {
      setDisclaimerOpen(true);
    }
  }, []);

  const handleAcknowledgeDisclaimer = useCallback(() => {
    safeWrite(storageKeys.demoDisclaimer, "true");
    setDisclaimerOpen(false);
  }, []);

  const cooldownSeconds = hasCustomLlm() ? 0 : Math.max(0, Math.ceil((aiRetryAt - clockNow) / 1000));
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
    // Persisted state is a convenience layer, never the session source of truth:
    // everything on screen already lives in React state. So a storage failure
    // must degrade to a toast rather than escape into whichever handler or
    // setState updater triggered the write.
    //
    // safeWrite is called from inside several setState updaters (the bracket and
    // ledger writes), so both paths below must never touch React state
    // synchronously — a setState from within an updater is a render-phase
    // update. Deferring to a macrotask lands the toast outside the updater,
    // which is also how the existing auto-dismiss timer works.
    const showStorageToast = (message: string) => {
      window.setTimeout(() => setToastMessage(message), 0);
    };

    // The relief handler runs synchronously *inside* safeWrite, so the retry
    // that follows it can succeed in the same call. Only stores that are safe to
    // discard are eligible; the paper ledger and bracket state are deliberately
    // excluded, because truncating them would silently change the account
    // balance or remove a stop the user believes is protecting them.
    registerQuotaRelief(() => {
      const outcome = relieveStorageQuota(window.localStorage);
      if (outcome.dropped.length > 0) {
        // Surface this even when the retry goes on to succeed. Otherwise the
        // user's copilot transcripts and saved reports would vanish with no
        // explanation, which is far worse than the full-storage error itself.
        showStorageToast(
          `Local storage was full, so ${describeDroppedStores(outcome.dropped)} were cleared to keep the desk working. Your paper account and playbooks are untouched.`,
        );
      }
      return outcome.relieved;
    });

    const unsubscribe = subscribeToStorageFailures((reason: StorageFailureReason) => {
      if (reason === "quota") {
        showStorageToast("Local storage is still full, so this change was not saved. It remains active for this session.");
        return;
      }
      if (reason === "unavailable") {
        showStorageToast("This browser is blocking local storage, so nothing will be saved between visits.");
        return;
      }
      showStorageToast("Could not save that change to local storage. It remains active for this session.");
    });

    return () => {
      unsubscribe();
      registerQuotaRelief(null);
    };
  }, []);

  useEffect(() => {
    if (!draftsReady) return;
    // Re-saved on every keystroke, so this is the first write to hit a full
    // store and the best place for the user to learn about it.
    safeWriteJson(storageKeys.drafts, { question, strategy: strategyPrompt });
  }, [draftsReady, question, strategyPrompt]);

  useEffect(() => {
    let current = true;
    fetch("/api/ai-status", { cache: "no-store", headers: getCustomLlmHeaders() })
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
  }, [symbol, chartInterval, strategyPrompt, backtestDays, feeBps, slippageBps]);

  useEffect(() => {
    if (!supportsBacktestWindow(chartInterval, backtestDays)) {
      setBacktestDays(chartInterval === "1D" ? 90 : 30);
    }
  }, [chartInterval, backtestDays]);

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
    // Suspended entirely while the tab is hidden; see the pollingEnabled note.
    if (!pollingEnabled) return;
    let current = true;
    const load = async () => {
      /*
        Tape depth is part of the dataset's identity, not just a fetch detail.
        Replay needs ~1000 bars to be worth scrubbing; the desk only draws 300.
        Keying on it is what makes entering the Replay tab refetch — `limit` was
        already computed from the view here, but the effect's dependency array
        omitted it, so the tab inherited the desk's 300-bar tape and kept it
        until the next 60 s poll happened to land. The replay studio therefore
        opened with a third of the intended history.
      */
      const tapeLimit = isReplayActive ? 1000 : 300;
      const requestKey = `${symbol}:${chartInterval}:${tapeLimit}`;
      /*
        Only a *different* dataset clears the screen. Switching symbol, interval
        or tape depth has to drop the old candles, or the chart would keep
        drawing BTC bars under an ETH label until the response landed.

        A background refresh of the dataset already on screen must not. This
        effect re-runs `load()` every 60 s, and nulling `market` there flipped
        the `{effectiveMarket ? <PriceChart/> : <placeholder>}` gate, unmounting
        and remounting the whole chart on every poll. That silently threw away
        the user's zoom, pan and hover state once a minute — and it made any
        click on a chart control land on a node that no longer existed, which is
        how it surfaced as a flaky "node detached" failure in the replay E2E.
      */
      const isNewDataset = loadedMarketRef.current !== requestKey;
      if (isNewDataset) {
        setMarketLoading(true);
        setMarket(null);
      }
      setMarketError("");
      try {
        const queryParams = new URLSearchParams({
          symbol,
          interval: chartInterval,
          limit: String(tapeLimit),
        });
        const response = await fetch(`/api/market?${queryParams.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Market data could not be loaded.");
        if (current) {
          setMarket(payload.market as MarketData);
          loadedMarketRef.current = requestKey;
        }
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
    /*
      `isReplayActive` is here rather than `view`: only the replay transition
      changes tape depth, so keying on the narrower value refetches when it
      matters without a redundant fetch on every other tab switch.
    */
  }, [symbol, chartInterval, refreshCount, pollingEnabled, resumeToken, isReplayActive]);

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
        // Exit attribution for the Replay Studio review. New fills carry an
        // explicit reason; legacy records fall back to the bracket engine's
        // stable note prefixes, and anything else stays honestly "unknown".
        outcome: resolveReplayReviewOutcome(trade.exitReason, trade.exitNote),
        takeProfitPrice: trade.bracketSnapshot?.takeProfitPrice ?? null,
        stopLossPrice: trade.bracketSnapshot?.stopLossPrice ?? null,
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
    if (!pollingEnabled) return;
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
    // Suspending leaves the last quotes in state rather than clearing them:
    // the watchlist should keep showing the prices it had — now visibly aged by
    // the staleness badge — instead of going blank while the tab is hidden.
  }, [watchlist, watchlistReady, openPositions, paperAlerts, pollingEnabled, resumeToken]);
  useEffect(() => {
    if (view !== "scanner") return;
    if (!pollingEnabled) return;
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
  }, [view, scannerRefresh, pollingEnabled, resumeToken]);
  useEffect(() => {
    /*
      The one staleness hole that was genuinely open.

      Bracket fills two effects below are gated on a 120s maximum quote age and
      always have been; alerts were not gated at all. The quotes effect keeps
      the last successfully fetched price when a refresh fails, so an alert
      would compare its trigger against a price of unbounded age — a quote from
      an hour ago, or from before the laptop slept — and then stamp
      `triggeredAt` permanently. There is no undo: the alert is consumed and
      will never fire again, on a price that may have been dead for an hour.

      Now the same MAX_QUOTE_AGE_MS rule applies, so an alert waits for a fresh
      quote instead. A skipped evaluation costs nothing — the next poll retries
      it — whereas a false trigger is unrecoverable.

      The concrete failure this closes: polling stalls for an hour, the quotes
      effect keeps the hour-old price, the user adds an alert, and adding it
      re-runs this effect — firing the new alert instantly against a dead
      price. The wall clock is deliberately not a dependency: every transition
      that matters arrives via `quotes` or `paperAlerts`, and a fresh fetch
      always carries a fresh `asOf`, so rescanning each second would only add
      work without changing any outcome.
    */
    const hits = paperAlerts.filter((alert) => {
      if (alert.triggeredAt !== null) return false;
      const quote = quotes.find((entry) => entry.symbol === alert.symbol);
      if (!quote) return false;
      return isAlertTriggered({
        direction: alert.direction,
        triggerPrice: alert.price,
        quotePrice: quote.price,
        quoteAsOf: quote.asOf,
      });
    });
    if (!hits.length) return;
    const hitIds = new Set(hits.map((alert) => alert.id));
    const next = paperAlerts.map((alert) => hitIds.has(alert.id) ? { ...alert, triggeredAt: Date.now() } : alert);
    setPaperAlerts(next);
    safeWriteJson(storageKeys.paperAlerts, next);
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
      // Same freshness rule as alerts and paper orders, now shared rather than
      // a second copy of the literal. A stale quote pauses bracket evaluation.
      if (!isQuoteActionable(quote.asOf)) return;

      if (bracket.takeProfitPrice && quote.price >= bracket.takeProfitPrice) {
        void closePaperPosition(pos.symbol, `Take-Profit hit at ${formatMoney(quote.price)} (+${bracket.takeProfitPct ?? "target"}%)`, "take_profit");
        return;
      }

      if (bracket.stopLossPrice && quote.price <= bracket.stopLossPrice) {
        void closePaperPosition(pos.symbol, `Stop-Loss triggered at ${formatMoney(quote.price)} (-${bracket.stopLossPct ?? "invalidation"}%)`, "stop_loss");
        return;
      }

      if (bracket.trailingStopPct && bracket.trailingStopPct > 0) {
        const peak = Math.max(bracket.peakPrice || pos.averageEntry, quote.price);
        const trailThreshold = peak * (1 - bracket.trailingStopPct / 100);
        if (quote.price <= trailThreshold) {
          void closePaperPosition(pos.symbol, `Trailing stop hit at ${formatMoney(quote.price)} (Peak was ${formatMoney(peak)})`, "trailing_stop");
          return;
        } else if (peak > (bracket.peakPrice || 0)) {
          setPaperBrackets((prev) => {
            const next = { ...prev, [pos.symbol]: { ...bracket, peakPrice: peak } };
            safeWriteJson(storageKeys.paperBrackets, next);
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
    safeWriteJson(storageKeys.watchlist, next);
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
    safeWriteJson(storageKeys.watchlist, next);
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
    safeWriteJson(storageKeys.paperAlerts, next);
    setAlertPrice("");
    setPaperMessage(`${alert.symbol} ${alert.direction} ${formatPrice(alert.price)} alert added.`);
    window.setTimeout(() => setPaperMessage(""), 3500);
  }

  function removePaperAlert(id: string) {
    const next = paperAlerts.filter((alert) => alert.id !== id);
    setPaperAlerts(next);
    safeWriteJson(storageKeys.paperAlerts, next);
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
      interval: chartInterval,
      prompt: strategyPrompt.trim(),
      lookbackDays: backtestDays,
      feeBps,
      slippageBps,
      createdAt: Date.now(),
    };
    const next = [item, ...playbooks].slice(0, 30);
    setPlaybooks(next);
    safeWriteJson(storageKeys.playbooks, next);
    setPlaybookName("");
    setPlaybookMessage(`“${item.name}” saved to your Playbooks library.`);
    window.setTimeout(() => setPlaybookMessage(""), 3500);
  }

  function deletePlaybook(id: string) {
    const next = playbooks.filter((playbook) => playbook.id !== id);
    setPlaybooks(next);
    safeWriteJson(storageKeys.playbooks, next);
    if (activePaperPlaybookId === id) {
      setActivePaperPlaybookId("");
      safeRemove(storageKeys.activePlaybook);
    }
  }

  function loadPlaybook(playbook: StrategyPlaybook) {
    setSymbol(playbook.symbol);
    setChartInterval(playbook.interval);
    setStrategyPrompt(playbook.prompt);
    setBacktestDays(playbook.lookbackDays);
    setFeeBps(playbook.feeBps);
    setSlippageBps(playbook.slippageBps);
    setPlaybookMessage(`Loaded “${playbook.name}” into the strategy lab.`);
    window.setTimeout(() => setPlaybookMessage(""), 3500);
  }

  function usePlaybookInPaper(playbook: StrategyPlaybook) {
    setSymbol(playbook.symbol);
    setChartInterval(playbook.interval);
    setActivePaperPlaybookId(playbook.id);
    safeWrite(storageKeys.activePlaybook, playbook.id);
    setPaperTab("account");
    setView("paper");
    setPaperMessage(`“${playbook.name}” is now active in your Paper Desk. Simulated fills on ${playbook.symbol} will be tagged with this playbook.`);
    window.setTimeout(() => setPaperMessage(""), 5000);
  }

  function deactivatePlaybookFromPaper(playbook: StrategyPlaybook) {
    if (activePaperPlaybookId === playbook.id) {
      setActivePaperPlaybookId("");
      safeRemove(storageKeys.activePlaybook);
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
      const prompt = question.trim() || `Analyze ${symbol} on the ${chartInterval} timeframe.`;
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json", ...getCustomLlmHeaders() },
        signal: controller.signal,
        body: JSON.stringify({ question: prompt, symbol, interval: chartInterval, includeWebResearch }),
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
        safeWriteJson(storageKeys.journal, next);
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
        headers: { "content-type": "application/json", ...getCustomLlmHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          symbol: overrides?.symbol ?? playbook?.symbol ?? symbol,
          interval: overrides?.interval ?? playbook?.interval ?? chartInterval,
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
      const requestInterval = overrides?.interval ?? playbook?.interval ?? chartInterval;
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
    setChartInterval(intervalToUse);
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

  function handleBacktestFromJournal(item: JournalItem) {
    const rep: Report = {
      id: item.id,
      question: item.question,
      symbol: item.symbol,
      interval: item.interval,
      market: {
        symbol: item.symbol,
        category: "SPOT",
        interval: item.interval,
        price: item.price,
        change24h: item.marketSnapshot?.change24h ?? 0,
        high24h: item.marketSnapshot?.high24h ?? item.price,
        low24h: item.marketSnapshot?.low24h ?? item.price,
        volume24h: item.marketSnapshot?.volume24h ?? 0,
        turnover24h: item.marketSnapshot?.turnover24h ?? 0,
        asOf: item.createdAt,
        candles: [],
      },
      indicators: item.indicators ?? {
        ema20: null,
        ema50: null,
        rsi14: 50,
        support: item.price * 0.98,
        resistance: item.price * 1.02,
        rangePct: 2,
        regime: item.regime,
      },
      summary: item.summary,
      bullCase: item.bullCase ?? "",
      bearCase: item.bearCase ?? "",
      invalidation: item.invalidation ?? "",
      engine: item.engine || "journal-cache",
      commentary: item.commentary ?? null,
      createdAt: item.createdAt,
    };
    handleBacktestFromReport(rep);
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
    safeWriteJson(storageKeys.playbooks, next);
    setPlaybooks(next);
    setPaperFeeBps(playbook.feeBps);
    safeWriteJson(storageKeys.paperFee, playbook.feeBps);
    usePlaybookInPaper(playbook);
    setPaperTab("account");
    setPaperMessage("Backtest saved to a playbook. Its research and result will follow your paper buys into Trade Review. Review the order before recording it.");
  }

  function placePaperOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!market || closingAssets.current.size || !Number.isFinite(Number(orderAmount)) || Number(orderAmount) <= 0) return;
    if (market.symbol !== symbol || !isQuoteActionable(market.asOf)) {
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
          safeWriteJson(storageKeys.paperBrackets, next);
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
        : orderSide === "buy" && report?.symbol === symbol && report.interval === chartInterval
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
        safeWriteJson(storageKeys.paperBrackets, next);
        return next;
      });
    } else if (orderSide === "buy" && !attachBracket) {
      setPaperBrackets((previous) => {
        if (!previous[symbol]) return previous;
        const next = { ...previous };
        delete next[symbol];
        safeWriteJson(storageKeys.paperBrackets, next);
        return next;
      });
    }

    setPaperTrades((previous) => {
      const next = [trade, ...previous];
      safeWriteJson(storageKeys.paper, next);
      return next;
    });
    setOrderOpen(false);
    setPaperMessage(`${orderSide === "buy" ? "Buy" : "Sell"} recorded in your paper account.`);
    window.setTimeout(() => setPaperMessage(""), 3500);
  }

  /**
   * Flatten a paper position and stamp the fill with *why* it closed.
   *
   * `exitReason` is what lets the Replay Studio say "Take Profit hit" instead
   * of guessing from free text. Callers that know the trigger pass it; only a
   * genuinely unattributed close falls back to "manual".
   */
  async function closePaperPosition(
    asset: string,
    customExitNote?: string,
    exitReason: PaperExitReason = "manual"
  ) {
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

      // Snapshot the bracket exactly as it stood at the closing fill. The
      // bracket row is deleted a few lines below, so this is the last chance to
      // remember the stop/target the position was actually managed against.
      const closingBracket = paperBrackets[asset];
      const bracketSnapshot: PaperBracketSnapshot | undefined = closingBracket
        ? {
            ...(closingBracket.takeProfitPrice && closingBracket.takeProfitPrice > 0
              ? { takeProfitPrice: closingBracket.takeProfitPrice }
              : {}),
            ...(closingBracket.stopLossPrice && closingBracket.stopLossPrice > 0
              ? { stopLossPrice: closingBracket.stopLossPrice }
              : {}),
            ...(closingBracket.trailingStopPct && closingBracket.trailingStopPct > 0
              ? { trailingStopPct: closingBracket.trailingStopPct }
              : {}),
          }
        : undefined;

      const trade: PaperTrade = {
        id: crypto.randomUUID(),
        symbol: asset,
        side: "sell",
        quantity: position.quantity,
        price: quote.price,
        createdAt: Date.now(),
        feeBps: paperFeeBps,
        exitNote: customExitNote,
        exitReason,
        bracketSnapshot,
      };
      setPaperTrades((previous) => {
        const next = [trade, ...previous];
        safeWriteJson(storageKeys.paper, next);
        return next;
      });
      setPaperBrackets((previous) => {
        if (!previous[asset]) return previous;
        const next = { ...previous };
        delete next[asset];
        safeWriteJson(storageKeys.paperBrackets, next);
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
      safeWriteJson(storageKeys.paper, next);
      return next;
    });
  }

  // WebSocket Live Ticker Integration
  const lastWsPriceRef = useRef<number | null>(null);
  const priceFlashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (market?.price) {
      lastWsPriceRef.current = market.price;
    }
  }, [market?.price]);

  const handleWsTick = useCallback((tick: WsTickerTick) => {
    const oldPrice = lastWsPriceRef.current;
    const newPrice = tick.price;
    if (oldPrice !== null && newPrice !== oldPrice) {
      lastWsPriceRef.current = newPrice;
      setPriceFlash(newPrice > oldPrice ? "up" : "down");
      if (priceFlashTimerRef.current) window.clearTimeout(priceFlashTimerRef.current);
      priceFlashTimerRef.current = window.setTimeout(() => setPriceFlash(null), 700);
    } else {
      lastWsPriceRef.current = newPrice;
    }

    setMarket((prev) => {
      if (!prev || prev.symbol !== tick.symbol) return prev;
      if (
        prev.price === newPrice &&
        (tick.change24h === undefined || prev.change24h === tick.change24h) &&
        (tick.high24h === undefined || prev.high24h === tick.high24h) &&
        (tick.low24h === undefined || prev.low24h === tick.low24h) &&
        (tick.volume24h === undefined || prev.volume24h === tick.volume24h) &&
        Math.abs(tick.ts - prev.asOf) < 1000
      ) {
        return prev;
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

  const { connected: wsConnected } = useBitgetTickerWs({
    symbol,
    enabled: true,
    onTick: handleWsTick,
  });

  /*
    Fold the raw signals into one honest status.

    The badge used to be `wsStatus === "connected" ? "WS Live" : "REST Polling"`
    — two outcomes for four real situations, so "Bitget's WebSocket is down",
    "you have no internet", and "REST polling is working fine" all rendered the
    same amber pill. Now the resolver distinguishes live / polling / stalled /
    offline, and only `offline` raises a banner.

    `market.asOf` is the freshness input, not `effectiveMarket.asOf`. That
    matters: on the replay path `effectiveMarket.asOf` is a *historical candle
    close*, which is hours or days old by design and would pin the badge to
    "Data Stalled" for every replay. Raw `market` holds Bitget's live ticker
    timestamp and is advanced by each WS tick, so it reflects the real feed.

    Paused while hidden, so a backgrounded tab does not report our own power
    saving as an outage.
  */
  const connection = useConnectionStatus({
    wsConnected,
    quoteAgeMs: market ? quoteAgeMs(market.asOf, clockNow) : Infinity,
    paused: !pollingEnabled,
    /*
      A null `market` means the first fetch has not resolved, so the Infinity
      above means "no data yet" rather than "no data for two minutes". Keying
      this off `!market` instead of `marketLoading` is deliberate: it depends
      only on whether we hold data, so a loading flag left stuck true cannot
      silently disable stall detection for the whole session.
    */
    awaitingFirstQuote: !market,
    maxAgeMs: MAX_QUOTE_AGE_MS,
  });
  const feed = connection.presentation;

  /*
    Which watchlist quotes have gone stale, computed once per tick instead of
    once per rendered position row. Drives the "Quotes stale (Paused)" badge in
    the positions table — the user-visible half of the bracket gate. It calls
    the same predicate with the same threshold, so the badge cannot claim
    paused while fills keep happening; the only difference is the timestamp
    source (the 1s render clock here, Date.now() in the effect), which can
    diverge by under a second at the exact boundary.
  */
  const staleQuoteSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const quote of quotes) {
      if (!isQuoteActionable(quote.asOf, clockNow, MAX_QUOTE_AGE_MS)) set.add(quote.symbol);
    }
    return set;
  }, [quotes, clockNow]);

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
            safeWriteJson(storageKeys.paperBrackets, next);
            return next;
          });
          setPaperTrades((prev) => {
            const next = [trade, ...prev];
            safeWriteJson(storageKeys.paper, next);
            return next;
          });
          actionTaken = "buy";
          logMsg = `Rule Engine Fill: Bought ${quantity.toFixed(4)} ${targetPlaybook.symbol} at ${formatMoney(currentPrice)} (${evaluation.reason})`;
          setPaperMessage(logMsg);
        }
      } else if (evaluation.action === "sell") {
        if (position && position.quantity > 0) {
    void closePaperPosition(targetPlaybook.symbol, `Rule Engine Exit: ${evaluation.reason}`, "signal_exit");
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
        safeWriteJson(storageKeys.ruleRunnerLogs, next);
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
    /*
      The fifth network loop, and the one with the highest per-tick cost: each
      evaluation fetches a full candle series and can open or close a paper
      position.

      Gating it on visibility is a deliberate change to what the feature
      promises, so it is worth stating plainly. Background tabs already have
      their timers throttled by the browser — Chrome clamps them to roughly one
      wake per minute after five minutes hidden, and suspends them outright
      under memory pressure. So a hidden auto-runner was never reliably running
      at 45s anyway; it was running at an unpredictable cadence nobody could
      observe, while still spending rate limit. Explicit suspension is the
      honest version of behaviour that was already degraded, and the status pill
      below now says so instead of reading "Active".

      Resuming re-runs the effect, which evaluates on the next tick rather than
      immediately — intentional here, unlike the data loops: the runner's own
      fetch supplies fresh candles, so there is nothing stale to catch up on,
      and firing instantly on every alt-tab would evaluate on each return.
    */
    if (!pollingEnabled) return;
    const intervalId = window.setInterval(() => {
      void runRuleEvaluation();
    }, 45_000);
    return () => window.clearInterval(intervalId);
  }, [ruleRunnerActive, runRuleEvaluation, pollingEnabled]);

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
    if (!effectiveMarket || !effectiveMarket.candles || effectiveMarket.candles.length === 0) return null;
    const clamped = Math.max(0, Math.min(effectiveMarket.candles.length - 1, replayIndex));
    return effectiveMarket.candles[clamped] ?? null;
  }, [effectiveMarket, replayIndex]);

  const handleRewindBars = useCallback((barsBack: number) => {
    if (!effectiveMarket) return;
    setReplayIndex((prev) => Math.max(0, prev - barsBack));
    setIsReplayPlaying(false);
    setIsCutMode(false);
  }, [effectiveMarket]);

  const handleStepForward = useCallback(() => {
    if (!effectiveMarket) return;
    const prev = replayIndexRef.current;
    if (prev >= effectiveMarket.candles.length - 1) return;
    const nextIdx = prev + 1;
    const nextCandle = effectiveMarket.candles[nextIdx];
    if (nextCandle) {
      setReplayWallet((w) => {
        const res = advanceReplayCandle(w, nextCandle);
        if (res.event) {
          const msg = `Bracket triggered: ${res.event.reason === "take_profit" ? "Take Profit" : "Stop Loss"} (${res.event.pnl >= 0 ? "+" : ""}$${res.event.pnl.toFixed(2)})`;
          window.setTimeout(() => setToastMessage(msg), 0);
        }
        return res.wallet;
      });
    }
    setReplayIndex(nextIdx);
  }, [effectiveMarket]);

  const handleScrubIndex = useCallback((index: number) => {
    if (!effectiveMarket) return;
    const clamped = Math.max(0, Math.min(effectiveMarket.candles.length - 1, index));
    setReplayIndex(clamped);
    setIsReplayPlaying(false);
    setIsCutMode(false);
  }, [effectiveMarket]);

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
    if (!effectiveMarket || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < effectiveMarket.candles.length; i++) {
      const diff = Math.abs(effectiveMarket.candles[i].time - replayTargetTrade.openedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    const setupIdx = Math.max(0, closestIdx - 25);
    setReplayIndex(setupIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to setup window (25 bars prior to entry)");
  }, [effectiveMarket, replayTargetTrade]);

  const handleJumpToEntry = useCallback(() => {
    if (!effectiveMarket || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < effectiveMarket.candles.length; i++) {
      const diff = Math.abs(effectiveMarket.candles[i].time - replayTargetTrade.openedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setReplayIndex(closestIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to trade entry bar");
  }, [effectiveMarket, replayTargetTrade]);

  const handleJumpToExit = useCallback(() => {
    if (!effectiveMarket || !replayTargetTrade) return;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < effectiveMarket.candles.length; i++) {
      const diff = Math.abs(effectiveMarket.candles[i].time - replayTargetTrade.closedAt);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setReplayIndex(closestIdx);
    setIsReplayPlaying(false);
    setToastMessage("Jumped to trade exit bar");
  }, [effectiveMarket, replayTargetTrade]);

  const replayFromPaperTrade = useCallback((trade: ClosedPaperTrade) => {
    const target: ReplayTargetTrade = {
      id: trade.id,
      symbol: trade.symbol,
      interval: chartInterval,
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
      // Carry the real bracket levels and the real exit attribution into the
      // replay, so the chart shows what the trader actually risked.
      takeProfitPrice: trade.takeProfitPrice,
      stopLossPrice: trade.stopLossPrice,
      outcome: trade.outcome,
      exitNote: trade.exitNote || null,
    };
    setReplayTargetTrade(target);
    if (symbol !== trade.symbol) {
      setSymbol(trade.symbol);
    }
    setIsReplayPlaying(false);
    setView("replay");
    setToastMessage(`Loaded paper trade review for ${trade.symbol}`);
  }, [chartInterval, symbol]);

  const replayFromBacktestTrade = useCallback((trade: CompletedTrade, testSymbol: string, testInterval: string, strategyPromptText?: string, backtestCandles?: Candle[]) => {
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
      candles: backtestCandles,
      // The rule engine places no bracket orders, so it never recorded a stop
      // or a target. Report that honestly instead of back-fitting a level that
      // would make the replay look more planned than the strategy really was.
      takeProfitPrice: null,
      stopLossPrice: null,
      outcome: trade.exitReason === "signal"
        ? "signal_exit"
        : trade.exitReason === "end_of_data"
          ? "end_of_data"
          : null,
      exitNote: null,
    };
    setReplayTargetTrade(target);
    if (symbol !== testSymbol) {
      setSymbol(testSymbol);
    }
    if (chartInterval !== testInterval) {
      setChartInterval(testInterval);
    }
    setIsReplayPlaying(false);
    setView("replay");
    setToastMessage(`Loaded backtest trade replay for ${testSymbol} ${testInterval}`);
  }, [symbol, chartInterval]);

  const replayScorecard = useMemo(() => {
    const currentPrice = currentReplayCandle?.close ?? 0;
    return calculateReplayScorecard(replayWallet, currentPrice);
  }, [replayWallet, currentReplayCandle]);

  // Historical trade review state. Everything the Replay Studio needs to
  // narrate one closed trade: where it entered, where the stop and the target
  // sat, where it finally left the market, and why.
  const replayTradeReview = useMemo<ReplayTradeReview | null>(() => {
    if (!replayTargetTrade) return null;
    return resolveTargetTradeReview(
      {
        openedAt: replayTargetTrade.openedAt,
        closedAt: replayTargetTrade.closedAt,
        entryPrice: replayTargetTrade.entryPrice,
        exitPrice: replayTargetTrade.exitPrice,
        side: replayTargetTrade.side,
        netPnl: replayTargetTrade.netPnl,
        returnPct: replayTargetTrade.returnPct,
        quantity: replayTargetTrade.quantity ?? null,
        takeProfitPrice: replayTargetTrade.takeProfitPrice ?? null,
        stopLossPrice: replayTargetTrade.stopLossPrice ?? null,
        outcome: replayTargetTrade.outcome ?? null,
        exitNote: replayTargetTrade.exitNote ?? null,
      },
      effectiveMarket?.candles ?? null
    );
  }, [replayTargetTrade, effectiveMarket]);

  // The playhead decides what may be drawn. Comparing it against the trade's
  // own timestamps keeps the reveal honest even when the user pans the chart or
  // uses the cut tool, because those expose bars without advancing the clock.
  const reviewPhase: ReplayReviewPhase = replayTradeReview
    ? resolveReplayReviewPhase(replayTradeReview, currentReplayCandle?.time ?? null)
    : "pre-entry";
  const reviewMarkPrice = currentReplayCandle?.close ?? null;
  const reviewUnrealizedPnl = replayTradeReview
    ? calculateReviewUnrealizedPnl(replayTradeReview, reviewMarkPrice)
    : null;
  const reviewUnrealizedPct = replayTradeReview
    ? calculateReviewUnrealizedPct(replayTradeReview, reviewMarkPrice)
    : null;

  const totalTapeBars = effectiveMarket?.candles.length ?? 0;
  const reviewEntryIndex = replayTradeReview?.entryIndex ?? null;
  const reviewExitIndex = replayTradeReview?.exitIndex ?? null;
  const reviewEntryTimelinePct = barIndexToTimelinePct(reviewEntryIndex, totalTapeBars);
  const reviewExitTimelinePct = barIndexToTimelinePct(reviewExitIndex, totalTapeBars);
  const reviewBarsHeldSoFar = reviewEntryIndex !== null
    ? Math.max(0, replayIndex - reviewEntryIndex)
    : null;

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
    // While reviewing a historical trade there is no live position, so the only
    // brackets left would be the order ticket's *preview* levels anchored to the
    // current playhead bar. Those phantom TP/SL lines land right on top of the
    // reviewed trade's real levels and are the single biggest reason the replay
    // reads as confusing. Suppress them until the user actually enters a trade.
    if (replayTargetTrade) return undefined;
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
    replayTargetTrade,
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
    if (view === "replay" && effectiveMarket?.candles?.length) {
      if (replayTargetTrade && effectiveMarket.symbol === replayTargetTrade.symbol) {
        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < effectiveMarket.candles.length; i++) {
          const diff = Math.abs(effectiveMarket.candles[i].time - replayTargetTrade.openedAt);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
        const setupIdx = Math.max(0, closestIdx - 25);
        setReplayIndex(setupIdx);
      } else if (replayIndex === 0) {
        setReplayIndex(Math.max(0, effectiveMarket.candles.length - 25));
      }
    }
  }, [view, effectiveMarket?.candles?.length, effectiveMarket?.symbol, replayTargetTrade?.id]);

  // Pause playback and clear cut mode when switching views
  useEffect(() => {
    if (view !== "replay") {
      setIsReplayPlaying(false);
      setIsCutMode(false);
    }
  }, [view]);

  // Replay playback timer
  useEffect(() => {
    if (!isReplayActive || !isReplayPlaying || !effectiveMarket) return;
    const intervalMs = Math.max(100, Math.round(1000 / replaySpeed));
    const timer = window.setInterval(() => {
      const prev = replayIndexRef.current;
      if (prev >= effectiveMarket.candles.length - 1) {
        setIsReplayPlaying(false);
        setToastMessage("Replay reached the end of history.");
        return;
      }
      const nextIdx = prev + 1;
      const nextCandle = effectiveMarket.candles[nextIdx];
      if (nextCandle) {
        setReplayWallet((w) => {
          const res = advanceReplayCandle(w, nextCandle);
          if (res.event) {
            const msg = `Bracket triggered: ${res.event.reason === "take_profit" ? "Take Profit" : "Stop Loss"} (${res.event.pnl >= 0 ? "+" : ""}$${res.event.pnl.toFixed(2)})`;
            window.setTimeout(() => setToastMessage(msg), 0);
          }
          return res.wallet;
        });
      }
      setReplayIndex(nextIdx);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isReplayActive, isReplayPlaying, replaySpeed, effectiveMarket]);

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
    if (!effectiveMarket || !effectiveMarket.candles) return [];
    if (isReplayActive && !isCutMode && activeMarket) {
      return activeMarket.candles;
    }
    return effectiveMarket.candles;
  }, [effectiveMarket, isReplayActive, isCutMode, activeMarket]);

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
      interval: chartInterval,
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
  }, [activeMarket, chartInterval, liveIndicators]);

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
    const targetInterval = action.interval || chartInterval;
    const targetPrompt = action.strategyPrompt || strategyPrompt;
    const targetDays = action.lookbackDays || backtestDays;

    if (targetSymbol !== symbol) setSymbol(targetSymbol);
    if (targetInterval !== chartInterval) setChartInterval(targetInterval);
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
  }, [symbol, chartInterval, strategyPrompt, backtestDays]);

  const handleCopilotSavePlaybook = useCallback((action: any) => {
    const newPlaybook: StrategyPlaybook = {
      id: crypto.randomUUID(),
      name: action.title || `Copilot Playbook (${action.symbol || symbol})`,
      symbol: action.symbol || symbol,
      interval: action.interval || chartInterval,
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
    safeWriteJson(storageKeys.playbooks, next);
    setView("playbooks");
    setToastMessage(`Playbook "${newPlaybook.name}" saved successfully.`);
  }, [symbol, chartInterval, playbooks]);

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
      interval: chartInterval,
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
      safeWriteJson(storageKeys.journal, next);
      return next;
    });
    setView("journal");
    setToastMessage(`Strategy conversation exported to Trade Journal.`);
  }, [symbol, chartInterval, liveIndicators, market, aiModel]);

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
          {/*
            Page-level connectivity banner, above every tab and outside the
            ErrorBoundary so a crashing view cannot take the warning down with
            it.

            Only `offline` raises it. A stalled feed is real but is already
            legible in the badge, and a tab left open overnight would otherwise
            greet the user with an alarm for something that fixes itself on the
            next poll. `live` and `polling` are both healthy states and stay
            silent — REST polling is a designed fallback, not a failure.

            role="alert" announces it to screen readers the moment it appears,
            which is the point: the desk otherwise keeps rendering plausible
            prices with no indication that they are frozen.
          */}
          {feed.banner ? (
            <div className="error-banner feed-offline-banner" role="alert">
              <div>
                <strong>{feed.bannerTitle}</strong>
                <span>{feed.bannerDetail}</span>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setRefreshCount((count) => count + 1)}
              >
                Retry now
              </button>
            </div>
          ) : null}

          {/*
            One boundary around the whole view-switch region rather than one per
            tab: the views are mutually exclusive, so only one branch ever
            renders at a time and a single boundary isolates a crash exactly as
            well as nine would. resetKey={view} means switching tabs clears a
            caught error, so a user who lands on a broken view can click any
            other tab and keep working. Header, nav and footer stay mounted
            either way.
          */}
          <ErrorBoundary label="This view" resetKey={view}>
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
                  <label className="interval-control"><span>Chart interval</span><select value={chartInterval} onChange={(event) => setChartInterval(event.target.value)} aria-label="Chart interval">{["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}</select></label>
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
                          className={`ws-status-badge ${feed.modifier}`}
                          title={`${feed.title}${market ? ` · Quote ${describeQuoteAge(market.asOf, clockNow)}` : ""}`}
                          role={feed.role}
                        >
                          <span className={feed.dot} />
                          {feed.label}
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
                      <strong>Bitget public API {wsConnected ? "+ WebSocket Stream" : ""}</strong>
                      <span>
                        {market ? `Updated ${formatDate(market.asOf)}` : marketLoading ? "Fetching latest data" : "Waiting for connection"}
                        {!documentVisible && market ? " · paused while this tab is in the background" : ""}
                      </span>
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
                            {symbol} · {chartInterval} candles · latest 100 shown
                          </p>
                        </div>
                        <div className="chart-heading-actions">
                          <span className="chart-source">OHLCV · Bitget</span>
                        </div>
                      </div>

                      {market ? (
                        <PriceChart
                          candles={market.candles}
                          label={`${symbol} ${chartInterval} price history from Bitget`}
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
                            <textarea id="research-question" rows={4} maxLength={600} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`Analyze ${symbol} on the ${chartInterval} chart. Show both sides and what would change the read.`} />
                            <div className="prompt-examples"><span>Try:</span><button type="button" onClick={() => setQuestion(`Analyze ${symbol} on the ${chartInterval} chart. Show both sides and what would change the read.`)}>Read the current structure</button><button type="button" onClick={() => setQuestion(`Summarize momentum and what would invalidate the current read for ${symbol}.`)}>Check momentum</button></div>
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
                                interval={chartInterval}
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
                      <div className="panel-heading"><div><h2>Market reading</h2><p>Computed from the latest {chartInterval} candles.</p></div><button className="text-button" onClick={() => setView("research")}>Open research <Icon name="arrow" size={14} /></button></div>
                      {market ? <div className="reading-row"><div className="reading-state"><span className={`regime-mark ${(liveIndicators?.regime ?? report?.indicators?.regime) === "Bullish structure" ? "regime-up" : (liveIndicators?.regime ?? report?.indicators?.regime) === "Bearish structure" ? "regime-down" : ""}`} /><div><strong>{liveIndicators?.regime ?? (report && report.symbol === symbol && report.interval === chartInterval ? report.indicators.regime : "Ready for analysis")}</strong><span>{liveIndicators ? `Calculated from current ${chartInterval} candles (RSI: ${liveIndicators.rsi14.toFixed(1)})` : "Run a research brief to calculate the trend structure"}</span></div></div><div className="reading-data"><span>Last price</span><strong>{formatMoney(market.price)}</strong></div><div className="reading-data"><span>24h move</span><strong className={market.change24h >= 0 ? "tone-up" : "tone-down"}>{market.change24h >= 0 ? "+" : ""}{market.change24h.toFixed(2)}%</strong></div></div> : <div className="quiet-empty">Market reading will appear once data is available.</div>}
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
                        <select value={chartInterval} onChange={(event) => setChartInterval(event.target.value)} aria-label="Choose timeframe">
                          {["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}
                        </select>
                        <button type="button" className="browse-markets-button" onClick={() => { setInstrumentQuery(""); setPickerOpen(true); }}>
                          <Icon name="search" size={13} /> Browse markets
                        </button>
                      </div>

                      <div className="research-prompt-chips" role="group" aria-label="Quick research prompt starters">
                        <span className="chips-label">Topics:</span>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Analyze ${symbol} on the ${chartInterval} chart. Show both sides and what would change the read.`)}>Structure &amp; Trend</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Evaluate RSI momentum, 20/50 EMA structure, and volume confirmation on ${symbol} ${chartInterval}.`)}>Momentum &amp; RSI</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Identify immediate support, overhead resistance, and structural invalidation levels for ${symbol} on ${chartInterval}.`)}>Key Levels &amp; Stops</button>
                        <button type="button" className="prompt-chip" onClick={() => setQuestion(`Is ${symbol} compressing for a continuation breakout or showing distribution signs on ${chartInterval}?`)}>Breakout vs Range</button>
                      </div>

                      <textarea
                        id="research-question-page"
                        rows={3}
                        maxLength={600}
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder={`Analyze ${symbol} on the ${chartInterval} timeframe. Show support, resistance, and invalidation.`}
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
                              : `Research ${symbol} (${chartInterval})`}
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
                      <span className="preflight-pair-tag">{symbol} · {chartInterval}</span>
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
                          onClick={() => setQuestion(`Analyze ${symbol} on the ${chartInterval} chart using Elliott Wave theory. Map the current impulse (waves 1-5) or corrective (A-B-C) structure, key Fibonacci retracement targets, and price levels that invalidate the count.`)}
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
                          onClick={() => setQuestion(`Assess ${symbol} on ${chartInterval} using the Wyckoff Method. Determine whether current price action represents Accumulation (Phase C/Spring) or Distribution (UTAD), referencing volume spread.`)}
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
                          onClick={() => setQuestion(`Analyze ${symbol} ${chartInterval} through Smart Money Concepts (SMC). Identify unmitigated Fair Value Gaps (FVG), order blocks, and where institutional liquidity pools reside.`)}
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
                          onClick={() => setQuestion(`Evaluate multi-indicator confluence on ${symbol} ${chartInterval}. Compare 20/50 EMA slope, RSI momentum divergence, and Bollinger Band width to formulate a high-probability trade hypothesis.`)}
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
                          <small>100 completed {chartInterval} bars with volume</small>
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
                  interval={chartInterval}
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
                    <div className="guide-card" onClick={() => setQuestion(`Analyze ${symbol} on the ${chartInterval} chart. Show both sides and what would change the read.`)}>
                      <div className="guide-card-icon"><Icon name="trending" size={16} /></div>
                      <h3>Structure &amp; Multi-Horizon Trend</h3>
                      <p>Inspect higher-high progression, EMA 20/50 support shelves, and multi-day returns across 24h, 72h, and 168h windows.</p>
                      <span className="guide-card-action">Use hypothesis &rarr;</span>
                    </div>
                    <div className="guide-card" onClick={() => setQuestion(`Evaluate RSI momentum, 20/50 EMA structure, and volume confirmation on ${symbol} ${chartInterval}.`)}>
                      <div className="guide-card-icon"><Icon name="scan" size={16} /></div>
                      <h3>Momentum &amp; Volume Exhaustion</h3>
                      <p>Detect RSI divergence, 20-bar volume acceleration, and whether recent tests of resistance happened on thin liquidity.</p>
                      <span className="guide-card-action">Use hypothesis &rarr;</span>
                    </div>
                    <div className="guide-card" onClick={() => setQuestion(`Identify immediate calculated support, overhead resistance, and structural invalidation levels for ${symbol} on the ${chartInterval}.`)}>
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
                  <label className="interval-control"><span>Test interval</span><select value={chartInterval} onChange={(event) => { const nextInterval = event.target.value; setChartInterval(nextInterval); if (!supportsBacktestWindow(nextInterval, backtestDays)) setBacktestDays(nextInterval === "1D" ? 90 : 30); }} aria-label="Backtest interval">{["15m", "1H", "4H", "1D"].map((value) => <option key={value}>{value}</option>)}</select></label>
                  <label className="backtest-control"><span>History window</span><select value={backtestDays} onChange={(event) => setBacktestDays(Number(event.target.value))}>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days} disabled={!supportsBacktestWindow(chartInterval, days)}>{days} days</option>)}</select></label>
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
                      disabled={aiConfigured === false || strategyPrompt.trim().length < 8 || !supportsBacktestWindow(chartInterval, backtestDays) || requestBusy.current || cooldownSeconds > 0}
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
                  interval={chartInterval}
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
                              onClick={() => replayFromBacktestTrade(bestTrade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt, backtest.candles)}
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
                              onClick={() => replayFromBacktestTrade(worstTrade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt, backtest.candles)}
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
                                      onClick={() => replayFromBacktestTrade(trade, backtest.symbol, backtest.interval, backtest.strategy?.summary || strategyPrompt, backtest.candles)}
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
                        setChartInterval("1H");
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
                        setChartInterval("15m");
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
                        setChartInterval("4H");
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
                        setChartInterval("1D");
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
                        className={`replay-interval-pill ${chartInterval === intvl ? "active" : ""}`}
                        onClick={() => setChartInterval(intvl)}
                        role="radio"
                        aria-checked={chartInterval === intvl}
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
                    {/* Playhead phase, so the viewer always knows whether the
                        trade has entered, is running, or has already closed. */}
                    <span className={`replay-review-phase phase-${reviewPhase}`}>
                      {REPLAY_REVIEW_PHASE_LABELS[reviewPhase]}
                    </span>
                    {/* Entry, exit and P&L stay withheld until the tape has
                        actually reached them — the replay never spoils its own
                        ending while the position is still open. */}
                    {reviewPhase === "pre-entry" ? (
                      <span className="replay-review-metric is-pending">
                        Entry: <strong>awaiting fill</strong>
                      </span>
                    ) : (
                      <>
                        <span className="replay-review-metric">
                          Entry: <strong>${formatPrice(replayTargetTrade.entryPrice)}</strong>
                        </span>
                        {reviewPhase === "closed" ? (
                          <>
                            <span className="replay-review-metric">
                              Exit: <strong>${formatPrice(replayTargetTrade.exitPrice)}</strong>
                            </span>
                            <span className={`replay-review-pnl ${replayTargetTrade.netPnl >= 0 ? "tone-up" : "tone-down"}`}>
                              {replayTargetTrade.netPnl >= 0 ? "+" : ""}{formatMoney(replayTargetTrade.netPnl)} ({replayTargetTrade.returnPct >= 0 ? "+" : ""}{replayTargetTrade.returnPct.toFixed(2)}%)
                            </span>
                          </>
                        ) : reviewUnrealizedPnl === null ? (
                          <span className="replay-review-metric is-pending">
                            Open P/L: <strong>--</strong>
                          </span>
                        ) : (
                          <span className={`replay-review-pnl ${reviewUnrealizedPnl >= 0 ? "tone-up" : "tone-down"}`}>
                            Open: {reviewUnrealizedPnl >= 0 ? "+" : ""}{formatMoney(reviewUnrealizedPnl)}
                            {reviewUnrealizedPct === null ? "" : ` (${reviewUnrealizedPct >= 0 ? "+" : ""}${reviewUnrealizedPct.toFixed(2)}%)`}
                          </span>
                        )}
                      </>
                    )}
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
                          {symbol} · {chartInterval} · Bar {replayIndex + 1} of {effectiveMarket?.candles.length ?? 0}
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

                    {effectiveMarket ? (
                      <PriceChart
                        height={380}
                        candles={chartCandles}
                        label={`${symbol} ${chartInterval} historical replay chart`}
                        indicators={liveIndicators}
                        isCutMode={isCutMode}
                        replayBrackets={replayBracketsConfig}
                        replayTrades={replayWallet.closedTrades}
                        activePosition={replayWallet.position}
                        targetTradeReview={replayTargetTrade && replayTradeReview ? {
                          review: replayTradeReview,
                          phase: reviewPhase,
                          markPrice: reviewMarkPrice,
                          label: replayTargetTrade.origin === "paper" ? "Paper Trade" : "Backtest Trade",
                        } : null}
                        onCutCandle={(candle) => {
                          if (!effectiveMarket) return;
                          const idx = effectiveMarket.candles.findIndex((c) => c.time === candle.time);
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
                    {effectiveMarket && (
                      <div className="replay-transport-dock" role="region" aria-label="Replay Playback Console">
                        {/* Timeline Scrubber */}
                        <div className="replay-dock-timeline">
                          <div className="replay-dock-timeline-labels">
                            <span className="timeline-bar-count">
                              Bar <strong>{replayIndex + 1}</strong> of <strong>{effectiveMarket.candles.length}</strong>
                            </span>
                            <span className="timeline-date-stamp">
                              {currentReplayCandle ? formatDate(currentReplayCandle.time, false) : "--"}
                            </span>
                          </div>
                          <div className="replay-dock-scrubber-track">
                            <input
                              type="range"
                              min={0}
                              max={Math.max(0, effectiveMarket.candles.length - 1)}
                              value={Math.max(0, Math.min(effectiveMarket.candles.length - 1, replayIndex))}
                              onChange={(e) => handleScrubIndex(Number(e.target.value))}
                              className="replay-dock-scrubber"
                              aria-label="Replay timeline scrubber"
                            />
                            {/* Entry / exit ticks pin the reviewed trade to the
                                timeline, so it is obvious how far into the tape
                                the position opened and where it finally closed. */}
                            {reviewEntryTimelinePct !== null && (
                              <span
                                className="scrubber-marker marker-entry"
                                style={{ left: `calc(7.5px + ${reviewEntryTimelinePct / 100} * (100% - 15px))` }}
                                aria-hidden="true"
                              >
                                <span className="scrubber-marker-label">ENTRY</span>
                              </span>
                            )}
                            {reviewExitTimelinePct !== null && (
                              <span
                                className="scrubber-marker marker-exit"
                                style={{ left: `calc(7.5px + ${reviewExitTimelinePct / 100} * (100% - 15px))` }}
                                aria-hidden="true"
                              >
                                <span className="scrubber-marker-label">EXIT</span>
                              </span>
                            )}
                          </div>
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
                              <span className="playback-glyph" aria-hidden="true">
                                {isReplayPlaying ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="5" y="4" width="4" height="16" rx="1" />
                                    <rect x="15" y="4" width="4" height="16" rx="1" />
                                  </svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 4.75v14.5a.75.75 0 0 0 1.15.64l12-7.25a.75.75 0 0 0 0-1.28l-12-7.25A.75.75 0 0 0 6 4.75z" />
                                  </svg>
                                )}
                              </span>
                              <span className="playback-label">{isReplayPlaying ? "Pause" : "Play"}</span>
                              <kbd className="playback-kbd">Space</kbd>
                            </button>

                            <button
                              type="button"
                              className="replay-dock-step-btn"
                              onClick={handleStepForward}
                              disabled={replayIndex >= effectiveMarket.candles.length - 1}
                              title="Advance 1 candle forward (→ or F)"
                            >
                              <span>Step 1 Bar</span>
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

                  {/* Reviewed Trade Details — the phase aware readout of the
                      same levels drawn on the chart. Values stay withheld until
                      the tape has earned them, and nothing is invented when the
                      source trade never recorded a bracket or an exit reason. */}
                  {replayTargetTrade && replayTradeReview && (
                    <section
                      className="panel replay-card replay-trade-review-card"
                      aria-labelledby="replay-review-details-heading"
                    >
                      <div className="replay-card-header">
                        <h3 id="replay-review-details-heading">Trade Details</h3>
                        <span className={`review-phase-badge phase-${reviewPhase}`}>
                          {REPLAY_REVIEW_PHASE_LABELS[reviewPhase]}
                        </span>
                      </div>

                      {reviewPhase === "closed" && (
                        <div
                          className={`review-outcome-banner outcome-${replayTradeReview.outcome} ${
                            replayTradeReview.netPnl >= 0 ? "is-win" : "is-loss"
                          }`}
                        >
                          <span className="review-outcome-label">{replayTradeReview.outcomeLabel}</span>
                          <strong className="review-outcome-pnl">
                            {replayTradeReview.netPnl >= 0 ? "+" : ""}{formatMoney(replayTradeReview.netPnl)}
                            <span className="review-outcome-pct">
                              {replayTradeReview.returnPct >= 0 ? "+" : ""}{replayTradeReview.returnPct.toFixed(2)}%
                            </span>
                          </strong>
                        </div>
                      )}

                      <dl className="review-detail-grid">
                        {(() => {
                          const entryKnown = reviewPhase !== "pre-entry";
                          const closed = reviewPhase === "closed";
                          const stopHit = replayTradeReview.outcome === "stop_loss"
                            || replayTradeReview.outcome === "trailing_stop";
                          const targetHit = replayTradeReview.outcome === "take_profit";
                          const rows: { key: string; label: string; value: string; tone: string; hit: boolean }[] = [];

                          rows.push({
                            key: "entry",
                            label: "Entry price",
                            value: entryKnown ? `$${formatPrice(replayTradeReview.entryPrice)}` : "Awaiting fill",
                            tone: entryKnown ? "entry" : "pending",
                            hit: false,
                          });
                          rows.push({
                            key: "stop",
                            label: "Stop Loss",
                            value: !entryKnown
                              ? "Awaiting fill"
                              : replayTradeReview.stopLossPrice !== null
                                ? `$${formatPrice(replayTradeReview.stopLossPrice)}`
                                : "Not recorded",
                            tone: !entryKnown
                              ? "pending"
                              : replayTradeReview.stopLossPrice !== null ? "sl" : "muted",
                            hit: closed && stopHit && replayTradeReview.stopLossPrice !== null,
                          });
                          rows.push({
                            key: "target",
                            label: "Take Profit",
                            value: !entryKnown
                              ? "Awaiting fill"
                              : replayTradeReview.takeProfitPrice !== null
                                ? `$${formatPrice(replayTradeReview.takeProfitPrice)}`
                                : "Not recorded",
                            tone: !entryKnown
                              ? "pending"
                              : replayTradeReview.takeProfitPrice !== null ? "tp" : "muted",
                            hit: closed && targetHit && replayTradeReview.takeProfitPrice !== null,
                          });
                          rows.push({
                            key: "rr",
                            label: "Planned R:R",
                            value: !entryKnown
                              ? "Awaiting fill"
                              : replayTradeReview.riskRewardRatio !== null
                                ? `${replayTradeReview.riskRewardRatio.toFixed(2)} : 1`
                                : "Not derivable",
                            tone: entryKnown && replayTradeReview.riskRewardRatio !== null ? "neutral" : "muted",
                            hit: false,
                          });
                          rows.push({
                            key: "held",
                            label: closed ? "Bars held" : "Bars held so far",
                            value: closed
                              ? replayTradeReview.barsHeld !== null ? `${replayTradeReview.barsHeld}` : "--"
                              : reviewBarsHeldSoFar !== null ? `${reviewBarsHeldSoFar}` : "--",
                            tone: "neutral",
                            hit: false,
                          });
                          rows.push({
                            key: "exit",
                            label: "Exit price",
                            value: closed ? `$${formatPrice(replayTradeReview.exitPrice)}` : "Position still open",
                            tone: closed ? "exit" : "pending",
                            hit: false,
                          });
                          rows.push({
                            key: "rmultiple",
                            label: "Result (R multiple)",
                            value: closed
                              ? replayTradeReview.rMultiple !== null
                                ? `${replayTradeReview.rMultiple >= 0 ? "+" : ""}${replayTradeReview.rMultiple.toFixed(2)}R`
                                : "Not derivable"
                              : "Position still open",
                            tone: closed
                              ? replayTradeReview.rMultiple !== null
                                ? replayTradeReview.rMultiple >= 0 ? "tp" : "sl"
                                : "muted"
                              : "pending",
                            hit: false,
                          });
                          if (entryKnown && !closed && reviewUnrealizedPnl !== null) {
                            rows.push({
                              key: "open",
                              label: "Open P/L",
                              value: `${reviewUnrealizedPnl >= 0 ? "+" : ""}${formatMoney(reviewUnrealizedPnl)}${
                                reviewUnrealizedPct === null
                                  ? ""
                                  : ` (${reviewUnrealizedPct >= 0 ? "+" : ""}${reviewUnrealizedPct.toFixed(2)}%)`
                              }`,
                              tone: reviewUnrealizedPnl >= 0 ? "tp" : "sl",
                              hit: false,
                            });
                          }

                          return rows.map((row) => (
                            <div
                              key={row.key}
                              className={`review-detail-row tone-${row.tone}${row.hit ? " is-hit" : ""}`}
                            >
                              <dt className="review-detail-label">{row.label}</dt>
                              <dd className="review-detail-value">{row.value}</dd>
                            </div>
                          ));
                        })()}
                      </dl>

                      {reviewPhase === "pre-entry" ? (
                        <p className="review-hint">
                          Entry, Stop Loss and Take Profit land on the chart the moment the tape reaches the entry bar
                          {reviewEntryIndex !== null && reviewEntryIndex > replayIndex
                            ? ` — ${reviewEntryIndex - replayIndex} bar${reviewEntryIndex - replayIndex === 1 ? "" : "s"} ahead.`
                            : "."}
                        </p>
                      ) : reviewPhase === "in-trade" ? (
                        <p className="review-hint">
                          Position open. The exit price and final result stay withheld until the tape reaches the closing bar.
                        </p>
                      ) : (
                        <p className="review-hint">
                          Trade closed. Use the ENTRY and EXIT ticks on the timeline to scrub back through either bar.
                        </p>
                      )}
                    </section>
                  )}

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
                                  safeWriteJson(storageKeys.playbooks, next);
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
                    <label><span>Fee assumption · bps / fill</span><input type="number" min="0" max="1000" step="1" value={paperFeeBps} onChange={(event) => { const nextFee = Math.max(0, Math.min(1000, Number(event.target.value) || 0)); setPaperFeeBps(nextFee); safeWriteJson(storageKeys.paperFee, nextFee); }} /></label>
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
                        setChartInterval(activePaperPlaybook.interval);
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
                        safeRemove(storageKeys.activePlaybook);
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
                      {/*
                        Three states, not two. "Active" while hidden would have
                        been the same false claim as the orderbook's
                        "Live stream active" dot: the runner is switched on but
                        is not evaluating anything.
                      */}
                      <span
                        className={`rule-runner-status-pill ${ruleRunnerActive ? (documentVisible ? "status-active" : "status-suspended") : "status-paused"}`}
                        title={
                          ruleRunnerActive
                            ? documentVisible
                              ? "Evaluating playbook rules every 45 seconds"
                              : "Switched on, but suspended while this tab is in the background. Evaluations resume the moment you return."
                            : "Auto-runner is off"
                        }
                      >
                        <span className={ruleRunnerActive ? (documentVisible ? "pulse-dot-green" : "pulse-dot-amber") : "pulse-dot-gray"} />
                        {ruleRunnerActive ? (documentVisible ? "Auto-Runner Active" : "Auto-Runner Suspended (tab hidden)") : "Auto-Runner Paused"}
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
                        safeWriteJson(storageKeys.autoRuleRunner, next);
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
                          safeRemove(storageKeys.ruleRunnerLogs);
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
                          {staleQuoteSymbols.has(position.symbol) ? (
                            <span
                              className="bracket-stale-badge"
                              title={`Bitget quote is ${describeQuoteAge(quote?.asOf, clockNow)} (maximum ${MAX_QUOTE_AGE_MS / 60000} minutes). Bracket evaluation is paused until fresh quotes arrive.`}
                            >
                              ● Quotes stale &gt;{MAX_QUOTE_AGE_MS / 60000}m (Paused)
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
                      <input id="paper-loss-limit" type="number" min="1" max="100000" step="25" value={dailyLossLimit} onChange={(event) => { const value = Math.max(1, Math.min(100000, Number(event.target.value) || 1)); setDailyLossLimit(value); safeWriteJson(storageKeys.paperRisk, value); }} />
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
                            setChartInterval("1H");
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
                            setChartInterval("15m");
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
                            setChartInterval("4H");
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
                                          <div className="journal-row-btn-group">
                                            <button
                                              type="button"
                                              className="journal-row-backtest-btn"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleBacktestFromJournal(item);
                                              }}
                                              title={`Backtest ${item.symbol} in Strategy Lab`}
                                              aria-label={`Backtest ${item.symbol} in Strategy Lab`}
                                            >
                                              <Icon name="backtest" size={11} /> Backtest
                                            </button>
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
                                          </div>
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

                      <div className="detail-pane-quick-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => handleBacktestFromJournal(activeJournalPreview)}
                          title={`Backtest ${activeJournalPreview.symbol} in Strategy Lab`}
                        >
                          <Icon name="backtest" size={14} /> Backtest in Lab
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            setSymbol(activeJournalPreview.symbol);
                            setChartInterval(activeJournalPreview.interval);
                            setOrderSide("buy");
                            setOrderOpen(true);
                          }}
                          title="Open paper order ticket for this token"
                        >
                          <Icon name="paper" size={13} /> Simulate Order
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setSelectedJournalItem(activeJournalPreview)}
                          title="Open full expanded modal"
                        >
                          Full Modal <Icon name="arrow" size={11} />
                        </button>
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
                    </aside>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
          {view === "settings" ? <><ProviderSettings /><WorkspaceBackup /></> : null}
          </ErrorBoundary>
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
                    safeWriteJson(storageKeys.paperBrackets, next);
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
                    safeWriteJson(storageKeys.paperBrackets, next);
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
        <div className="journal-modal-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              handleBacktestFromJournal(selectedJournalItem);
              setSelectedJournalItem(null);
            }}
          >
            <Icon name="backtest" size={14} /> Backtest in Lab
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setSymbol(selectedJournalItem.symbol);
              setChartInterval(selectedJournalItem.interval);
              setOrderSide("buy");
              setOrderOpen(true);
              setSelectedJournalItem(null);
            }}
          >
            <Icon name="paper" size={13} /> Simulate Order
          </button>
        </div>
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
        onSetInterval={(int) => setChartInterval(int)}
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
        interval={chartInterval}
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
        interval={chartInterval}
        onRestartReplay={handleRestartReplay}
        onClose={handleCloseScorecard}
      />

      <DemoNoticeModal
        isOpen={disclaimerOpen}
        onContinue={handleAcknowledgeDisclaimer}
      />
    </main>
  );
}
