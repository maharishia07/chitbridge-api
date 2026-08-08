-- b119_entity_place.sql — where a store is, and how far it serves.
--
-- Athi, 2026-08-08: *"how the goods can move from one store to another so the fulfilment can happen… understand
-- the closest stores, warehouse, other supplier who has to stock, and where the demand currently is."*
--
-- Every one of those is a DISTANCE question, and CB cannot ask one today. `cb_entity` has carried latitude,
-- longitude and geohash since the baseline and nothing has ever written or read them; `identities` — the live
-- model everything actually uses — has only `country` and a free-text `address`. So "who is nearest" has never
-- been answerable, and nearest-store, coverage gaps, lateral transfer routing and the demand map all rest on it.
--
-- ── WHY numeric AND NOT PostGIS ────────────────────────────────────────────────────────────────────────────────
-- PostGIS is the right answer for real geospatial work and it is not needed to answer "which of my 40 stores is
-- closest". Two numerics and a haversine over a few hundred rows is exact, portable, and adds no extension to the
-- deployment. The day this is a few hundred THOUSAND rows, or the question becomes routing rather than distance,
-- PostGIS earns its place — and the columns below are exactly what it would be built from either way.
--
-- lat/lng are NULLABLE and mean "not located". A store with an address and no coordinates is a real and common
-- state; pretending 0,0 is a place puts every unlocated store in the Gulf of Guinea.
--
-- service_km: how far this store serves. NULL = not stated, which is not the same as zero.
--
-- Safe to re-run.
-- Rollback:  ALTER TABLE identities DROP COLUMN lat, DROP COLUMN lng, DROP COLUMN service_km, DROP COLUMN city;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS lat         numeric(9,6);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS lng         numeric(9,6);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS service_km  integer;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS city        varchar(120);

-- Nearest-store scans "the located members of one network", so the useful index is on the coordinate pair and it
-- only needs to cover rows that HAVE one.
CREATE INDEX IF NOT EXISTS idx_identities_latlng ON identities (lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

COMMENT ON COLUMN identities.lat IS 'Latitude, decimal degrees. NULL = not located (never 0 — that is a real place).';
COMMENT ON COLUMN identities.lng IS 'Longitude, decimal degrees. NULL = not located.';
COMMENT ON COLUMN identities.service_km IS 'How far this store serves, km. NULL = not stated, which is not zero.';
