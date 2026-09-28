"use client";

/**
 * Last-resort fallback for a failure in the root layout itself.
 *
 * Two constraints from the Next 16 docs drive how this is written:
 *
 * 1. It replaces the root layout, so it must render its own `<html>` and
 *    `<body>`. Omitting them produces a hydration failure rather than a fallback.
 * 2. Because it bypasses the layout, `globals.css` is **not** loaded and an
 *    app-level theme never reaches it. Every style here is therefore inline, and
 *    the palette is hard-coded from the design tokens instead of referencing
 *    `var(--jade)` — those variables do not exist in this document.
 *
 * `metadata` is not supported in an error boundary, hence the React `<title>`.
 */

const palette = {
  page: "#f2f5f2",
  surface: "#ffffff",
  ink: "#172b24",
  muted: "#4e6055",
  subtle: "#75867c",
  line: "#e1e8e3",
  jade: "#0c9a6b",
  jadeDark: "#087b56",
  red: "#b64c50",
  redSoft: "#fbefef",
};

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Goriee AI Desk — something went wrong</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: palette.page,
          color: palette.ink,
          fontFamily:
            '"Aptos", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: "15px",
          lineHeight: 1.55,
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "520px",
            background: palette.surface,
            border: `1px solid ${palette.line}`,
            borderRadius: "17px",
            padding: "28px",
            boxShadow: "0 18px 48px -24px rgba(16, 36, 26, 0.35)",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "44px",
              height: "44px",
              marginBottom: "16px",
              borderRadius: "50%",
              background: palette.redSoft,
              color: palette.red,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>

          <h1
            style={{
              margin: "0 0 10px",
              fontSize: "20px",
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
            }}
          >
            Goriee AI Desk stopped responding
          </h1>

          <p style={{ margin: "0 0 20px", color: palette.muted, fontSize: "14px" }}>
            The desk could not start. Your paper account and saved research are
            stored in this browser and are not affected — reloading will rebuild
            the desk from what is already saved.
          </p>

          {error.digest ? (
            <code
              style={{
                display: "inline-block",
                marginBottom: "18px",
                padding: "4px 10px",
                borderRadius: "7px",
                background: palette.page,
                border: `1px solid ${palette.line}`,
                color: palette.subtle,
                fontSize: "12px",
              }}
            >
              Reference {error.digest}
            </code>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: "10px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => retry()}
              style={{
                padding: "10px 20px",
                borderRadius: "9px",
                border: "none",
                background: palette.jade,
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onMouseOver={(event) => {
                event.currentTarget.style.background = palette.jadeDark;
              }}
              onMouseOut={(event) => {
                event.currentTarget.style.background = palette.jade;
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 20px",
                borderRadius: "9px",
                border: `1px solid ${palette.line}`,
                background: palette.surface,
                color: palette.ink,
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
