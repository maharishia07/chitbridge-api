# Critique: PLT-45/RAIL-96/97 network master and spin (25 Oct 2026, before code)

Reuse found (seams.cjs network / installation / platformroot): `installation` rows are already the member registry (`lib/ctpaddress.peerByKey` is the ONE "do we deal with them"); `lib/ctpkeys` is the one key holder; `lib/ctpenvelope.digest` and `lib/ctpquery` are the one signed-document and signed-question rules; `lib/ctpdirectory` is the one manifest reader (cache, safe-url, fresh re-read); `routes/entities.js` register + `lib/otp.verifyOtp` is the one sign-up door; `lib/platformroot` the one root. Nothing below adds a second resolver, gate or writer.

(a) Assumptions checked
1. Roots are `cb<scope><nn>-root`: TRUE, `lib/handle.js:147` refuses cb+8; a hyphen escapes it (tested).
2. Mirror must not be a second entity: TRUE (DECISIONS 25 Oct 01:50). Built as `registry_entry` (installation_key, bridge_id) on the master, ids and status only.
3. Door order stays; certificate check goes after the signature check: TRUE, `routes/ctp.js` deliver (after `openEnvelope`) and query (after `ctpquery.open`).
4. Skew = 5 min: TRUE, `lib/ctpquery.js:50 MAX_AGE_MS` is reused, no second constant.
5. A direct DB seed would be a fourth governance-stamp writer: TRUE. Root is made by register + verify; the installer token is accepted in `lib/otp.verifyOtp` only while no registered entity is active and only for the one handle in `CB_INSTALLER_HANDLE`.
6. A trigger can tell a real entity from a stub: TRUE, remote stubs and minted parties have no `user_id` or one starting `~`; the seeded CBSRC rows have no `user_id`.

(b) Conflicts and decisions taken
- New HTTP routes avoided: the master's asks (changes, certificate, directory, locate) ride the existing signed `/query` door as new `want`s; no contract/register change. Master-only asks are verified against the PINNED network key, never the key on a domain.
- `installation.network_role` is DATA (standalone default); master needs `CB_NETWORK_ROOT_KEY` as well (a row alone does nothing). Standalone installations behave exactly as today (all existing door tests keep passing).
- Certificate binds the member's CTP key hash, so a CTP key rotation needs a re-issue (stated; RAIL-104 heal still works inside one certificate).
- Open for Athi, safest default taken: the door demands the certificate from every remote peer EXCEPT the pinned master (design Q4). Grace/billing/`subscription` link are NOT built (list as next).

(c) Simpler way: none that proves the door; a UI and the Add form are skipped on purpose (screens later).

(d) Risks: the migration (b790) is idempotent, RLS stated, NOT run on production (Athi runs SQL); code checks `hasTable` and degrades to standalone. A trigger on `identities` is the one outbox writer, off unless a local installation row is member/master. Root key is an .env secret on the master VM only. Migration number b790 chosen above the highest on origin (b781); another round may collide, rename on landing. Depends on api PR #438 (RAIL-98/99/100/101/104/105); PR base is main.

(e) VERDICT: BUILD WITH CHANGES (the changes are the decisions in (b)).
