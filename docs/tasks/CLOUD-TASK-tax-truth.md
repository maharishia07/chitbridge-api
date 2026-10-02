# Cloud task — one invoice, everywhere: the counter's bill carries its tax; the server stores and posts it as issued

**Outcome (one):** a counter bill's invoice — the figures the counter printed — travels on the chit, is stored as
issued, and is what BOTH ledgers post and every reprint prints. Place of supply for a counter bill is the shop's state
(over-the-counter), so the heads are CGST + SGST, unless the bill records delivery to another state (then IGST).

## ⭐ Final design (Athi, 2026-10-02) — supersedes "Build" below
*"The computation should happen in only one place like billing, rest all the places the value has to only read, no
recomputation … recomputation can be done, but cannot rewrite what has been already wrote."* And main adopted tax-packs
v1.10.0: India's `invoice_round_to` is 0.01, so the invoice total is to the PAISA (bill 0007 stays ₹1,118.16, RndOffAmt 0).

The one module already existed: **`CBTax.determine()`** (lib/tax.js; `window.CBTax` on the counter, served as
`/engine/tax.js` from lib/tax-engine.browser.js). It computes the whole INV-01 invoice, and its output IS the shape of
`business_json.invoice` that lib/tax-copy.js `entryFor` posts a frozen invoice from.

| | Where | What it does |
|---|---|---|
| **A · billing computes once** | `till.html` `billMoney()` | `CBTax.determine({ seller: the shop, buyer: the customer with Pos = CBTax.placeOfSupply(), lines: qty · unit_price · discount = the offer saving · gst_rate · hsn · cess_rate, priceIncludesTax })`. `moneyOf(inv)` is the engine's `CBTax.moneyOf` with the counter's display names put on its fields (net = total, base = taxable, save = savings, round = round_off, byRate = by_rate) — no arithmetic. No fallback formula: with no engine billMoney answers zeros and no invoice, and `finish()` refuses the sale ("Prices cannot be worked out on this counter right now. Press refresh while online.") — it never saves a ₹0 bill. |
| **B · the chit carries it** | `till.html` / `till.js` `chitOf` | `business_json.invoice` = determine()'s result, unchanged (and `delivery`, for the place of supply). |
| **C · the server only reads** | `routes/chits.js` | stores the invoice as sent; `summary_json.money` = `moneyOfInvoice()` = the header fields of the engine's `moneyOf` (`require('../lib/tax').moneyOf`), picked, not added; `total_value` = its total (TotInvVal). |
| | `lib/tax-copy.js` `entryFor` | posts the stored invoice for both copies (the existing frozen path); its recompute (`taxLines.invoiceFor`) is a CHECK only — `tax_check` on the entry, `business_json.tax_check` + log `tax.check-differs` at send; never written over. |
| | `routes/till.js` `/bills` · `till.html` `slipOfRow` | the row carries the stored invoice; the reprint reads it through the same `moneyOf`. |
| **D** | `lib/issued-invoice.js` | only `check()`. The place-of-supply rule is the engine's `placeOfSupply` (lib/tax.js, tax v1.11.0) — `lib/tax-copy.js` requires it, the counter calls `CBTax.placeOfSupply`; no hand-kept copy anywhere. |

New keys (dictionary): `summary_json.money.taxable` (derived = ValDtls.AssVal; written by routes/chits.js; read by
routes/till.js /bills) · `summary_json.money.round_off` (= RndOffAmt; same writer) · `summary_json.money.issued` (true when
mapped from a carried invoice) · `business_json.delivery` ({ state_code, address }; written by the counter; read by
the engine's placeOfSupply) · `business_json.tax_check` ({ at, differences, kept: 'issued' }; written by routes/chits.js; read by the
health view) · the till snapshot's `customers[].gstin` (identities.gstn; read by billMoney as the buyer's GSTIN).

Proof: `node tests/tax-truth.test.cjs` (38 checks — the six readings equal to the paisa, place of supply 33, intra; the
variants; billMoney computes nothing of its own; the engine's placeOfSupply and moneyOf are the only ones; with the engine
missing finish() refuses the sale) · `node scripts/tax-truth-breaks.cjs` (19/19) — outputs beside this file.

**Amended 2026-10-02 (review, after main adopted tax v1.11.0):** the hand-kept copies are gone — the counter's
`placeOfSupply`, `lib/issued-invoice.js` `placeOfSupply` and the arithmetic in the counter's `moneyOf` and the server's
`moneyOfInvoice` now read the engine's `placeOfSupply` / `moneyOf`; the byte-for-byte copy test went with them (one text
now; it also failed on a Windows checkout). The comment that said the counter "already refuses to sell" (`counterStops`)
was not true — no such check existed and a bill completed at ₹0 with the engine missing; `finish()` now refuses, with a test
and a break. The web copy (`public/till.html`, `public/engine/*`) is synced after merge by `node scripts/vendor-till.cjs`;
`till-vendor` and `pages-parse` stay red in CI until then.

