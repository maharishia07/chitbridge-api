# PERF1 · critique before build (rule 00) — api 3efa3539 · web 460dddd0 (FX1 merged in both)
Area homes: `../chitbridge-docs` is an EMPTY checkout on this runner — DISCIPLINES.md read from the brief's inline copy.

**(a) What the brief assumes, checked**
1. Reversal lookup unindexed — TRUE. `books-store.js` entryLines + ledgerLines: `LEFT JOIN LATERAL … WHERE reverses_entry_id = h.entry_id` once PER LINE; b273:37-45 has no index on it.
2. "partyNames" scans every party — TRUE but misnamed: FX1's `partyNames` already reads ANY($2). The scan is `parties()` (identities LEFT JOIN both lists, `WHERE c… OR s…` → drives from `identities`, platform-wide), called by routes/books.js `partyNames(h,e)` on daybook · dues · cheques.
3. Dues / CRM read every item ever — TRUE (`S.items(h,e,null,acct)`; party-fields.decorate reads every customer's items for one page of the CRM list).
4. yearBalances recurses — TRUE: one `yearRows` trip per past year (≤30); account_balance PK leads (entity_id, account_id…), so a year filter scans the shop's every row each trip.
5. Till `since` — TRUE: catalogue_items has only (entity_id, is_active) (baseline part2:206).
6. No server paging on Ledger · Day book · Dues — TRUE; and worse: opening ONE ledger line reads the whole range's Day book (cap-books.js bkLgJournal). "ledger index gains posting_date (b273:68)" — FALSE premise: journal_line has no posting_date (b273:47-66); the date is journal_entry's.
7. Cheques N+1 — TRUE (`B.partyItems` per party inside the loop, routes/books.js /cheques).
8. Inbox `limit` unbounded, OFFSET + COUNT every page — TRUE (chits.js /inbox and /sent: `parseInt(req.query.limit||20)`).

**(b) Conflicts with decided rules**
- Item 3 "stored per-party open balance" = a SECOND store of money beside party_item; outstanding is the engine's one calculation (receivables.outstanding). And "a partial index on open items" cannot exist: openness is a DOCUMENT-GROUP sum, not a row flag, and allocation halves pair ACROSS documents — the engine refuses a set holding one half (lib/receivables.js:555).
- Item 4 "store the year-opening carry-forward" contradicts the decided books.js yearBalances note: carry-forward is computed, "never stored — so a permitted late correction to the old year flows through by itself".
- Item 6 Day book / Ledger in CBList `remote` mode: remote "neither filters nor sorts" (list-ctl.js:33) — the Day book's four filters, search, sorts and Day/Week/Month sums (Athi 2026-10-02) would vanish until the SERVER does them.

**(c) Simpler ways to the same outcome**
- 3: read only the parties a screen shows (CRM page → its ids; pairs never cross parties — receivables.js:524) + index party_item (entity_id, account_id, party_id). /dues stays one read: it is the party map every Books screen reads (cap-books.js BK.dues), bounded by parties.
- 4: ONE read of every year ≤ fy (N trips → 1) + index (entity_id, fiscal_year, period). No stored copy.
- 6: keyset `limit`/`after` on /daybook and /ledger now (top-level total·page·limit, server totals, the page's opening = opening + ONE SUM); `/daybook?entries=` so a ledger line reads its own entries. Web remote mode for Day book/Ledger = PERF2, together with the server-side filters it needs.

**(d) Risks** money: none written — reads only; indexes in ONE migration b406 (b407/b408 unused), code works before it runs. Twin: api first (new params are optional), web second. FX1/STD1 touched books-store exports — merged on main, rebased on it. No engines change.

**(e) VERDICT: BUILD WITH CHANGES** — items 1·2·5·7·8 as briefed; 3·4 per (c), no second money store; 6 = server paging + `entries=` now, web remote mode deferred to PERF2 (named in the report); load test via the one writer `B.postEntry`.
