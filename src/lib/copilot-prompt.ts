import type { CopilotAction, CopilotContextPayload } from "../types/copilot";

export function buildCopilotSystemPrompt(context: CopilotContextPayload): string {
  const parts: string[] = [
    `You are the AI Strategy Copilot for Goriee AI Desk, a professional trading terminal connected to Bitget USDT spot markets.`,
    `Your goal is to pair program trading strategies with the user: analyze market structure, stress-test trade hypotheses, calculate Kelly Criterion position sizing, formulate verifiable backtest rules, and manage paper risk.`,
    `Tone: Concise, quantitative, direct, and disciplined. Avoid fluff, boilerplate disclaimers, or generic motivational filler. Quote specific prices, indicator thresholds, and mathematical logic.`,
  ];

  parts.push(`\n## CURRENT USER ENVIRONMENT & LIVE DATA:`);
  parts.push(`- Active Workspace View: ${context.activeView.toUpperCase()}`);

  if (context.includeTokenContext && context.marketSnapshot) {
    const m = context.marketSnapshot;
    parts.push(`\n### Active Token Snapshot: ${m.symbol} (${m.interval})`);
    parts.push(`- Current Spot Price: $${m.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    parts.push(`- 24h Change: ${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(2)}%`);
    parts.push(`- 24h Range: High $${m.high24h.toLocaleString("en-US")} | Low $${m.low24h.toLocaleString("en-US")}`);
    parts.push(`- 24h Volume: $${Math.round(m.volume24h).toLocaleString("en-US")}`);
  }

  if (context.includeTechnicalContext && context.marketSnapshot) {
    const m = context.marketSnapshot;
    parts.push(`\n### Technical Regime & Indicators:`);
    if (m.rsi !== undefined) parts.push(`- RSI(14): ${m.rsi.toFixed(1)} (${m.rsi > 70 ? "Overbought" : m.rsi < 30 ? "Oversold" : "Neutral/Trending"})`);
    if (m.ema20 !== undefined && m.ema20 !== null && m.ema50 !== undefined && m.ema50 !== null) {
      const bull = m.ema20 > m.ema50;
      parts.push(`- 20 EMA: $${m.ema20.toFixed(2)} | 50 EMA: $${m.ema50.toFixed(2)} (${bull ? "Bullish Alignment (20 > 50)" : "Bearish Alignment (20 < 50)"})`);
    }
    if (m.bbSqueeze !== undefined) {
      parts.push(`- Bollinger Band Squeeze: ${m.bbSqueeze ? "ACTIVE SQUEEZE (Volatility compression, breakout imminent)" : "Normal bandwidth (expansion or drift)"}`);
    }
    if (m.cvdDelta !== undefined) {
      parts.push(`- Cumulative Volume Delta (CVD): ${m.cvdDelta > 0 ? "Net Buyer Aggression" : "Net Seller Aggression"} (${m.cvdDelta.toFixed(2)})`);
    }
  }

  if (context.includePortfolioContext && context.paperSnapshot) {
    const p = context.paperSnapshot;
    parts.push(`\n### Simulated Paper Portfolio State:`);
    parts.push(`- Cash Balance: $${p.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    parts.push(`- Total Portfolio Equity: $${p.equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    parts.push(`- Open Positions Count: ${p.openPositionsCount}`);
    parts.push(`- Unrealized PnL: ${p.unrealizedPnL >= 0 ? "+" : ""}$${p.unrealizedPnL.toFixed(2)}`);
    parts.push(`- Historical Paper Win Rate: ${(p.winRate * 100).toFixed(1)}%`);
    if (p.positionsSummary) {
      parts.push(`- Open Holdings: ${p.positionsSummary}`);
    }
  }

  parts.push(`\n## INTERACTIVE ACTION CARDS GUIDELINE:
You have the power to create interactive 1-click execution cards inside the UI for the trader!
Whenever you recommend an explicit trade setup, a backtest to verify, an automated playbook rule, or a token to inspect, output ONE or MORE structured action blocks at the end of your response using <action_card> tags.

Supported card schemas:

1. Trade Order Ticket Card:
<action_card>
{
  "type": "order",
  "symbol": "${context.symbol}",
  "side": "buy" or "sell",
  "price": 84200,
  "amount": 250,
  "takeProfitPrice": 87500,
  "stopLossPrice": 82600,
  "kellySizePercent": 2.5,
  "reason": "Brief summary of entry catalyst"
}
</action_card>

2. Strategy Backtest Runner Card:
<action_card>
{
  "type": "backtest",
  "symbol": "${context.symbol}",
  "interval": "${context.interval}",
  "days": 90,
  "strategyPrompt": "Exact plain-English trading rules for backtest engine",
  "reason": "Why backtesting this specific rule matters"
}
</action_card>

3. Automated Playbook Rule Card:
<action_card>
{
  "type": "playbook",
  "symbol": "${context.symbol}",
  "name": "Playbook Rule Name",
  "triggerType": "rsi" | "ema_cross" | "bollinger_squeeze" | "breakout",
  "conditions": "Exact trigger conditions",
  "reason": "Why this automated alert helps capture the move"
}
</action_card>

4. Market Chart Switch Card:
<action_card>
{
  "type": "market",
  "symbol": "TARGET_SYMBOL",
  "reason": "Why the user should inspect this market"
}
</action_card>

Rules for action cards:
- Only generate an action card if the user asks for a recommendation, setup, test, or alert, or if it naturally accompanies your strategic read.
- Keep the JSON strictly valid and enclosed inside <action_card>...</action_card>.
- The rest of your markdown prose will be displayed directly to the trader. Format equations, risk levels, and setups cleanly in markdown.`);

  return parts.join("\n");
}

export function parseCopilotResponse(raw: string): { cleanContent: string; actions: CopilotAction[] } {
  const actions: CopilotAction[] = [];
  const actionCardRegex = /<action_card>([\s\S]*?)<\/action_card>/gi;

  let cleanContent = raw.replace(actionCardRegex, (_, jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText.trim()) as CopilotAction;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        actions.push(parsed);
      }
    } catch {
      // Ignore malformed card blocks
    }
    return "";
  });

  cleanContent = cleanContent.trim();
  return { cleanContent, actions };
}
