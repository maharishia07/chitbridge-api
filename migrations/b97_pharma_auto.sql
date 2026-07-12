-- b97: two more sectors — PHARMA and AUTOMOBILE — to widen the "generic, not chemical-only" showcase. Same engine as
-- b91/b95 (derive-not-enumerate). entity-scope docs → Certification tab · chit-scope → Clearance tab. Shared reference
-- (WITHOUT RLS). IATF 16949 is a voluntary management-system standard (b96 voluntary flag). See SPEC-trade-lane-confidence.md.

-- 1 · standards
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 -- PHARMA
 ('who-gmp','v1','WHO-GMP — Good Manufacturing Practice','pharma','{"required":["gmp_certificate"],"scope":"entity"}'::jsonb),
 ('cdsco','v1','CDSCO — India manufacturing licence','pharma','{"required":["cdsco_licence"],"scope":"entity"}'::jsonb),
 ('copp','v1','Certificate of Pharmaceutical Product (CoPP)','pharma','{"required":["copp_cert"],"scope":"chit"}'::jsonb),
 ('fda-drug','v1','US FDA drug registration','pharma','{"required":["fda_registration"],"scope":"chit"}'::jsonb),
 -- AUTOMOBILE
 ('iatf-16949','v1','IATF 16949 — Automotive quality','automotive','{"required":["iatf_certificate"],"scope":"entity"}'::jsonb),
 ('ece-approval','v1','ECE Type Approval (UNECE)','automotive','{"required":["type_approval"],"scope":"chit"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

-- 2 · documents (scope drives the tab)
INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('who-gmp','gmp_certificate','WHO-GMP Certificate','GMP certificate from the drug-control authority.','WHO-GMP','document','entity','periodic','{}'::jsonb,1),
 ('cdsco','cdsco_licence','CDSCO Manufacturing Licence','Valid CDSCO manufacturing/export licence.','CDSCO','document','entity','once','{}'::jsonb,1),
 ('copp','copp_cert','Certificate of Pharmaceutical Product','WHO-format CoPP per product for the destination.','WHO CoPP','document','chit','per-order','{}'::jsonb,1),
 ('fda-drug','fda_registration','US FDA Registration','Establishment registration & drug listing with the US FDA.','FDA','document','chit','per-order','{}'::jsonb,1),
 ('iatf-16949','iatf_certificate','IATF 16949 Certificate','Automotive QMS certificate from an IATF-recognised body.','IATF 16949','document','entity','annual','{}'::jsonb,1),
 ('ece-approval','type_approval','ECE Type-Approval Certificate','UNECE type-approval for the vehicle/part.','UNECE','document','chit','per-order','{}'::jsonb,1)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- 3 · applicability + guidance
UPDATE standard_source SET applicability='{"categories":["pharma"]}'::jsonb,                        guidance='Obtain a WHO-GMP certificate from your drug-control authority.'                          WHERE standard_key='who-gmp';
UPDATE standard_source SET applicability='{"origin":["IN"],"categories":["pharma"]}'::jsonb,         guidance='Hold a valid CDSCO manufacturing/export licence.'                                        WHERE standard_key='cdsco';
UPDATE standard_source SET applicability='{"cross_border":true,"categories":["pharma"]}'::jsonb,     guidance='Secure a WHO-format Certificate of Pharmaceutical Product per destination.'              WHERE standard_key='copp';
UPDATE standard_source SET applicability='{"destination":["US"],"categories":["pharma"]}'::jsonb,    guidance='Register the establishment and list drugs with the US FDA.'                              WHERE standard_key='fda-drug';
UPDATE standard_source SET applicability='{"categories":["automotive"]}'::jsonb,                     guidance='Certify your automotive QMS to IATF 16949 via a recognised body.'                        WHERE standard_key='iatf-16949';
UPDATE standard_source SET applicability='{"destination":["EU"],"categories":["automotive"]}'::jsonb,guidance='Obtain UNECE type-approval for the vehicle/component for the market.'                    WHERE standard_key='ece-approval';

-- IATF 16949 is a voluntary management-system standard
UPDATE standard_source SET voluntary = true WHERE standard_key = 'iatf-16949';

-- 4 · vertical → category
INSERT INTO vertical_category (vertical, category) VALUES
 ('pharma','pharma'), ('automobile','automotive')
ON CONFLICT DO NOTHING;
