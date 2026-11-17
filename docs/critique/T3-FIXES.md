# Critique · T3-FIXES (CAT-FIX1 · STK-FIX1 · SIGNIN-CONST · CTR-VERIFY) — written before any code
⚠️ `../chitbridge-docs` is EMPTY on this runner: MAINT-PLAN-2026-10-14, the cited specs, area READMEs and DISCIPLINES.md could not be read; worked from the brief + code.

**(a) What the brief assumes, checked**
- Cost gate on PATCH /products — TRUE, routes/products.js:1173 (`COST_BLIND_ALLOWED_FIELDS`, `safeCanSeeCosts` → lib/cost.canReadSafe).
- POST /till/price has no gate — TRUE, routes/till.js:1492 writes price for any till-scoped caller. POST /products/:id/schedule — TRUE, products.js:1236 (no gate). Combo push — TRUE, combo-templates.js:144 (writes name/price/modifiers, no gate).
- PATCH /entities/profile writes the caller's row — TRUE, entities.js:882 `id = req.identity.identity_id`; a co-assist's display_name/address/gstn land on the actor row (user_id + currency already refused for actors).
- Workbook cut at 400k cells unsaid — TRUE, lib/xlsx-read.js:204 sets `truncated`; routes/products.js never reads it. GTIN check digit never called by the import — TRUE (lib/gs1.classify exists, csv-preflight does not use it).
- stock-from-chit ~131 → '[OBJECT OBJECT]' — TRUE: the till writes `item_data.lot` as an OBJECT {batch, expiry, …} (till.html:6398, lotSet 22150); `d.lot || …` takes the object, lotKey upper-cases `[object Object]`; expiry is read from `d.expiry`, which is inside `d.lot` → every batch one lot, no expiry.
- Owner sign-in re-stamps to 'base' — TRUE, routes/signin.js:551 `ON CONFLICT DO UPDATE` with `chosen = body.constitution || 'base'` on EVERY owner verify.
- /verify sample check deleted 25 Sep — TRUE, api be02d62b removed verifyCounter (unreachable dead twin; commit says Athi chose delete). till-verify.spec still calls verifyCounter() → that spec cannot pass.

**(b) Conflicts** — none with one-place rules if the cost gate is LIFTED into lib/cost.js (one refusal, four doors) rather than copied. Refusal ships with a code (`COST_BLIND`). Lots: lotfields.lotKey stays the one normaliser (adopted engine, not edited).

**(c) Simpler** — CTR-VERIFY: RETIRE the counter's verifyCounter steps (owner already chose delete); keep the server /api/till/verify proof and the ghost-heals-on-refresh proof, which need no counter UI. No till.html change → no twin vendor (web public/till.html is ALREADY stale vs api main — vendoring now would ship other rounds' till edits).

**(d) Risks** — cost gate on /till/price: a till paired by the OWNER's key is the entity → unaffected; only a cost-blind co-assist is refused (as PATCH already does). Profile fix: a co-assist could now edit the SHOP's name/address — hatGate (auth) still blocks non-editors; refusal for user_id/currency unchanged. Signin: first verify after register still sets the chosen vertical (an explicit `constitution` in the body may re-stamp); a plain sign-in only refreshes version/installation when the key is unchanged. Import: a cut workbook is REFUSED at commit (all-or-nothing, like >2000 rows). No migration (b481–b483 unused). Residual: the till's rcvAdd merges a second scanned batch of one product onto the first line (till.html:22211) — needs a till change + vendor; queued, not in this round.

**(e) VERDICT: BUILD WITH CHANGES** — gate lifted into lib/cost.writeRefusal; CTR-VERIFY retired (not restored); no till change.
