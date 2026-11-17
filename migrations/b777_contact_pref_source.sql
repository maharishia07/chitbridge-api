-- b777_contact_pref_source.sql — CON-2 (22 Oct 2026): a consent row says WHO made it - staff, the person themselves, or a STOP reply - and which capture proves it.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (ADD COLUMN IF NOT EXISTS; the CHECK is added only if missing).
--    Touches no rows: both columns are nullable with no default, so every earlier row reads NULL ("not recorded") and the ALTER is a catalogue change.
--
-- WHY. party_contact_pref (b306) has noted_by but no source. A STOP reply has no staff user and no sign-in, so noted_by would paint it "By them, online",
--    which is wrong; and the Spam Act / AU APP records want who, when and how. Two additive columns:
--   source      text  NULL  CHECK in ('staff','self','reply')  - who made the row: a shop user, the person on their own page, or their STOP reply on WhatsApp
--   source_ref  uuid  NULL  - for 'reply', the capture id (the inbound message that is the proof); NULL for the others
-- schema-lint: allow R7 source_ref is a proof pointer, not a once-only key: one STOP capture is cited by every row it writes (parties x channels), so it must not be unique
-- Until this runs the code checks the column (schema.hasColumn) and still writes the withdrawal; the history label then says "Withdrawn".
-- RLS: unchanged (party_contact_pref keeps FORCE RLS and its rls_entity policy). Grants: cb_app already holds table-level INSERT/SELECT on
--    party_contact_pref (baseline), which covers new columns; nothing added. No FK on source_ref: the capture is a row of another table that retention may purge, the proof here is its id.

BEGIN;
ALTER TABLE party_contact_pref ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE party_contact_pref ADD COLUMN IF NOT EXISTS source_ref uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_contact_pref_source_chk' AND conrelid = 'party_contact_pref'::regclass) THEN
    ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_source_chk CHECK (source IS NULL OR source IN ('staff', 'self', 'reply'));
  END IF;
END $$;
COMMENT ON COLUMN party_contact_pref.source IS 'CON-2 b777: who made this row - staff | self | reply (a STOP reply on WhatsApp); NULL = not recorded';
COMMENT ON COLUMN party_contact_pref.source_ref IS 'CON-2 b777: for source = reply, the capture id of the inbound message (the proof); NULL otherwise';
COMMIT;
