-- RUN-2026-11-14-b860-identities-rls.sql (migration number b860) — SEC-185 (14 Nov 2026) = step B of SEC-184: row level security on identities, FORCE.
--
-- FILE NAME: the RUN- prefix keeps tools/migrate.cjs (CHAIN_SKIP) and the CI fresh-db build from applying it on their own, exactly as RUN-2026-10-25-b797-network-rls.sql: with it in the chain every realstack test that plants or reads identities as cb_app would meet FORCE row security before the sweep is done. Athi runs it by hand; the number b860 is the one the b857 header calls "b858".
-- ⚠️⚠️ THIS IS THE FILE THE b857 HEADER MEANS BY "b858". Its text says "Do NOT run b858 (the row-security policies on identities, step B, HOLD)":
--    b858 and b859 were taken by other work (b858_till_invoice_lease, b859_trigram_search_indexes), so the identities policies are THIS file, b860.
-- ⚠️⚠️ DRAFT · NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), on SIT first, then production. RUN ORDER, no other:
--    1. b857_signin_candidates_definer.sql is run (the sign-in lookup function exists, `SELECT * FROM ops.signin_candidates('email','x@y.z')` answers), AND
--    2. the api that carries SEC-185 is deployed and live (lib/signin-lookup.js no longer falls back to a direct read; sign-in credentials are read through db.queryAs), AND
--    3. node tools/identities-sweep.cjs --check prints "context-free sites: 0" on that api (every remaining read/write of identities has a shop or an identity bound), THEN
--    4. THIS file once, then the read-only CHECK below, then `node scripts/rls-census.cjs --save` so db/rls-baseline.json shows identities as RLS + FORCE.
--    Run it BEFORE 1-3 and every login, every signed-token check and every unbound read of identities fails closed (no row), by design.
--
-- WHO MAY SEE / WRITE A ROW (key: app.current_entity, set by withEntity / readBatch / queryAs; the shape of b778/b831/b855: NULLIF(current_setting(..., true), '')::uuid)
--   identities_own_tree      the row IS me, or its parent is me: the shop, its customers, staff and actors. Read and write (ALL).
--   identities_created_by_me a row this shop created (remote party, source, minted counterparty: created_by = me) stays readable and writable by its creator, so INSERT ... RETURNING works.
--   identities_read_counterparty  SELECT only: the other side of one of MY connections (connections is itself row-secured: either side) and the sender of a chit I hold.
--                            ⚠️ KNOWN WIDTH: a connected shop's whole identities row is readable by a session bound to its counterparty (display name, e-mail, status, and the
--                            credential columns). Narrowing it to a public-columns view is the follow-up named in the PR (SEC-186); the policy is read-only, so no write crosses shops.
--   Unbound (no entity, '' or unset): NULL = no match = no row. Sign-in finds a person through ops.signin_candidates (b857, SECURITY DEFINER, owner bypasses RLS), then binds
--   THAT identity (db.queryAs) to read or write its own credentials: the key it was found by is the only row it opens.
-- RLS: ENABLE + FORCE, literal statements (db-85 rule). Privileges unchanged (cb_app keeps SELECT, INSERT, UPDATE, DELETE).
--
-- ⚠️ scripts/WIPE.sql, scripts/reset-2-wipe.sql, scripts/cleanup-*.sql and scripts/reset-and-seed.js touch identities as postgres (BYPASSRLS) or as a named job: under FORCE the app role would touch 0 rows silently.
-- ROLL BACK (restores the open state exactly; the policies may stay: with RLS disabled they do nothing):
--    ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;  ALTER TABLE identities DISABLE ROW LEVEL SECURITY;
-- CHECK (read-only): SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname) AS policies
--      FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'identities' GROUP BY 1,2,3;
--      Expect: identities, true, true, 3.   And the sign-in door still answers as cb_app: SELECT count(*) FROM ops.signin_candidates('email', '<a known owner e-mail>'); expect 1.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- ALTER takes ACCESS EXCLUSIVE: fail fast instead of queueing behind a long read; a failed run changed nothing and is safe to run again

ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identities_own_tree ON identities;
CREATE POLICY identities_own_tree ON identities
  USING      (identity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
              OR parent_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (identity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
              OR parent_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP POLICY IF EXISTS identities_created_by_me ON identities;
CREATE POLICY identities_created_by_me ON identities
  USING      (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP POLICY IF EXISTS identities_read_counterparty ON identities;
CREATE POLICY identities_read_counterparty ON identities FOR SELECT
  USING (identity_id IN (SELECT CASE WHEN c.from_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid THEN c.to_entity_id ELSE c.from_entity_id END
                           FROM connections c)
         OR identity_id IN (SELECT h.sender_entity_id FROM chit_header h));

COMMIT;
