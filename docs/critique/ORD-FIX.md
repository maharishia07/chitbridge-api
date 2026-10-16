# Critique · ORD-FIX (O1–O7) — written before any code, 16 Oct 2026

**(a) What the brief assumes (checked on main api bd5c304 / web 5a5c4f6)**
- O2 true: `lib/open-orders.js:57` `select.rows(...)` passes no status; `lib/select.js:63` filters only when `sel.status` is given.
- O3 true for open-orders (`Number(l.quantity)`, `l.price` from frozen `line_items`, no removed check). PARTLY FALSE for `lib/work-rows.js:130`: removed lines are already dropped (`progress.removed`); quantity is still the frozen one, so "left 2" is real.
- O4 true: `lib/books-hooks.js:296` `buyerGate` and `:338` answer `refusedNone` and never look for a posted `chit:<id>` entry; `lib/rail.js` allows accepted → rejected.
- O5 true: `till.html` `orderSettle` ignores `finish()`'s result (it `return`s on short payment / credit refused / save failure). The hub rules live in `lib/orderhub.js`, an ADOPTED engines file ("DO NOT EDIT HERE").
- O6 true: `lib/rail-status.js` writes `UPDATE … WHERE chit_id AND entity_id AND direction` with no `current_status = from`.
- O7 true: `spendShopperOtp` is an unconditional `UPDATE … otp_code=NULL`; it already runs inside the order transaction, but never says whether it spent a live code.
- O1 true: `HOST.orderBilled` queues delivery from `BILL_ORDER.lines` (the order as loaded), not from the saved bill.

**(b) Conflicts / constructs.** Fixes stay at the owners: `rail-status.statusGate` (one status writer), `books.reverseEntry` (one reversal writer), `open-orders` (one open-order definition), `lib/otp` (one shopper-code spend), `amend.readLines`/`chit_line` (live lines). No page does a server's job. Cross-shop: none of O1–O7 is a cross-shop leak.

**(c) Simpler.** O3: one overlay helper in `lib/open-orders.js` (`liveLines`) used by both open-orders and work-rows — not two copies. O5 hub state rules are an ENGINES change (orderhub.js) — not this round (rule 12): the page side is fixed here and the engines change is described in the report.

**(d) Risks.** O4 posts a reversal in the books on a status change: idempotent (source_ref `reverse:<entry>`), skips entries already reversed; a later re-Accept finds the entry present and stays reversed (left, said in the report). O6 turns a silent last-write-wins into a 409/noop for the loser. till.html is vendored: master edited in api `tools/tally-connector/till.html`, copied with `scripts/vendor-till.cjs`. No migration needed (b748–b750 unused).

**(e) VERDICT: BUILD WITH CHANGES** — O5 hub-side rules deferred to engines (page side fixed); O3 work-rows removed-lines part not reproducible (already filtered), quantity part fixed.
