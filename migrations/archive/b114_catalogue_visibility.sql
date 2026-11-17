-- b114: CATALOGUE VISIBILITY — publishing becomes an explicit act.
--
-- Athi's access model (2026-07-29): "the catalogue for a public entity is exposed to the outside world — you walk into
-- any store as a customer, and a customer can be another store. If the supplier entity is restricted, then no. The
-- entity is protected and the catalogue is private, so it should not be accessible."
--
-- THE DEFECT THIS FIXES: availability was `hasSchema OR finishes.length`, so ADOPTING a catalogue silently PUBLISHED
-- your storefront. Proven live — the `Document Services` store returns schema:null and items:0 yet serves 2 templates
-- to the whole internet, purely because it adopted a blueprint. There was no opt-in and no way to say no.
--
-- ⚠️ NOTE THE BACKFILL. A bare `DEFAULT 'private'` would take every existing storefront dark. So:
--     • NEW entities default to 'private'  → you become public ON PURPOSE
--     • EXISTING entities are backfilled to whatever they are ALREADY effectively serving today
--   Net effect on live behaviour: ZERO. The default is inverted only for what comes next.
--
-- Rollback:  ALTER TABLE identities DROP COLUMN catalogue_visibility;
-- The API is self-healing: it treats a missing column as "behave exactly as before b114", so this migration can be
-- applied before or after the code deploy, in either order.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS catalogue_visibility text NOT NULL DEFAULT 'private';

-- Backfill: anything that is publicly reachable RIGHT NOW stays publicly reachable.
--   (a) has a public default schema  → the products storefront was already public
--   (b) has a visible adoption       → the finishes storefront was already public (the accidental-publish path)
UPDATE identities i SET catalogue_visibility = 'public'
WHERE i.identity_type = 'entity'
  AND i.catalogue_visibility = 'private'
  AND (
    EXISTS (SELECT 1 FROM entity_schemas es
             WHERE es.entity_id = i.identity_id
               AND es.status = 'active' AND es.is_default AND es.visibility = 'public')
    OR EXISTS (SELECT 1 FROM catalogue_adoption ca
                WHERE ca.entity_id = i.identity_id AND ca.visible = true)
  );

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_catalogue_visibility_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_catalogue_visibility_chk
  CHECK (catalogue_visibility IN ('public', 'private'));

-- How many were publicly reachable, and how many are now closed by default:
--   SELECT catalogue_visibility, count(*) FROM identities WHERE identity_type='entity' GROUP BY 1;
