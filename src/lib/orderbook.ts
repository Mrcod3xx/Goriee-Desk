export type OrderBookLevel = {
  price: number;
  size: number;
  total: number;
  depthPct: number;
};

export type OrderBookData = {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  midpoint: number;
  imbalancePct: number; // -100 to +100
  totalBidVol: number;
  totalAskVol: number;
  asOf: number;
};

type RawBitgetDepthResponse = {
  code?: string;
  msg?: string;
  requestTime?: number;
  data?: {
    a?: Array<[string | number, string | number]>;
    b?: Array<[string | number, string | number]>;
    ts?: string | number;
  };
};

export function parseOrderBook(
  symbol: string,
  rawBids: Array<[string | number, string | number]> = [],
  rawAsks: Array<[string | number, string | number]> = [],
  timestamp?: number
): OrderBookData {
  const safeSymbol = symbol.toUpperCase();

  // Bids sorted descending by price (highest bid first)
  const bidsParsed = rawBids
    .map(([p, s]) => ({ price: Number(p), size: Number(s) }))
    .filter((b) => Number.isFinite(b.price) && b.price > 0 && Number.isFinite(b.size) && b.size > 0)
    .sort((a, b) => b.price - a.price);

  // Asks sorted ascending by price (lowest ask first)
  const asksParsed = rawAsks
    .map(([p, s]) => ({ price: Number(p), size: Number(s) }))
    .filter((a) => Number.isFinite(a.price) && a.price > 0 && Number.isFinite(a.size) && a.size > 0)
    .sort((a, b) => a.price - b.price);

  let cumBid = 0;
  const bidsWithTotal = bidsParsed.map((b) => {
    cumBid += b.size;
    return { ...b, total: cumBid };
  });

  let cumAsk = 0;
  const asksWithTotal = asksParsed.map((a) => {
    cumAsk += a.size;
    return { ...a, total: cumAsk };
  });

  const totalBidVol = cumBid;
  const totalAskVol = cumAsk;
  const maxTotal = Math.max(totalBidVol, totalAskVol, 0.000001);

  const bids: OrderBookLevel[] = bidsWithTotal.map((b) => ({
    ...b,
    depthPct: Math.min(100, Math.round((b.total / maxTotal) * 100)),
  }));

  const asks: OrderBookLevel[] = asksWithTotal.map((a) => ({
    ...a,
    depthPct: Math.min(100, Math.round((a.total / maxTotal) * 100)),
  }));

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? Math.max(0, bestAsk - bestBid) : 0;
  const midpoint = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestBid || bestAsk;
  const spreadBps = midpoint > 0 ? (spread / midpoint) * 10000 : 0;

  // Order Book Imbalance: (Bids - Asks) / (Bids + Asks) * 100%
  const totalBookVol = totalBidVol + totalAskVol;
  const imbalancePct = totalBookVol > 0 ? ((totalBidVol - totalAskVol) / totalBookVol) * 100 : 0;

  return {
    symbol: safeSymbol,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    midpoint,
    imbalancePct,
    totalBidVol,
    totalAskVol,
    asOf: timestamp ?? Date.now(),
  };
}

export async function getSpotOrderBook(symbol: string, limit = 15): Promise<OrderBookData> {
  const safeSymbol = symbol.toUpperCase();
  const safeLimit = Math.min(Math.max(limit, 5), 50);
  const query = new URLSearchParams({
    category: "SPOT",
    symbol: safeSymbol,
    limit: String(safeLimit),
  });

  const response = await fetch(`https://api.bitget.com/api/v3/market/orderbook?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    throw new Error(`Bitget order book API returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RawBitgetDepthResponse;
  if (payload.code && payload.code !== "00000") {
    throw new Error(payload.msg || `Bitget could not return order book for ${safeSymbol}`);
  }

  const rawAsks = payload.data?.a ?? [];
  const rawBids = payload.data?.b ?? [];
  const ts = Number(payload.data?.ts) || payload.requestTime || Date.now();

  return parseOrderBook(safeSymbol, rawBids, rawAsks, ts);
}
