"use client";

import { useEffect } from "react";
import { Icon } from "@/components/desk-icon";

/**
 * Route-level fallback for the whole desk.
 *
 * Next 16 passes `retry` (re-fetch and re-render the segment) rather than the
 * older `reset` (re-render without re-fetching). `retry` is the one we want: the
 * desk loads market data on mount, so a plain re-render would restore a broken
 * panel with stale props instead of giving it a clean start.
 *
 * This sits *inside* the root layout, so `globals.css` is already loaded and the
 * design tokens below resolve normally.
 */
export default function DeskError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[DeskError] Route error boundary caught:", error);
  }, [error]);

  return (
    <main className="desk-fatal-screen">
      <section className="desk-fatal-card" role="alert">
        <span className="desk-fatal-icon" aria-hidden="true">
          <Icon name="alert" size={22} />
        </span>
        <h1>The trading desk hit an unexpected error</h1>
        <p>
          Your paper account, saved research and playbooks live in this
          browser&apos;s local storage, so nothing has been lost. Reloading
          rebuilds the desk from what is already saved.
        </p>
        {error.digest ? (
          <code className="desk-fatal-code">Reference {error.digest}</code>
        ) : null}
        <div className="desk-fatal-actions">
          <button type="button" className="desk-fatal-primary" onClick={() => retry()}>
            Retry
          </button>
          <button
            type="button"
            className="desk-fatal-secondary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </section>
    </main>
  );
}
