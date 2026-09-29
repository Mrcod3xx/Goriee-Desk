# TODO — Refinement Plan (no new features)

> Created September 28, 2026. Execution order: **1 → 2 → 3 → 4 → 5** (verification baseline first so refactors can be proven safe).
>
> **Items 6–13 added September 28, 2026** from a full read-only code review. They are refinements to *existing* functionality only — no new features. Quick wins that are small and independent of the monolith split: **6, 7, 8, 11**. Items **9, 10, 12** interact with the split and are best sequenced *with* item 2 rather than before it.
>
> **Update (later Sept 28): item 6 is DONE** — crash-safety shipped first because it was the only gap that could blank the entire app mid-demo (see item 6 for what shipped and for corrections to the original findings).
>
> **Update (Sept 29): items 8, 9 and 10 are DONE** — AI rate limiting, connection awareness / staleness, and live-data resilience (typed errors, real backoff, `Retry-After`, consolidated request path). Remaining 🔴 quick win: **7** (shadowed `setInterval` — latent, no current misbehavior).

## 1. Run verification baseline suite ⬜
Establish a true green baseline BEFORE any refactoring (the Codex handoff batch was never fully validated after concurrent edits).
- [ ] `npm test` (unit, Monte Carlo, API — expect 104 tests, 103 pass, 1 skipped)
- [ ] `npm run test:e2e` (general + Strategy Copilot, 12 tests)
- [ ] `node --test test/trade-replay-e2e.test.mjs` (9 tests)
- [ ] `node test/check-console-errors.mjs` (0 errors across all 9 tabs)
- [ ] `npm run typecheck` (0 errors — already confirmed clean Sept 28)

## 2. Split the `trading-desk.tsx` monolith (highest impact) 🔄 IN PROGRESS — phase 1 committed
**Status correction (Sept 28, 2026):** the split has been *started* and phase 1 is now committed (`ef9e6da`). `trading-desk.tsx` is down from 8,855 → **6,649 lines / 373 KB**, with six extracted modules now tracked in git: `desk-types.ts` (214), `desk-shared.ts` (132), `desk-icon.tsx` (50), `desk-charts.tsx` (141), `price-chart.tsx` (1,714), `research-panels.tsx` (401). Verified before commit: `tsc --noEmit` clean + 54 tests / 53 pass / 0 fail / 1 skipped. The remaining work below is phase 2 — the file still holds nearly all app state.

It still holds nearly all app state (live prices, WS ticks, backtests, paper account, copilot), so every state change — including each WS price flash — re-renders the whole tree; most likely source of input lag/jank.
- [x] Commit the in-progress extraction (see Housekeeping) and re-run the verification baseline against it
- [ ] Extract each remaining tab (Desk, Scanner, Research, Backtests, Replay, Playbooks, Paper, Journal, Settings) into memoized child components
- [ ] Isolate high-frequency state (ticker prices) from low-frequency state (settings, journals)
- [ ] Wrap hot paths in `memo` / `useMemo`
- [ ] Pure refactor, zero behavior change — verify with E2E + console-error suites after each extraction

## 3. Close out reliability handoff leftovers ⬜
- [ ] `compileDeterministicFallback` in `src/app/api/backtest/route.ts` still races the LLM with a 15s timeout; when the fallback wins, UI does not disclose that periods may have been *guessed* from the prompt — trust issue for a backtesting product
- [ ] Re-verify handoff items 3–5 (never validated after concurrent edits): recovery-cooldown visibility on buttons, restore-integrity edge cases, bracket stale-quote timestamping
- ✅ Research-provenance race (handoff item 2) already fixed — `researchRef` passed explicitly

## 4. Tame `globals.css` (13,524 lines / 325 KB) ⬜
- [ ] Audit for dead rules left over from the many restyle sprints
- [ ] Split into organized partials imported per feature (faster paints, safer future edits)

## 5. Test folder hygiene ⬜
~35 one-off `verify-*.mjs` / `inspect-*.mjs` scripts accumulated in `test/`.
- [ ] Consolidate the durable ones into npm scripts
- [ ] Archive the throwaways

