// Relative import with an explicit `.ts` extension so Node's type stripping can
// resolve it under `node --test` — the `@/` alias cannot be (see user memory).
import { bitgetRequest, type BitgetEnvelope } from "./bitget-http.ts";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
};

export type MarketData = {
  symbol: string;
  category: "SPOT";
  interval: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  turnover24h: number;
  asOf: number;
  candles: Candle[];
};

export type SpotScanMarket = {
  symbol: string;
  baseCoin: string;
  isRwa: boolean;
  price: number;
  change24h: number;
  turnover24h: number;
};

const candleIntervalMs: Record<string, number> = {
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

/**
 * Single entry point for public Bitget REST calls.
 *
 * All retry, backoff, `Retry-After` handling and envelope validation lives in
 * `bitget-http.ts` so that every caller — including `orderbook.ts`, which used
 * to keep its own bare `fetch` — gets the same behaviour. Failures arrive here
 * already typed as `BitgetRateLimitError` or `BitgetHttpError`.
 */
async function bitgetGet<T>(path: string): Promise<BitgetEnvelope<T>> {
  return bitgetRequest<T>(path);
}

export async function getSpotMarket(
  symbol: string,
  interval = "1H",
  limit = 180,
): Promise<MarketData> {
  const safeSymbol = symbol.toUpperCase();
  const query = new URLSearchParams({ category: "SPOT", symbol: safeSymbol });
  const candleQuery = new URLSearchParams({
    category: "SPOT",
    symbol: safeSymbol,
    interval,
    limit: String(Math.min(Math.max(limit, 60), 1000)),
  });

  const [tickerResponse, candleResponse] = await Promise.all([
    bitgetGet<Array<Record<string, unknown>>>(`/api/v3/market/tickers?${query}`),
    bitgetGet<Array<unknown[]>>(`/api/v3/market/candles?${candleQuery}`),
  ]);

  const ticker = (tickerResponse.data ?? []).find(
    (row) => String(row.symbol).toUpperCase() === safeSymbol,
  );
  if (!ticker) throw new Error(`${safeSymbol} is not available on Bitget spot.`);

  const candles = (candleResponse.data ?? [])
    .map((row) => ({
      time: number(row[0]),
      open: number(row[1]),
      high: number(row[2]),
      low: number(row[3]),
      close: number(row[4]),
      volume: number(row[5]),
      turnover: number(row[6]),
    }))
    .filter((row) => row.time > 0 && row.close > 0)
    .sort((a, b) => a.time - b.time);

  if (candles.length < 55) {
    throw new Error(`Bitget returned too little ${safeSymbol} history for analysis.`);
  }

  return {
    symbol: safeSymbol,
    category: "SPOT",
    interval,
    price: number(ticker.lastPrice),
    change24h: number(ticker.price24hPcnt) * 100,
    high24h: number(ticker.highPrice24h),
    low24h: number(ticker.lowPrice24h),
    volume24h: number(ticker.volume24h),
    turnover24h: number(ticker.turnover24h),
    asOf: number(ticker.ts) || number(tickerResponse.requestTime) || Date.now(),
    candles,
  };
}

export async function getSpotScanMarkets(): Promise<SpotScanMarket[]> {
  const [instrumentResponse, tickerResponse] = await Promise.all([
    bitgetGet<Array<Record<string, unknown>>>("/api/v3/market/instruments?category=SPOT"),
    bitgetGet<Array<Record<string, unknown>>>("/api/v3/market/tickers?category=SPOT"),
  ]);
  const tickers = new Map(
    (tickerResponse.data ?? []).map((ticker) => [String(ticker.symbol ?? "").toUpperCase(), ticker]),
  );

  const instruments = instrumentResponse.data ?? [];
  const onlineUsdt = instruments.filter((instrument) =>
    String(instrument.status ?? "").toLowerCase() === "online" &&
    String(instrument.quoteCoin ?? "").toUpperCase() === "USDT",
  );
  const markets = onlineUsdt.flatMap((instrument): SpotScanMarket[] => {
    const symbol = String(instrument.symbol ?? "").toUpperCase();
    const baseCoin = String(instrument.baseCoin ?? "");
    const ticker = tickers.get(symbol);
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !baseCoin || !ticker) return [];
    const price = number(ticker.lastPrice);
    if (!(price > 0)) return [];
    return [{
      symbol,
      baseCoin,
      isRwa:
        String(instrument.isRwa ?? "").toUpperCase() === "YES" ||
        String(instrument.symbolType ?? "").toLowerCase() === "stock",
      price,
      change24h: number(ticker.price24hPcnt) * 100,
      turnover24h: number(ticker.turnover24h),
    }];
  });
  if (markets.length === 0) {
    throw new Error("Bitget returned no online USDT spot markets with current ticker data.");
  }
  return markets;
}

