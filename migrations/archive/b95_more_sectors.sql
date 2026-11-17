-- b95: prove the tool is GENERIC, not chemical-only. Seed FOOD, TEXTILES and ELECTRONICS sectors — each with its own
-- standards (entity-scope → Certification tab · chit-scope → Clearance tab) and applicability, plus vertical→category
-- tags. Switching the sector selector then re-resolves REAL sector-specific certifications/clearances (derive-not-
-- enumerate; same engine as b91 paint/chemical). Shared reference (WITHOUT RLS). See SPEC-trade-lane-confidence.md.

-- 1 · the sector standards (typed content; facet is the sector so they stay OUT of the commerce roll-up)
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 -- FOOD
 ('haccp','v1','HACCP — Food safety management','food','{"required":["haccp_plan","ccp_records"],"scope":"entity"}'::jsonb),
 ('fssai','v1','FSSAI — India food licence','food','{"required":["fssai_licence"],"scope":"entity"}'::jsonb),
 ('phyto','v1','Phytosanitary certificate','food','{"required":["phyto_cert"],"scope":"chit"}'::jsonb),
 ('eu-health','v1','EU health certificate (food import)','food','{"required":["health_cert"],"scope":"chit"}'::jsonb),
 -- TEXTILES
 ('oeko-tex','v1','OEKO-TEX Standard 100','textile','{"required":["oekotex_cert"],"scope":"entity"}'::jsonb),
 ('gots','v1','GOTS — organic textiles','textile','{"required":["gots_cert"],"scope":"entity"}'::jsonb),
 ('flammability','v1','Flammability compliance (16 CFR 1610)','textile','{"required":["flammability_report"],"scope":"chit"}'::jsonb),
 -- ELECTRONICS
 ('ce-rohs','v1','CE / RoHS conformity','electronics','{"required":["doc_conformity","rohs_decl"],"scope":"entity"}'::jsonb),
 ('weee','v1','WEEE registration','electronics','{"required":["weee_reg"],"scope":"entity"}'::jsonb),
 ('battery-comp','v1','Battery compliance (UN 38.3)','electronics','{"required":["un383_report"],"scope":"chit"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

-- 2 · the documents each standard requires (scope drives the tab: entity → Certification, chit → Clearance)
INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('haccp','haccp_plan','HACCP Plan','Your documented hazard-analysis & critical-control-point plan.','HACCP','document','entity','annual','{}'::jsonb,1),
 ('haccp','ccp_records','CCP Monitoring Records','Records proving critical control points are monitored.','HACCP','records','entity','ongoing','{}'::jsonb,2),
 ('fssai','fssai_licence','FSSAI Licence','A valid FSSAI manufacturing/export licence.','FSSAI','document','entity','once','{}'::jsonb,1),
 ('phyto','phyto_cert','Phytosanitary Certificate','Issued by the plant-protection authority per consignment.','IPPC','document','chit','per-order','{}'::jsonb,1),
 ('eu-health','health_cert','EU Health Certificate','Official health certificate for food into the EU.','EU','document','chit','per-order','{}'::jsonb,1),
 ('oeko-tex','oekotex_cert','OEKO-TEX Certificate','Standard 100 certificate for the article class.','OEKO-TEX','document','entity','annual','{}'::jsonb,1),
 ('gots','gots_cert','GOTS Certificate','Organic-textile certification (scope certificate).','GOTS','document','entity','annual','{}'::jsonb,1),
 ('flammability','flammability_report','Flammability Test Report','16 CFR 1610 test report for the fabric.','16 CFR 1610','document','chit','per-order','{}'::jsonb,1),
 ('ce-rohs','doc_conformity','Declaration of Conformity','EU Declaration of Conformity (CE).','CE','document','entity','once','{}'::jsonb,1),
 ('ce-rohs','rohs_decl','RoHS Declaration','Restriction of Hazardous Substances declaration.','RoHS','document','entity','once','{}'::jsonb,2),
 ('weee','weee_reg','WEEE Registration','Producer registration for e-waste (per member state).','WEEE','document','entity','once','{}'::jsonb,1),
 ('battery-comp','un383_report','UN 38.3 Test Report','Transport safety test report for batteries.','UN 38.3','document','chit','per-order','{}'::jsonb,1)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- 3 · applicability (the trade-lane predicate) + guidance
UPDATE standard_source SET applicability='{"categories":["food-safety"]}'::jsonb,                  guidance='Implement a HACCP plan and keep CCP monitoring records; audited by a food-safety body.' WHERE standard_key='haccp';
UPDATE standard_source SET applicability='{"origin":["IN"],"categories":["food-safety"]}'::jsonb,   guidance='Hold a valid FSSAI licence for manufacture/export.'                                       WHERE standard_key='fssai';
UPDATE standard_source SET applicability='{"cross_border":true,"categories":["perishable"]}'::jsonb, guidance='Obtain a phytosanitary certificate from the plant-protection authority per consignment.'  WHERE standard_key='phyto';
UPDATE standard_source SET applicability='{"destination":["EU"],"categories":["food-safety"]}'::jsonb,guidance='Secure an EU health certificate for food consignments.'                                   WHERE standard_key='eu-health';
UPDATE standard_source SET applicability='{"categories":["textile"]}'::jsonb,                        guidance='Certify articles to OEKO-TEX Standard 100 for the relevant product class.'                WHERE standard_key='oeko-tex';
UPDATE standard_source SET applicability='{"categories":["textile"]}'::jsonb,                        guidance='Obtain GOTS scope certification if selling organic textiles.'                             WHERE standard_key='gots';
UPDATE standard_source SET applicability='{"destination":["US"],"categories":["flammable"]}'::jsonb, guidance='Test the fabric to 16 CFR 1610 and keep the report per shipment.'                          WHERE standard_key='flammability';
UPDATE standard_source SET applicability='{"destination":["EU"],"categories":["electronic"]}'::jsonb,guidance='Prepare the CE Declaration of Conformity and a RoHS declaration.'                          WHERE standard_key='ce-rohs';
UPDATE standard_source SET applicability='{"destination":["EU"],"categories":["electronic"]}'::jsonb,guidance='Register as a producer under WEEE in each EU member state you sell into.'                  WHERE standard_key='weee';
UPDATE standard_source SET applicability='{"cross_border":true,"categories":["battery"]}'::jsonb,    guidance='Hold a UN 38.3 transport-safety test report for products containing batteries.'          WHERE standard_key='battery-comp';

-- 4 · vertical → category tags (so the sector selector resolves the right standards)
INSERT INTO vertical_category (vertical, category) VALUES
 ('food','food-safety'), ('food','perishable'),
 ('textiles','textile'), ('textiles','flammable'),
 ('electronics','electronic'), ('electronics','battery')
ON CONFLICT DO NOTHING;
