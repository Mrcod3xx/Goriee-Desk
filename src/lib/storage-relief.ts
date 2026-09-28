// Relative import with an explicit extension, matching the other lib modules
// exercised by `node --test` (see lib/backtest.ts). The `@/` alias is resolved
// by Next's bundler only, so using it here would keep this file untestable
// outside the app.
import { storageKeys } from "../components/desk-shared.ts";

/**
 * The quota pressure valve.
 *
 * When a write hits `QuotaExceededError`, something disposable has to go before
 * the write can succeed. The order below matters a lot: it goes from "nobody
 * will notice" to "the user loses something they might have wanted", and it
 * stops there.
 *
 * Deliberately **never** pruned, because losing them corrupts correctness rather
 * than just convenience:
 *
 * - `paper` — the ledger of fills. `paperCash()` in `lib/paper-accounting.ts`
 *   reduces over *every* fill to derive the cash balance, and realized P&L is
 *   computed the same way. Truncating it would silently change the account
 *   balance, which is far worse than failing to save a journal entry.
 * - `paperBrackets` — live take-profit / stop-loss state. Dropping a bracket
 *   removes a stop the user believes is protecting them.
 * - `paperAlerts`, `playbooks`, `watchlist` — user-created configuration that
 *   cannot be regenerated.
 * - `paperRisk`, `paperFee`, `autoRuleRunner`, `activePaperPlaybook` — tiny
 *   scalars; pruning them frees effectively nothing while changing behaviour.
 */

/** Each tier is dropped in order until a write succeeds or we run out. */
const DISPOSABLE_TIERS: ReadonlyArray<{ key: string; label: string }> = [
  // Drafts are transient input text the app re-saves on every keystroke anyway.
  { key: storageKeys.drafts, label: "unsaved drafts" },
  // Rule-runner audit log. Already capped at 15 entries; purely historical.
  { key: storageKeys.ruleRunnerLogs, label: "execution audit log" },
  // Copilot transcripts. The single largest disposable store: every session
  // keeps its full message history, including long AI responses.
  { key: storageKeys.copilotSessions, label: "copilot chat history" },
  // Saved research reports. Regenerable by re-running research, so this is the
  // last resort rather than an early one.
  { key: storageKeys.journal, label: "saved research reports" },
];

export type ReliefOutcome = { relieved: boolean; dropped: string[] };

/**
 * Drop disposable stores in priority order until at least `bytesNeeded` is free.
 *
 * Takes an explicit `Storage` so it can be exercised with a fake in tests. If
 * the browser will not even let us read remaining capacity, every tier is
 * dropped in order — a full clear of disposable data is the safe default when
 * we cannot measure how much we need.
 */
export function relieveStorageQuota(
  store: Storage | null,
  bytesNeeded = 0,
): ReliefOutcome {
  if (!store) return { relieved: false, dropped: [] };

  const dropped: string[] = [];
  let freed = 0;

  for (const tier of DISPOSABLE_TIERS) {
    let previous: string | null = null;
    try {
      previous = store.getItem(tier.key);
    } catch {
      previous = null;
    }

    if (previous === null) continue;

    try {
      store.removeItem(tier.key);
    } catch {
      // Cannot remove it; keep going, the next tier may still free enough.
      continue;
    }

    dropped.push(tier.label);
    freed += previous.length * 2; // UTF-16 code units, the common quota unit.

    if (bytesNeeded > 0 && freed >= bytesNeeded) break;
  }

  return { relieved: dropped.length > 0, dropped };
}

/** Human-readable summary of what was dropped, for the toast copy. */
export function describeDroppedStores(dropped: readonly string[]): string {
  if (dropped.length === 0) return "";
  if (dropped.length === 1) return dropped[0];
  return `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
}
