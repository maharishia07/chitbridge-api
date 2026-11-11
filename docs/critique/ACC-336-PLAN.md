# ACC-336 / ACC-336b — the close sets off against what the period really owes (PLAN, 2026-11-12, cb-accounting; for the critic BEFORE any lib code)

Status: plan and failing tests only. Tests: `tests/acc-336-close-reads-period.test.cjs` (red on main, 12 fail / 15 pass). Prior design: PM/designs/ACC-336-DESIGN.md rev 4 + critic re-reviews (docs repo, branch acc/acc-336-design). This plan folds 336b into it and **changes one rev-4 figure (case 5, see 4)**.

## 1. The defect (file:line on main 4bba5eae)
- `lib/books-period.js:795` `gstClose` reads the heads with `gstBalances(handle, entity, span.end)`; `:826` `refuseOverpay` reads them with `settledAsOf` (today). The close and the payment check disagree on the date.
- 336: a challan dated after span.end is not in the span.end balance. The set-off is right (utilised 4000, payable 6000) but the cash already paid is never matched, so the ledger ends with output CGST a DEBIT of 4000 (red test K1: net +4000, expected 0). A return then shows 4000 owed-back that is really a cash surplus.
- 336b: a payment dated inside the period IS in the span.end balance, so output reads 0, the set-off uses nothing and the 4000 of input credit stays "carried" (K2: utilised 0, payable 0, input net 4000). The cash above the net due is relabelled as input credit. K3b: a 6000 partial dated in the period also reads payable 0.
- Same root for both: the set-off base depends on WHEN the challan was dated, not on WHICH PERIOD it pays.

## 2. The rule (with sources; what I could and could not reach)
- Law: CGST Act s.49 — deposits go to the electronic cash ledger, ITC to the electronic credit ledger; s.49(4)/(5): credit ledger pays OUTPUT tax only (never interest/penalty/fee), IGST credit first; Rule 88A: CGST/SGST credit after IGST in the order the rule's table gives (Notification 16/2019-CT, 29 Mar 2019, from search summaries: cleartax.in/s/gst-input-tax-credit-utilisation, taxguru.in rule-88a pages). The official gazette text was NOT fetched (the CBIC pdf URL 404). The api already calls the pack's order through `posting.gstSetOff`; this plan does not touch that order.
- Practice: a challan deposit credits the CASH ledger; it is set off against the liability when GSTR-3B is filed, credit ledger first, cash for the balance (Tally help "Filing GSTR-3B and making payments", help.tallysolutions.com; GSTR-3B Table 6.1 shows "paid through ITC" and "paid in cash" and auto-fills both balances, learn.quicko.com electronic-credit-ledger-gst — secondary source, portal wording not opened). So a challan paid before the close is a cash payment against the period; it never reduces the credit used. Credit-first is portal practice (s.49 says "may"); not verified as statute. Rule 86B (1% cash) is not modelled and must not be claimed.
- Zoho Books: NOT reached (search returned nothing); no claim made. Tally and Zoho are a baseline only (better-not-copied): ours carries the period on the challan itself.
- Our rule (decided, RULE-MATRIX R18): **the period's set-off is credit first over what the period owes BEFORE its own payments; payments are matched to a period by the period they NAME, never by date; cash above the net due is an advance asset, never input credit.**

## 3. The change (one calculation, widened — never a second formula)
Seams: `node seams.cjs gstClose` / `settledAsOf`: one close (`gstClose`, books-period.js, FLOW closeSpan → gstBalances → CBPosting.gstSetOff → closeAnswer → postOwn), one date helper (`settledAsOf`, used only by `refuseOverpay`), `gstPayableAt` (F3 cash forecast) and books-todo.js:175 and gst-returns.js:1117 call the same reader/engine. Nothing new is added beside them.
1. `gstBalances(handle, entity, asOf, preRead, pack, { paidFor: span.key })` (ONE option on the one reader). Output base = ledger at span.end **plus the named payments dated <= span.end added back** (the part already inside the span.end balance). Payments dated after span.end are not in it and are not added. Callers without the option (gstPayableAt, books-todo, refuseOverpay) are unchanged.
2. `gstPay` writes `tax_period = span.key` on its entry (column from b849, `schema.hasColumn` guarded); the read finds payments by that carried key, unreversed (books-store.js:215 reversal shape), debits on the head's output/rcm role. A legacy payment with no carrier counts only by the single-candidate rule (design 4); otherwise `paid_note`, close still posts.
3. `gstClose`: `setOffOf` on the base gives payable. `paid` = all named payments (in + after). `still_to_pay = max(0, payable - paid)`, `excess = max(0, paid - payable)`. Keys additive, same shape in IN/AU/AE: `paid_before_close_minor`, `still_to_pay_minor`, `excess_paid_minor`, `paid_note`.
4. Surplus entry (design 3.5), same transaction, after `tax_setoff`: per head with excess, Dr the pack's `advance` role, Cr the output head, exactly `excess`, dated today(shop). Check: output 10000 - pay 10000 - set-off 4000 + surplus 4000 = 0, advance 4000, for BOTH dates. A pack without `taxLedgers[head].advance` (AU, AE today) answers the keys + `paid_note`, posts no surplus (RB-COUNTRY-19/20 open).
5. **Replay.** Rev 4 read payable from the span.end balances after the close; with add-back that is wrong for in-period payments (K5: a recompute answers payable 0). Options for the critic: **(B, recommended, no migration)** utilised from the set-off entry's own debits (`entryDebitsByRole`), payable = base output (ledger as at the close entry + add-back of named payments created before the close entry) minus utilised; **(A)** store payable/carried on the set-off entry (new nullable column, production SQL, Athi runs it). Either way a replay never calls `setOffOf` on today's ledger.
6. Order of reads: after the lock and the `seen`/`closed` branches (:781-783 unchanged); the paid read failing (foreign currency line, carrier column absent) omits the keys, says why, and never blocks the close.

