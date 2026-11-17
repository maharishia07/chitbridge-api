# Critique · WX-O2C (written on resume, 2026-10-13 — the first run pushed code before this file; recorded here, not hidden)

(a) What the brief assumes — checked
- flows.json has O2C with steps, screens, routes, tests — TRUE (docs/process/flows.json, O2C steps 1–7; step 2 'quote' is status missing).
- The loader's `--schema` exists — TRUE (api tools/sim-load.cjs, docs/SIM-LOAD.md:58).
- `--country AU` loads an Australian shop — FALSE: the adopted books engines answer packFor('AU') with the IN pack (INR, April year);
  the loader now refuses AU in words (api tools/sim-load.cjs:79). The AU leg of the walk is a NOTE until an AU pack is adopted (engines finding).
- A served web + api on this runner — TRUE (e2e/lib/walk.cjs serves public/; e2e/lib/real-stack.cjs spawns ../chitbridge-api/server.js).
- "Two parties": the loader makes ONE shop with its customers as local parties — a second on-network shop is not loaded (unknown → NOTE).
- Resume branch round/WX-O2C-38343007038 — did NOT exist on origin; the pushed work was on round/WX-O2C-38319738103; carried over as-is.

(b) Conflicts with rules / constructs
- Cart tax: the storefront added GST on top of a tax-inclusive price (a second calculation). Fix reuses tax-engine splitLineTax, not a copy.
- One shape per slot: the new catalogue key `shop.price_includes_tax` has its docs/FIELDS.md row in the same api change.
- Engines: none changed (rule 12). The AU pack is listed as an engines finding.

(c) Simpler way: none for the walk itself; the fixes are one-line source changes (shop-day `today`, own_bills filter) — no new routes.

(d) Risks: books.js default dates move from UTC to the shop's zone (a report opened 00:00–05:30 IST now shows the shop's day — intended);
open-orders own_bills filter changes the till's list (test added). No migration. Twin landing: api first (the key), then web (reads it,
absent → false = today's behaviour). Screenshots under e2e/shots are large; kept to the walk's own set.

(e) VERDICT: BUILD WITH CHANGES — AU leg as a NOTE + engines finding; quote (step 2) is a MISSING row, not built in a walk round.
