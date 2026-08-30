-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b186 · DRY RUN — what b185 left behind
--
-- READS ONLY. Nothing here changes anything; run it, look at the row, then run b186_register_seed_apply.sql.
--
-- ⚠️ WHY THIS EXISTS. After b185 the app reported the registry of "what a register may be attached to" as EMPTY
-- while every other part of the register worked. Two things did not land:
--
--   1. register_attachable was CREATED but never SEEDED — so nothing could be attached to anything.
--   2. register_subject already existed, so `CREATE TABLE IF NOT EXISTS register_subject` was skipped and its
--      FOREIGN KEY on type_key was never created. That is why the gap stayed invisible: opening a register
--      against an empty registry SUCCEEDED, where the foreign key would have refused it.
--
-- ONE result set, no psql commands, nothing to scroll.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'register_attachable')      AS registry_table_exists,
  (SELECT count(*) FROM register_attachable)                                    AS registry_rows_now,
  (SELECT count(*) FROM register_attachable WHERE active)                       AS registry_rows_active,
  12                                                                            AS registry_rows_expected,
  /* Does register_subject.type_key point at the registry at all? 0 = the constraint was skipped. */
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'register_subject'::regclass AND contype = 'f'
       AND confrelid = 'register_attachable'::regclass)                         AS type_key_fk_present,
  /* ⚠️ THE ONE THAT DECIDES WHETHER THE FK CAN BE ADDED. Any subject already carrying a type_key that the seed
     does not define would make ADD CONSTRAINT fail — the apply script reports them rather than erroring. */
  (SELECT count(*) FROM register_subject s
    WHERE NOT EXISTS (SELECT 1 FROM register_attachable a WHERE a.type_key = s.type_key)) AS subjects_with_unknown_kind,
  (SELECT count(*) FROM register_subject)                                       AS subjects_total;
