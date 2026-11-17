# Critique · DB-3 (re-baseline from production's own dump, 21 Oct 2026) — written before the PR is cut

Follows docs/critique/DB-REBASE.md (18 Oct, the hung WIP); that critique's wiring (one runner, archive/, stray files, ledger in the baseline) is kept.

(a) Assumptions, checked
- "the snapshot is the whole schema" — FALSE for ops and metrics: `-n public` leaves them out (the app role is closed out of ops). They come from the migration files and are marked "not compared with live" in the baseline.
- "the old chain equals production" — FALSE (the reason for DB-3): production lacks b60 tables, b121 indexes, b243/b275/b292/b294 columns and runs 8 older function bodies (migrations/MANIFEST.md lists them). A baseline built from the chain would have been wrong.
- "RUN-2026-10-20-0..4 and b765..b767 are in the snapshot" — TRUE (cb_backup grants, `usage_ledger` SELECT,INSERT, `source_ref` columns, `move_in_import`); folded, not applied twice. RUN-8..11 are purge / VACUUM data runs: left out.
- "a PG17 dump loads on the local stack" — the stack runs PostgreSQL 16: `SET transaction_timeout` is stripped; proven on 16 and 17.

(b) Conflicts: none with DECISIONS (one baseline = production now). One runner stays `tools/migrate.cjs`; the old files move unchanged to archive/ (git mv), none deleted. The snapshot is NOT committed (it lists every table and policy of production).

(c) Simpler way: committing the snapshot as is — rejected: it needs `\restrict` stripped, Supabase roles, ops before identities (a foreign key), and it carries no seed rows.

(d) Risks: seed rows come from the chain and must fit production's columns (the blueprint columns production lacks are dropped from the rows); the first fresh database of anyone on PostgreSQL 15 or older is untested; recording the baseline in production's ledger is Athi's step.

(e) VERDICT: BUILD WITH CHANGES — ops/metrics/seed from migrations; archive the chain; list production's drift for Athi instead of "fixing" it.
