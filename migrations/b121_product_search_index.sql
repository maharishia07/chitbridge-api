-- b121_product_search_index.sql — make product search indexable at volume.
--
-- Athi, 2026-08-08: *"do we have the index for the products? If the search is slower with countless products and
-- stores, no one will prefer it — we need to see how to optimise."*
--
-- ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ──────────────────────────────────────────────────────────────────
-- `idx_catalogue_items_entity (entity_id, is_active)` exists, so a search is already bounded to ONE store's rows
-- rather than the whole table. That is the difference between "scales with the network" and "scales with the
-- platform", and it was the important one to have.
--
-- What is NOT indexable is the matching itself:
--
--     LOWER(item_data->>'name') LIKE '%impeller%'
--
-- A leading wildcard cannot use a btree index, so within a store this is a scan. With fifty products per store
-- that is free. With fifty THOUSAND in one distributor's catalogue it is the whole cost of the query, and it is
-- exactly the case Athi is describing.
--
-- ── pg_trgm ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Trigram indexes are the standard answer for `%substring%` in Postgres: the expression is broken into three-letter
-- grams and a GIN index over them turns a scan into a lookup. It is an extension rather than a rewrite of the
-- query, and Supabase ships it.
--
-- Indexed on the SAME expressions the search uses, lowercased, or Postgres will not match them to the query. An
-- expression index that does not exactly match the predicate is an index that silently never gets used, which is
-- worse than none — it costs writes and buys nothing.
--
-- ⚠️ NOT YET MEASURED AT VOLUME. On today's data every table is small enough that Postgres will sensibly ignore
-- these and scan anyway, so applying this proves nothing on its own. The honest test is a store with tens of
-- thousands of items and an EXPLAIN; until then this is preparation, not a demonstrated win.
--
-- Safe to re-run.
-- Rollback:  DROP INDEX idx_ci_name_trgm, idx_ci_code_trgm, idx_ci_sku_trgm;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_ci_name_trgm
  ON catalogue_items USING gin ((LOWER(item_data->>'name')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ci_code_trgm
  ON catalogue_items USING gin ((LOWER(item_data->>'code')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ci_sku_trgm
  ON catalogue_items USING gin ((LOWER(item_data->>'sku')) gin_trgm_ops);

COMMENT ON INDEX idx_ci_name_trgm IS
  'Trigram index for substring product search. Must match LOWER(item_data->>''name'') exactly or it will not be used.';
