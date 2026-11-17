# Critique · PAY-FIX (written before any code — BRIEF-RULES 00)

**VERDICT: BUILD WITH CHANGES** (listed under c).

## a · what the brief assumes, checked against main
- C3 no lock before the allocation read — TRUE: `lib/books.js:691-701` (`writeAllocation`) reads `partyItems` then `S.insertItems`; the only advisory lock in the api is `lib/reward-store.js:76` (`lockOn`). `writeChequeStep` (:731) and `writeReversal` (:828) read the same rows the same way.
- H2 a fixed key per chit — TRUE: `lib/books-hooks.js:428` `client_ref: 'chitpay:' + c.chit_id`; `routes/chits.js:3684` answers "Payment recorded" even for a replay (`books.payment.duplicate`).
- H3 withdraw never looks at the books — TRUE: `routes/chits.js:5034-5178` has no books call; `S.counterBills` (`lib/books-store.js:777`) filters no status.
- H9 four separate IndexedDB writes — TRUE: `tools/tally-connector/till.html:23337-23340`; `DB.tx` (:4557) opens ONE store per transaction.
- H6 no replay key on a delivery — TRUE: `lib/deliverline.js:108` is a plain `chit_line_event` call; the queue rows at till.html:5565/5578 carry only `reference`; b144/b150/b152 create no unique index.
- M1 gstClose locks nothing — TRUE: `lib/books-period.js:392-408`; `S.periods` (`lib/books-store.js:76`) has no `FOR SHARE`.
- M2 postOwn opens its own transaction — TRUE: `lib/books-period.js:64` `B.postEntry(null, …)` while callers hold `h` (:148, :172, :222, :406, :442).
- L3 an in_progress key lives 48 h — TRUE: `middleware/idempotency.js:68-70` (`expired` only by window); web `public/cb-offline.js:45` `status === 409 → 'done'`.

## b · conflicts with standing rules
- "A closed month refuses postings" (M1) conflicts with the ledger's standing rule `lib/books.js:23` — a locked month MOVES an automatic entry to the first open month and REFUSES a typed date (`strict_date`). Kept: the close soft-locks the months; a late counter bill moves on (said, `moved: true`); a typed date in that month is refused PERIOD_LOCKED.
- H6's suggested key (entity, chit, line, reference, kind) would refuse two real deliveries on one line under one GRN ("6 then 4", the shape deliverline.js:148 says is normal). The key is the press: `client_ref` per queued row + line.
- One lock helper: the second `pg_advisory_xact_lock` call site means ONE helper (`lib/xact-lock.js`), reward-store pointed at it in the same PR (standards review, 14 Oct).

## c · changes to the brief
1. M1 as above (move for automatic, refuse for typed). 2. H2: the web sends `client_ref` per press (stored in `business_json.payment.client_ref`, FIELDS entry); without one the old key stands and a replay answers "Already recorded". 3. H3 posts the reversal in the SAME transaction as the withdrawal; a books refusal refuses the withdrawal in words (never a silent half). 4. H6 key = `client_ref` (b718 column + partial unique index + 12-arg `chit_line_event`), old clients unchanged.
## d · risks
Migration b718 only (b719/b720 unused). Twin landing: api first (an old web sends no client_ref and keeps today's behaviour). Engines untouched. `FOR SHARE` needs UPDATE on fiscal_period — cb_app has it (setPeriodStatus). Files other rounds may touch: routes/chits.js, lib/books*.js, till.html (vendored).
