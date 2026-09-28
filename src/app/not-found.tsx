import Link from "next/link";
import { Icon } from "@/components/desk-icon";

/**
 * Shown for any unmatched route.
 *
 * The desk is a single-route app, so in practice this is reached by a typo, a
 * stale bookmark or a crawler — not by normal navigation. It renders inside the
 * root layout, which means `globals.css` is loaded and the design tokens below
 * resolve normally (unlike `global-error.tsx`, which has to inline everything).
 */
export default function NotFound() {
  return (
    <main className="desk-fatal-screen">
      <section className="desk-fatal-card">
        <span className="desk-fatal-icon desk-fatal-icon-quiet" aria-hidden="true">
          <Icon name="shield" size={22} />
        </span>
        <h1>This page isn&apos;t part of the desk</h1>
        <p>
          The trading desk lives at a single route. Everything else — research,
          paper trading, the replay studio and the rule engine — is a tab inside
          it.
        </p>
        <div className="desk-fatal-actions">
          <Link href="/" className="desk-fatal-primary desk-fatal-link">
            Open the desk
          </Link>
        </div>
      </section>
    </main>
  );
}
