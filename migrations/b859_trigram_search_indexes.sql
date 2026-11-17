-- b859_trigram_search_indexes.sql — QA-172 / cb-db (14 Nov 2026): trigram (gin_trgm_ops) indexes for the substring searches in lib/business-search.js,
-- lib/books-store.js (party name match) and routes/network-design.js (catalogue name/code/sku), so a leading-wildcard LIKE '%x%' is not a table scan.
--
-- The Supabase SQL editor wraps a multi-line run in a transaction, so CONCURRENTLY fails (25001); run each CREATE INDEX CONCURRENTLY line on its own.
-- ⚠️⚠️ NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres), ON ITS OWN: CREATE INDEX CONCURRENTLY cannot run inside a
--    transaction, so this file has NO BEGIN/COMMIT and must not be pasted together with another file (the editor must not wrap it).
--    Idempotent: CREATE EXTENSION / CREATE INDEX ... IF NOT EXISTS, a second run changes nothing. Touches no rows; builds without blocking writes.
--    If a run is interrupted it can leave an INVALID index: DROP INDEX CONCURRENTLY <name>; and run this file again.
--
-- WHY: migrations/MANIFEST.md says production holds no idx_ci_*_trgm (b121 was a chain-only object, not in the 2026-10-21 baseline), so the
--    catalogue search is a scan on production AND on a fresh database. The expressions below match the queries character for character
--    (LOWER(item_data->>'name'), LOWER(display_name), lower(COALESCE(nickname,''))), or the planner cannot use them.
-- NOT COVERED (and why): routes/chits.js dispute search is ILIKE over a concat_ws of columns from two tables (not indexable as written);
--    lib/crm-leads.js and lib/local-identity.js use LIKE 'prefix%' (trailing wildcard, a btree prefix, not a trigram job).
-- RLS: unchanged (an index is not a policy; every table here keeps its policies).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- catalogue search (routes/network-design.js; b121's three, same names, so a database that has b121 keeps them)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ci_name_trgm ON catalogue_items USING gin ((LOWER(item_data->>'name')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ci_code_trgm ON catalogue_items USING gin ((LOWER(item_data->>'code')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ci_sku_trgm  ON catalogue_items USING gin ((LOWER(item_data->>'sku'))  gin_trgm_ops);

-- shop search and party-name match (lib/business-search.js, lib/books-store.js)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identities_display_name_trgm ON identities USING gin ((LOWER(display_name)) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identities_user_id_trgm      ON identities USING gin ((LOWER(user_id)) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_list_nickname_trgm  ON supplier_list USING gin ((lower(COALESCE(nickname, ''))) gin_trgm_ops);
