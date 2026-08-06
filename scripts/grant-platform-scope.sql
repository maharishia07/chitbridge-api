-- grant-platform-scope.sql — make ONE account platform-scope.
--
-- Athi, 2026-08-06: "how do I get a platform-scope account?"
--
-- You cannot, through the app — and that is correct. `identities.owner_scope` defaults to 'entity', is constrained
-- to 'entity' | 'platform', and NOTHING in the codebase ever sets it. There is no route, no script, no admin
-- screen. It is SQL-only because of what it unlocks:
--
--     POST   /api/governance/entities            mint a governed entity (constitution · plan · CAPS)
--     POST   /api/governance/entities/:id/reattest   re-attest to the active constitution
--     PATCH  /api/entities/:id/erase             mark an identity ERASED
--
-- An account that can create governed entities and erase identities must not come out of a signup form.
--
-- ── BEFORE YOU RUN THIS ────────────────────────────────────────────────────────────────────────────────────────
--  1. Register the account through the normal app flow first, so the row exists:
--       POST /api/entities/register {email:'platform@test-cb.com', display_name:'CB Platform'}
--       POST /api/entities/verify   {email:'platform@test-cb.com', otp:'123456'}
--     (or just sign up in the UI — it only has to exist.)
--
--  2. ⚠️ USE A DEDICATED ACCOUNT, not your everyday shop. Least privilege: the day-to-day login should not be able
--     to erase identities by accident. Alpha Timbers should stay an ordinary entity.
--
--  3. ⚠️ SIGN IN AGAIN AFTERWARDS. The JWT embeds owner_scope at verify time (routes/entities.js:187), so a token
--     issued BEFORE this runs still says 'entity'. Re-verify to get a platform token, or every call will 403 and
--     look like the grant failed.

BEGIN;

-- 1 — Who are we about to promote? Read this before committing.
SELECT identity_id, bridge_id, display_name, email, identity_type, status, owner_scope
  FROM identities
 WHERE email = 'platform@test-cb.com';

-- 2 — How many platform accounts exist already? Expect 0 the first time. If this is not 0, ask why before adding
--     another: every one of them can erase identities.
SELECT COUNT(*) AS existing_platform_accounts
  FROM identities WHERE owner_scope = 'platform';

-- 3 — Promote exactly one, and only if it is a real active entity.
UPDATE identities
   SET owner_scope = 'platform'
 WHERE email = 'platform@test-cb.com'
   AND identity_type = 'entity'
   AND status = 'active';

-- 4 — Confirm. Expect exactly the one row, owner_scope = 'platform'.
SELECT display_name, email, owner_scope
  FROM identities WHERE owner_scope = 'platform';

COMMIT;

-- ── TO REVOKE ──────────────────────────────────────────────────────────────────────────────────────────────────
-- UPDATE identities SET owner_scope = 'entity' WHERE email = 'platform@test-cb.com';
-- (and sign in again — an already-issued token keeps the old scope until it expires)
