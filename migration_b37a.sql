-- B3.7a — Catalogue items (products): the data the public catalogue shows
CREATE TABLE IF NOT EXISTS catalogue_items (
  item_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   UUID NOT NULL REFERENCES identities(identity_id),
  schema_id   UUID REFERENCES entity_schemas(schema_id),
  item_data   JSONB NOT NULL DEFAULT '{}',     -- product field values per the schema (minus quantity)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalogue_items_entity ON catalogue_items(entity_id, is_active);

SELECT 'catalogue_items' AS t, COUNT(*) FROM catalogue_items;
