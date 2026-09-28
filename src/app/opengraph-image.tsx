import { ImageResponse } from "next/og";

/**
 * Generated social card for https://goriee-ai-desk.vercel.app.
 *
 * A file-convention Route Handler (see the Next 16 docs,
 * `opengraph-image and twitter-image`): Next renders this at build time,
 * caches it, and injects both `og:image` and `twitter:image` tags — the
 * twitter card inherits title/description/images from openGraph automatically,
 * so no `twitter-image.tsx` is needed.
 *
 * Everything here is static and deterministic (no request APIs, no randomness):
 * the route stays cacheable and prerendered. The palette is hard-coded from
 * the design tokens in `globals.css` `:root` because globals.css is not loaded
 * into this render context — the same reason `global-error.tsx` hard-codes it.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Goriee AI Desk — a Bitget-powered market research desk";

const palette = {
  page: "#f2f5f2",
  surface: "#ffffff",
  ink: "#172b24",
  muted: "#4e6055",
  subtle: "#75867c",
  line: "#e1e8e3",
  jade: "#0c9a6b",
  jadeDark: "#087b56",
  jadeSoft: "#e3f4ec",
  forest: "#143b30",
};

// A fixed, hand-picked uptrend-with-drawdown candle series. Deliberately not
// random: the card must be byte-identical on every render so it stays cached.
const candles: Array<{ open: number; close: number; low: number; high: number }> = [
  { open: 113, close: 103, low: 118, high: 99 },
  { open: 103, close: 108, low: 113, high: 99 },
  { open: 108, close: 96, low: 112, high: 91 },
  { open: 96, close: 85, low: 99, high: 80 },
  { open: 85, close: 91, low: 96, high: 80 },
  { open: 91, close: 77, low: 94, high: 72 },
  { open: 77, close: 66, low: 80, high: 61 },
  { open: 66, close: 72, low: 77, high: 61 },
  { open: 72, close: 56, low: 75, high: 51 },
  { open: 56, close: 44, low: 59, high: 39 },
  { open: 44, close: 50, low: 55, high: 39 },
  { open: 50, close: 33, low: 53, high: 28 },
];

const CHART_H = 150;
const BAR_W = 26;
const GAP = 18;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: palette.page,
          padding: "48px 72px",
          fontFamily: "sans-serif",
          color: palette.ink,
        }}
      >
        {/* Top bar: brand + live badge */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: palette.jade,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              G
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 0.5, color: palette.forest }}>
                Goriee AI Desk
              </div>
              <div style={{ fontSize: 18, color: palette.subtle }}>Bitget-powered research desk</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: `1px solid ${palette.line}`,
              background: palette.surface,
              borderRadius: 999,
              padding: "10px 20px",
              fontSize: 18,
              color: palette.muted,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 6, background: palette.jade }} />
            Live spot data
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: palette.jadeDark, letterSpacing: 2 }}>
            MARKET RESEARCH, WITH RECEIPTS
          </div>
          {/* Two stacked lines instead of <br/>: satori (next/og) does not support
              the br element and throws mid-stream, failing the whole response. */}
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2 }}>
            Ask the market a question.
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2 }}>
            Get an answer you can test.
          </div>
        </div>

        {/* Card: mock research + chart */}
        <div
          style={{
            display: "flex",
            border: `1px solid ${palette.line}`,
            borderRadius: 18,
            background: palette.surface,
            overflow: "hidden",
          }}
        >
          {/* Left: AI brief */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "28px 30px",
              width: 470,
              borderRight: `1px solid ${palette.line}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: palette.jadeSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Solid dot marker: Satori supports neither CSS `transform` nor
                    dingbat glyphs like ✦ (it would try to fetch a font and fail,
                    breaking the whole card), so the badge is a plain filled circle. */}
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: palette.jadeDark,
                  }}
                />
              </div>
              <div style={{ fontSize: 19, fontWeight: 700, color: palette.forest }}>AI research brief</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ height: 11, borderRadius: 6, background: palette.line, width: "95%" }} />
              <div style={{ height: 11, borderRadius: 6, background: palette.line, width: "82%" }} />
              <div style={{ height: 11, borderRadius: 6, background: palette.line, width: "90%" }} />
              <div style={{ height: 11, borderRadius: 6, background: palette.line, width: "60%" }} />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 2,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: palette.jadeDark, background: palette.jadeSoft, borderRadius: 8, padding: "6px 12px" }}>
                Bull case
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#b64c50", background: "#fbefef", borderRadius: 8, padding: "6px 12px" }}>
                Bear case
              </div>
            </div>
          </div>

          {/* Right: candle chart */}
          <div style={{ display: "flex", flexDirection: "column", padding: "28px 30px", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: palette.forest }}>BTCUSDT · 1H</div>
              <div style={{ fontSize: 17, color: palette.subtle }}>Backtest + paper trading</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: GAP, height: CHART_H }}>
              {candles.map((c, i) => {
                const up = c.close <= c.open; // lower y = higher price
                const color = up ? palette.jade : "#b64c50";
                const bodyTop = Math.min(c.open, c.close);
                const bodyH = Math.max(4, Math.abs(c.close - c.open));
                const wickTop = c.high;
                const wickH = Math.max(2, c.low - c.high);
                return (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      width: BAR_W,
                      height: CHART_H,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "center",
                    }}
                  >
                    {/* wick */}
                    <div
                      style={{
                        position: "absolute",
                        top: wickTop,
                        width: 3,
                        height: wickH,
                        background: color,
                        borderRadius: 2,
                      }}
                    />
                    {/* body */}
                    <div
                      style={{
                        position: "absolute",
                        top: bodyTop,
                        width: BAR_W,
                        height: bodyH,
                        background: color,
                        borderRadius: 4,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer chips */}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {["Multi-horizon confluence", "Monte Carlo risk", "Trade replay", "Paper account"].map((chip) => (
            <div
              key={chip}
              style={{
                fontSize: 18,
                color: palette.muted,
                border: `1px solid ${palette.line}`,
                background: palette.surface,
                borderRadius: 999,
                padding: "9px 18px",
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
