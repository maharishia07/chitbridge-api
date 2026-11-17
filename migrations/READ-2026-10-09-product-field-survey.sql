-- READ-2026-10-09-product-field-survey.sql
-- ⚠️ READ-ONLY. No CREATE, no INSERT, no UPDATE, no DELETE, no ALTER. Safe to run on production.
-- Athi runs it in the Supabase SQL editor (role postgres, so RLS does not hide rows) and pastes the WHOLE result back.
-- It is ONE query, so the editor shows everything: columns  section | subject | metric | value.
--
-- What it answers, per product field (C:/dev/toolset/fields/FIELDS-product.md, CMDB CAP-FIELDS-PRODUCT):
--   A  initialised: rows total, rows filled (not null / '' / [] / {}), distinct values, last written
--   B  keys inside item_data that the ledger does NOT know (a field nobody declared)
--   C  referenced fields: rows pointing at nothing (dangling)
--   D  copied fields: rows where the copy differs from its source (stale)
--   E  garbage: intermediate / history / queue tables — row counts and the oldest row
-- The ledger then records "initialised % · dangling n · stale n" per field.
-- A table that does not exist yet answers -1 (never an error): to_regclass guards it.

WITH
ci AS (SELECT item_id, entity_id, schema_id, item_data, is_active, created_at, updated_at FROM catalogue_items),
live AS (SELECT * FROM ci WHERE is_active IS NOT FALSE),
keys(k) AS (VALUES ('name'), ('unit'), ('price'), ('code'), ('sku'), ('desc'), ('description'), ('highlight'), ('brand'), ('variant'), ('grade'), ('barcode'), ('ean'), ('names'), ('synonyms'), ('aliases'), ('image'), ('media'), ('xref'), ('hsn'), ('hsn_code'), ('hs_code'), ('sac_code'), ('gst_rate'), ('tax_slab'), ('tax_slab_name'), ('mrp'), ('cost'), ('price_min'), ('price_max'), ('pricing_def'), ('pricing_kind'), ('pricing_tiers'), ('pricing_amount'), ('pricing_min'), ('pricing_max'), ('pricing_def_name'), ('lead_time_days'), ('min_order_qty'), ('categories'), ('category_names'), ('category'), ('status'), ('avail'), ('qty'), ('available'), ('batch_tracked'), ('tracking'), ('modifiers'), ('combo_of'), ('age_check'), ('offers_excluded'), ('exposure'), ('screen'), ('order'), ('effective'), ('commercials'), ('source_ref'), ('network_id'), ('operator'), ('fineness'), ('assay_cert'), ('bar_serial'), ('origin_farm'), ('varietal'), ('cupping_score'), ('moisture_pct'), ('shelf_life_days'), ('active_ingredient'), ('storage_temp'), ('texture_family'), ('colour_combination'), ('sheen'), ('coverage_sqft_per_litre'), ('stock_litres'), ('source_farm'), ('origin_country'), ('skill'), ('min_charge'), ('estimate_req'), ('sla_hours')),
filled AS (
  SELECT k.k, l.item_id, l.updated_at, l.item_data -> k.k AS v
    FROM keys k CROSS JOIN live l
   WHERE l.item_data ? k.k
     AND jsonb_typeof(l.item_data -> k.k) <> 'null'
     AND (l.item_data ->> k.k) IS DISTINCT FROM ''
     AND (l.item_data -> k.k) <> '[]'::jsonb AND (l.item_data -> k.k) <> '{}'::jsonb
),
tot AS (SELECT count(*)::bigint AS n, count(*) FILTER (WHERE NOT is_active) AS inactive FROM ci),
liven AS (SELECT count(*)::bigint AS n FROM live)
-- A · per key
SELECT 'A initialised', 'item_data.' || k.k, 'active_rows / filled / filled_% / distinct / last_written',
       (SELECT n FROM liven) || ' / ' || count(f.item_id) || ' / '
       || CASE WHEN (SELECT n FROM liven) = 0 THEN '-' ELSE round(100.0 * count(f.item_id) / (SELECT n FROM liven), 1)::text END || '% / '
       || count(DISTINCT f.v) || ' / ' || coalesce(max(f.updated_at)::text, 'never')
  FROM keys k LEFT JOIN filled f ON f.k = k.k GROUP BY k.k
