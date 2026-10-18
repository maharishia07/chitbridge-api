-- b297_memberships.sql — the per-shop MEMBERSHIPS table ("what belongs together"), and its first user: a lead's stage (CB CRM, round L1).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — it creates tables, policies and grants, which cb_app cannot).
--    Written offline, read, never executed. Safe to re-run. Until it runs, the CRM answers "Lead stages arrive after the next update"
--    (503 { code: 'LEADS_NOT_MIGRATED' } on a write, `leads_migrated: false` on the Leads list) — never a 500, no second path.
--
-- DECISIONS 2026-10-10 "Groupings live in ONE per-entity MEMBERSHIPS table": entity · item type · item id · kind · group · when.
--   · APPEND-ONLY — a move is a new row, the latest row of (entity, item, kind) wins; the old rows are the history (a funnel is a query).
--   · RLS on entity_id, never shared — a shop's grouping is its own notebook.
--   · `kind` is a DICTIONARY (membership_kind), so a new grouping is a row, not a column: day-batch (M133) and later kinds reuse the table.
--
-- ⭐ ALSO HERE: customer_list.added_via gains 'lead' (a lead IS a party — the CRM list hides added_via='lead' with no trade behind a
--    Leads tab). The CHECK is widened, nothing else (b227 did the same for 'system').
-- ⚠️ Foreign keys with ALTER TABLE, never inside CREATE TABLE IF NOT EXISTS (tests/migration-lint.test.cjs). Policies NULLIF-guarded.

BEGIN;

-- ── membership_kind · the dictionary of groupings (platform-wide, read-only to the app) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_kind (
  kind        text PRIMARY KEY,
  item_type   text NOT NULL,            -- what may be grouped: party · chit · ...
  label       text NOT NULL,            -- shopkeeper words
  one_group   boolean NOT NULL DEFAULT true,   -- true: an item is in ONE group of this kind at a time (the latest row wins)
  groups      text[] NOT NULL           -- the allowed group names
);
-- reference data, like country_rule: no RLS (nobody's private data); the app may read it, never write it
REVOKE INSERT, UPDATE, DELETE ON membership_kind FROM cb_app;
GRANT SELECT ON membership_kind TO cb_app;
INSERT INTO membership_kind (kind, item_type, label, one_group, groups)
VALUES ('lead_stage', 'party', 'Lead stage', true, ARRAY['lead', 'demo', 'trial', 'parked', 'lost'])
ON CONFLICT (kind) DO UPDATE SET item_type = EXCLUDED.item_type, label = EXCLUDED.label, one_group = EXCLUDED.one_group, groups = EXCLUDED.groups;

-- ── memberships · one row per move, append-only ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  membership_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,                   -- the shop
  item_type      text NOT NULL,                   -- party · chit · ...
  item_id        uuid NOT NULL,                   -- the party's identity id (or the item's own id)
  kind           text NOT NULL,                   -- membership_kind.kind
  grp            text NOT NULL,                   -- the group (for lead_stage: the stage)
  at             timestamptz NOT NULL DEFAULT now(),
  by_user_id     uuid
);
CREATE INDEX IF NOT EXISTS memberships_item_idx ON memberships (entity_id, kind, item_id, at DESC);
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON memberships;
CREATE POLICY rls_entity ON memberships
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
-- append-only: added to and read, never rewritten or deleted (a wrong move is answered by a new one)
REVOKE UPDATE, DELETE ON memberships FROM cb_app;
GRANT SELECT, INSERT ON memberships TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_kind_fkey') THEN
    ALTER TABLE memberships ADD CONSTRAINT memberships_kind_fkey FOREIGN KEY (kind) REFERENCES membership_kind (kind);
  END IF;
END $fk$;

-- ── a lead is a party: customer_list.added_via gains 'lead' ───────────────────────────────────────────────────────────────────
ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_added_via_check;
ALTER TABLE customer_list ADD  CONSTRAINT customer_list_added_via_check
  CHECK (added_via::text = ANY (ARRAY['transaction','manual','import','catalogue','system','lead']::text[]));

COMMIT;

-- ── WHAT YOU SHOULD SEE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
SELECT kind, item_type, groups FROM membership_kind;
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'memberships';
