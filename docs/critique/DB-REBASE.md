# Critique · DB-REBASE (one baseline, 18 Oct 2026) — written before the wiring

(a) Brief's assumptions, checked
- "000_baseline pair is the prod capture of 5 Jul" — TRUE (migrations/MANIFEST.md "BASELINE CAPTURED").
- "~290 b-migrations since" — TRUE: tools/migrate.cjs chainFiles() = 261 files (b42..b764), plus dryrun/verify/one-offs.
- "fresh-db and schema-replay use the chain" — TRUE: tools/fresh-db-check.cjs → migrate.apply(); tools/schema-replay.cjs imports chainFiles.
- "production may differ from the chain" — UNKNOWN until rebase-1 is pasted back (C:/dev/sql-to-run/2026-10-18/).
- The ledger (b304 schema_migrations) is IN the schema, so a new baseline must create it; apply() ran b304 first — must change.

(b) Conflicts with existing constructs
- One runner (migrate.cjs) stays the only runner; BASELINE moves to one constant there and schema-replay reads it from there (no third list).
- Applied migrations are never edited: the old files move, unchanged, to migrations/archive/ (git mv keeps history).
- Production must NOT run the new baseline: it gets a ledger row ('recorded') after the reconciliation, not the SQL.

(c) Simpler way
- pg_dump --schema-only of a chain-built scratch DB (+ the 30 seeded tables' rows) instead of the July catalog query: pg_dump is the
  literature's tool, round-trips triggers/defaults/grants, and needs no part-2 "passes" (it orders FKs after keys itself).

(d) Risks
- pg_dump cosmetics: a varchar CHECK `(ARRAY[..])::text[]` re-parses as `ARRAY[(..)::text]` (5 constraints, same meaning) — listed, not hidden.
- search_path '' breaks a trigger WHEN on ltree (`IS DISTINCT FROM`): the baseline sets 'pg_catalog, public' (pg_catalog first keeps
  gen_random_uuid bound to core, as the chain had it).
- Tests that read old files by path: point them at migrations/archive/ — mechanical, same assertions.
- Migration numbers: the baseline covers ≤ b764; b765/b766 are reserved in wt-mig-api and must apply on top (chain filter > 764).

(e) VERDICT: BUILD WITH CHANGES — the record-in-prod step waits for the fingerprint paste-back and Athi's reconciliation decisions.
