# Critique · NET-SRV1 — the network answers what the simpler Network app needs (written before any code, 2026-10-14)

**(a) What the brief assumes — checked**
- REQUIREMENT/FLOW/LOGIC-AS-BUILT/RECONCILIATION docs — MISSING: ../chitbridge-docs is an empty repo on this runner. G1–G3 are read from the brief and the code.
- G1 "a store does not see a request it sent to a brand whose catalogue it does not sell" — TRUE: routes/network-offers.js:48-66 lists brands from adoptions (`owners`) + edges where `requested_by = parent_id` (invites, :61). A store-asked edge (`requested_by = child`) to a brand it does not adopt is never listed. Same hole for an ACTIVE joined edge with no adoption.
- G1 also: an invite row's state is GUESSED (`|| { state: 'invited' … }`, :66) because standing() is only asked about `owners` (:56).
- G2 "the server decides who may approve" — TRUE and it already has the rule: src/services/network.js:92 `mayAct()` (pure). No row carries it today: store.networks[] (:80) and brand.members[] (lib/network-offers.js:155) have state + asked_by only, so a client would have to re-derive the rule.
- G3 "brand / root bridge id" — TRUE gap: no bridge id on either row. The network store reads by ROOT bridge (routes/catalogue.js:625 `/network/:bridge_id`, members = path <@ root). Root primitive: `subpath(path,0,1)` (lib/catalogue-view.js:89); /network/place does it in JS by unmangling the ltree label (src/routes/network.js:63) — I use the SQL form, no third copy.
- "the one member reader (T2-HONEST)" — lib/network-membership.js (`roster` · `standing`); widened, not copied.

**(b) Conflicts with rules/constructs**
- One rule for may: the row's may/why calls `mayAct` itself + the same state gates the service throws on (approve/decline need `requested`, suspend `active`, resume `suspended`, disconnect `active|suspended`). Each answer `{ ok, why, code }` — the client branches on `ok`/`code`, never the sentence.
- No new route (brief). Not in web-api.json today (contract has no network-offers capture); budget line exists (round-trips.budget.json GET /api/network-offers = 9).

**(c) Simpler way** — fold the invite read into "every commercial edge where I am the child" and ask standing() about owners ∪ those brands: fixes G1 and removes the guessed state in one move, same trip count.

**(d) Risks** — no money, no migration (b529–b531 unused). Trips: the brand's own node/bridge folds into the existing `owns` statement → budget unchanged. Web reads only `membership.state` (public/app/network-app.js:54) — additive keys, no web twin needed. Other rounds on lib/network-offers.js may conflict (rebase is mechanical). Engines untouched.

**(e) VERDICT: BUILD WITH CHANGES** — (1) docs missing, built from code; (2) may/why is one helper `mayOn()` in lib/network-membership.js over `mayAct`, used by both the store rows and the brand's member rows; (3) G3 = `brand_bridge_id` + `root_bridge_id` on store rows, `bridge_id` + `root_bridge_id` on the brand view; (4) no contract entry added (no capture harness for this route) — said in the report.
