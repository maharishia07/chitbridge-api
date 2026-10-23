# Critique · ACC-GSTR-ONE-SOURCE (2026-10-23) · GSTR reads the same home as GST close (Fable findings 1-3, 7, 10)
Written before the code. Area: accounting (G-MONEY). Consulted: none outside the group (rail status only READ, never moved).

(a) Assumptions checked against the code
- Rail GSTR counts cancelled / rejected / unaccepted copies: TRUE (lib/tax-copy.js copiesFor, `h.role <> 'Draft'` only; ledgerFor reads no current_status).
- Month is the UTC month: TRUE (tax-copy.monthBounds, Date.UTC); the books cut the day in the shop's zone (books-hooks dayOf/dayBounds, identities.timezone).
- The books cut by billed_at || sent_at || created_at (classify), the return by sent_at || created_at: TRUE, a second small disagreement.
- Every 0% line lands in 3.1(a): TRUE (tax-lines.gstr3b). India's pack has NO supplyKinds, so nil vs exempt vs non-GST is not on the line: UNKNOWN to the data, TRUE to the pack.
(b) Conflicts: reading the books alone cannot give GSTR-1 (per-invoice, per-GSTIN detail is not in the ledgers; returns.returnFor refuses India by name). So the return keeps chit-level detail.
(c) Simpler way: one status rule and one posting-moment function, owned by books-hooks (ACCEPTED/REFUSED, classify's `at`), called by tax-copy. No second copy of either.
(d) Risks: money (a filing figure moves; every drop is a copy the books already leave out); engines (nothing edited; India `supplyKinds` is the engines round that makes 3.1(e) real); one extra identities read per ledger call; the open-dispute hold is not read.
(e) VERDICT: BUILD WITH CHANGES: reuse books-hooks for the status and moment rules; split 3.1 from what the invoice already carries (SupTyp, _cb.kinds); STOP on the pack (report it, do not edit it).
