<!-- Owner: cb-country (builder) · 2026-10-30 · Round 1 E2 · the builder's written answers to the critic (docs/critique/AU-PILOT-2026-10-29.md, VERDICT CHANGE) -->
# CTRY-76 · a tax invoice of A$1,000 or more names its buyer — the builder answers the critic

**Verdict relied on:** C:/dev/docs/critique/AU-PILOT-2026-10-29.md — CHANGE (build after the changes), §C Q1 agreed with the plan; **Athi Q1 = yes, 30 Oct**
(PM/ROUND-1.md E2 "ready (Q1 yes 30 Oct)"): HELD, refuse only a bad buyer tax id. Design: C:/dev/docs/15-tax-and-country-packs/PLAN-AU-PILOT-2026-10-29.md §1 E2, §2 PR-A3.

**Law checked (not from memory):** A New Tax System (Goods and Services Tax) Act 1999, Compilation No. 96 (C2026C00081, compilation date 1 Jan 2026,
registered 30 Jan 2026, legislation.gov.au Volume 1 PDF, read 30 Oct 2026), s.29-70(1)(c)(ii): *"if the total price of the supply or supplies is at
least $1,000 or such higher amount as the regulations specify … the recipient's identity or the recipient's ABN"*; s.29-70(2): the supplier must give
a tax invoice *"within 28 days after the recipient of the supply requests it"*. "Price" includes GST (s.9-75), so the test is on the invoice total.
ato.gov.au (tax-invoices page, GSTR 2013/1) answers 403 to the runner — not re-read; the pack's cite to GSTR 2013/1 stands as the pack states it.

## The critic's changes that touch E2, answered

| # | Change | Answer |
|---|---|---|
| 2 | Build on api #440's shape (invoiceAtSend / checkCounterInvoice), not main's sendIssued; refusals OUTSIDE the fellBack try; buyer ABN check only for a domestic supply | #440 is still open (not on main, 30 Oct), so the build is on origin/main as the coordinator asked, as its OWN step `sendPaper` right after `sendIssued` in SEND_STEPS — no try/catch in it, so a refusal reaches the counter (tests/bill-paper.test.cjs §6 scans for this). The rebase onto #440 is one line (the step list). "Domestic only": the buyer id is checked only when the frozen invoice CARRIES tax (`tax-lines.heads(inv).tax > 0`) — an export or GST-free sale has none, a foreign buyer has no ABN; this is neutral (no supply word named) and it is what the law's "tax invoice" means. |
| 3 | One paper kind: store the engine's `document`, test `slip === document.kind`, no fourth name | `business_json.slip` is the PAYMENT kind (`bill.kind || 'cash'`, till.html:6606), not the paper's — the critic's read of it was wrong. The counter's existing name for "went out as not a tax invoice" is `business_json.not_invoice` with the REASON (`'shop_details'` M41; `'buyer_identity'` already written by the till at :21724). The server writes that same slot when the counter left it absent and never over a reason already there; the send answer carries `not_invoice: { code: 'INVOICE_HELD_BUYER', not_invoice, why, cite }`. No `document` key is added (the engine's `document` arrives with invoice.build, PR-A1). FIELDS row widened. The 28-day door ("name the buyer within 28 days turns a held bill into a tax invoice") is filed, not built: C:/dev/BACKLOG.md CTRY follow-up (see the PR). |
| 6 | PR-A1 is a money adopt with its own critique | Not done here: the money pin stays at 1.0.0. Only **reg-au moves 1.65.0 → 1.73.1** (the pack's own `buyer_why` sentence and the `held` slip title; pack-kit 1.65.0 already carries every KIT member reg-au 1.73.1 uses: int · lastDay · lineExtras · pad2 · refuse · singleHeadSetOff · ymd). The web twin must move its reg-au pin in the same batch (e2e/engines-pins-agree.cjs lists reg-au in the tax bundle) — cb-release. |
| 10 | au-truth: AU-04a asserts 200 + document.kind 'held' + INVOICE_HELD_BUYER | The truth case for the realstack (PR-A5) asserts 200 + `not_invoice.code 'INVOICE_HELD_BUYER'` + stored `business_json.not_invoice 'buyer_identity'`; the unit proof is tests/bill-paper.test.cjs (34 checks). |

## What is reused (seams run: `abn`, `invoice`)
- `profile.taxIdRefusal(country, number)` — THE tax-number check (country-setup.js:270, entities.js:1125, the profile save); now called for `business_json.customer.gstin` too. No second ABN routine; the mod-89 lives in reg-au `abnCheck`, read by the registry.
- `country.packFor(code)` (engines country v1.69.0) — null for an unknown country, never India.
- `pack.taxInvoice(totalMinor, facts)` — the pack's rule, called with the front door's call shape (engines invoice.js ruleOf_) so the swap to invoice.build is one call.
- `tax-lines.heads(inv)` — the one reading of a frozen invoice's figures; `books-cashflow.toMinor` — the api's minor-unit move (no third copy).
- `countryOfEntity` (chits.js:41, memoised; warm from the number check at :588) — no new SQL, send-golden unchanged (40/40).

## New paths, justified
- `lib/bill-paper.js` (owner module, 7 small functions): nothing on the api read the pack's buyer line; invoice.build is not adopted (money pin). Replaced by one `CBInvoice.build` call with PR-A1.
- Codes `BUYER_TAX_ID_BAD` (400) and `INVOICE_HELD_BUYER` (200, in the answer): registered in docs/ERROR-CODES.md with their shopkeeper sentences.

## Cross-country effect, said plainly
The code names no country; the PACK decides. reg-in v1.73.0 (already adopted on main, web and api) states r.46(f): from Rs 50,000 of taxable value to an
unregistered buyer, the recipient is named. The till already warns and writes `not_invoice 'buyer_identity'` for that case (buyerWarnWords, till.html:18394),
so the server now AGREES with the counter for India too; a named buyer reads as named (the till's reading — r.46(f)'s address + State are the front door's
fuller reading and arrive with invoice.build, said here so it is not a silent change). An IN bad GSTIN on a counter bill is refused by the same one check.
