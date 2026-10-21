-- b198 VERIFY — did the backfill actually SEE your data?
--
-- ⚠️⚠️ WHY THIS EXISTS, AND IT IS THE MOST IMPORTANT LINE IN THE FILE.
--
-- `catalogue_items` carries row-level security. **RLS with no context is not "unrestricted", it is "matches
-- nothing".** So a session that is subject to RLS and has no `app.current_entity` set sees ZERO products — and
-- b198 would then have found zero undeclared columns, declared nothing, and its own verification would have
-- printed "every column in the data is now declared". A false pass that looks exactly like a real one.
--
-- ⚠️ b198_DRYRUN HAD THE SAME BLIND SPOT and this fixes it: it reported `columns_to_declare = 0` identically
-- whether there was nothing to do or nothing was visible. A check that cannot tell those apart is not a check.
--
-- READ-ONLY. Nothing is written. One result set.
--
-- HOW TO READ IT:
--   items_visible = 0            → ⚠️ RLS BLOCKED YOUR SESSION. b198 did nothing. Re-run it as a role that
--                                  bypasses RLS (the Supabase SQL editor's postgres role normally does, unless
--                                  the table is FORCE ROW LEVEL SECURITY), then run this again.
--   items_visible > 0
--     and undeclared_remaining = 0  → ✅ done. Every column in the data is declared.
--     and undeclared_remaining > 0  → b198 ran but did not finish — see the detail rows for which entities.

WITH reserved AS (
  SELECT unnest(ARRAY[
    'status','avail','categories','category_names','category','commercials','synonyms','source_ref',
    'quantity','is_active','order_input','item_id','entity_id','schema_id'
  ]) AS k
),
seen AS (
  SELECT count(*)::int AS items_visible,
         count(DISTINCT entity_id)::int AS entities_visible
    FROM catalogue_items
   WHERE is_active = true
),
observed AS (
  SELECT ci.entity_id, kv.key AS field_key, count(*)::int AS used_by
    FROM catalogue_items ci
    CROSS JOIN LATERAL jsonb_each_text(ci.item_data) AS kv
   WHERE ci.is_active = true
     AND kv.value IS NOT NULL AND btrim(kv.value) <> ''
     AND kv.key NOT IN (SELECT k FROM reserved)
     AND kv.key NOT LIKE '%\_currency'
   GROUP BY ci.entity_id, kv.key
),
declared AS (
  SELECT es.entity_id, sf.field_key
    FROM entity_schemas es
    JOIN schema_fields sf ON sf.schema_id = es.schema_id
   WHERE es.status = 'active' AND es.is_default = true
),
gap AS (
  SELECT o.* FROM observed o
    LEFT JOIN declared d ON d.entity_id = o.entity_id AND d.field_key = o.field_key
   WHERE d.field_key IS NULL
)
SELECT 1 AS ord,
       'VERDICT' AS section,
       (SELECT items_visible FROM seen)::text     AS items_visible,
       (SELECT entities_visible FROM seen)::text  AS entities_visible,
       (SELECT count(*) FROM gap)::text           AS undeclared_remaining,
       CASE
         WHEN (SELECT items_visible FROM seen) = 0
           THEN 'RLS BLOCKED THIS SESSION - b198 saw nothing and declared nothing. Re-run it with RLS bypassed.'
         WHEN (SELECT count(*) FROM gap) = 0
           THEN 'DONE - every column in the data is declared. The Columns panel, the template and the export now agree.'
         ELSE 'INCOMPLETE - b198 ran but columns remain. See the DETAIL rows.'
       END AS verdict,
       NULL::text AS entity, NULL::text AS field_key, NULL::text AS used_by
UNION ALL
SELECT 2, 'DETAIL', NULL, NULL, NULL, NULL,
       g.entity_id::text, g.field_key, g.used_by::text
  FROM gap g
 ORDER BY ord, field_key;
