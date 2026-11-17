-- b87: seed a SECOND canonical standard facet — EXIM (foreign-trade) policy — to prove the boilerplate assimilates
-- N shared sources, not just one. Same CLASS as ISO 9000 (shared-reference, WITHOUT RLS, GRANT SELECT via b85).
-- facet='trade' so lib/workpattern.js resolveStandards() merges it ALONGSIDE iso-9000 (facet 'standard') into the
-- boilerplate — the mint stamps BOTH onto the chit. The `required` list is what a runtime conformance check reads to
-- flag contradictions (e.g. an export order missing hs_code / incoterms). Jurisdiction-neutral (no country named).
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('exim-policy', 'v1', 'EXIM — Foreign Trade (export/import) policy', 'trade',
  '{"required":["iec_code","hs_code","export_declaration","incoterms"],"scope":"chit","authority":"foreign-trade","review_cycle":"annual"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;
