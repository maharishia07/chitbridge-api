# TAX-SRV1 · the tax compute route agrees with the counter — critique before build (2026-10-14)

Area docs: `../chitbridge-docs` is EMPTY on this runner — TAX-LAB-REQUIREMENT.md (SERVER GAPS), the area README and DISCIPLINES.md could not be read; the brief's inline G1 G2 G3 G5 G7 and DISCIPLINES copy were used.

**(a) What the brief assumes, checked**
- G2 compute ignores the shop's setting — TRUE: routes/tax.js:85 `!!body.priceIncludesTax` (left out → exclusive), while the counter taxes inclusive unless the shop says 'no' (till.html:7990 `taxIncluded`, lib/policy.js:128 default 'yes'). Same bug in routes/invoice.js:45 (sibling, fixed too). The shop's flag is already in hand: services.partyOfEntity SELECTs policy_flags (lib/services.js:76).
- G1 the answer has no currency / pack — TRUE: compute returns `invoice` + `heads` only. By-rate already exists: tax.moneyOf (lib/tax.js:501, the summary_json.money shape, `by_rate`); pack = regulation.status (lib/regulation.js:179, as country-setup.js:141 answers it).
- G3 item_id-only line is unpriced — TRUE: compute sends `unit_price: l.listPrice` (null → 0). The one price reader is services.priceLine (money.priceOf + pricing.unitPrice). ALSO FOUND: shelfOf returns NO items when the shop has no GSTIN (tax-shelf.js:59 returns null) — an unregistered shop's item could never be found.
- G5 raw text on 500 — TRUE: tax.js:73/87 send `String(e.message)`. lib/knownerr.known + respond.safeErr exist.
- G7 no-slab rule — TRUE it exists once: tax-slab.resolve → source 'none' (reached via tax-lines.decorate). Home's Tax Lab card exists in web manifest.json:39 (state 'coming', facts null) — the fact belongs there, NOT on product-lab (its test forbids reading item_data: cost travels in it).

**(b) Conflicts** — "no silent India": regulation.lookup/currencyOf fall back to the default pack; the answer must say NO_COUNTRY / NO_COUNTRY_PACK and give currency null, never INR. One calculation: compute keeps calling services.computeTax → tax.determine (the counter's CBTax.determine is the same v1.43 engine). Engines untouched.

**(c) Simpler way** — none simpler: widen services (shopOf beside partyOfEntity; shelfOf keeps items when the shelf is null), lift ONE tax-lines.resolveItem used by decorate and the Home count.

**(d) Risks** — behaviour change for API-key callers who omitted the flag on an inclusive shop (they were over-taxed; now correct — said in the PR). A countryless shop is now refused (422 NO_COUNTRY) instead of taxed as India. Tax Lab fact reads item_data in full (tax keys only leave the server: a count). No migration (b484–b486 unused). Twin: api first, web (manifest facts URL + contract copy) second.

**(e) VERDICT: BUILD WITH CHANGES** — G7 lands on the tax-lab card (not product-lab); invoice/build gets the same G2 default; shelfOf keeps items for an unregistered shop.
