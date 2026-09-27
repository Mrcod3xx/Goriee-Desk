# Spec: Reliability & Safeguards Release (Sprint 20)

## Objective

Deliver the remaining reliability safeguards and integrity hardening identified in `CODEX_HANDOFF_2026-09-25.md` and `PROJECT_MEMORY.md`:
1. Prevent paper bracket leaks on re-opened positions and halt bracket evaluations when ticker quotes are stale (>120s old).
2. Persist AI rate-limit cooldowns across reloads and surface live countdowns on all submit buttons to eliminate silent click failures.
3. Guarantee atomic workspace restore with a pre-flight browser storage quota check and background runner pausing.
4. Establish a comprehensive, self-contained automated test suite verifying paper accounting, bracket lifecycle, and quota rollback behavior.

---

## Tech Stack & Runtime

- **Framework:** Next.js 15.1.0 (App Router), React 19, TypeScript 5.7.
- **Styling:** Vanilla CSS with custom tokens in `src/app/globals.css`.
- **Test Runner:** Native Node.js test runner (`node --test`), `node:assert/strict`.
- **Storage:** Browser `window.localStorage` with versioned snapshot schemas.

---

## Commands

- **Dev Server:** `npm run dev` (starts on `http://127.0.0.1:3000`)
- **Typecheck:** `npm run typecheck` (`npx tsc --noEmit`)
- **Unit & Math Tests:** `npm run test:unit`
- **Full Test Suite:** `npm test` (executes unit, API, quant, and backup tests)
- **E2E Tests:** `npm run test:e2e` (requires running dev server or auto-spawn)

---

## Project Structure & Target Files

```text
src/
├── app/
│   ├── api/
│   │   ├── tickers/route.ts        → Update to ensure per-quote asOf timestamp
│   │   └── backtest/route.ts       → Prune unused fallback code
│   └── globals.css                 → Add amber warning badges and cooldown button styles
├── components/
│   ├── trading-desk.tsx            → Bracket staleness guard, button cooldown UX, bracket pruning
│   ├── workspace-backup.tsx        → Restore pre-flight quota handling & auto-runner pausing
│   └── request-recovery.tsx        → Enhanced countdown readout
├── lib/
│   ├── paper-accounting.ts         → Math functions for fees, cash, and P&L
│   └── workspace-backup.ts         → Pre-flight quota test write and empty-backup tolerance
test/
├── bracket-lifecycle.test.mjs      → New test: bracket quote staleness, cleanup on manual/auto sell
├── paper-accounting.test.mjs       → New test: fee allocation, partial sells, equity equality
└── workspace-backup.test.mjs       → Update test: quota overflow simulation, empty workspace
docs/
├── intent/
│   └── reliability-and-safeguards.md
└── specs/
    └── SPEC-reliability-and-safeguards.md
```

---

## Detailed Module Specifications

### Module 1: Bracket Lifecycle & Stale Quote Guards (`bracket-lifecycle`)

#### 1.1 Quote Freshness Tracking
- **API Contract:** `/api/tickers` returns `Quote[]` where each quote includes:
  ```typescript
  type Quote = {
    symbol: string;
    price: number;
    change24h: number;
    asOf: number; // Unix epoch ms of ticker capture
  };
  ```
- **Desk Polling:** In `refreshQuotes`, if network fails, retain existing quotes but their `asOf` remains untouched.
- **Staleness Threshold:** A quote is considered stale if `Date.now() - quote.asOf > 120_000` (2 minutes).

#### 1.2 Bracket Pause & Visual Feedback
- In the `useEffect` bracket evaluation loop in `src/components/trading-desk.tsx`:
  - If any open position has an attached bracket and its quote is missing or stale (`Date.now() - quote.asOf > 120_000`), skip triggering `closePaperPosition`.
  - Display an amber status pill in the paper account position table:
    `<span className="bracket-stale-badge" title="Bitget quote is older than 2m. Bracket triggers paused until fresh quotes arrive.">● Quotes stale &gt;2m (Paused)</span>`

#### 1.3 Automatic Bracket Purge on Exit
- **Manual Sells (`placePaperOrder`):**
  - When recording a sell order where `quantity >= held - 1e-8` (full exit), immediately delete `paperBrackets[symbol]` from state and `localStorage`.
- **Auto Rule-Runner Sells (`runRuleEvaluation`):**
  - Calling `closePaperPosition` already deletes `paperBrackets[asset]`. Ensure audit logs confirm bracket removal.
- **New Buys (`placePaperOrder`):**
  - If a user opens a new buy order with `attachBracket === false`, verify and delete any legacy or orphan `paperBrackets[symbol]` to prevent inadvertent monitoring with outdated TP/SL levels.

---

### Module 2: Cooldown UX & Persistence (`cooldown-ux`)

