-- b93: seed the COMMERCE standards as SEALED SOURCE-ENTITIES — Incoterms 2020, UCP 600, FRM. This is the DDL move Athi
-- called out: commercial standards become first-class governed source-entities exactly like ISO 9001 (b89), reusing the
-- SAME machinery (sealed identity + mutable display_name + typed standard_source content + standard_document clauses).
-- They carry facet='commerce' so the COMPLIANCE readiness roll-up excludes them (they govern how the deal is covered,
-- they are not clearances to gather). Shared reference (WITHOUT RLS). See SPEC-commercial-attestation.md §6.
-- Idempotent. Standards resolved via GET /governance/commerce-standards; the commerce layer (lib/instruments.js) is
-- their operational face. [[project-commercial-attestation]], [[project-ddl-dml-lifecycle]], [[feedback-loose-until-stamped]].

-- 1 · a sealed source-entity per commerce standard (stable bridge_id/identity_id + mutable display_name; P0-1 protected)
INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed, owner_scope) VALUES
 ('CBSRCINCO1', 'Incoterms 2020 — ICC delivery terms',        'src.incoterms-2020@chitbridge.local', 'entity', 'active', true, 'platform'),
 ('CBSRCUCP61', 'UCP 600 — ICC documentary-credit rules',     'src.ucp-600@chitbridge.local',        'entity', 'active', true, 'platform'),
 ('CBSRCFRM01', 'FRM — Financial Risk Management framework',   'src.frm@chitbridge.local',            'entity', 'active', true, 'platform')
ON CONFLICT (email) DO NOTHING;

-- 2 · the typed standard content (facet 'commerce'; template lists the governing clauses it defines)
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('incoterms-2020','v2020','Incoterms 2020 — ICC delivery terms','commerce','{"required":["incoterm_rule","transfer_point","insurance_duty"],"scope":"chit"}'::jsonb),
 ('ucp-600','v600','UCP 600 — ICC documentary-credit rules','commerce','{"required":["credit_terms","complying_presentation","discrepancy_handling"],"scope":"chit"}'::jsonb),
 ('frm','v1','FRM — Financial Risk Management framework','commerce','{"required":["market_risk","credit_risk","liquidity_risk","operational_risk"],"scope":"entity"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

-- 3 · the clauses each commerce standard defines (its standard_document set)
INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('incoterms-2020','incoterm_rule','Chosen Incoterm 2020 rule','The agreed delivery term (EXW…DDP) governing cost/risk split.','Incoterms 2020','field','chit','per-order','{}'::jsonb,1),
 ('incoterms-2020','transfer_point','Risk/cost transfer point','The named place where risk and cost pass to the buyer.','Incoterms 2020','field','chit','per-order','{}'::jsonb,2),
 ('incoterms-2020','insurance_duty','Insurance responsibility','Who must insure the cargo (CIF/CIP → seller; others → buyer).','Incoterms 2020','field','chit','per-order','{}'::jsonb,3),
 ('ucp-600','credit_terms','Documentary credit terms','The LC terms issued by the bank (amount, expiry, docs required).','UCP 600','document','chit','per-order','{}'::jsonb,1),
 ('ucp-600','complying_presentation','Complying presentation','Documents that comply with the credit and UCP 600 articles.','UCP 600 Art.14','document','chit','per-order','{}'::jsonb,2),
 ('ucp-600','discrepancy_handling','Discrepancy handling','How discrepancies are notified and resolved.','UCP 600 Art.16','records','chit','per-order','{}'::jsonb,3),
 ('frm','market_risk','Market risk assessment','Price, FX and commodity exposure — hedged with forwards/futures/options.','FRM','records','entity','periodic','{}'::jsonb,1),
 ('frm','credit_risk','Credit & counterparty risk','Buyer/country default exposure — covered by LC, guarantees, credit insurance.','FRM','records','entity','periodic','{}'::jsonb,2),
 ('frm','liquidity_risk','Liquidity / funding risk','The cash-flow gap to settlement — trade finance, factoring.','FRM','records','entity','periodic','{}'::jsonb,3),
 ('frm','operational_risk','Operational risk','Transit, quality and execution failures — cargo & liability insurance.','FRM','records','entity','periodic','{}'::jsonb,4)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- 4 · applicability (the trade-lane predicate) + how to adopt it (guidance)
UPDATE standard_source SET applicability='{}'::jsonb,                 guidance='Agree an Incoterms 2020 rule in the contract; it sets who insures and where risk passes.' WHERE standard_key='incoterms-2020'; -- universal to any trade
UPDATE standard_source SET applicability='{"cross_border":true}'::jsonb, guidance='Open a documentary credit with your bank under UCP 600 for cross-border payment security.'   WHERE standard_key='ucp-600';        -- export payment cover
UPDATE standard_source SET applicability='{}'::jsonb,                 guidance='Frame commercial exposure under FRM: market, credit, liquidity, operational — cover each.'   WHERE standard_key='frm';            -- universal discipline

-- 5 · link each standard's content to its owning sealed source-entity (the DDL identity)
UPDATE standard_source s SET owner_entity_id = i.identity_id FROM identities i WHERE i.email='src.incoterms-2020@chitbridge.local' AND s.standard_key='incoterms-2020' AND s.owner_entity_id IS NULL;
UPDATE standard_source s SET owner_entity_id = i.identity_id FROM identities i WHERE i.email='src.ucp-600@chitbridge.local'        AND s.standard_key='ucp-600'        AND s.owner_entity_id IS NULL;
UPDATE standard_source s SET owner_entity_id = i.identity_id FROM identities i WHERE i.email='src.frm@chitbridge.local'            AND s.standard_key='frm'            AND s.owner_entity_id IS NULL;