UNION ALL
SELECT 'A initialised', 'catalogue_items.(rows)', 'total / inactive', (SELECT n FROM tot) || ' / ' || (SELECT inactive FROM tot)
UNION ALL
SELECT 'A initialised', 'catalogue_items.schema_id', 'null rows', count(*) FILTER (WHERE schema_id IS NULL)::text FROM ci
UNION ALL
SELECT 'A initialised', 'catalogue_items.created_at / updated_at', 'oldest created / latest updated', min(created_at)::text || ' / ' || max(updated_at)::text FROM ci
-- B · unknown keys
UNION ALL
SELECT 'B unknown key', kk, 'rows carrying it', count(*)::text
  FROM live l, jsonb_object_keys(l.item_data) AS kk
 WHERE kk NOT IN (SELECT k FROM keys)
 GROUP BY kk
-- C · dangling references
UNION ALL
SELECT 'C dangling', 'item_data.tax_slab', 'rows citing a slab that is not a live tax definition', count(*)::text
  FROM live l WHERE l.item_data ->> 'tax_slab' <> '' AND NOT EXISTS (SELECT 1 FROM definition d WHERE d.definition_id::text = l.item_data ->> 'tax_slab' AND d.kind = 'tax')
UNION ALL
SELECT 'C dangling', 'item_data.pricing_def', 'rows citing a pricing structure that does not exist', count(*)::text
  FROM live l WHERE l.item_data ->> 'pricing_def' <> '' AND NOT EXISTS (SELECT 1 FROM definition d WHERE d.definition_id::text = l.item_data ->> 'pricing_def' AND d.kind = 'pricing')
UNION ALL
SELECT 'C dangling', 'item_data.categories', 'category ids (in rows) that are not a category definition', count(*)::text
  FROM live l, jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.item_data -> 'categories') = 'array' THEN l.item_data -> 'categories' ELSE '[]'::jsonb END) AS cid
 WHERE NOT EXISTS (SELECT 1 FROM definition d WHERE d.definition_id::text = cid AND d.kind = 'category')
UNION ALL
SELECT 'C dangling', 'catalogue_items.schema_id', 'rows whose schema does not exist', count(*)::text FROM ci WHERE schema_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entity_schemas s WHERE s.schema_id = ci.schema_id)
UNION ALL
SELECT 'C dangling', 'catalogue_item_version.item_id', 'versions of a product that no longer exists', CASE WHEN to_regclass('catalogue_item_version') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM catalogue_item_version v WHERE NOT EXISTS (SELECT 1 FROM catalogue_items i WHERE i.item_id = v.item_id)', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'catalogue_item_schedule.item_id', 'queued changes for a product that no longer exists', CASE WHEN to_regclass('catalogue_item_schedule') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM catalogue_item_schedule s WHERE NOT EXISTS (SELECT 1 FROM catalogue_items i WHERE i.item_id = s.item_id)', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'combo_templates.product_item_id', 'combos pointing at a missing product (no FK)', CASE WHEN to_regclass('combo_templates') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM combo_templates t WHERE t.product_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalogue_items i WHERE i.item_id = t.product_item_id)', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'stock_balance.item_id', 'catalogue-kind balances with no product', CASE WHEN to_regclass('stock_balance') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM stock_balance b WHERE b.item_kind = ''catalogue'' AND NOT EXISTS (SELECT 1 FROM catalogue_items i WHERE i.item_id = b.item_id)', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'stock_movement.item_id', 'catalogue-kind movements with no product', CASE WHEN to_regclass('stock_movement') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM stock_movement m WHERE m.item_kind = ''catalogue'' AND NOT EXISTS (SELECT 1 FROM catalogue_items i WHERE i.item_id = m.item_id)', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'quick_key_group_item.product_id', 'quick-key slots holding a REMOVED product (soft delete)', CASE WHEN to_regclass('quick_key_group_item') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM quick_key_group_item g JOIN catalogue_items i ON i.item_id = g.product_id WHERE i.is_active = false', false, true, '')))[1]::text END
UNION ALL
SELECT 'C dangling', 'counter_hidden_item.product_id', 'hidden-item rows for a REMOVED product (soft delete)', CASE WHEN to_regclass('counter_hidden_item') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM counter_hidden_item h JOIN catalogue_items i ON i.item_id = h.product_id WHERE i.is_active = false', false, true, '')))[1]::text END
-- D · copies that differ from their source
UNION ALL
SELECT 'D stale copy', 'item_data.tax_slab_name', 'rows whose copied name differs from the slab''s name', count(*)::text
  FROM live l JOIN definition d ON d.definition_id::text = l.item_data ->> 'tax_slab' AND d.kind = 'tax' WHERE l.item_data ->> 'tax_slab_name' IS DISTINCT FROM d.name
