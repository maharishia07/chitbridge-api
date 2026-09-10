-- b216 · WHAT A SUPPLIER SELLS YOU — goods to resell, or things the shop uses
-- ============================================================================================================
-- Athi, 2026-09-10: "can we designate the supplier list — he is for my own use and he is my real supplier?
-- There itself the demarcation happens."
--
-- ⭐⭐⭐ THAT IS A BETTER ANSWER THAN ASKING PER LINE, and it is better because it matches how a shop actually
-- works. Your stationery supplier is NEVER selling you things to resell. Your FMCG distributor always is. The
-- fact is stable, it belongs to the relationship, and asking it once means never asking it again on a forty-line
-- delivery — which is the difference between a question a shopkeeper answers and one they click through.
--
--   resale   the ordinary trade supplier. Their goods may be offered to the catalogue and sold.
--   own_use  the sundry supplier — packing material, cleaning things, stationery, a new kettle.
--            Their goods are a PURCHASE the shop consumes. They never reach a catalogue and never reach a
--            storefront, however tempting the form makes it.
--
-- ⚠️ IT IS A DEFAULT, NOT A LAW. A line can still be marked the other way at goods-in, because the FMCG
-- distributor who sells you biscuits also sells you the shelf labels. The supplier answers for the 95%; the line
-- answers for the exception. A system that allowed only one of those would be wrong twice.
--
-- ⚠️ AND IT IS THE SEAM THE BOOKS NEED. In Tally's terms a resale purchase lands in Purchases and carries stock;
-- a sundry one is an expense. Getting that from a supplier flag rather than from somebody's memory is what makes
-- the connector able to post it without asking.
--
-- ⭐ 'resale' IS THE DEFAULT because it is what a supplier list is mostly for, and because the failure directions
-- are not equal: a sundry purchase wrongly offered to the catalogue is a question on a screen, while a resale
-- purchase wrongly expensed is stock that never existed.
--
-- ⚠️ RUN IN THE SUPABASE SQL EDITOR (cb_app owns nothing and cannot ALTER). Step 1 only looks. Safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST.
SELECT count(*) FILTER (WHERE column_name = 'supply_kind') AS already_done,
       count(*) AS columns_now
FROM information_schema.columns WHERE table_name = 'supplier_list';

-- ── 2 · THE COLUMN.
BEGIN;

ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS supply_kind text NOT NULL DEFAULT 'resale';

-- ⚠️ the constraint is added separately and guarded, because ADD CONSTRAINT has no IF NOT EXISTS and a re-run
--    would otherwise fail on the second pass — which is how a "safe to re-run" file stops being one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'supplier_list'::regclass AND conname = 'supplier_list_supply_kind_chk') THEN
    ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_supply_kind_chk
      CHECK (supply_kind IN ('resale', 'own_use'));
  END IF;
  RAISE NOTICE 'b216: every supplier is now declared resale or own_use. Existing suppliers default to resale.';
END $$;

COMMIT;

-- ── 3 · PROVE IT.
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'supplier_list' AND column_name = 'supply_kind';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'supplier_list'::regclass AND conname = 'supplier_list_supply_kind_chk';

-- ── AFTERWARDS: goods-in reads the supplier's kind and only a 'resale' delivery offers new products to the
--    catalogue. A sundry delivery is recorded, costed and counted — and never asks whether to put floor cleaner
--    on the storefront.
