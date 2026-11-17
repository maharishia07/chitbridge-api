# PEOPLE-SRV1 critique — the people server answers for CB People (G2 · G4 · G5 · G6), written before any code

**(a) What the brief assumes, checked**
- CB-PEOPLE-REQUIREMENT.md G1–G6 — UNKNOWN: ../chitbridge-docs is an EMPTY checkout on this runner (no commits); the gaps are read from the brief's own lines.
- "After SEC2" — SEC2 is NOT on main: it is merged only on `integrate/1014a` (api #210, open). This branch starts there, so the PR base is `integrate/1014a` (retarget to main once #210 lands).
- G1 code+pin_state, G3 owner gate — DONE by SEC2: actors.js GET / `pin_state` CASE; lib/owner.js `ownerOnly` on every people write.
- G2 e-mail stored + editable — DONE by SEC2: actors.js:325 INSERT carries `email`, PATCH :474 sets/clears it, 409 EMAIL_TAKEN; lib/people.js `may.email`. Nothing left.
- G4 Remove — the server ALREADY removes (PUT /api/actors/:id/status action:'remove', confirm 'REMOVE', actors.js:797), but lib/people.view offers no `may.remove`, and the route's 400s (confirm, tasks to route) carry prose only → add the may/why + codes.
- "Switch-off signs the person out of phones and keys" — PARTLY TRUE today: middleware/auth.js:143 refuses a deactivated/removed ACTOR token on every request, but (1) their phone sessions stay LISTED in policy_flags.devices (lib/person-session; `by` = the person) — a reactivated person's old phones come back to life; (2) a counter/kit key a person opens is an ENTITY token (routes/keys.js mint) that records no maker — it keeps selling after the person is off. FALSE that anything ends them.
- G5 GET /api/facts/people — FALSE (none): lib/home-facts.js BUILD has till·accounts·orders·product-lab·combo-lab·offer-lab·rail. Add `people` there (routes/facts.js dispatches by BUILD, no new route file).
- G6 owner marks someone away — FALSE: PUT /actors/break (actors.js:979) is self-only (400 for a non-actor). Widen it with `actor_id` (owner only). Found: its leave `target_actor_id` read has NO shop filter (any shop's active person could be handed the tasks) → fixed in the same change.

**(b) Conflicts** — one owner gate (lib/owner, not lib/access) · one session store (person-session `edit`, the T2-POLICY writer) · one key revoke rule (DELETE /keys/:jti drops children; a till key is CLOSED as counters' release does, never deleted — its bills stay numbered) · one state word (lib/people.stateOf) for the Home card · may/why from lib/people.view, codes for every refusal the screen branches on.

**(c) Simpler** — no new route file, no migration: the sign-out runs INSIDE the status route's one withEntity transaction (person-session/keys take the client); the card is one BUILD entry; G6 widens the existing route.

**(d) Risks** — a till key closed at switch-off stops that counter mid-day (the owner's choice; bills stay on the PC, as Release). Keys minted BEFORE this change carry no `by` → not touched, the answer says how many were ended, never pretends. Session revoke is cached ≤ 60 s on other processes (person-session CACHE_MS) — auth's actor check already refuses at once. SEC2/WRITERS/SEC4 rounds touch actors.js — rebase risk. Migrations b535–b537 unused. Twin: api only (web reads the new fields later); no web change needed for the contract unless the facts route is in it.

**(e) VERDICT: BUILD WITH CHANGES** — G2 is SEC2's (nothing to build); G4 = may.remove/codes + sign-out on deactivate AND remove (sessions by person, keys by maker, `by` recorded at mint from now); G5 in home-facts; G6 widens /break with the shop filter fix.
