-- b201 APPLY — India's GST slabs on the regional layer, inherited by every entity whose jurisdiction is IN.
--
-- ⚠️ RUN b201_india_gst_governance_DRYRUN.sql FIRST. Either RLS mode.
-- ⚠️ ADDITIVE AND IDEMPOTENT. Merges a `tax` block into region_layer.jurisdiction for IN; every other key of the
--    jurisdiction jsonb is untouched. Re-running writes the same block again. ONLY IN is seeded — other regions get
--    their scheme when someone who knows it writes the migration (see BACKLOG "tax for other countries").
-- ⚠️ IT COMMITS. The result set at the end is a verification read taken AFTER the commit.
--
-- THE RATES ARE DATA, NOT CODE. lib/tax.js ships no rate table on purpose; this is the place a rate lives — put here by
-- a person who read it, changed here by a person who read the notification. Source: CBIC GST rate schedule; the five
-- rate slabs in force since 2017-07-01. Cess-bearing goods (tobacco, aerated drinks, coal, motor cars) carry a
-- compensation cess ON TOP of a slab and are product-specific — they are deliberately NOT modelled as slabs here; a
-- merchant selling them declares a slab of their own with `cess` set.
--
-- Slab ids are <country>-<scheme>-<rate>: stable, human-readable, never a uuid (see lib/tax-governance.js).
--
-- Reversible: UPDATE region_layer SET jurisdiction = jurisdiction - 'tax' WHERE region_code = 'IN';

BEGIN;

UPDATE region_layer
   SET jurisdiction = COALESCE(jurisdiction, '{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object(
         'scheme',    'GST',
         'authority', 'CBIC',
         'since',     '2017-07-01',
         'note',      'Rate slabs under the CGST/SGST/IGST Acts. Same goods, same price: the place of supply alone decides CGST+SGST vs IGST. Cess-bearing goods declare their own slab.',
         'slabs', jsonb_build_array(
           jsonb_build_object('id','IN-GST-0',  'name','GST 0% (nil-rated / exempt)', 'rate',0,  'cess',0, 'effective_from','2017-07-01'),
           jsonb_build_object('id','IN-GST-5',  'name','GST 5%',                      'rate',5,  'cess',0, 'effective_from','2017-07-01'),
           jsonb_build_object('id','IN-GST-12', 'name','GST 12%',                     'rate',12, 'cess',0, 'effective_from','2017-07-01'),
           jsonb_build_object('id','IN-GST-18', 'name','GST 18%',                     'rate',18, 'cess',0, 'effective_from','2017-07-01'),
           jsonb_build_object('id','IN-GST-28', 'name','GST 28%',                     'rate',28, 'cess',0, 'effective_from','2017-07-01')
         )))
 WHERE region_code = 'IN';

COMMIT;

-- VERIFICATION, after the commit. Expect IN · GST · 5 slabs.
SELECT region_code,
       jurisdiction->'tax'->>'scheme'                                             AS scheme,
       jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs', '[]'::jsonb))   AS slabs,
       CASE WHEN jsonb_array_length(COALESCE(jurisdiction->'tax'->'slabs', '[]'::jsonb)) = 5 THEN 'DONE'
            ELSE 'NOT APPLIED - region IN missing? run b81 first' END              AS verdict
  FROM region_layer
 WHERE region_code = 'IN';
