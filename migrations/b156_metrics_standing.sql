-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b156 — STANDING AND RELATIONSHIPS. How many shops are alive, and how connected are they. COUNTS ONLY.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"each shops last status, when last sign-in? how many supplier link, how many walkin customer,
-- all the breakdown we need to have? so we can provide facility according to that?"*
-- then, immediately: *"what we need is the count, not the name or their relation etc."*
--
-- ── ⚠️⚠️ WHAT THIS FILE USED TO BE, AND WHY IT IS NOT THAT ─────────────────────────────────────────────────────
--
-- The first draft was an `ops` schema with a per-shop account sheet: display_name, last_active, seats, items,
-- suppliers, customers — one row per shop, behind a new `cb_ops` role. It needed a separate schema BECAUSE it
-- returned entity_id, which would have broken the one invariant that makes `metrics` safe to point a BI tool at.
--
-- ⭐⭐⭐ ATHI'S CORRECTION REMOVED THE NEED FOR ANY OF THAT. If the answer is a COUNT, it is an aggregate; if it is
-- an aggregate, it belongs in `metrics`; and then there is no second schema, no second role, no wall to maintain,
-- and no view anywhere in this database that returns a tenant list. The stricter requirement is also the simpler
-- build — which is usually the sign it was the right one.
--
-- ⚠️ SO DO NOT RE-ADD A PER-SHOP VIEW HERE. If one is ever genuinely needed, it needs its own schema and its own
--    role again, and that decision should be taken deliberately rather than by adding a column to this file.
--
-- ── ⭐ THE RULE, RESTATED ────────────────────────────────────────────────────────────────────────────────────────
-- "Nine shops have more than 100 suppliers" is a fact about the platform. "Shop X buys from Y" is that shop's
-- competitive information. HOW MANY is in. WHO, and WHICH, are out — at every grain, for any reason.
--
-- ⚠️ RUN b151 FIRST (creates the `metrics` schema and the `cb_metrics` role). Pairs with b155.
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── ⑪ ⭐⭐ STANDING — the answer to "each shop's last status", as a roll-call ────────────────────────────────────
-- ⚠️ identities.last_active_at and .created_at are `timestamp WITHOUT time zone` while now() is timestamptz.
--    Subtracting them directly coerces through the server timezone — a silent off-by-hours on a UTC database read
--    from IST. now()::timestamp keeps both sides naive.
--
-- ⭐ THE ORDER OF THE BUCKETS IS THE DESIGN. "Never signed in" and "signed in once and never came back" are
--    different problems needing different answers, and collapsing them into "inactive" destroys the only
--    distinction that changes what we would do about it.
CREATE OR REPLACE FUNCTION metrics.f_standing()
RETURNS TABLE (standing text, shops bigint, seats bigint, items bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH per_entity AS (
    SELECT CASE
             WHEN e.last_active_at IS NULL                                 THEN 'a · never signed in'
             WHEN NOT EXISTS (SELECT 1 FROM chit_header h WHERE h.sender_entity_id = e.identity_id)
              AND NOT EXISTS (SELECT 1 FROM catalogue_items c
                               WHERE c.entity_id = e.identity_id AND c.deleted_at IS NULL AND c.is_active)
                                                                           THEN 'b · registered, never used'
             WHEN e.last_active_at < now()::timestamp - interval '90 days' THEN 'c · lapsed (90d+)'
             WHEN e.last_active_at < now()::timestamp - interval '30 days' THEN 'd · drifting (30d+)'
             WHEN e.last_active_at < now()::timestamp - interval '7 days'  THEN 'e · quiet (7d+)'
             ELSE                                                               'f · active'
           END AS standing,
           /* ⚠️ erased people are not seats. Counting them over-states every shop against its plan cap — the
              exact number the design says we would one day bill from. */
           (SELECT count(*) FROM identities a
             WHERE a.parent_entity_id = e.identity_id AND a.identity_type = 'actor'
               AND coalesce(a.status, 'active') <> 'erased')                                AS seats,
           (SELECT count(*) FROM catalogue_items c
             WHERE c.entity_id = e.identity_id AND c.deleted_at IS NULL AND c.is_active)    AS items
      FROM identities e
     WHERE e.identity_type = 'entity' AND coalesce(e.status, 'active') <> 'erased'
  )
  SELECT standing, count(*) AS shops, sum(seats) AS seats, sum(items) AS items
    FROM per_entity GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.standing AS SELECT * FROM metrics.f_standing();

-- ── ⑫ SUPPLIER LINKS — how connected is a shop? ─────────────────────────────────────────────────────────────────
-- ⚠️ supplier_list keys on owner_entity_id, NOT entity_id.
CREATE OR REPLACE FUNCTION metrics.f_supplier_size()
RETURNS TABLE (bucket text, shops bigint, links bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH per_entity AS (
    SELECT e.identity_id AS entity_id,
           (SELECT count(*) FROM supplier_list s WHERE s.owner_entity_id = e.identity_id) AS n
      FROM identities e
     WHERE e.identity_type = 'entity' AND coalesce(e.status, 'active') <> 'erased'
  )
  SELECT CASE WHEN n = 0              THEN 'a · none'
              WHEN n BETWEEN 1 AND 5  THEN 'b · 1-5'
              WHEN n BETWEEN 6 AND 20 THEN 'c · 6-20'
              ELSE                         'd · 20+'
         END      AS bucket,
         count(*) AS shops,
         sum(n)   AS links
    FROM per_entity GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.supplier_size AS SELECT * FROM metrics.f_supplier_size();

-- ── ⑬ CUSTOMERS ON FILE — how many, and of what sort ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.f_customer_size()
RETURNS TABLE (bucket text, shops bigint, customers bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH per_entity AS (
    SELECT e.identity_id AS entity_id,
           (SELECT count(*) FROM customer_list k WHERE k.owner_entity_id = e.identity_id) AS n
      FROM identities e
     WHERE e.identity_type = 'entity' AND coalesce(e.status, 'active') <> 'erased'
  )
  SELECT CASE WHEN n = 0                 THEN 'a · none'
              WHEN n BETWEEN 1 AND 10    THEN 'b · 1-10'
              WHEN n BETWEEN 11 AND 100  THEN 'c · 11-100'
              ELSE                            'd · 100+'
         END      AS bucket,
         count(*) AS shops,
         sum(n)   AS customers
    FROM per_entity GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW metrics.customer_size AS SELECT * FROM metrics.f_customer_size();

-- ── ⑭ THE CUSTOMER MIX — "how many walk-in customers?" ──────────────────────────────────────────────────────────
-- ⚠️ The values of `customer_type` are NOT hard-coded. Nothing in routes/ or lib/ pins them to a closed list, so a
--    CASE naming 'walkin' would silently report zero if the value is spelled 'walk_in' or 'guest'. This GROUPs by
--    whatever is actually in the column and lets the data name itself — the same reason b151 selects `c.status`
--    rather than asserting the capture funnel's stages.
CREATE OR REPLACE FUNCTION metrics.f_customer_mix()
RETURNS TABLE (customer_type text, added_via text, customers bigint, shops bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(k.customer_type, '(unset)')::text AS customer_type,
         coalesce(k.added_via, '(unset)')::text     AS added_via,
         count(*)                                   AS customers,
         count(DISTINCT k.owner_entity_id)          AS shops
    FROM customer_list k
   GROUP BY 1, 2 ORDER BY 3 DESC
$$;
CREATE OR REPLACE VIEW metrics.customer_mix AS SELECT * FROM metrics.f_customer_mix();

-- ── grants: the views only, to cb_metrics only. Same rule as b151. ──────────────────────────────────────────────
GRANT SELECT ON metrics.standing, metrics.supplier_size,
                metrics.customer_size, metrics.customer_mix TO cb_metrics;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT * FROM metrics.standing;          -- ⭐ read this one first. It is the health of the customer base.
SELECT * FROM metrics.supplier_size;
SELECT * FROM metrics.customer_size;
SELECT * FROM metrics.customer_mix;
