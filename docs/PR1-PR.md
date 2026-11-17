VERDICT: BUILD WITH CHANGES (critique: docs/critique/PR1.md) · twin of chitbridge-web round/PR1-38350609196 · land API FIRST · owner runs migrations/b309_books_compare.sql (insert-only snapshot table, RLS; until then the screen greys Load with the sentence, routes 503 in words) · no engines change.
Built: lib/parallel-run.js + /api/books/compare (GET list · POST preflight · POST snapshots · GET :id · GET :id/csv; owner or the auditor preset, server says may/why). Trips live: list 2 · preflight 1 · snapshots 2 · :id and csv 2 (+1 for India's rail GSTR-3B); budget lines by hand.
Reuse, widened additively: move-in readFile/guess/cells/chartIndex/toMinor, Tally adapter `readers`, taxReturn(q.on, h), books trialBalance/profitAndLoss/balanceSheet, tax-lines gstr3b, entryLines. New (nothing compared two sets of books): parallel-run.js, 3 books-store fns, b309, FIELDS.md entry.
Flow PRN steps 1–3 (web docs/process/flows.json). Better than a Xero/QBO/Tally tie-out (a spreadsheet VLOOKUP) because each line says WHY — rounding, a rail bill they keyed later, an entry one side lacks, a mapping gap — and opens our entries.
Tests: tests/parallel-run.test.cjs 20/20 (Tally IN: equal, different, mapping gap, pooled parties, BS/P&L/GSTR-3B; Xero AU: TB/P&L/BAS), move-in 21, returns 29, contract 123, guards 5113 all passed.
Said, not hidden: Tally TB/P&L/BS XML shapes are recall, proven on fixtures only (Excel export is the safe door); PDF = browser print; effort counts per source are PR2's hook.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
