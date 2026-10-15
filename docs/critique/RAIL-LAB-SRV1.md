# Critique · RAIL-LAB-SRV1 — Rail Lab server gaps (written before any code, 2026-10-14)

**(a) What the brief assumes — checked**
- "C:/dev/docs/01-rail/design/RAIL-LAB*" — MISSING: ../chitbridge-docs is empty on this runner (no area home, no DISCIPLINES.md there; the brief's inline copy is used).
- "the facts card route (/api/facts — widen)" — TRUE: routes/facts.js:28 dispatches to lib/home-facts.js BUILD; `rail` (home-facts.js:228) answers `{ suppliers, customers, in, out, stuck }`; railScope (:209) already reads identities in ONE readBatch — the population can ride that SELECT, no extra trip.
- "the rail's may/why helper" — TRUE for the rail's own verbs: lib/rail-actions.js (rail.can / rail.move, refuse throws unless `why` ∈ rail.WHY). FALSE for a lab: the adopted engine knows no "lab"; rail.WHY cannot be widened here (never edit lib/rail.js). The shape to reuse is the server's `{ ok, why, say }` (lib/local-identity verdict :226, people `may`, forBill :71).
- "the live-shop flag the other labs use (offer-lab, tax-lab — one 'is this a lab chit' rule)" — FALSE as stated: offer-lab / combo-lab / product-lab are web pages on a SAMPLE CATALOGUE (offer-lab-next.html:778 "Apply tries it here, not on a real product"); the api has no lab-chit rule and no tax-lab. The ONE shop-level axis is identities.population (b249: `is_test` = population <> 'live'; lib/istest.js). A "lab shop" = a shop whose population is not live. No chit carries a lab mark today (grep summary_json/business_json: none).
- "moveStatus (the one status writer)" — TRUE (routes/chits.js:3683, lib/rail-status.js). G1/G2 move no status; nothing new may write one.
- Contract: `GET /api/facts/rail` is NOT in docs/contracts/web-api.json (only /api/work/facts); the web fixture already differs from the api master (web at PERF1, api after FIN-R1) — the byte copy will carry those rounds' shapes too.

**(b) Conflicts with rules / constructs**
- One place per thing: the lab test goes in lib/istest.js (the population axis) — `isLab` · `maySample` — never a second population reader (mint.senderAddress:299 reads it with an empty catch; left as is, out of scope).
- The chit-level mark rides `summary_json` as a RIDER (present only when declared, like `is_promotion` / `trace`), declared by the sender as `business_json.lab: true` — the exact is_promotion path (chits.js:1484). FIELDS.md entry in this change.
- The refusal is said by the door with a CODE the client can branch on (`code: 'LAB_CHIT_LIVE_SHOP'`, `why: 'live_shop'`, `may: false`) — never prose only.

**(c) Simpler way** — G2 needs ONE door: POST /chits/send (a lab chit cannot reach a live shop by delivery either — b247's population boundary + istest.mayTrade already refuse cross-population). A lab chit costs one identities read only when `lab` is declared; a normal send is byte-identical and its trip count unchanged.

**(d) Risks** — no money path, no migration (b580–b582 unused). Send route: tests read routes/chits.js as source text — the new step is additive, after sendSender. Contract --write regenerates every route from today's code (a shape another round changed on main lands in the web copy: expected, the api is master). The contract capture needs the work stub to answer the rail's three reads (overdue/population · CRM lists · chit rows) — widened, not a second stub. Twin landing: api first (contract master), web byte copy second.

**(e) VERDICT: BUILD WITH CHANGES** — (1) the lab-shop rule is identities.population (lib/istest), not a new flag; (2) the may/why is the server's `{ ok, why, say }`, not a rail.WHY word; (3) G2 at the send door only, by a `summary_json.lab` rider declared as `business_json.lab`; (4) GET /api/facts/rail is ADDED to the contract (it was never there).
