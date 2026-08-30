-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b186 (APPLY) — finish what b185 could not run. DO NOT RE-RUN b185: it cannot be run whole.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ RUN b186_register_seed_dryrun.sql FIRST. If its `lives_in_schema` column shows anything other than
-- `public` for any row, STOP and say so — this script assumes one schema and the dry run is what proves it.
--
-- Safe to run more than once, and safe whichever state the database is in: every step is guarded, so a piece
-- b185 DID manage to run is left exactly alone.
--
--   1. the registry table          — created only if it does not already exist ANYWHERE on the search path
--   2. the twelve rows             — ON CONFLICT DO NOTHING, so an edited label or an inactive kind survives
--   3. the SELECT grant            — the privilege that decides whether the app can see the table at all
--   4. register_subject's foreign key — the one CREATE TABLE IF NOT EXISTS silently skipped
--
-- ⚠️ NO UPDATE, NO DELETE. Nothing that exists is changed.
-- ⚠️ WITHOUT RLS, deliberately: register_attachable is a platform registry, the same class as `constitution`
-- and `capability` — written by migrations, read by everyone, holding no entity's data.

-- ── 1 · the registry table ─────────────────────────────────────────────────────────────────────────────────────
-- ⭐ to_regclass(), not CREATE TABLE IF NOT EXISTS: to_regclass resolves through the search path, so if the
-- table already lives in another schema this finds it instead of quietly creating a SECOND one in public.
DO $b186$
BEGIN
  IF to_regclass('register_attachable') IS NULL THEN
    CREATE TABLE register_attachable (
      type_key   text PRIMARY KEY,
      label      text NOT NULL,
      /* Where the id points, for a reader that wants to follow it. Documentation, not a constraint — the
         register must never take a hard dependency on a table it is only pointing at. */
      points_at  text,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END
$b186$;

-- ── 2 · the twelve rows ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO register_attachable (type_key, label, points_at) VALUES
  ('chit',           'Order',              'chit_header.chit_id'),
  ('line',           'Line item',          'chit_line.line_id'),
  ('campaign',       'Test campaign',      NULL),
  ('release',        'Release',            NULL),
  ('article',        'Article / unit',     NULL),
  ('audit',          'Audit',              NULL),
  ('standard',       'Standard',           'the standards register key'),
  ('catalogue_item', 'Catalogue item',     'catalogue_items.item_id'),
  ('network_node',   'Network node',       'network_design node'),
  ('supplier',       'Supplier',           'identities.identity_id'),
  ('entity',         'The business',       'identities.identity_id'),
  ('other',          'Other',              NULL)
ON CONFLICT (type_key) DO NOTHING;

-- ── 3 · the grant ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ If this raises 42704 role "cb_app" does not exist, you are in the WRONG SUPABASE PROJECT. The app
-- connects as cb_app.bzacyrdrnzdbficjplcn — run this in project bzacyrdrnzdbficjplcn, where the role is real.
GRANT SELECT ON register_attachable TO cb_app;

-- ── 4 · the foreign key CREATE TABLE IF NOT EXISTS skipped ─────────────────────────────────────────────────────
-- ⭐ THIS IS WHAT MADE THE EMPTY REGISTRY SILENT. Without it `type_key` is only text, so opening a register
-- against a registry holding nothing SUCCEEDED. With it, the same call is refused and names the problem.
--
-- ⚠️⚠️ EXECUTE, NOT A PLAIN IF. PL/pgSQL plans a whole IF expression as ONE statement, so a `FROM
-- register_subject` inside it is PARSED even when a `to_regclass(...) IS NOT NULL` test in the same expression
-- would have been false at runtime. Short-circuiting does not save it: the first version of this block died
-- with 42P01 on a database where register_subject does not exist. Anything naming a table that may be absent
-- has to be deferred into dynamic SQL, which is not parsed until it runs.
--
-- ⚠️ Added only when nothing would violate it. A subject already carrying an unknown kind leaves the constraint
-- off and is reported by the final SELECT, rather than erroring the whole script.
DO $b186$
DECLARE
  offenders bigint;
BEGIN
  IF to_regclass('register_subject') IS NULL OR to_regclass('register_attachable') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = to_regclass('register_subject') AND contype = 'f'
                AND confrelid = to_regclass('register_attachable')) THEN
    RETURN;                                  -- already there, nothing to do
  END IF;

  EXECUTE 'SELECT count(*) FROM register_subject s
            WHERE NOT EXISTS (SELECT 1 FROM register_attachable a WHERE a.type_key = s.type_key)'
     INTO offenders;

  IF offenders = 0 THEN
    EXECUTE 'ALTER TABLE register_subject
               ADD CONSTRAINT register_subject_type_key_fkey
               FOREIGN KEY (type_key) REFERENCES register_attachable(type_key)';
  END IF;
END
$b186$;

-- ── 5 · what the database looks like now — ONE result set ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM register_attachable WHERE active)                        AS registry_rows_active,
  12                                                                             AS registry_rows_expected,
  has_table_privilege('cb_app', 'register_attachable', 'SELECT')                 AS cb_app_can_select,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('register_subject') AND contype = 'f'
      AND confrelid = to_regclass('register_attachable'))                        AS type_key_fk_present,
  (SELECT count(*) FROM register_subject s
    WHERE NOT EXISTS (SELECT 1 FROM register_attachable a WHERE a.type_key = s.type_key))
                                                                                 AS subjects_with_unknown_kind;
