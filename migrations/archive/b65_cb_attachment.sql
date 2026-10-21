-- b65: provision cb_attachment as ADMIN (postgres). The app role cb_app is least-privilege (USAGE, not CREATE, on
-- schema public), so it CANNOT create this table at runtime — the old lazy CREATE TABLE IF NOT EXISTS in lib/storage.js
-- raised "permission denied for schema public" and silently killed proof-image attachment on the connector ingest.
-- Creating it here (idempotent) fixes that; storage.ensureTable now only checks existence and never attempts DDL.
--
-- No RLS: cb_attachment has no entity_id — access is guarded at the app layer (GET /api/attachments/:id checks the
-- caller owns the parent chit). It is deliberately NOT in the RLS tenant set. Grants ride b48 default privileges;
-- explicit GRANT below is belt-and-braces for a role that pre-existed the default-privileges grant.

CREATE TABLE IF NOT EXISTS cb_attachment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id     uuid,
  message_id  uuid,
  line_index  int,
  name        text,
  mime        text,
  size        int,
  data        bytea,
  uploaded_by uuid,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cb_attachment_chit_idx ON cb_attachment(chit_id) WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS cb_attachment_msg_idx  ON cb_attachment(message_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON cb_attachment TO cb_app;
