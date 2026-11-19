-- b880_signin_events_subject_hash.sql — SEC-112 P0 (17 Nov 2026): one nullable column on the sign-in log, the keyed hash of a provider subject (never the subject itself).
--
-- ⚠️ NOT RUN anywhere · Athi runs it AS postgres, SIT first. Safe to repeat. Additive: ONE nullable column, no CHECK of the existing ones touched (the method list already holds google and microsoft, the action list link and unlink).
--    The api writes the row WITHOUT the column when it is missing (lib/signin-events.js drops the name once, tolerant), so it is correct BEFORE and AFTER this file.
-- NUMBER. b880, after b879 (same batch); cb-db confirms on the day.
-- WHAT IT IS. signin_events.subject_hash: lib/vaultcrypto keyedSubjectHash(provider, issuer, tenant, subject) = HMAC-SHA256 under a key derived from VAULT_ENC_KEY. Filled on link, unlink and provider sign-in rows. A dump alone cannot be
--    enumerated; the hash shows "the same provider identity" without naming it.
-- RLS: unchanged (b282: the shop binding; the new column rides the table's policy). ROLL BACK: ALTER TABLE public.signin_events DROP COLUMN IF EXISTS subject_hash;
-- CHECK (read-only): SELECT count(*) = 1 AS ok FROM information_schema.columns WHERE table_name = 'signin_events' AND column_name = 'subject_hash' AND is_nullable = 'YES';

BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.signin_events ADD COLUMN IF NOT EXISTS subject_hash text CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$');
COMMIT;
