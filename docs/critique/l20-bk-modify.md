# Critique · l20/bk-modify (20 Nov 2026) — the shop's edit seat creates and modifies the books, its id on every change
(a) Brief assumptions checked against the code (batch/api-2026-11-23 25ba5ef69):
- POST /events is ownerOrAccountant + heldGate('event'), created_by = byOf(req) = the signed-in identity: TRUE (routes/books.js:1793, lib/books-approval.js).
- POST /entries/:id/reverse is `owner` only: TRUE (routes/books.js:1832); /entries is already ownerOrAccountant + heldGate('journal'): TRUE.
- books-action already has kind 'reverse' (adviser grants); STAFF_KINDS held it out ("reverse stays the owner's", REQ item 5): TRUE, this is the line Athi's 20 Nov rule changes.
- The Day book names the maker: api made_by YES (lib/books-daybook.js:232); web shows it only for an adviser (posted_by) or a counter-rung bill: FALSE for an in-house maker, so the web gets one line.
(b) Conflicts: none with decf3cb0 (opening after go-live, year close, lock, grants stay owner-only). Reversal-not-edit kept (INSERT-only books, Companies Act r.3(1)). One gate (ownerOrAccountant), one held gate (heldGate), one reverser (B.reverseEntry): no second definition.
(c) Simpler way: none; widening two existing gates and one list is the smallest change.
(d) Risks: (1) the held 'reverse' preview was manual-only for advisers; staff reverses what the owner could, the live-bill / loan guard still runs first (LiveBill.refuseLiveBill sits before heldGate) and again at accept (postReversal). (2) The web must not paint a held reversal as done (202): enReverseHeld. (3) write-off, recurring post and accruals reverse stay owner-only: they are not "reverse or edit an entry" (reported, not widened). (4) Route hash of POST /entries/:id/reverse changes: cb-api must re-sign.
(e) VERDICT: BUILD AS BRIEFED.
