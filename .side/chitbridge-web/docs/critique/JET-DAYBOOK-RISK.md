# JET · Day book journal risk filters (rank 2, ASA 240) + After year end (rank 4, ASA 560) · 17 Nov 2026 · cb-accounting

(a) Assumptions checked. Rows carry recorded moment, maker, amounts: PARTLY. `recorded_at` sits only inside `source` and `source` is null on a
manual journal (api routes/books.js sourceOf), exactly the entries ASA 240 targets. `by_name` is read per line (lib/books-store.js:372) but not
sent per entry. Narration is filled by the server (`WORD[event_type]`), so "no narration" cannot be seen from the row. Filters are client-side over
the loaded rows (list-ctl `filters:` with option functions), one address key each (books-grant-filters.js PARAM). Day book accepts any range (dateQ).
(b) Conflicts: none. No new calculation (compare and count only); no second list route; Checked/Query mark and "Checked n of m" untouched (the
mark bar reads viewState.range, which this change never writes). Weekend / after hours is an audit heuristic, not law; zone = shop zone (CB_SHOP_TZ).
(c) Simpler: three read-only keys added to the existing /daybook entry (no route, no migration); all rules are pure functions in the one filters file.
(d) Risks: filters narrow the LOADED page only (as the existing Mark/Type filters do). "Dated after year end" reads one extra range
(period end + 1 day .. +366 days) through the same route; the first-screen fix lane owns the opening logic and is not touched. Twin PRs: api first.
(e) VERDICT: BUILD WITH CHANGES (the three entry keys above).
