# R124 · api — a counter-received paper bill names its supplier and their bill number (critique before build, 2026-10-24, cb-finance)

Walk C:/dev/docs/walks/WALK-2026-10-24.md R124 (P1) + R123 (P2). Brief: select.js names a self-addressed RECEIVED copy from `business_json.party`; `bill_no` reads `business_json.invoice.no`, falling back to `their_bill.no`.

## (a) What the brief assumes, checked
- select.js names a received copy by `sender_entity_display_name` — TRUE (lib/select.js:74); the 13 Oct WX-O2C arm reads only `business_json.customer` (lib/select.js:71-73, COUNTERPARTY_ID_SQL 37-41).
- the stored bill holds `party.name` + `their_bill.no` + our `doc_no` — TRUE (till.html:22753 writes `their_bill`; harness `receipt()` the same; FIELDS.md:342 `party`, :860 `their_bill`).
- `business_json.invoice` is an EMPTY slot waiting for the supplier's number — FALSE. It is the FROZEN tax invoice (CBTax.determine INV-01): lib/tax-copy.js:260 `frozen = bj.invoice`, :336 `freezeOnComplete` returns early when it is set ("already stamped"), lib/issued-invoice.js:11, CLAUDE.md rule 3. A counter writing `{ no, party }` there would be read as a tax stamp and skip the posting path.
- R123 is the same missing number — TRUE: the pay sheet's `bill_no` comes from `S.billNos` (lib/books-store.js:1153 `COALESCE(printed_as, bill_no)`), and a received paper bill's `against_ref` is its chit id (books-hooks.js:644 `bj.bill_no || bj.printed_as || c.chit_id`).
- the counter must change (PR 2) — FALSE for the data: it already writes `party.name` (+ `party_id` on a pick, FIELDS:342) and `their_bill.no`. Nothing to vendor.

## (b) Conflicts with decided rules
- One shape per slot: `their_bill.no` IS the received side's number (docSql `bill_received` = receipt + their_bill, FIELDS:860; three readers: books-hooks, till.js, tax-copy). `invoice.no` would be a second key for the same fact AND a different shape under the frozen-invoice key — the two things rule 3 forbids. The issued side's number stays `bill_no`.
- Grep the primitive: "their number, blank = absent" is already written in folder-inventory's `their_bill` term (lib/folder-inventory.js:138); select.js and billNos would be the 2nd and 3rd call sites → lift ONE `theirNoSql(h)` there and point all three at it.
- `counterparty_id` must follow `counterparty_name` (the id filter `counterparty_ids` and the scorecard read the SAME expression) → the party arm goes into COUNTERPARTY_ID_SQL too, uuid-guarded like the customer's.

## (c) Simpler way
Read what the counter already stores; no new key, no counter PR, no migration. One SQL arm per column + one lifted helper.

## (d) Risks
Behaviour change on every select.rows reader for a self-addressed received copy (work-rows/open-orders/till party, folder rules `counterparty`, scorecard name, home facts "who"): all were painting the shop's OWN name there — each becomes right, none was relied on. `bill_no` keeps `bill_no` first, so no issued row changes. The web stand-in contract freezes keys, not values. Readers verified: lib/{folder-rules,groupsum,home-facts,marketing-results,match,open-orders,work-rows}.js, routes/{crm,relationships,till,folders}.js; billNos → books.js proposeFor/narration/reopened, routes/books.js payments. No engines, no till file touched. R104 (stock-store) untouched.

## (e) VERDICT: BUILD WITH CHANGES
1. `bill_no` = `COALESCE(bill_no, their_bill.no)` — NO `invoice.no` read (it would mis-read the frozen tax invoice). 2. Lift `theirNoSql` in folder-inventory, used by docSql, select.js, billNos (R123 fixed here). 3. PR 2 (cb-counter) is NOT needed for the data; the only counter follow-up is cosmetic (none required). 4. Tests: unit on the SQL rule + T2 on real Postgres (receive at the counter → Unpaid bills row → pay preview names SG-1022).
