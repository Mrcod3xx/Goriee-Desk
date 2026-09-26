"use client";

import { useEffect, useRef, useState } from "react";

export type CardExportData = {
  title: string;
  symbol: string;
  interval: string;
  regime: string;
  price?: number;
  rsi?: number;
  ema20?: number | null;
  ema50?: number | null;
  support?: number;
  resistance?: number;
  summary: string;
  bullCase?: string;
  bearCase?: string;
  invalidation?: string;
  engine?: string;
  asOf?: number;
  backtestReturnPct?: number;
  backtestWinRate?: number;
  backtestProfitFactor?: number;
  backtestMaxDrawdown?: number;
};

export function StrategyCardModal({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: CardExportData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High DPI 1200x675 canvas
    const width = 1200;
    const height = 675;
    canvas.width = width;
    canvas.height = height;

    // Background gradient (Forest/Dark Institutional Slate)
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, "#0b1d16");
    bgGradient.addColorStop(0.5, "#102a20");
    bgGradient.addColorStop(1, "#071610");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid pattern
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    for (let x = 40; x < width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 40; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Outer subtle border
    ctx.strokeStyle = "rgba(142, 226, 184, 0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, width - 60, height - 60);

    // Top Header: Brand & Desk
    ctx.fillStyle = "#8ae2b9";
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("GORIEE AI DESK", 60, 80);

    ctx.fillStyle = "#7ca18d";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("BITGET SPOT · INSTITUTIONAL BRIEF SPECIFICATION", 250, 80);

    // Title / Symbol Pill
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 38px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(data.symbol, 60, 140);

    ctx.fillStyle = "#9ec2b0";
    ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(`[ ${data.interval} ]`, 260, 140);

    // Regime Badge
    const regimeIsBull = data.regime.toLowerCase().includes("bull");
    const regimeIsBear = data.regime.toLowerCase().includes("bear");
    const badgeColor = regimeIsBull ? "#10b981" : regimeIsBear ? "#ef4444" : "#f59e0b";
    ctx.fillStyle = badgeColor;
    ctx.fillRect(360, 115, 260, 34);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(data.regime.toUpperCase(), 375, 138);

    // Date / Timestamp
    ctx.fillStyle = "#6d8c7c";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    const dateStr = new Date(data.asOf || Date.now()).toUTCString();
    ctx.fillText(dateStr, width - 360, 80);

    // Divider line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(60, 170);
    ctx.lineTo(width - 60, 170);
    ctx.stroke();

    // Quantitative metrics bar
    const metricsY = 220;
    const metrics = [
      { label: "LAST PRICE", val: data.price ? `$${data.price.toLocaleString()}` : "n/a" },
      { label: "RSI (14)", val: data.rsi !== undefined ? data.rsi.toFixed(1) : "n/a" },
      { label: "EMA 20", val: data.ema20 ? `$${data.ema20.toFixed(2)}` : "n/a" },
      { label: "EMA 50", val: data.ema50 ? `$${data.ema50.toFixed(2)}` : "n/a" },
      { label: "SUPPORT", val: data.support ? `$${data.support.toFixed(2)}` : "n/a" },
      { label: "RESISTANCE", val: data.resistance ? `$${data.resistance.toFixed(2)}` : "n/a" },
    ];

    if (data.backtestReturnPct !== undefined) {
      metrics.push({
        label: "BACKTEST RETURN",
        val: `${data.backtestReturnPct >= 0 ? "+" : ""}${data.backtestReturnPct.toFixed(1)}%`,
      });
      metrics.push({
        label: "PROFIT FACTOR",
        val: data.backtestProfitFactor ? data.backtestProfitFactor.toFixed(2) : "n/a",
      });
    }

    metrics.forEach((m, idx) => {
      const colX = 60 + idx * 135;
      if (colX + 130 > width - 60) return;
      ctx.fillStyle = "#709381";
      ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.fillText(m.label, colX, metricsY);

      ctx.fillStyle = "#f3fdf8";
      ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.fillText(m.val, colX, metricsY + 28);
    });

    // Divider line 2
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.moveTo(60, 275);
    ctx.lineTo(width - 60, 275);
    ctx.stroke();

    // Summary section
    ctx.fillStyle = "#89e2b8";
    ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("EXECUTIVE SUMMARY", 60, 315);

    ctx.fillStyle = "#d1e4db";
    ctx.font = "16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    // Word wrap summary
    const wrapText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
      const words = text.split(" ");
      let line = "";
      let curY = y;
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line, x, curY);
          line = words[n] + " ";
          curY += lineHeight;
          if (curY > y + lineHeight * 4) {
            ctx.fillText(line + "…", x, curY);
            return curY;
          }
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, curY);
      return curY;
    };

    wrapText(data.summary, 60, 345, width - 120, 24);

    // Bull Case vs Bear Case Cards
    const cardY = 440;
    const cardW = 520;
    const cardH = 135;

    // Bull Box
    ctx.fillStyle = "rgba(16, 185, 129, 0.08)";
    ctx.fillRect(60, cardY, cardW, cardH);
    ctx.strokeStyle = "rgba(16, 185, 129, 0.35)";
    ctx.strokeRect(60, cardY, cardW, cardH);

    ctx.fillStyle = "#34d399";
    ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("▲ BULL CONVICTION THESIS", 80, cardY + 30);

    ctx.fillStyle = "#e2f7ed";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    wrapText(data.bullCase || "Momentum structure indicates upside favorability.", 80, cardY + 60, cardW - 40, 20);

    // Bear / Invalidation Box
    ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
    ctx.fillRect(width - 60 - cardW, cardY, cardW, cardH);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.35)";
    ctx.strokeRect(width - 60 - cardW, cardY, cardW, cardH);

    ctx.fillStyle = "#f87171";
    ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("▼ INVALIDATION & DOWNSIDE RISK", width - 60 - cardW + 20, cardY + 30);

    ctx.fillStyle = "#fae8e8";
    ctx.font = "14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    wrapText(data.invalidation || data.bearCase || "Key structural breach invalidates the setup.", width - 60 - cardW + 20, cardY + 60, cardW - 40, 20);

    // Footer Watermark
    ctx.fillStyle = "#496858";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText("Goriee AI Desk · Powered by Bitget Public Spot Protocol · Non-custodial Simulation Desk", 60, height - 42);

    ctx.fillStyle = "#496858";
    ctx.fillText(data.engine ? `Engine: ${data.engine}` : "Verified Client Artifact", width - 280, height - 42);
  }, [open, data]);

  if (!open || !data) return null;

  const handleCopyMarkdown = () => {
    const md = `### 🏛️ GORIEE AI DESK · STRATEGY BRIEF
**Asset:** ${data.symbol} | **Interval:** ${data.interval}
**Regime:** ${data.regime}
**Price:** $${data.price ? data.price.toLocaleString() : "n/a"} | **RSI (14):** ${data.rsi ?? "n/a"}
**Support:** $${data.support ?? "n/a"} | **Resistance:** $${data.resistance ?? "n/a"}

#### Executive Summary
${data.summary}

#### Bull Case
${data.bullCase || "n/a"}

#### Invalidation & Risk
${data.invalidation || data.bearCase || "n/a"}

*Generated via Goriee AI Desk · Bitget Public Spot Protocol*`;

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    });
  };

  const handleDownloadPng = () => {
    if (!canvasRef.current) return;
    setDownloading(true);
    const canvas = canvasRef.current;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `GORIEE_${data.symbol}_${data.interval}_card.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloading(false);
  };

  return (
    <div className="modal-backdrop strategy-card-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card strategy-card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="strategy-card-modal-header">
          <div>
            <h2>Institutional Strategy Snapshot Card</h2>
            <p>1200×675 high-DPI artifact for sharing, team review, and strategy documentation.</p>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="strategy-card-preview-wrap">
          <canvas ref={canvasRef} className="strategy-card-canvas" />
        </div>

        <div className="strategy-card-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={handleCopyMarkdown}
          >
            {copied ? "✓ Copied to Clipboard" : "📋 Copy Markdown"}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={handleDownloadPng}
            disabled={downloading}
          >
            {downloading ? "Generating…" : "🖼️ Download PNG Card"}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
