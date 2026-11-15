-- b866_books_adviser_grant.sql — ACC-176b (14 Nov 2026): a store can hand its network parent a SECOND, separate access: `adviser`, the firm's team acting for the owner in the books.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b863. Safe to repeat (IF NOT EXISTS / DROP ... IF EXISTS first). It adds nullable columns and widens one CHECK and one index;
--    no row of any table is rewritten. The api is correct BEFORE and AFTER this file runs: until it runs, an adviser grant answers 503 BOOKS_GRANT_NOT_SWITCHED_ON in words and the auditor path is exactly b863's.
-- NUMBER. b863 is ACC-176, b864 is FIN-70, b865 is DB-103 (renumbered 15 Nov from b865 because main took it) → b866. Rename before landing if another round took it.
-- LOOKED AT (DISCIPLINES 4a): books_access_grant / books_access_log (b863, the same two tables widened, no new table); journal_entry (insert-only, b273) and books_change_log (insert-only): one nullable grant_id each,
--    written on the SAME insert; identities (read once, at the look, for the firm's name).
-- ANSWER TO cb-db'S QUESTION: `preset` WAS a CHECK (preset = 'auditor', b863, unnamed so books_access_grant_preset_check) → widened here to ('auditor', 'adviser').
-- WHAT IT DOES.
--    books_access_grant  preset also allows 'adviser'. The one-open-grant-per-pair index becomes one open grant per (pair, preset): a store can hold an auditor AND an adviser grant, each with its own end date and its own revoke.
--    books_access_log    + preset (which role the request ran under), actor_name (the person), actor_entity_name (the firm), all kept AT THE LOOK so the owner reads them with no read into another business's identities.
--    journal_entry       + grant_id: an entry posted by an adviser names the grant (created_by already holds the real person).   books_change_log + grant_id: the same for a change (by already holds the real person).
-- OWNER: lib/books-grant.js (the grant and its log) · lib/books-store.js insertEntry / logChange (the two stamps).
-- ROLL BACK (loses only the role, the names and the stamps; refused while an adviser grant exists: delete or revoke those first):
--    DROP POLICY IF EXISTS log_insert ON books_access_log; then re-create log_insert exactly as b863 has it (the same EXISTS, without the preset line).
--    DROP INDEX IF EXISTS books_access_grant_open_uq; CREATE UNIQUE INDEX books_access_grant_open_uq ON books_access_grant (grantee_entity, grantor_entity) WHERE revoked_at IS NULL;   (only with no adviser grant left)
--    ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_preset_check; ALTER TABLE books_access_grant ADD CONSTRAINT books_access_grant_preset_check CHECK (preset = 'auditor');   (only with no adviser grant left)
--    ALTER TABLE books_access_log DROP CONSTRAINT IF EXISTS books_access_log_preset_check;
--    ALTER TABLE journal_entry DROP COLUMN IF EXISTS grant_id; ALTER TABLE books_change_log DROP COLUMN IF EXISTS grant_id;
--    ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_posting_check, DROP CONSTRAINT IF EXISTS books_access_grant_cap_pair, DROP CONSTRAINT IF EXISTS books_access_grant_posting_adviser_only; ALTER TABLE books_access_grant DROP COLUMN IF EXISTS posting, DROP COLUMN IF EXISTS posting_cap_minor, DROP COLUMN IF EXISTS posting_cap_currency;   (the choice of who posts is lost)
--    ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check; then re-add it as b863 has it (without the three books_delegated_* values; delete those rows first).
--    ALTER TABLE books_access_log DROP COLUMN IF EXISTS preset, DROP COLUMN IF EXISTS actor_name, DROP COLUMN IF EXISTS actor_entity_name;
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'preset allows adviser' AS what, pg_get_constraintdef(oid) LIKE '%adviser%' AS ok FROM pg_constraint WHERE conname = 'books_access_grant_preset_check'
--    UNION ALL SELECT 'one open grant per pair and preset', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'books_access_grant_open_uq' AND indexdef LIKE '%preset%')
--    UNION ALL SELECT 'log columns', (SELECT count(*) FROM information_schema.columns WHERE table_name = 'books_access_log' AND column_name IN ('preset', 'actor_name', 'actor_entity_name')) = 3
--    UNION ALL SELECT 'grant_id on the two books tables', (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('journal_entry', 'books_change_log') AND column_name = 'grant_id') = 2
--    UNION ALL SELECT 'log_insert asks the preset', (SELECT with_check FROM pg_policies WHERE tablename = 'books_access_log' AND policyname = 'log_insert') LIKE '%preset%'
--    UNION ALL SELECT 'log preset CHECK', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'books_access_log_preset_check')
--    UNION ALL SELECT 'grant: posting + limit columns and their CHECKs', (SELECT count(*) FROM information_schema.columns WHERE table_name = 'books_access_grant' AND column_name IN ('posting', 'posting_cap_minor', 'posting_cap_currency')) = 3 AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.books_access_grant'::regclass AND conname IN ('books_access_grant_posting_check', 'books_access_grant_cap_pair', 'books_access_grant_posting_adviser_only')) = 3
--    UNION ALL SELECT 'grant: UPDATE on posting + limit for cb_app', has_column_privilege('cb_app', 'public.books_access_grant', 'posting', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'posting_cap_minor', 'UPDATE') AND has_column_privilege('cb_app', 'public.books_access_grant', 'posting_cap_currency', 'UPDATE')
--    UNION ALL SELECT 'access_events action allows the delegated alerts', (SELECT pg_get_constraintdef(oid) LIKE '%books_delegated_first%' AND pg_get_constraintdef(oid) LIKE '%books_delegated_unlock%' AND pg_get_constraintdef(oid) LIKE '%books_delegated_year_close%' AND pg_get_constraintdef(oid) LIKE '%books_grant_given%' FROM pg_constraint WHERE conname = 'access_events_action_check')
--    UNION ALL SELECT 'log still insert-only', NOT has_table_privilege('cb_app', 'public.books_access_log', 'UPDATE');
-- RLS: no table is new, but ONE POLICY CHANGES: books_access_log.log_insert now also asks that the grant it names has the SAME preset as the row (critic 2: with two presets, a look logged as adviser must not pass on an open auditor grant). The five tables keep their ENABLE + FORCE row security and their policies (a new column is covered by the row policy of its table); cb_app keeps its table privileges (INSERT on both books tables,
--    SELECT/INSERT on the log; grants are UPDATE on expires_at, revoked_at, revoked_by AND on posting, posting_cap_minor, posting_cap_currency only (the owner switches who posts, or the limit, later), so the preset of a grant can never be changed after it is given).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_preset_check;
ALTER TABLE books_access_grant ADD CONSTRAINT books_access_grant_preset_check CHECK (preset IN ('auditor', 'adviser'));

