export type CopilotActionType = "order" | "backtest" | "playbook" | "market";

export type OrderActionPayload = {
  type: "order";
  symbol: string;
  side: "buy" | "sell";
  price?: number;
  amount?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  kellySizePercent?: number;
  reason: string;
};

export type BacktestActionPayload = {
  type: "backtest";
  symbol: string;
  interval: string;
  days: number;
  strategyPrompt: string;
  reason: string;
};

export type PlaybookActionPayload = {
  type: "playbook";
  symbol: string;
  name: string;
  triggerType: "rsi" | "ema_cross" | "bollinger_squeeze" | "breakout";
  conditions: string;
  reason: string;
};

export type MarketActionPayload = {
  type: "market";
  symbol: string;
  reason: string;
};

export type CopilotAction =
  | OrderActionPayload
  | BacktestActionPayload
  | PlaybookActionPayload
  | MarketActionPayload;

export type CopilotMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  actions?: CopilotAction[];
  contextSnapshot?: {
    symbol: string;
    interval: string;
    price?: number;
    activeView: string;
  };
};

export type CopilotSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  symbol: string;
  messages: CopilotMessage[];
};

export type MarketContextSnapshot = {
  symbol: string;
  interval: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  rsi?: number;
  ema20?: number | null;
  ema50?: number | null;
  regime?: string;
  support?: number;
  resistance?: number;
  bbSqueeze?: boolean;
  squeezeActive?: boolean;
  squeezeBias?: string;
  cvdDelta?: number;
};

export type PaperContextSnapshot = {
  balance: number;
  equity: number;
  openPositionsCount: number;
  unrealizedPnL: number;
  winRate: number;
  positionsSummary?: string;
  positions?: Array<{
    symbol: string;
    side: "long" | "short";
    size: number;
    entryPrice: number;
    unrealizedPnl?: number;
    pnlPct?: number;
  }>;
};

export type CopilotContextPayload = {
  symbol: string;
  interval: string;
  activeView: string;
  includeTokenContext: boolean;
  includeTechnicalContext: boolean;
  includePortfolioContext: boolean;
  marketSnapshot?: MarketContextSnapshot;
  paperSnapshot?: PaperContextSnapshot;
};
