-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b186 · APPLY — seed the attachable registry, and put back the foreign key b185 skipped
--
-- Run b186_register_seed_dryrun.sql first. Safe to run more than once: the seed is ON CONFLICT DO NOTHING and
-- the constraint is added only if it is missing.
--
-- ⚠️ CHANGES NOTHING THAT EXISTS. No UPDATE, no DELETE. It inserts the twelve rows b185 meant to insert and adds
-- one constraint. A row you have edited by hand (a relabelled kind, one switched inactive) is left alone.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · the seed that never landed ─────────────────────────────────────────────────────────────────────────────
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

-- ⚠️ b185 granted this, but grant it again — it costs nothing and it is the one privilege that decides whether
-- the app can see the table at all. information_schema hides an ungranted table completely.
GRANT SELECT ON register_attachable TO cb_app;

-- ── 2 · the foreign key `CREATE TABLE IF NOT EXISTS` skipped ────────────────────────────────────────────────────
-- ⭐ This is what made the empty registry silent. Without it, opening a register against a registry holding
-- nothing SUCCEEDS — the type_key is just text. With it, the same call is refused and names the problem.
--
-- ⚠️ Added only when nothing would violate it. If a subject already carries an unknown kind, the constraint is
-- left off and the final SELECT says so, rather than the whole script erroring.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'register_subject'::regclass AND contype = 'f'
       AND confrelid = 'register_attachable'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM register_subject s
     WHERE NOT EXISTS (SELECT 1 FROM register_attachable a WHERE a.type_key = s.type_key)
  ) THEN
    ALTER TABLE register_subject
      ADD CONSTRAINT register_subject_type_key_fkey
      FOREIGN KEY (type_key) REFERENCES register_attachable(type_key);
  END IF;
END $$;

-- ── 3 · what the database looks like now — ONE result set ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM register_attachable WHERE active)                       AS registry_rows_active,
  12                                                                            AS registry_rows_expected,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'register_subject'::regclass AND contype = 'f'
       AND confrelid = 'register_attachable'::regclass)                         AS type_key_fk_present,
  (SELECT count(*) FROM register_subject s
    WHERE NOT EXISTS (SELECT 1 FROM register_attachable a WHERE a.type_key = s.type_key)) AS subjects_with_unknown_kind;
