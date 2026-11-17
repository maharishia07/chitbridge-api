# SEC4 · critique before building (rule 00) — the server checks what the page greys
(../chitbridge-docs is EMPTY on this runner: the area READMEs, SPECs and DISCIPLINES.md could not be read; the brief's inline copy is used.)

**(a) What the brief assumes, checked**
- "POST deliver-lines: today only the page greys" — PARTLY FALSE. middleware/hat-gate.js (inside `auth`) already 403s every mutating
  route for a viewer/commenter co-assist. TRUE that the ROUTE never asks the rail: routes/chits.js `/:chit_id/deliver-lines` has no
  `railActions.can` (assign-lines and amend do, chits.js ~3150/3196), so the refusal carries no `why` and nothing backs the gate up.
- "a sign-in-first shop's catalogue is refused server-side" — FALSE today. `storefront_access='login'` is only SENT (catalogue-view.js
  `shop.storefront_access`); GET /api/catalogue/:bridge_id returns every item and shop.html `renderLoginGate` hides them client-side.
  The embed (embed.html:109), the CTP pull (routes/ctp.js `want:'catalogue'`) and the network storefront read the same `publicViewFor`.
- "enquiries: the supplier is alerted (the existing bell)" — FALSE today: POST /api/catalogue/enquiry/:item_id writes the owner's copy
  (b162 definer) and emits nothing. "There is a list" — FALSE: only one item's thread (GET /enquiry/:item_id) exists.

**(b) Conflicts with existing constructs** — rail.js has no `deliver` among ACTIONS (engines are serial; this round does not own them),
so `rail.can(…, 'deliver')` throws. Use the engine's own `byLevel` + held through lib/rail-actions (one helper, same WHY words) and queue
the engine change. The bell's Activity feed is state_log (chit-anchored); an enquiry has no chit → the push (lib/events.emit) is the bell.

**(c) Simpler way** — ONE gate in `publicViewFor` (routes/catalogue.js), the function every anonymous door already shares (storefront,
embed, CTP, network), instead of a check per route. No extra trip: storefront_access is already read inside buildPublicView.

**(d) Risks** — a signed-in customer must still see the shop: shop.html must re-read with the customer token after the code (today it
renders the copy it already holds). B2B readers (relationships.js) call buildPublicView directly and are signed in → unaffected.
Route order: a list at `/enquiry` must be declared before `/:bridge_id`. No migration (b478–b480 unused). Twin PRs: api first.

**(e) VERDICT: BUILD WITH CHANGES** — (1) deliver-lines refusal through rail-actions + byLevel, engines `deliver` action queued, not built;
(2) the sign-in gate lives in publicViewFor, answers `{shop, sign_in:{code:'sign_in_first'}}`, and the web re-reads with the token;
(3) the enquiry alert is the SSE push `kind:'enquiry'`; the list is a paged API route — its screen (Task table reuse) is the next round.
