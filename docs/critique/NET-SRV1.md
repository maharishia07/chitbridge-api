# Critique · NET-SRV1 — the network answers what the simpler Network app needs (written before any code, 2026-10-14)

**(a) What the brief assumes — checked**
- G1 TRUE: GET /api/network-offers lists a store's networks from its adoptions (routes/network-offers.js:46-53) plus edges `requested_by = e.parent_id` (:58-63, invitations only). A request the STORE sent to a brand whose catalogue it does not sell is in neither set — invisible to the store. Same cause hides an ACTIVE or SUSPENDED joined membership with a brand it does not adopt.
- G2 TRUE: a row carries `membership { state, via, edge_id, brand_node }` (:82-83) and no may/why; the brand's `members[]` (lib/network-offers.js:154-157) likewise. The ONE rule table exists: `mayAct` (src/services/network.js:91-105), already held by tests/network-authority.test.cjs — the answers come from it, never a second table.
- G3 TRUE: rows carry `brand_node` (a cb_entity uuid), no bridge id. The network store is network-shop.html `?bridge=` (:58) → GET /api/catalogue/network/:bridge_id (routes/catalogue.js:625), which takes a ROOT. The path's root label mangles dashes (`_label`, src/services/network.js:56), so the root bridge id must be READ from cb_entity, not parsed.
- "the one member reader (T2-HONEST)": lib/network-membership.js (`standing` :77, `roster` :52). The T2-HONEST note itself is not on this runner.
- REQUIREMENT / FLOW / LOGIC-AS-BUILT / RECONCILIATION-2026-10-14 and the area README: MISSING — ../chitbridge-docs holds only .git. Built from the code and the brief's inline rules.
- "contract --write": GET /api/network-offers is NOT in docs/contracts/web-api.json (108 routes, books·crm·work·repeat only) and the web's e2e/contract.cjs:28 admits only those four prefixes. A network capture half (tests/support/contract-network.cjs over the real router) is new, and the web guard's prefix list must widen — a twin web PR.
- Budget: GET /api/network-offers = 9 trips (round-trips.budget.json:568); tests/query-shape.test.js:93 allows ONE per-brand withEntity loop in the route. G1 stays one statement, G3 rides `standing()`'s one statement, G2 is pure — the line must not rise.

**(b) Conflicts with rules / constructs**
- The web stand-in (e2e/walk-locale.cjs:96) sends a shape the API never has (`offer_id · title · state · starts · ends` vs `id · name · live · at · until`) — pre-existing drift the contract would catch; the twin fixes it.
- Shape: `{ ok, why }` is what this route's `may_design` and routes/books.js `may.*` already use — reused, not a new `{ may, why }`. The client branches on `ok` (a code), never on the sentence.
- No new route; no migration (b562–b564 unused); no money; no engines.

**(c) Simpler way** — G1 is one SQL widening (admit every commercial edge of mine in requested · active · suspended, whoever asked). G2 is one pure function in the member reader, shared by the store's rows and the brand's roster. G3 is two columns on `standing()` / `ROSTER_SQL`.

**(d) Risks** — Disclosure: may/why and the brand's bridge id are about the store's OWN edge and a brand it already sees — nothing new crosses. Twin landing: api first (contract master), then web (byte copy + guard prefix + stand-in). Other rounds touching routes/network-offers.js: none visible; the change is additive.

**(e) VERDICT: BUILD WITH CHANGES** — (1) may/why computed in lib/network-membership via `mayAct` (one rule, both halves). (2) The contract gains a network half; the web twin widens e2e/contract.cjs's prefix list and conforms the stand-in. (3) G3 = `brand_bridge_id` + `root_bridge_id` from the one member reader, no second read.