## 4. Hand figures (IN, October 2026; output CGST 10000, input CGST 4000; payments name October) — the tests assert exactly these
| case | payment | base output | utilised | payable | paid | still | excess | ledger after: output / input / advance |
|---|---|---|---|---|---|---|---|---|
| K1 after the period | 10000 on 9 Nov | 10000 | 4000 | 6000 | 10000 | 0 | 4000 | 0 / 0 / 4000 (main: +4000 / 0 / 0) |
| K2 gross, in period (336b) | 10000 on 20 Oct | 10000 (0 + 10000 added back) | 4000 | 6000 | 10000 | 0 | 4000 | 0 / 0 / 4000 (main: 0 / 4000 / 0) |
| K3 partial after | 6000 on 9 Nov | 10000 | 4000 | 6000 | 6000 | 0 | 0 | 0 / 0 / 0 |
| K3b partial in period | 6000 on 20 Oct | 10000 (4000 + 6000) | 4000 | 6000 | 6000 | 0 | 0 | 0 / 0 / 0 (main: payable 0) |
| K4 none | - | 10000 | 4000 | 6000 | {} | 6000 | 0 | -6000 (credit, owed) / 0 / 0 |
K5 replay of K2: same utilised 4000 / payable 6000, duplicate, same entry_no.
**Change to rev 4 case 5** (6000 dated 20 Oct: it said payable 0, paid 6000, still 0): under add-back `payable` is what the period owes before payments (6000) and `still_to_pay` is 0. The screens that read `pay_total_minor` get 6000 where main gave 0 for an in-period payment; that is the point of 336b (the return's 6.1 cash column is 6000 paid), but cb-ux-locale/cb-api must be told.
Not yet in the test file (to add in the build round, from design 7): reversed challan before/after the close (T5), foreign currency (T8), legacy no-carrier (T8b), carrier column absent (T8c), RCM head (T9), IN cross-head IGST/CGST (T10), payment above output (T11, excess 6000), later-period output not eaten (T12, T17), next period (T16), AU/AE keys + no surplus (T14/15/18), concurrent pay+close both orders (realstack, T13), close day not open fails whole (T19).

## 5. Paths touched (PM/RULE-MATRIX.md columns)
- purpose: IN month close (GSTR-3B), AU BAS quarter, AE VAT201 period; reverse-charge heads (rcm debits join the same read; `refuseUnnettedRcm` unchanged).
- how made: challan through POST /gst/pay (carrier written); a payment with no carrier (history, move-in/import); a MANUAL journal Dr output tax (not a challan: not counted, stays in the ledger balance exactly as today); a reversal of a challan (not counted; after the close the close stands, design case 7).
- reader: `gstClose` (the only one that changes); `refuseOverpay` (today's balance, unchanged; a later ticket may refuse above net due); `gstPayableAt` / books-cashflow.js:509 and books-todo.js:175 (no option, unchanged); gst-returns.js:1117 return 6.1 (calls gstSetOff on its own read; must be CHECKED in the build round to show paid in cash from the same stored payments, not recomputed); web peGstClose (additive keys).
- country: IN full (advance role live in engines 1.85.0, b850 chart rows); AU/AE keep keys + `paid_note`, no surplus until their advance role and wording ship.
- copy/replay: the stored close entry answers; idempotency unchanged (`gstclose:<key>`).

## 6. Risks and what another area must do
- cb-db: nothing new if replay option B; option A needs a migration. b849/b850 are live (Athi ran them 9 Nov).
- cb-api: output shape keys in docs/contracts + register rows (design 8); `POST /gst/pay` returns `tax_period`.
- cb-country: AU/AE `advance` role + wording; engines needs no change for IN.
- cb-ux-locale: screen wording for "paid for this period / still to pay / paid in advance" (Athi approves).
- Money-moving: the first close after deploy posts a surplus entry for any past period with named payments; the build round states how an ALREADY-closed period is left alone (no re-close, no backfill).
- Not done here: no lib code. Tests are red on main by design.

## 7. Verdict requested
BUILD WITH CHANGES expected: (a) confirm add-back unified rule over rev 4's "dated_after only"; (b) pick replay option A or B; (c) confirm the case-5 change.
