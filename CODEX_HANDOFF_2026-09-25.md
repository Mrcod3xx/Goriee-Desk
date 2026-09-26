# Codex handoff: reliability improvements in progress

Date: September 25, 2026.

## Read this first

The user asked to implement five improvements: AI error recovery, backtest credibility, paper-trading realism, export/restore of history, and a connected Research → Backtest → Paper → Review workflow. Work began, but the user stopped this session to switch AIs because usage was low. **Do not treat this batch as fully finished or verified.**

Read `PROJECT_MEMORY.md` for the other agent's work and `AGENTS.md` for the Next.js instructions. This note supplements them; it does not replace their history.

Project root:

`C:\Users\Admin\Documents\Codex\2026-09-24\bitget-hackathon-q-a-chatgpt-conversation\outputs\goriee-ai-desk`

Commands: `npm run dev`, `npm run typecheck`. See `package.json` for current test commands. The browser previously used `http://127.0.0.1:3000/`; localhost has separate localStorage.

## Concurrent work detected

At handoff, source files and `PROJECT_MEMORY.md` had changed since my edits/typecheck. For example, `trading-desk.tsx` grew from roughly 4,100 to over 5,000 lines, the coverage panel was restyled, and `goriee.auto-rule-runner.v1` / `goriee.rule-runner-logs.v1` appeared. Another agent appears to be actively editing the same project. Preserve their changes and inspect the actual files before patching. Use function names, not line numbers, to find my changes.

## Changes written during this Codex session

### 1. AI recovery

- Added `src/lib/ai-errors.ts`: `AIRequestError`, provider retry-header parsing, and a response helper for timeout/error status metadata.
- Changed `src/lib/llm.ts` to raise structured HTTP 429 errors with a retry timestamp, using provider headers or a 60-second fallback. No automatic paid retries were added.
- Changed research/backtest routes to return structured failures rather than turning every error into a generic 502.
- Added `src/components/request-recovery.tsx`: retry countdown and explicit retry button.
- Wired retry controls into research and backtests, and a shared in-flight ref/cooldown guard into request functions in `trading-desk.tsx`.
- Saves question/strategy text to `goriee.drafts.v1` and restores them after reload. JSON/unreadable HTTP responses now leave the prompt available for retry.
- Removed the **call** to the permissive fallback strategy compiler on AI failure. That old fallback could guess periods or reinterpret unsupported prompts. Its function definition remains as unused code in `src/app/api/backtest/route.ts`; remove it after inspection.

### 2. Backtest evidence

- Backtest route now returns a `coverage` object: requested window, received candle range/count, expected completed candles, and missing bars inside the received range.
- Added a UI coverage report with history-gap and indicator-warmup information. Another agent has since restyled this panel.
- Reworded the old credibility scorecard to identify its rating as a heuristic, not statistical confidence or institutional certification.
- Retained the existing holdout, benchmarks, configurable fees/slippage/spread, Monte Carlo tools and math. These were already implemented by the other agent.

### 3. Paper accounting and brackets

- Added `src/lib/paper-accounting.ts` (`paperFillFee`, `paperCash`).
- Cash now subtracts fees on both buys and sells; realized P&L and the daily loss calculation subtract allocated entry fees and exit fees. Open positions carry `entryFees`; account unrealized P&L subtracts those paid entry fees. Position rows remain explicitly labeled gross.
- Buy sizing/Max reserves the estimated fee, and the order's displayed remaining cash includes the fee.
- Added a two-minute market-quote age check for manual paper orders.
- Added a per-symbol close lock with a ref to reduce duplicate closes from bracket effects; manual order placement is blocked while closes are in progress.
- Removed premature bracket success toasts that appeared before the asynchronous close finished. Close completion reports estimated net P&L.
- Added clear UI text: existing brackets check sampled quotes around every minute while the app is running, fill at a subsequently fetched price, can miss moves between polls, and do not execute while offline.
- Stop loss, take profit and trailing stop functionality existed before this session; I strengthened accounting and messaging around it.

### 4. Workspace backup/restore

- Added `src/lib/workspace-backup.ts`: versioned JSON snapshot, allowlisted storage keys, shape validation, duplicate-ID rejection, size limits, capture and restore with attempted rollback on write failure.
- Added `src/components/workspace-backup.tsx` and mounted it below Provider Settings.
- Export includes the original journal, paper fills/notes, watchlist, alerts, risk/fee settings, playbooks, active playbook, brackets and draft prompts. It excludes provider credentials.
- Import previews counts and requires an explicit **Replace workspace with this backup** click. Before writing, it downloads the previous workspace, restores the imported keys and reloads the page.
- Important: auto-rule-runner keys were added by another agent afterward and **are not yet included** in the backup schema. Reconcile the allowlist and validation with current types before claiming a complete backup. Strict validators may also reject newly added record fields.

