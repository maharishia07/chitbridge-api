-- b108: authority-forms engine store. An ISSUED form is frozen by value (content_hash) into a per-copy form_instance.
-- Per-entity, WITH RLS (the platform's isolation standard). Additive + self-healing: lib/forms self-heals (503
-- FORMS_STORE_MISSING on issue/list) until this is run. Resolve/preview needs no table (compute over owned data).
CREATE TABLE IF NOT EXISTS form_instance (
  form_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  form_key     text NOT NULL,               -- registry key (certificate-of-origin, commercial-invoice, authority-application, ...)
  context_ref  uuid,                          -- the order/chit this form was drawn from (nullable — some forms are context-free)
  title        text NOT NULL,
  fields       jsonb NOT NULL,               -- frozen filled fields [{id,label,value,source,rung,required}]
  provenance   jsonb NOT NULL,               -- {by_source:{...}, fields:[{id,source,rung}]}
  content_hash text NOT NULL,                -- sha256 over (form_key, context_ref, [{id,value,source}]) — the freeze
  ready        boolean NOT NULL DEFAULT true,
  signatory    jsonb,                          -- {name, designation} — set on sign
  signed_at    timestamptz,                    -- platform-stamped at sign time
  transfers    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{chit_id, attachment_id, at}] — filed onto the rail (per-copy attachment)
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- idempotent: if the table was created by an earlier run of b108 (before the transfers column was added), add it now.
ALTER TABLE form_instance ADD COLUMN IF NOT EXISTS transfers jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS form_instance_entity ON form_instance (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS form_instance_ctx    ON form_instance (entity_id, context_ref);
ALTER TABLE form_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_instance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON form_instance;
CREATE POLICY rls_entity ON form_instance
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON form_instance TO cb_app;
