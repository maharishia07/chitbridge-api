# T1-INV · one stock truth — critique before build (2026-10-14)

Area docs: `../chitbridge-docs` is EMPTY on this runner (no commits) — RECONCILIATION-2026-10-14.md, the area README and DISCIPLINES.md could not be read; the brief's inline copy was used.

**(a) What the brief assumes, checked**
- Storefront reads only the connector figure — TRUE: lib/catalogue-view.js:302 and web public/app/cart.js:2200 read `item_data.avail`, written only by routes/products.js:1263 (connector bulk) and :1288 (PUT, one item). stock_balance is never read for a shopper.
- The shop keeps its own ledger since b214 — TRUE: lib/stock-store.js post/issue; till GET /stock (routes/till.js:2135) already collapses `sheet()` per product.
- "Where the shop chose the connector as its source" — no such setting exists by that name; the nearest is policy `stream_owner.stock` (lib/policy.js:261), set by a connector's heartbeat claim or the owner (routes/integrations.js:287, :379). TRUE enough: that IS the choice.
- Closing-stock refusal says quantities are not kept — TRUE twice: lib/books-period.js:231 AND engines src/posting.js:310 (the engine refuses mode 'automatic').
- flows.json: POST /api/till/stock listed as goods receipt — TRUE (P2P step 3, INV step 1); it only stamps item status available/unavailable (routes/till.js:880). Supply purchase "posts" — TRUE wrong: P2P step 4 cites supply-store.purchase + POST /api/supplies/purchase under purchase_bill, but lib/supply-store.js:158 writes stock movements and counts `expensed`, nothing reaches the books.

**(b) Conflicts** — engines are serial and NOT owned by this round: the engine's 'automatic' refusal stays; the api values the ledger and hands the engine a value (the engine's own manual path, so ONE calculation of the difference). Engines change queued: posting.js closing_stock accept `mode:'automatic'` with a supplied amount. `avail` keeps ONE shape {qty, source, as_of}; source gains `ledger` (lib/availability.js SOURCES, additive).

**(c) Simpler way** — no new store: lift ONE `onHand()` into stock-store (till GET /stock's per-product collapse becomes its first caller), and an as-at replay `asAt()` that reuses inventory.replay (the log wins). No migration.

**(d) Risks** — exposure: a no-connector shop's quantities become public on its storefront (qty only, never value/cost); a ledger that went below zero is shown as unknown, not 0 (availability.stamp refuses negatives). Catalogue read gains 1 query (parallel in the existing wave). Closing stock as-at reads all movements to the date in ONE query (period-end action). Migration numbers b430–b432 unused. Twin PR: api first, then web (web is docs + guard only, independent).

**(e) VERDICT: BUILD WITH CHANGES** — source choice = `stream_owner.stock`; closing stock values the ledger in the api and posts through the engine's manual path until the queued engines change; avail.source `ledger`.