## 6. Crash-safety: error boundaries + guarded storage 🔴 ✅ DONE — committed 2026-09-28
Was the highest-consequence gap for a public demo: any throw unmounted the whole React tree into a blank white page with no recovery UI, and ~30 `localStorage` writes could throw `QuotaExceededError` straight out of an event handler. All shipped, typecheck-clean, `next build` green, and browser-verified (route error → retry recovery; descendant crash → contained panel fallback with nav/watchlist/footer alive; tab switch clears a caught error via `resetKey`).
- [x] Add `src/app/error.tsx` (route-level error UI with a working reset) and `src/app/global-error.tsx` (root fallback)
- [x] Add `src/app/not-found.tsx` and `src/app/loading.tsx` so cold visits never hit a bare Next.js default
- [x] Add a reusable React `ErrorBoundary` around the desk shell so one broken panel doesn't kill the app
- [x] Wrap the unguarded `localStorage.setItem` calls in a single safe-write helper
- [x] Handle `QuotaExceededError` explicitly: surface a toast instead of throwing inside an event handler
- [x] Add a quota pressure valve with a never-prune guarantee for user-critical data

**What actually shipped (differs from the original notes — corrections recorded here so nobody "rediscovers" them):**
- `src/lib/safe-storage.ts` — `safeWrite` / `safeWriteJson` / `safeRemove` never throw; `isQuotaError` matches all four browser spellings; per-reason throttled failure notifications (4s) via `subscribeToStorageFailures`; optional synchronous `registerQuotaRelief` handler with one automatic retry. 24 tests in `test/safe-storage.test.mjs` (registered in `test`, `test:unit`, `test:all`).
- `src/lib/storage-relief.ts` — quota valve drops only disposable tiers in order: drafts → rule-runner audit log → copilot history → saved research reports. **The paper ledger, brackets, alerts, playbooks, watchlist and scalar settings are never pruned:** `paperCash()` folds over *every* fill, so truncating the ledger would silently change the balance, and dropping brackets would remove a stop the user believes is protecting them. Test #19 locks this guarantee in.
- **Count correction:** it was **30 unguarded write sites + 4 remove sites, all in `trading-desk.tsx`** (not "~30 incl. `strategy-copilot.tsx:194`" — that one was already wrapped in try/catch; it still uses raw `localStorage` and could optionally migrate for consistency). Zero raw `localStorage.setItem`/`removeItem` calls remain in `trading-desk.tsx`.
- **Growth correction:** journal (30), playbooks (30), rule-runner logs (15) and watchlist (50) were *already* capped. The genuinely uncapped stores are `paperTrades` (must NOT be capped — see ledger note above), `paperAlerts`, and copilot session message arrays.
- `ErrorBoundary` wraps the whole view-switch region once (`resetKey={view}`), not per-tab: views are mutually exclusive so one boundary isolates a crash exactly as well as nine, with a far smaller diff.
- Toast messages from storage failures are deferred with `setTimeout(…, 0)` because two `safeWriteJson` calls live inside `setState` updaters (trailing-stop peak ~`:761`, bracket delete ~`:1216`) — a synchronous `setToastMessage` there would be an illegal render-phase update. The in-updater writes were deliberately *not* moved: `safeWriteJson` never throws, so the crash hazard is gone, and the residual impurity is self-healing.
- `error.tsx` uses Next 16's `retry` prop (not the deprecated-in-docs `reset`); `global-error.tsx` hard-codes its palette because global styles don't reach it.
- New CSS lives at the end of `globals.css` under the `.desk-fatal-*` / `.desk-panel-error` / `.desk-boot-*` banners (reuses existing `fadeIn` / `skeleton-wave` / `spin` keyframes; the global `prefers-reduced-motion` rule at `:3689` covers them).


## 7. Rename the shadowed `setInterval` state setter 🔴 (latent bug) ⬜
`trading-desk.tsx:44` declares `const [interval, setInterval] = useState("1H")`, so the component-local `setInterval` is *not* `window.setInterval`. Of the 27 `setInterval(` call sites, 8 correctly write `window.setInterval(...)` for real timers (`:152`, `:263`, `:275`, `:404`, `:674`, `:705`, `:1514`, `:2052`) and the other **19 use the bare name as a state setter** (`:967`, `:978`, `:1145`, `:1826`, `:2273`, `:2463`, `:2765`, `:3208`, `:3820`, `:3841`, `:3862`, `:3883`, `:3968`, `:5268`, `:5655`, `:5668`, `:5681`, `:5997`, `:6453`). Any future `setInterval(fn, ms)` inside this component would silently call React's updater with `fn`.
- [ ] Rename to `chartInterval` / `setChartInterval` across `trading-desk.tsx` (mechanical, type-checked)
- [ ] Add an ESLint rule (or comment guard) so a future local `setInterval`/`setTimeout` shadow is flagged