UNION ALL
SELECT 'D stale copy', 'item_data.gst_rate', 'rows whose copied rate differs from the slab''s current rate', count(*)::text
  FROM live l JOIN definition d ON d.definition_id::text = l.item_data ->> 'tax_slab' AND d.kind = 'tax'
  JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
 WHERE l.item_data ? 'gst_rate' AND (l.item_data ->> 'gst_rate') IS DISTINCT FROM (v.rules ->> 'rate')
UNION ALL
SELECT 'D stale copy', 'item_data.pricing_def_name', 'rows whose copied name differs from the structure''s name', count(*)::text
  FROM live l JOIN definition d ON d.definition_id::text = l.item_data ->> 'pricing_def' AND d.kind = 'pricing' WHERE l.item_data ->> 'pricing_def_name' IS DISTINCT FROM d.name
UNION ALL
SELECT 'D stale copy', 'item_data.category_names', 'rows whose name list differs in length from the category ids', count(*)::text
  FROM live l WHERE jsonb_typeof(l.item_data -> 'categories') = 'array'
   AND jsonb_array_length(l.item_data -> 'categories') <> coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(l.item_data -> 'category_names') = 'array' THEN l.item_data -> 'category_names' END), 0)
UNION ALL
SELECT 'D stale copy', 'item_data.image', 'rows with an image but no media, or an image that is not the first picture', count(*)::text
  FROM live l WHERE l.item_data ->> 'image' <> ''
   AND l.item_data ->> 'image' NOT LIKE '%/api/products/media/%'
