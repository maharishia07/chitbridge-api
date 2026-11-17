# Critique TBCMP: last year and change on the trial balance and the balance sheet (17 Nov 2026)
(a) Assumptions checked against code
- The P&L's variance is one helper: lib/books-report-period.js compareLines / overThreshold / OVER (10% AND 1,000 major). TRUE.
- /bs already reads the prior year (routes/books.js bsTagged prior_year_minor, earlier.year) so only the change and the flag are new there. TRUE.
- /trial-balance reads ONE day (B.trialBalance); last year needs a second as-at read. TRUE; the earlier lane said so.
- A trial-balance row is debit and credit; a variance on either column alone is wrong when an account flips side. So the variance is on the NET (debit positive), per account. DECIDED by the brief.
(b) Conflicts: none with the chit/rail or country packs. Money only through MO.diffMinor / changeOf (no float). Cost-blind readers: blindBooks nulls every *_minor / *_bp / *_over key at any depth, new keys follow that rule (tested).
(c) Simpler way: none; sharing ONE ledgerCtx between the two days keeps the extra read to the carried-year work only.
(d) Risks: (1) an extra read on a hot reviewer page: budget line by hand, p95 measured at 7 years on a real Postgres. (2) first year of the books: prior is all nil, so compare is null and no Last year column is drawn (never a column of zeros). (3) an account only last year held is listed with nothing now. (4) contract keys hand-added in 5 places; web fixture byte copy. (5) Another lane moves the Day book in the same web file: not touched. No migration.
(e) VERDICT: BUILD AS BRIEFED.
