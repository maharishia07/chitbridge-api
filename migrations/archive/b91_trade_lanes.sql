-- b91: TRADE LANES — destination-resolved readiness, GENERIC (derive, don't enumerate). Requirements are COMPUTED from
-- rules + attributes, never stored per (vertical × destination × standard):
--   • each STANDARD declares WHEN it applies  → standard_source.applicability {jurisdictions[], categories[]}
--   • a VERTICAL/material carries category TAGS → vertical_category  (ultimately from HS code; vertical-level for now)
--   • DESTINATIONS are a small list           → jurisdiction
-- required(product, destination) = standards whose applicability matches → linear tables, cross-product computed.
-- Shared reference (WITHOUT RLS). See SPEC-trade-lane-confidence.md.

-- 1 · destination-specific standards + their docs (typed content)
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('iso-14001','v1','ISO 14001 — Environmental management','environmental','{"required":["environmental_policy","aspects_register"],"scope":"entity"}'::jsonb),
 ('reach','v1','REACH — EU chemical registration','chemical-eu','{"required":["substance_registration","safety_dossier"],"scope":"entity"}'::jsonb),
 ('tsca','v1','TSCA — US chemical inventory','chemical-us','{"required":["tsca_inventory_listing"],"scope":"entity"}'::jsonb),
 ('sds','v1','Safety Data Sheet (GHS)','safety','{"required":["sds_document"],"scope":"chit"}'::jsonb),
 ('bis','v1','BIS — India product conformity','conformity-in','{"required":["bis_certificate"],"scope":"entity"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('iso-14001','environmental_policy','Environmental Policy','Your documented environmental commitment & objectives.','§5.2','document','entity','once','{}'::jsonb,1),
 ('iso-14001','aspects_register','Aspects & Impacts Register','Your significant environmental aspects.','§6.1','records','entity','annual','{}'::jsonb,2),
 ('reach','substance_registration','REACH Substance Registration','Each substance ≥1 t/yr registered with ECHA.','REACH','document','entity','once','{}'::jsonb,1),
 ('reach','safety_dossier','Chemical Safety Dossier','The safety assessment behind the registration.','REACH','document','entity','once','{}'::jsonb,2),
 ('tsca','tsca_inventory_listing','TSCA Inventory Listing','Substances listed / PMN filed with the US EPA.','TSCA','document','entity','once','{}'::jsonb,1),
 ('sds','sds_document','Safety Data Sheet','A GHS-format hazard sheet per product/substance.','GHS','document','chit','per-order','{}'::jsonb,1),
 ('bis','bis_certificate','BIS Certificate','Product conformity certification (ISI mark).','BIS','document','entity','once','{}'::jsonb,1)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- 2 · GENERIC: each standard declares its applicability + how to obtain it (guidance)
ALTER TABLE standard_source ADD COLUMN IF NOT EXISTS applicability jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE standard_source ADD COLUMN IF NOT EXISTS guidance text;
-- applicability = { origin:[], destination:[], categories:[], cross_border:bool }. origin = home-country export rule;
-- destination = target-country import rule; cross_border = any export (origin≠dest); categories = product tags.
-- Empty condition = "not conditioned on this". This is the BRIDGE: home rules ∪ destination rules ∪ universal.
UPDATE standard_source SET applicability='{}'::jsonb,                                             guidance='Certify your QMS with an accredited ISO registrar (audit + surveillance).'              WHERE standard_key='iso-9001';  -- universal
UPDATE standard_source SET applicability='{"destination":["EU"]}'::jsonb,                         guidance='Certify your environmental management system with an accredited registrar.'             WHERE standard_key='iso-14001'; -- EU import
UPDATE standard_source SET applicability='{"cross_border":true}'::jsonb,                          guidance='Hold a valid exporter registration and complete the export declaration.'                 WHERE standard_key='exim-policy';-- any export
UPDATE standard_source SET applicability='{"destination":["EU"],"categories":["chemical"]}'::jsonb, guidance='Register substances (≥1 t/yr) with ECHA; prepare safety dossiers. Lead time ~2–4 months.' WHERE standard_key='reach';     -- EU import, chemical
UPDATE standard_source SET applicability='{"destination":["US"],"categories":["chemical"]}'::jsonb, guidance='List substances on the US EPA TSCA inventory, or file a PMN for new chemicals.'          WHERE standard_key='tsca';      -- US import, chemical
UPDATE standard_source SET applicability='{"categories":["chemical"]}'::jsonb,                    guidance='Author a GHS/CLP-compliant Safety Data Sheet per product.'                              WHERE standard_key='sds';       -- any chemical
UPDATE standard_source SET applicability='{"destination":["IN"]}'::jsonb,                         guidance='Obtain BIS product certification (ISI mark) for the category.'                            WHERE standard_key='bis';       -- India conformity

-- 3 · a vertical/material's category tags (linear; extendable to per-product / HS-code later)
CREATE TABLE IF NOT EXISTS vertical_category (
  vertical text NOT NULL, category text NOT NULL, PRIMARY KEY (vertical, category)
);
GRANT SELECT ON vertical_category TO cb_app;
INSERT INTO vertical_category (vertical, category) VALUES
 ('paint','chemical'), ('paint','coating'), ('paint','voc')
ON CONFLICT DO NOTHING;

-- 4 · destinations (a small list, not a cross-product)
CREATE TABLE IF NOT EXISTS jurisdiction (
  dest_key text PRIMARY KEY, name text NOT NULL, display_order int NOT NULL DEFAULT 0, domestic boolean NOT NULL DEFAULT false
);
GRANT SELECT ON jurisdiction TO cb_app;
INSERT INTO jurisdiction (dest_key, name, display_order, domestic) VALUES
 ('EU','European Union',1,false), ('US','United States',2,false), ('GULF','Gulf (GCC)',3,false), ('IN','Domestic (India)',4,true)
ON CONFLICT (dest_key) DO NOTHING;
