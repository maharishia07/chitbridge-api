-- b69: the ERP transfer-mode RECEIPT ledger — "process-then-forget". An ERP/middleware pushes a document; we PROCESS
-- it (deliver the business outcome as a co-held chit) and then FORGET the raw payload, keeping only a RECEIPT:
-- the payload HASH + the OUTCOME + a pointer to the emitted chit. We never persist the raw ERP document.
--
-- WITH RLS: connector_receipt is entity-data (each row belongs to the connector's OWNING entity), so it carries
-- entity_id + the same isolation predicate as b49/b64/b66/b68. The device-facing ingest resolves entity_id from the
-- authenticated ActorKey and writes the receipt inside withEntity(owner) — so the RLS context is always bound.
--
-- ⚠️ COUPLING RULE: enable only after every connector_receipt access is on withEntity() — done in routes/connectors.js
--    (recordReceipt + the erp-ingest idempotency lookup both run under withEntity(owner)).
--
-- Idempotency: UNIQUE(actor_id, payload_hash) — the same document pushed twice yields ONE receipt and ONE effect
-- (the second call returns the first receipt, outcome 'duplicate'). This is what makes process-then-forget safe to retry.
--
-- Provisioned as ADMIN (postgres): cb_app has USAGE not CREATE on schema public, so it cannot create this at runtime.
-- Rollback: DROP TABLE IF EXISTS connector_receipt;

CREATE TABLE IF NOT EXISTS connector_receipt (
  receipt_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,               -- the connector's OWNING entity (RLS tenant)
  actor_id     uuid NOT NULL,               -- the ERP connector actor
  doc_type     text,                        -- e.g. 'invoice','order','grn' (summary, not payload)
  doc_ref      text,                        -- the ERP's own document number/reference
  payload_hash text NOT NULL,               -- sha256 of the canonical raw payload — the ONLY trace of it
  outcome      text NOT NULL,               -- processed | duplicate | logged | failed
  chit_id      uuid,                         -- the co-held chit we emitted (the business effect), if any
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_receipt_idem_idx ON connector_receipt(actor_id, payload_hash);
CREATE INDEX IF NOT EXISTS connector_receipt_entity_idx ON connector_receipt(entity_id, received_at DESC);

ALTER TABLE connector_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_receipt FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON connector_receipt;
CREATE POLICY rls_entity ON connector_receipt
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON connector_receipt TO cb_app;
