-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b236 — network_search() HAS BEEN THROWING SINCE IT WAS WRITTEN. One unqualified column.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Found 2026-09-14 while testing whether the platform root could be found in a search:
--
--     SELECT * FROM network_search('CBG4U2T9DE','cbincroot',10);
--     ERROR: 42702 column reference "bridge_id" is ambiguous
--     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- ── ⭐ THE CAUSE, IN ONE LINE ───────────────────────────────────────────────────────────────────────────────────
--
-- `bridge_id` is an OUT parameter of the RETURNS TABLE, so inside the body it is also a PL/pgSQL variable. The
-- root lookup names it unqualified:
--
--     SELECT subpath(path, 0, 1) INTO v_root FROM cb_entity WHERE bridge_id = p_caller_bridge LIMIT 1;
--                                                                 ^^^^^^^^^ variable, or column?
--
-- Postgres will not guess, and throws before a single row is considered. ⚠️ EVERY OTHER REFERENCE IN THE BODY IS
-- QUALIFIED — `i.bridge_id`, `e.path`, `ci.item_id`. This one line was missed, and it is the first statement that
-- runs, so the function has NEVER returned a row.
--
-- ── ⚠️⚠️ AND NOBODY NOTICED, BECAUSE THE FALLBACK WORKS ────────────────────────────────────────────────────────
--
-- routes/network-design.js:839 catches it:
--
--     console.error('network_search unavailable — falling back to per-store fan-out:', e.message);
--
-- So search has silently been running the per-store fan-out — THE EXACT THING THIS FUNCTION EXISTS TO AVOID. Its
-- own header says so: *"One query across a network's catalogues… Athi's O(1) rule: a per-ancestor walk would be
-- a query per level."* A correct fallback made a broken fast path invisible for as long as it has existed.
--
-- ⭐ THE FALLBACK IS NOT THE BUG. It did its job. The lesson is narrower: a fallback that logs to console.error
-- and returns the right answer is indistinguishable, from outside, from the thing working. If the fast path
-- matters, something has to notice when it is not being used.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ It does NOT add the entity_visibility filter from b234. VISIBILITY-MATRIX.md says fix this first and enforce
--    second, for a reason: a filter added to a function nobody knew was broken is a filter that does nothing
--    while everyone believes it works. Make it run, watch it run, then make it refuse things.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION network_search(p_caller_bridge text, p_q text, p_limit int DEFAULT 200)
RETURNS TABLE (
  entity_id uuid, bridge_id text, store_name text, city text, currency_code text,
  lat numeric, lng numeric, service_km int,
  dispatch_days smallint, ship_within_days smallint, ship_beyond_days smallint,
  sort_order int, item_id uuid, item_data jsonb,
  -- Returned so the CALLER can apply the plan cap. Deliberate, not leakage: catalogue_visibility is the store's
  -- CHOICE; the cap is applied against it in the route.
  catalogue_visibility text, plan text, params_override jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_root ltree;
  v_like text := '%' || lower(coalesce(p_q, '')) || '%';
BEGIN
  IF coalesce(p_q, '') = '' THEN RETURN; END IF;

  -- (1) The caller's root, resolved HERE. A caller cannot ask about a network it is not in.
  --     ⚠️ cb_entity.bridge_id IS QUALIFIED. Unqualified it collides with the OUT parameter of the same name and
  --     the whole function throws 42702 before doing anything. That was the b236 bug.
  SELECT subpath(c.path, 0, 1) INTO v_root
    FROM cb_entity c
   WHERE c.bridge_id = p_caller_bridge
   LIMIT 1;

  IF v_root IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT i.identity_id, i.bridge_id::text, i.display_name::text, i.city::text, i.currency_code::text,
         i.lat, i.lng, i.service_km,
         i.dispatch_days, i.ship_within_days, i.ship_beyond_days,
         i.sort_order, ci.item_id, ci.item_data,
         i.catalogue_visibility::text, i.plan::text, i.params_override
    FROM cb_entity e
    JOIN identities i ON i.bridge_id = e.bridge_id
                     AND i.identity_type = 'entity' AND i.status = 'active'
    JOIN catalogue_items ci ON ci.entity_id = i.identity_id AND ci.is_active = true
   WHERE e.path <@ v_root                                        -- (2) this network only
     AND i.catalogue_visibility IN ('public', 'network')         -- (3) private is absent, not empty
     AND (lower(ci.item_data->>'name') LIKE v_like
       OR lower(ci.item_data->>'code') LIKE v_like
       OR lower(ci.item_data->>'sku')  LIKE v_like)
   ORDER BY i.sort_order NULLS LAST, i.display_name
   LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION network_search(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION network_search(text, text, int) TO cb_app;

COMMENT ON FUNCTION network_search(text, text, int) IS
  'One query across a network''s catalogues. SECURITY DEFINER: bypasses per-tenant RLS and re-imposes the scoping '
  'itself — caller''s own root, that root only, and public/network stores only. Reads live rows, so nothing goes '
  'stale. b236 qualified cb_entity.bridge_id, which had been throwing 42702 since b122.';

-- ── PROVE IT RUNS ──────────────────────────────────────────────────────────────────────────────────────────────
-- alpha-timers is the one entity with a real tree (6 branches), so it is the only caller that can return rows.
SELECT count(*) AS rows_for_alpha_timers FROM network_search('CBG4U2T9DE', 'a', 50);

-- ⭐ EXPECTED: a number, not an error. Zero is a fine answer — it means no item on that tree matched 'a'. The
--    point of this line is that it COMPLETES.

-- ⚠️ And a caller not on any tree must return nothing rather than throw:
SELECT count(*) AS rows_for_a_treeless_caller FROM network_search('CBMXEB3LV4', 'a', 50);
-- ⭐ EXPECTED: 0. mybanana has no cb_entity row, so v_root is NULL and the function returns early.
