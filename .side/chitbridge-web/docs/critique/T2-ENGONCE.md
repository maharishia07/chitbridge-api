# Critique · T2-ENGONCE — each engine once inside web (written before any code)

(a) Brief assumptions, checked
- "8 engines adopted twice" — TRUE: engines.lock.json `adopt` lists app/+engine/ for pricing · offers · variant · search · govcontext ·
  locale (6, byte-identical, `cmp`), plus bundle `public/app/tax.js` (reg-* + regulation + tax-packs + tax) beside `public/engine/tax.js`
  (the same + tax-slab), plus `public/app/tax-slab.js` (tax-slab, also inside engine/tax.js) = 8.
- "baseline 6,191 lines" — TRUE: `wc -l` of the 8 public/app copies = 113+1043+463+252+222+922+2840+336 = 6,191.
- "public/engine/ is the one home" — TRUE (till.html, promo, store, embed, country-lab already load /engine/*).
- The MAINT-1 baseline / RECONCILIATION docs — UNKNOWN: ../chitbridge-docs is an empty checkout on this runner; metric re-derived above.
(b) Conflicts: none with DECISIONS rules. `public/app/tax.js` (no slab) → `engine/tax.js` (with slab) ADDS window.CBTaxSlab on
  accounts/finance/settings/crm. The only readers of CBTaxSlab (app.html, cap-catsetup, cap-definitions) load on app.html only, which
  already had it — so no screen changes. In app.html, tax-slab now loads BEFORE tax (bundle order), which is what tax.js asks for
  (tax.js "Load tax-slab BEFORE tax"); CBTax.slab is a lazy getter so either order already worked.
(c) Simpler way: none simpler — a redirect/alias would keep two paths. Plain path rewrite + delete + lock edit + guard.
(d) Risks: api tests read web public/app/{locale,govcontext,variant,offers,pricing,search}.js (money-language, govcontext, variant,
  offers-engine, search-engine) → a TWIN api PR re-points them to public/engine; LAND WEB AND API TOGETHER (the api tests fail on
  web-without-api). Other rounds that add a `<script src="/app/locale.js">` will fail the new guard — that is the intent.
  No money, data, migration (b457–b459 unused), security or engines release involved (the engines repo is not touched).
  e2e/contract.cjs is already red on main (1 failed) — pre-existing, not this round.
(e) VERDICT: BUILD AS BRIEFED.
