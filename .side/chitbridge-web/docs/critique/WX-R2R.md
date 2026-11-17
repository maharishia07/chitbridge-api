# Critique · WX-R2R (written before any code, 2026-10-13)

## (a) What the brief assumes, checked
- "serve the web the way e2e/serve-local or the local stack does" — FALSE here: `local-stack.sh` lives in C:/dev/toolset, not in a repo. What exists: `e2e/lib/walk.cjs serve()` (index.html + public/ on an OS port) and the api's `server.js:13` (PORT) with a CORS allowlist `server.js:57` (ALLOWED_ORIGINS env). The walk's `--real` mode spawns the api itself and kills it at the end (rule 0: one foreground command).
- "a second loader run `--country AU`" — FALSE as shipped: `api tools/sim-load.cjs:310` filters the shelf by the plan's IN slab (5/12/18) while AU items are 10 % → empty pool → TypeError (seen on this runner); `:87-89` fyOf/monthNo are April-fixed while AU books open on the July year (`lib/books.js:54` takes fy_start_month from Country setup; enable printed 2025-26). docs/SIM-LOAD.md says "AU accepted, unproved".
- "every R2R step has a screen" — TRUE (flows.json R2R 1-6). Step 2 is the till's `closeCounter` (`till.html:22981`): it needs a counter signed in; the loader posts bills and day-summary chits through the api, not a browser till, so the DEPTH of step 2 is the posted walk-in days in the Day book, and the WIDTH is the till's close sheet.
- "a view-only login" — UNKNOWN: the loader mints no co-assist; the walk tries the api's co-assist door and notes the refusal states if none can be minted.
- "reports show it (TB/P&L/GST/BAS)" — TB/P&L/BS are accounts.html views (NAV `accounts.html:331`); GST close is `cap-period.js peGstView`; a BAS screen is checked in the walk (BAS1 landed in engines/api on 13 Oct; the web side is verified, not assumed).

## (b) Conflicts with DECISIONS-level rules
- None by design: a walk round paints nothing new. Fixes are copy / wrong source / refusal sentence / 390 px / dead button in existing files. Engines untouched (rule 12). Money stays the server's minor units (M36). No new route, no contract change, no migration.

## (c) A simpler way
- One file does the stack: `walk-x-r2r.cjs --real` = spawn `node server.js` on the loaded database + serve public/ + sign in through the ONE sign-in window (CBSignin, signin-id/go/code/verify). Fixture mode reuses `e2e/lib/standin.cjs` + `books-api.cjs` shapes for the cloud walks.

## (d) Risks
- CORS: the api must list the web origin (env ALLOWED_ORIGINS, never code). DEV_OTP on; RLS_GUARD off as the loader sets. DATABASE_URL local only (the loader's rule, kept).
- Twin PRs: web (walk + findings + fixes) and api (loader AU fix, tools only — no route, no budget line). Either lands first. TO1 (cap-tasks) and BAS1 touched other files; no overlap expected in cap-books/cap-period.
- The loaded shop is dated 2026-04 → 2029-03 while today is 2026-10-13: "today" views (To do, Day book default range) will show the simulated future — the walk reads what the screen says, not what it expected.

## (e) VERDICT: BUILD WITH CHANGES
1. The AU load needs the loader fixed first (api `tools/sim-load.cjs`: basket pool by the pack's rate; FY and period from the pack's start month) — done in this round's api PR, test `tests/sim-load.test.cjs` widened.
2. The walk spawns and stops the api itself (`--real`); no separate serve-local.
3. Step 2 is walked on the till as a counter close with the loader's posted days as the depth evidence.
