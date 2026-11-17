<!-- Owner: cb-accounting (built on Sonnet; Fable review next week, AFTER landing) · Status: Live -->
# CRITIQUE + JUDGMENT LOG · ACC-206 api steps A and B (2026-10-30)

Verdict carried from C:/dev/docs/critique/ACC-206.md (cb-critic, Fable): **BUILD WITH CHANGES** (8) — all eight were folded into PLAN-ACC-206.md and built here as the plan states.
Engine: chitbridge-engines v1.74.0 (aff89ab, PR #78 merged and tagged) — adopted by the tag (`engines.lock.json` tax 1.74.0; `adopt.cjs --check` clean).
This file is the place the Fable reviewer looks first: every call that was a judgment, with where it lives and what it would cost to change. Nothing below was decided silently.

## What was built
- A (api #440 rebased onto main 69e9c5d0): `lib/send-money.js` scopes the engine by purpose, calls it once, reads its bridge as data; `calculateSummary` counts only; `sendMoney` has no
  gross/net/savings/total arithmetic; `total_value` = `money.total`; `summary_json.stamps`; 409 `MONEY_UNBALANCED` + owner `money_override`; 422 / 503 before any write.
- B: `counter-bill.pickOf` (the one pick) read by books-hooks (Mark-paid quote, the equality check before posting, the override narration); `lib/money-check.js` (compare + raise to our
  support desk: unique `client_ref`, `/health money_mismatch`, one mail + hourly digest); books to-do `money_unbalanced`; `POST /api/books/money-check/resolve`.

## JUDGMENT CALLS (J) — each one is a place to push back
- **J1 · offers are NOT handed into the engine yet.** `determine({ offers })` exists (bridge step 2 has its own source), but api `offers-live` returns `applied` with POSITIVE, ABS()'d, prorated amounts, and
  the engine wants `evaluate().adjustments` signed as the offers engine gave them. Turning the `offers` step on from the api means either a sign flip (arithmetic) or a new return field from offers-live
  (catalogue's file), and a one-paisa proration difference between the cart shares and the adjustment would STOP a good bill. So the bridge's step 2 is the lines' own discounts as ONE declared row
  (`discount`). Consequence: the plan's "a mis-stated offer → 409 naming `offers`" is not live; every other step is. *Change:* offers-live returns `adjustments` untouched, chits.js passes them to `invoiceAtSend`
  (one line each) — after catalogue confirms cart-share rounding ties to the adjustment amounts.
- **J2 · a counter bill with NO invoice (an older till) gets `total_value: null` and no money block.** Not the line sum (the route adds nothing up), not an engine run (it would attach a tax slip the customer never held;
  tax-truth test: the reprint says "Tax detail not kept for this bill"). *Changed tests:* tax-truth O.shopCopy, send-gorilla GS-3 (no invoice → no invented sum). Books still post these at the live recompute, provisional, as before.
- **J3 · billing purposes = `order`, `invoice`, `credit_note`, plus a captured sale (`general` with `business_json.via`).** `receipt`, `delivery_note`, `expense`, `income`, `inquiry`, other `general`: `total_value` null, no money.
  Before, they carried the line sum. A captured paper receipt's Amount column now reads "—". `offer` is not a valid /chits/send purpose (catalogue path; unchanged).
- **J4 · several recipients (non-order) = not applicable (null)**, as chits.js:1334 did for tax/total. An ORDER or a send with no named buyer is the walk-in of the seller's country (figures present).
- **J5 · a draft** runs the engine for provisional figures (`provisional: true`), attaches no invoice and is never stopped.
- **J6 · the engine prices from `price × qty − discount`, not from the client's `line.total` or `list_price`.** The old route used `line.total` for net and `list_price` for gross. A line the client already discounted
  (price 450, list_price 500, no `discount`) used to show savings 50; it now shows 0 (tests/fixtures/send-golden.json re-frozen, said in the PR). Fixing it needs the engine to accept `list_price` per line (engines request).
- **J7 · 422 `MONEY_INPUT_UNREADABLE`** fires on a present but non-numeric `price | quantity | total | list_price | discount` (the engine would read it as 0 in silence). The field list is my call.
- **J8 · a negative line** now stops at `gross` (the engine's bridge). A composed credit note with NEGATIVE lines would now 409. I did NOT check what the web composer sends for a credit note (web repo, not read): the engine's own contract is positive lines under the credit-note purpose. Open for the reviewer / cb-rail. The counter's `credit_note` carries its own invoice.
- **J9 · a non-counter chit that arrives with its own `business_json.invoice`** is mapped as carried (as #440 did) and its bridge verdict honoured; only the counter's is re-checked by the server. This trust existed in `tax-copy.entryFor` already.
- **J10 · the override is the owner's alone** (`overrideBy` widened with `needWhy`; a typed reason required). The record's `by` is the session's id, never the body's. An override claimed on a bill that balances is DROPPED (opens no item).
- **J11 · `chit_detail.total_value` is 0 (not null) for not-applicable chits** — the definer function COALESCEs. `summary_json.total_value` is the truth; no migration was written (none was asked). cost.js reads the column.
- **J12 · the pick answers `agree: false` only for a STAMPED chit.** Unstamped chits where only `total_value` differs are `legacy_net` (the route's old net) and raise nothing, exactly as the plan says. A chit sent by #440's code (no stamps) with a wrong `total_value` is therefore not raised.
- **J13 · the 6-hourly compare is the existing sweep** (`books-nightly` step 2b → `postChit` → `classify`), not a new SQL scan; it covers the closed days it already sweeps. A retry of the outbox never raises again (the first attempt did).
- **J14 · `books_change_log` carries the resolve** (table `money_override`, field `resolved`, old=how, new=note) instead of a new kind column; the to-do read bounds itself to 400 days and 50 rows because the key has no index (cb-db / cb-speed to look at the plan).
- **J15 · the ticket is Sev-2, audience platform.** `SUPPORT_ALERT_TO` is unset until Athi sets it; the ticket and the counter fire regardless. The help-desk number in the shop's sentence is passed in by the caller (`billTotalOf(header, helpDesk)`); no screen reads it yet (plan D).

## NOT DONE (open, said plainly)
- **Amend after send (critic D2 / plan Q10).** Re-running the engine on an amended document and storing its figures on the amendment event needs a place to store them on `chit_line_amendment` (a migration, which the plan says there is none of) and cb-rail's decision on line events. Left; today an amended chit keeps the figures it was sent with (`amend.js` untouched).
- **Plan B items not built:** books-hooks.js `:212` by_rate total, `:935` round-off absorb, `:975` round_off derivation, and `tax-lines.js:325` still do their own arithmetic over posting rows (the plan hands these to "the engine's data"; that is a rewrite of posting, not a copy). The guard that lists them is step G.
- **Not in A+B (plan C/D/H/G):** SQL twin and list readers (select.js, rollup, notifications, kyb, forms, cost.js:164), web readers, the till's offline stop + PIN override UI, the arithmetic guard. The till keeps vendoring its own engine copy: cb-counter must `vendor-till` for tax 1.74.0 (the counter will then send an invoice with `_cb.bridge`, and the server stops/override-checks it).
- **cb-api must re-sign** the touched routes: POST /api/chits/send (new 409 / 422 / 503, new body key `business_json.money_override`), POST /api/books/money-check/resolve (new), GET /health (new key).

## Risks watched
- A good bill stopped by a bridge identity: the engine's identities are per-line and exact (v1.74.0 tests), proven here over IN / AU / AE, ex-tax and tax-inclusive. The first live sign is a `money.override` log line or a 409 in the send log.
- The golden send fixture grew (the full invoice now rides every billing chit): payload size per chit rises by the invoice (about 2-3 KB). cb-speed to measure.

## Left alone on purpose
- `scripts/tax-truth-breaks.cjs` (a hand-run break-then-restore tool): 7 of its anchors were already stale on main ("anchor not found"), and two more lines it names in routes/chits.js (`issuedTotal`, the one-line `return { gross: m.gross …`) no longer exist. Touching the file makes the readability guard demand a module header, a CARD line and a test for a tool nobody runs; cb-maintainability / cb-janitor to repair or retire it.
