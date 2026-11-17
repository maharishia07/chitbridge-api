# Critique · QW1-TODAY (before code)

(a) Assumptions
- A shared walk helper exists: TRUE — e2e/lib/walk.cjs (start/run); walk-finance-cash/payables already inject a clock by hand (WALK_NOW, ctx.clock.setFixedTime, walk-finance-cash.cjs:27,82) — that is the pattern to lift.
- Walks read the runner's date: TRUE — `new Date().toISOString().slice(0,10)` in walk-chit-page:20, walk-screen-id:19, walk-locale:99, walk-repeat-supply:24, lib/standin.cjs:10, lib/books-api.cjs:38, walk-x-p2p:74.
- The api honours a clock override: PARTLY — chitbridge-api lib/shop-clock.js has set()/advance(), but only in-process (tests, tools/sim-load); NO env var at server start. So a `--real` walk's api cannot take CB_TODAY today.
- CB_TODAY exists nowhere yet: TRUE (grep).

(b) Conflicts: none with DECISIONS. One clock: reuse Playwright ctx.clock (page) and the api's shop-clock (never a second api clock — not built here). Money/tax untouched.

(c) Simpler: no — one helper (TODAY, NOW, nowIso, dayPlus) in walk.cjs; walks import it; one guard file.

(d) Risks: other rounds edit the same walks (merge conflicts, small hunks kept). Fixing the page clock only when CB_TODAY is set, so default runs are unchanged. `--real`/opts.base: the api cannot be moved, so the page clock is NOT frozen there (a mismatch would be worse) and a line says so. Engines/api/migrations: none. Api need (for the coordinator): server.js reads CB_TODAY at boot and calls shop-clock.set() when SHOP_CLOCK_ALLOW=1.

(e) VERDICT: BUILD WITH CHANGES — web side only; real-stack api override queued as an api follow-up; page clock frozen only for stand-in walks.
