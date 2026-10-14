# Critique · T2-WRITERS (CAT-W1 · CRM-MINT1 · TA1 · SH-OTP1) — written before any code, 14 Oct

(a) What the brief assumes, checked
- `lib/catalogue-write` has `patchItems` — FALSE: it exports writeItems/codesInUse/countItems only (lib/catalogue-write.js:150). It has to be ADDED there.
- "~20 places update products directly" — TRUE: 21 `UPDATE catalogue_items` (routes/products.js ×11, till.js ×6, assist.js:567, combo-templates.js:184, lib/schedule.js:39, lib/slab-cites.js:32).
- "the import commits row by row" — TRUE: routes/products.js:1020-1028 opens one withEntity per row.
- add-local-customer copied 4× with 3 phone checks — TRUE: crm.js:/leads + /walk-ins/add (rewards.holderOf, ≥8 digits), relationships.js:/customers (6–20 chars), lib/move-in.js:461 (holderOf at preflight).
- walk-in → party is five writes — TRUE: crm.js /walk-ins/add: mint · otp_contact · customer_list · party_no · reward_ledger, each its own connection.
- `lib/assign-chit.js` exists — FALSE (neither repo). The count update is `identities.current_task_count`, 13 statements (chits.js ×3, actors.js ×10). The file is created.
- shopper code: three copies + local genOTP in routes/catalogue.js — TRUE: genOTP (catalogue.js:25) issues twice (order/start, support/start); the spend (`otp_code=NULL…`) is copied 4× (catalogue.js:910,1152,1179,1303). connectors.js:24 and network-design.js:116 carry two more private generators.
- MAINT-1 baseline / tools/maint1 / RECONCILIATION docs — UNKNOWN: ../chitbridge-docs is empty on this runner. Counts are measured by the guard's own grep (before/after in the PR).

(b) Conflicts: none with the chit/rail, may/why, money unit or country packs. One-place-per-thing is the point of the round.
- Merging the phone check onto rewards.holderOf means relationships /customers refuses a 6–7 digit phone it used to keep (and keeps one >20). That IS the brief (one check); said in the PR.

(c) Simpler: patchItems takes per-row merge OR replace in one unnest statement (the bulk route's existing shape), plus `patchWhere` for the two match-by-field writers (slab takeover, help-desk qa_id). The till flag toggle reads the row FOR UPDATE then patches — same transaction, +1 statement.

(d) Risks: import now all-or-nothing on a DATABASE error (validation refusals still per line, as today); duplicate ids in one import keep "last row wins" by de-duplicating before the unnest. Test mocks that match SQL text (slab-cites, combo-templates, offr04) are re-pointed. No migration (b451–b453 unused). No web change unless a shape moves (none planned) → api PR only. products-bulk.test.cjs and worklist-unassigned.test.cjs are red on main here (C:/dev path, missing module) — pre-existing.

(e) VERDICT: BUILD WITH CHANGES — patchItems is created in lib/catalogue-write (not found); lib/assign-chit.js is created in the api; the one phone check is rewards.holderOf; one guard test asserts zero outside the four canonical files.
