"use client";

import { generateBacktestPromptFromResearch, getStrategyTypeFromResearch } from "@/lib/research-strategy";
import type { Report, ResearchSource } from "@/components/desk-types";
import { formatPrice, formatMoney, formatDate } from "@/components/desk-shared";
import { Icon } from "@/components/desk-icon";
import { Stat } from "@/components/desk-charts";

export function ReportPanel({ report, onPaper, onBacktest, onExportSnapshot }: { report: Report; onPaper: () => void; onBacktest: (report: Report) => void; onExportSnapshot?: () => void }) {
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

export function CitationList({ sources }: { sources: ResearchSource[] }) {
  const safeSources = sources.filter((source) => /^https?:\/\//i.test(source.url));
  if (!safeSources.length) return <p className="citation-empty">No source links were returned by the web search.</p>;
  return <ul className="citation-list">{safeSources.map((source, index) => <li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}<span aria-hidden="true"> ↗</span></a>{source.content ? <p>{source.content}</p> : null}</li>)}</ul>;
}

export function ModelReadiness({ configured, model }: { configured: boolean | null; model: string }) {
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

export function ResearchLoadingStatus({
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

export function ResearchLoadingSkeleton({
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

export function BacktestLoadingStatus({
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
