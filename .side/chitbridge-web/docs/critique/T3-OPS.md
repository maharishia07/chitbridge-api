# Critique · T3-OPS (written before any code, 2026-10-14)

## (a) What the brief assumes, checked
- "READ C:/dev/docs/12-… and 13-…" — UNKNOWN: `../chitbridge-docs` is an empty repo on this runner (no commits); the area READMEs, RECONCILIATION and SPEC files could not be read. The brief's inline pack is what this round follows.
- "the workshop's existing Stock screen, loaded through page-frame" — FALSE: no stock screen exists. app.html has a product's Availability tab (`app.html:13080 prodAvailBlock`), CB Accounts' closing stock (`cap-period.js:103`) and Supplies (`cap-supplies.js`, things bought to USE). The one stock reader is api `lib/stock-store.js:298 onHand`, read only by `GET /api/till/stock` (`routes/till.js:2158`) — one row per item, lots collapsed, no names.
- "lots/expiry where kept" — TRUE in the table (`stock-store.js:202 lotsOf`, `:271 sheet` carries lot + expires_at) but no route sends them. "low-stock first" — no reorder level is kept anywhere (grep reorder/min_qty: none for stock), so "low" can only mean least on hand, below zero first.
- "the workshop's Suppliers screen through page-frame" — FALSE as a module: it is inline in app.html (`app.html:7736 suppliersScreen` … `:10513 delSupplier`), bound to the workshop's panel/divider, `UI`, `BK`, `confirmAsk`, `crmCols`, the supplier cart. Loading it unchanged needs the whole workshop.
- "their readiness" — TRUE without a new read: `GET /api/relationships/suppliers` (`relationships.js:175`) sends `on_rail` (lib/istest mayTrade), `one_sided.why`, `has_catalogue`, `facts.rung`. The certificate match (OPS-S2) stays out, as briefed.
- "add/link" — TRUE: `POST /api/relationships/suppliers` takes `{supplier_bridge_id}` (link a ChitBridge business) or `{name}` (a local one); a miss answers 404 — a status, so the page branches on it, not on the sentence (the workshop regexes the prose, `app.html:10507`).
- "an existing /api/facts card" — FALSE: none for stock or suppliers (`lib/home-facts.js:305 BUILD`). Smallest widening: `BUILD.operations`.

## (b) Conflicts with rules / constructs
- Rule "reuse the workshop module": the module does not exist for Stock, and Suppliers is not a module. Lifting all of suppliersScreen would drag the supplier cart and the order flow into a small app that does not order. Instead the PURE parts are lifted once (`supName`, `supKindOf`) into `app/cap-suppliers.js`, app.html loads that file and loses its copies (one copy); the screen itself is a CBList mount with the same columns' meaning.
- One stock reader: lots come from `onHand(…, { lots: true })` (widened, additive), never a second query of stock_balance.

## (c) Simpler
- Drop from the workshop's Suppliers: the right-pane catalogue + supplier cart (ordering is P2P step 2, in Tasks & Orders), Find a product, Required certificates (OPS-S2), the slide-over record (the row's next level carries readiness). Kept: list, Trade/Other, add/link, remove, preferred.

## (d) Risks
- api twin: `GET /api/till/stock?detail=1` (+1 read for names), `GET /api/facts/operations` — two hand budget lines; no migration (b487-b489 unused). Land api FIRST; without it the Stock tab says it could not read, in words.
- app.html touched only to drop two lifted functions and add one script tag. Engines untouched (rule 12).

## (e) VERDICT: BUILD WITH CHANGES — new `cap-stock.js` (no workshop stock screen exists) and `cap-suppliers.js` (lifted pure helpers + a CBList screen), api widening of the one stock reader + an `operations` facts card; certificate check (OPS-S2) out.