export async function getHistoricalSpotCandles(
  symbol: string,
  interval: string,
  startAt: number,
  endAt: number,
): Promise<Candle[]> {
  const intervalMs = candleIntervalMs[interval];
  if (!intervalMs || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    throw new Error("Choose a valid historical window and candle interval.");
  }

  const barsPerPage = Math.min(100, Math.floor((90 * 24 * 60 * 60_000) / intervalMs));
  const pageSpan = barsPerPage * intervalMs;
  const pages: Array<{ start: number; end: number }> = [];
  for (let start = startAt; start < endAt; start += pageSpan) {
    pages.push({ start, end: Math.min(endAt, start + pageSpan) });
  }

  const safeSymbol = symbol.toUpperCase();
  const candles: Candle[] = [];
  for (let index = 0; index < pages.length; index += 3) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const pageResults = await Promise.all(pages.slice(index, index + 3).map(async (page) => {
      const query = new URLSearchParams({
        category: "SPOT",
        symbol: safeSymbol,
        interval,
        startTime: String(Math.max(0, page.start - 1)),
        endTime: String(Math.max(0, page.end - 1)),
        limit: String(barsPerPage),
      });
      const response = await bitgetGet<Array<unknown[]>>(`/api/v3/market/history-candles?${query}`);
      return (response.data ?? []).map((row) => ({
        time: number(row[0]),
        open: number(row[1]),
        high: number(row[2]),
        low: number(row[3]),
        close: number(row[4]),
        volume: number(row[5]),
        turnover: number(row[6]),
      })).filter((candle) => candle.time >= startAt && candle.time < endAt && candle.close > 0);
    }));
    pageResults.forEach((result) => candles.push(...result));
  }

  const unique = new Map<number, Candle>();
  candles.forEach((candle) => unique.set(candle.time, candle));
  return [...unique.values()].sort((left, right) => left.time - right.time);
}

export async function getSpotSpreadBps(symbol: string): Promise<number> {
  const query = new URLSearchParams({ category: "SPOT", symbol: symbol.toUpperCase(), limit: "5" });
  const response = await bitgetGet<{ a?: unknown[][]; b?: unknown[][] }>(`/api/v3/market/orderbook?${query}`);
  const ask = number(response.data?.a?.[0]?.[0]);
  const bid = number(response.data?.b?.[0]?.[0]);
  const midpoint = (ask + bid) / 2;
  if (!(ask > bid && midpoint > 0)) throw new Error("Bitget returned an invalid top-of-book spread.");
  return ((ask - bid) / midpoint) * 10_000;
}

export function ema(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;

  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = current;

  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
    result[index] = current;
  }
  return result;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gain = 0;
  let loss = 0;
  const start = values.length - period;

  for (let index = start; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }

  const averageGain = gain / period;
  const averageLoss = loss / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function getIndicatorSnapshot(market: MarketData) {
  const closes = market.candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20).at(-1) ?? null;
  const ema50 = ema(closes, 50).at(-1) ?? null;
  const recent = market.candles.slice(-24);
  const support = Math.min(...recent.map((candle) => candle.low));
  const resistance = Math.max(...recent.map((candle) => candle.high));
  const rangePct =
    (market.candles.slice(-14).reduce((sum, candle) => sum + candle.high - candle.low, 0) /
      14 /
      market.price) *
    100;
  const regime =
    ema20 !== null && ema50 !== null && market.price > ema20 && ema20 > ema50
      ? "Bullish structure"
      : ema20 !== null && ema50 !== null && market.price < ema20 && ema20 < ema50
        ? "Bearish structure"
        : "Mixed structure";

  return { ema20, ema50, rsi14: rsi(closes), support, resistance, rangePct, regime };
}

export type BollingerBandsPoint = {
  upper: number | null;
  middle: number | null;
  lower: number | null;
};

export function bollingerBands(
  values: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsPoint[] {
  const result: BollingerBandsPoint[] = Array(values.length).fill({ upper: null, middle: null, lower: null });
  if (values.length < period) return result;

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    result[i] = {
      upper: mean + stdDevMultiplier * stdDev,
      middle: mean,
      lower: mean - stdDevMultiplier * stdDev,
    };
  }
  return result;
}

