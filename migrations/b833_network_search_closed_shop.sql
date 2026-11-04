-- b833_network_search_closed_shop.sql — NET-53 (4 Nov 2026): a CLOSED shop is no longer searched inside its network.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (CREATE OR REPLACE, same signature; COMMENT is idempotent).
--    Touches no rows. Needs nothing before it (identities.business_status is in the baseline).
--
-- WHY. public.network_search() is SECURITY DEFINER and re-imposes its own scoping: the caller's root, that root only, active entity identities, public/network
--   stores only. It never looked at business_status, so a shop that had closed was still searched inside its network and its stock, price and location reached
--   the rest of the network. Athi, 2026-08-20: "network + closed, not visible to network also" (lib/catalogue-view.js reads a closed shop as 'private').
--   NET-53 in docs/04-network/NETWORK-BACKLOG.md.
-- CHANGE. One added filter, AND coalesce(i.business_status, 'open') <> 'closed'. Signature, return columns, LANGUAGE, SECURITY DEFINER and search_path are the
--   baseline's (000_baseline_2026-10-21.sql), unchanged. Values are the identities_business_status_chk set: 'open' | 'closed' | 'away'. 'away' stays searchable.
-- FOR CALLERS. A closed member no longer appears in network search results; it reappears when the shop reopens. Nothing is deleted.
-- NOT HERE. routes/network-design.js (visibleStores and the availability fan-out) has the same gap in JS; separate change.
-- ROLLBACK at the end of this file (the exact previous body).

BEGIN;

-- DROP first (tests/migration-rerunnable.test.cjs: a RETURNS TABLE function is dropped, then its GRANT comes back). Same signature, so no caller is affected.
DROP FUNCTION IF EXISTS public.network_search(text, text, integer);

CREATE OR REPLACE FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer DEFAULT 200) RETURNS TABLE(entity_id uuid, bridge_id text, store_name text, city text, currency_code text, lat numeric, lng numeric, service_km integer, dispatch_days smallint, ship_within_days smallint, ship_beyond_days smallint, sort_order integer, item_id uuid, item_data jsonb, catalogue_visibility text, plan text, params_override jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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
     -- (4) NET-53 (Athi, 2026-08-20: "network + closed, not visible to network also"): a CLOSED shop is absent too, as it is
     --     'private' in lib/catalogue-view.js. identities.business_status is 'open' | 'closed' | 'away', NOT NULL default 'open';
     --     coalesce keeps a row with no value open. 'away' stays searchable.
     AND coalesce(i.business_status, 'open') <> 'closed'
     AND (lower(ci.item_data->>'name') LIKE v_like
       OR lower(ci.item_data->>'code') LIKE v_like
       OR lower(ci.item_data->>'sku')  LIKE v_like)
   ORDER BY i.sort_order NULLS LAST, i.display_name
   LIMIT p_limit;
END $$;

COMMENT ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) IS 'One query across a network''s catalogues. SECURITY DEFINER: bypasses per-tenant RLS and re-imposes the scoping itself — caller''s own root, that root only, and public/network stores only. Reads live rows, so nothing goes stale. b236 qualified cb_entity.bridge_id, which had been throwing 42702 since b122 NET-53 (b833): a closed shop (identities.business_status = ''closed'') is absent too; ''away'' is not.';

-- the baseline's grants (lines 10514-10515): the DROP took them with it
REVOKE ALL ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) TO cb_app;

COMMIT;

-- ROLLBACK (run as postgres to restore the previous body and comment; the baseline's text, verbatim):
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.network_search(text, text, integer);
-- CREATE OR REPLACE FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer DEFAULT 200) RETURNS TABLE(entity_id uuid, bridge_id text, store_name text, city text, currency_code text, lat numeric, lng numeric, service_km integer, dispatch_days smallint, ship_within_days smallint, ship_beyond_days smallint, sort_order integer, item_id uuid, item_data jsonb, catalogue_visibility text, plan text, params_override jsonb)
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_root ltree;
--   v_like text := '%' || lower(coalesce(p_q, '')) || '%';
-- BEGIN
--   IF coalesce(p_q, '') = '' THEN RETURN; END IF;
-- 
--   -- (1) The caller's root, resolved HERE. A caller cannot ask about a network it is not in.
--   --     ⚠️ cb_entity.bridge_id IS QUALIFIED. Unqualified it collides with the OUT parameter of the same name and
--   --     the whole function throws 42702 before doing anything. That was the b236 bug.
--   SELECT subpath(c.path, 0, 1) INTO v_root
--     FROM cb_entity c
--    WHERE c.bridge_id = p_caller_bridge
--    LIMIT 1;
-- 
--   IF v_root IS NULL THEN RETURN; END IF;
-- 
--   RETURN QUERY
--   SELECT i.identity_id, i.bridge_id::text, i.display_name::text, i.city::text, i.currency_code::text,
--          i.lat, i.lng, i.service_km,
--          i.dispatch_days, i.ship_within_days, i.ship_beyond_days,
--          i.sort_order, ci.item_id, ci.item_data,
--          i.catalogue_visibility::text, i.plan::text, i.params_override
--     FROM cb_entity e
--     JOIN identities i ON i.bridge_id = e.bridge_id
--                      AND i.identity_type = 'entity' AND i.status = 'active'
--     JOIN catalogue_items ci ON ci.entity_id = i.identity_id AND ci.is_active = true
--    WHERE e.path <@ v_root                                        -- (2) this network only
--      AND i.catalogue_visibility IN ('public', 'network')         -- (3) private is absent, not empty
--      AND (lower(ci.item_data->>'name') LIKE v_like
--        OR lower(ci.item_data->>'code') LIKE v_like
--        OR lower(ci.item_data->>'sku')  LIKE v_like)
--    ORDER BY i.sort_order NULLS LAST, i.display_name
--    LIMIT p_limit;
-- END $$;
--
-- COMMENT ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) IS 'One query across a network''s catalogues. SECURITY DEFINER: bypasses per-tenant RLS and re-imposes the scoping itself — caller''s own root, that root only, and public/network stores only. Reads live rows, so nothing goes stale. b236 qualified cb_entity.bridge_id, which had been throwing 42702 since b122.';
-- REVOKE ALL ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.network_search(p_caller_bridge text, p_q text, p_limit integer) TO cb_app;
-- COMMIT;
