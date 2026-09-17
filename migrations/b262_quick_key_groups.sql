-- b262: Level 1 (permanent, manager-side) quick-key groups with time windows — quick-keys-design-handoff_2 §1/§5.
--
-- ⚠️⚠️ DRAFT — NOT RUN. Written for Athi to review and run himself in the Supabase editor (standing rule: DDL
-- is his to execute, never the assistant's). Additive only — nothing reads these tables until API code that
-- uses them ships, so running this ahead of that code is safe.
--
-- Athi, 2026-09-18 — the 4 open decisions (handoff §11), answered:
--   1. Hide scope = EVERYWHERE, not per-group (overrides the doc's own §6 rule 6 default) — and symmetric:
--      making an item available again shows it back in every group it belongs to. So counter_hidden_item
--      carries no group_id: one row per (entity, counter, product), not per (entity, counter, group, product).
--   2. Reset timing ("shift close or day end?") = A SETTING, not a fixed rule. No new table for this — it's
--      one new key in lib/policy.js's FLAGS whitelist (identities.policy_flags), same pattern as trade_side/
--      books_at. Not included here since it needs no DDL; see the code note sent alongside this file.
--   3. Supervisor push Level-2 choices to every counter = ASK, DON'T AUTO-PUSH. When a counter marks an item
--      sold out, prompt for which of the shop's other counters (GET /api/counters) should get it too, and only
--      write counter_hidden_item rows for the ones ticked. No live sync required — each counter picks the row
--      up on its own next refresh, same as any other state. API/UI behaviour to build alongside Level 1; the
--      table below already supports it as drafted (one row per counter already).
--   4. Photos on the compact 15" terminal = off by default, configurable (doc's own default, confirmed).
--
-- ⚠️ SCHEMA TRANSLATED, NOT COPIED LITERALLY: the handoff's data model (§5) names `outlet_id` and `device_id`
-- — neither exists anywhere in this codebase. Checked routes/counters.js (2026-09-17): counters live inside
-- identities.policy_flags.counters, keyed by a short id like "C1" ("NO MIGRATION: the register rides
-- identities.policy_flags.counters") — there is no counters table to put a real foreign key on, and a counter
-- is already held by exactly one PC at a time via the till key's jti, making the doc's separate device_id
-- redundant. So here: outlet_id -> entity_id (real FK to identities.identity_id); counter_id -> free text
-- matching the policy_flags.counters key (no FK target exists); device_id dropped everywhere it appeared.
--
-- product_id -> catalogue_items(item_id). ⚠️ CORRECTED 2026-09-18: this first pointed at cb_catalogue_item(id),
-- which is a LEGACY baseline table. The live product table — the one /api/till/stock, /api/till/price and
-- /api/products actually read and write — is catalogue_items (item_id uuid PK, entity_id, item_data jsonb).
--
-- ⚠️ THE HANDOFF'S §4 PHOTO PIPELINE (product_image, 3 generated sizes) IS LARGELY ALREADY BUILT. Found while
-- fixing the FK above: routes/products.js already has a full product-media pipeline (2026-09-05, lib/storage-
-- object, a PRIVATE bucket) — item_data.media = [{id,name,mime,kind,size,at}], item_data.image = the first
-- image's public read URL, upload/stream routes already live. No new product_image TABLE needed here — the
-- real remaining gap for quick-key tiles is just generating 96/192/384 thumbnails from the image that already
-- exists, which is a resize step, not new schema. Dropped from this migration; see BACKLOG.md.

CREATE TABLE IF NOT EXISTS quick_key_group (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES identities(identity_id),
  name              text NOT NULL,
  color             text,
  sort_order        integer NOT NULL DEFAULT 0,
  window_from       time,
  window_to         time,
  suggest_on_start  boolean NOT NULL DEFAULT false,
  is_deleted        boolean NOT NULL DEFAULT false,
  version           integer NOT NULL DEFAULT 1,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS quick_key_group_entity ON quick_key_group (entity_id) WHERE NOT is_deleted;
ALTER TABLE quick_key_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_key_group FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON quick_key_group;
CREATE POLICY rls_entity ON quick_key_group
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON quick_key_group TO cb_app;


CREATE TABLE IF NOT EXISTS quick_key_group_item (
  group_id    uuid NOT NULL REFERENCES quick_key_group(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES identities(identity_id),
  product_id  uuid NOT NULL REFERENCES catalogue_items(item_id),
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, product_id)
);
CREATE INDEX IF NOT EXISTS quick_key_group_item_entity ON quick_key_group_item (entity_id);
ALTER TABLE quick_key_group_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_key_group_item FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON quick_key_group_item;
CREATE POLICY rls_entity ON quick_key_group_item
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON quick_key_group_item TO cb_app;


-- product_image: DROPPED from this migration (see the note near the top — routes/products.js already has a
-- full photo pipeline via item_data.media/item_data.image + lib/storage-object). Nothing to create here.


-- counter_quick_key_state — Level 2: which groups a counter is showing right now. device_id dropped (header
-- note); counter_id is free text (no counters table to key against).
CREATE TABLE IF NOT EXISTS counter_quick_key_state (
  entity_id         uuid NOT NULL REFERENCES identities(identity_id),
  counter_id        text NOT NULL,
  business_date     date NOT NULL,
  shift_id          text,
  active_group_ids  uuid[] NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, counter_id, business_date)
);
ALTER TABLE counter_quick_key_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE counter_quick_key_state FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON counter_quick_key_state;
CREATE POLICY rls_entity ON counter_quick_key_state
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON counter_quick_key_state TO cb_app;


-- counter_hidden_item — Level 2 sold-out/hidden state. Decision 1 (2026-09-18): hidden EVERYWHERE the item
-- appears, not per group — so no group_id column here; one row per (entity, counter, product). Deleting the
-- row means available again, which then shows in every group the item belongs to automatically — no per-group
-- bookkeeping needed to make the two sides (hide / un-hide) match.
CREATE TABLE IF NOT EXISTS counter_hidden_item (
  entity_id   uuid NOT NULL REFERENCES identities(identity_id),
  counter_id  text NOT NULL,
  shift_id    text,
  product_id  uuid NOT NULL REFERENCES catalogue_items(item_id) ON DELETE CASCADE,
  hidden_at   timestamptz NOT NULL DEFAULT now(),
  hidden_by   uuid,
  PRIMARY KEY (entity_id, counter_id, product_id)
);
ALTER TABLE counter_hidden_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE counter_hidden_item FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON counter_hidden_item;
CREATE POLICY rls_entity ON counter_hidden_item
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON counter_hidden_item TO cb_app;


-- device_screen_config — how each counter looks (theme/layout/tile/picker/density/photos). counter_id NULL is
-- the entity-wide default a new counter starts from; device_id dropped (header note — nothing below "counter"
-- has an identity of its own). Resolution order: this counter's row, else the entity's counter_id-IS-NULL row.
CREATE TABLE IF NOT EXISTS device_screen_config (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES identities(identity_id),
  counter_id  text,
  config      jsonb NOT NULL DEFAULT '{}',
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS device_screen_config_default ON device_screen_config (entity_id) WHERE counter_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS device_screen_config_counter ON device_screen_config (entity_id, counter_id) WHERE counter_id IS NOT NULL;
ALTER TABLE device_screen_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_screen_config FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON device_screen_config;
CREATE POLICY rls_entity ON device_screen_config
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON device_screen_config TO cb_app;


-- quick_key_audit — who changed what in Level 1 groups, for back-office Maintenance (handoff §6 rules 1 & 7).
CREATE TABLE IF NOT EXISTS quick_key_audit (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES identities(identity_id),
  user_id     uuid,
  at          timestamptz NOT NULL DEFAULT now(),
  action      text NOT NULL CHECK (action IN ('create','rename','delete','add','remove','move','photo')),
  before_json jsonb,
  after_json  jsonb,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS quick_key_audit_entity ON quick_key_audit (entity_id, at DESC);
ALTER TABLE quick_key_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_key_audit FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON quick_key_audit;
CREATE POLICY rls_entity ON quick_key_audit
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON quick_key_audit TO cb_app;
