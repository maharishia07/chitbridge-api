# TAX-SRV1 — critique before build (rule 00)

⚠️ `../chitbridge-docs` is an empty checkout on this runner: TAX-LAB-REQUIREMENT.md, the area README and DISCIPLINES.md could not be read; the brief's inline G1–G7 + DISCIPLINES are the spec.

**(a) Assumptions, checked**
- G2 compute ignores the shop's setting — TRUE: `routes/tax.js:79` `priceIncludesTax: !!body.priceIncludesTax` (omitted → exclusive), while the counter reads `policy.price_includes_tax` (def 'yes', `lib/policy.js:128`; till.html `taxIncluded()`). Same bug in the sibling `routes/invoice.js:45`.
- The shop setting is readable without a new query — TRUE: `services.partyOfEntity` already SELECTs `policy_flags` (`lib/services.js:76`); `policy.flagOf` reads it (`lib/policy.js:410`, REV-01's fix).
- G1 a by-rate answer exists — TRUE: `tax.moneyOf(inv).by_rate` (`lib/tax.js:501`), the counter's own reader. Currency: `tax-lines.currencyOf` (`:167`); pack version: `regulation.lookup(country).version`.
- G3 the one price reader — TRUE: `services.priceLine` (money.priceOf + pricing structure, `lib/services.js:49`), already used by /api/invoice/build. Compute sends `unit_price: l.listPrice` = null for an item_id-only line → taxed as 0 (TRUE, `routes/tax.js:79`).
- G5 — TRUE: both routes answer `500 {message: String(e.message)}` (raw text). `lib/knownerr.known` exists; no tax codes yet.
- G7 "the shelf's no-slab rule" — the counter's Shelf job `noslab` (till.html MAINT_JOBS: no tax_slab AND no hsn, only when the shop charges tax: regular + tax number).
- The counter zero-rates a shop with NO tax number (`shopTax().charges`); compute does not (UNKNOWN whether callers hit it) — out of scope, named in the report.

**(b) Conflicts** — none with one-place rules: compute keeps `services.computeTax` → `tax.determine` (the counter's engine). Home facts must not select item_data values (tests/home-facts.test.cjs:183): the no-slab count is a SQL predicate, a count only, in the existing product-lab statement (no new trip).

**(c) Simpler** — no new engine/route: one widening of `services.partyOfEntity` (→ `shopOfEntity` returning the party + the shop's price basis) used by both quote routes; G1 adds `money` (moneyOf) + `currency` + `pack` to the answer; G7 adds one FILTER to product-lab's existing count.

**(d) Risks** — behaviour change for API callers who omitted priceIncludesTax at an inclusive shop (they were billed tax on top: that IS the bug). Product-lab's second line now joins two problems (" · ", as the accounts card does); the 2-line cap holds. No migration (b502–b504 unused). No engines change. Web: no contract change expected (product-lab and tax routes are not in web-api.json) — web PR only if the contract moves.

**(e) VERDICT: BUILD WITH CHANGES** — fix G2 in /api/invoice/build too (sibling); G7 lives on the Product Lab Home card, not a new card.
