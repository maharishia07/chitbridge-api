-- b85: canonical SHARED standard source — the second source CLASS.
-- A standard (ISO 9000, a country's EXIM policy, ...) is grounded ONCE and referenced by MANY entities, industry-agnostic
-- ("same irrespective of the industry"). So it lives in the SHARED-REFERENCE class (WITHOUT RLS), like constitution /
-- capability / work_pattern (b70-73) — NOT per-entity. Each standard carries its own required-data-items TEMPLATE (this
-- is the "B" model: a typed shared source per facet). The mint assimilates it into the boilerplate via lib/workpattern.js.
CREATE TABLE IF NOT EXISTS standard_source (
  standard_key text        NOT NULL,
  version      text        NOT NULL DEFAULT 'v1',
  title        text,
  facet        text        NOT NULL DEFAULT 'standard',
  template     jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- the standard's required data items / template
  active       boolean     NOT NULL DEFAULT true,
  minted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (standard_key, version)
);
GRANT SELECT ON standard_source TO cb_app;   -- shared reference: read-only for the app role

INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('iso-9000', 'v1', 'ISO 9000 — Quality management', 'standard',
  '{"required":["quality_manual","document_control","internal_audit","management_review","corrective_action"],"audit_cycle":"annual"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;
