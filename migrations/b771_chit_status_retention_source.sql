-- b771_chit_status_retention_source.sql — K-DB / SET-26 (21 Oct 2026): each copy says WHICH rule set how long it is kept.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (ADD COLUMN IF NOT EXISTS; the CHECK is dropped
--    and added in the same transaction). Touches no rows: the column is nullable with no default, so existing copies read NULL ("not
--    recorded", the copies minted before this ran) and the ALTER is a catalogue change.
--
-- WHY. routes/chits.js retainDaysFor takes MAX(records-law floor, the owner's retention_floor_days, the sender's retention_days) per copy and
--    wrote only the days (chit_status.retention_expires_at / retire_at). Which of the three won was not kept, so a copy's retention could not
--    be explained afterwards. The mint now writes the winner here, per copy (each party's own floor — owned data, so not in the shared
--    summary_json). Until this runs the code checks the column (lib/schema.hasColumn) and writes the days alone, as before.
-- Values: records_law (CO3 RECORDS_FLOOR_DAYS) · own_floor (policy_flags.retention_floor_days) · sender_asked (the sender's retention_days).
-- RLS: unchanged (chit_status keeps FORCE RLS and its entity policies). Grants: cb_app already holds table-level INSERT/SELECT on
--    chit_status (baseline), which covers a new column; nothing added.

BEGIN;
ALTER TABLE chit_status ADD COLUMN IF NOT EXISTS retention_source text;
ALTER TABLE chit_status DROP CONSTRAINT IF EXISTS chit_status_retention_source_chk;
ALTER TABLE chit_status ADD CONSTRAINT chit_status_retention_source_chk
  CHECK (retention_source IS NULL OR retention_source IN ('records_law', 'own_floor', 'sender_asked'));
COMMENT ON COLUMN chit_status.retention_source IS
  'SET-26 b771: which rule set this copy''s retention days at the mint (records_law, own_floor, sender_asked); NULL = minted before b771';
COMMIT;
