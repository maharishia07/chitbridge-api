-- b193 · READ ONLY. Why does a storefront show the ADOPTED catalogue but not the shop's OWN products?
--
-- Athi, observation-3 (2026-09-01): "when I open the storefront, only the beta timers inherited catalogue only
-- appears, but not the rest. Need to understand the difference."
--
-- ── THE ASYMMETRY, AND WHY IT IS INVISIBLE ───────────────────────────────────────────────────────────────────
-- lib/catalogue-view.js reads the two halves of a storefront DIFFERENTLY:
--
--   OWN products   withEntity(NULL, ...)              → no tenant context, so RLS decides
--   ADOPTED rows   withEntity(entity.identity_id,...) → the owner's own context, always admitted
--
-- The policy on catalogue_items (b49) admits a row with no tenant context ONLY when the owner's DEFAULT schema
-- is visibility='public':
--
--   USING (entity_id = current_entity  OR  EXISTS (SELECT 1 FROM entity_schemas es
--          WHERE es.entity_id = catalogue_items.entity_id
--            AND es.is_default AND es.status='active' AND es.visibility='public'))
--
-- So a shop whose entity_schemas.visibility is anything but 'public' serves its adopted catalogue to the world
-- and hides every product it owns — with no error, on a public page, exactly as reported.
--
-- ⚠️ AND THE OBVIOUS CAUSE IS ALREADY HANDLED, which is why this is a QUESTION and not a fix. PATCH /profile
-- mirrors catalogue_visibility onto the schema through schemaVisibilityFor(), deliberately and with a comment.
-- Two ways that mirror can still miss, and only the data can say which:
--   (a) the UPDATE is scoped `AND is_default = true` — an entity whose active schema is NOT flagged default
--       matches ZERO rows, and a zero-row UPDATE is not an error;
--   (b) an entity made public BEFORE that mirroring existed was never re-saved since.
--
-- ⭐ I could not settle it from a test account: the pooled entity is private and owns no products, so it cannot
-- show the asymmetry. This asks the live database instead. It writes NOTHING.
--
-- Run in the Supabase SQL editor (project bzacyrdrnzdbficjplcn). ONE result set, no psql meta-commands.
-- WITHOUT RLS context: run as the owner role, so these counts are the true ones and not a filtered view.

WITH shops AS (
  SELECT i.identity_id,
         i.bridge_id,
         COALESCE(i.display_name, i.bridge_id)            AS shop,
         i.catalogue_visibility                           AS shop_flag,
         (SELECT es.visibility FROM entity_schemas es
           WHERE es.entity_id = i.identity_id
             AND es.status = 'active' AND es.is_default = true
           LIMIT 1)                                       AS default_schema_visibility,
         (SELECT count(*) FROM entity_schemas es
           WHERE es.entity_id = i.identity_id AND es.status = 'active')            AS active_schemas,
         (SELECT count(*) FROM entity_schemas es
           WHERE es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true) AS default_schemas,
         (SELECT count(*) FROM catalogue_items ci
           WHERE ci.entity_id = i.identity_id AND ci.is_active = true)             AS own_items,
         (SELECT count(*) FROM catalogue_adoption ca
           WHERE ca.entity_id = i.identity_id AND ca.visible = true)               AS adopted_sources
    FROM identities i
   WHERE i.identity_type = 'entity'
     AND i.catalogue_visibility = 'public'
),
verdicts AS (
  SELECT s.*,
         CASE
           WHEN s.default_schemas = 0 AND s.active_schemas > 0
             THEN 'NO DEFAULT SCHEMA — the mirror UPDATE matches zero rows, cause (a)'
           WHEN s.default_schemas = 0
             THEN 'no active schema at all — nothing to publish'
           WHEN s.default_schema_visibility IS DISTINCT FROM 'public'
             THEN 'SCHEMA NOT PUBLIC — own items hidden from the storefront, cause (b)'
           ELSE 'ok — own items reach the storefront'
         END AS verdict
    FROM shops s
)
SELECT 1 AS ord, 'SUMMARY' AS section,
       count(*)::text                                                              AS shops,
       count(*) FILTER (WHERE verdict LIKE 'ok%')::text                            AS healthy,
       count(*) FILTER (WHERE verdict NOT LIKE 'ok%')::text                        AS affected,
       count(*) FILTER (WHERE verdict NOT LIKE 'ok%' AND own_items > 0)::text      AS affected_with_products,
       ''                                                                          AS shop,
       ''                                                                          AS detail
  FROM verdicts
UNION ALL
SELECT 2, 'AFFECTED',
       own_items::text,
       adopted_sources::text,
       COALESCE(default_schema_visibility, '(none)'),
       bridge_id,
       shop,
       verdict
  FROM verdicts
 WHERE verdict NOT LIKE 'ok%'
UNION ALL
SELECT 3, 'HEALTHY',
       own_items::text,
       adopted_sources::text,
       COALESCE(default_schema_visibility, '(none)'),
       bridge_id,
       shop,
       verdict
  FROM verdicts
 WHERE verdict LIKE 'ok%'
 ORDER BY 1, 6;

-- Columns on rows 2 and 3 read: own_items · adopted_sources · schema_visibility · bridge_id · shop · verdict.
--
-- ⭐ WHAT TO DO WITH THE ANSWER:
--   affected_with_products = 0  → the diagnosis is WRONG and the cause is elsewhere; say so and I will look again
--                                 rather than write a fix for a mechanism that is not firing.
--   affected_with_products > 0  → b194 backfills those schemas to 'public' (written only once this says so, and
--                                 scoped to the exact rows this listed — never a blanket UPDATE).
--
-- ⚠️ EITHER WAY, THE MIRROR'S `is_default = true` SCOPE WANTS WIDENING IN THE API so this cannot recur; that is a
-- code change, not a migration, and it waits on this answer too.
