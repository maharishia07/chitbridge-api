# CO1 critique — privacy (written before any code)
**(a) Assumptions, checked.** Register is `public/app/cap-standards.js` with a DPDP row `s:'part'` (:478) — TRUE. `STD_COUNTRIES` lacks AU/AE
(:503) — TRUE, so AU/AE rows need two codes added. No privacy notice / policy anywhere — TRUE (only "I accept the terms of use", app.html:3515).
Consent store designed as `party_contact_pref` "b277" (api docs/design/crm/DATA.md:83) — TRUE, but **b277 was never written and this round
may use only b306–b308**, so it lands as b306. No marketing sender exists to gate: `lib/whatsapp-out.js` is utility/chit-status only
(whatsapp-templates.js:25) — so the send-gate is a function the record answers with, wired into nothing yet. CRM record + timeline routes
(routes/crm.js:61,100) already are "what we hold about this party" — the K4 access summary is REUSED, not rebuilt. No rights / grievance
register exists (grep consent|grievance|breach in api lib/routes/migrations) — TRUE.
**(b) Conflicts.** One log only: consent rows are append-only (b276 `party_interaction` REVOKE pattern), not a second audit log. The server
answers may/why (`isOwner`, routes/crm.js). Privacy policy text, grievance officer name, DPA signature, legal answers = ORGANISATIONAL →
docs/compliance/OWNER-ACTIONS.md, never shown as done. CO2/CO3 run in parallel and will also add rows to cap-standards.js and
OWNER-ACTIONS.md → merge conflicts likely; I append in one block each, near the DPDP row / at the file end.
**(c) Simpler way.** No new screen this round: a new screen needs the full 2-theme × 2-width walk and a public policy page would publish
text the owner has not approved. The API carries the controls; the register + docs carry the evidence; screens are a follow-up.
**(d) Risks.** Data: consent rows hold no new personal data (party_id only). Migration numbers: b306 consent, b307 rights register; b308 unused.
Twin landing: api first (routes answer 503 `PRIVACY_NOT_MIGRATED` until b306/b307 run), web second (rows cite the routes). No engines change.
Web↔api contract: the web calls none of the new routes yet → no contract entry; round-trip budget lines added by hand.
**(e) VERDICT: BUILD WITH CHANGES** — (1) consent = b306 not b277; (2) no new screen, no public policy page (owner act);
(3) per-person export = the existing CRM record + timeline, named as such; erase-person stays Planned (L, dry-run-first);
(4) K9 sub-processor list lives once in api `lib/privacy.js`, served by a public `GET /api/privacy/facts` (the live check).
