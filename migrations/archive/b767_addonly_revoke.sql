-- b767_addonly_revoke.sql — DB-4 (plan topic 7b, Tue 20): ADD-ONLY TABLES LOSE THE UPDATE/DELETE THE DEFAULT PRIVILEGES GAVE THEM.
-- OWNER: cb-db. Readers/writers of each table are named in the list below (checked against origin/main a023ae8e on 19 Oct).
--
-- ⚠️⚠️ DRAFT — NOT RUN · NOT FOR TONIGHT · Athi runs it (Supabase SQL editor, AS postgres) only AFTER census 1
--    (migrations/READ-2026-10-19-1-rls-grants-census.sql) has been pasted back and Claude has confirmed which rows say 'EXTRA'.
--    Safe to re-run: REVOKE of a privilege not held is a no-op; a table that does not exist is skipped with a NOTICE. Touches no rows.
--    Order: any time after census 1. No code waits for it: no route UPDATEs or DELETEs these tables today.
--
-- WHY. migration_b48 set `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cb_app`, so every
--    public table created afterwards was born with UPDATE and DELETE for the app. A later `GRANT SELECT, INSERT` only ADDS; it never takes
--    those away. b765 found it live on 18 Oct (sql-to-run b765-3 → b765-4). The ten tables below were written as add-only (a ledger, a
--    log, a version, a proof) and nothing in the api changes or removes their rows, so the right to do so is only a way to lose history.
--
-- NOT IN THIS LIST, on purpose (the app UPDATEs them, so a REVOKE would break it — each is a question for its area, not for this file):
--    definition_version  — b160 calls it "append-only BY GRANT", but lib/slab-cites.js:33 (tax-slab takeover) and routes/testing.js:231
--                          (test-case closure note) UPDATE its rules. Catalogue/QA decide: new version row, or allow the update.
--    signup_context      — b265 grants INSERT only, yet routes/signin.js:538 UPDATEs country_source (b383). Live probably refuses it
--                          (the catch logs it); census 1 shows which.
--    ops.population      — b249 grants SELECT, INSERT, yet routes/entities.js:1511 UPDATEs desk_entity_id. Same question.
--
-- NOT IN THIS FILE: changing the DEFAULT PRIVILEGES themselves. Revoking UPDATE/DELETE there would make every future migration GRANT
--    them explicitly for an ordinary table — a rule change for Athi to decide. Today tests/migration-lint.test.cjs already refuses a NEW
--    insert-only GRANT without its REVOKE beside it, which closes the gap for new tables.
--
-- RLS: unchanged (every table here keeps its own policy). Retention: a future purge of these tables runs as the owner, never as cb_app.

DO $$
DECLARE
  t   text;
  rel regclass;
  n_done int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.source_penetration',     -- b79   INSERT only (routes/catalogue.js:1331)
    'public.product_version',        -- b80   immutable versions (lib/container.js:36)
    'public.resolved_blueprint',     -- b81   INSERT … ON CONFLICT DO NOTHING (lib/regional.js:55) — needs no UPDATE
    'public.erp_handoff',            -- b82   INSERT only (routes/catalogue.js:1344)
    'public.usage_ledger',           -- b99   the meter (lib/meter.js:63, lib/ai.js:512, lib/kyb.js:272)
    'public.kyb_field_cache',        -- b107  INSERT only (lib/kyb.js:275)
    'public.definition_status_log',  -- b268  INSERT only (routes/definitions.js:333, :395)
    'public.ai_usage',               -- b269  no writer in the api today
    'public.books_compare_part',     -- b309  INSERT only (lib/books-store.js:871)
    'public.fx_rate',                -- b391  newest row wins (lib/books-store.js:285)
    'public.move_in_import'          -- b765  already fixed live by sql-to-run b765-4; repeated so a fresh database matches
  ] LOOP
    rel := to_regclass(t);
    IF rel IS NULL THEN
      RAISE NOTICE 'b767: % does not exist here — skipped', t;
    ELSE
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM cb_app', rel);
      n_done := n_done + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'b767: UPDATE, DELETE, TRUNCATE revoked from cb_app on % add-only tables', n_done;
END $$;

-- AFTER (read-only, the same statement as the run's result): ONE row per table. Expect app = 'INSERT, SELECT' on every row present.
SELECT t AS table_name,
       (to_regclass(t) IS NOT NULL) AS exists_,
       CASE WHEN to_regclass(t) IS NULL THEN NULL ELSE
         concat_ws(', ', CASE WHEN has_table_privilege('cb_app', to_regclass(t), 'INSERT') THEN 'INSERT' END,
                         CASE WHEN has_table_privilege('cb_app', to_regclass(t), 'SELECT') THEN 'SELECT' END,
                         CASE WHEN has_table_privilege('cb_app', to_regclass(t), 'UPDATE') THEN 'UPDATE' END,
                         CASE WHEN has_table_privilege('cb_app', to_regclass(t), 'DELETE') THEN 'DELETE' END) END AS app
  FROM unnest(ARRAY['public.source_penetration', 'public.product_version', 'public.resolved_blueprint', 'public.erp_handoff',
                    'public.usage_ledger', 'public.kyb_field_cache', 'public.definition_status_log', 'public.ai_usage',
                    'public.books_compare_part', 'public.fx_rate', 'public.move_in_import']) AS t
 ORDER BY 1;
