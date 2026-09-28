"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ema, bollingerBands, macd } from "@/lib/bitget";
import type { Candle } from "@/lib/bitget";
import { calculateOrderFlow } from "@/lib/order-flow";
import { detectVolatilitySqueeze } from "@/lib/kelly-sizer";
import { calculateReviewUnrealizedPct, calculateReviewUnrealizedPnl } from "@/lib/replay-review";
import type { ReplayReviewPhase, ReplayTradeReview } from "@/lib/replay-review";
import type { ReplayBracketConfig, ReplayTradeMarker } from "@/components/desk-types";
import { formatPrice, formatCompact, formatDate } from "@/components/desk-shared";

export function PriceChart({
  candles,
  label,
  height = 250,
  indicators,
  isCutMode = false,
  onCutCandle,
  replayBrackets,
  replayTrades,
  activePosition,
  targetTradeReview,
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
  /**
   * The historical trade under review plus the replay playhead state. Geometry
   * is derived inside the chart, but *what* may be drawn is decided by `phase`,
   * so the trade reveals itself bar by bar instead of spoiling the ending with
   * full-width lines drawn from the very first frame.
   */
  targetTradeReview?: {
    review: ReplayTradeReview;
    phase: ReplayReviewPhase;
    /** Close of the current playhead bar; drives the open-position pin. */
    markPrice: number | null;
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
    if (!candles || candles.length < 1) return null;

    const clampedVisible = Math.max(1, Math.min(visibleBars, candles.length));
    const maxPan = Math.max(0, candles.length - clampedVisible);
    const clampedPan = Math.max(0, Math.min(panOffset, maxPan));

    const endIdx = candles.length - clampedPan;
    const startIdx = Math.max(0, endIdx - clampedVisible);
    const rows = candles.slice(startIdx, endIdx);

    if (rows.length < 1) return null;

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

    const barWidth = plotWidth / Math.max(1, rows.length);
    const bodyWidth = Math.max(2.5, Math.min(14, barWidth * 0.7));

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
      positive: (rows.at(-1)?.close ?? 0) >= (rows[0]?.open ?? 0),
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

  // ── Reviewed historical trade: progressive reveal geometry ───────────────
  // `phase` comes from the desk, which compares the playhead clock against the
  // trade's own entry/exit timestamps. That is what keeps the replay honest:
  // before the tape reaches the entry bar nothing at all is drawn, while the
  // position is open only the entry and its bracket are drawn, and the exit
  // price/outcome appear on the bar the trade actually closed.
  //
  // Plain consts (not hooks) because they sit after the `!chartData` early
  // return, and every hook in this component is declared above it.
  const targetReview = (() => {
    if (!targetTradeReview) return null;
    const { review, phase, markPrice } = targetTradeReview;
    const rows = chartData.rows;
    const firstRowTime = rows[0]?.time ?? null;

    const yFor = (price: number | null): number | null => {
      if (price === null || !(price > 0)) return null;
      const raw = chartData.padTop + ((chartData.maxHigh - price) / chartData.spread) * chartData.usableHeight;
      return Math.max(chartData.padTop + 6, Math.min(height - chartData.padBottom - 6, raw));
    };

    const indexOfTime = (time: number | null): number | null => {
      if (time === null) return null;
      const found = rows.findIndex((candle) => candle.time === time);
      return found === -1 ? null : found;
    };

    const entryRevealed = phase !== "pre-entry";
    const exitRevealed = phase === "closed";
    const entryIdx = indexOfTime(review.entryTime);
    const exitIdx = indexOfTime(review.exitTime);

    // Panning can scroll the entry bar out of the viewport. The levels then run
    // in from the left edge rather than vanishing, so context is preserved.
    const xForRevealedTime = (time: number | null, idx: number | null, revealed: boolean): number | null => {
      if (!revealed) return null;
      if (idx !== null) return (idx + 0.5) * chartData.barWidth;
      if (time !== null && firstRowTime !== null && time < firstRowTime) return 0;
      return null;
    };

    const entryX = xForRevealedTime(review.entryTime, entryIdx, entryRevealed);
    const exitX = xForRevealedTime(review.exitTime, exitIdx, exitRevealed);
    const entryY = entryRevealed ? yFor(review.entryPrice) : null;
    const exitY = exitRevealed ? yFor(review.exitPrice) : null;
    const takeProfitY = entryRevealed ? yFor(review.takeProfitPrice) : null;
    const stopLossY = entryRevealed ? yFor(review.stopLossPrice) : null;

    // The price path the trade actually took, drawn only as far as allowed.
    let pathEndIdx = rows.length - 1;
    if (exitRevealed && exitIdx !== null) pathEndIdx = Math.min(pathEndIdx, exitIdx);
    const pathStartIdx = entryIdx ?? 0;
    let trajectory = "";
    if (entryRevealed && pathEndIdx >= pathStartIdx && pathStartIdx < rows.length) {
      const segments: string[] = [];
      if (entryX !== null && entryY !== null && entryIdx === null) {
        segments.push(`M${entryX.toFixed(2)},${entryY.toFixed(2)}`);
      }
      for (let i = Math.max(0, pathStartIdx); i <= pathEndIdx; i += 1) {
        const row = rows[i];
        if (!row) continue;
        const x = (i + 0.5) * chartData.barWidth;
        const y = yFor(row.close);
        if (y === null) continue;
        segments.push(`${segments.length === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
      }
      trajectory = segments.join(" ");
    }

    // Which level the trade finally met, so it can be emphasised on close.
    const hitLevel: "tp" | "sl" | "exit" | null = !exitRevealed
      ? null
      : review.outcome === "take_profit"
        ? (review.takeProfitPrice !== null ? "tp" : "exit")
        : review.outcome === "stop_loss" || review.outcome === "trailing_stop"
          ? (review.stopLossPrice !== null ? "sl" : "exit")
          : "exit";

    return {
      review,
      phase,
      entryRevealed,
      exitRevealed,
      entryIdx,
      exitIdx,
      entryX,
      exitX,
      entryY,
      exitY,
      takeProfitY,
      stopLossY,
      hitLevel,
      trajectory,
      lineStartX: entryX ?? 0,
      lineEndX: chartData.width,
      corridorEndX: chartData.plotWidth,
      markY: yFor(markPrice),
      liveX: (rows.length - 0.5) * chartData.barWidth,
      // Floating result at the playhead. Only meaningful while the position is
      // open, and only when the viewport is snapped to the playhead bar.
      markPct: calculateReviewUnrealizedPct(review, markPrice),
      markPnl: calculateReviewUnrealizedPnl(review, markPrice),
      showLive: panOffset === 0 && phase === "in-trade",
    };
  })();

  // Right-rail price tags for the reviewed trade. Levels crowd each other on a
  // tight bracket, so stack them greedily with a minimum gap instead of letting
  // two pills overlap into unreadable text.
  const reviewRailTags = (() => {
    if (!targetReview) return [] as { key: string; kicker: string; value: string; tone: string; hit: boolean; y: number }[];
    const raw: { key: string; kicker: string; value: string; tone: string; hit: boolean; y: number }[] = [];
    if (targetReview.entryRevealed && targetReview.entryY !== null) {
      raw.push({
        key: "entry",
        kicker: "ENTRY",
        value: `$${formatPrice(targetReview.review.entryPrice)}`,
        tone: "entry",
        hit: false,
        y: targetReview.entryY,
      });
    }
    if (targetReview.takeProfitY !== null) {
      raw.push({
        key: "tp",
        kicker: targetReview.hitLevel === "tp" ? "TP HIT" : "TAKE PROFIT",
        value: `$${formatPrice(targetReview.review.takeProfitPrice!)}`,
        tone: "tp",
        hit: targetReview.hitLevel === "tp",
        y: targetReview.takeProfitY,
      });
    }
    if (targetReview.stopLossY !== null) {
      raw.push({
        key: "sl",
        kicker: targetReview.hitLevel === "sl" ? "SL HIT" : "STOP LOSS",
        value: `$${formatPrice(targetReview.review.stopLossPrice!)}`,
        tone: "sl",
        hit: targetReview.hitLevel === "sl",
        y: targetReview.stopLossY,
      });
    }
    if (targetReview.phase === "in-trade" && targetReview.markY !== null) {
      const pct = targetReview.markPct;
      raw.push({
        key: "mark",
        kicker: "OPEN",
        value: pct === null ? `$${formatPrice(targetTradeReview?.markPrice ?? 0)}` : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        tone: pct !== null && pct < 0 ? "sl" : "tp",
        hit: false,
        y: targetReview.markY,
      });
    }
    if (targetReview.exitRevealed && targetReview.exitY !== null) {
      const isWin = targetReview.review.netPnl >= 0;
      raw.push({
        key: "exit",
        kicker: "EXIT",
        value: `$${formatPrice(targetReview.review.exitPrice)}`,
        tone: isWin ? "win" : "loss",
        hit: targetReview.hitLevel === "exit",
        y: targetReview.exitY,
      });
    }

    const minGap = 26;
    const top = chartData.padTop + 10;
    const bottom = height - chartData.padBottom - 10;
    const ordered = raw.sort((left, right) => left.y - right.y);
    let previous = Number.NEGATIVE_INFINITY;
    for (const tag of ordered) {
      const clamped = Math.max(top, Math.min(bottom, tag.y));
      tag.y = Math.max(clamped, Math.min(previous + minGap, bottom));
      previous = tag.y;
    }
    return ordered;
  })();

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

          {/* ── Reviewed trade: progressive Entry / Stop Loss / Take Profit ──
              Nothing is drawn before the tape reaches the entry bar, the
              bracket appears the moment the position opens, and the exit level
              only lands on the bar the trade actually closed. */}
          {targetReview && targetReview.entryRevealed && (() => {
            const {
              review,
              entryX,
              exitX,
              entryY,
              exitY,
              takeProfitY,
              stopLossY,
              trajectory,
              hitLevel,
              lineStartX,
              lineEndX,
              corridorEndX,
              liveX,
              exitRevealed,
              markY,
              showLive,
            } = targetReview;
            const baseline = height - (showVolume ? 18 : chartData.padBottom);
            const startX = entryX ?? 0;
            // Corridors only fill as far as the tape has travelled, so the
            // shaded risk/reward zones grow while the position is still open.
            const fillEndX = exitRevealed && exitX !== null
              ? Math.max(startX, exitX)
              : Math.max(startX, Math.min(liveX, corridorEndX));
            const corridorWidth = fillEndX - startX;
            const crowded = (x: number) => x > chartData.plotWidth * 0.62;
            const captionX = (x: number) => (crowded(x) ? x - 10 : x + 10);
            const captionAnchor = (x: number) => (crowded(x) ? "end" : "start");
            const takeProfit = review.takeProfitPrice ?? 0;
            const stopLoss = review.stopLossPrice ?? 0;
            return (
              <g className="chart-target-trade-layer" pointerEvents="none">
                {/* Reward zone: entry -> take profit */}
                {takeProfitY !== null && entryY !== null && corridorWidth > 0 && (
                  <rect
                    x={startX}
                    y={Math.min(entryY, takeProfitY)}
                    width={corridorWidth}
                    height={Math.max(1, Math.abs(takeProfitY - entryY))}
                    className={`target-trade-corridor corridor-reward${hitLevel === "tp" ? " is-hit" : ""}`}
                  />
                )}
                {/* Risk zone: entry -> stop loss */}
                {stopLossY !== null && entryY !== null && corridorWidth > 0 && (
                  <rect
                    x={startX}
                    y={Math.min(entryY, stopLossY)}
                    width={corridorWidth}
                    height={Math.max(1, Math.abs(stopLossY - entryY))}
                    className={`target-trade-corridor corridor-risk${hitLevel === "sl" ? " is-hit" : ""}`}
                  />
                )}
                {/* The path price actually took, revealed bar by bar */}
                {trajectory && <path d={trajectory} className="target-trade-trajectory" />}
                {/* Entry / exit bar markers answer "when did it get in and out" */}
                {entryX !== null && (
                  <line x1={entryX} x2={entryX} y1={chartData.padTop} y2={baseline} className="target-trade-event-line event-entry" />
                )}
                {exitRevealed && exitX !== null && (
                  <line x1={exitX} x2={exitX} y1={chartData.padTop} y2={baseline} className="target-trade-event-line event-exit" />
                )}
                {entryY !== null && (
                  <line x1={lineStartX} x2={lineEndX} y1={entryY} y2={entryY} className="target-trade-line-entry" />
                )}
                {takeProfitY !== null && (
                  <line
                    x1={lineStartX}
                    x2={lineEndX}
                    y1={takeProfitY}
                    y2={takeProfitY}
                    className={`target-trade-line-tp${hitLevel === "tp" ? " is-hit" : ""}`}
                  />
                )}
                {stopLossY !== null && (
                  <line
                    x1={lineStartX}
                    x2={lineEndX}
                    y1={stopLossY}
                    y2={stopLossY}
                    className={`target-trade-line-sl${hitLevel === "sl" ? " is-hit" : ""}`}
                  />
                )}
                {exitRevealed && exitY !== null && (
                  <line
                    x1={lineStartX}
                    x2={lineEndX}
                    y1={exitY}
                    y2={exitY}
                    className={`target-trade-line-exit${hitLevel === "exit" ? " is-hit" : ""}`}
                  />
                )}
                {entryX !== null && entryY !== null && (
                  <>
                    <circle cx={entryX} cy={entryY} r={5} className="target-trade-pin pin-entry" />
                    <text
                      x={captionX(entryX)}
                      y={chartData.padTop + 13}
                      textAnchor={captionAnchor(entryX)}
                      className="target-trade-caption caption-entry"
                    >
                      {`ENTRY $${formatPrice(review.entryPrice)}`}
                    </text>
                  </>
                )}
                {takeProfitY !== null && (
                  <text
                    x={lineStartX + 8}
                    y={Math.max(chartData.padTop + 11, takeProfitY - 7)}
                    textAnchor="start"
                    className={`target-trade-caption caption-tp${hitLevel === "tp" ? " is-hit" : ""}`}
                  >
                    {`${hitLevel === "tp" ? "TP HIT" : "TAKE PROFIT"} $${formatPrice(takeProfit)}`}
                  </text>
                )}
                {stopLossY !== null && (
                  <text
                    x={lineStartX + 8}
                    y={Math.min(baseline - 4, stopLossY + 15)}
                    textAnchor="start"
                    className={`target-trade-caption caption-sl${hitLevel === "sl" ? " is-hit" : ""}`}
                  >
                    {`${hitLevel === "sl" ? "SL HIT" : "STOP LOSS"} $${formatPrice(stopLoss)}`}
                  </text>
                )}
                {showLive && markY !== null && (
                  <>
                    <circle cx={liveX} cy={markY} r={5} className="target-trade-pin pin-live" />
                    <text
                      x={captionX(liveX)}
                      y={markY - 11}
                      textAnchor={captionAnchor(liveX)}
                      className="target-trade-caption caption-live"
                    >
                      OPEN
                    </text>
                  </>
                )}
                {exitRevealed && exitX !== null && exitY !== null && (
                  <>
                    <circle
                      cx={exitX}
                      cy={exitY}
                      r={5}
                      className={`target-trade-pin pin-exit${review.netPnl >= 0 ? " is-win" : " is-loss"}`}
                    />
                    <text
                      x={captionX(exitX)}
                      y={chartData.padTop + 27}
                      textAnchor={captionAnchor(exitX)}
                      className={`target-trade-caption caption-exit${review.netPnl >= 0 ? " is-win" : " is-loss"}`}
                    >
                      {`EXIT $${formatPrice(review.exitPrice)}`}
                    </text>
                  </>
                )}
              </g>
            );
          })()}

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

          {/* Reviewed trade price rail tags. Rendered independently of the live
              bracket preview so a user's own bracket and the historical levels
              can coexist, and stacked by the greedy de-overlap pass above. */}
          {reviewRailTags.map((tag) => (
            <div
              key={tag.key}
              className={`rail-chevron-tag rail-tag-review tone-${tag.tone}${tag.hit ? " is-hit" : ""}`}
              style={{ top: `${tag.y}px` }}
            >
              <span className={`rail-chevron-notch notch-review notch-${tag.tone}`}>◀</span>
              <div className={`rail-chevron-body review-tag-bg-${tag.tone}`}>
                <span className="rail-tag-kicker">{tag.kicker}</span>
                <span className="rail-tag-val">{tag.value}</span>
              </div>
            </div>
          ))}

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
