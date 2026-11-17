-- b201 DRY RUN — what does the regional layer already say about tax, per country?
--
-- ⚠️ READS ONLY. Nothing is written. Then run b201_india_gst_governance_APPLY.sql.
-- Either RLS mode: region_layer has none.
--
-- WHY (Athi, 2026-09-04): "we have already a governance layer where we have to create those and inherit here, why each
-- entity should create one for them." The GST slabs are a fact of the jurisdiction, so they live on the regional layer
-- (region_layer.jurisdiction, b81) and every Indian entity inherits them; an entity authors a slab only as an exception.
--
-- HOW TO READ IT: one row per seeded country. `tax_declared` = true means a tax block already exists (APPLY merges, it
-- does not overwrite an existing slab list — see the APPLY header).

SELECT region_code,
       currency,
       (jurisdiction ? 'tax')                              AS tax_declared,
       jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs', '[]'::jsonb)) AS slabs_now,
       jurisdiction->'tax'->>'scheme'                      AS scheme
  FROM region_layer
 ORDER BY region_code;
