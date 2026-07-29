-- cleanup-keeplist.sql — KEEP a named few, delete the rest. DESTRUCTIVE (Part 3 only).
-- Run in the Supabase SQL Editor as the postgres role.
--
-- This is the WIDER sweep. scripts/cleanup-test-entities.sql only matches seven test DOMAINS; this one deletes every
-- entity that is NOT on the keep-list, including anything created by hand through the UI.
--
--   PART 0 · CANDIDATES  — decide from evidence, not memory (read-only)
--   PART 1 · DRY RUN     — exactly who lives and who dies (read-only)
--   PART 2 · ORPHANS     — blueprints that would lose their owner (read-only)
--   PART 3 · DELETE      — only after 0-2 look right
--   PART 4 · VERIFY
--
-- ⚠️ THREE THINGS THAT WILL BITE IF YOU SKIP THEM
--  1. YOUR OWN LOGIN must be on the keep-list. If it is not, you delete your own account and cannot get back in.
--     Part 1 refuses to report a plan whose keep-list is empty, but it cannot know which login is yours.
--  2. BLUEPRINT OWNERS. `catalogue_source` has owner_entity_id but NO entity_id, so a published blueprint SURVIVES
--     this sweep and becomes ORPHANED — still resolvable and adoptable, but permanently uneditable, because writes
--     are gated app-side on an owner that no longer exists. Part 2 lists these. Keep the owner, or accept a
--     read-only blueprint forever.
--  3. CONFIRM WHICH DATABASE. The Railway host is named "…-production…" but is wired to the dev database.
--
-- ⚠️ `SET row_security = off` is SESSION-scoped and the SQL Editor may use a fresh pooled connection per run, so it
--    is repeated in every part that needs it. Do not set it once and run the parts separately.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
--  EDIT THIS ONE BLOCK. Everything below reads from it.
--  Add by email OR bridge_id — either matches. Keep your own login FIRST so you cannot forget it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
--  KEEP_EMAILS    : 'you@example.com', 'document.store@test-cb.com'
--  KEEP_BRIDGES   : 'CBSNJC9LZP', 'CB7S448EXA'
--  (edit the two IN-lists in the `keep` CTE that appears in Parts 1, 2 and 3 — they are identical, deliberately
--   copy-pasted rather than factored into a view, because a postgres-owned view over `identities` left behind in
--   `public` is an RLS-bypass footgun.)

-- ============================ PART 0 · CANDIDATES — who is actually worth keeping? =========================
-- Ranked by real activity. Anything with chits, items, adoptions or a recent login is a candidate; the long tail
-- of zeros is test litter.
SET row_security = off;
SELECT i.identity_id, i.bridge_id, i.display_name, i.email, i.created_at::date, i.last_active_at::date,
       (SELECT count(*) FROM chit_header       c WHERE c.entity_id = i.identity_id) AS chits,
       (SELECT count(*) FROM catalogue_items   x WHERE x.entity_id = i.identity_id) AS items,
       (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id = i.identity_id) AS adoptions,
       (SELECT count(*) FROM catalogue_source  s WHERE s.owner_entity_id = i.identity_id) AS blueprints_owned
FROM identities i
WHERE i.identity_type = 'entity'
ORDER BY blueprints_owned DESC, chits DESC, items DESC, adoptions DESC, i.last_active_at DESC NULLS LAST
LIMIT 60;

-- ============================ PART 1 · DRY RUN — who lives, who dies ======================================
SET row_security = off;
WITH keep AS (
  SELECT identity_id FROM identities
  WHERE identity_type = 'entity'
    AND ( email     IN ('CHANGE-ME@example.com')          -- ← your login + any entity to preserve
       OR bridge_id IN ('CBXXXXXXXX') )                   -- ← or by bridge id
)
SELECT (SELECT count(*) FROM keep)                                                       AS keeping,
       (SELECT count(*) FROM identities WHERE identity_type='entity')                    AS total_entities,
       (SELECT count(*) FROM identities WHERE identity_type='entity'
          AND identity_id NOT IN (SELECT identity_id FROM keep))                         AS will_delete,
       (SELECT count(*) FROM identities WHERE parent_entity_id NOT IN (SELECT identity_id FROM keep)
          AND parent_entity_id IS NOT NULL)                                              AS their_actors,
       (SELECT count(*) FROM chit_header WHERE entity_id NOT IN (SELECT identity_id FROM keep)) AS chits_deleted;
