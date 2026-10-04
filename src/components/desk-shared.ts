import type { ClosedPaperTrade, StrategyPlaybook } from "@/components/desk-types";

export const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
export const STARTING_CASH = 10_000;
export const STARTER_PLAYBOOKS: Array<Omit<StrategyPlaybook, "id" | "createdAt">> = [
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
export const intervalMsByName: Record<string, number> = {
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function supportsBacktestWindow(interval: string, days: number) {
  const intervalMs = intervalMsByName[interval];
  if (!intervalMs) return false;
  const estimatedBars = Math.ceil(days * 24 * 60 * 60_000 / intervalMs);
  return estimatedBars >= 65 && estimatedBars <= 12_000;
}

export const storageKeys = {
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
  demoDisclaimer: "goriee.demo-disclaimer-acknowledged.v1",
  /** In-progress research/strategy input text, re-saved on every keystroke. */
  drafts: "goriee.drafts.v1",
  /**
   * Copilot transcripts. Note the underscore-separated spelling: it predates the
   * dotted convention used by every other key, and renaming it would orphan the
   * chat history already saved in users' browsers.
   */
  copilotSessions: "goriee_copilot_sessions_v1",
};

export function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 4,
    maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 6,
  }).format(value);
}

export function formatScannerPrice(value: number) {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
}

export function formatMoney(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function formatDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function tradeStrategyLabel(trade: ClosedPaperTrade) {
  return trade.playbookNames[0] ?? trade.backtestRefs[0]?.summary ?? "Manual paper";
}

export function formatDate(value: number, includeTime = true) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

export function researchErrorMessage(message: string) {
  // The desk's own pacing messages (src/lib/ai-rate-limit.ts) start with "The
  // desk is" and must survive verbatim: the 429 branch below would otherwise
  // rewrite them into "The AI provider is temporarily limiting requests",
  // sending the user to check a provider quota that has nothing to do with our
  // server-side throttle.
  if (/^The desk is /i.test(message)) return message;
  if (/no endpoints found that can handle the requested parameters/i.test(message)) {
    return "OpenRouter could not find an available route for this request. Review the selected model in AI settings, then try again.";
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return "The AI provider is temporarily limiting requests. Wait a moment, then try again.";
  }
  return message;
}

export function safeRead<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
