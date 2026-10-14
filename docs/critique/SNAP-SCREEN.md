# Critique · SNAP-SCREEN — a screen key gets only what a screen shows (written before any code, 2026-10-14)

**(a) What the brief assumes, checked**
- A screen key receives customers, suppliers, staff in the snapshot — TRUE: `GET /snapshot` (routes/till.js:97) has no per-key shaping at all; the body (~:770-830) carries `customers`, `suppliers`, `staff`, `reward`, `policy`, `till`, item `aliases` (supplier names) to any key the scope map lets in (middleware/auth.js:281 `screen` → snapshot · engine · events/ticket).
- "the snapshot builder's existing per-key shaping" — FALSE: there is none; the only per-key logic is the bill-series claim (`keys.claimSeries`, till.js:150), which a screen key ALSO runs — a TV locks the shop row and writes a `till` prefix onto its own key on every read. Same over-reach, different shape.
- `isScreenKey` exists — TRUE (till.js:1814), private to till.js, works on a key record `{scopes}`; `req.till.key` (lib/holder.js:31) has that shape.
- CFD-03 is a manual UAT case (data/test-cases.json, "No customer detail ever reaches the screen") — TRUE; nothing automated guards it.
- Other routes a screen can call: only snapshot, `engine/:name` (public engine code — fine) and `POST /api/events/ticket`. The bell stream (lib/events.js emit) writes `who` = a counterparty's display name and `note` on every `chit`/`message` event to EVERY subscriber of the shop, the TV included — the same over-share. The TV listens only for `kind:'shop'` (promo.html:1226).
- What the screen reads (promo.html): `shop.{name,phone,address,currency}`, `items[].{item_id,name,code,unit,price,mrp,category,image,screen,avail}`, `offers`. The bill/QR it shows comes from the counter over a same-machine channel, not the snapshot.

**(b) Conflicts** — none with the chit/rail or money unit. "Decided once on the server": one ALLOW-LIST projection (`screenView`) keyed on `isScreenKey`, never a deny-list (a field added to the snapshot tomorrow must not leak by default). `isScreenKey` lifted to lib/holder.js (the one holder module; tests that stub auth keep it real) — till.js and events.js both point at it.

**(c) Simpler** — skip each sensitive query for a screen key: more branches, and still a deny-list. The allow-list on the finished body is one function; the reads it wastes on a TV are a cost, not a leak (noted, not optimised here).

**(d) Risks** — the TV loses `avail` (a stock QUANTITY); promo's `avail !== 'unavailable'` filter becomes a no-op, so the server instead sends a screen only `status: 'available'` items (it already never advertises unavailable by intent, promo.html:378). `total`/`version` dropped for a screen (promo reads neither). No migration (b418-b420 unused). No engines change. No web change (promo.html untouched → no twin PR). Other rounds touching routes/till.js: merge risk only.

**(e) VERDICT: BUILD WITH CHANGES** — (1) allow-list projection, not per-field removal; (2) a screen key no longer claims a bill series; (3) the bell sends a screen ticket only `{kind:'shop', at}` events, and keeps it off the shared test-board channel.
