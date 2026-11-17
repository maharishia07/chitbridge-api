-- b104: CAPTURE queue — the intake inbox. Bring outside channels (WhatsApp · email · web · SMS · …) onto the rail via
-- ONE pipeline: channel → CAPTURE (raw, untrusted) → AI structure → HUMAN CONFIRM → chit. A capture is a PENDING item,
-- NOT yet a chit. Per-entity, WITH RLS (each entity sees only its own intake). See SPEC-capture-connector.md.
-- Additive + self-healing: routes 503 "capture not migrated (b104)" until this runs. Athi's gate.
CREATE TABLE IF NOT EXISTS capture (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  channel      text NOT NULL,                         -- whatsapp | email | web | sms | ...
  sender_ref   text,                                  -- the sender's phone/email/handle
  sender_name  text,
  subject      text,
  raw_text     text NOT NULL,                          -- the untrusted inbound message
  media_refs   jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{name,url}] (attachments/media pointers)
  status       text NOT NULL DEFAULT 'pending',        -- pending | converted | dismissed
  structured   jsonb,                                  -- the AI-structured draft (once run) {subject,line_items:[...]}
  chit_id      uuid,                                    -- the resulting chit (once converted)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_entity_status ON capture (entity_id, status, created_at DESC);
ALTER TABLE capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture FORCE  ROW LEVEL SECURITY;          -- the platform's isolation standard (per the review)
DROP POLICY IF EXISTS rls_entity ON capture;
CREATE POLICY rls_entity ON capture
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON capture TO cb_app;
