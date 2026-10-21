-- b217 · THE SUPPLIES LIST — what a shop buys to USE, kept apart from what it sells
-- ============================================================================================================
-- Athi, 2026-09-10: "i would purchase what I intend to sell, rest i may use it, so all cannot go into catalogue"
-- and then "so we may have to have screen to add sundry items in case if it is not coming through the channel".
--
-- ── ⭐⭐⭐ WHY A SEPARATE TABLE AND NOT A FLAG ON catalogue_items ───────────────────────────────────────────────
-- A flag would be less code. It would also mean every storefront query, every counter query and every offer
-- resolver needs the filter, for ever — and ONE missed WHERE puts floor cleaner on a customer-facing shop front.
-- A separate table cannot leak by omission. That is the same trade the vertical gate made: refuse by construction
-- rather than rely on everybody remembering.
--
-- ⚠️ AND THESE ARE NOT PRODUCTS. They have no price, no offers, no tax slab for sale, no images, no storefront
-- visibility — because none of that means anything for a bag of cleaning cloths. Giving them a `price` column
-- would be an invitation nobody should accept.
--
-- ── ⭐⭐ STOCKED OR EXPENSED — the materiality judgement, made by the shop ─────────────────────────────────────
-- Athi asked whether some goods "can be ignored". For ACCOUNTING, no: money left the business, and there may be
-- input credit to claim. What can be skipped is COUNTING them.
--   keep_stock = false   expensed on receipt. Recorded, costed, ITC claimable, no balance, never counted.
--                        Right for a bag of rubber bands. This is the DEFAULT, because tracking most sundries
--                        costs more than the sundries.
--   keep_stock = true    a real balance you can count and value. Right for packaging bought by the thousand,
--                        where knowing you have 4,000 covers left actually matters.
-- ⚠️ Ind AS 2 counts supplies to be consumed as INVENTORY, so expensing the small ones is a practical judgement
-- the shop makes under materiality — not a rule we get to make for them, which is why it is a column.
--
-- ── ⚠️ THE SUPPLIER IS FREE TEXT, ON PURPOSE ─────────────────────────────────────────────────────────────────
-- Most sundry buying is a cash purchase from the hardware shop on the corner, which is never going to be a CB
-- entity. Requiring a relationship would make the feature cover only the minority it was not built for.
--
-- ⭐ WITH RLS — entity-isolated, ENABLE + FORCE, like every other entity-data table.
-- ⚠️ RUN IN THE SUPABASE SQL EDITOR (cb_app owns nothing and cannot CREATE). Step 1 only looks. Safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Expect 0 the first time.
SELECT count(*) AS supply_item_exists FROM information_schema.tables WHERE table_name = 'supply_item';

-- ── 2 · THE LIST.
BEGIN;

CREATE TABLE IF NOT EXISTS supply_item (
  supply_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,

  name           text NOT NULL,
  unit           text,
  sku            text,                       -- the shop's own, if it wants one; most will not

  -- ⭐ the materiality call, per item. false = expensed on receipt and never counted.
  keep_stock     boolean NOT NULL DEFAULT false,

  -- what it last cost and who it last came from — enough to recognise a repeat purchase, and no more.
  -- ⚠️ last_from is FREE TEXT: the hardware shop on the corner is not an entity and never will be.
  last_cost      numeric(18,4),
  last_from      text,
  last_at        timestamptz,

  note           text,
  -- ⚠️ RETIRED, NEVER DELETED — a supply that was bought for two years is part of what the shop spent, and a
  -- purchase history pointing at a row that no longer exists is worse than a tidy list.
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,

  CONSTRAINT supply_item_name_chk CHECK (length(btrim(name)) > 0)
);

-- ⚠️ ONE ROW PER NAME PER SHOP, case-insensitively — "Floor cleaner" and "floor cleaner" are the same thing to
--    everyone except a database, and two rows would split a spend figure nobody could then add up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_item_name
  ON supply_item (entity_id, lower(btrim(name))) WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supply_item_shop ON supply_item (entity_id, name);

-- ── 3 · ⭐⭐ ONE STOCK LEDGER, TWO KINDS OF THING.
-- Supplies that are kept in stock move through the SAME movement log as products, because a shop counts both and
-- Ind AS 2 calls both inventory. What differs is only which list the id points into.
-- ⚠️ 'catalogue' is the default so every movement written before today keeps meaning exactly what it meant.
ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS item_kind text NOT NULL DEFAULT 'catalogue';
ALTER TABLE stock_balance  ADD COLUMN IF NOT EXISTS item_kind text NOT NULL DEFAULT 'catalogue';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'stock_movement'::regclass AND conname = 'stock_movement_item_kind_chk') THEN
    ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_item_kind_chk
      CHECK (item_kind IN ('catalogue', 'supply'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'stock_balance'::regclass AND conname = 'stock_balance_item_kind_chk') THEN
    ALTER TABLE stock_balance ADD CONSTRAINT stock_balance_item_kind_chk
      CHECK (item_kind IN ('catalogue', 'supply'));
  END IF;
END $$;

-- ⭐ 'issued' — a supply LEAVING to be used. It is not a sale and it is not shrinkage; it is the thing that turns
--    a sundry purchase into a spend figure a shopkeeper can read ("₹2,300 of packaging used in July").
ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS stock_movement_reason_chk;
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_reason_chk CHECK (reason IN (
  'opening','purchase','sale_return','purchase_return','sale',
  'damage','expiry','theft','sample','count_adjust','writedown','issued'));

ALTER TABLE supply_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_item FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON supply_item;
CREATE POLICY rls_entity ON supply_item
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ⚠️ A SUPPLY IS EDITABLE, unlike a movement. It is a description of a thing, not a claim about an event — the
--    shop renames "cleaner" to "Floor cleaner 5L" and nothing about history changes.
GRANT SELECT, INSERT, UPDATE ON supply_item TO cb_app;
REVOKE DELETE ON supply_item FROM cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b217: supplies live in their own list and CANNOT reach a storefront by a missed WHERE clause.';
  RAISE NOTICE 'b217: keep_stock=false (the default) means expensed on receipt — recorded, costed, never counted.';
END $$;

COMMIT;

-- ── 4 · PROVE IT.
SELECT c.relname AS t, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS pol
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'supply_item';

SELECT table_name, string_agg(privilege_type, '+' ORDER BY privilege_type) AS cb_app_may
FROM information_schema.role_table_grants
WHERE grantee = 'cb_app' AND table_name = 'supply_item' GROUP BY table_name;

SELECT pg_get_constraintdef(oid) AS reason_now
FROM pg_constraint WHERE conrelid = 'stock_movement'::regclass AND conname = 'stock_movement_reason_chk';

-- ── AFTERWARDS: a sundry supplier's delivery has somewhere real to go, and a purchase from the hardware shop on
--    the corner can be recorded without inventing a relationship with them.
