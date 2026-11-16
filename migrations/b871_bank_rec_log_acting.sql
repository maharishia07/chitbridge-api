-- b871_bank_rec_log_acting.sql — l16 adviser-bank (15 Nov 2026): a bank mark, a signed statement or a journal entry made by an ADVISER firm's person names the person and the firm (the grant is already on the entry, b866).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b864 and b866. Safe to repeat (IF NOT EXISTS). Adds three nullable columns; no row is rewritten.
-- The api is correct BEFORE and AFTER this file runs: before it, an adviser's bank write is refused in words (503 BOOKS_NOT_MIGRATED); the owner's own marks and sign-offs are unchanged either way.
-- NUMBER. b870 is the newest on int4/adv-sitau-api; rename before landing if another round took b871.
-- LOOKED AT (DISCIPLINES 4a): bank_rec_log (b864, insert-only, one entity policy) widened, no new table. made_by already holds the real person's id; the NAME and the FIRM are kept AT THE WRITE (as books_access_log keeps
--    actor_name / actor_entity_name), so the owner reads "by <person>, <firm>" with no read into another business's identities.
-- WHAT IT DOES. bank_rec_log + grant_id (the adviser grant the row was made under, NULL for the owner's own), by_name (the person), by_firm (the firm). Plain columns, no foreign key (the row stays readable if the grant row ever moves).
-- OWNER: lib/bank-rec-log.js appendMarks / appendStatement (the stamp) and read (shown).
-- ROLL BACK (as postgres, after deleting nothing: the columns hold only stamps):
--    ALTER TABLE bank_rec_log DROP COLUMN IF EXISTS grant_id, DROP COLUMN IF EXISTS by_name, DROP COLUMN IF EXISTS by_firm;
--    ALTER TABLE journal_entry DROP COLUMN IF EXISTS by_name, DROP COLUMN IF EXISTS by_firm;
-- CHECK (read-only, all-true block; every row must read ok = true):
--    SELECT 'acting columns' AS what, (SELECT count(*) FROM information_schema.columns WHERE table_name = 'bank_rec_log' AND column_name IN ('grant_id', 'by_name', 'by_firm')) = 3 AS ok
--    UNION ALL SELECT 'entry columns', (SELECT count(*) FROM information_schema.columns WHERE table_name = 'journal_entry' AND column_name IN ('by_name', 'by_firm')) = 2
--    UNION ALL SELECT 'log still insert-only', NOT has_table_privilege('cb_app', 'public.bank_rec_log', 'UPDATE')
--    UNION ALL SELECT 'RLS still enabled and forced', (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.bank_rec_log'::regclass);
-- RLS: no table is new and no policy changes (the one entity policy of b864 covers the new columns).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE bank_rec_log ADD COLUMN IF NOT EXISTS grant_id uuid;
ALTER TABLE bank_rec_log ADD COLUMN IF NOT EXISTS by_name  text CHECK (by_name IS NULL OR char_length(by_name) <= 200);
ALTER TABLE bank_rec_log ADD COLUMN IF NOT EXISTS by_firm  text CHECK (by_firm IS NULL OR char_length(by_firm) <= 200);
ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS by_name text CHECK (by_name IS NULL OR char_length(by_name) <= 200);
ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS by_firm text CHECK (by_firm IS NULL OR char_length(by_firm) <= 200);

COMMIT;
