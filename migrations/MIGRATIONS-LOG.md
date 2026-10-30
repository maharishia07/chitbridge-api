# Migrations log: from the 21 Oct 2026 baseline onwards

One row per migration per database that matters (production first). Add the row when it RUNS, not when it is written.
`run-by` = who ran it (Athi for production) · `run-at` = date and time it ran · `how` = SQL editor / `tools/migrate.cjs` / recorded.
Before 21 Oct 2026 the record is `migrations/archive/` + the history section of `MANIFEST.md` (and prod's `schema_migrations`, where it has rows).

| migration | database | run-by | run-at | how | note |
|---|---|---|---|---|---|
| 000_baseline_2026-10-21.sql | production | none | none | **recorded, never run** | production IS this schema (the file is its 21 Oct 06:46 IST dump); Athi records it with `--record` |
| 000_baseline_2026-10-21.sql | local scratch (PostgreSQL 17.11) | Claude (db) | 2026-10-21 | tools/migrate.cjs (fresh-db-check) | clean; dumped again, equals the snapshot except the Supabase-role grants it leaves out |
| 000_baseline_2026-10-21.sql | local stack (PostgreSQL 16) | Claude (db) | 2026-10-21 | toolset/local-stack.sh up | boots and seeds |
| b768_membership_kind_read_policy.sql | production | Athi | 2026-10-21 | recorded | `schema_migrations` source `recorded`, sha256 `e3690bcb…` = the LF file; LF everywhere since `.gitattributes` `* text=auto eol=lf` (K-DB), so `--status` is clean with no re-record |
| b778_rls_governance_exceptions.sql | production | Athi | 2026-10-30 | SQL editor (as postgres) | ran, result not yet reported; RLS ON + FORCE + rls_entity on `governance_exceptions` (api #338); sha256 `33bb7c67…` = the LF file; `schema_migrations` source `recorded` is Athi's `--record`, still to do |
| b779_rls_dormant_cb_tables.sql | production | Athi | 2026-10-29 | SQL editor (as postgres) | success, no rows; six dormant cb_* tables now RLS ON + FORCE + rls_entity (api #338); sha256 `afd00689…`; `schema_migrations` source `recorded` is Athi's `--record` |
| b783_rls_legacy_cb_chit_catalogue.sql | production | Athi | 2026-10-29 | SQL editor (as postgres) | success, no rows; seven legacy cb_* tables now RLS ON + FORCE + rls_entity (api #545); sha256 `3bc37d6a…`; `schema_migrations` source `recorded` is Athi's `--record` |
