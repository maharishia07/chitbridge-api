-- b266: SAVED COMBO/MODIFIER TEMPLATES — a named, reusable group set, independent of any one product.
--
-- [OFFR-06] Athi, testing the Modifier Lab: "the example shown is very pathetic... what i want is something
-- similar to the combo offer in a popup window with possibly combination, and also with save as option, if
-- we are doing save as feature then we should be having a mechanism of open the same again."
--
-- This is the decision BACKLOG.md logged as deferred under [OFFR-03] ("a combo as a standalone record
-- independent of any one product... needs a real data-model decision") — resolved here, minimally: a combo
-- or modifier group SET a merchant builds once, names, and applies to any product later, rather than
-- retyping "Extra toppings / Extra cheese +₹20" from the one hardcoded example every time.
--
-- Deliberately NOT folded into item_data (per-product, not a library) or entity_profile/entity_profile.vault
-- (one fixed blob per entity, not a list) — see this session's research: neither has list semantics (many
-- named records per entity, add/rename/delete/browse). A small, dedicated, RLS'd table, patterned exactly on
-- entity_profile (b96): one row per template, `definition` holding the SAME shape CBVariant already owns
-- and validates (`[{name, required, max, options:[{name, price}]}]` — variant.js's own contract, "OUTPUT is
-- always this exactly"), so a saved template is never a second, competing shape for what a modifier group is.

CREATE TABLE IF NOT EXISTS combo_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL,
  name        text NOT NULL,
  definition  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- CBVariant's own group-array shape; never a second schema
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS combo_templates_entity_idx ON combo_templates (entity_id, created_at DESC);

ALTER TABLE combo_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_entity ON combo_templates
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON combo_templates TO cb_app;
