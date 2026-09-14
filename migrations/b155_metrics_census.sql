-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b155 — THE CENSUS. The three questions b151 could not answer, plus the seat watermark.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"right now i am not sure how many entity registered and how many catalogue entries they have,
-- how many employees they have and so on, can we bring that visibility to us first?"*
-- and: *"if shop has 10 employee today and tomorrow 15, and if our plan runs based on max cap, we should know?"*
--
-- ⚠️ RUN b151 AND b154 FIRST. This file assumes `metrics` exists and `cb_metrics` has been created. It adds four
--    views to that schema and nothing else — no policy is dropped, no grant to cb_app widens, `public` stays shut.
--
-- ── ⭐ BUCKETS, NOT LISTS ────────────────────────────────────────────────────────────────────────────────────────
-- "Shop X has 412 products" is a fact about their trade. "Nine shops have more than 100 products" is a fact about
-- the platform. Only the second belongs to us. Every view below returns a DISTRIBUTION — a bucket and a count of
-- shops in it — and never an entity_id. That is not caution for its own sake: a view that returns entity_id is one
-- careless dashboard share away from being a tenant list, and it would sit in a schema built precisely so that
-- could not happen.
--
-- ⚠️ THE ARITHMETIC TRAP, FOR THE FIFTH TIME. chit_header holds ONE ROW PER PARTICIPANT COPY. count(*) counts
--    copies, not chits, and a self-chit has two. Every count here is count(DISTINCT chit_id). Do not "simplify".
--
-- ⚠️ REQUIRES b157. Every predicate below is entity_kind, not identity_type: before b157 there was no
--    way to say "a business that is our customer" and these views would have counted all 2,502 identity rows
--    where the answer is 90. See b157_entity_kind.sql.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── ⑦ CATALOGUE SIZE — how big are shops' catalogues? ───────────────────────────────────────────────────────────
-- ⚠️ Counts LIVE items only. is_active — a shop that listed 400 products and retired 390
--    has a catalogue of ten, and billing or roadmap decisions taken on 400 would be wrong.
CREATE OR REPLACE FUNCTION metrics.f_catalogue_size()
RETURNS TABLE (bucket text, shops bigint, items bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH per_entity AS (
    SELECT e.identity_id AS entity_id,
           count(c.item_id) FILTER (WHERE c.is_active) AS n
      FROM identities e
      LEFT JOIN catalogue_items c ON c.entity_id = e.identity_id
     WHERE e.entity_kind = 'customer' AND coalesce(e.status, 'active') <> 'erased'
     GROUP BY 1
  )
  SELECT CASE WHEN n = 0            THEN 'a · none'
              WHEN n BETWEEN 1 AND 10   THEN 'b · 1-10'
              WHEN n BETWEEN 11 AND 100 THEN 'c · 11-100'
              ELSE                           'd · 100+'
         END        AS bucket,
         count(*)   AS shops,
         sum(n)     AS items
    FROM per_entity
   GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.catalogue_size AS SELECT * FROM metrics.f_catalogue_size();

-- ── ⑧ STAFF SIZE — how many people does a shop have on it? ──────────────────────────────────────────────────────
-- An 'actor' whose parent_entity_id is the shop. This is the number `plans.js` calls `actors` and caps per tier.
CREATE OR REPLACE FUNCTION metrics.f_staff_size()
RETURNS TABLE (bucket text, shops bigint, people bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH per_entity AS (
    SELECT e.identity_id AS entity_id,
           count(a.identity_id) FILTER (WHERE a.entity_kind = 'actor') AS n
      FROM identities e
      LEFT JOIN identities a ON a.parent_entity_id = e.identity_id
     WHERE e.entity_kind = 'customer' AND coalesce(e.status, 'active') <> 'erased'
     GROUP BY 1
  )
  SELECT CASE WHEN n = 0          THEN 'a · none'
              WHEN n = 1          THEN 'b · 1'
              WHEN n BETWEEN 2 AND 5   THEN 'c · 2-5'
              WHEN n BETWEEN 6 AND 20  THEN 'd · 6-20'
              ELSE                          'e · 20+'
         END        AS bucket,
         count(*)   AS shops,
         sum(n)     AS people
    FROM per_entity
   GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.staff_size AS SELECT * FROM metrics.f_staff_size();

-- ── ⑨ ⭐⭐ ADOPTION — registered, and then what? ─────────────────────────────────────────────────────────────────
-- THE MOST IMPORTANT VIEW IN THE SCHEMA. Registered-but-never-used is the number that says whether the product
-- works, and it is the one we have never been able to even guess at. A registration count on its own flatters:
-- every abandoned signup counts once and looks like growth.
CREATE OR REPLACE FUNCTION metrics.f_adoption()
RETURNS TABLE (milestone text, shops bigint, pct numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ent AS (SELECT identity_id FROM identities WHERE entity_kind = 'customer' AND coalesce(status, 'active') <> 'erased'),
  total AS (SELECT count(*)::numeric AS n FROM ent),
  hit AS (
    SELECT 'a · registered'      AS milestone, (SELECT count(*) FROM ent) AS shops
    UNION ALL SELECT 'b · added a person',
      (SELECT count(DISTINCT a.parent_entity_id) FROM identities a
        WHERE a.entity_kind = 'actor' AND a.parent_entity_id IS NOT NULL)
    UNION ALL SELECT 'c · listed a product',
      (SELECT count(DISTINCT c.entity_id) FROM catalogue_items c
        WHERE c.is_active)
    UNION ALL SELECT 'd · sent a chit',
      (SELECT count(DISTINCT h.sender_entity_id) FROM chit_header h)
  )
  SELECT milestone, shops,
         CASE WHEN (SELECT n FROM total) = 0 THEN 0
              ELSE round(100 * shops / (SELECT n FROM total), 1) END AS pct
    FROM hit ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.adoption AS SELECT * FROM metrics.f_adoption();

-- ── ⑩ SEAT WATERMARK — the peak, not the closing balance ────────────────────────────────────────────────────────
-- ⭐⭐ A shop goes 10 → 15 → 9 inside one month. Did they use 15 seats? YES. A month-end snapshot says 9 and
--    under-bills by six every time somebody leaves before payday. Banks charge peak overdraft for this reason.
--
-- ⚠️⚠️ THIS VIEW IS AN APPROXIMATION AND MUST NOT BE BILLED FROM YET. It reconstructs the peak from `created_at`,
--    so it counts people ADDED and cannot see people REMOVED — it is a high-water mark of arrivals, not of
--    concurrent seats. A true watermark needs a periodic sample written down, because a peak cannot be
--    reconstructed once the count comes down. That sampler is NOT built. Use this to see the SHAPE of growth and
--    to decide whether metering is worth building; do not put it on an invoice.
CREATE OR REPLACE FUNCTION metrics.f_seat_watermark()
RETURNS TABLE (month date, bucket text, shops bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH adds AS (
    SELECT a.parent_entity_id AS entity_id,
           date_trunc('month', a.created_at)::date AS month,
           count(*) AS added
      FROM identities a
     WHERE a.entity_kind = 'actor' AND a.parent_entity_id IS NOT NULL AND coalesce(a.status, 'active') <> 'erased'
     GROUP BY 1, 2
  ),
  cume AS (
    SELECT entity_id, month,
           sum(added) OVER (PARTITION BY entity_id ORDER BY month) AS seats
      FROM adds
  )
  SELECT month,
         CASE WHEN seats <= 3   THEN 'a · within starter (3)'
              WHEN seats <= 15  THEN 'b · within team (15)'
              WHEN seats <= 100 THEN 'c · within business (100)'
              ELSE                   'd · above business'
         END      AS bucket,
         count(*) AS shops
    FROM cume
   GROUP BY 1, 2 ORDER BY 1, 2
$$;
CREATE OR REPLACE VIEW metrics.seat_watermark AS SELECT * FROM metrics.f_seat_watermark();

-- ── grants: the views only, to cb_metrics only. Same rule as b151. ──────────────────────────────────────────────
GRANT SELECT ON metrics.catalogue_size, metrics.staff_size,
                metrics.adoption,       metrics.seat_watermark TO cb_metrics;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ THE CENSUS — this is the bit that prints the numbers. Everything above just makes it possible.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT '① shops registered'  AS q, count(*)::text AS a FROM identities WHERE entity_kind = 'customer' AND coalesce(status, 'active') <> 'erased'
UNION ALL
SELECT '② people on shops',       count(*)::text FROM identities WHERE entity_kind = 'actor' AND coalesce(status, 'active') <> 'erased'
UNION ALL
SELECT '③ live catalogue items',  count(*)::text FROM catalogue_items WHERE is_active
UNION ALL
SELECT '④ chits ever sent',       count(DISTINCT chit_id)::text FROM chit_header
UNION ALL
SELECT '⑤ first registration',    coalesce(min(created_at)::date::text, '—') FROM identities WHERE entity_kind = 'customer' AND coalesce(status, 'active') <> 'erased'
UNION ALL
SELECT '⑥ newest registration',   coalesce(max(created_at)::date::text, '—') FROM identities WHERE entity_kind = 'customer' AND coalesce(status, 'active') <> 'erased';

SELECT * FROM metrics.adoption;         -- ⭐ registered → person → product → chit. The drop-off is the story.
SELECT * FROM metrics.catalogue_size;
SELECT * FROM metrics.staff_size;
SELECT * FROM metrics.seat_watermark ORDER BY month DESC LIMIT 12;
