-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b250 — FIVE QUEUES IN ONE ENTITY, OR ONE QUEUE WITH FIVE LABELS?
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- DESIGN-SUPPORT-LIFECYCLE.md §5.1, and DESIGN-PLATFORM-OPERATIONS.md §8.1 before it, which called this the
-- KEYSTONE: *"everything else in this document hangs off closing this gap."*
--
-- ⚠️⚠️ WHAT IS ACTUALLY MISSING. lib/workpattern.js resolves `folder` and `default_assignee` as OPEN knobs, and
-- the cascade is device → connector → entity. The entity level is `entity_actor_settings.default_assignee_actor_id`
-- — ONE per entity. So there is no way to say:
--
--     incidents   → folder 00-support,      to Priya
--     requirements→ folder 10-product,      to whoever owns the roadmap
--     changes     → folder 20-engineering,  to the reviewer on duty
--
-- Everything lands in one place, addressed to one person. The design calls CBINC "support, requirements,
-- testing, billing and sales as folders and queues"; without this it is a single inbox wearing five labels, and
-- the first week of real support would bury the one incident that mattered under everything else.
--
-- ── ⭐ A ROW PER (ENTITY, KIND), AND NOTHING ELSE CHANGES ───────────────────────────────────────────────────────
--
-- The cascade keeps its order and gains one rung, in the place "most specific wins" already puts it:
--
--     device  →  connector  →  KIND  →  entity default
--
-- A kind with no row resolves exactly as it does today. That is the whole compatibility argument: this cannot
-- alter any routing that currently works, because it only ever fills in a step that was previously empty.
--
-- ── ⚠️ NOT A COLUMN ON `folder`, AND NOT A COLUMN ON `identities` ──────────────────────────────────────────────
--
-- Both were tempting and both put a ROUTING RULE inside the thing being routed to. A folder does not know what
-- kinds belong in it — an entity decides that, and the same folder may take two kinds. Keeping the rule in its
-- own table is what lets it be read in one query, changed without touching the folder tree, and — importantly —
-- be ABSENT, which is the default and must stay cheap.
--
-- ⚠️ `folder_id` REFERENCES folder ON DELETE SET NULL: deleting a folder must not delete the routing rule
-- silently, and must not leave it pointing at nothing either. It falls back to the entity default, which is the
-- behaviour before any of this existed.
--
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT and triggers are refused to a role that merely has
--    rights on the rows. The rule of thumb for this repo:
--        structure, or data read ACROSS shops  → WITHOUT RLS (as the owner)
--        data written FOR ONE shop             → WITH RLS, so the database refuses a row that lands in
--                                                the wrong shop
-- ⚠️ Being the owner is NOT the same as bypassing RLS. A table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too — that is the whole difference between ENABLE and FORCE — so a statement
--    touching chit_header, customer_list, catalogue_items or cb_attachment can still be refused here.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS entity_work_routing (
  entity_id    uuid NOT NULL,
  /* ⚠️ free text, like definition.kind and for the same reason (b160): the registry of kinds lives in code and
     gains entries in a release. An enum here would mean a migration every time a queue is added, and an OLD
     row whose kind was later renamed would become unreadable. */
  kind         text NOT NULL,
  folder_id    uuid REFERENCES folder(folder_id) ON DELETE SET NULL,
  assignee_actor_id uuid,
  notify_email text,
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, kind)
);

COMMENT ON TABLE entity_work_routing IS
  'Where work of a given kind goes, per entity. One rung of the cascade device → connector → KIND → entity '
  'default (lib/workroute.js). A kind with no row resolves exactly as it did before this table existed.';

/* ── ⚠️ RLS, because this is TENANT data ──────────────────────────────────────────────────────────────────────
   A shop's routing says who on its staff handles what. FORCE, like every other tenant table here: the owner is
   not exempt, which is the difference between ENABLE and FORCE and the thing that keeps an operator query from
   quietly reading across shops. */
ALTER TABLE entity_work_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_work_routing FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON entity_work_routing;
CREATE POLICY rls_entity ON entity_work_routing FOR ALL TO public
  USING (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON entity_work_routing TO cb_app;

CREATE INDEX IF NOT EXISTS entity_work_routing_kind_idx ON entity_work_routing (kind);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — and how to set one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- The rows are tenant data, so this reads them as the OWNER for a census only. To set one for CBINC, do it
-- through the app (Settings → the queue), or here with app.current_entity set to that entity:
--
--     SET LOCAL app.current_entity = '<cbincroot uuid>';
--     INSERT INTO entity_work_routing (entity_id, kind, folder_id, assignee_actor_id, note)
--     VALUES ('<cbincroot uuid>', 'incident',
--             (SELECT folder_id FROM folder WHERE entity_id = '<cbincroot uuid>' AND name = '00-support'),
--             NULL, 'faults raised by shops')
--     ON CONFLICT (entity_id, kind) DO UPDATE SET folder_id = EXCLUDED.folder_id, updated_at = now();
--
SELECT r.entity_id, r.kind, f.name AS folder, r.assignee_actor_id, r.note
  FROM entity_work_routing r
  LEFT JOIN folder f ON f.folder_id = r.folder_id
 ORDER BY r.entity_id, r.kind;

-- ⚠️ the five kinds the support loop uses, and whether each has anywhere to go yet.
SELECT k AS kind,
       (SELECT count(*)::int FROM entity_work_routing r WHERE r.kind = k) AS entities_routing_it
  FROM unnest(ARRAY['incident', 'spec', 'change', 'release', 'testcase']) AS k;
