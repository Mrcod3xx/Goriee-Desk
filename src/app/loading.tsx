import { Icon } from "@/components/desk-icon";

/**
 * Instant loading state shown while the desk's client bundle streams in.
 *
 * `page.tsx` renders a single large client component, so this is the only thing
 * between a cold visit and the desk appearing. It is deliberately a static
 * server component with no animation logic — it is replaced the moment the real
 * tree mounts, so it only needs to say "we're here, it's loading" and match the
 * desk's chrome closely enough that the swap is not jarring.
 */
export default function Loading() {
  return (
    <main className="desk-boot" aria-busy="true" aria-live="polite">
      <div className="desk-boot-header">
        <span className="desk-boot-mark" aria-hidden="true">
          <Icon name="shield" size={18} />
        </span>
        <div className="desk-boot-title">
          <strong>Goriee AI Desk</strong>
          <small>Market research, with receipts</small>
        </div>
      </div>

      <div className="desk-boot-grid">
        <div className="desk-boot-panel desk-boot-panel-wide">
          <span className="desk-boot-label">Market overview</span>
          <span className="desk-boot-line" style={{ width: "82%" }} />
          <span className="desk-boot-line" style={{ width: "64%" }} />
          <span className="desk-boot-line" style={{ width: "73%" }} />
          <span className="desk-boot-block" />
        </div>
        <div className="desk-boot-panel">
          <span className="desk-boot-label">Research</span>
          <span className="desk-boot-line" style={{ width: "70%" }} />
          <span className="desk-boot-line" style={{ width: "90%" }} />
          <span className="desk-boot-line" style={{ width: "55%" }} />
        </div>
      </div>

      <p className="desk-boot-status">
        <span className="desk-boot-spinner" aria-hidden="true" />
        Loading live Bitget market data…
      </p>
    </main>
  );
}
