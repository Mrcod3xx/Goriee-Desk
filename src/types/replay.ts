export interface ReplayPosition {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entryPrice: number;
  entryTime: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

export interface ReplayTrade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  entryTime: number;
  exitTime: number;
  exitReason: "take_profit" | "stop_loss" | "manual";
}

export interface ReplayWallet {
  startingCash: number;
  cash: number;
  position: ReplayPosition | null;
  realizedPnl: number;
  closedTrades: ReplayTrade[];
}

export interface ReplayScorecard {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netPnl: number;
  returnPct: number;
  bestTradePnl: number;
  worstTradePnl: number;
  startingCapital: number;
  endingEquity: number;
}

export interface ReplaySessionState {
  isActive: boolean;
  isCutMode: boolean;
  cutIndex: number;
  currentIndex: number;
  isPlaying: boolean;
  speed: number; // 0.5, 1, 2, 5
  wallet: ReplayWallet;
}
