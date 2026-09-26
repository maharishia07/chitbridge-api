-- b267: a saved combo carries its OWN price, and (once pushed) the real product it created or updates.
--
-- ✅ CONFIRMED APPLIED — checked live 2026-09-26, read-only: combo_templates carries both price (numeric) and
-- product_item_id (uuid).
--
-- [OFFR-08] Athi, testing the saved-combo library: "the saved combo should be able to push to product list
-- as a new product... if it is an existing combo in the product list it has to update only." Without a link
-- back to the product it created, every push would be a NEW product — there would be no way to tell "this
-- template already has a product" from "this is the first time," so the second push of the same combo would
-- duplicate it rather than update it.
--
-- `price` lets a combo be previewed and pushed with a real price before it is ever linked to a product —
-- b266 only ever stored the group definition, never what the combo itself costs.
-- `product_item_id` is set the first time a template is pushed (POST /api/products), and read on every push
-- after that to decide create vs. update. Deliberately NOT a foreign key: catalogue_items has no unique
-- constraint superset this could reference cleanly across entities, and the real ownership guarantee is
-- already RLS on both tables under the same entity_id — a dangling id here (the product was deleted some
-- other way) is treated as "not linked yet" by the route, not as an error.

ALTER TABLE combo_templates ADD COLUMN IF NOT EXISTS price numeric(18,2);
ALTER TABLE combo_templates ADD COLUMN IF NOT EXISTS product_item_id uuid;
CREATE INDEX IF NOT EXISTS combo_templates_product_idx ON combo_templates (entity_id, product_item_id) WHERE product_item_id IS NOT NULL;
