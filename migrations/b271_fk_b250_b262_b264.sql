-- b271_fk_b250_b262_b264.sql — RUN BY ATHI 2026-09-29 (Supabase editor). The foreign keys b250, b262 and b264 declared
-- inside CREATE TABLE IF NOT EXISTS (so never created where the table already existed), plus b250's policy guarded
-- against ''::uuid. Before: 0 orphans in all five checked columns. After: all 11 keys present, convalidated = true.
-- This file is the draft docs/drafts/fk_b250_b262_b264_draft.sql as run (step 0's read-only checks included).

-- ── 0 · BEFORE: which keys exist, and any orphans that would stop VALIDATE ───────────────────────────────────
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE contype = 'f' AND conrelid::regclass::text IN ('entity_work_routing', 'quick_key_group', 'quick_key_group_item',
       'counter_quick_key_state', 'counter_hidden_item', 'device_screen_config', 'quick_key_audit', 'signup_context')
 ORDER BY 1, 2;
SELECT 'entity_work_routing.folder_id' AS col, count(*) FROM entity_work_routing r WHERE folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folder f WHERE f.folder_id = r.folder_id)
UNION ALL SELECT 'quick_key_group_item.group_id',   count(*) FROM quick_key_group_item x WHERE NOT EXISTS (SELECT 1 FROM quick_key_group g WHERE g.id = x.group_id)
UNION ALL SELECT 'quick_key_group_item.product_id', count(*) FROM quick_key_group_item x WHERE NOT EXISTS (SELECT 1 FROM catalogue_items c WHERE c.item_id = x.product_id)
UNION ALL SELECT 'counter_hidden_item.product_id',  count(*) FROM counter_hidden_item x WHERE NOT EXISTS (SELECT 1 FROM catalogue_items c WHERE c.item_id = x.product_id)
UNION ALL SELECT 'signup_context.identity_id',      count(*) FROM signup_context x WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = x.identity_id);
-- (the entity_id → identities keys: an orphan there would be a row for a shop that does not exist; checked by VALIDATE)

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.add_fk(tbl text, col text, reftbl text, refcol text, tail text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE cname text := tbl || '_' || col || '_fkey';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
             WHERE c.contype = 'f' AND c.conrelid = tbl::regclass AND a.attname = col) THEN
    RETURN tbl || '.' || col || ' — already has a foreign key';
  END IF;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (%I) %s NOT VALID',
                 tbl, cname, col, reftbl, refcol, coalesce(tail, ''));
  RETURN tbl || '.' || col || ' — ADDED (not yet validated)';
END $f$;

SELECT pg_temp.add_fk('entity_work_routing',     'folder_id',   'folder',          'folder_id',   'ON DELETE SET NULL');
SELECT pg_temp.add_fk('quick_key_group',         'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('quick_key_group_item',    'group_id',    'quick_key_group', 'id',          'ON DELETE CASCADE');
SELECT pg_temp.add_fk('quick_key_group_item',    'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('quick_key_group_item',    'product_id',  'catalogue_items', 'item_id',     NULL);
SELECT pg_temp.add_fk('counter_quick_key_state', 'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('counter_hidden_item',     'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('counter_hidden_item',     'product_id',  'catalogue_items', 'item_id',     'ON DELETE CASCADE');
SELECT pg_temp.add_fk('device_screen_config',    'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('quick_key_audit',         'entity_id',   'identities',      'identity_id', NULL);
SELECT pg_temp.add_fk('signup_context',          'identity_id', 'identities',      'identity_id', 'ON DELETE CASCADE');

-- ── b250's policy, guarded: an unset shop reads nothing instead of raising on ''::uuid ─────────────────────────
DROP POLICY IF EXISTS rls_entity ON entity_work_routing;
CREATE POLICY rls_entity ON entity_work_routing FOR ALL TO public
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;

-- ── 1 · VALIDATE, one at a time (a failure names the orphan; fix it, re-run that line) ────────────────────────
DO $v$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
            WHERE contype = 'f' AND NOT convalidated
              AND conrelid::regclass::text IN ('entity_work_routing', 'quick_key_group', 'quick_key_group_item',
                  'counter_quick_key_state', 'counter_hidden_item', 'device_screen_config', 'quick_key_audit', 'signup_context')
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
      RAISE NOTICE 'validated %', r.conname;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'NOT validated % — orphan rows exist (see step 0); the key still guards every NEW row', r.conname;
    END;
  END LOOP;
END $v$;

-- ── 2 · AFTER: every key present (and validated, or named above) ──────────────────────────────────────────────
SELECT conrelid::regclass AS tbl, conname, convalidated
  FROM pg_constraint
 WHERE contype = 'f' AND conrelid::regclass::text IN ('entity_work_routing', 'quick_key_group', 'quick_key_group_item',
       'counter_quick_key_state', 'counter_hidden_item', 'device_screen_config', 'quick_key_audit', 'signup_context')
 ORDER BY 1, 2;
