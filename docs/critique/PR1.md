# PR1 critique — the parallel-run compare (their Tally / Xero / QBO period beside ours) · written before any code, 2026-10-13
**(a) What the brief assumes, checked**
- IM1 move-in and its chart map exist — TRUE: lib/move-in.js (readFile :95, guess :126, cells :153, chartIndex :205 = their code → `source_code`, name, control role). The "map" is a LOOKUP over the chart, not a stored table; Tally's group sits on every ledger as `tally_group` (lib/books-store.js:45).
- The Tally connector already reads a TB / P&L / BS export — FALSE. adapters/tally.js reads stock items, the company and ledger NAMES (:63); nothing reads a trial balance. Its XML readers (tag · tags · dataOf · unesc · num, :15–27) are reusable but private → widen with an additive `readers` export.
- Our statements — TRUE: routes/books.js /trial-balance /pl /bs over lib/books trialBalance · profitAndLoss · balanceSheet (:1067–1110).
- Our returns from GET /api/books/returns — TRUE for BAS / VAT201 (lib/books-period.js:496); FALSE for India: it answers 422 RETURN_FROM_RAIL; GSTR-3B is lib/tax-copy ledgerFor + lib/tax-lines gstr3b (routes/tax.js:48), a second reader outside the books transaction.
- AX1 auditor edition — UNKNOWN in base: it is on unmerged round/AX1-38347913245; its manifest already lists the id `compare` ("drawn when PR1 adds its entry"). The entry is added here; it is drawn in the auditor edition once AX1 lands.
- An auditor login — TRUE as a preset (lib/access.js:110: commenter, whole entity, sees costs). Today every books write is owner-only (lib/owner.js).
**(b) Conflicts with rules and constructs**
- One calculation: our figures come ONLY from the existing engines; the compare subtracts two minor-unit integers per line and names the reason — it computes no balance or tax. Their figures are kept as read (→ minor units via move-in's toMinor / money.round).
- Never posted: a snapshot never goes near postOpening; it is the shop's own read-only paper (insert-only table, no UPDATE grant).
- Server's may/why: the server answers `may` + sentence for "load a snapshot" (owner or the auditor preset); the screen greys with that sentence.
- Better-not-copied: no Xero/QBO/Tally screen has a period tie-out; theirs is the accountant's spreadsheet VLOOKUP. Ours names WHY per line and opens our entries (the rail chit behind them).
**(c) Simpler way** — no mapping table and no new matcher: reuse move-in's chartIndex (code → name → role) plus Tally's own `tally_group`. One table only (b309), one row per snapshot PART (tb · pl · bs · return). PDF = the page's print view (no new dependency); CSV built server-side from the same compare.
**(d) Risks**
- b309 not run → every compare route says so in words (503 BOOKS_NOT_MIGRATED), never a 500; the screen greys "Load" with that sentence.
- Tally P&L / BS / TB XML element names are RECALL (as IM0's were), proven on our fixtures only; CSV (Tally's Excel export) is the safe door. Said in the PR.
- India's return side is a second read (the rail ledger) — a 2-trip route; said in the budget line.
- Other rounds: AX1 touches public/app/manifest.json (one entry line here — trivial merge); IM1/RI1 in routes/books.js (append-only here). No engines change (none needed). Twin landing: api first.
**(e) VERDICT: BUILD WITH CHANGES** — (1) widen adapters/tally.js with a `readers` export instead of a new XML parser; (2) the IN return compares to the rail's GSTR-3B, not /books/returns; (3) the "chart map" is IM1's chartIndex + tally_group, no new map table; (4) PDF via print, no library; (5) the edition entry lands now and draws when AX1 lands.
