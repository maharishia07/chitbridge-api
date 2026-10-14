# Critique · T3-FIXES — four correctness findings (written before any code, 2026-10-14)

**(a) What the brief assumes — checked** (MAINT-PLAN and the cited specs are MISSING: ../chitbridge-docs is empty on this runner; checked against code)
- Cost gate on PATCH /products — TRUE: routes/products.js:1163 (`COST_BLIND_ALLOWED_FIELDS=['status']` + `safeCanSeeCosts`). POST /api/till/price (routes/till.js:1492), POST /products/:id/schedule (products.js:1236), POST /combo-templates/:id/push (combo-templates.js:144) — TRUE, none apply it.
- PATCH /entities/profile writes the co-assist's row — TRUE: entities.js:882 `id = req.identity.identity_id`; for a co-assist the GSTIN/address/name/visibility land on the actor row. `auth.entityOf(req)` (middleware/auth.js:442) is the shop.
- Import cut at >400k cells silently — TRUE: lib/xlsx-read.js:39/204 sets `truncated`; routes/products.js preflight and import never read it. GTIN check digit not called — TRUE: lib/gs1.js `classify/describe` exist, csv-preflight never calls them (and must stay zero-dependency, csv-preflight.test.js:296).
- stock-from-chit.js ~131 `[OBJECT OBJECT]` — TRUE: the counter's goods-in writes `item_data.lot = {batch, expiry,…}` (till.html lotSet ~22150, chitOfDoc ~6398); `d.lot` is an object → `lotKey()` → `'[OBJECT OBJECT]'`; expiry read from `d.expiry` (absent) → null. Every batch of an item collapses into one lot.
- Owner sign-in re-stamps 'base' — TRUE: signin.js:542 `chosen = body.constitution || 'base'`, then `ON CONFLICT DO UPDATE` on every owner sign-in.
- Counter's /verify sample check deleted 25 Sep — TRUE: api be02d62b deleted `verifyCounter()`; the commit records Athi chose delete over revive. GET /api/till/verify is still live (keyWatch, till.html ~19554). web e2e/tests/till-verify.spec.js still calls `verifyCounter()` → it cannot pass.

**(b) Conflicts** — one cost gate: lift the PATCH rule into lib/cost.js (it already owns canReadSafe) and point all four routes at it, not four copies. Lots: reuse gs1.lotOf (engine) — no edit to lotfields/gs1 (vendored). Refusals the client branches on carry a code (`COSTS_HIDDEN`).

**(c) Simpler** — CTR-VERIFY: RETIRE the counter steps honestly (owner's 25 Sep decision), keep the server /verify step and the refresh-heals-a-ghost step (it never needed verifyCounter). No till.html change → no vendor copy.

**(d) Risks** — data: a co-assist PATCH now writes the shop row (intended); hat-gate still refuses viewer/messenger writes; currency/user_id stay entity-only. Money: none computed. Security: the gate narrows writes only. No migration (b499–b501 unused). Twin PRs: api + web (spec only), land in any order. Engines untouched. Other rounds touching products.js/till.js/entities.js may conflict textually.

**(e) VERDICT: BUILD WITH CHANGES** — (1) one gate helper `cost.writeRefusal` in lib/cost.js used by PATCH, till/price, schedule, combo push; (2) lots via gs1.lotOf; (3) gs1 injected into preflight (stays Tier A); (4) CTR-VERIFY = retire, not restore.