-- ⚠️ If `keeping` is 0, STOP — you are about to delete every entity including your own login.

-- ============================ PART 2 · ORPHANS — blueprints that lose their owner =========================
SET row_security = off;
WITH keep AS (
  SELECT identity_id FROM identities
  WHERE identity_type = 'entity'
    AND ( email IN ('CHANGE-ME@example.com') OR bridge_id IN ('CBXXXXXXXX') )
)
SELECT s.source_key, s.title, s.for_vertical, s.owner_entity_id,
       (SELECT display_name FROM identities WHERE identity_id = s.owner_entity_id) AS owner_name,
       'WILL BE ORPHANED — survives but becomes permanently uneditable' AS consequence
FROM catalogue_source s
WHERE s.owner_entity_id IS NOT NULL
  AND s.owner_entity_id NOT IN (SELECT identity_id FROM keep)
ORDER BY s.source_key;
-- Add any owner you want to stay editable to the keep-list, then re-run Parts 1-2.

-- ============================ PART 3 · DELETE (only after 0-2 look right) =================================
SET row_security = off;
DO $$
DECLARE tbl text; eids uuid[]; keep_n int;
BEGIN
  -- ⚠️ keep this IN-list IDENTICAL to Parts 1 and 2
  SELECT count(*) INTO keep_n FROM identities
   WHERE identity_type = 'entity'
     AND ( email IN ('CHANGE-ME@example.com') OR bridge_id IN ('CBXXXXXXXX') );

  IF keep_n = 0 THEN
    RAISE EXCEPTION 'REFUSING: the keep-list matched 0 entities. That would delete every account including your own login.';
  END IF;

  SELECT array_agg(identity_id) INTO eids FROM identities
   WHERE identity_type = 'entity'
     AND identity_id NOT IN (
       SELECT identity_id FROM identities
        WHERE identity_type = 'entity'
          AND ( email IN ('CHANGE-ME@example.com') OR bridge_id IN ('CBXXXXXXXX') ));

  IF eids IS NULL THEN RAISE NOTICE 'Nothing to delete — every entity is on the keep-list.'; RETURN; END IF;
  RAISE NOTICE 'Keeping % entities; deleting %.', keep_n, array_length(eids, 1);

  -- schema_fields hang off entity_schemas by schema_id (no entity_id) — clear them first to avoid an FK block.
  BEGIN
    DELETE FROM schema_fields WHERE schema_id IN (SELECT schema_id FROM entity_schemas WHERE entity_id = ANY(eids));
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- every table scoped by entity_id, then the actors under those entities, then the entities themselves
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
     WHERE column_name = 'entity_id' AND table_schema = 'public' AND table_name <> 'identities'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE entity_id = ANY($1)', tbl) USING eids;
  END LOOP;

  DELETE FROM identities WHERE parent_entity_id = ANY(eids);   -- co-assists / actors
  DELETE FROM identities WHERE identity_id      = ANY(eids);

  RAISE NOTICE 'Done. % entities removed.', array_length(eids, 1);
END $$;

-- ============================ PART 4 · VERIFY =============================================================
SET row_security = off;
SELECT identity_type, count(*) FROM identities GROUP BY 1 ORDER BY 1;
SELECT catalogue_visibility, count(*) FROM identities WHERE identity_type='entity' GROUP BY 1;   -- after b114
SELECT count(*) AS orphaned_blueprints FROM catalogue_source s
 WHERE s.owner_entity_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = s.owner_entity_id);

-- Reclaim disk after a large delete (VACUUM cannot run inside a transaction — run it on its own):
--   VACUUM (ANALYZE) identities, chit_header, chit_detail, chit_messages, cb_attachment, catalogue_items;
