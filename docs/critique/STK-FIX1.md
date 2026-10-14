# STK-FIX1 · a batch received at the counter becomes a real lot — critique before build (2026-10-14)

Area docs: `../chitbridge-docs` is EMPTY on this runner (a .git, no commits) — docs/13-*/SPEC, RECONCILIATION-14-Oct, the area README and DISCIPLINES.md could not be read; the brief's inline copies were used.

**(a) What the brief assumes, checked**
- Every batch becomes ONE lot "[OBJECT OBJECT]" — TRUE. The door writes `item_data.lot = { batch, expiry }` (till.html:22152 lotSet / :22211 rcvAdd → till.js:650 chitOfDoc; routes/till.js:1365 documents the shape). `lib/stock-from-chit.js:131` passes that object as `mv.lot`; `lib/lotfields.js:131` lotKey does `String(obj).toUpperCase()` → `[OBJECT OBJECT]` (upper case — the stored value). Every batch line of every receipt shares that key.
- No expiry kept — TRUE. `stock-from-chit.js:134` reads `d.expiry || d.expires_at`; the date is in `d.lot.expiry`. stock_balance.expires_at (b215) stays NULL, so FEFO sorts nothing.
- gs1.lotOf is the batch/expiry reader — TRUE and already the one normaliser: lib/amend.js:80 and lib/capture.js:383 read a line's lot through it; gs1.parseElementString reads the scanned (10)/(17) form (the till does that at the door, lotFromScan).
- ONE lot writer — TRUE: `lib/stock-store.js` post() is the only INSERT into stock_balance/stock_movement (issue() calls post()). Nothing to add.
- folder-inventory.js lists system folders under the stock area — FALSE in code. `lib/folder-inventory.js` is the Bills · Receipts · Expenses · Returns folder table numbered with the ledger; no api/web code, route, flow (web docs/process/flows.json) or guard files it under stock. The misfiling is the product-area map's card "Folder inventory (stock as a folder view)" (13, chitbridge-docs — unreadable here), which took the module by its name.

**(b) Conflicts** — none with DECISIONS: one calculation (the lot identity comes from gs1.lotOf, the key from lotfields.lotKey, as today); one shape per slot (`item_data.lot` keeps `{ batch, expiry }` — nothing new is written; stock_balance.lot / expires_at keep their slots); the server says may/why (an unreadable batch is a `skipped` row with a sentence AND a code `batch_unreadable`, logged by routes/chits.js:1912 as every skip is). No engines change: gs1 and lots are adopted copies, only called.

**(c) Simpler way** — yes, and taken: one reader (`lotOf` in stock-from-chit, reusing gs1.lotOf) instead of a new lot parser; no new field, table or route. Two batch lines already become two movements — once each carries its own key they are two lots by construction.

**(d) Risks** — data: stock_movement is append-only BY GRANT (b214); the fix SQL rewrites `lot`/`expires_at` on the bad rows from the chit line they came from and re-folds the balances — only Athi (postgres) can, only after b544's report, and nothing is deleted (the `[OBJECT OBJECT]` balance is zeroed, kept). A movement whose chit line cannot be resolved stays and is listed, never guessed. Money: untouched (rate/value unchanged). Migration numbers: b544 report, b545 fix, b546 unused. Twin: api only; the till already writes the right shape, so no web change (web copy untouched). Other rounds: T1-INV touched stock-store.js, not stock-from-chit.js — no overlap.

**(e) VERDICT: BUILD WITH CHANGES** — item 3 is a docs correction, not code: folder-inventory.js gets one header line naming its area (bills/books, not stock) and the report asks for the 13-area card to be re-filed; no "stock list" in code holds system folders to remove.