**Read first:** `docs/tasks/TAX-TRUTH-2026-10-02.md` (the diagnosis, with the real bill C2/26-27/0007 read six ways).
The decisions, verbatim from Athi's `DECISIONS.md` (2026-10-02):
- *One invoice, everywhere* — "the figures the counter prints ARE the invoice (CGST Act s.31, Rule 46; the buyer's ITC
  s.16 rests on the invoice as issued) … Nothing recomputes a different tax for an issued invoice; a recompute may only
  CHECK and name a difference. The total is taxable + tax rounded once, with the round-off declared."
- *Place of supply follows the law, not the buyer's GSTIN* — "IGST Act s.10(1)(a): where the movement of goods
  terminates for delivery. A counter bill is handed over at the counter → the shop's state → CGST + SGST, even for a
  registered buyer from another state. Only a bill that records delivery to another state is inter-state → IGST.
  Rule 46(n): the invoice names the place of supply and its state. ONE function decides it for the counter and the
  server alike."

**Branch:** you are on `cloud/tax-truth` (cut from `main`). Open a PR against `main`; never push to `main`.

## Build (the first pass — superseded by the final design above)
1. **The bill carries its invoice** — `tools/tally-connector/till.html` `chitOf()` (~5918): add
   `business_json.invoice = { taxable, tax, total, round_off, supply, pos_state, by_rate, heads, priced_inclusive }`
   from the bill `billMoney()` built (never recomputed in chitOf), and per line `gross · taxable · tax · cgst · sgst ·
   igst` next to the fields it already sends. Same for the shop-PC program if it builds chits itself
   (`tools/tally-connector/till.js` — check; one shape for both hosts, a helper if it is two call sites).
2. **Place of supply, one function** — the counter's `CBTax.supplyType(sc, sc)` (~17455) compares the shop with itself.
   Replace the call with ONE helper used by both the counter and `lib/tax-copy.js`: `placeOfSupply(bill/business_json,
   shopState)` → the shop's state for a counter bill, the delivery state when the bill records a delivery address in
   another state. Do NOT change the engine repo (`chitbridge-engines` is harden-only) — pass the right state in.
3. **The server stores and posts what was issued** — `lib/tax-copy.js` (partiesFor ~36–95, invoiceFor callers): for a
   counter bill (`counterIssued`), BOTH copies (the shop's sale, the rail customer's purchase) take the carried
   `invoice` block and per-line figures as the invoice: taxable, heads, total, round-off. The buyer still comes from the
   rail (GSTIN, legal name — GSTR-1 b2b) but `Pos` is the counter's place of supply, not the buyer's state.
   Recompute ONLY to check: when the server's own result differs from the carried one by more than ₹0.00, keep the
   carried figures and record the difference by name (a `tax_check` note on the chit / a log line the health view can
   list) — never replace silently. A bill with NO carried block (older bills, other hosts) keeps today's path, and its
   place of supply follows rule 2.
4. **The total and the paisa** — the chit's stored total (`detail.total_value` or wherever the server sets it) for a
   counter bill is the carried `invoice.total` (taxable + tax, rounded once), not the sum of line nets. The ledgers post
   that total; the round-off is its own declared line where the books already have a round-off ledger (6900).
5. **The reprint prints the original** — `reprintOld` (~23701) feeds `showSlip` a server row: give `showSlip` the
   carried invoice (by_rate/heads/taxable/tax/total, line gross) so a duplicate is the same document as the original.
   A row with no carried block says so on the slip ("tax detail not kept for this bill") rather than printing GST 0.00
   on a tax invoice.

## Proof (exit codes; commit outputs) — OFFLINE, no database, never the live API
- A new end-to-end test on the in-memory harness (pattern: `tests/two-sided-books.test.cjs`, `tests/tax-copy.test.cjs`):
  one counter bill with the C2/26-27/0007 lines (mixed 12% and 18%, offers, inclusive prices, shop state 33, a rail
  buyer with a GSTIN from another state) read SIX ways — the counter's bill, the chit as stored, the seller's posting,
  the buyer's posting on acceptance, the reprint's slip data, the buyer's invoice read — every figure equal to the
  paisa: taxable 998.21 · CGST/SGST by rate · total 1118.16 · intra · place of supply 33.
- Variants: a bill recording delivery to another state → IGST everywhere; an exclusive-price shop; a walk-in; a bill
  with no carried block (old path unchanged, place of supply = shop's state); a carried figure that disagrees with the
  server's recompute → carried kept, the difference named.
- A breaks file (restore from a COPY, anchors on ONE line, CRLF-safe): drop a carried figure in chitOf; let the server
  recompute over the carried figures; use the buyer's state as place of supply for a counter bill; sum line nets as the
  total; reprint without the carried block printing GST 0.00 — each caught.
- The counter harness for the slip/reprint if one exists (`e2e/till-*.cjs` in this repo — the ONE harness for that
  screen, not the whole counter suite), and `node scripts/guards.cjs` → 0 (add the new tests to the offline set).

## Do not touch
SQL / migrations (if a column is truly needed, write the migration file and STOP — Athi runs SQL), the engines repo,
the web repo (its vendored `public/till.html` is synced after this merges), live services. Commit messages end with
`Co-Authored-By: Claude <noreply@anthropic.com>`.
