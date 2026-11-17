# Critique · WX-P2P (walk procure-to-pay on a real stack) — written before the build; resumed 13 Oct 2026

**(a) What the brief assumes, checked against the code**
- A real stack can run on the runner: TRUE — `tools/sim-load.cjs --schema` (api, docs/SIM-LOAD.md) built the schema on `postgres:16`; `e2e/lib/stack-local.cjs up` starts `server.js` on 3000 and `public/` on 5173 (new in this round; `walk.cjs start()` takes `opts.base`, e2e/lib/walk.cjs:62).
- The loader gives two parties: PARTLY — it gives ONE shop per run, always named "Simulated Stores" with a private catalogue (tools/sim-load.cjs:250); the second shop is a second run (`--shop kumartrade --seed 11 --years 1`) plus four PATCH/POSTs the walk now does itself (`ensureSupplier`, e2e/walk-x-p2p.cjs).
- Every flow step has a screen: TRUE — docs/process/P2P.md rows 1–6 (Supplies/Intake · Suppliers › Order · the bill's ⧉ Lines · Goods in · Payables › Pay · Day book / Ledgers / TB / P&L / GST close).
- The loaded shop can take a bill today: FALSE — the loader hard-locks every month incl. the current one, so a bill accepted today posts into the next open year (WX-P2P-08); the depth half therefore buys as a FRESH shop registered through the api's doors, the width half walks the loaded one.
- A view-only login is refused on the writes: FALSE on the real stack — POST /api/books/payments had no level gate (only owner-only routes had one): a viewer recorded ₹10 (WX-P2P-15, fixed in the api this round with the rail ladder's own sentence).

**(b) Conflicts with DECISIONS-level rules / constructs**
- One calculation: the bill sheet paints the engine's `TotItemVal` per line (chit-sheet.js:147 via CBTax.moneyOf) — on a tax-inclusive line that is the rounded parts re-added (2 × ₹65.00 → ₹130.01). The sheet does no arithmetic (right); the slot is the engine's — an engines row (WX-P2P-16), not changed in a walk round.
- One place per thing: the sheet CSS (`.mhd/.mbody/.mfoot`) is copied in crm.html and finance.html and was MISSING in accounts.html (WX-P2P-14); this round adds the same rules there and lists the fold-into-one as a row.
- "Today" was computed in two places (the web's UTC day, the api's UTC day); main's F3b fixed the web (browser-local day) while this branch made the server's day the default (`books-hooks.dayOf`) — merged: the dues reads send no asOf and the server decides.

**(c) A simpler way** — none for the walk itself; the fixture is four api calls in the walk rather than a loader flag (the loader stays one shop, one truth).

**(d) Risks** — the api gate (`editor`) touches five write routes: a co-assist created before b173 with no access_level is EDITOR by `levelOf` (lib/access.js:51), so nobody existing is demoted. No migration. No engines change. Twin landing: api first (the gate), then web (the walk asserts the refusal). Other rounds: main's F3b touched `bkToday` (resolved in the merge).

**(e) VERDICT: BUILD WITH CHANGES** — (1) the depth half buys as a fresh shop (WX-P2P-08); (2) the supplier fixture lives in the walk; (3) engine findings (WX-P2P-16) are rows, not code.
