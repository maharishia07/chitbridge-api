# Migrations log — from the 18 Oct 2026 baseline onwards

One row per migration per database that matters (production first). Add the row when it RUNS, not when it is written.
`run-by` = who ran it (Athi for production) · `run-at` = date and time it ran · `how` = SQL editor / `tools/migrate.cjs` / recorded.
Before 18 Oct 2026 the record is `migrations/archive/` + the history section of `MANIFEST.md` (and prod's `schema_migrations`, where it has rows).

| migration | database | run-by | run-at | how | note |
|---|---|---|---|---|---|
| 000_baseline_2026-10-18.sql | production | — | — | **recorded, never run** | waits for rebase-1 (C:/dev/sql-to-run/2026-10-18) to show prod = baseline, or the differences reconciled |
| 000_baseline_2026-10-18.sql | local scratch (cb_rb_fresh) | Claude (db) | 2026-10-18 | tools/migrate.cjs | fingerprint = chain-built database, 1224 / 1224 objects, 30 / 30 seeded tables |
