# Critique · REP-52 — the Home Till card names Sold and Takings (2026-10-29, cb-reports; critic cb-critic on Fable, G2)

**VERDICT: BUILD WITH CHANGES** (the critic's points 3, 4, 5 and the word "Takings" are in the build).

(a) What the brief assumes, against the code
- The card's 779.50 is the bills' paid tenders: TRUE — lib/home-facts.js booksDay sums Dr cash/upi/card/bank (`tenders` jsonb of books-store.entryLines:248) and the bill entries' tender lines; F's Dr Debtors 1400 adds a bill and no money.
- "Reuse the books read the Day book uses": TRUE — routes/books.js:508 /daybook and booksDay both read books-store.entryLines; no "day's sales from the books" primitive exists (rollup.js, till-summary.js, books*.js grepped; posting.js:841 maps kinds only).
- The lifecycle's hand figure 1967: FALSE for the run's books — they hold A–E (617), the S5-7b copy, L late, H and G's return as well (b3-shared.cjs:25 DAY_E; logs/9.txt S9-1).
- The late walk-in (books-hooks.js:1412: event walkin_day, source_chit_id set, covers NULL) falls through BOTH loops of booksDay today: TRUE, found by the critic — L is in neither bills nor takings.

(b) Conflicts with decided rules
- A money DEFINITION on a screen is G-MONEY's (consult map): Sold = the debit side of the day's sale entries (cash·upi·card·bank·debtors, net of returns, incl. tax — what the till summary's gross always was); Takings = the tender roles only. Collections against dues later in the day stay CB Finance's figure. The lifecycle check by cb-accounting already reads "the day's sales = 567 + 1400", the same definition.
- One calculation: net Dr − Cr by role over entryLines is the ledger's own arithmetic (lib/books.js:533 does it for debtors). The `tenders` column stays (routes/books.js:460 reads it).
- Fallback (no books day): rollup `total` = gross − refunds − EXPENSES (rollup.js:87); Sold = gross − refunds, never total (today's "takings" label on total was already untrue).

(c) Simpler way: none — one loop keyed on event_type (walkin_day · sale_bill · credit_given · return) replaces the two shape-keyed loops.

(d) Risks: api tests' texts change ("12 bills · {money}" → "Sold {money} · 12 bills"); web e2e stubs (index-page.cjs:241, shell.cjs:175, reports-trend.cjs:57) plant their own text and stay green — cosmetic drift, named in the PR; no web-api contract row for facts/till, so no twin PR; figures.takings readers are api tests + the lifecycle only; AU: books Sold = charged 13.30 while the summary gross carries 13.32 — the fallback and the books differ by the cash round-off there; trips unchanged; `state` unchanged.
- The proof edits cb-qa's kase (toolset/lifecycle/09-books.cjs S9-9a): sales − takings === F's 1400 PAIRED with the credit side of the same entries (Sales + Output tax − returns ± round-off, S9-7's role reader on the day), so a shared error cannot pass both. Named in the report for cb-qa.
