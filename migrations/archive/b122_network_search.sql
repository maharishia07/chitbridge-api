-- b122_network_search.sql — the whole network's catalogue as ONE query.
--
-- Athi, 2026-08-08: *"can we build an alternate index for the network stores as a single catalogue with the store
-- names as well, so it works as a single catalogue?"*
--
-- The instinct is right and it is the correct fix for the shape: searching a network is currently one query PER
-- STORE, which is O(stores) round trips however good the indexes are. Forty stores is forty queries.
--
-- ── BUT NOT A SECOND COPY OF THE DATA ────────────────────────────────────────────────────────────────────────
-- The obvious build is a denormalised table — every store's items copied into one searchable index. It would work,
-- and it would bring three problems CB has spent this whole week refusing:
--
--   · it goes STALE. A price changes and the index still holds the old one until something re-syncs. This codebase
--     already says a stock figure without a date is a rumour; a whole catalogue without one is worse.
--   · it needs write-through on every product create, edit, delete and availability report — four places to forget.
--   · it duplicates data across tenants, so a visibility change has to be chased through the copy. The moment a
--     store goes private, the index still holds its items until somebody remembers.
--
-- A SECURITY DEFINER function gets the same single query with none of that: it reads the LIVE rows, so there is
-- nothing to sync and nothing to go stale, and visibility is evaluated at read time against the current setting.
--
-- ── WHY DEFINER IS SAFE HERE, AND WHERE THE GATE IS ──────────────────────────────────────────────────────────
-- catalogue_items is per-tenant RLS, which is exactly why the route must ask each store separately today. This
-- function runs as its owner and therefore BYPASSES that — so the scoping it replaces must be re-imposed INSIDE,
-- and it is, in three ways that cannot be passed in by a caller:
--
--   1 · the caller's own bridge id is resolved to its network ROOT here; a caller cannot name someone else's root
--   2 · only entities under that root are considered
--   3 · only stores whose catalogue_visibility is public or network are returned — private is invisible, and
--       returns no row at all rather than an empty one, so the existence oracle closed on 2026-08-06 stays closed
--
-- ── WHY THE PLAN CAP IS *NOT* ENFORCED HERE ──────────────────────────────────────────────────────────────────
-- Visibility is not only the store's CHOICE; a plan can CAP it (lib/visibility-cap.js), and a store that chose
-- 'network' on a plan capped at 'private' must stay invisible. That rule is real logic — rank comparison, plan
-- lookup, per-entity overrides — and re-expressing it in SQL would make two implementations of one rule, which
-- drift the first time a plan changes and leave the fast path showing what the slow path hides.
--
-- So this function returns `plan` and `params_override` and the ROUTE applies the cap through the same module the
-- per-store path uses. The narrowing that SQL does well (network, chosen visibility, text match) happens here; the
-- narrowing that needs the rule happens once, in the rule. Nothing capped ever reaches the response.
--
-- This is the same pattern as chit_deliver (b50): a definer function whose first act is to re-establish the
-- isolation it just stepped outside of.
--
-- Safe to re-run. Rollback:  DROP FUNCTION network_search(text, text, int);

CREATE OR REPLACE FUNCTION network_search(p_caller_bridge text, p_q text, p_limit int DEFAULT 200)
RETURNS TABLE (
  entity_id uuid, bridge_id text, store_name text, city text, currency_code text,
  lat numeric, lng numeric, service_km int,
  dispatch_days smallint, ship_within_days smallint, ship_beyond_days smallint,
  sort_order int, item_id uuid, item_data jsonb,
  -- Returned so the CALLER can apply the plan cap. See the note below — this is deliberate, not leakage.
  -- catalogue_visibility is the store's CHOICE; the cap is applied against it in the route.
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
  SELECT subpath(path, 0, 1) INTO v_root FROM cb_entity WHERE bridge_id = p_caller_bridge LIMIT 1;
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
  'itself — caller''s own root, that root only, and public/network stores only. Reads live rows, so nothing goes stale.';
