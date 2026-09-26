"use client";

import { useMemo, useState, useRef } from "react";
import {
  buildEquityCurve,
  buildDrawdownSeries,
  buildDailyPnl,
  buildRollingWinRate,
  buildAssetAllocation,
  computePortfolioMetrics,
  type ClosedTradeInput,
  type EquitySnapshot,
  type DrawdownPoint,
  type DailyPnl,
  type RollingWinRate as RollingWinRateType,
} from "@/lib/portfolio-analytics";

type OpenPosition = { symbol: string; quantity: number; averageEntry: number };
type QuoteEntry = { symbol: string; price: number };

function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return sign + "$" + Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (days > 0) return `${days}d ${remainHours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

function SvgIcon({ name, size = 16 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "trending":
      return (
        <svg {...common}>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

function EquityCurveChart({ data, startingCapital }: { data: EquitySnapshot[]; startingCapital: number }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length < 2) return null;
  const W = 760;
  const H = 175;
  const padT = 20;
  const padB = 26;
  const usable = H - padT - padB;
  const values = data.map((d) => d.equity);
  const minV = Math.min(startingCapital, ...values);
  const maxV = Math.max(startingCapital, ...values);
  const spread = maxV - minV || 1;
  const toY = (v: number) => padT + ((maxV - v) / spread) * usable;
  const baseY = toY(startingCapital);
  const finalEquity = data[data.length - 1].equity;
  const isUp = finalEquity >= startingCapital;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = toY(d.equity);
    return { x, y, ...d };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${W},${baseY.toFixed(1)} L0,${baseY.toFixed(1)} Z`;

  const activePoint = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];

  return (
    <div className="pa-chart-wrap" onMouseLeave={() => setHoverIndex(null)}>
      <div className="pa-chart-live-readout" aria-live="polite">
        <div className="pa-readout-item">
          <span>Observed Point:</span>
          <strong>{hoverIndex !== null ? `#${hoverIndex + 1} (${activePoint.symbol})` : "Latest Close"}</strong>
        </div>
        <div className="pa-readout-item">
          <span>Portfolio Equity:</span>
          <strong className={activePoint.equity >= startingCapital ? "tone-up" : "tone-down"}>
            {formatMoney(activePoint.equity)}
          </strong>
        </div>
        <div className="pa-readout-item">
          <span>Trade Contribution:</span>
          <strong className={activePoint.pnl >= 0 ? "tone-up" : "tone-down"}>
            {formatMoney(activePoint.pnl)}
          </strong>
        </div>
        <div className="pa-readout-item">
          <span>Recorded:</span>
          <span>{new Date(activePoint.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pa-chart-svg"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const idx = Math.min(data.length - 1, Math.max(0, Math.round(relX * (data.length - 1))));
          setHoverIndex(idx);
        }}
      >
        <line x1="0" x2={W} y1={baseY} y2={baseY} className="pa-baseline" />
        <path d={areaPath} className={`pa-area ${isUp ? "pa-area-up" : "pa-area-down"}`} />
        <path d={path} className={`pa-line ${isUp ? "pa-line-up" : "pa-line-down"}`} />

        {activePoint ? (
          <g className="pa-active-crosshair">
            <line x1={activePoint.x} x2={activePoint.x} y1={padT} y2={H - padB} className="pa-crosshair-v" />
            <circle cx={activePoint.x} cy={activePoint.y} r={4.5} className="pa-crosshair-dot" />
          </g>
        ) : null}
      </svg>

      <div className="pa-chart-scale">
        <span>Min: {formatMoney(minV)}</span>
        <span className="pa-scale-mid">Base Capital {formatMoney(startingCapital)}</span>
        <span>Peak: {formatMoney(maxV)}</span>
      </div>
    </div>
  );
}

