-- b204 · media_blobs — the database store for product pictures when no S3 env is set (lib/storage-object.js).
-- WITHOUT RLS on purpose: rows are reached only through the API by their key (entity/yyyy/mm/uuid, unguessable);
-- the public read (GET /api/products/media/:item/:mid) takes the key from the product's own item_data, never from
-- the URL. A later S3 configuration leaves this table unused, nothing else changes.
-- Supabase editor: run as one statement set; ONE result set at the end.
CREATE TABLE IF NOT EXISTS media_blobs (
  key        text PRIMARY KEY,
  entity_id  uuid NOT NULL,
  mime       text,
  size       integer,
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_blobs_entity_idx ON media_blobs (entity_id);
SELECT to_regclass('public.media_blobs') IS NOT NULL AS media_blobs_exists;
