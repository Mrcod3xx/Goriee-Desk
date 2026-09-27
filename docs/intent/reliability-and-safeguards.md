# Statement of Intent: End-to-End Reliability & Safeguards Release

- **Outcome:** Comprehensive reliability and safeguards release addressing all remaining handoff items: bracket lifecycle & stale quote protection, persistent AI cooldown UI across all submit buttons, and atomic workspace restore with storage quota safeguards.
- **User:** Quantitative crypto traders relying on Goriee AI Desk for paper trading, strategy replay, backtesting, and AI research briefs.
- **Why now:** Resolves the final open vulnerabilities from CODEX_HANDOFF_2026-09-25.md and PROJECT_MEMORY.md (bracket leaks on reopened positions, unmonitored stale quotes >2m, silent cooldown failures on submit buttons, and localStorage quota failures on backup restore).
- **Success Criteria:**
  1. **Bracket Lifecycle & Freshness:** Ticker quotes track `asOf` timestamps; bracket checks pause if quotes are >120s old (displaying amber indicator `"Quotes stale >2m · Brackets paused"`); full manual and auto sells purge brackets; unbracketed buys purge orphan brackets.
  2. **Persistent Cooldown UX:** `aiRetryAt` is persisted in `localStorage` (`goriee.ai-cooldown.v1`); all AI action buttons (Desk, Research, Backtests, Copilot) show active countdowns (e.g. `⏳ Cooldown (18s)`) and prevent redundant requests.
  3. **Atomic Restore & Quota Guard:** Workspace restore executes a pre-flight quota test before wiping existing data, halts active rule-runners during restore, accepts empty workspace backups cleanly, and provides honest rollback error handling.
  4. **Automated Test Harness:** Dedicated automated unit tests covering paper accounting, bracket lifecycle & staleness, and simulated quota rollback, verified via `npm test` and `npm run typecheck` (100% green).
- **Constraints:** Zero data loss or breaking format changes for existing user data in `localStorage`; preserve anti-slop design invariants; keep all tests self-contained.
- **Out of scope:** Real Bitget live trading execution with API keys, live WebSockets, and architectural decomposition of `trading-desk.tsx`.
