# Critique · FIN-52 + FIN-55 (api, 2026-10-29) — a zero press, and a stranger's bill by "other", never mark a copy paid

(a) Assumptions checked
- "classify queues the zero before recordPayment's > 0 gate": TRUE — lib/books-hooks.js:734 (`if (!amt) return { kind: 'queue' …}`) runs before lib/books.js:1232; the route treats `queued` as success and writes the mark (routes/chits.js:4513) and parks it (4567).
- "the stranger is refused after the mode queue" (FIN-55): TRUE — books-hooks.js:735 queues `other` ("no ledger yet") before the partyOn gate at books.js:1234.
- "PAYMENT_BODY.amount can get its own bound without touching AMOUNT": TRUE — lib/chits-input.js:59 names AMOUNT by reference; one new schema for this field only.
- "a queued zero can be fixed later from Waiting": FALSE — the retry re-runs the same classify over the same frozen copy (business_json.payment.amount, summary_json.total_value); it is a dead end, so it is a refusal, not a wait.
- The books route POST /api/books/payments already refuses zero (routes/books.js:1075 "How much?") and the stranger (books.js:1235). Only the chit door is open.

(b) Conflicts: none. One recorder (recordPayment) stays; the stranger rule becomes ONE helper (books.partyOnList) called by recordPayment and the door, not a copy. Existing codes fit: 400 CHIT_INVALID (the contract), 422 BOOKS_REFUSED (the books' own words) — no new error-code row.

(c) Simpler way: gate inside markChitPaid only — rejected: it would close one route, not the retry from Waiting or an older web's press, and would be a second rule beside the books'. The door (chitPaid) is where every Mark-paid press passes.

(d) Risks: tests/books-payments.test.cjs §5 froze the queue-on-zero behaviour (line 262) — it changes with reason. tests/api-problem-chits.test.cjs compares the schema with the old chain: the oracle chain carries the new rule (`gt: 0`) and says so. Register regen (strict_input evidence). No migration, no engines, no web change needed (the sheet never sends 0 on purpose).

(e) VERDICT: BUILD WITH CHANGES — also FIN-55 in the same gate (the coordinator's addition); the counter's own money chit (payment_received, G-SELL) keeps its queue — out of this area.