### 5. Workflow context

- Added optional `researchRef` and `backtestRef` to playbooks, plus research context on backtest results.
- Added `paperFromBacktest()` and **Use tested strategy in Paper**. It creates a playbook from the compiled rule, saves a result snapshot, applies its paper fee assumption, and opens Paper Account.
- Paper buys prefer the active playbook's saved research/backtest references; those references flow into the existing Trade Review.
- Corrected a starter's unsupported 14-day window to 30 days and replaced a combined-indicator starter prompt with a supported EMA 10/30 crossover.
- Added CSS for recovery, backup, coverage and workflow controls, reusing the current desk styling.

## Verification actually performed by this session

- `npm run typecheck` completed successfully with zero errors after my final code patch at that time.
- No new automated tests were added or run. No production build or browser click-through was run for this batch.
- The other agent's test claims in `PROJECT_MEMORY.md` are their historical reports, not fresh validation of this batch or of the subsequently changed files. Run fresh checks after reconciling changes.
- I did not read/change `.env.local`, place paper orders, clear localStorage, execute live trades, deploy, or create commits in this batch.

## Remaining work / concrete review targets

1. **Reconcile concurrent edits first.** Inspect current source/types/notes, particularly the new automatic paper rule runner. Confirm every fill path saves fees and participates in accounting/locking.
2. **Fix research provenance timing:** `handleBacktestFromReport()` sets `seededResearchReport` and immediately calls `runBacktest()` in the same closure. The latter can see the previous report. Pass the research reference explicitly in the request override/snapshot rather than relying on freshly set React state. Check symbol AND interval/context before attaching it. Prevent late responses being labeled as newer form inputs.
3. **Finish recovery UX:** main submit buttons still use their older loading/disabled conditions while the handler silently guards cooldowns. Make cooldown and cross-request loading visible everywhere. Consider persisting provider cooldown across reload; only prompt text currently persists. Verify 429 seconds/date/epoch headers, timeout, empty text, invalid JSON, and successful retry without duplicate calls.
4. **Audit restore integrity:** reconcile new keys and optional fields; check duplicate IDs, chronology/overselling, dangling active-playbook/research references, schema version errors, storage quota failure, rollback failure and empty-workspace round trips. Existing code rejects an empty `data` backup on import. Snapshot writes are synchronous but are not a database transaction. Error text should not promise rollback succeeded if it failed. Avoid restore while automatic fills are running and clarify whether automation resumes afterward.
5. **Finish bracket safeguards:** check stale cached quotes, concurrent automatic/manual fills, multiple simultaneous positions, partial exits and full manual sells. A full manual sell may leave an old bracket for a later reopened position. Quote freshness is checked for manual orders but not yet timestamped separately for the bracket polling cache.
6. **Accounting tests:** test actual implementation functions for fee-aware cash, partial sells, weighted average entry fees, legacy fills without fee rates, daily loss guard, and equality of realized+unrealized P&L with equity minus starting cash. Changing the legacy fee assumption recalculates historical balances and may make old over-budget buys show negative cash; explain this rather than silently changing old fills.
7. **Backtest credibility:** remove the unused fallback compiler; verify coverage counts/window boundaries, warmup and missing-bar handling. No gaps within a truncated range does not mean 100% of the requested window was received. Check current wording added by other agents. The existing out-of-sample return ratio compares unequal duration periods and is not normalized stability/confidence.
8. **Workflow check:** Research → Backtest → save to Paper → record buy → close → Review must preserve the correct references, including after reload. Verify source notes remain understandable when the original journal item is missing.
9. **Validation:** run a fresh typecheck, focused tests against real source (some older unit tests reimplement formulas rather than import the code), then isolated browser checks. Do not insert test trades into the user's existing browser profile. Review mobile layout, focus and error states. Update README/project memory with the verified result.

## User's last requests

- User explicitly stopped implementation to log the work and move to another AI due to low usage. Finish from this handoff only when asked to continue.
- User then selected the `brag` skill. I read `C:\Users\Admin\.agents\skills\brag\SKILL.md`; it creates a 15–25 second Hyperframes launch video. I asked whether they wanted only the handoff or also a video now, because of the usage constraint. **No video, storyboard, assets or render were created.** If the user chooses video, follow the skill's references and gates; do not present unfinished app changes as verified features.

Suggested next-agent prompt:

> Read PROJECT_MEMORY.md, CODEX_HANDOFF_2026-09-25.md and AGENTS.md. Inspect the current files because another agent edited the same folder. Finish and verify the five reliability/workflow improvements listed in the handoff, preserving user data and the other agent's work. Keep credentials out of output and test with an isolated browser profile.
