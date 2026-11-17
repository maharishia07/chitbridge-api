-- b90: MAKE COMPLIANCE REAL — a standard's document CATALOGUE (the vector) + a per-entity GATHERED-evidence store.
-- Feeds the trade-readiness (supplier) and trade-confidence (buyer) views. See project-compliance-by-catalogue.
-- 1) standard_document = shared reference (WITHOUT RLS, like standard_source): every document a standard requires,
--    with its mandate, capture type, scope and form. 2) entity_compliance = per-entity gathered evidence (WITH RLS).

-- ── 1 · the document catalogue (the vector) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS standard_document (
  standard_key text NOT NULL,
  doc_key      text NOT NULL,
  title        text NOT NULL,
  mandate      text,                                   -- WHY the standard requires it
  clause       text,
  capture_type text NOT NULL DEFAULT 'document',       -- document | data | procedure | records
  scope        text NOT NULL DEFAULT 'entity',         -- entity (org, standing) | chit (per order)
  frequency    text,                                   -- once | annual | per-order | as-arising | ongoing
  form         jsonb NOT NULL DEFAULT '{}'::jsonb,      -- the fields/template captured
  display_order int  NOT NULL DEFAULT 0,
  PRIMARY KEY (standard_key, doc_key)
);
GRANT SELECT ON standard_document TO cb_app;

INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('iso-9001','quality_manual','Quality Manual','Defines the QMS scope, quality policy and objectives — the foundation.','§4.3·§5.2·§6.2','document','entity','once',
   '{"fields":["scope_statement","quality_policy","objectives","manual_doc"]}'::jsonb,1),
 ('iso-9001','document_control','Document Control','Ensures only current, approved documents are in use.','§7.5','procedure','entity','ongoing',
   '{"fields":["control_procedure","approval_matrix","retention_rule"]}'::jsonb,2),
 ('iso-9001','internal_audit','Internal Audit','You audit your own system at planned intervals.','§9.2','records','entity','annual',
   '{"fields":["audit_programme","audit_report","findings"]}'::jsonb,3),
 ('iso-9001','management_review','Management Review','Top management reviews performance — leadership engagement.','§9.3','records','entity','annual',
   '{"fields":["review_minutes","inputs","decisions"]}'::jsonb,4),
 ('iso-9001','corrective_action','Corrective Action','Nonconformities fixed at root cause — continual improvement.','§10.2','records','entity','as-arising',
   '{"fields":["nonconformity","root_cause","action_taken","verification"]}'::jsonb,5),
 ('exim-policy','iec_code','IEC — Importer-Exporter Code','Mandatory registration to trade across borders at all.','registration','data','entity','once',
   '{"fields":["iec_code","registered_name","valid_from"]}'::jsonb,1),
 ('exim-policy','hs_code','HS Code','Classifies goods for tariff, duty and restrictions.','classification','data','chit','per-order',
   '{"fields":["hs_code","goods_description"]}'::jsonb,2),
 ('exim-policy','export_declaration','Export Declaration','The legal declaration to customs that goods are leaving.','customs','document','chit','per-order',
   '{"fields":["export_declaration","port","value"]}'::jsonb,3),
 ('exim-policy','incoterms','Incoterms','Fixes who bears cost, risk and duty (and customs valuation).','terms','data','chit','per-order',
   '{"fields":["incoterm","named_place"]}'::jsonb,4)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- ── 2 · per-entity gathered evidence (WITH RLS — an entity's own compliance) ──
CREATE TABLE IF NOT EXISTS entity_compliance (
  entity_id    uuid NOT NULL,
  standard_key text NOT NULL,
  doc_key      text NOT NULL,
  status       text NOT NULL DEFAULT 'gathered',       -- gathered | pending | expired
  evidence_ref text,                                    -- a reference to the document / chit that proves it
  valid_until  date,
  gathered_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, standard_key, doc_key)
);
ALTER TABLE entity_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_compliance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON entity_compliance;
CREATE POLICY rls_entity ON entity_compliance
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON entity_compliance TO cb_app;
