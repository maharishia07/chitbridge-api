-- b781_staff_code_hash.sql — SEC-106 (24 Oct 2026): a staff first sign-in code is kept as a KEYED HASH, never in plain text; the access trail may say "code issued".
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres) BEFORE the api that writes otp_code_hash is deployed, or soon after: the code checks the
--    column first (schema.hasColumn) and, until it exists, keeps a staff code the old way and says so in the log. Safe to re-run (ADD COLUMN IF NOT EXISTS; the CHECK is dropped and re-added).
--    Touches no rows: the new column is nullable with no default (a catalogue change); the CHECK only gains a value, so every existing access_events row still passes.
--
-- WHY. identities.otp_code is varchar(6) and holds the code as typed; anyone reading the table (the SQL editor, a backup) reads every live first code. A 6-digit code is a
--    10^6 space, so even bcrypt is reversed from a dump. So the stored value is an HMAC made by lib/vaultcrypto, and what it is made with lives only in the app settings, never in the database.
-- SIZE. otp_code_hash is varchar(64), not varchar(6): an HMAC-SHA256 hex digest is always 64 characters. (laptop1's order named varchar(6) for the code; a hash does not fit it.)
-- access_events.action gains 'code_issued' (the owner issued a first code; before_value/after_value = {channel, expires_at}, never the code). Without it the trail INSERT would fail
--    the CHECK and count as audit_lost. The list below is the baseline's seven values plus the new one.
-- CODES ISSUED BEFORE THIS RUNS. They stay in otp_code (plain), still verify (verifyOtp reads otp_code when otp_code_hash is empty), and die on their own: an owner-issued code lives
--    24 h, one made by a sign-in ask one hour. Nothing is converted and nothing breaks; the next issue (create, reset, reactivate, sign-in ask) writes the hash and sets otp_code NULL.
--    Shopper, connector, network-claim and owner codes keep the plain column (SEC-106b).
-- RLS: unchanged (identities and access_events keep FORCE RLS and their rls_entity policies). Grants: cb_app already holds table-level SELECT/INSERT/UPDATE/DELETE on identities (baseline), which covers a new column; nothing added.

BEGIN;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_code_hash varchar(64);
COMMENT ON COLUMN identities.otp_code_hash IS 'SEC-106 b781: keyed HMAC-SHA256 (hex, 64) of a staff first sign-in code; replaces otp_code for staff, which is then NULL; NULL = no hashed code held';

ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued'));
COMMIT;
