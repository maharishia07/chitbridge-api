# SEC2 critique — no sign-in code leaves the server; people writes need the owner (written before any code)

**(a) What the brief assumes, checked**
- GET /api/actors sends `otp_code` — TRUE: routes/actors.js:678 SELECTs `pin_set_at, otp_code, otp_expires_at`; the web paints it (public/app/cap-workforce.js:587 "One-time code", app.html:15538 mapApiActor).
- PUT /:id/delegate (actors.js:1402) and PUT /settings (:1347) have no owner check — TRUE. DELETE /:id/pin, POST /:id/otp, PUT /:id/status, PUT /:id/tasks/route refuse a person only by a 404 (scoped to `req.identity.identity_id`) — TRUE.
- "lib/access holds the owner/may rule" — FALSE: lib/access.js answers viewer/commenter/editor only. The owner rule is **lib/owner.js isOwner** (crm, signin, counters, books, folders) and the owner sentence is **lib/people.js OWNER_ONLY**. POST / and PATCH /:id carry their own inline `identity_type==='actor'` 403. Reuse those; do not add an owner test to lib/access.
- lib/otp.js ~26 returns raw DEV_OTP — FALSE since SEC1 (otp.js:25 asks dev-otp.fixedOtp). But connectors.js:95 calls generateOTP() → the ENTITY fixed code on a local stack while :24 genOtp gives the CONNECTOR code — two generators in one file, still TRUE as "a second door".
- Web pages print test codes — TRUE: intake.html:58, signin-lab.html:105-139, shop.html:769/880/1130/1198. server.js:46-47 says codes "are echoed in API responses" — stale since mayExposeOtp (dev-otp.js).
- Add form's e-mail not stored — TRUE: actors.js:272 reads `req.body.email` for delivery, the INSERT (:310) has no `email`; PATCH has no `email`. Nothing writes an employee's e-mail, so reset/reactivate (actorEmail) is refused in a sealed env.
- C:/dev docs (RECONCILIATION-2026-10-14, area READMEs, TEST-CASES-DETAILED.md) — UNKNOWN: ../chitbridge-docs is an empty checkout on this runner.

**(b) Conflicts** — employee-code.deliver() puts `otp` in every unsealed write answer (the owner reads it) and POST /'s `login_instruction` prints `OTP:`. "No answer of any /api/actors route contains a code" means those go through the ONE door (dev-otp.mayExposeOtp), not `!isSealed()`. `identities.email` is UNIQUE (000_baseline_part2.sql:160): an owner's own e-mail on a staff row collides → must answer 409 in words, not "Key taken".

**(c) Simpler** — one `ownerOnly` middleware lifted into lib/owner.js (signin.js already has a private copy; point it there) answering 403 `{code:'OWNER_ONLY', may:false, why}` with people.OWNER_ONLY; `pin_state` derived in SQL (no per-row work). generateOTP(kind) widened so connectors.js uses one generator.

**(d) Risks** — an unsealed, non-local host with no mailer no longer shows the first code: staff then sign in with the tester code (SEC1) or after e-mail is set up — the answer's `delivery_note` says so. Stored e-mail makes an employee findable by the untyped e-mail lookup at signin.js:322 (they get their OWN code — acceptable, noted). No migration (b439-441 unused). Twin: api first, then web (web reads `pin_state`, falls back to `pin_set_at`). SEC1 touched the same files — merged on main already.

**(e) VERDICT: BUILD WITH CHANGES** — owner rule from lib/owner (not lib/access); otp.js already fixed, the connector door is connectors.js:95; deliver()/login_instruction also stop carrying the code; e-mail collision answered in words.
