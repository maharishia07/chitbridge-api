-- b900_identity_failure_budget.sql — ONE failure budget per account across every credential (M1 follow-up, batch 1128; NIST SP 800-63B §5.2.2). Additive: two nullable-safe columns on identities.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS). Touches no row, no policy, no grant.
-- WHY  the guess budget lived per code (5) and per PIN; asking again or switching door gave a fresh count. lib/account-budget.js counts consecutive wrong secrets per identity (30 inside 24 h), cleared only by a right secret or the owner's reset.
-- ORDER either way is safe: the api probes the column (lib/schema.js hasColumn) and enforces the budget only once it exists; before this file it behaves as before.
-- RLS: identities has NO row-level security yet (b860 is a draft, NOT run; the table waits on SEC-185/SEC-186); the new columns are on the same unprotected row, guarded only by the column grants. No new table, no new policy, no new grant (cb_app already UPDATEs identities).
-- ROLL BACK: ALTER TABLE identities DROP COLUMN auth_fail_count, DROP COLUMN auth_fail_at;  (the api reads no column when absent)
-- CHECK (read-only): SELECT column_name FROM information_schema.columns WHERE table_name = 'identities' AND column_name IN ('auth_fail_count','auth_fail_at');   (two rows)
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE identities ADD COLUMN IF NOT EXISTS auth_fail_count integer NOT NULL DEFAULT 0;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS auth_fail_at timestamptz;
COMMIT;
