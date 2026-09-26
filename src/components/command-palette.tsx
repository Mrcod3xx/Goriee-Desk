"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

export type PaletteAction = {
  id: string;
  category: "Markets" | "Navigation" | "Actions" | "Calculator";
  title: string;
  subtitle?: string;
  badge?: string;
  shortcut?: string;
  tone?: "up" | "down" | "neutral";
  onSelect: () => void;
};

export function CommandPalette({
  isOpen,
  onClose,
  symbols,
  currentSymbol,
  currentPrice,
  onSelectSymbol,
  onNavigate,
  onOpenOrderModal,
  onTriggerBacktest,
  onExportSnapshot,
  onToggleMatrix,
  onSetInterval,
}: {
  isOpen: boolean;
  onClose: () => void;
  symbols: Array<{ symbol: string; price: number; change24h: number }>;
  currentSymbol: string;
  currentPrice: number;
  onSelectSymbol: (symbol: string) => void;
  onNavigate: (view: string) => void;
  onOpenOrderModal: (side: "buy" | "sell") => void;
  onTriggerBacktest: () => void;
  onExportSnapshot?: () => void;
  onToggleMatrix: () => void;
  onSetInterval: (interval: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Global keyboard shortcut: Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Build items based on query
  const items = useMemo<PaletteAction[]>(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteAction[] = [];

    // 1. Calculator mode: if user types "risk $150 2%" or "calc" or math
    const riskMatch = q.match(/risk\s*\$?(\d+(?:\.\d+)?)\s*(?:at|with|loss)?\s*(\d+(?:\.\d+)?)%/i);
    if (riskMatch) {
      const riskUsd = parseFloat(riskMatch[1]);
      const stopPct = parseFloat(riskMatch[2]);
      if (riskUsd > 0 && stopPct > 0) {
        const posSize = (riskUsd / (stopPct / 100));
        const units = currentPrice > 0 ? posSize / currentPrice : 0;
        result.push({
          id: "calc-risk",
          category: "Calculator",
          title: `Position Size: $${Math.round(posSize).toLocaleString()} (${units.toFixed(4)} ${currentSymbol.replace("USDT", "")})`,
          subtitle: `Risking $${riskUsd} at ${stopPct}% stop loss`,
          badge: "Kelly Sizer",
          onSelect: () => {
            onNavigate("paper");
            onOpenOrderModal("buy");
            onClose();
          },
        });
      }
    }

    // 2. Navigation items
    const navItems = [
      { id: "nav-desk", title: "Market desk", view: "desk", subtitle: "Live candlesticks, orderbook L2, crosshair and Ask the Desk" },
      { id: "nav-scanner", title: "Market scanner", view: "scanner", subtitle: "Spot token screener, 24h turnover, and gainers/losers" },
      { id: "nav-research", title: "Research desk", view: "research", subtitle: "AI quantitative briefs, momentum pre-flight, and thesis lenses" },
      { id: "nav-backtests", title: "Strategy backtests", view: "backtests", subtitle: "Natural language rule compiler and Monte Carlo stress tests" },
      { id: "nav-playbooks", title: "Strategy playbooks", view: "playbooks", subtitle: "Algorithmic strategies library and paper deployment" },
      { id: "nav-paper", title: "Paper account", view: "paper", subtitle: "Simulated $10,000 ledger, positions, daily loss guard & brackets" },
      { id: "nav-analytics", title: "Portfolio analytics", view: "paper-analytics", subtitle: "Sharpe ratio, drawdown analysis, equity curve, and daily P&L calendar" },
      { id: "nav-journal", title: "Research journal", view: "journal", subtitle: "Saved research briefs, dominant regime KPIs, and detail split" },
      { id: "nav-settings", title: "Terminal settings", view: "settings", subtitle: "AI models, API providers, and ping latency diagnostics" },
    ];

    for (const nav of navItems) {
      if (!q || nav.title.toLowerCase().includes(q) || nav.subtitle.toLowerCase().includes(q)) {
        result.push({
          id: nav.id,
          category: "Navigation",
          title: `Go to ${nav.title}`,
          subtitle: nav.subtitle,
          shortcut: "Jump",
          onSelect: () => {
            onNavigate(nav.view);
            onClose();
          },
        });
      }
    }

    // 3. Quick Actions
    const quickActions = [
      {
        id: "act-buy",
        title: `Simulate Buy (Long) ${currentSymbol}`,
        subtitle: `Open simulated order modal for ${currentSymbol} at market`,
        badge: "Paper Order",
        shortcut: "B",
        onSelect: () => {
          onNavigate("paper");
          onOpenOrderModal("buy");
          onClose();
        },
      },
      {
        id: "act-sell",
        title: `Simulate Sell ${currentSymbol}`,
        subtitle: `Take profit or liquidate spot position for ${currentSymbol}`,
        badge: "Paper Order",
        shortcut: "S",
        onSelect: () => {
          onNavigate("paper");
          onOpenOrderModal("sell");
          onClose();
        },
      },
      {
        id: "act-backtest",
        title: `Run 30-Day Backtest for ${currentSymbol}`,
        subtitle: "Navigate to Strategy Lab and initiate rule evaluation",
        badge: "Quant Lab",
        shortcut: "R",
        onSelect: () => {
          onNavigate("backtests");
          onTriggerBacktest();
          onClose();
        },
      },
      {
        id: "act-matrix",
        title: "Toggle 4-Chart Matrix View",
        subtitle: "Display 15m, 1H, 4H, and 1D charts simultaneously",
        badge: "Layout",
        shortcut: "M",
        onSelect: () => {
          onNavigate("desk");
          onToggleMatrix();
          onClose();
        },
      },
      ...(onExportSnapshot
        ? [
            {
              id: "act-export",
              title: "Export High-DPI Strategy Card (1200×675 PNG)",
              subtitle: "Generate branded visual summary with one-click download",
              badge: "Export",
              shortcut: "E",
              onSelect: () => {
                onExportSnapshot();
                onClose();
              },
            },
          ]
        : []),
      {
        id: "act-int-15m",
        title: "Set Timeframe to 15m (Short-Term)",
        subtitle: "Switch Bitget spot candlestick aggregation to 15-minute bars",
        badge: "15m",
        onSelect: () => {
          onSetInterval("15m");
          onClose();
        },
      },
      {
        id: "act-int-1h",
        title: "Set Timeframe to 1H (Swing)",
        subtitle: "Switch Bitget spot candlestick aggregation to 1-hour bars",
        badge: "1H",
        onSelect: () => {
          onSetInterval("1H");
          onClose();
        },
      },
      {
        id: "act-int-1d",
        title: "Set Timeframe to 1D (Macro)",
        subtitle: "Switch Bitget spot candlestick aggregation to Daily bars",
        badge: "1D",
        onSelect: () => {
          onSetInterval("1D");
          onClose();
        },
      },
    ];

    for (const act of quickActions) {
      if (!q || act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q) || (act.badge && act.badge.toLowerCase().includes(q))) {
        result.push({
          id: act.id,
          category: "Actions",
          title: act.title,
          subtitle: act.subtitle,
          badge: act.badge,
          shortcut: act.shortcut,
          onSelect: act.onSelect,
        });
      }
    }

    // 4. Token Markets
    const matchedSymbols = symbols.filter(
      (s) => !q || s.symbol.toLowerCase().includes(q)
    );

    for (const s of matchedSymbols.slice(0, 15)) {
      result.push({
        id: `sym-${s.symbol}`,
        category: "Markets",
        title: s.symbol,
        subtitle: `Spot Market · $${s.price >= 1 ? s.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : s.price.toFixed(4)}`,
        badge: `${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(2)}%`,
        tone: s.change24h >= 0 ? "up" : "down",
        shortcut: s.symbol === currentSymbol ? "Active" : undefined,
        onSelect: () => {
          onSelectSymbol(s.symbol);
          onNavigate("desk");
          onClose();
        },
      });
    }

    return result;
  }, [
    query,
    symbols,
    currentSymbol,
    currentPrice,
    onNavigate,
    onSelectSymbol,
    onOpenOrderModal,
    onTriggerBacktest,
    onExportSnapshot,
    onToggleMatrix,
    onSetInterval,
    onClose,
  ]);

  // Adjust selection index when items change
  useEffect(() => {
    setSelectedIndex((prev) => (items.length > 0 ? Math.min(prev, items.length - 1) : 0));
  }, [items]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector(".cmd-palette-item.is-active");
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  // Keyboard navigation inside input
  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].onSelect();
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmd-palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette-header">
          <svg className="cmd-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="Type a command, token (BTC), view, or sizing (e.g. risk $150 2%)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
          <span className="cmd-palette-esc-badge" onClick={onClose}>ESC</span>
        </div>

        <div className="cmd-palette-body" ref={listRef}>
          {items.length === 0 ? (
            <div className="cmd-palette-empty">
              <strong>No matching commands or tokens</strong>
              <span>Try typing a symbol like &quot;BTC&quot;, &quot;buy&quot;, &quot;paper&quot;, or &quot;risk $100 2%&quot;</span>
            </div>
          ) : (
            <div className="cmd-palette-list">
              {items.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const prevCategory = idx > 0 ? items[idx - 1].category : null;
                const showCategoryHeader = item.category !== prevCategory;

                return (
                  <React.Fragment key={item.id}>
                    {showCategoryHeader ? (
                      <div className="cmd-palette-category-title">{item.category}</div>
                    ) : null}
                    <div
                      className={`cmd-palette-item ${isSelected ? "is-active" : ""}`}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={item.onSelect}
                    >
                      <div className="cmd-item-left">
                        <span className="cmd-item-title">{item.title}</span>
                        {item.subtitle ? <span className="cmd-item-subtitle">{item.subtitle}</span> : null}
                      </div>
                      <div className="cmd-item-right">
                        {item.badge ? (
                          <span className={`cmd-item-badge ${item.tone ? `tone-${item.tone}` : ""}`}>
                            {item.badge}
                          </span>
                        ) : null}
                        {item.shortcut ? <kbd className="cmd-item-kbd">{item.shortcut}</kbd> : null}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        <div className="cmd-palette-footer">
          <div className="cmd-footer-keys">
            <span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span>
            <span><kbd>↵</kbd> Select</span>
            <span><kbd>ESC</kbd> Close</span>
          </div>
          <span className="cmd-footer-brand">Goriee Desk Omnibar</span>
        </div>
      </div>
    </div>
  );
}
