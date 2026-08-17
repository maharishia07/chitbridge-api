-- b163 · catalogue_item_owner(item_id) — resolve which entity owns a product, for the ENQUIRY gate.
--
-- ⚠️⚠️ WHY THIS EXISTS: THE PRODUCT-ENQUIRY ENDPOINT CANNOT SUCCEED WITHOUT IT, FOR ANYONE.
--
-- `enquiryLimitCheck()` opens with:
--     SELECT item_id, entity_id FROM catalogue_items WHERE item_id = $1 AND is_active = true
-- through the module-level, CONTEXT-FREE `query()`. `catalogue_items` is FORCE ROW LEVEL SECURITY (b49), so with
-- no `app.current_entity` set the policy returns ZERO ROWS — to every caller, including the product's own owner.
-- The gate therefore always answers "no such product" and the POST always 404s.
--
-- Measured 2026-08-18 against production, immediately after b162 was applied:
--     publicView as buyer                 404  Shop not found
--     ENQUIRY as buyer                    404  No such product
--     ENQUIRY as the item's OWN OWNER     404  No such product      <-- the tell
-- The owner case is what proves it is not a visibility decision: `enquiryLimitCheck` short-circuits to ok for
-- your own product, so a 404 there can only mean the FIRST query found nothing.
--
-- ⚠️ THIS IS THE FAILURE MODE db/index.js ALREADY WARNS ABOUT, in its own words: "any tenant-table access through
-- it means a route FORGOT withEntity() — under FORCE RLS that query fails closed and the feature quietly returns
-- empty." The guard defaults to `warn`, so it logged and nobody was watching. A feature shipped with no test is
-- how a warning becomes a silent outage.
--
-- ⚠️ WHY NOT withEntity(): the caller is a BUYER asking about SOMEONE ELSE'S product. Under the viewer's context
-- RLS correctly hides the row, and the owner is precisely what we do not yet know — that is the lookup. This is
-- the same narrow, deliberate hole `channel_owner()` occupies for the inbound webhook, and it is modelled on it
-- exactly: SECURITY DEFINER, STABLE, pinned search_path, EXECUTE granted to cb_app alone.
--
-- ⚠️ WHAT IT DELIBERATELY DOES NOT DO: it returns ONLY the owning entity_id, never item_data. It cannot be used
-- to read a product; the visibility check that follows still decides whether the asker may ask, unchanged. An
-- inactive item resolves to NULL, so a retired product is indistinguishable from a missing one — the same
-- existence-oracle rule the route already follows by answering 404 rather than 403.
--
-- WITH RLS, UNCHANGED. No policy is added, altered or dropped. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION catalogue_item_owner(p_item_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT entity_id FROM catalogue_items
   WHERE item_id = p_item_id AND is_active = true
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION catalogue_item_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalogue_item_owner(uuid) TO cb_app;

COMMIT;

-- VERIFY (read-only, run as cb_app):
--   SELECT catalogue_item_owner('<some active item_id>');   -- expect the owning entity_id
--   SELECT catalogue_item_owner(gen_random_uuid());          -- expect NULL
