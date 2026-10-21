-- migration_b45_gov01help_rename.sql — name the Help source entity GOV-01-Help so it is operated the HARD WAY:
-- log in as it and work its Task inbox with the real product (no bespoke admin). Idempotent, forward-only.
--
-- Operate it (dev):
--   POST /api/entities/register { "email": "help@chitbridge.system" }   (or { "email": "GOV-01-Help" } by name)
--   -> dev OTP 123456 (DEV_OTP) -> POST /api/entities/verify { email, otp } -> token.
-- Reachability: chit send requires NO connection (routes/chits.js:207) — any entity can address 'GOV-01-Help'
--   as a recipient (by display name or entity_id). Nothing else to enable.

BEGIN;

UPDATE identities
   SET display_name = 'GOV-01-Help'
 WHERE email = 'help@chitbridge.system'
   AND display_name IS DISTINCT FROM 'GOV-01-Help';

COMMIT;

-- verify:
-- SELECT display_name, email, status, sealed, governed_by, constitution_version
--   FROM identities WHERE email = 'help@chitbridge.system';
