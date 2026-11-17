-- b79: source_penetration — an AGGREGATE-ONLY ledger for the brand's penetration heatmap (see
-- C:\dev\SPEC-source-governed-distribution.md §8: heatmap only, no per-customer PII to the brand).
-- One row per order-line-source with the customer's coarse LOCALITY (consent-provided) + the distributor.
-- ⚠️ DELIBERATELY NO customer_identity column here → the table STRUCTURALLY cannot leak PII. The brand reads only
-- aggregated counts for sources IT owns (app gates by catalogue_source.owner_entity_id). WITHOUT RLS (shared ledger).

CREATE TABLE IF NOT EXISTS source_penetration (
  id                    bigserial PRIMARY KEY,
  source_key            text NOT NULL,
  distributor_entity_id uuid,
  locality              text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_penetration_source ON source_penetration (source_key);

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT ON source_penetration TO cb_app';
  EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE source_penetration_id_seq TO cb_app';
END IF; END $$;

-- Rollback (optional): DROP TABLE IF EXISTS source_penetration;
