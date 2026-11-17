# Critique · MOVE-IN W1.11 — India's no-tax lanes before the IN map (G2, 2026-10-18, written before code)

(a) What the brief assumes, checked against the code
- The gate is lib/move-in-gate.js and reads engines country.moveInFor — TRUE (move-in-gate.js:34-39 `shopRules_`).
- Today an IN shop is refused for EVERY kind because IN has no `moveIn` map — TRUE (move-in-gate.js:37; tests/move-in-country-gate.test.cjs:69).
- The gate does not know the kind — TRUE (move-in.js:217 calls gate() without it); `kind` must be handed in.
- "An item with any tax field" — the item columns that carry tax are `sales_tax`, `purchase_tax` (move-in-gate.js:63 CODE_COLUMNS); HSN is NOT
  a field today (move-in.js:80-89), so an HSN/SAC column is silently unmapped — FALSE for the brief's "HSN-linked tax": a field is needed to hold on it.
- The hold mechanism exists (move-in.js:227 hold_, code `tax_code` in move-in-proof HOLD_CODES; proof is jsonb, no CHECK) — TRUE, no migration.
- GB "has a map" — FALSE: only AU carries a `moveIn` map; GB has no pack at all (country.ids() = IN AU AE SG MY US JP). Tested as no-pack.
(b) Conflicts with rules
- "A caller never names a country" (engines country.js header, R5): `if (id === 'IN')` in the gate is forbidden → the fact belongs to the PACK:
  reg-in `moveInNoTax: true`, read through country.moveInFor (engines serial: next tag v1.68.0, adopt pins reg-in · regulation · country).
- Making it generic (every pack without a map) would open AE/SG/MY/US/JP without a decision — DECISIONS:83 names IN only. Not done.
- Which KINDS carry no tax is the importer's knowledge (its kinds) → stays in the api gate, next to CODE_COLUMNS: one list, one helper.
(c) Simpler way: none that keeps both rules (no country name in a caller · IN only). The engines change is one boolean + one answer field.
(d) Risks: country match / no-pack / foreign fingerprint must run unchanged for every lane (they run before the lane check; tested) ·
  planners must survive `map: null` (items planner calls map.supplyKindFor — guarded; contacts never reads map) · an IN item with an AU code
  stays MOVE_IN_FOREIGN (whole file), stricter than a hold — intended · web shows MOVE_IN_COUNTRY as "from another country" (cap-move-in.js:39)
  for the not-ready refusal too — an existing copy gap, web area, reported not fixed.
(e) VERDICT: BUILD WITH CHANGES — the IN-only fact as an engines pack member (not a country name in the api); an `hsn` item column so an
  HSN-linked item is held, not silently landed.
