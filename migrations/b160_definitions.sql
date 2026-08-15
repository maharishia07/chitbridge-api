-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b160 — DEFINITIONS: an entity's own named things, and the versions that make freezing honest.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-15: *"create another menu type next to catalogue … where the same can be called against
-- catalogue."*  And, 2026-08-16, the decision this table is shaped by: **"frozen by value when stamped"**.
--
-- ── ⭐ THE THREE THINGS THIS KEEPS APART ────────────────────────────────────────────────────────────────────────
--   KIND        'a pack model exists'          CODE — a registry — changes in a release
--   DEFINITION  'Carton of 6' / 'Diwali 10%'   THIS TABLE — the entity's shelf
--   ADOPTION    'this catalogue uses that'     a reference on the catalogue (NOT built yet)
--
-- ── ⚠️⚠️ WHY THERE ARE TWO TABLES AND NOT ONE ──────────────────────────────────────────────────────────────────
-- Because "frozen by value when stamped" is only true if the value that was frozen still EXISTS to be compared
-- against. If editing a definition overwrote its row, then a chit stamped in March could say "Diwali 10%" and the
-- shelf would say 25%, with nothing anywhere able to show what March actually agreed. The chit would hold a
-- number it could not justify — which is the precise failure the seal exists to prevent, arriving through the
-- back door of a settings screen.
--
-- So: `definition` is the living thing (name, kind, current version pointer), and `definition_version` is the
-- append-only record of what its rules said at each point. An edit writes a NEW version. Nothing is ever
-- overwritten and nothing is ever deleted — retiring sets a flag.
--
-- ⭐ A STAMPED CHIT THEREFORE CARRIES A COPY OF THE RULES **AND** A POINTER TO THE VERSION IT COPIED. The copy is
-- what makes it defensible on its own; the pointer is what makes it auditable against the shelf. Either alone is
-- weaker: a copy with no provenance cannot be traced, and a pointer with no copy is exactly the thing that
-- changes underneath you.
--
-- ── ⚠️ WITH RLS ────────────────────────────────────────────────────────────────────────────────────────────────
-- Both tables are entity-data and are FORCE ROW LEVEL SECURITY, isolated on `app.current_entity` — the same
-- pattern as folder_rule. A definition is as private as the catalogue it will govern. FORCE applies to the table
-- owner too, so a mistake in application code cannot read across entities.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS definition (
  definition_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,
  -- ⚠️ `kind` is a free-text CODE, not an enum, and deliberately: the registry of kinds lives in the front-end
  -- (cart-ui MODELS, offers KINDS, catalogue-model's palette) and gains entries in a release. A Postgres enum
  -- would mean a migration every time a kind is added, and — worse — an OLD row whose kind was later removed
  -- would become unreadable. Text keeps the database honest about what it actually is: a store, not the registry.
  kind           text NOT NULL,          -- 'offer' | 'category' | 'ordermodel' | 'tax' | 'unit' | 'fieldset' | …
  sub_kind       text,                   -- the registry entry within the kind: 'percent_off', 'pack', …
  name           text NOT NULL,          -- what a person calls it: "Carton of 6", "Diwali 10%"
  note           text,
  status         text NOT NULL DEFAULT 'draft',   -- draft | live | retired
  -- ⚠️ NEVER DELETED, ONLY RETIRED. A definition a chit once cited must remain resolvable forever, or the chit's
  -- provenance dead-ends. `status` is how something leaves the shelf.
  current_version int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (entity_id, kind, name)          -- one "Carton of 6" per entity per kind; the name is how people cite it
);

CREATE TABLE IF NOT EXISTS definition_version (
  definition_id  uuid NOT NULL,
  version        int  NOT NULL,
  entity_id      uuid NOT NULL,           -- denormalised so RLS can isolate this table on its own
  -- The rules themselves. jsonb because a kind decides its own shape — an offer carries percent/valid_from/
  -- region, an order model carries step/min/max, a category carries a list of member ids. Enumerating columns
  -- here would be the same mistake the catalogue mapping made: 16 fields in, 3 out.
  rules          jsonb NOT NULL DEFAULT '{}'::jsonb,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  PRIMARY KEY (definition_id, version)
);

CREATE INDEX IF NOT EXISTS definition_entity_idx  ON definition (entity_id, kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS definition_ver_ent_idx ON definition_version (entity_id, definition_id, version DESC);

ALTER TABLE definition         ENABLE ROW LEVEL SECURITY;
ALTER TABLE definition         FORCE  ROW LEVEL SECURITY;
ALTER TABLE definition_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE definition_version FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS definition_isolation ON definition;
CREATE POLICY definition_isolation ON definition
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

DROP POLICY IF EXISTS definition_version_isolation ON definition_version;
CREATE POLICY definition_version_isolation ON definition_version
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON definition         TO cb_app;
-- ⚠️ NO DELETE, NO UPDATE ON definition_version. It is append-only by GRANT, not merely by convention — a
-- convention is a comment somebody will not read at 2am, and the whole freeze guarantee rests on old versions
-- being unchangeable. The application literally cannot rewrite history here.
GRANT SELECT, INSERT ON definition_version TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b160: definition + definition_version added, WITH RLS (FORCE), isolated on app.current_entity.';
  RAISE NOTICE 'b160: definition_version is APPEND-ONLY BY GRANT — no UPDATE, no DELETE. An edit writes a new version.';
  RAISE NOTICE 'b160: nothing reads these yet; the screen is read-only until the routes ship.';
END $$;
