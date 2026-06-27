-- migration_chit_direction.sql  (two-copy principle, 2026-06-27)
-- Every per-entity chit row carries a direction: 'sent' (Order) or 'received' (Task).
-- A self-chit yields BOTH for the same entity = two independent rows.
-- self_copy_pref = entity view preference for self-chits (both default | sent | received).
--
-- NOTE: run as SEPARATE statements/blocks in the Supabase SQL editor — it wraps a whole
-- script in ONE transaction, so a later failure rolls back earlier statements. Part 3 is
-- run-once (constraint rename). This is the version that actually applied on dev.

-- 1) direction column on each per-entity chit row
ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';
ALTER TABLE chit_detail ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'received';

-- 2) backfill: the sender's own copy is 'sent'
UPDATE chit_header SET direction='sent' WHERE entity_id = sender_entity_id;
UPDATE chit_status cs SET direction='sent' FROM chit_header ch WHERE ch.chit_id=cs.chit_id AND ch.entity_id=cs.entity_id AND ch.entity_id=ch.sender_entity_id;
UPDATE chit_detail cd SET direction='sent' FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=cd.entity_id AND ch.entity_id=ch.sender_entity_id;

-- 3) re-key to include direction (default Postgres constraint names; run-once)
ALTER TABLE chit_header DROP CONSTRAINT IF EXISTS chit_header_pkey;
ALTER TABLE chit_header ADD PRIMARY KEY (chit_id, entity_id, direction);
ALTER TABLE chit_status DROP CONSTRAINT IF EXISTS chit_status_chit_id_entity_id_key;
ALTER TABLE chit_status ADD CONSTRAINT chit_status_cid_eid_dir UNIQUE (chit_id, entity_id, direction);
ALTER TABLE chit_detail DROP CONSTRAINT IF EXISTS chit_detail_chit_id_entity_id_key;
ALTER TABLE chit_detail ADD CONSTRAINT chit_detail_cid_eid_dir UNIQUE (chit_id, entity_id, direction);

-- 4) entity view preference for self-chits
ALTER TABLE identities ADD COLUMN IF NOT EXISTS self_copy_pref VARCHAR(10) NOT NULL DEFAULT 'both'
  CHECK (self_copy_pref IN ('both','sent','received'));
CREATE INDEX IF NOT EXISTS idx_chit_status_entity_direction ON chit_status(entity_id, direction);
