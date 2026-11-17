-- b75: reference-model catalogue. Design/colour/schema minted ONCE in a SHARED table (catalogue_source,
-- WITHOUT RLS, cb_app SELECT-only). A retailer (Beta) inherits by REFERENCE, storing only a pointer + its
-- COMMERCIALS overlay in catalogue_adoption (WITH RLS, per-entity). No image/colour/design is copied
-- (cb-core-principle share-read reference; version-frozen). Idempotent. Rollback at bottom.

-- SHARED (minted once, WITHOUT RLS, read-only reference for the app) --------------------------------
CREATE TABLE IF NOT EXISTS catalogue_source (
  source_key         text PRIMARY KEY,
  version            text NOT NULL DEFAULT 'v1',
  for_vertical       text,
  title              text,
  collection         text,
  schema             jsonb NOT NULL DEFAULT '{}'::jsonb,
  items              jsonb NOT NULL DEFAULT '[]'::jsonb,
  commercials_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  active             boolean NOT NULL DEFAULT true,
  minted_at          timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON catalogue_source TO cb_app';
END IF; END $$;

-- PER-ENTITY (WITH RLS): reference + commercials overlay only ---------------------------------------
CREATE TABLE IF NOT EXISTS catalogue_adoption (
  entity_id   uuid NOT NULL,
  source_key  text NOT NULL,
  version     text NOT NULL DEFAULT 'v1',
  commercials jsonb NOT NULL DEFAULT '{}'::jsonb,
  visible     boolean NOT NULL DEFAULT true,
  adopted_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, source_key)
);
ALTER TABLE catalogue_adoption ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_adoption FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON catalogue_adoption;
CREATE POLICY rls_entity ON catalogue_adoption
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON catalogue_adoption TO cb_app';
END IF; END $$;

-- SEED the shared source ONCE (schema + design + colour) -------------------------------------------
INSERT INTO catalogue_source (source_key, version, for_vertical, title, collection, schema, items, commercials_fields)
VALUES ('beta-royale-play@v1','v1','paint-retail','Beta Traders — Royale Play designer wall finishes','Taana Baana',
  '{"name":"Designer Wall Finish","facets":{"design":["texture_family","region","effect","scale"],"colour":["combinations","sheen"],"application":["tools","coats"]},"fields":[{"key":"name","label":"Finish","type":"text"},{"key":"texture_family","label":"Texture","type":"enum","values":["weave","check","tie-dye","polka","thread","geometric"]},{"key":"region","label":"Region","type":"enum","values":["North","South","East","West"]},{"key":"effect","label":"Effect","type":"multi","values":["luminous","rustic","bold","playful","earthy","elegant"]},{"key":"scale","label":"Best for","type":"enum","values":["single big wall","accent","large space"]},{"key":"sheen","label":"Sheen","type":"enum","values":["matte","metallic","pearl"]},{"key":"combinations","label":"Colour combinations","type":"colour-combos"},{"key":"tools","label":"Applied with","type":"multi","values":["sponge","trowel","roller","brush","special tool"]},{"key":"coats","label":"Coats","type":"text"}]}'::jsonb, '[{"name":"Tussar","texture_family":"weave","region":"East","effect":["luminous","elegant"],"scale":"single big wall","sheen":"metallic","inspiration":"Bhagalpur tussar silk — catches the light and draws the eye.","tools":["trowel","sponge"],"coats":"1 base + 2 effect","combinations":[{"name":"Silk Route","colours":[{"name":"Raw Silk","hex":"#C9A86A"},{"name":"Bronze Glow","hex":"#8C6B3F"}]},{"name":"Golden Weave","colours":[{"name":"Antique Gold","hex":"#B8860B"},{"name":"Champagne","hex":"#D8C89A"}]}]},{"name":"Madras Check","texture_family":"check","region":"South","effect":["rustic","bold"],"scale":"large space","sheen":"matte","inspiration":"The handloom check — crisscrossed lines bring rustic symmetry and theatre.","tools":["roller","brush"],"coats":"1 base + 1 effect","combinations":[{"name":"Rustic Grid","colours":[{"name":"Terracotta","hex":"#B5651D"},{"name":"Slate","hex":"#4A5A5A"}]},{"name":"Sunbaked","colours":[{"name":"Ochre","hex":"#CC7722"},{"name":"Umber","hex":"#8B5A2B"}]}]},{"name":"Bandhej","texture_family":"tie-dye","region":"West","effect":["earthy","bold"],"scale":"accent","sheen":"matte","inspiration":"The ancient tie-dye of Gujarat & Rajasthan — dots stamped over a crinkled, freshly-dyed look.","tools":["sponge","special tool"],"coats":"1 base + 2 effect","combinations":[{"name":"Desert Bloom","colours":[{"name":"Madder Red","hex":"#A83232"},{"name":"Sand","hex":"#D8C3A5"}]},{"name":"Indigo Tie","colours":[{"name":"Indigo","hex":"#3F5E78"},{"name":"Sand","hex":"#D8C3A5"}]}]},{"name":"Ikkat","texture_family":"thread","region":"South","effect":["elegant","luminous"],"scale":"single big wall","sheen":"pearl","inspiration":"Pochampally ikat — a soft, blurry weave that lets furniture and accents pop.","tools":["trowel","brush"],"coats":"1 base + 2 effect","combinations":[{"name":"Blurred Weave","colours":[{"name":"Teal Blur","hex":"#2E7C7C"},{"name":"Ivory","hex":"#F0EAD6"}]},{"name":"Coral Thread","colours":[{"name":"Coral","hex":"#E2725B"},{"name":"Ivory","hex":"#F0EAD6"}]}]},{"name":"Pom Pom","texture_family":"polka","region":"North","effect":["playful","bold"],"scale":"accent","sheen":"matte","inspiration":"Pure joy — bursts of colour in playful dots over a textured ground.","tools":["sponge","special tool"],"coats":"1 base + 1 effect","combinations":[{"name":"Festive Dots","colours":[{"name":"Marigold","hex":"#F4A81D"},{"name":"Rose","hex":"#D6567B"}]},{"name":"Playful Sky","colours":[{"name":"Sky","hex":"#6FA8DC"},{"name":"Marigold","hex":"#F4A81D"}]}]},{"name":"Kilim","texture_family":"geometric","region":"West","effect":["rustic","earthy"],"scale":"large space","sheen":"matte","inspiration":"Nomadic flat-weave geometry — bold motifs for a statement wall.","tools":["roller","trowel"],"coats":"1 base + 2 effect","combinations":[{"name":"Nomad Geometry","colours":[{"name":"Rust","hex":"#9C4A2F"},{"name":"Cream","hex":"#EDE1C8"}]},{"name":"Olive Weave","colours":[{"name":"Olive","hex":"#6B6B3A"},{"name":"Cream","hex":"#EDE1C8"}]}]}]'::jsonb, '[{"key":"price_per_litre","label":"Price / litre","type":"money"},{"key":"pack_sizes","label":"Pack sizes","type":"multi","values":["1L","4L","10L","20L"]},{"key":"coverage_sqft","label":"Coverage (sq ft / L)","type":"number"},{"key":"availability","label":"Availability","type":"enum","values":["in stock","made to order","discontinued"]},{"key":"lead_time_days","label":"Lead time (days)","type":"number"},{"key":"applicator_service","label":"Applicator service offered","type":"bool"}]'::jsonb)
ON CONFLICT (source_key) DO NOTHING;

-- Rollback: DROP TABLE IF EXISTS catalogue_adoption; DROP TABLE IF EXISTS catalogue_source;