-- WHY: the lookup of every request is (grantee, grantor, preset); a store may hold one open grant of each role
DROP INDEX IF EXISTS books_access_grant_open_uq;
CREATE UNIQUE INDEX IF NOT EXISTS books_access_grant_open_uq ON books_access_grant (grantee_entity, grantor_entity, preset) WHERE revoked_at IS NULL;

ALTER TABLE books_access_log ADD COLUMN IF NOT EXISTS preset text;
ALTER TABLE books_access_log ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE books_access_log ADD COLUMN IF NOT EXISTS actor_entity_name text;
ALTER TABLE books_access_log DROP CONSTRAINT IF EXISTS books_access_log_preset_check;
ALTER TABLE books_access_log ADD CONSTRAINT books_access_log_preset_check CHECK (preset IS NULL OR preset IN ('auditor', 'adviser')); -- legacy rows stay null (the log is insert-only: no backfill)
-- a look is logged only under an ACTIVE grant of the SAME preset the row says (a row with no preset is an auditor look, as before b866)
DROP POLICY IF EXISTS log_insert ON books_access_log;
CREATE POLICY log_insert ON books_access_log FOR INSERT
  WITH CHECK (grantee_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid
    AND EXISTS (SELECT 1 FROM books_access_grant g WHERE g.grantor_entity = books_access_log.grantor_entity AND g.grantee_entity = books_access_log.grantee_entity AND g.revoked_at IS NULL
                AND g.preset = COALESCE(books_access_log.preset, 'auditor')));

-- the owner's alert of a delegated post is one access_events row (the owner's audit): the action list gains three values, every value allowed before stays allowed
ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close'));
-- DELEGATED POSTING (ACC-176b, Athi 15 Nov): who posts is the OWNER'S choice, made at grant time; NULL = the owner has not chosen = read as owner_approves (the safe side); never a default, no backfill.
-- posting_cap_*: an optional ceiling per entry; above it (or in another currency) the action waits for the owner's accept even under adviser_posts. Money carries its currency: both columns or none.
ALTER TABLE books_access_grant ADD COLUMN IF NOT EXISTS posting text;
ALTER TABLE books_access_grant ADD COLUMN IF NOT EXISTS posting_cap_minor bigint;
ALTER TABLE books_access_grant ADD COLUMN IF NOT EXISTS posting_cap_currency text;
ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_posting_check;
ALTER TABLE books_access_grant ADD CONSTRAINT books_access_grant_posting_check CHECK (posting IS NULL OR posting IN ('owner_approves', 'adviser_posts'));
ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_cap_pair;
ALTER TABLE books_access_grant ADD CONSTRAINT books_access_grant_cap_pair CHECK ((posting_cap_minor IS NULL) = (posting_cap_currency IS NULL) AND (posting_cap_minor IS NULL OR (posting_cap_minor > 0 AND posting_cap_currency ~ '^[A-Z]{3}$')));
ALTER TABLE books_access_grant DROP CONSTRAINT IF EXISTS books_access_grant_posting_adviser_only;
ALTER TABLE books_access_grant ADD CONSTRAINT books_access_grant_posting_adviser_only CHECK (preset = 'adviser' OR (posting IS NULL AND posting_cap_minor IS NULL));
-- money-group: posting_cap_currency covers posting_cap_minor
-- the owner switches it back (or sets the cap) later, effective on the next request: UPDATE on these three columns only (the preset, grantee and purpose still never change)
GRANT UPDATE (posting, posting_cap_minor, posting_cap_currency) ON books_access_grant TO cb_app;
ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS grant_id uuid;
ALTER TABLE books_change_log ADD COLUMN IF NOT EXISTS grant_id uuid;
COMMENT ON COLUMN journal_entry.grant_id IS 'ACC-176b: the adviser grant an entry was posted under (created_by is the real person); null for the owner''s own entries';
COMMENT ON COLUMN books_change_log.grant_id IS 'ACC-176b: the adviser grant a change was made under (by is the real person); null for the owner''s own changes';
COMMIT;
