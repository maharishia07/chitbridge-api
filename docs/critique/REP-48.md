# Critique · REP-48 · Trend reads the books (lifecycle S9-9b)
(a) Assumptions vs code
- Trend reads only stored summary chits: TRUE (lib/till-summary.js trend()/teaser() hand summaries to rollup.series).
- "Trend must equal P&L sales": PARTLY FALSE. The P&L Sales line (lib/ledger.js profitAndLoss) is net of output tax; the check S9-9b and Home's Till card (REP-52) mean SOLD = bill value (tenders + debtors). Trend follows SOLD; equal to P&L sales whenever the bills carry no tax (the test).
- A books reader exists: books-store.entryLines (one day) and lineSums (per account, no day grouping): neither gives a per-day sold for a year in one statement. UNKNOWN cost of 52 per-slot reads, so no per-slot read.
(b) Conflicts: none with the rail; sales rule lives once (DAY_KINDS / SOLD_ROLES now exported by books-store, home-facts imports them). Neutral: currency + zone from the shop row; fy from shopYearOf.
(c) Simpler way: summing entryLines per slot in JS = a second sum and N reads. Chosen: ONE grouped statement books-store.soldByDay, folded into the engine as stand-in summaries so rollup.series stays the one comparison.
(d) Risks: books tables absent (42P01 -> summaries + words); a shop with books off (words, never 0); the week the books begin in (day keys as source so the engine says short); one extra withEntity only for books-on shops (budget unchanged for the fixtures); web twin: contract fixture copy + painting sales_note (web area).
(e) VERDICT: BUILD WITH CHANGES (Trend = Sold, not P&L's net-of-tax line; one grouped read, no per-slot reads).
