-- b194 DRY RUN · READ ONLY. Align entity_schemas.visibility with the publish act the owner already made.
--
-- ── WHAT b193 FOUND (run 2026-09-01, live) ───────────────────────────────────────────────────────────────────
--   182 public shops · 53 healthy · 129 affected · 11 of those own products
--   Every affected row is cause (b). ZERO rows came back "NO DEFAULT SCHEMA", so the mirror's `is_default = true`
--   scope is NOT the problem and does not need widening — one guess ruled out by the data rather than by me.
--
-- ⭐ AND ONE OF THE 129 IS THE REPORT ITSELF: `alpha timers` (CBG4U2T9DE) — 16 own products, 1 adopted source,
--   schema private. Adopted catalogue served to the world, sixteen own products dark. Exactly what Athi saw.
--
-- ── WHY THE DATA IS WRONG AND THE CODE IS NOT ────────────────────────────────────────────────────────────────
-- PATCH /profile has mirrored catalogue_visibility onto the schema since 2026-08-18. Everything mis-aligned was
-- published BEFORE that, or through `routes/network-design.js`, which wrote the flag and never the schema — fixed
-- in the same commit as this file. The affected list is full of Cascade / Depot / Outlet / North, which are the
-- names that route mints. So this is a one-time catch-up, not a recurring repair.
--
-- ── ⚠️ WHAT ACTUALLY BECOMES VISIBLE, STATED BEFORE IT HAPPENS ───────────────────────────────────────────────
-- This RELAXES visibility on live rows, so it says exactly what it exposes rather than reporting a row count.
--   · 98 of the affected shops own ZERO products — for them this exposes NOTHING today. It only stops the same
--     bug firing silently the day somebody adds one.
--   · 11 shops gain visible products. Section 2 names every one of them with its count. Read that list.
--
-- ⚠️ EVERY ONE of these owners has already set `catalogue_visibility = 'public'` — the explicit publish act b114
-- introduced, and the only visibility control the app has ever shown them. This makes the system do what that
-- setting has been claiming. It does not publish a single shop that is marked private.
--
-- ⚠️ IT DOES NOT TOUCH the ~20 shops with no active schema. There is nothing to update, and ensureDefaultSchema
-- reads catalogue_visibility when it creates one — that path already works.
--
-- Run in the Supabase SQL editor. WRITES NOTHING. Apply is b194b, a separate file, deliberately.

WITH target AS (
  SELECT es.schema_id, i.bridge_id, COALESCE(i.display_name, i.bridge_id) AS shop,
         es.visibility AS schema_now, i.catalogue_visibility AS shop_flag,
         (SELECT count(*) FROM catalogue_items ci
           WHERE ci.entity_id = i.identity_id AND ci.is_active = true) AS own_items
    FROM identities i
    JOIN entity_schemas es
      ON es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true
   WHERE i.identity_type = 'entity'
     AND i.catalogue_visibility = 'public'
     AND es.visibility IS DISTINCT FROM 'public'
)
SELECT 1 AS ord, 'WOULD CHANGE' AS section,
       count(*)::text                                        AS schemas,
       count(*) FILTER (WHERE own_items > 0)::text           AS shops_gaining_visible_products,
       COALESCE(sum(own_items), 0)::text                     AS products_becoming_visible,
       ''                                                    AS bridge_id,
       ''                                                    AS shop
  FROM target
UNION ALL
-- ⭐ EVERY SHOP THAT GAINS VISIBLE PRODUCTS, NAMED. A count is not consent; a list is reviewable.
SELECT 2, 'GAINS PRODUCTS', own_items::text, '', schema_now, bridge_id, shop
  FROM target WHERE own_items > 0
UNION ALL
SELECT 3, 'NO PRODUCTS (no exposure change today)',
       count(*)::text, '', '', '', ''
  FROM target WHERE own_items = 0
 ORDER BY 1, 3 DESC, 6;

-- Row 1  · schemas · shops_gaining_visible_products · products_becoming_visible
-- Rows 2 · own_items · (blank) · schema_now · bridge_id · shop
--
-- ⭐ CHECK ROW 1 AGAINST b193 BEFORE APPLYING: schemas should be ~109 (129 affected minus those with no active
-- schema), shops_gaining ~11, and `alpha timers` must appear in section 2 with 16. If those numbers have moved,
-- the data changed since the survey — STOP, re-run b193, and look again rather than applying to a shape nobody
-- approved.