#### 2.1 Storage Key & Hook
- New storage key: `storageKeys.aiCooldown = "goriee.ai-cooldown.v1"`.
- On mount: initialize `aiRetryAt` from `Number(safeRead(storageKeys.aiCooldown, 0))`.
- When set: update both `setAiRetryAt(timestamp)` and `window.localStorage.setItem(storageKeys.aiCooldown, String(timestamp))`.
- Timer: run a 1-second tick to recalculate remaining seconds `Math.max(0, Math.ceil((aiRetryAt - Date.now()) / 1000))`.

#### 2.2 Submit Button States & Labels
All primary AI action buttons must reflect rate-limit cooldown and in-flight state:
1. **"Ask the desk" Submit Button:**
   - If `requestBusy.current`: Disabled, text `Request in progress…`.
   - If `seconds > 0`: Disabled, text `⏳ Cooldown (${seconds}s)`.
   - Normal: `Build research brief →`.
2. **Research Tab Form Submit Button:**
   - Follows identical cooldown/busy disable state and countdown label.
3. **Backtest Strategy Builder Submit Button:**
   - If `requestBusy.current`: Disabled, text `Simulation in progress…`.
   - If `seconds > 0`: Disabled, text `⏳ Cooldown (${seconds}s)`.
   - Normal: `Run Backtest Simulation`.
4. **Strategy Copilot Send Button:**
   - If `seconds > 0`: Disabled with tooltip `Provider cooldown active (${seconds}s)`.

---

### Module 3: Workspace Restore Atomicity & Quota Safeguards (`restore-atomicity`)

#### 3.1 Pre-Flight Storage Quota Probing
- In `restoreWorkspace(storage, snapshot)` in `src/lib/workspace-backup.ts`:
  - Calculate total size of the imported payload.
  - Perform a probe write to `storage.setItem("__goriee_quota_probe__", JSON.stringify(validated.data))`.
  - Remove `__goriee_quota_probe__`.
  - Only after the probe succeeds, proceed to clear and write the actual keys.
  - If the probe throws `QuotaExceededError`, throw an explicit error: `"Browser storage quota exceeded. The backup is too large to restore in this browser."` before touching existing keys!

#### 3.2 Concurrency & Empty Backup Support
- **Empty Backups:** If `snapshot.data` is an empty object `{}`, allow it to restore an empty workspace cleanly.
- **Rule Runner Halting:** In `src/components/workspace-backup.tsx`, `handleImport()` sets `ruleRunnerActive` to `false` and writes `"false"` to `localStorage` before initiating restore.
- **Honest Rollback Reporting:** If an unexpected error occurs during key restoration, the error message clarifies:
  `"Restore failed. Your pre-restore workspace snapshot was automatically downloaded to your device."`

---

### Module 4: Paper Accounting & Test Harness (`accounting-and-tests`)

#### 4.1 Paper Accounting Test Suite (`test/paper-accounting.test.mjs`)
- Unit tests validating:
  - `paperFillFee(trade, feeBps)`: correct bps computation.
  - `paperCash(trades, startingCash, feeBps)`: correct cash deductions on both buys and sells.
  - Weighted average entry fees on multiple buys.
  - P&L and Cash accounting invariants:
    $$\text{Realized Net} + \text{Unrealized Net} = \text{Equity} - \text{Starting Cash}$$

#### 4.2 Bracket Lifecycle Test Suite (`test/bracket-lifecycle.test.mjs`)
- Unit tests validating:
  - Stale quote rejection: quotes $> 120\text{s}$ old do not trigger take-profit or stop-loss.
  - Fresh quote execution: quotes $\le 120\text{s}$ old trigger brackets as expected.
  - Bracket cleanup on full manual sells.
  - Orphan bracket purge on new unbracketed buys.

#### 4.3 Workspace Backup Test Suite (`test/workspace-backup.test.mjs`)
- Add tests validating:
  - Pre-flight quota probe rejection when quota is exceeded (simulated `setItem` failure).
  - Empty workspace backup `{ data: {} }` round-trip.

---

## Boundaries

- **Always:**
  - Run `npm test` and `npm run typecheck` before finishing changes.
  - Keep localStorage backward-compatible for existing user data.
  - Use accessible, anti-slop SVG icons and clean typography.
- **Ask first:**
  - Modifying external Bitget API endpoints or parameters.
  - Adding new third-party dependencies to `package.json`.
- **Never:**
  - Remove existing automated tests or assertions to force a pass.
  - Leave console errors or unhandled promise rejections.
  - Allow stale quotes to trigger automated order executions.

---

## Success Criteria

1. `npm test` passes with 100% green tests (zero failures, zero regressions).
2. `npx tsc --noEmit` exits with 0 TypeScript errors.
3. Placing a full manual sell completely cleans up `paperBrackets[symbol]`.
4. Opening an unbracketed position purges any preexisting orphan bracket.
5. Quotes older than 2 minutes are detected, and bracket evaluations are suspended with visual indicator.
6. Rate-limit 429 response sets a persistent cooldown in `localStorage` that disables all AI buttons with live countdowns across page reloads.
7. Workspace restore tests quota headroom before modifying data and halts active auto-runners.
