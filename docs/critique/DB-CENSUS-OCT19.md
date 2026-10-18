# Critique · DB-CENSUS-OCT19 (DB-1, DB-3, DB-4, DB-5 · plan topic 7a/7b/7d) — written before the files

(a) Brief's assumptions, checked
- "sql-to-run/2026-10-18/grants-census-1-readonly.sql exists" — TRUE (14 named tables only, not in any repo).
- "scripts/rls-census.cjs may exist" — TRUE (origin/main a023ae8e): live-only (needs DATABASE_URL), public schema, no grants detail.
- "a schema fingerprint exists" — TRUE: sql-to-run/2026-10-18/rebase-1-schema-fingerprint.sql (chain at 57d4f9fe ≤ b764); its tool
  (tools/schema-fingerprint.*) lives only on the unpushed WIP branch db/rebaseline (C:/dev/wt-rebase-api), left untouched.
- "the 14 add-only tables are add-only" — FALSE for 3: definition_version (lib/slab-cites.js:33, routes/testing.js:231),
  signup_context (routes/signin.js:538), ops.population (routes/entities.js:1511) are UPDATEd by the app.

(b) Conflicts with existing constructs
- Memory rule: SQL lives in chitbridge-api/migrations (main checkout). READ-YYYY-MM-DD-*.sql is the existing read-only form there
  (READ-2026-10-09-product-field-survey.sql), outside migrate.cjs chainFiles(). The two sql-to-run copies get a SUPERSEDED first line.
- One census: the editor file's `tables` object has the rls-baseline.json shape; rls-census.cjs gains --from to read the paste.

(c) Simpler way — none tonight: regenerating the fingerprint needs a fresh database (Docker), which is off-limits tonight.

(d) Risks
- No database was run: the READ files are checked by eye and a paren/quote balance only; a typo costs Athi one re-run, nothing else.
- b767 revokes from 11 tables; a writer added later that UPDATEs one of them gets 42501. The list names each table's writer.
- Default privileges (b48) still arm every new public table with UPDATE/DELETE: a rule change for Athi, not in b767.

(e) VERDICT: BUILD WITH CHANGES — the three app-updated tables are left out of b767 and handed to their areas.
