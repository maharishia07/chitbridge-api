-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- b538 — TRADE-SRV1 G1: Australia and the UAE become trade lanes; no lane answers "India" for a shop that is not.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor). Written offline, read, never executed.
-- RLS: WITHOUT — standard_source · standard_document · jurisdiction are SHARED reference data (b91: GRANT SELECT to cb_app, no
--   entity_id). Nothing per-entity is touched.
-- Idempotent: every INSERT is ON CONFLICT DO NOTHING; every UPDATE sets a fixed value. Safe to re-run; the proof block re-checks.
-- The code works BEFORE this runs: lib/readiness.js reads whatever lanes the table holds, so AU and AE are simply absent until then,
--   and the lane whose key is the shop's own country is computed as domestic in code (the IN row's flag is no longer read).
--
-- WHAT (DATA, never a country branch in code — b91 "derive, don't enumerate"):
--   1 · two destinations: AU (Australia) · AE (United Arab Emirates). The IN row is renamed 'India' — "Domestic" is relative to the shop.
--   2 · exim-policy (India's IEC / DGFT export rules) applied to EVERY export (b91 {"cross_border":true}): an Australian exporter was told
--       to hold an Indian IEC. It now applies only from India; Australia and the UAE get their own export-declaration standards.
--   3 · each destination's first import rules, guidance worded "confirm with <authority>" — the runner had no web access, so the
--       authority named is the one to confirm with, never a claim that the list is complete (CO0: marked ◐ for a person to confirm).

BEGIN;

-- 1 · destinations
INSERT INTO jurisdiction (dest_key, name, display_order, domestic) VALUES
 ('AU', 'Australia', 5, false),
 ('AE', 'United Arab Emirates', 6, false)
ON CONFLICT (dest_key) DO NOTHING;
UPDATE jurisdiction SET name = 'India' WHERE dest_key = 'IN';

-- 2 · the standards (facet is NOT 'trade': workpattern.resolveStandards stamps every 'trade' facet onto every chit)
INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('au-export-declaration', 'v1', 'Australian export declaration (ABF)', 'export-au', '{"required":["export_declaration_au"],"scope":"chit"}'::jsonb),
 ('ae-export-declaration', 'v1', 'UAE export declaration (customs)',   'export-ae', '{"required":["exporter_code_ae","export_declaration_ae"],"scope":"entity"}'::jsonb),
 ('aicis',                 'v1', 'AICIS — Australian industrial chemicals registration', 'chemical-au', '{"required":["aicis_registration"],"scope":"entity"}'::jsonb),
 ('rcm',                   'v1', 'RCM — Australian electrical compliance mark', 'conformity-au', '{"required":["rcm_registration"],"scope":"entity"}'::jsonb),
 ('ecas',                  'v1', 'ECAS — Emirates conformity certificate', 'conformity-ae', '{"required":["ecas_certificate"],"scope":"entity"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('au-export-declaration', 'export_declaration_au', 'Export Declaration Number (EDN)', 'Goods leaving Australia above the reporting threshold are declared to the Australian Border Force.', 'Customs Act 1901', 'document', 'chit', 'per-order', '{}'::jsonb, 1),
 ('ae-export-declaration', 'exporter_code_ae', 'Exporter code (customs client code)', 'Your registration with the emirate''s customs as an exporter.', 'GCC Common Customs Law', 'document', 'entity', 'once', '{}'::jsonb, 1),
 ('ae-export-declaration', 'export_declaration_ae', 'Export declaration', 'Each shipment leaving the UAE is declared to customs.', 'GCC Common Customs Law', 'document', 'chit', 'per-order', '{}'::jsonb, 2),
 ('aicis', 'aicis_registration', 'AICIS registration', 'A business importing industrial chemicals into Australia is registered with AICIS.', 'IChA 2019', 'document', 'entity', 'annual', '{}'::jsonb, 1),
 ('rcm', 'rcm_registration', 'RCM supplier registration', 'In-scope electrical goods sold in Australia carry the RCM; the responsible supplier is registered.', 'AS/NZS 4417', 'document', 'entity', 'once', '{}'::jsonb, 1),
 ('ecas', 'ecas_certificate', 'ECAS conformity certificate', 'Regulated products sold in the UAE hold a conformity certificate from the Ministry of Industry (MoIAT).', 'ECAS', 'document', 'entity', 'annual', '{}'::jsonb, 1)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

-- 3 · when each applies (b91 applicability) + how to get it
UPDATE standard_source SET applicability = '{"origin":["IN"],"cross_border":true}'::jsonb WHERE standard_key = 'exim-policy';
UPDATE standard_source SET applicability = '{"origin":["AU"],"cross_border":true}'::jsonb,
  guidance = 'Lodge an export declaration with the Australian Border Force for goods above the reporting threshold — confirm with the ABF.' WHERE standard_key = 'au-export-declaration';
UPDATE standard_source SET applicability = '{"origin":["AE"],"cross_border":true}'::jsonb,
  guidance = 'Register as an exporter with your emirate''s customs and declare each shipment — confirm with the customs office.' WHERE standard_key = 'ae-export-declaration';
UPDATE standard_source SET applicability = '{"destination":["AU"],"categories":["chemical"]}'::jsonb,
  guidance = 'The Australian importer registers with AICIS before industrial chemicals arrive — confirm with AICIS.' WHERE standard_key = 'aicis';
UPDATE standard_source SET applicability = '{"destination":["AU"],"categories":["electronic"]}'::jsonb,
  guidance = 'In-scope electrical goods carry the RCM; the Australian supplier registers — confirm with the state electrical regulator.' WHERE standard_key = 'rcm';
UPDATE standard_source SET applicability = '{"destination":["AE"],"categories":["electronic","automotive","chemical"]}'::jsonb,
  guidance = 'Regulated products need an ECAS certificate before sale in the UAE — confirm the product is in scope with MoIAT.' WHERE standard_key = 'ecas';

-- PROOFS
DO $$
DECLARE n int; x jsonb;
BEGIN
  SELECT count(*) INTO n FROM jurisdiction WHERE dest_key IN ('AU', 'AE');
  IF n < 2 THEN RAISE EXCEPTION 'b538 did not take — % of 2 lanes (AU, AE) present.', n; END IF;
  SELECT applicability INTO x FROM standard_source WHERE standard_key = 'exim-policy' LIMIT 1;
  IF x IS NOT NULL AND NOT (x -> 'origin') ? 'IN' THEN RAISE EXCEPTION 'b538: exim-policy still applies to every export (%).', x; END IF;
  SELECT count(*) INTO n FROM standard_source WHERE standard_key IN ('au-export-declaration','ae-export-declaration','aicis','rcm','ecas') AND applicability <> '{}'::jsonb;
  IF n < 5 THEN RAISE EXCEPTION 'b538: % of 5 AU/AE standards carry their applicability.', n; END IF;
  RAISE NOTICE 'b538: AU and AE lanes present; exim-policy from India only; 5 AU/AE standards with applicability and guidance.';
END $$;

COMMIT;
