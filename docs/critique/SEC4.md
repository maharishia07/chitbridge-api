# SEC4 critique — the server checks what the page greys (written before any code, 2026-10-14)

Docs: `../chitbridge-docs` is EMPTY on this runner (no SPEC-*.md, no area README, no DISCIPLINES.md) — read from the code and the brief's inline packs.

**(a) What the brief assumes**
1. "A viewer's delivery is refused only by the page" — PARTLY FALSE. `middleware/hat-gate.js:117` already 403s every mutating POST from a viewer/commenter *actor*. But `POST /:chit_id/deliver-lines` (routes/chits.js:3245) asks no rail verdict: no `why` code, no "I hold a copy" check, and `deliverUse` writes a bill's `use` BEFORE anything is checked. The page greys from `workflow.can(…,'deliver_line')` (lib/workflow.js:46, borrows rail `assign`) via work-rows `actions.deliver_line` — the route never asks that same verdict. TRUE gap: one verdict, two answers.
2. "Sign-in-first is a shop setting" — TRUE: `identities.storefront_access` = browse|login (b77; routes/entities.js:849). It is enforced ONLY in shop.html:1356 (`renderLoginGate`); `GET /api/catalogue/:bridge_id` (routes/catalogue.js:713) sends every item to anyone. TRUE gap.
3. "The embed reads the catalogue" — TRUE: embed.html:109 fetches the same `GET /api/catalogue/:bridge_id`, so one server gate covers both. The CTP `/query` pull (routes/ctp.js:340) uses the same `publicResponseFor` and must get the same answer (a peer is never signed in).
4. "Enquiries reach the supplier's bell" — FALSE: `POST /enquiry/:item_id` (catalogue.js:1456) writes the supplier's copy (b162) but emits nothing; the bell (lib/events emit → core.js cbPushArrived) never hears it. No list exists (only one product's thread, GET /enquiry/:item_id).

**(b) Conflicts with rules / constructs**
- One verdict: the route must ask `workflow.can('deliver_line')` — the exact verdict the page greys with — not a new level check. Refusal via `railActions.refuseOwnCopy` (404 not-holder · 403 with the rail's sentence + `why` code).
- The rail engine has no `deliver` action; adding one is an ENGINES change (serial — not this round). Not needed: workflow already names `deliver_line`.
- The gate lives in `publicResponseFor` (the ONE trim every public door uses), so catalogue GET, embed and CTP cannot disagree.
- Code the client branches on: `code: 'SIGNIN_REQUIRED'` (shop.html / embed.html branch on it, never on prose).

**(c) Simpler way** — no migration: the setting exists; the bell exists (events.notifyAfter); the list is one grouped SQL over chit_messages (RLS, the supplier's own copies).

**(d) Risks** — data: none written. Security: a customer token is accepted only for ITS shop (`parent_entity_id`); owner preview unchanged. Break risk: shop.html must refetch with the customer's token after OTP (today it re-renders cached data) — twin web PR. `/network/:bridge_id` departments with sign-in-first are skipped (else a side door). `/network-store/:networkId` aggregates by item network_id and is NOT gated here (named as follow-up). Migration numbers b496–b498: unused. Other rounds touching catalogue.js / chits.js: merge risk small (additive lines).

**(e) VERDICT: BUILD WITH CHANGES** — (1) deliver-lines asks `workflow.can('deliver_line')` before ANY write (deliverUse moved after the gate); (2) the sign-in gate sits in `publicResponseFor` (+ network departments); (3) the enquiry list ships as a paged API (`GET /api/catalogue/enquiry/inbox`) + the bell toast; its SCREEN waits for Athi's yes on where it lives (rule 5: a new list = the Task table, not a new look).
