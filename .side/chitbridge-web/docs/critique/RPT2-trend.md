# RPT2 · Reports › Trend (metrics steps 2 + 3) — critique before build (2026-10-17)

(a) What the brief assumes, checked
- `lib/country-setup fyStartOf` exists — **false on main**; it is on unmerged `origin/neutral/n1-n4` (country-setup.js:525). This round adds the same body so it builds; the rebase onto n1-n4 keeps theirs.
- engines `rollup.series` gives `{slots, headline}` (REQUIREMENT §3) — **false**: v1.66.0 (PR #57, rollup.js:625) returns an ARRAY of slots `{key, gross_minor, total_minor, bills, coverage{expected,seen,short,partial}, last_year{key,gross_minor,short}, change_pct}`. The route sends that array as `slots`; no headline is invented in a page.
- `GET /api/till/summary` has no budget line — true (round-trips.budget.json). `GET /api/facts/till` is 1 trip — true; the teaser rides in its readBatch.
- a reports.html — **false**: Reports is `finance.html#/reports` (cap-mis.js fmMount, cap-finance-terms.js:24 finTab). Trend = `#/reports/trend`, a second view of that tab.
- a fixed 132 px tile — not found in shell.js (`.cbsh-box` height is content-driven); the teaser is one line (spark 64×16 + words), so it adds one line at most.
- fcChart (cap-finance-cash.js:67) and _misSpark (cap-admin.js:302) — true; both private renderers.

(b) Conflicts with rules and constructs
- One calculation: every figure and every change % is the engine's; the page formats only (CBLocale money, minor → major by CBMoney decimals).
- shell.js is shared with cb-ux-locale: the edit is one optional line in readFacts (the teaser from `figures.trend`); no new read.
- Re-pointing fcChart (finance) and _misSpark (workshop MIS) at chart-draw.js is owned by those areas → named for the coordinator, not done here.

(c) Simpler: none found. The kit already calls `/api/till/summary?period&n`; widening that route (compare=1) keeps one read for both.

(d) Risks: the engines tag v1.66.0 does not exist yet → TEMP copy commit (to drop, then adopt). Twin landing: n1-n4 first (fyStartOf), then this api, then web.
Row volume: years read 12×(n+1) month rows ×8 copies, ≤ 1,056 business_json rows — one trip, bounded.

(e) VERDICT: BUILD WITH CHANGES — slots are the engine's array (no headline key); fyStartOf duplicated until n1-n4 lands; fcChart/_misSpark re-point deferred to their owners.