## 8. Rate-limit the AI endpoints 🔴 (new exposure since going public) ✅ DONE — committed 2026-09-28
The NVIDIA key is now server-side on a public URL. `/api/research`, `/api/backtest` and `/api/copilot/chat` had **no server-side throttle** — the only cooldown was `goriee.ai-cooldown.v1` in localStorage, trivially bypassed. Shipped, typecheck-clean, `next build` green, 26 new unit tests, and the 429 contract proven live on dev **and** production at zero provider cost.
- [x] Add a per-IP (or per-session) rate limit in front of the three LLM routes; return `429` with `Retry-After` so the existing client-side 429 handling (`ai-errors.ts:9,15`) picks it up
- [x] Cap concurrent in-flight LLM requests globally
- [x] Cap `includeWebResearch` fan-out, which multiplies upstream cost per call
- [x] Note: input validation is already solid (symbol regex, interval whitelist, 600-char question slice) — this is about volume, not shape

**What actually shipped:**
- `src/lib/ai-rate-limit.ts` — zero-import module (so Node's type-stripping can unit-test it): fixed per-minute (6) + per-hour (40) windows plus a concurrency cap (4) per client key; in-memory `Map` store behind a `RateLimitStore` interface with `setRateLimitStore()` as the Redis swap seam; `MAX_TRACKED_KEYS = 10_000` prune so the Map can't grow unbounded; env overrides `AI_RATE_LIMIT_PER_MINUTE/_PER_HOUR/_CONCURRENCY` and `AI_RATE_LIMIT_DISABLED=1` (read per call, junk falls back to defaults); `clientKeyFromHeaders()` parses `x-forwarded-for` → `x-real-ip` → `"local"` (Next 16 has no `request.ip`).
- `src/lib/ai-limit-response.ts` — `guardAiRequest(headers, cost)` returns either `{ allowed, release, remaining }` or a ready-made `429` `NextResponse` with `Retry-After` and the body `{ error, retryAt }` the existing client chain already understands.
- Wiring: guards sit **after input validation** on all three routes (invalid input never spends budget) and release in `finally` — including every stream-exit path in `/api/copilot/chat` (stream `finally`, `cancel()`, early error returns); release is idempotent. `includeWebResearch` costs 2 against the minute budget.
- Denial copy deliberately avoids the strings "429"/"rate limit" and starts with "The desk is …" so `researchErrorMessage` in `desk-shared.ts` passes it through untouched (new first-line guard) instead of rewriting it into provider-error copy.
- `test/rate-limit.test.mjs` — 26 tests (budget windows, lockout non-extension, concurrency slots, header parsing, env parsing, store seam, message guard), registered in `test`, `test:unit`, `test:all`.
- **Verified live:** six cheap post-guard 400s exhaust `perMinute: 6`; the 7th request → `429` + `Retry-After` + identical `retryAt` on all three routes (guard fires before any provider contact). Same drill repeated against production after deploy.
- **Documented limitation:** the counter is per server instance. Fine on dev and on Vercel's single bundled lambda today; a multi-instance/multi-region topology needs the Redis seam (`setRateLimitStore`).
- `request-recovery.tsx` copy corrected: the countdown line no longer claims "the provider may still have a daily quota" (wrong when our own limiter is the source) — now "Pacing protects the shared AI budget."


## 9. Pause polling when hidden + enforce quote staleness 🟠 ✅ DONE (Sept 29)
**Why this was first:** the only open item where the app was *silently doing the wrong thing for users today* — unbounded loops hammered Bitget + Vercel from every parked tab (a real path to Bitget 429s that degrade the *visible* product), a genuine correctness bug fired alerts on quotes of unbounded age and permanently stamped `triggeredAt`, and the status UI could not tell "Bitget's WS is down" from "you have no internet".

**What actually shipped:**
- **New `src/lib/live-status.ts`** (zero-import, so Node's type stripping can test it directly): `MAX_QUOTE_AGE_MS`, `quoteAgeMs` (missing/future → `Infinity`, never `NaN`), `isQuoteActionable`, `describeQuoteAge`, `resolveDataFeedState` (offline > stalled > live > polling), `dataFeedPresentation` (label/colour/dot/banner/ARIA-role per state), `shouldPoll` (visibility only, deliberately not `navigator.onLine`), `isAlertTriggered`, plus reconnect backoff `nextReconnectDelayMs` / `shouldAttemptReconnect`.
- **All *five* network loops gated on `shouldPoll`** — the three 60s loops (market, quotes, scanner), the 3s orderbook recursion, **and the 45s automated rule-runner** that neither the original TODO nor the Sept 28 scope correction mentioned (it fetches `/api/market` and can open/close positions, and background tabs are already browser-throttled to ~1/min after 5 min hidden, so it was silently unreliable). Every gate re-arms via a `resumeToken` that bumps on the `online` event.
- **The alert correctness bug is fixed:** the alert-hit effect now routes through `isAlertTriggered`, which rejects quotes older than `MAX_QUOTE_AGE_MS`. Named repro captured in `test/live-status.test.mjs`.
- **All inline `120_000` literals eliminated** — bracket effect, `placePaperOrder`, and the stale badge now share `isQuoteActionable` / `MAX_QUOTE_AGE_MS` with the alert path, so all four can't drift.
- **Four-state status badge** (`ws-connected` / `ws-fallback` / `ws-stalled` / `ws-offline`) + an **offline banner** (outside the `ErrorBoundary`, with a "Retry now" button) + an honest 3-state rule-runner pill (Active / Suspended / Paused). Staleness reads **raw `market.asOf`**, not `effectiveMarket.asOf` (replay's clock is a historical candle close → would pin "Data Stalled" forever).
- **New `src/components/use-live-status.ts`** — `useDocumentVisibility`, `useOnlineStatus`, `useConnectionStatus`, `useOnlineResumeToken` (bumps only on online false→true, never on mount).
- **CSS** appended under a `FEATURE: Connection awareness` banner in `globals.css` (stalled/offline colours, amber+red pulse dots, offline banner, suspended pill, paused orderbook dot). Global reduced-motion rule already covers the new animations.
- **Tests:** `test/live-status.test.mjs` — 53 tests across 10 suites, registered in `test` / `test:unit` / `test:all`. Full suite 157 tests / 156 pass / 1 skipped / 0 fail; typecheck clean; production build green.

## 10. Harden live-data resilience 🟠 ✅ DONE (Sept 29)
**Why this was first:** the only remaining open item where the app was *actively doing the wrong thing for every user today*. Retrying a 429 after a fixed 300 ms — against a rate-limit window measured in seconds — burned both retries and *added* load, amplifying the very 429s that blank the scanner, watchlist and order book. Every failure then collapsed into an indistinguishable `502` with Bitget's own `Retry-After` thrown away, and `"connecting"` / `"offline"` rendered identically, so the status badge shipped in item 9 could not be honest about the socket.

The WebSocket half rode in with item 9 because it is the *same UI surface* — the badge can't be honest about the feed while the socket layer flickers and hammers. **Shipped then:**
- ✅ **Exponential backoff + equal jitter + attempt cap** in `bitget-ws.ts` `scheduleReconnect()` (~1,2,4,8,16,30,30,30s ≈ 2 min, then hands over to REST polling). `onopen` resets the attempt counter; reconnect suspends while the tab is hidden; re-arms on `visibilitychange` + `online`.
- ✅ **Status flicker fixed:** `onerror` no longer touches status (the spec fires `onclose` after every `onerror`, so the old `onerror`→`"fallback"` then `onclose`→`"offline"` flip was the badge flickering on every retry).

**Shipped now:**
- [x] Collapse the 4-state `WsConnectionStatus` union (`bitget-ws.ts:15`) into what the UI can actually render — `"connecting"` and `"offline"` are both displayed identically as "REST Polling"
- [x] `bitget.ts:61-63` retries 429s after a fixed 300ms × 2 — honor the `Retry-After` header and back off longer; real rate-limit windows exceed 300ms so the retry usually just fails again
- [x] Replace the brittle `String(error).includes("429")` check at `bitget.ts:76` with a typed error

**What actually shipped:**
- **New `src/lib/bitget-http.ts`** — the single Bitget request path, deliberately zero-import (same seam as `ai-rate-limit.ts` / `live-status.ts`) so Node's type stripping can unit-test it with an injectable `fetchImpl` / `sleep` / `now` / `random`. Exponential backoff with **equal jitter** (1s base, 5s cap), `MAX_TOTAL_RETRY_WAIT_MS = 8s` total-wait budget, and `parseRetryAfterMs` supporting both delta-seconds and HTTP-date (clamped, never negative).
- **Typed errors:** `BitgetHttpError` (carries the *real* upstream status — 400/500/503 — instead of flattening everything to 502; timeouts/aborts map to 504) and `BitgetRateLimitError` (429, carries `retryAfterMs` / `retryAt` / `attempts`). The rate-limit error is **deliberately not** a subclass of `BitgetHttpError`, so an `instanceof BitgetHttpError` catch-all can never swallow the throttle branch; `isBitgetRateLimitError` also matches by `name` for cross-realm copies.
- **New `src/lib/bitget-response.ts`** — owns the HTTP shape (imports `next/server`, mirroring the `ai-rate-limit` ↔ `ai-limit-response` precedent): a throttle becomes a real `429` + `Retry-After` + `{ rateLimited, retryAt, retryAfterSeconds }` body instead of a generic 502.
- **Four fetches that bypassed every retry/timeout rule are now consolidated** onto that path: `getSpotScanMarkets`'s inline instruments call, `orderbook.ts:getSpotOrderBook` (which previously had **no retry at all**), `/api/tickers`, and `/api/tokens`.
- **`ai-errors.ts` is now rate-limit aware** — a Bitget throttle surfacing out of `/api/research` or `/api/backtest` (which fetch candles before calling the model) now reports 429 + `retryAt` rather than being rewritten into provider-error copy.
- **`WsConnectionStatus` collapsed 4 → 2** (`"connected" | "polling"`); the hook now returns `{ status, connected }`. Safe because no consumer ever distinguished the three non-connected states and all reconnect bookkeeping lives in refs that never read the value. `trading-desk.tsx` updated at its three call sites; data health remains `resolveDataFeedState`'s job.
- **Tests:** `test/bitget-http.test.mjs` — 56 tests across 5 suites, fully offline, registered in `test` / `test:unit` / `test:all`. Includes regression guards for the two specific old bugs: *"does not double-charge one 429 as two attempts"* (the string-match re-threw its own message into the retry catch) and *"does not retry on a message that merely contains the digits 429"*.
- **Verified:** `tsc --noEmit` clean; unit suite 210/210 pass; `api.test.mjs` 10 pass / 0 fail / 1 skipped (unchanged). `test` script total now **221 tests / 220 pass / 0 fail / 1 skipped** (was 165/164/1).

## 11. Accessibility + UX consistency 🟢 ⬜
There is already one good shared effect at `trading-desk.tsx:851-871` that handles Escape-close, body scroll-lock, and focus restore (`previouslyFocused?.focus()`) — but it only covers `selectedJournalItem`, `orderOpen` and `pickerOpen`.
- [ ] **No modal traps Tab focus.** All five declare `aria-modal="true"` yet none constrain focus, so keyboard users can Tab into the page *behind* the backdrop. Add a real focus trap to the shared effect.
- [ ] Extend Escape-close + scroll-lock + focus-restore to the two modals the effect misses: bracket-edit (`:6246`) and the mobile more-sheet (`:6504`)
- [ ] Extract all of it into a reusable `<Modal>` primitive — this also removes duplicated `onMouseDown` backdrop-dismiss logic (`:6025`, `:6246`, `:6365`, `:6383`)
- [ ] `research-panels.tsx:67` uses a native blocking `alert()` while a real toast system exists (`trading-desk.tsx:6384-6385`, driven by `toastMessage` / `setToastMessage` with 36 call sites) — switch to the toast
- [ ] Same line swallows clipboard failure via `.catch(() => {})` — a failed copy gives no feedback at all; show an error toast
- [ ] Add real error surfacing for the silent catches at `price-chart.tsx:659` and `:700`

## 12. De-duplicate UI blocks (feeds directly into item 2) 🟢 ⬜
- [ ] The bracket TP/SL/trail fields are duplicated near-verbatim (`:6168-6197` inline using `takeProfitPct`, vs `:6264-6293` in the edit modal using `bracketModalTp`) with duplicated validation and duplicated storage writes (`:6319`, `:6352`) — extract `<BracketFields value onChange>`
- [ ] The `15m / 1H / 4H / 1D` picker is hand-rolled in 6 distinct places — 3 `<select>`s (`:2463`, `:2765`, `:3208`) and 3 button groups (`:3820`/`:3841`/`:3862`/`:3883`, `:3968`, `:5655`/`:5668`/`:5681`) — extract `<IntervalPicker>`
- [ ] Remove the single `as any` at `price-chart.tsx:688` (touch-event compat) with a proper union type — it's the only type escape in `src/**`

## 13. Share metadata + server-side caching 🟢 ⬜ (metadata half DONE — committed 2026-09-28; caching half open)
- [x] `layout.tsx` has only `title` + `description` — add `openGraph`, `twitter:card`, an OG image, `metadataBase` and `themeColor`. Posting the live link to Discord/X/LinkedIn currently renders as a bare URL with no preview. Cheapest high-visibility win for judging.
  - **Shipped:** `src/app/layout.tsx` now exports full `metadata` (`metadataBase`, `openGraph`, `twitter`, `robots`) plus a separate `export const viewport: Viewport = { themeColor: "#f2f5f2" }` (Next 14+ deprecated `themeColor` inside `metadata`). `src/app/opengraph-image.tsx` (file-convention Route Handler) renders a 1200×630 PNG via `ImageResponse` from `next/og`; twitter inherits the OG image automatically (no `twitter-image` file needed — proven in `next/dist/lib/metadata/resolve-metadata.js`). Verified in production: all `og:*`/`twitter:*`/`theme-color` tags present and the PNG serves 200.
  - **Satori (`next/og`) hard constraints learned the hard way** (each broke the render with `failed to pipe response`): (1) glyphs outside the bundled font (e.g. `✦`) trigger a dynamic-font fetch that 400s; (2) CSS `transform` is unsupported; (3) `<br/>` is unsupported — use stacked divs. Stick to plain shapes, text and flexbox.
- [ ] `next.config.ts` is literally `{}` and every Bitget call goes through `bitgetRequest` with `cache: "no-store"` (`bitget-http.ts`) — every visitor independently hammers Bitget for the same slowly-changing scanner/tickers/tokens data. Add a short TTL cache or `revalidate` on `/api/scanner`, `/api/tickers` and `/api/tokens` to cut both Bitget 429s and Vercel invocations. **Now much cheaper to do:** item 10 consolidated all of them onto one request path, so a TTL cache can live in one place (`bitgetRequest`) instead of five. Watch the `asOf` semantics — `live-status.ts` staleness depends on them being real quote times, not cache-hit times.

## Housekeeping ✅ DONE — was URGENT, committed 2026-09-28
The in-progress monolith split and the timeout work were sitting uncommitted while production had already been deployed from that tree, so git did not match the live site. All committed and pushed now.
- [x] **Modified (7):** `.gitignore`, `PROJECT_MEMORY.md`, `src/app/api/backtest/route.ts`, `src/app/api/copilot/chat/route.ts`, `src/app/api/research/route.ts`, `src/components/trading-desk.tsx`, `src/lib/llm.ts`
- [x] **Untracked (7):** `TODO.md`, `src/components/desk-charts.tsx`, `desk-icon.tsx`, `desk-shared.ts`, `desk-types.ts`, `price-chart.tsx`, `research-panels.tsx`
- [x] Committed in three logical commits: (a) `a4d87fd` timeout/deploy = 3 API routes + `src/lib/llm.ts` + `.gitignore`; (b) `ef9e6da` monolith split = 6 new components + `trading-desk.tsx`; (c) `6f0010a` docs = `TODO.md` + `PROJECT_MEMORY.md`
- [x] **Safety gate before committing the split:** `tsc --noEmit` clean, and the suite passed at **54 tests / 53 pass / 0 fail / 1 skipped** (the skip is the opt-in live-AI test)
- [x] Fix doc drift: the Stack line said "Next.js 15 (App Router, Turbopack)" but the project runs Next.js 16.3.6 — corrected
- [x] Backup branches pushed: `backup/2026-09-28` → `4fcb674` (pre-split) and `backup/2026-09-28-post-split` → `6f0010a` (current)
- [x] **Redeployed so the timeout fix is actually live:** `dpl_87KVXV7cAj3dgvwqeyaAQpvLY5S5`, Ready 18:56 +0800, aliased to https://goriee-ai-desk.vercel.app. The earlier deploy `dpl_32CfrN8v3eEPV9jzzV9NPSafEphU` (16:53) shipped *before* `llm.ts`/the routes were edited (17:01), so it did **not** contain `maxDuration = 300` — earlier notes claiming it did were wrong and are corrected in PROJECT_MEMORY §22/§25.
- [ ] Still open: the GitHub repo `Mrcod3xx/Goriee-Desk` is not reachable from the `goriee` Vercel account, so deploys stay manual (`vercel deploy --prod --yes`) — git now matches prod, but there is still no CI/auto-deploy
- [ ] Still open: the 300s ceiling is **not yet verified in production**. The post-deploy smoke test returned in 2.3s, which never approaches the limit. Confirming it needs a genuinely long reasoning call. Note all routes bundle into one lambda (fluid compute), so per-route `maxDuration` can't be read from the deployments API.
