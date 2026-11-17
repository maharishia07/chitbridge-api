-- b109: idempotency store for the offline OUTBOX (Phase 2). A mutation carrying an Idempotency-Key executes AT MOST ONCE
-- per (entity, key); replays return the recorded response instead of re-running. Per-entity, WITH RLS (isolation standard).
-- Additive + self-healing: middleware/idempotency proceeds WITHOUT idempotency until this is run (never breaks a request).
CREATE TABLE IF NOT EXISTS idempotency_key (
  entity_id  uuid NOT NULL,
  idem_key   text NOT NULL,
  method     text NOT NULL,
  path       text NOT NULL,
  req_hash   text NOT NULL,                 -- sha256 of (method+path+stable(body)) — same key + different body ⇒ 422
  state      text NOT NULL DEFAULT 'in_progress',   -- in_progress | done
  status     int,                            -- recorded response status (2xx/3xx/4xx; 5xx is never recorded)
  response   jsonb,                           -- recorded response body, replayed verbatim
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, idem_key)           -- the ON CONFLICT target
);
CREATE INDEX IF NOT EXISTS idempotency_key_created ON idempotency_key (created_at);
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON idempotency_key;
CREATE POLICY rls_entity ON idempotency_key
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_key TO cb_app;