UNION ALL
SELECT 'D two sources', 'code vs sku', 'rows holding both with different values', count(*)::text FROM live l WHERE l.item_data ->> 'code' <> '' AND l.item_data ->> 'sku' <> '' AND l.item_data ->> 'code' <> l.item_data ->> 'sku'
UNION ALL
SELECT 'D two sources', 'desc vs description', 'rows holding both', count(*)::text FROM live l WHERE l.item_data ->> 'desc' <> '' AND l.item_data ->> 'description' <> ''
UNION ALL
SELECT 'D two sources', 'hsn vs hsn_code vs hs_code', 'rows holding two or more different values', count(*)::text FROM live l WHERE (SELECT count(DISTINCT x) FROM unnest(ARRAY[l.item_data ->> 'hsn', l.item_data ->> 'hsn_code', l.item_data ->> 'hs_code']) x WHERE x <> '') > 1
UNION ALL
SELECT 'D two sources', 'barcode vs ean', 'rows holding both with different values', count(*)::text FROM live l WHERE l.item_data ->> 'barcode' <> '' AND l.item_data ->> 'ean' <> '' AND l.item_data ->> 'barcode' <> l.item_data ->> 'ean'
UNION ALL
SELECT 'D two sources', 'variant vs grade', 'rows holding both', count(*)::text FROM live l WHERE l.item_data ->> 'variant' <> '' AND l.item_data ->> 'grade' <> ''
UNION ALL
SELECT 'D two sources', 'batch_tracked vs tracking', 'rows holding both', count(*)::text FROM live l WHERE l.item_data ? 'batch_tracked' AND l.item_data ->> 'tracking' <> ''
UNION ALL
SELECT 'D two sources', 'qty vs avail.qty', 'rows with a raw item_data.qty beside avail', count(*)::text FROM live l WHERE l.item_data ? 'qty' AND l.item_data ? 'avail'
UNION ALL
SELECT 'D stale copy', 'catalogue_item_version (current) vs item_data', 'live products whose current version snapshot differs', CASE WHEN to_regclass('catalogue_item_version') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM catalogue_items i JOIN catalogue_item_version v ON v.item_id = i.item_id AND v.valid_to IS NULL WHERE v.snapshot IS DISTINCT FROM i.item_data', false, true, '')))[1]::text END
-- E · garbage: history, queues, left-behind rows
UNION ALL
SELECT 'E garbage', 'catalogue_item_version', 'rows / oldest / products with more than 50 versions', CASE WHEN to_regclass('catalogue_item_version') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) || '' / '' || coalesce(min(created_at)::text, ''-'') || '' / '' || (SELECT count(*) FROM (SELECT item_id FROM catalogue_item_version GROUP BY item_id HAVING count(*) > 50) z) AS c FROM catalogue_item_version', false, true, '')))[1]::text END
UNION ALL
SELECT 'E garbage', 'catalogue_item_schedule', 'applied-or-cancelled rows / oldest / still waiting and overdue', CASE WHEN to_regclass('catalogue_item_schedule') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) FILTER (WHERE applied_at IS NOT NULL OR cancelled_at IS NOT NULL) || '' / '' || coalesce(min(created_at)::text, ''-'') || '' / '' || count(*) FILTER (WHERE applied_at IS NULL AND cancelled_at IS NULL AND effective_at < now()) AS c FROM catalogue_item_schedule', false, true, '')))[1]::text END
UNION ALL
SELECT 'E garbage', 'removed products still holding media', 'inactive products with a non-empty media list (bytes may remain in the object store)', count(*)::text FROM ci WHERE NOT is_active AND jsonb_typeof(item_data -> 'media') = 'array' AND jsonb_array_length(item_data -> 'media') > 0
UNION ALL
SELECT 'E garbage', 'removed products (all)', 'inactive rows / oldest updated', count(*) FILTER (WHERE NOT is_active) || ' / ' || coalesce(min(updated_at) FILTER (WHERE NOT is_active)::text, '-') FROM ci
UNION ALL
SELECT 'E garbage', 'schema_fields (declared, unused)', 'declared columns that no live product fills', count(*)::text
  FROM schema_fields sf WHERE NOT EXISTS (SELECT 1 FROM live l WHERE l.item_data ? sf.field_key AND (l.item_data ->> sf.field_key) IS DISTINCT FROM '')
UNION ALL
SELECT 'E garbage', 'schema_fields.max_value / default_value / options / placeholder / xref', 'rows where any is non-null (proves "not used" is also "never written")',
  count(*) FILTER (WHERE max_value IS NOT NULL OR default_value IS NOT NULL OR options IS NOT NULL OR placeholder IS NOT NULL OR xref IS NOT NULL)::text FROM schema_fields
UNION ALL
SELECT 'E legacy', 'cb_catalogue_item', 'rows (0 = safe to retire; keep a copy first)', CASE WHEN to_regclass('cb_catalogue_item') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM cb_catalogue_item', false, true, '')))[1]::text END
ORDER BY 1, 2, 3;
