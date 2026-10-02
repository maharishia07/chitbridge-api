# Cloud task — one invoice, everywhere: the counter's bill carries its tax; the server stores and posts it as issued

**Outcome (one):** a counter bill's invoice — the figures the counter printed — travels on the chit, is stored as
issued, and is what BOTH ledgers post and every reprint prints. Place of supply for a counter bill is the shop's state
(over-the-counter), so the heads are CGST + SGST, unless the bill records delivery to another state (then IGST).

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

## Build
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
