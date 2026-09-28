# TODO — Refinement Plan (no new features)

> Created September 28, 2026. Execution order: **1 → 2 → 3 → 4 → 5** (verification baseline first so refactors can be proven safe).
>
> **Items 6–13 added September 28, 2026** from a full read-only code review. They are refinements to *existing* functionality only — no new features. Quick wins that are small and independent of the monolith split: **6, 7, 8, 11**. Items **9, 10, 12** interact with the split and are best sequenced *with* item 2 rather than before it.

## 1. Run verification baseline suite ⬜
Establish a true green baseline BEFORE any refactoring (the Codex handoff batch was never fully validated after concurrent edits).
- [ ] `npm test` (unit, Monte Carlo, API — expect 36 tests, 35 pass, 1 skipped)
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

## 6. Crash-safety: error boundaries + guarded storage 🔴 (do first) ⬜
Highest-consequence gap for a public demo — any throw currently unmounts the whole React tree into a blank white page with no recovery UI.
- [ ] Add `src/app/error.tsx` (route-level error UI with a working reset) and `src/app/global-error.tsx` (root fallback)
- [ ] Add `src/app/not-found.tsx` and `src/app/loading.tsx` so cold visits never hit a bare Next.js default
- [ ] Add a reusable React `ErrorBoundary` around the desk shell so one broken panel doesn't kill the app
- [ ] Wrap the ~30 unguarded `localStorage.setItem` calls in `trading-desk.tsx` (`:721`, `:756`, `:881`, `:896`, `:918`, `:927`, `:949`, `:958`, `:980`, `:1062`, `:1174`, `:1177`, `:1211`, `:1259`, `:1267`, `:1274`, `:1346`, `:1353`, `:1373`, `:1458`, `:1463`, `:1494`, `:2303`, `:2338`, `:5075`, `:5114`, `:5315`, `:5457`, `:6319`, `:6352`) in a single safe-write helper — only `:144`, `:322` and `workspace-backup.tsx:32` are protected today
- [ ] Handle `QuotaExceededError` explicitly: surface a toast telling the user local journal/paper/replay storage is full, instead of throwing inside an event handler
- [ ] Add a quota pressure valve — journal/paper/replay logs grow unbounded in localStorage with no pruning or cap

## 7. Rename the shadowed `setInterval` state setter 🔴 (latent bug) ⬜
`trading-desk.tsx:44` declares `const [interval, setInterval] = useState("1H")`, so the component-local `setInterval` is *not* `window.setInterval`. Of the 27 `setInterval(` call sites, 8 correctly write `window.setInterval(...)` for real timers (`:152`, `:263`, `:275`, `:404`, `:674`, `:705`, `:1514`, `:2052`) and the other **19 use the bare name as a state setter** (`:967`, `:978`, `:1145`, `:1826`, `:2273`, `:2463`, `:2765`, `:3208`, `:3820`, `:3841`, `:3862`, `:3883`, `:3968`, `:5268`, `:5655`, `:5668`, `:5681`, `:5997`, `:6453`). Any future `setInterval(fn, ms)` inside this component would silently call React's updater with `fn`.
- [ ] Rename to `chartInterval` / `setChartInterval` across `trading-desk.tsx` (mechanical, type-checked)
- [ ] Add an ESLint rule (or comment guard) so a future local `setInterval`/`setTimeout` shadow is flagged

## 8. Rate-limit the AI endpoints 🔴 (new exposure since going public) ⬜
The NVIDIA key is now server-side on a public URL. `/api/research`, `/api/backtest` and `/api/copilot/chat` have **no server-side throttle** — the only cooldown is `goriee.ai-cooldown.v1` in localStorage, which is trivially bypassed. Each request can also occupy a function for up to 300s of billable duration against Hobby concurrency limits.
- [ ] Add a per-IP (or per-session) rate limit in front of the three LLM routes; return `429` with `Retry-After` so the existing client-side 429 handling (`ai-errors.ts:9,15`) picks it up
- [ ] Cap concurrent in-flight LLM requests globally
- [ ] Cap `includeWebResearch` fan-out, which multiplies upstream cost per call
- [ ] Note: input validation is already solid (symbol regex, interval whitelist, 600-char question slice) — this is about volume, not shape

## 9. Pause polling when hidden + enforce quote staleness 🟠 ⬜
Zero `navigator.onLine` / `visibilitychange` / `document.hidden` usage anywhere in `src/**`. Three independent 60s loops (`trading-desk.tsx:404`, `:674`, `:705`) plus the 3s orderbook recursion (`orderbook-panel.tsx:40`) keep firing in background tabs.
- [ ] Gate polling on `document.hidden` and resume/refresh on `visibilitychange`
- [ ] Listen for `online` / `offline` and surface a connection banner. Today the only status UI is the WS badge at `trading-desk.tsx:2497-2501`, which is **binary** — it renders only `ws-connected` vs `ws-fallback` and cannot distinguish "Bitget WS is down" from "you have no internet".
- [ ] Quotes already carry `asOf` timestamps (`:663-667`) but nothing consumes them for freshness — gate paper fills (`:721`), bracket triggers (`:730+`) and alert hits (`:712`) on a max-age check
- [ ] Surface a visible "quote stale" indicator; same root as handoff item 5 (bracket stale-quote timestamping) in item 3 above

## 10. Harden live-data resilience 🟠 ⬜
- [ ] `bitget-ws.ts:147-149` reconnects on a flat 3000ms forever — add exponential backoff, jitter, and a max-attempts cap so a prolonged Bitget outage doesn't turn into an infinite reconnect hammer
- [ ] Fix the status flicker: `onerror` sets `"fallback"` (`:140`, `:153`) while `onclose` sets `"offline"` (`:145`) then reconnects, so the badge can flip between states
- [ ] Collapse the 4-state `WsConnectionStatus` union (`bitget-ws.ts:15`) into what the UI can actually render — `"connecting"` and `"offline"` are both displayed identically as "REST Polling"
- [ ] `bitget.ts:61-63` retries 429s after a fixed 300ms × 2 — honor the `Retry-After` header and back off longer; real rate-limit windows exceed 300ms so the retry usually just fails again
- [ ] Replace the brittle `String(error).includes("429")` check at `bitget.ts:76` with a typed error

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

## 13. Share metadata + server-side caching 🟢 ⬜
- [ ] `layout.tsx` has only `title` + `description` — add `openGraph`, `twitter:card`, an OG image, `metadataBase` and `themeColor`. Posting the live link to Discord/X/LinkedIn currently renders as a bare URL with no preview. Cheapest high-visibility win for judging.
- [ ] `next.config.ts` is literally `{}` and `bitgetGet` uses `cache: "no-store"` (`bitget.ts:56`, `:143`) — every visitor independently hammers Bitget for the same slowly-changing scanner/tickers/tokens data. Add a short TTL cache or `revalidate` on `/api/scanner`, `/api/tickers` and `/api/tokens` to cut both Bitget 429s and Vercel invocations.

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