function DrawdownChart({ data }: { data: DrawdownPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length < 2) return null;
  const W = 760;
  const H = 110;
  const padT = 10;
  const padB = 22;
  const usable = H - padT - padB;
  const minDD = Math.min(...data.map((d) => d.drawdownPct));
  const spread = Math.abs(minDD) || 1;
  const toY = (ddPct: number) => padT + (Math.abs(ddPct) / spread) * usable;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = toY(d.drawdownPct);
    return { x, y, ...d };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${W},${padT} L0,${padT} Z`;

  const activePoint = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];

  return (
    <div className="pa-chart-wrap pa-dd-wrap" onMouseLeave={() => setHoverIndex(null)}>
      <div className="pa-chart-live-readout pa-readout-subtle">
        <span>Drawdown: <strong className="tone-down">{activePoint.drawdownPct.toFixed(2)}% ({formatMoney(activePoint.drawdown)})</strong></span>
        <span>Peak Equity: <strong>{formatMoney(activePoint.peak)}</strong></span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pa-chart-svg"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const idx = Math.min(data.length - 1, Math.max(0, Math.round(relX * (data.length - 1))));
          setHoverIndex(idx);
        }}
      >
        <line x1="0" x2={W} y1={padT} y2={padT} className="pa-baseline" />
        <path d={areaPath} className="pa-area pa-area-down" />
        <path d={path} className="pa-line pa-line-down" />

        {activePoint ? (
          <g className="pa-active-crosshair">
            <line x1={activePoint.x} x2={activePoint.x} y1={padT} y2={H - padB} className="pa-crosshair-v" />
            <circle cx={activePoint.x} cy={activePoint.y} r={4} className="pa-crosshair-dot-down" />
          </g>
        ) : null}
      </svg>

      <div className="pa-chart-scale">
        <span>Max: {minDD.toFixed(2)}%</span>
        <span className="pa-scale-mid">0.00% Baseline</span>
        <span>0.00%</span>
      </div>
    </div>
  );
}

function WinRateChart({ data }: { data: RollingWinRateType[] }) {
  if (data.length < 2) return null;
  const W = 760;
  const H = 100;
  const padT = 10;
  const padB = 20;
  const usable = H - padT - padB;
  const fiftyY = padT + (50 / 100) * usable;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = padT + ((100 - d.winRate) / 100) * usable;
    return { x, y, ...d };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div className="pa-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="pa-chart-svg" preserveAspectRatio="none">
        <line x1="0" x2={W} y1={fiftyY} y2={fiftyY} className="pa-baseline pa-fifty-line" />
        <path d={path} className="pa-line pa-line-winrate" />
      </svg>
      <div className="pa-chart-scale">
        <span>0.0%</span>
        <span className="pa-scale-mid">50.0% Breakeven Threshold</span>
        <span>100.0%</span>
      </div>
    </div>
  );
}

function DailyPnlCalendar({ data }: { data: DailyPnl[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeTooltip, setActiveTooltip] = useState<{
    dateStr: string;
    formattedDate: string;
    pnl: number;
    tradeCount: number;
    wins: number;
    losses: number;
    left: number;
    top: number;
  } | null>(null);

  if (data.length === 0) return null;

  // Aggregate metrics for the KPI summary bar
  const totalPnl = data.reduce((sum, d) => sum + d.pnl, 0);
  const tradingDays = data.length;
  const greenDays = data.filter((d) => d.pnl > 0).length;
  const redDays = data.filter((d) => d.pnl < 0).length;
  const winRate = tradingDays > 0 ? (greenDays / tradingDays) * 100 : 0;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);

  const bestDay = data.length > 0 ? Math.max(...data.map((d) => d.pnl)) : null;
  const worstDay = data.length > 0 ? Math.min(...data.map((d) => d.pnl)) : null;
  const avgDailyPnl = tradingDays > 0 ? totalPnl / tradingDays : 0;

  // Weekday distribution & consistency stats
  const dayOfWeekStats = useMemo(() => {
    const days = [
      { name: "Mon", dayIdx: 1 },
      { name: "Tue", dayIdx: 2 },
      { name: "Wed", dayIdx: 3 },
      { name: "Thu", dayIdx: 4 },
      { name: "Fri", dayIdx: 5 },
      { name: "Sat", dayIdx: 6 },
      { name: "Sun", dayIdx: 0 },
    ];

    return days.map(({ name, dayIdx }) => {
      let pnl = 0;
      let trades = 0;
      let wins = 0;
      let losses = 0;

      data.forEach((d) => {
        const [y, m, day] = d.date.split("-").map(Number);
        const dt = new Date(y, m - 1, day);
        if (dt.getDay() === dayIdx) {
          pnl += d.pnl;
          trades += d.tradeCount;
          wins += d.wins;
          losses += d.losses;
        }
      });

      return { name, pnl, trades, wins, losses };
    });
  }, [data]);

  const maxWeekdayAbs = useMemo(() => {
    return Math.max(...dayOfWeekStats.map((d) => Math.abs(d.pnl)), 1);
  }, [dayOfWeekStats]);

  const { profitFactor, maxWinStreak } = useMemo(() => {
    let grossWins = 0;
    let grossLosses = 0;
    let maxW = 0;
    let currentW = 0;

    data.forEach((d) => {
      if (d.pnl > 0) {
        grossWins += d.pnl;
        currentW += 1;
        maxW = Math.max(maxW, currentW);
      } else if (d.pnl < 0) {
        grossLosses += Math.abs(d.pnl);
        currentW = 0;
      }
    });

    const pf = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : null;
    return { profitFactor: pf, maxWinStreak: maxW };
  }, [data]);

  // Time horizon: 52 weeks (1 full annual horizon / 365 days) ending on today (or latest trade date if in the future)
  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (data.length > 0) {
    const lastTradeDate = new Date(data[data.length - 1].date + "T00:00:00");
    if (lastTradeDate > endDate) {
      endDate.setTime(lastTradeDate.getTime());
    }
  }

  const minWeeks = 52;
  const minStartDate = new Date(endDate);
  minStartDate.setDate(minStartDate.getDate() - (minWeeks * 7 - 1));

  let earliestDate = new Date(minStartDate);
  if (data.length > 0) {
    const firstTradeDate = new Date(data[0].date + "T00:00:00");
    if (firstTradeDate < earliestDate) {
      earliestDate = new Date(firstTradeDate);
    }
  }

  // Align to Sunday start
  const startDayOfWeek = earliestDate.getDay();
  const gridStart = new Date(earliestDate);
  gridStart.setDate(gridStart.getDate() - startDayOfWeek);

  // Align to Saturday end
  const endDayOfWeek = endDate.getDay();
  const gridEnd = new Date(endDate);
  gridEnd.setDate(gridEnd.getDate() + (6 - endDayOfWeek));

  const pnlMap = new Map(data.map((d) => [d.date, d]));
  const weeks: Array<{
    monthLabel?: string;
    days: Array<{
      date: string;
      dayOfWeek: number;
      day: DailyPnl | null;
      isFuture: boolean;
    }>;
  }> = [];

  const current = new Date(gridStart);
  let currentWeekDays: Array<{
    date: string;
    dayOfWeek: number;
    day: DailyPnl | null;
    isFuture: boolean;
  }> = [];

  let lastMonth = -1;
  let weeksSinceLastLabel = 99;

  while (current <= gridEnd) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const isFuture = current > endDate;

    currentWeekDays.push({
      date: dateStr,
      dayOfWeek: current.getDay(),
      day: pnlMap.get(dateStr) ?? null,
      isFuture,
    });

    if (currentWeekDays.length === 7) {
      let monthLabel: string | undefined = undefined;
      for (const dayItem of currentWeekDays) {
        const itemDate = new Date(dayItem.date + "T00:00:00");
        const itemMonth = itemDate.getMonth();
        if (itemMonth !== lastMonth) {
          if (lastMonth === -1) {
            // If calendar starts late in the month (day > 7), don't label it; wait for day 1 of next month
            if (itemDate.getDate() <= 7) {
              monthLabel = itemDate.toLocaleDateString("en-US", { month: "short" });
              weeksSinceLastLabel = 0;
            }
          } else if (weeksSinceLastLabel >= 3) {
            monthLabel = itemDate.toLocaleDateString("en-US", { month: "short" });
            weeksSinceLastLabel = 0;
          }
          lastMonth = itemMonth;
          break;
        }
      }
      weeksSinceLastLabel++;
      weeks.push({ monthLabel, days: currentWeekDays });
      currentWeekDays = [];
    }

    current.setDate(current.getDate() + 1);
  }

  const formatTooltipDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const handleCellHover = (
    e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>,
    dateStr: string,
    day: DailyPnl | null
  ) => {
    if (!containerRef.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const elRect = e.currentTarget.getBoundingClientRect();
    const left = elRect.left - cRect.left + elRect.width / 2;
    const top = elRect.top - cRect.top;

    setActiveTooltip({
      dateStr,
      formattedDate: formatTooltipDate(dateStr),
      pnl: day?.pnl ?? 0,
      tradeCount: day?.tradeCount ?? 0,
      wins: day?.wins ?? 0,
      losses: day?.losses ?? 0,
      left,
      top,
    });
  };

  return (
    <div className="pa-calendar-container" ref={containerRef}>
      {/* 1. Header KPI Summary Bar */}
      <div className="pa-calendar-kpi-bar" aria-label="Performance calendar summary">
        <div className="pa-kpi-chip">
          <span className="pa-kpi-label">Trading Days</span>
          <strong className="pa-kpi-value">{tradingDays}d</strong>
        </div>
        <div className="pa-kpi-chip">
          <span className="pa-kpi-label">Green Days</span>
          <strong className="pa-kpi-value text-green">{greenDays}</strong>
        </div>
        <div className="pa-kpi-chip">
          <span className="pa-kpi-label">Red Days</span>
          <strong className="pa-kpi-value text-red">{redDays}</strong>
        </div>
        <div className="pa-kpi-chip">
          <span className="pa-kpi-label">Day Win Rate</span>
          <strong className="pa-kpi-value">{tradingDays > 0 ? `${winRate.toFixed(1)}%` : "n/a"}</strong>
        </div>
        <div className="pa-kpi-chip">
          <span className="pa-kpi-label">Avg Daily P&amp;L</span>
          <strong className={`pa-kpi-value ${avgDailyPnl >= 0 ? "text-green" : "text-red"}`}>
            {tradingDays > 0 ? `${avgDailyPnl >= 0 ? "+" : ""}${formatMoney(avgDailyPnl)}` : "n/a"}
          </strong>
        </div>
        {bestDay !== null && bestDay > 0 ? (
          <div className="pa-kpi-chip">
            <span className="pa-kpi-label">Best Day</span>
            <strong className="pa-kpi-value text-green">+{formatMoney(bestDay)}</strong>
          </div>
        ) : null}
        {worstDay !== null && worstDay < 0 ? (
          <div className="pa-kpi-chip">
            <span className="pa-kpi-label">Worst Day</span>
            <strong className="pa-kpi-value text-red">{formatMoney(worstDay)}</strong>
          </div>
        ) : null}
        <div className="pa-kpi-chip pa-kpi-total">
          <span className="pa-kpi-label">Net Realized P&amp;L</span>
          <strong className={`pa-kpi-value ${totalPnl >= 0 ? "text-green" : "text-red"}`}>
            {totalPnl >= 0 ? "+" : ""}{formatMoney(totalPnl)}
          </strong>
        </div>
      </div>

      {/* 2. Main Matrix Layout: Heatmap on Left + Weekday Edge Panel on Right */}
      <div className="pa-matrix-main-layout">
        <div className="pa-matrix-calendar-col">
          <div className="pa-calendar-scroll-wrap">
            <div className="pa-calendar-body">
              {/* Weekday Axis (3-row labels: Mon, Wed, Fri) */}
              <div className="pa-calendar-labels-col" aria-hidden="true">
                <div className="pa-labels-spacer" />
                <div className="pa-calendar-labels">
                  <span></span>
                  <span>Mon</span>
                  <span></span>
                  <span>Wed</span>
                  <span></span>
                  <span>Fri</span>
                  <span></span>
                </div>
              </div>

              {/* Month headers and week columns */}
              <div className="pa-calendar-columns-wrap">
                {/* Top Month Header Row */}
                <div
                  className="pa-calendar-months"
                  aria-hidden="true"
                  style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
                >
                  {weeks.map((week, wi) => (
                    <div key={wi} className="pa-month-col">
                      {week.monthLabel ?? ""}
                    </div>
                  ))}
                </div>

                {/* Heatmap Grid */}
                <div
                  className="pa-calendar-grid"
                  role="grid"
                  aria-label="Daily performance heatmap"
                  style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
                >
                  {weeks.map((week, wi) => (
                    <div key={wi} className="pa-calendar-week" role="row">
                      {week.days.map((cell, di) => {
                        const hasTrades = cell.day !== null && cell.day.tradeCount > 0;
                        const pnl = cell.day?.pnl ?? 0;
                        let cls = "pa-cal-inactive";

                        if (cell.isFuture) {
                          cls = "pa-cal-future";
                        } else if (hasTrades) {
                          if (pnl > 0) {
                            const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
                            const level = Math.max(1, Math.min(4, Math.ceil(intensity * 4)));
                            cls = `pa-cal-up-${level}`;
                          } else if (pnl < 0) {
                            const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
                            const level = Math.max(1, Math.min(4, Math.ceil(intensity * 4)));
                            cls = `pa-cal-down-${level}`;
                          } else {
                            cls = "pa-cal-zero";
                          }
                        }

                        const formattedDate = formatTooltipDate(cell.date);
                        const accessibleLabel = hasTrades
                          ? `${formattedDate}: ${pnl >= 0 ? "+" : ""}${formatMoney(pnl)} across ${cell.day?.tradeCount} trade(s)`
                          : `${formattedDate}: No closed trades`;

                        return (
                          <div
                            key={di}
                            tabIndex={cell.isFuture ? -1 : 0}
                            className={`pa-cal-cell ${cls}`}
                            role="gridcell"
                            aria-label={accessibleLabel}
                            title={accessibleLabel}
                            onMouseEnter={(e) => handleCellHover(e, cell.date, cell.day)}
                            onMouseLeave={() => setActiveTooltip(null)}
                            onFocus={(e) => handleCellHover(e, cell.date, cell.day)}
                            onBlur={() => setActiveTooltip(null)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="pa-calendar-legend" aria-hidden="true">
            <span className="pa-legend-label">Loss</span>
            <span className="pa-cal-cell pa-cal-down-4" title="Large Loss" />
            <span className="pa-cal-cell pa-cal-down-3" />
            <span className="pa-cal-cell pa-cal-down-2" />
            <span className="pa-cal-cell pa-cal-down-1" title="Small Loss" />
            <span className="pa-cal-cell pa-cal-inactive" title="No Trades" />
            <span className="pa-cal-cell pa-cal-up-1" title="Small Profit" />
            <span className="pa-cal-cell pa-cal-up-2" />
            <span className="pa-cal-cell pa-cal-up-3" />
            <span className="pa-cal-cell pa-cal-up-4" title="Large Profit" />
            <span className="pa-legend-label">Profit</span>
          </div>
        </div>

        {/* Right Side Panel: Weekday Edge & Consistency */}
        <div className="pa-matrix-side-panel">
          <div className="pa-side-panel-header">
            <div>
              <strong>Weekday Edge</strong>
              <p>Performance by day of week</p>
            </div>
          </div>

          <div className="pa-weekday-list">
            {dayOfWeekStats.map((item) => (
              <div key={item.name} className="pa-weekday-row">
                <span className="pa-weekday-name">{item.name}</span>
                <div className="pa-weekday-bar-track">
                  {item.trades > 0 && item.pnl !== 0 ? (
                    <div
                      className={`pa-weekday-bar ${item.pnl > 0 ? "bar-green" : "bar-red"}`}
                      style={{
                        width: `${Math.max(14, Math.min(100, Math.round((Math.abs(item.pnl) / (maxWeekdayAbs || 1)) * 100)))}%`,
                      }}
                    />
                  ) : (
                    <div className="pa-weekday-bar-empty" />
                  )}
                </div>
                <span className={`pa-weekday-pnl ${item.pnl > 0 ? "text-green" : item.pnl < 0 ? "text-red" : "text-muted"}`}>
                  {item.trades > 0 ? `${item.pnl >= 0 ? "+" : ""}${formatMoney(item.pnl)}` : "—"}
                </span>
              </div>
            ))}
          </div>

          <div className="pa-side-panel-footer">
            <div className="pa-side-stat">
              <span>Profit Factor</span>
              <strong>{Number.isFinite(profitFactor) ? `${profitFactor!.toFixed(2)}x` : "n/a"}</strong>
            </div>
            <div className="pa-side-stat">
              <span>Best Streak</span>
              <strong>{maxWinStreak > 0 ? `${maxWinStreak}d Win` : "1d"}</strong>
            </div>
          </div>
        </div>
      </div>

      {activeTooltip ? (
        <div
          className="pa-cal-floating-tooltip"
          style={{ left: activeTooltip.left, top: activeTooltip.top }}
          role="tooltip"
          aria-live="polite"
        >
          <span className="pa-tooltip-date">{activeTooltip.formattedDate}</span>
          {activeTooltip.tradeCount > 0 ? (
            <div className="pa-tooltip-content">
              <span
                className={`pa-tooltip-badge ${activeTooltip.pnl >= 0 ? "pa-badge-up" : "pa-badge-down"}`}
              >
                {activeTooltip.pnl >= 0 ? "+" : ""}
                {formatMoney(activeTooltip.pnl)}
              </span>
              <span className="pa-tooltip-meta">
                {activeTooltip.tradeCount} trade{activeTooltip.tradeCount > 1 ? "s" : ""} ({activeTooltip.wins}W / {activeTooltip.losses}L)
              </span>
            </div>
          ) : (
            <span className="pa-tooltip-empty">No closed trades recorded</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AllocationDonut({ data }: { data: Array<{ symbol: string; value: number; pct: number; color: string }> }) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

  if (data.length === 0) return null;
  const SIZE = 150;
  const STROKE = 22;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  let offset = 0;

  const totalValue = data.reduce((sum, item) => sum + item.value, 0);
  const activeItem = hoveredSymbol ? data.find((d) => d.symbol === hoveredSymbol) : null;

  return (
    <div className="pa-donut-wrap">
      <div className="pa-donut-chart-container">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="pa-donut-svg">
          {data.map((item) => {
            const dashLength = (item.pct / 100) * C;
            const dash = `${dashLength} ${C - dashLength}`;
            const isHovered = hoveredSymbol === item.symbol;
            const el = (
              <circle
                key={item.symbol}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={item.color}
                strokeWidth={isHovered ? STROKE + 3 : STROKE}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                className="pa-donut-segment"
                onMouseEnter={() => setHoveredSymbol(item.symbol)}
                onMouseLeave={() => setHoveredSymbol(null)}
              />
            );
            offset += dashLength;
            return el;
          })}
        </svg>

        <div className="pa-donut-center-info">
          {activeItem ? (
            <>
              <strong>{activeItem.pct.toFixed(1)}%</strong>
              <span>{activeItem.symbol.replace("USDT", "")}</span>
            </>
          ) : (
            <>
              <strong>{formatMoney(totalValue)}</strong>
              <span>Total Notional</span>
            </>
          )}
        </div>
      </div>

      <div className="pa-donut-legend">
        {data.map((item) => {
          const isSelected = hoveredSymbol === item.symbol;
          return (
            <div
              key={item.symbol}
              className={`pa-donut-legend-item ${isSelected ? "pa-legend-selected" : ""}`}
              onMouseEnter={() => setHoveredSymbol(item.symbol)}
              onMouseLeave={() => setHoveredSymbol(null)}
              tabIndex={0}
            >
              <span className="pa-donut-swatch" style={{ background: item.color }} />
              <span className="pa-donut-label">{item.symbol.replace("USDT", "")}</span>
              <span className="pa-donut-pct">{item.pct.toFixed(1)}%</span>
              <span className="pa-donut-val">{formatMoney(item.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PortfolioAnalytics({
  trades,
  startingCapital,
  openPositions,
  quotes,
  cashBalance,
}: {
  trades: ClosedTradeInput[];
  startingCapital: number;
  openPositions: OpenPosition[];
  quotes: QuoteEntry[];
  cashBalance: number;
}) {
  const metrics = useMemo(() => computePortfolioMetrics(trades, startingCapital), [trades, startingCapital]);
  const equityCurve = useMemo(() => buildEquityCurve(trades, startingCapital), [trades, startingCapital]);
  const drawdownSeries = useMemo(() => buildDrawdownSeries(equityCurve), [equityCurve]);
  const dailyPnl = useMemo(() => buildDailyPnl(trades), [trades]);
  const rollingWinRate = useMemo(() => buildRollingWinRate(trades, 10), [trades]);
  const allocation = useMemo(
    () => buildAssetAllocation(openPositions, quotes),
    [openPositions, quotes],
  );

  if (trades.length === 0) {
    return (
      <section className="panel pa-empty-panel">
        <div className="pa-empty-content">
          <div className="pa-empty-icon">
            <SvgIcon name="database" size={28} />
          </div>
          <h2>Portfolio analytics awaiting trade execution.</h2>
          <p>
            Complete at least one paper trade fill and close to populate your equity trajectory,
            underwater drawdown curve, risk-adjusted ratios, and daily P&amp;L calendar.
          </p>
        </div>
      </section>
    );
  }

  const totalPortfolioValue = cashBalance + openPositions.reduce((sum, pos) => {
    const q = quotes.find((qt) => qt.symbol === pos.symbol);
    return sum + pos.quantity * (q?.price ?? pos.averageEntry);
  }, 0);

  return (
    <div className="pa-dashboard">
      <section className="pa-hero-strip" aria-label="Portfolio key performance indicators">
        <div className="panel pa-hero-card pa-hero-primary">
          <span className="pa-hero-label">Total Portfolio Net Value</span>
          <strong className="pa-hero-value">{formatMoney(totalPortfolioValue)}</strong>
          <small className={metrics.totalReturn >= 0 ? "tone-up" : "tone-down"}>
            {formatPct(metrics.totalReturnPct)} All-Time Alpha
          </small>
        </div>
        <div className="panel pa-hero-card">
          <span className="pa-hero-label">Realized Net P&amp;L</span>
          <strong className={`pa-hero-value ${metrics.totalReturn >= 0 ? "tone-up" : "tone-down"}`}>
            {formatMoney(metrics.totalReturn)}
          </strong>
          <small>{metrics.totalTrades} Closed Positions</small>
        </div>
        <div className="panel pa-hero-card">
          <span className="pa-hero-label">Annualized Sharpe</span>
          <strong className="pa-hero-value">
            {metrics.sharpeRatio !== null ? metrics.sharpeRatio.toFixed(2) : "n/a"}
          </strong>
          <small>Risk-Adjusted Return</small>
        </div>
        <div className="panel pa-hero-card">
          <span className="pa-hero-label">Max Peak Drawdown</span>
          <strong className="pa-hero-value tone-down">
            {metrics.maxDrawdownPct !== 0 ? metrics.maxDrawdownPct.toFixed(2) + "%" : "0.00%"}
          </strong>
          <small>Peak-to-Trough Decline</small>
        </div>
        <div className="panel pa-hero-card">
          <span className="pa-hero-label">Win Rate Ratio</span>
          <strong className="pa-hero-value">{metrics.winRate.toFixed(1)}%</strong>
          <small>{metrics.totalWins} Wins · {metrics.totalLosses} Losses</small>
        </div>
        <div className="panel pa-hero-card">
          <span className="pa-hero-label">Profit Factor</span>
          <strong className="pa-hero-value">
            {metrics.profitFactor !== null
              ? Number.isFinite(metrics.profitFactor)
                ? metrics.profitFactor.toFixed(2)
                : "∞"
              : "n/a"}
          </strong>
          <small>Gross Gains / Losses</small>
        </div>
      </section>

      <section className="panel pa-section" aria-label="Portfolio equity curve">
        <div className="pa-section-header">
          <div>
            <h2>Portfolio Equity Trajectory</h2>
            <p>
              How is your paper capital growing over time against the starting {formatMoney(startingCapital)} baseline?
            </p>
          </div>
          <div className="pa-section-badge">
            <span>Terminal Equity</span>
            <strong className={equityCurve[equityCurve.length - 1]?.equity >= startingCapital ? "tone-up" : "tone-down"}>
              {formatMoney(equityCurve[equityCurve.length - 1]?.equity ?? startingCapital)}
            </strong>
          </div>
        </div>
        <EquityCurveChart data={equityCurve} startingCapital={startingCapital} />
      </section>

      <section className="panel pa-section" aria-label="Peak-to-trough drawdown">
        <div className="pa-section-header">
          <div>
            <h2>Underwater Drawdown Profile</h2>
            <p>
              What is your deepest capital contraction from equity peak across closed trade history?
            </p>
          </div>
          <div className="pa-section-badge pa-badge-warn">
            <span>Maximum Adverse Drawdown</span>
            <strong>{formatMoney(metrics.maxDrawdown)}</strong>
          </div>
        </div>
        <DrawdownChart data={drawdownSeries} />
      </section>

      <div className="pa-two-col">
        <section className="panel pa-section" aria-label="Rolling hit rate">
          <div className="pa-section-header">
            <div>
              <h2>Strategy Hit Rate Drift</h2>
              <p>10-trade sliding window win rate relative to 50% breakeven baseline.</p>
            </div>
          </div>
          {rollingWinRate.length > 0 ? (
            <WinRateChart data={rollingWinRate} />
          ) : (
            <p className="pa-no-data">Requires at least 10 closed trade fills to compute sliding window statistics.</p>
          )}
        </section>

        <section className="panel pa-section" aria-label="Spot exposure distribution">
          <div className="pa-section-header">
            <div>
              <h2>Active Capital Allocation</h2>
              <p>Simulated notional distribution across currently open spot positions.</p>
            </div>
          </div>
          {allocation.length > 0 ? (
            <AllocationDonut data={allocation} />
          ) : (
            <p className="pa-no-data">No open spot positions currently deployed in paper ledger.</p>
          )}
        </section>
      </div>

      <section className="panel pa-section" aria-label="Daily performance calendar heatmap">
        <div className="pa-section-header">
          <div>
            <h2>Daily Realized P&amp;L Matrix</h2>
            <p>Calendar distribution of daily realized trading performance. Hover or focus cells for details.</p>
          </div>
        </div>
        <DailyPnlCalendar data={dailyPnl} />
      </section>

      <section className="panel pa-section" aria-label="Quantitative statistics table">
        <div className="pa-section-header">
          <div>
            <h2>Quantitative Risk &amp; Expectancy Metrics</h2>
            <p>Empirical performance ratios calculated directly from your ledger executions.</p>
          </div>
        </div>
        <div className="pa-metrics-grid">
          <div className="pa-metric">
            <span>Sortino Ratio</span>
            <strong>{metrics.sortinoRatio !== null ? metrics.sortinoRatio.toFixed(2) : "n/a"}</strong>
            <small>Penalizes Downside Variance</small>
          </div>
          <div className="pa-metric">
            <span>Calmar Ratio</span>
            <strong>{metrics.calmarRatio !== null ? metrics.calmarRatio.toFixed(2) : "n/a"}</strong>
            <small>Net Return / Max Drawdown</small>
          </div>
          <div className="pa-metric">
            <span>Expected Value</span>
            <strong className={metrics.expectancy >= 0 ? "tone-up" : "tone-down"}>
              {formatMoney(metrics.expectancy)}
            </strong>
            <small>Per-Trade Mathematical Expectancy</small>
          </div>
          <div className="pa-metric">
            <span>Payoff Ratio</span>
            <strong>{metrics.payoffRatio !== null ? metrics.payoffRatio.toFixed(2) : "n/a"}</strong>
            <small>Avg Win / Avg Loss Ratio</small>
          </div>
          <div className="pa-metric">
            <span>Average Win Fill</span>
            <strong className="tone-up">{formatMoney(metrics.avgWin)}</strong>
            <small>{metrics.totalWins} Winning Fills</small>
          </div>
          <div className="pa-metric">
            <span>Average Loss Fill</span>
            <strong className="tone-down">{formatMoney(metrics.avgLoss)}</strong>
            <small>{metrics.totalLosses} Adverse Fills</small>
          </div>
          <div className="pa-metric">
            <span>Mean Holding Period</span>
            <strong>{formatDuration(metrics.avgHoldingPeriod)}</strong>
            <small>Fill to Close Duration</small>
          </div>
          <div className="pa-metric">
            <span>Current Trajectory</span>
            <strong className={metrics.currentStreak.type === "win" ? "tone-up" : metrics.currentStreak.type === "loss" ? "tone-down" : ""}>
              {metrics.currentStreak.type === "none"
                ? "Neutral"
                : `${metrics.currentStreak.length} Consecutive ${metrics.currentStreak.type === "win" ? "Wins" : "Losses"}`}
            </strong>
            <small>Active Run Direction</small>
          </div>
        </div>
      </section>

      <div className="pa-two-col">
        {metrics.bestTrade ? (
          <section className="panel pa-section pa-highlight-card">
            <div className="pa-trade-top-row">
              <span className="pa-trade-tag pa-tag-best">
                <SvgIcon name="trending" size={13} />
                Peak Realized Gain
              </span>
              <span className="pa-trade-symbol-tag">{metrics.bestTrade.symbol}</span>
            </div>
            <div className="pa-trade-stat-hero tone-up">
              {formatMoney(metrics.bestTrade.netPnl)}
            </div>
            <div className="pa-trade-subdata">
              <span>Entry: {formatMoney(metrics.bestTrade.entryPrice)}</span>
              <span>Exit: {formatMoney(metrics.bestTrade.exitPrice)}</span>
              <span className="tone-up">{formatPct(metrics.bestTrade.returnPct)}</span>
              <span>Hold: {formatDuration(metrics.bestTrade.closedAt - metrics.bestTrade.openedAt)}</span>
            </div>
          </section>
        ) : null}

        {metrics.worstTrade ? (
          <section className="panel pa-section pa-highlight-card">
            <div className="pa-trade-top-row">
              <span className="pa-trade-tag pa-tag-worst">
                <SvgIcon name="alert" size={13} />
                Max Adverse Trade
              </span>
              <span className="pa-trade-symbol-tag">{metrics.worstTrade.symbol}</span>
            </div>
            <div className="pa-trade-stat-hero tone-down">
              {formatMoney(metrics.worstTrade.netPnl)}
            </div>
            <div className="pa-trade-subdata">
              <span>Entry: {formatMoney(metrics.worstTrade.entryPrice)}</span>
              <span>Exit: {formatMoney(metrics.worstTrade.exitPrice)}</span>
              <span className="tone-down">{formatPct(metrics.worstTrade.returnPct)}</span>
              <span>Hold: {formatDuration(metrics.worstTrade.closedAt - metrics.worstTrade.openedAt)}</span>
            </div>
          </section>
        ) : null}
      </div>

      <section className="panel pa-section" aria-label="Execution consistency and streaks">
        <div className="pa-section-header">
          <div>
            <h2>Execution Discipline &amp; Consistency</h2>
            <p>Behavioral metrics quantifying execution streaks and holding discipline.</p>
          </div>
        </div>
        <div className="pa-streaks-row">
          <div className="pa-streak-card">
            <div className="pa-streak-icon-wrap pa-icon-gain">
              <SvgIcon name="trending" size={18} />
            </div>
            <div className="pa-streak-text">
              <strong>{metrics.longestWinStreak}</strong>
              <span>Best Win Streak</span>
            </div>
          </div>
          <div className="pa-streak-card">
            <div className="pa-streak-icon-wrap pa-icon-loss">
              <SvgIcon name="shield" size={18} />
            </div>
            <div className="pa-streak-text">
              <strong>{metrics.longestLoseStreak}</strong>
              <span>Max Consecutive Losses</span>
            </div>
          </div>
          <div className="pa-streak-card">
            <div className="pa-streak-icon-wrap pa-icon-neutral">
              <SvgIcon name="database" size={18} />
            </div>
            <div className="pa-streak-text">
              <strong>{metrics.totalTrades}</strong>
              <span>Sampled Executions</span>
            </div>
          </div>
          <div className="pa-streak-card">
            <div className="pa-streak-icon-wrap pa-icon-neutral">
              <SvgIcon name="clock" size={18} />
            </div>
            <div className="pa-streak-text">
              <strong>{formatDuration(metrics.avgHoldingPeriod)}</strong>
              <span>Average Hold Time</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