export type MacdPoint = {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdPoint[] {
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);
  const macdLine: Array<number | null> = values.map((_, i) => {
    if (fastEma[i] === null || slowEma[i] === null) return null;
    return fastEma[i]! - slowEma[i]!;
  });

  const validMacdValues: number[] = [];
  const validIndices: number[] = [];
  macdLine.forEach((val, idx) => {
    if (val !== null) {
      validMacdValues.push(val);
      validIndices.push(idx);
    }
  });

  const signalEma = ema(validMacdValues, signalPeriod);
  const result: MacdPoint[] = Array(values.length).fill({ macd: null, signal: null, histogram: null });

  validIndices.forEach((origIdx, validIdx) => {
    const m = validMacdValues[validIdx];
    const s = signalEma[validIdx];
    const h = s !== null ? m - s : null;
    result[origIdx] = { macd: m, signal: s, histogram: h };
  });

  return result;
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const hl = current.high - current.low;
    const hc = Math.abs(current.high - prev.close);
    const lc = Math.abs(current.low - prev.close);
    trs.push(Math.max(hl, hc, lc));
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

export type RuleEvaluation = {
  action: "buy" | "sell" | "hold";
  reason: string;
  metricSummary: string;
};

export function evaluatePlaybookRule(
  prompt: string,
  candles: Candle[]
): RuleEvaluation {
  if (candles.length < 35) {
    return {
      action: "hold",
      reason: "Insufficient candle history for analysis",
      metricSummary: "Candles < 35",
    };
  }

  const closes = candles.map((c) => c.close);
  const lower = prompt.toLowerCase();

  // 1. Check RSI mean-reversion
  if (lower.includes("rsi")) {
    const periodMatch = lower.match(/rsi\s*\(?(\d+)\)?/);
    const period = periodMatch ? Number(periodMatch[1]) : 14;
    const currentRsi = rsi(closes, period);
    const prevRsi = rsi(closes.slice(0, -1), period);

    const buyMatch = lower.match(/(?:below|under|<|drops below)\s*(\d+)/);
    const buyThreshold = buyMatch ? Number(buyMatch[1]) : 30;

    const sellMatch = lower.match(/(?:above|over|>|rises above)\s*(\d+)/);
    const sellThreshold = sellMatch ? Number(sellMatch[1]) : 65;

    const metric = `RSI (${period}) = ${currentRsi.toFixed(1)}`;

    if (currentRsi <= buyThreshold || (prevRsi <= buyThreshold && currentRsi > prevRsi)) {
      return {
        action: "buy",
        reason: `RSI (${period}) is ${currentRsi.toFixed(1)}, meeting buy trigger (<= ${buyThreshold})`,
        metricSummary: metric,
      };
    }
    if (currentRsi >= sellThreshold) {
      return {
        action: "sell",
        reason: `RSI (${period}) is ${currentRsi.toFixed(1)}, meeting exit trigger (>= ${sellThreshold})`,
        metricSummary: metric,
      };
    }
    return {
      action: "hold",
      reason: `RSI (${period}) is ${currentRsi.toFixed(1)}, between entry (${buyThreshold}) and exit (${sellThreshold})`,
      metricSummary: metric,
    };
  }

  // 2. Check EMA crossover
  let fast = 20;
  let slow = 50;
  const emaNumbers = prompt.match(/\b(\d{1,3})\s*(?:-period)?\s*EMA/gi);
  if (emaNumbers && emaNumbers.length >= 2) {
    const n1 = parseInt(emaNumbers[0], 10);
    const n2 = parseInt(emaNumbers[1], 10);
    fast = Math.min(n1, n2);
    slow = Math.max(n1, n2);
  } else if (lower.includes("10") && lower.includes("30")) {
    fast = 10;
    slow = 30;
  }

  const fastSeries = ema(closes, fast);
  const slowSeries = ema(closes, slow);
  const currFast = fastSeries.at(-1);
  const currSlow = slowSeries.at(-1);
  const prevFast = fastSeries.at(-2);
  const prevSlow = slowSeries.at(-2);

  if (
    typeof currFast === "number" &&
    typeof currSlow === "number" &&
    typeof prevFast === "number" &&
    typeof prevSlow === "number"
  ) {
    const metric = `${fast} EMA = ${currFast.toFixed(1)}, ${slow} EMA = ${currSlow.toFixed(1)}`;
    // Bullish crossover
    if (currFast > currSlow && prevFast <= prevSlow) {
      return {
        action: "buy",
        reason: `Bullish crossover: ${fast} EMA crossed above ${slow} EMA`,
        metricSummary: metric,
      };
    }
    // Bearish crossover
    if (currFast < currSlow && prevFast >= prevSlow) {
      return {
        action: "sell",
        reason: `Bearish crossover: ${fast} EMA crossed below ${slow} EMA`,
        metricSummary: metric,
      };
    }
    // Continuation states
    if (currFast > currSlow) {
      return {
        action: "hold",
        reason: `Bullish trend intact (${fast} EMA > ${slow} EMA). Awaiting exit crossover.`,
        metricSummary: metric,
      };
    }
    return {
      action: "hold",
      reason: `Bearish regime (${fast} EMA < ${slow} EMA). Awaiting buy crossover.`,
      metricSummary: metric,
    };
  }

  return {
    action: "hold",
    reason: "Indicators within neutral range",
    metricSummary: `Price = $${closes.at(-1)?.toFixed(2)}`,
  };
}

