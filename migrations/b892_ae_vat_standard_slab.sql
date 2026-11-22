-- b892_ae_vat_standard_slab.sql — WALK I I-F-06: a VAT-registered UAE shop started with NO slab, so every item billed at 0% until someone created one.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it. Additive and safe to repeat (ON CONFLICT merge; re-running writes the same block).
-- WHAT. Puts the UAE's ONE standard rate on the regional layer (region_layer.jurisdiction.tax), the same place IN's slabs live (b201), so every AE entity inherits it as a read-only
--    governed slab "AE-VAT-5" (lib/tax-governance.js). Nothing else of the jurisdiction jsonb is touched. Only the standard rate is seeded: a zero-rated or exempt supply is the
--    shop's own declaration (the pack's rates are [0, 5]); this file does not guess which goods those are.
-- SOURCE. Federal Decree-Law No. 8 of 2017 on Value Added Tax, Art. 3: "a standard rate of 5% Tax shall be imposed on any supply or Import" (the pack's own cite, public/engine/tax.js
--    AE pack standard_rate 5). In force from 2018-01-01 (the FTA's start date for VAT). Article text not re-read from tax.gov.ae by this change: cb-country to confirm in the next watch.
-- RLS: region_layer has no RLS (b81). ROLL BACK:  UPDATE region_layer SET jurisdiction = jurisdiction - 'tax' WHERE region_code = 'AE';
INSERT INTO region_layer (region_code, currency, units, language, jurisdiction)
VALUES ('AE', 'AED', 'litre', 'en', $json${"tax":{"scheme":"VAT","authority":"FTA","since":"2018-01-01","note":"Federal Decree-Law No. 8 of 2017 Art. 3: standard rate 5%. Zero-rated and exempt supplies are declared by the shop.","slabs":[{"id":"AE-VAT-5","name":"VAT 5%","rate":5,"cess":0,"effective_from":"2018-01-01"}]}}$json$::jsonb)
ON CONFLICT (region_code) DO UPDATE
  SET jurisdiction = COALESCE(region_layer.jurisdiction, '{}'::jsonb) || (EXCLUDED.jurisdiction);

SELECT region_code, jurisdiction->'tax'->>'scheme' AS scheme, jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs','[]'::jsonb)) AS slabs FROM region_layer WHERE region_code = 'AE';
