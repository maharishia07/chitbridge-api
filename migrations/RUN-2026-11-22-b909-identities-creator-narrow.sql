-- RUN-2026-11-22-b909-identities-creator-narrow.sql (migration number b909) — F13 (platform-10, lens finding verified REAL P2): the creator arm of identities row security is too wide.
--
-- ⚠️ NOT RUN anywhere by the api · Athi runs it AS postgres (Supabase SQL editor), SIT first, then production. RUN- prefix: tools/migrate.cjs (CHAIN_SKIP) and the fresh-db build skip it, as b860.
-- RUN ORDER   AFTER RUN-2026-11-14-b860-identities-rls.sql (this replaces its policy identities_created_by_me, so b860 must have run; if it has not, this file stops with a notice and changes nothing)
--             and after the 1129 api is live (lib/creator-edit.js says the same rule in words; without it a refused arrange of a claimed store would read as zero rows).
-- WHY         b860's identities_created_by_me is FOR ALL: the shop that minted an identity (created_by = me) can UPDATE and DELETE it for ever, also AFTER the person signed in and took it over.
--             The decided design (lib/network-design reissue, R2-01): once claimed, the creator "holds no key to the store". Industry: OWASP API1 object-level authorisation, NIST SP 800-162 (the claim is an attribute of the object).
-- AFTER       creator arm split in three:
--               SELECT  created_by = me                                             (unchanged: INSERT ... RETURNING and seeing what you minted)
--               INSERT  WITH CHECK created_by = me                                  (unchanged)
--               UPDATE  USING created_by = me AND (last_active_at IS NULL           (unclaimed: the shop may still correct what it typed)
--                                              OR entity_kind = 'network')           (a store the operator PROVISIONED stays arranged by the operator: visibility cap, order, place)
--                       WITH CHECK created_by = me                                  (cannot hand the row to someone else)
--               DELETE  no creator arm at all: a shop never deletes an identity it minted; it ends its link (connections / grants). Parent-tree deletes (identities_own_tree) are unchanged.
--             No column, no data and no other policy is touched. identities_own_tree (shop, its customers, staff, actors) still writes as before.
-- ROLL BACK   restores b860's wider policy exactly:
--               DROP POLICY IF EXISTS identities_created_by_me_read ON identities;  DROP POLICY IF EXISTS identities_created_by_me_insert ON identities;  DROP POLICY IF EXISTS identities_created_by_me_update ON identities;
--               CREATE POLICY identities_created_by_me ON identities USING (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid) WITH CHECK (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- CHECK (read-only): SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.identities'::regclass AND polname LIKE 'identities_created_by_me%' ORDER BY 1;
--             Expect 3 rows: identities_created_by_me_insert (a), _read (r), _update (w), and NO row named exactly identities_created_by_me. Safe to run twice.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $f13$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.identities'::regclass) THEN
    RAISE NOTICE 'F13: row security on identities is not on (b860 has not run): nothing changed';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS identities_created_by_me ON identities;
  DROP POLICY IF EXISTS identities_created_by_me_read ON identities;
  DROP POLICY IF EXISTS identities_created_by_me_insert ON identities;
  DROP POLICY IF EXISTS identities_created_by_me_update ON identities;
  CREATE POLICY identities_created_by_me_read ON identities FOR SELECT
    USING (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid);
  CREATE POLICY identities_created_by_me_insert ON identities FOR INSERT
    WITH CHECK (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid);
  CREATE POLICY identities_created_by_me_update ON identities FOR UPDATE
    USING      (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid AND (last_active_at IS NULL OR entity_kind = 'network'))
    WITH CHECK (created_by = NULLIF(current_setting('app.current_entity', true), '')::uuid);
END
$f13$;
COMMIT;
