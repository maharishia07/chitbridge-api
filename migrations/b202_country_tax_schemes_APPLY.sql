-- b202 APPLY — the tax schemes of the other seeded countries, on the regional layer (BACKLOG "tax for other countries").
--
-- ⚠️ RUN b201 FIRST (it seeded India). This is the same shape for the other seeded regions. Either RLS mode.
-- ⚠️ ADDITIVE AND IDEMPOTENT: merges a `tax` block into each region's jurisdiction jsonb; re-running writes the same block.
-- ⚠️ IT COMMITS. The result set at the end is a verification read.
--
-- WHAT IS SEEDED, AND WHAT IS NOT — Athi, 2026-09-04: "can we add other countries too?"
--   DE  VAT (USt)   19 / 7               FR  TVA   20 / 10 / 5.5 / 2.1      ES  IVA  21 / 10 / 4
--   JP  consumption tax 10 / 8           CN  VAT   13 / 9 / 6                MX  IVA  16 / 0
--   US  NONE on purpose — sales tax is set by thousands of local jurisdictions; it needs a provider (Avalara/TaxJar)
--       behind the seam, never a table.   EU  NONE — there is no EU-wide rate; a seller sits in one member state.
--   HI · TN — Indian sub-regions: inherit India's GST in code (lib/tax-governance), nothing seeded.
-- Rates are DATA a person read and applied here; lib/tax.js ships none. Ids are <country>-<scheme>-<rate>.
--
-- Reversible: UPDATE region_layer SET jurisdiction = jurisdiction - 'tax' WHERE region_code IN ('DE','FR','ES','JP','CN','MX');

BEGIN;

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','BZSt','since','2007-01-01','name','Umsatzsteuer',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','DE-VAT-19','name','VAT 19% (standard)','rate',19,'effective_from','2007-01-01'),
    jsonb_build_object('id','DE-VAT-7', 'name','VAT 7% (reduced)', 'rate',7, 'effective_from','2007-01-01'),
    jsonb_build_object('id','DE-VAT-0', 'name','VAT 0% (exempt / zero-rated)','rate',0,'effective_from','2007-01-01'))))
 WHERE region_code = 'DE';

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','DGFiP','since','2014-01-01','name','TVA',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','FR-VAT-20', 'name','TVA 20% (normal)','rate',20,'effective_from','2014-01-01'),
    jsonb_build_object('id','FR-VAT-10', 'name','TVA 10% (intermédiaire)','rate',10,'effective_from','2014-01-01'),
    jsonb_build_object('id','FR-VAT-5.5','name','TVA 5.5% (réduit)','rate',5.5,'effective_from','2014-01-01'),
    jsonb_build_object('id','FR-VAT-2.1','name','TVA 2.1% (particulier)','rate',2.1,'effective_from','2014-01-01'),
    jsonb_build_object('id','FR-VAT-0',  'name','TVA 0% (exonéré)','rate',0,'effective_from','2014-01-01'))))
 WHERE region_code = 'FR';

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','AEAT','since','2012-09-01','name','IVA',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','ES-VAT-21','name','IVA 21% (general)','rate',21,'effective_from','2012-09-01'),
    jsonb_build_object('id','ES-VAT-10','name','IVA 10% (reducido)','rate',10,'effective_from','2012-09-01'),
    jsonb_build_object('id','ES-VAT-4', 'name','IVA 4% (superreducido)','rate',4,'effective_from','2012-09-01'),
    jsonb_build_object('id','ES-VAT-0', 'name','IVA 0% (exento)','rate',0,'effective_from','2012-09-01'))))
 WHERE region_code = 'ES';

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','NTA','since','2019-10-01','name','Consumption tax',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','JP-VAT-10','name','Consumption tax 10% (standard)','rate',10,'effective_from','2019-10-01'),
    jsonb_build_object('id','JP-VAT-8', 'name','Consumption tax 8% (food, newspapers)','rate',8,'effective_from','2019-10-01'))))
 WHERE region_code = 'JP';

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','STA','since','2019-04-01','name','增值税',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','CN-VAT-13','name','VAT 13% (goods)','rate',13,'effective_from','2019-04-01'),
    jsonb_build_object('id','CN-VAT-9', 'name','VAT 9% (transport, construction, agriculture)','rate',9,'effective_from','2019-04-01'),
    jsonb_build_object('id','CN-VAT-6', 'name','VAT 6% (services)','rate',6,'effective_from','2019-04-01'),
    jsonb_build_object('id','CN-VAT-0', 'name','VAT 0% (export)','rate',0,'effective_from','2019-04-01'))))
 WHERE region_code = 'CN';

UPDATE region_layer SET jurisdiction = COALESCE(jurisdiction,'{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
  'scheme','VAT','authority','SAT','since','2010-01-01','name','IVA',
  'slabs', jsonb_build_array(
    jsonb_build_object('id','MX-VAT-16','name','IVA 16% (general)','rate',16,'effective_from','2010-01-01'),
    jsonb_build_object('id','MX-VAT-0', 'name','IVA 0% (tasa cero)','rate',0,'effective_from','2010-01-01'))))
 WHERE region_code = 'MX';

COMMIT;

-- VERIFICATION, after the commit. Expect six DONE rows + IN from b201; US and EU stay tax-less on purpose; HI and TN inherit IN in code.
-- Athi ran this 2026-09-05: CN 4 · DE 3 · ES 4 · FR 5 · IN 5 · JP 2 · MX 2 — DONE.
SELECT region_code,
       jurisdiction->'tax'->>'scheme'                                            AS scheme,
       jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs','[]'::jsonb))    AS slabs,
       CASE WHEN region_code IN ('US','EU') THEN 'NONE ON PURPOSE'
            WHEN region_code IN ('HI','TN') THEN 'INHERITS IN (code)'
            WHEN jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs','[]'::jsonb)) > 0 THEN 'DONE'
            ELSE 'NOT APPLIED' END                                              AS verdict
  FROM region_layer
 ORDER BY region_code;
