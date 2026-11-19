-- b885_books_action_step_staff_reverse.sql — the shop's own Bookkeeper may leave a REVERSAL for the owner's OK (l20/bk-modify, 20 Nov 2026; Athi: the edit seat creates AND modifies the books, its id captured).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b884 (it edits what b884 made). Safe to repeat (DROP ... IF EXISTS first, then ADD / CREATE). It touches no existing row.
--    The api is correct BEFORE and AFTER this file runs: with the setting off (the default) the Bookkeeper reverses directly and nothing here is used. Until this runs, a Bookkeeper's HELD reversal (only when the owner
--    switched on books_owner_approves) is refused by the table's check (answered 403 ACTION_NOT_ALLOWED) and nothing is written; his held Day book entry and journal are unchanged.
-- NUMBER. b884 is the last on the batch; this is b885. Rename before landing if another round took it.
-- WHAT IT CHANGES (books_action_step, one table, no new table): the staff step may now carry kind 'reverse' as well as 'event' and 'journal'.
--    CHECK  books_action_step_staff_shape  : role 'staff' → step 'prepared', no grant, kind event | journal | reverse.
--    RLS    action_insert_staff            : the same widening of the INSERT policy (the store's own scope only, step 'prepared', role 'staff', grant_id NULL).
--    Lock, unlock and year_close stay out: the api refuses them at prepare AND this policy admits no such row. Still INSERT-ONLY (books_insert_only() trigger), cb_app keeps SELECT, INSERT only, forced RLS stays.
--    ⚠️ "only the owner accepts" is APP-ENFORCED as in b867/b884: the api's accept door is ownerOnly, and a staff step can only be `prepared`.
-- money-group: currency covers total_minor (unchanged)
-- OWNER: lib/books-action.js · lib/books-approval.js · routes/books.js (POST /entries/:id/reverse).
-- ROLL BACK (no staff row of kind 'reverse' may exist first: delete nothing, the table is insert-only; if any exist, leave the file in place):
--    ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_staff_shape;
--    ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_staff_shape CHECK (role <> 'staff' OR (step = 'prepared' AND grant_id IS NULL AND kind IN ('event', 'journal')));
--    DROP POLICY IF EXISTS action_insert_staff ON books_action_step;
--    CREATE POLICY action_insert_staff ON books_action_step FOR INSERT WITH CHECK (store = NULLIF(current_setting('app.current_entity', true), '')::uuid AND step = 'prepared' AND role = 'staff' AND grant_id IS NULL AND kind IN ('event', 'journal'));
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'forced RLS still on' AS what, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'books_action_step') AS ok
--    UNION ALL SELECT 'insert-only trigger still on', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.books_action_step'::regclass AND tgname = 'books_action_step_insert_only')
--    UNION ALL SELECT 'cb_app: no UPDATE, no DELETE', NOT has_table_privilege('cb_app', 'public.books_action_step', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.books_action_step', 'DELETE')
--    UNION ALL SELECT 'staff shape admits reverse', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.books_action_step'::regclass AND conname = 'books_action_step_staff_shape') LIKE '%reverse%'
--    UNION ALL SELECT 'staff insert policy admits reverse', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'books_action_step' AND policyname = 'action_insert_staff' AND cmd = 'INSERT' AND with_check LIKE '%reverse%');
-- RLS: stated above (forced; select by store; insert by the firm with a live adviser grant, by the owner for its own store, and by the store's own staff for a PREPARED step with no grant).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_staff_shape;
ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_staff_shape CHECK (role <> 'staff' OR (step = 'prepared' AND grant_id IS NULL AND kind IN ('event', 'journal', 'reverse')));

DROP POLICY IF EXISTS action_insert_staff ON books_action_step;
CREATE POLICY action_insert_staff ON books_action_step FOR INSERT
  WITH CHECK (store = NULLIF(current_setting('app.current_entity', true), '')::uuid
    AND step = 'prepared' AND role = 'staff' AND grant_id IS NULL AND kind IN ('event', 'journal', 'reverse'));

COMMIT;
