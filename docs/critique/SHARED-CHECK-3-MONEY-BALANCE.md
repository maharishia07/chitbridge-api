# SHARED CHECK 3 — ONE BALANCE CHECK PER MONEY DOCUMENT (DESIGN ONLY, NO CODE)

2026-11-09 · M · owner cb-finance with cb-accounting (G-MONEY) · Athi approved 9 Nov: close SIT-found money bugs by pattern, not route by route. Checks 1 and 2 are in PR #1073 (docs/critique/SHARED-CHECKS-1-2.md); this is check 3, kept separate because it is money and carries a lock. Base: api origin/main 820d69cc. FIN-78's fix (PR #1072) is OPEN, not merged: the precedent below is its branch f13c88ad.

**VERDICT: BUILD WITH CHANGES.** A balance check already exists twice (FIN-78's `refuseWriteOffAboveDue`, and `lib/credit-cap.js` for counter credit notes) plus a third half-copy (`refuseOverpay` for GST). The plan is ONE helper that the three become, not a fourth. Three changes to the brief: (1) ORD-89 is not a balance case, it is an empty document; (2) a payment IN above what is owed is a deliberate advance (409 ALREADY_PAID, acknowledged once), so it stays out of the refusal; (3) the void/reject cases wait for Athi's rule (section 6).

## 1. What exists (looked first; `node C:/dev/seams.cjs` run one word at a time, slow)

Words: receivables, outstanding, lockParty (answered). lockedItems, balance, allocation, credit note: seams.cjs was cut by the 120 s limit on a low-RAM laptop, so those four were read by grep of lib/ and routes/ instead (said, not hidden).

| Piece | Home | What it already does | What it lacks |
|---|---|---|---|
| `Receivables.outstanding(items)` | engines receivables.js | the ONE carried balance: `by_party`, `by_ref` (bills less paid, allowed, written off), `currency` | read by 3 api files only; the refusal doors do not all read it |
| `lockedItems` / `S.lockParty` | lib/books.js:689, lib/books-store.js:801, lib/xact-lock.js `lockKeys` | `pg_advisory_xact_lock(hashtext(shop|party|account))`, taken BEFORE the read, held to commit; keys sorted so two holders never deadlock | taken by payments, cheques, allocations, write-off; not by loan, GST pay, credit notes, opening |
| `refuseWriteOffAboveDue` (PR #1072) | lib/books.js (inside `writeJournal`, before the first row) | lock, read carried `by_party`, compare, 409 `BOOKS_CONFLICT` naming what is owed and the currency; a book in another currency refuses | only `write_off`; lives inside books.js |
| `lib/credit-cap.js` (ACC-286, CTR-234 landed) | counter credit notes | lock `credit-cap|<bill>`, picks the bill's own total and the earlier notes' totals, compares integers, 409 `CREDIT_NOTE_OVER_BILL`, 409 `BILL_NOT_RECORDED` (a waiting code) | `applies()` needs `till.id` AND an `against`: a rail note (ACC-284) and a note with no bill (CTR-237) skip it; "ambiguous bill" passes unjudged |
| `refuseOverpay` + `gstBalances` | lib/books-period.js:807 | a head cannot be paid above the owed output tax | skipped when `source_ref` exists (ACC-275, the replay), takes no lock, a second parallel challan reads the same balance |
| payment door duplicate rule | books.js `askDuplicateRule` (FIN-77, under the party's lock) | "more than is owed" is a warning acknowledged once, an advance | by design, not a refusal |
| `lib/chit-ceiling.js` | RAIL-205/191 | the largest number a chit can hold, off the column types | a per-column ceiling, not a balance; check 1 widens it, this check does not |
| `recordPayment` gates | books.js | whole minor units, real day, party on the list | no cap on any reducing write except the three above |

The reuse points a build MUST use: `E.receivables().outstanding`, `lockedItems`/`lockKeys`, `money`/`named` words, `BOOKS_CONFLICT`/`CREDIT_NOTE_OVER_BILL` codes. Nothing here recomputes: every comparison is two carried figures (the amount asked, the balance carried), per the mismatch-not-recompute rule.

## 2. The ONE helper

```
lib/money-balance.js   (home; absorbs refuseWriteOffAboveDue out of books.js and the body of credit-cap.js)

refuseOverBalance(handle, entity, claim) → void | throws { status: 409, code, message }
claim = { kind, amount_minor, currency, party_id?, account_id?, ref?, doc? , replay_of? }
```

`kind` picks the READER (which carried balance) and the CODE; the lock, the compare and the sentence are shared. A reader is a small table row, not a function per door:

| kind | carried balance read (never recomputed) | lock key (via `lockKeys`, sorted) | refusal |
|---|---|---|---|
| `write_off` | `outstanding(items).by_party[party]` | party\|debtors account (as `lockedItems`) | 409 `BOOKS_CONFLICT` (status and code as #1072) |
| `refund_out` (FIN-95: refund of a customer's advance) | `unapplied_by_party[party]` (what stays on account) | party\|control account | 409 `BOOKS_CONFLICT` |
| `opening_dup` (FIN-100) | `by_ref[bill_ref]` already open for the party | party\|control account | 409 `BOOKS_CONFLICT`, "that bill is already open" (a same `client_ref` stays a replay, 200 `duplicate`) |
| `loan_principal` (FIN-92) | the loan account's carried balance (the books balance of the account named by `LOAN_ROLES`, same read as the trial balance) | ''\|loan account id | 409 `BOOKS_CONFLICT`, "only ₹X of the loan is still owed" |
| `tax_payment` (ACC-275) | `gstBalances` output/rcm per head (what `refuseOverpay` reads today) | gstpay\|<fy-period> | 409 `BOOKS_CONFLICT`; a replay of the same challan ref with the SAME amount answers the FIRST entry's figure, with a DIFFERENT amount answers 409 (never the new typed amount beside the first entry) |
| `credit_note` (ACC-284, CTR-237) | the invoice's own carried total less earlier notes' carried totals (credit-cap's reading, kind-agnostic: the invoice chit by id, the earlier notes by `against.chit_id`) | `credit-cap\|<invoice chit_id>` (as now) | 409 `CREDIT_NOTE_OVER_BILL`; no bill named or found: 409 `BILL_NOT_RECORDED` (waiting code, the till's queue retries) |
| `rail_payment` (ACC-320) | the buyer's bill carried total less accepted notes less paid | party\|supplier control account | the existing payment door answer: ALREADY_PAID when the excess is an advance the buyer may confirm; a payment above (invoice less accepted notes) on a document with notes is 409 `BOOKS_CONFLICT` naming the accepted notes |

Order inside every door: gates (shape, day, party) first, then ONE `lockKeys` call with every key the door needs, then the read, then the compare, then the write, all in the door's existing transaction. The `client_ref` replay is answered BEFORE the check (a replay of a write that already landed must never read as over-balance: `postEntry`/`firstPayment` already do this, WO-6 in FIN-78 proves it).

**Money is a value type.** `claim.currency` is mandatory; the carried balance's currency is compared first and a mismatch refuses ("books are in X, not Y") exactly as #1072 does. Amounts are integers in minor units; a refusal never caps and never partly posts ("refuse rather than cap"). A customer is never taken below zero by a write-off, an allowance or a credit note.

**Status and code (docs/ERROR-CODES.md, no new code in slices 1 to 3 unless said):** 409 `BOOKS_CONFLICT` (books doors, frozen by FIN-78, legacy-listed), 409 `CREDIT_NOTE_OVER_BILL` and 409 `BILL_NOT_RECORDED` (chit doors, already registered). One possible new row: `CREDIT_NOTE_BASIS_MISMATCH` (409, owner chits) for ACC-301, section 3 slice 2, added with its ERROR-CODES row in that PR. `ALREADY_PAID` is kept for payments in. The web must be grepped before any door's status is moved (S2); none is.

## 3. Doors and backlog lines it closes (from origin/master, backlog-lines.cjs, open lines about over-pay, over-refund, over-credit, write-off, void or reject after paid, replay)

Note: FIN-78 is still `[ ]` on master and will be ticked by its landing, not by this work. CTR-234 is landed.

| Slice | Door (route) | Kind | Closes |
|---|---|---|---|
| 1 books | POST /books/write-off | write_off (move #1072's check into the helper) | FIN-78 |
| 1 | POST /books/payments, direction out to a customer with an advance | refund_out | FIN-95 |
| 1 | POST /books/opening | opening_dup | FIN-100 |
| 1 | POST /books/loans/:ref/emi | loan_principal | FIN-92 |
| 1 | POST /books/gst/pay (output and reverse-charge heads) | tax_payment | ACC-275 |
| 1 | POST /books/entries with `against_ref` (a manual journal that settles a bill, `confirmItems`) | write_off family via the same by_ref reader | the same shape, no backlog id yet; add a test line |
| 2 chits | POST /chits/send purpose credit_note against a rail invoice (sendWrite and sendLegacyWrite) | credit_note | ACC-284 |
| 2 | the same door, a counter note with no `till.id` or no `against` (credit-cap `applies()` widened) | credit_note | CTR-237 |
| 2 | price-note build for a credit or debit note: the basis (`price_includes_tax`) is read off the kept invoice (`summary_json.money`, `business_json.invoice`), never the live flag | basis (a mismatch of two carried values, not a cap) | ACC-301 |
| 3 rail payment | POST /chits/:chit_id/payment (markChitPaid), DELETE of a payment (a reversal can never take a paid bill past zero) | rail_payment | ACC-320 |
| 4 neighbours | POST /repeat/:id/counter and /run | not a balance: a document that supplies nothing | ORD-89 |
| 4 | credit note lines: a return of more quantity than was sold | the same invoice reader on quantity, owner cb-operations decides | OPS-3 (the money half is slice 2) |

Slice 4 is listed so no line is lost, but it is not built from this design: ORD-89 is one refusal in `lib/repeat-supply` (a counter or run that leaves no line is 400 "to stop supplying, decline"; owner cb-orders, and it is an input check for check 1's `B.list min 1`), and OPS-3 is a quantity ledger (cb-operations).

## 4. Needs an Athi rule or an engines change: kept OUT of the first three slices

| Line | Why held | What it needs |
|---|---|---|
| RAIL-216 seller voids an invoice the buyer paid | the rule is Athi's (ATHI-DECISIONS 9 Nov, plan PM/RAIL-216-PLAN): (a) a payment blocks the void, answer 409 "paid, issue a credit note"; or (b) a Zoho-like void. Phase A alone covers only a seller-recorded receipt, a buyer-marked payment (FIN-99) still passes | Athi's answers 1 to 5; likely an engines tag (rail.move facts so the greyed button agrees) then api adopt then web adopt. When decided, `CHIT_CANNOT_WITHDRAW` (409, exists) is the code and `kind: void_after_paid` reads the same invoice reader |
| RAIL-218 buyer rejects an invoice it already paid | same family and the same Athi rule; B payable +1000 and S dues unchanged disagree for good | the RAIL-216 rule decides both; plus FIN-99 (buyer payment visible to the seller) |
| RAIL-221 goods-in correction that empties an accepted bill | no rule says what a correction against an accepted bill means | Athi rule (refuse, or say the acceptance stands) |
| ACC-265 cancelling a sale that has a credit note | already marked `needs: Athi` | Athi |
| CTR-189 a cash refund takes cash in hand below zero | a cash-drawer floor is a till rule, not an "owed" limit; the owner may allow a short drawer | cb-counter plus Athi; not a party balance |
| CTR-236 junk tender (-5, 1e308) | an input bound | check 1 |
| payments IN above what is owed | a deliberate advance, ALREADY_PAID | no change |
| an unjudged credit note (bill ambiguous, no total) | credit-cap passes it today with a warning on the answer; "refuse rather than cap" says refuse | decide in slice 2 with a test: refuse 409 `CREDIT_NOTE_NOT_JUDGED` when the shop has no way to resolve it, or keep the warning; recommendation: keep the warning until one real ambiguous case is counted (the offline till has no second chance) |

No engines change is needed for slices 1 to 3: every reader above is an existing carried figure (`outstanding`, `unapplied_by_party`, `gstBalances`, the invoice's picked total).

## 5. The register column that proves adoption

A new machine column, `balance_guarded` (a 14th, proposed to cb-api, ratchet baseline taken at the day it lands). It APPLIES only to a route in `money-balance` DOORS (the helper exports the table: kind, route, reader), and is TRUE when all three hold:
1. the route's handler calls `refuseOverBalance` (a static test greps the door table against the route files, so a door cannot be listed and not wired);
2. its area test recorded an "over by one minor unit is refused, with the registered code and the sentence" case in `docs/contracts/api-hardening-evidence-areas.json` (the same file the other area columns read);
3. its area test recorded a CONCURRENT case that saw exactly one success (section 7).

Because a door nobody listed shows no column, one more static test (the "closed list") finds the doors: any route whose posting event type is in a REDUCING set (`write_off`, `credit_note`, `loan_repaid`, `tax_payment`, a refund, an allowance) must be in the DOORS table. A new reducing door then fails the guard until it is listed and proved, which is the point: the column is derived from the posting, not remembered.

## 6. Slices of at most about 10 doors

1. **Books doors (6 doors).** helper + move `refuseWriteOffAboveDue` + refund_out, opening_dup, loan_principal, tax_payment (with the replay answer), `against_ref` entries. Lands AFTER #1072. Test: one realstack per kind, FIN-78's WO-1 to WO-7 become the `write_off` rows unchanged. Until it lands, #1072 stands alone: nothing is blocked.
2. **Chit credit notes (3 doors + the basis).** absorb credit-cap into the helper, widen `applies()` (rail note, note with no bill), the issued-basis read for ACC-301. Twin: web only if a refusal's status is new to the till (the till's drain keeps a 4xx forever: see risk). Test: ten notes of 1,180 against one invoice of 3,540, one sequential and nine parallel, IN and AU (the hunt's own repro).
3. **Rail payment door (2 doors).** ACC-320, after slice 2 (it reads the same invoice reader). Needs FIN-99's decision only for the "buyer-marked, seller blind" half, which stays in section 4.
4. **Neighbours (not from this design).** ORD-89 via check 1, OPS-3 via cb-operations.
5. **After Athi's rule:** void_after_paid and reject_after_paid on the same reader, with the engines tag if the rule needs it.

## 7. The concurrency proof every slice must carry

A `tests/<id>-truth.realstack.cjs` on real Postgres, like `fin-78-writeoff-below-zero-truth.realstack.cjs` (WO-4, WO-5, WO-6), with these cases for each kind:
- **LIMIT-1** over by one minor unit: 409 with the registered code and the sentence naming what is left and the currency; no journal row, no chit written (counted by SELECT).
- **LIMIT-2** exactly the balance: 200, balance 0; the next one minor unit: 409.
- **CONC-1** two writes of the whole balance at once: exactly one 200, one 409, one entry. **CONC-2** three of 60% at once: one 200, two 409.
- **CONC-3** TWO DIFFERENT kinds on the same party at once (a write-off and a credit allowance, or a payment and a credit note): they judge one after the other; no negative balance. This proves the shared lock key is one key, not one per kind.
- **REPLAY-1** the same `client_ref` (or challan ref) after the balance is 0 is a 200 replay, never a 409; with a different amount (the challan case) 409.
- **CUR-1** a book in another currency refuses by name.
- **NEG-1 (break and restore from a copy):** the call is removed from the door and CONC-1 goes red, so the test is proved to be the test. The break is made in a copy of the file, never in place (memory: break-then-restore).
- **TILL-1** (slice 2 only): the till's drain of a refused note: a 4xx that is not a WAITING code is dropped with a sentence, not retried for ever; `BILL_NOT_RECORDED` stays waiting.
The whole books guard family runs on any books change (two-sided-books, bill-use, books-period, acc-223-238-cancel, books-store-sql); every new SQL line goes through books-store with a memory twin and a column check.

## 8. Industry check (recalled from memory, not looked up; treat as a baseline, not a spec)

- **Xero:** a credit note is allocated to an invoice only up to the invoice's amount due and the credit note's remaining credit; it cannot be allocated above either. A refund of a credit note is capped at the remaining credit. Recalled, firm.
- **Zoho Books:** applying a credit note to an invoice is limited to the invoice balance; a refund is limited to the credit balance; a bill or invoice that is paid cannot be voided without first removing its payments or credit applications. Recalled, fairly firm.
- **Tally:** credit notes can be raised against a reference with "New Ref" or "Against Ref"; an Against Ref allocation above the pending amount is not blocked as firmly, the balance reads as an advance. Recalled, weak: Tally is the permissive one, which is the behaviour this check does not copy.
- **GST (India):** s.34 and Rule 53 allow a credit note only for the value and tax of the original invoice's supply; an excess is not a credit note. The seller's liability falls by the note, so a note above the invoice would take output tax below what was charged.
- **IFRS 15 / Ind AS 115:** a refund liability is measured at what is expected to be refunded of the consideration; a refund above the consideration is not a reversal of revenue. A customer payment ahead of the invoice is a contract liability, which is what an advance is here.
- **IFRS 9 / Ind AS 109:** a receivable is written off against its gross carrying amount only; a write-off cannot exceed the carrying amount. A loan repayment of principal cannot take the liability below zero: an excess is a prepayment or receivable, a separate asset.

Better than Xero/Zoho/Tally because: all three catch the over-credit on the screen, none says in one sentence what is still owed AND in which currency, and none holds one lock across the different reducing writes, so two staff on two devices can pass the check together. Here the carried balance is the one check, the lock is one key, and the refusal is the same shape on every door.

## 9. Risks (the top one first)

1. **A refusal the offline till can never clear.** The till's queue keeps a 400 bill for ever (api #932 CTRY-77 lesson). Every refusal reachable from the till (slice 2) must be a WAITING code or a code the till drops with a sentence; slice 2 carries the TILL-1 case and a cb-counter read of `tools/tally-connector/till.html` before it lands.
2. **A second lock order deadlocks.** The loan door and the GST door take a key `lockParty` never took. All keys of a door are taken in ONE sorted `lockKeys` call, and CONC-3 proves two kinds at once.
3. **An amended invoice moves the carried total under the notes.** credit-cap reads the invoice's CURRENT total; notes issued before an amend are compared with the new total. The helper reads the total at the note's own `against` only after the amend rule (ACC-192 money lock) decides; slice 2 names the case.
4. **A false refusal of an honest advance.** Payments in stay on ALREADY_PAID; only write-off, allowance, note and loan principal refuse. Widening the helper to payments in would break the advance flow.
5. **Twin landing.** No engines change in slices 1 to 3; if the RAIL-216 rule needs `rail.move` facts, that is an engines tag and an api adopt (the api CI tests against web main: a web-first adopt reds engines-pins, ask Athi for `--skip-main-ci` on the api adopt).
6. **Slice 1 reads FIN-78's lines in books.js while #1072 is open.** Slice 1 is branched after #1072 lands; until then no code here touches `writeJournal`.

Consulted: cb-accounting area pack (same group, read: one posting writer, reversal never edit, money minor integers, one rounding). cb-rail (RAIL-216, 218, 221), cb-orders (ORD-89) and cb-operations (OPS-3) are named for their lines but their packs were not read in depth; each consulted agent advises, the owner decides.
Rules read: the standing rules as carried in memory and the area pack (DISCIPLINES.md itself was not opened this run): (one calculation, mismatch not recompute, money is a value type, refuse rather than cap, critic before build, better not copied) · area-finance pack.
