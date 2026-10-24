# R106 api pre-build check (cb-accounting, 24 Oct 2026) — builder's own assumption check; the G2 critique is C:/dev/docs/critique/R106-SHORT-DELIVERY-CRITIC.md

## (a) What the brief assumes, against the code
| Claim | Found | Where |
|---|---|---|
| Hold = `party_status 'disputed'`, route exists, no screen | TRUE; the answer is `{ ok, status }` with no word for the row | routes/books.js:1560, lib/books.js:1132 writeStatus |
| The engine has no `held` | TRUE | lib/receivables.js ITEM_STATUSES (engines src/receivables.js:635) |
| `purchase_return` posts only for a supplier's credit_note CHIT | TRUE; the rule itself takes `{ party, by_rate }` and `against_ref` already settles it against the bill | lib/books-hooks.js:798, lib/posting.js:299, lib/books.js:606 confirmItems |
| books-manual has no debit-note kind | TRUE; BUILD + CATALOGUE are the one door, `sourceRef(kind, b)` needs client_ref, `ev:<kind>:<ref>` | lib/books-manual.js:141-366 |
| `apart` waits whatever the status | TRUE: the gap is checked BEFORE buyerGate, so even an accepted receipt never posts | lib/books-hooks.js:593-598 |
| The gap figures already exist | TRUE: their-bill.check gives theirs / ours / gap | lib/their-bill.js:72 |
| A CHECK list names the event types | FALSE: only stock_movement.reason (already has purchase_return); no migration needed | migrations/000_baseline:5155 |
| A hand-raised debit note reaches GSTR-3B 4(B) | FALSE today: tax-copy.ledgerFor builds the return from CHITS; a manual expense bill is in the same state | lib/tax-copy.js:381 |

## (b) Conflicts
- The brief's T2 line "note the 5 kg gap as a debit note" contradicts OPS-60 and decision 2 (a debit note only against money BOOKED). The gap is NOTED on the one entry; the debit-note door is proved on a rate difference. No second posting rule.
- Their bill LOWER than the count (gap < 0) is not a shortfall: posting the count would overstate the creditor. It keeps today's wait ("ask them, or reject").
- A sentence the client branches on ships with a code: the wait carries `short { theirs_minor, ours_minor, short_minor }` and `todo: 'accept'` (FIELDS row added); the dispute answer carries `words`.

## (c) Simpler way
Accept-at-counted is the chit's own Accept (moveStatus, unchanged): once accepted, receiptBill posts at the count with the gap in the narration. No new route; Hold/Release and the debit note ride existing doors.

## (d) Risks
Money: G-MONEY's own rule, decided (OPS-60). Data: append-only; no SQL. Engines: none (lib/posting.js, lib/their-bill.js untouched). Twin: api first; web accounts (finance) then till (counter, vendoring). GSTR 4(B) for a hand debit note = follow-up under ACC-GSTR-ONE-SOURCE. Other rounds: R104 touches stock-store / stock-from-chit, not these files.

## (e) VERDICT: BUILD WITH CHANGES — the T2 proves the gap NOTED (balance holds at the counted figure) and the debit note on a rate difference; a negative gap still waits.
