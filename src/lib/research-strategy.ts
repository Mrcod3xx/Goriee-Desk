export type ResearchReportLike = {
  symbol: string;
  interval: string;
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
  question?: string;
};

function formatPriceNumber(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "support";
  return price >= 1000
    ? `$${Math.round(price).toLocaleString()}`
    : price >= 1
      ? `$${price.toFixed(2)}`
      : `$${price.toFixed(4)}`;
}

function cleanSentence(text: string): string {
  if (!text) return "";
  const firstSentence = text.replace(/[\r\n]+/g, " ").trim().split(/[.!?]/)[0] ?? "";
  return firstSentence.replace(/^["'\s]+|["'\s]+$/g, "").trim();
}

export type ResearchStrategyType = {
  kind: "ema_cross" | "rsi_reversion";
  title: string;
  triggerDescription: string;
  rationale: string;
};

export function getStrategyTypeFromResearch(report: ResearchReportLike): ResearchStrategyType {
  const { indicators, summary, bullCase, bearCase, invalidation } = report;
  const combinedText = `${summary} ${bullCase} ${bearCase} ${invalidation}`.toLowerCase();
  const rsi = indicators.rsi14 ?? 50;

  const isOversold = rsi <= 40 || combinedText.includes("oversold") || combinedText.includes("mean reversion") || combinedText.includes("bounce from support");
  const isOverbought = rsi >= 68 || combinedText.includes("overbought") || combinedText.includes("exhaustion");
  const isBullishRegime = indicators.regime === "Bullish structure" || (indicators.ema20 !== null && indicators.ema50 !== null && indicators.ema20 > indicators.ema50);

  if (isOversold) {
    const entry = Math.max(20, Math.min(38, Math.round(rsi) <= 35 ? Math.round(rsi) : 32));
    const exit = 62;
    return {
      kind: "rsi_reversion",
      title: "Oversold Mean Reversion",
      triggerDescription: `Buy RSI 14 < ${entry} at support; exit RSI > ${exit}`,
      rationale: `Capitalize on oversold dip at support (${formatPriceNumber(indicators.support)}) identified in research.`,
    };
  }

  if (isBullishRegime && !isOverbought) {
    return {
      kind: "ema_cross",
      title: "Bullish Trend Continuation",
      triggerDescription: "Buy EMA 20 cross above EMA 50; exit cross below",
      rationale: `Trade in the direction of the confirmed bullish regime above EMA 50 (${formatPriceNumber(indicators.ema50 ?? 0)}).`,
    };
  }

  if (indicators.rangePct >= 2.5 && report.interval === "15m") {
    return {
      kind: "ema_cross",
      title: "High-Volatility Momentum Breakout",
      triggerDescription: "Buy EMA 12 cross above EMA 26; exit cross below",
      rationale: `Test momentum breakout rules during high average volatility (${indicators.rangePct.toFixed(1)}% bar range).`,
    };
  }

  // Balanced Mean Reversion / Range-Bound
  const entryRsi = Math.max(25, Math.min(38, rsi < 50 ? 30 : 35));
  const exitRsi = 60;
  return {
    kind: "rsi_reversion",
    title: "Range-Bound Support Bounce",
    triggerDescription: `Buy RSI 14 < ${entryRsi}; exit RSI > ${exitRsi}`,
    rationale: `Test support accumulation near ${formatPriceNumber(indicators.support)} within ${indicators.regime.toLowerCase()}.`,
  };
}

/**
 * Feeds a custom, contextual quantitative strategy prompt directly derived from the Research Brief.
 * The prompt explicitly defines entry and exit rules that the LLM/deterministic compiler can execute.
 */
export function generateBacktestPromptFromResearch(report: ResearchReportLike): string {
  const { symbol, interval, indicators, summary, bullCase } = report;
  const strategy = getStrategyTypeFromResearch(report);
  const supportStr = formatPriceNumber(indicators.support);
  const resistanceStr = formatPriceNumber(indicators.resistance);

  // Extract a salient thesis point from the bull case or summary
  const thesisSnippet = cleanSentence(bullCase) || cleanSentence(summary) || `Grounded in ${indicators.regime.toLowerCase()} on ${interval}`;

  if (strategy.kind === "ema_cross") {
    if (strategy.title.includes("High-Volatility")) {
      return `Research thesis for ${symbol} (${interval}) - "${thesisSnippet}": Test momentum breakout in high volatility (${indicators.rangePct.toFixed(1)}% bar range). Rule: Go long when 12-period EMA crosses above 26-period EMA; exit when 12-period EMA crosses below 26-period EMA.`;
    }
    return `Research thesis for ${symbol} (${interval}) - "${thesisSnippet}": Trade ${indicators.regime.toLowerCase()} with price supported above ${supportStr}. Rule: Go long when 20-period EMA crosses above 50-period EMA; exit when 20 EMA crosses below 50 EMA on trend invalidation.`;
  }

  // RSI Reversion
  const rsi = indicators.rsi14 ?? 50;
  const entryBelow = Math.max(20, Math.min(38, rsi <= 38 ? Math.round(rsi) : 32));
  const exitAbove = 60;

  return `Research thesis for ${symbol} (${interval}) - "${thesisSnippet}": Accumulate at support (${supportStr}) within ${indicators.regime.toLowerCase()}. Rule: Enter long when 14-period RSI drops below ${entryBelow}; exit when 14-period RSI exceeds ${exitAbove} near resistance (${resistanceStr}).`;
}
