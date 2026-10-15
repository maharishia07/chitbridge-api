# MKT-SRV1 · consent first, on the server — critique before build (2026-10-14)
⚠️ The brief's READ files (C:/dev/docs/11-crm-and-marketing/design/CB-MARKETING-REQUIREMENT.md, RECONCILIATION-2026-10-14.md) are NOT on this runner (../chitbridge-docs is an empty repo). Built from the brief's G0–G5 + CO1-GATE lines and the code.

**(a) What the brief assumes, checked**
- "mayMessage — today nothing calls it": TRUE — only lib/privacy.js:89 (its own prefs()). It answers `{may, why}`, no code (lib/privacy.js:73) → G0 is real.
- `/api/crm/parties` has no consent and no total/page/limit: TRUE (lib/crm.js list → `{parties, walk_ins, count, truncated, alerts}`); `/privacy-requests` returns ≤2000 rows, no paging (lib/privacy.js requests).
- "the outbound senders (whatsapp-out, notify, CRM message/remind)": PARTLY. lib/whatsapp-out.notify is the ONLY sender that messages a party (routes/chits.js:3971 via notifyChitStatus). lib/notify.js sends sign-in codes to the person who asked (sendOtp*) and a connector notice to an address the SHOP configured (routes/connectors.js:218) — neither is a party message. "CRM message/remind" does not exist: a follow-up is never sent to the party (lib/crm-followups.js:8). routes/simulator.js mails our own leads inbox.
- POST /parties/:id/interactions LOGS a contact (call · visit · message · note, in/out) — it sends nothing (lib/crm-followups.js:52).
- The record (GET /parties/:id) carries no prefs: TRUE (contract note "No contacts, prefs").

**(b) Conflicts with rules / constructs**
- One gate: every check goes through lib/privacy (mayMessage + one new reader `gate`), never a second rule in a route or sender.
- A sentence the client branches on ships with a code: G0 adds `code` to every verdict (may or not) — the web greys from `code`, prints `why`.
- One shape per slot: list (with=consent) and record carry the SAME `contact_prefs: { migrated, may }` — `may` is GET contact-prefs' own map. FIELDS.md rows in the same change.
- Code must not break before b306 runs: the gate reads NO rows when the table is absent → service passes, offers refused ("No consent… Ask them first") — the honest answer, not a 503 that would block logging a call.
- No migration needed (b306 has the table) → b532–b534 unused.

**(c) Simpler way**
- G2: gate only OUTBOUND contact the shop makes (call → phone, message → the channel given, default whatsapp — the only message kind the web offers); `purpose` defaults to service. In-bound, visits and notes are facts, never refused.
- CO1-GATE: gate whatsapp-out.notify itself (the one door), by party_id when known else by the phone it is sent to; a guard test lists every provider send in lib/routes and fails on one that neither gates nor is named exempt with its reason.
- G4 /parties: total/page/limit top-level; with no ?limit the page is the whole list (CAP 5000), exactly today's answer, so the web (which pages client-side) is unchanged.

**(d) Risks** — Refusing to LOG an out-call to someone who said no hides a fact; mitigated: the 403 says why, and the shop can log it as a note. A WhatsApp gate read failure refuses (fail closed, logged). Contract --write changes web's fixture copy → twin web PR (fixture byte copy only); land api first. Other rounds touching routes/crm.js or lib/home-facts.js: merge conflicts possible, additive edits only. No money, no engines.

**(e) VERDICT: BUILD WITH CHANGES** — G2 gates outbound contact only; CO1-GATE gates the one party sender (whatsapp-out) and names OTP / connector notice / simulator as exempt in a guard; no migration (b532–b534 unused).
