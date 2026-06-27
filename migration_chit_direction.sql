-- migration_chit_direction.sql  (two-copy principle, 2026-06-27)
-- Every per-entity chit row carries a direction: 'sent' (Order) or 'received' (Task).
-- A self-chit yields BOTH for the same entity = two independent rows.
-- Entity copy preference (self_copy_pref): which self-copy to keep — both (default) | sent | received.
-- Idempotent; safe to re-run. Backward-compatible with pre-direction code (column defaults).

ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';
ALTER TABLE chit_detail ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';

-- Backfill: the sender's own copy is 'sent'; everyone else stays 'received'.
UPDATE chit_header SET direction='sent' WHERE entity_id = sender_entity_id AND direction <> 'sent';
UPDATE chit_status cs SET direction='sent'
  FROM chit_header ch WHERE ch.chit_id=cs.chit_id AND ch.entity_id=cs.entity_id
   AND ch.entity_id=ch.sender_entity_id AND cs.direction <> 'sent';
UPDATE chit_detail cd SET direction='sent'
  FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=cd.entity_id
   AND ch.entity_id=ch.sender_entity_id AND cd.direction <> 'sent';

-- Re-key so one entity can hold both copies of a self-chit. Robust to existing constraint names.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid='chit_header'::regclass AND contype='p';
  IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE chit_header DROP CONSTRAINT '||quote_ident(c); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='chit_header'::regclass AND contype='p')
    THEN EXECUTE 'ALTER TABLE chit_header ADD PRIMARY KEY (chit_id, entity_id, direction)'; END IF;

  SELECT conname INTO c FROM pg_constraint WHERE conrelid='chit_status'::regclass AND contype='u'
    AND pg_get_constraintdef(oid) ILIKE '%(chit_id, entity_id)%';
  IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE chit_status DROP CONSTRAINT '||quote_ident(c); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='chit_status'::regclass AND contype='u'
    AND pg_get_constraintdef(oid) ILIKE '%(chit_id, entity_id, direction)%')
    THEN EXECUTE 'ALTER TABLE chit_status ADD CONSTRAINT chit_status_cid_eid_dir_key UNIQUE (chit_id, entity_id, direction)'; END IF;

  SELECT conname INTO c FROM pg_constraint WHERE conrelid='chit_detail'::regclass AND contype='u'
    AND pg_get_constraintdef(oid) ILIKE '%(chit_id, entity_id)%';
  IF c IS NOT NULL THEN EXECUTE 'ALTER TABLE chit_detail DROP CONSTRAINT '||quote_ident(c); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='chit_detail'::regclass AND contype='u'
    AND pg_get_constraintdef(oid) ILIKE '%(chit_id, entity_id, direction)%')
    THEN EXECUTE 'ALTER TABLE chit_detail ADD CONSTRAINT chit_detail_cid_eid_dir_key UNIQUE (chit_id, entity_id, direction)'; END IF;
END $$;

-- Per-entity copy preference for self-chits.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS self_copy_pref VARCHAR(10) NOT NULL DEFAULT 'both'
  CHECK (self_copy_pref IN ('both','sent','received'));

CREATE INDEX IF NOT EXISTS idx_chit_status_entity_direction ON chit_status(entity_id, direction);
