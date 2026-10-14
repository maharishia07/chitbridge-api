# T2-PAGING · critique before build (14 Oct)

(a) What the brief assumes, checked
- `lib/page-limit.js` exists (PERF1's clamp) — FALSE on main: it lives only on the unmerged `round/PERF1-38505183134`. → add a BYTE copy (git merges an identical add cleanly); PERF1 and this PR land in either order.
- C:/dev (DISCIPLINES, MAINT-1 baseline, RECONCILIATION, tools/maint1) — MISSING on this runner (`../chitbridge-docs` is empty). The baseline's 62 cannot be re-run; the guard's own scan is the measure, before and after, stated in the PR.
- /requirements is cut at 500 before the priority sort — TRUE (routes/testing.js:1567 `ORDER BY d.updated_at DESC LIMIT 500`, sorted in JS at :1587); `total` is the cut list's length. /incidents has the same fault (:1843 + severity sort at :1878).
- /cases has no cap at all (:272, 2431 cases in data/test-cases.json); /results latest-per has no cap (:1107); /runs is LIMIT 50 (:1147) with no total.
- The web pager PG (app.html:15552) and CBList remote (list-ctl.js:33) exist — TRUE. The board (cap-testing.js testLoad :298, testing.html :1436) AGGREGATES every case and result, so a page of them would lie.

(b) Conflicts with standing rules
- `total` on /requirements and /incidents already means "every state"; the web's "Everything" chip reads it (cap-testing.js:1759, :2078). DISCIPLINES §2 makes `total` the pager's number (rows matching the query) — one shape per slot. → `total` becomes the pager's; the chip reads the sum of `counts` (the per-state counts the route already sends).
- Sorting by priority/severity must move INTO SQL, or paging still drops old High/Sev-1 rows. Counts move into SQL too (a GROUP BY over every row, not the cut).

(c) Simpler way
- Default limit = today's answer size (cases/results 5000, req/inc 500, runs 50) → no screen changes behaviour; the board reads every page through ONE client helper (`CBList.every`) instead of hoping one page is enough.
- The other ~90 list GETs: not all moved in one round (each needs its screen checked). The guard freezes today's count and allow-lists single-record/fixed-size reads with a reason; the ratchet only falls.

(d) Risks
- PERF1 twin landing (identical page-limit.js; both add a guards.cjs line → trivial conflict). No migration (b466–b468 unused). No engines change. testing.js is touched by T1-* rounds — the edits are confined to five handlers.
- req/inc go from 1 statement to 2 in one transaction (wire 4→5, trips stay 1) — budget raised by hand with the why.

(e) VERDICT: BUILD WITH CHANGES — page-limit.js copied from PERF1; `total` re-meant as the pager's (web chip reads sum of counts); the board pages through CBList.every; the rest of the 62 frozen by a ratchet, not moved.
