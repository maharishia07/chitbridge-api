# Critique REP-73 slice 1 (practice bands by seat), cb-reports, 2026-11-16
(a) Assumptions: month_rows has no fiscal_year (books-practice.js statement: false, added); bankOf has reconciled_to (true, :129); req.practice_roles is a list (true, routes/books-grants.js:58); howClosed is not on this head (true: Lodged stays hidden); the head's `checked` is the quarter, not a year (true, so Checked and Ready stay hidden).
(b) No conflict: one read, one rule (books.monthsNotLocked reused, not recounted); the page branches on server `bands` and `codes`, never on a sentence.
(c) Simpler: none; the pipeline stays inside bandOf, no second read.
(d) Risks: no migration; trips unchanged (3); critic edits 1-7 of section 13.8 binding; advisory hides per client; Lodged waits for past-years.
(e) VERDICT: BUILD WITH CHANGES (the 7 edits of 13.8).
