-- b884_books_action_step_staff.sql — SHOPBK slice B (19 Nov 2026): the shop's OWN Bookkeeper can leave an entry for the owner's OK in the same maker-checker queue the adviser firms use (b867).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b867 (it edits that table). Safe to repeat (DROP ... IF EXISTS first, then ADD / CREATE).
--    It touches no existing row. The api is correct BEFORE and AFTER this file runs: until it runs, a Bookkeeper's held entry (only when the owner switched on books_owner_approves) is answered 503
--    BOOKS_ACTION_NOT_SWITCHED_ON in words and nothing is written; with the setting off (the default) nothing here is used at all.
-- NUMBER. b883 is taken (walkeve-1119, entity_actor_settings_staff_pick_up); this is b884. Rename before landing if another round took it.
-- WHAT IT CHANGES (books_action_step, one table, no new table):
--    role   gains 'staff'   — the shop's own Bookkeeper seat (the in-house accountant), the preparer of a held entry.
--    kind   gains 'event'   — a Day book event, whose body is exactly the POST /events body (a typed journal keeps its kind 'journal').
--    grant_id: the CHECK "a prepared or reviewed step names its grant" is relaxed for role 'staff' only (the shop's own staff act under no grant). A firm step still needs its live adviser grant.
--    RLS     one more INSERT policy, action_insert_staff: the store's own scope only, step 'prepared', role 'staff', grant_id NULL, kind event or journal. Nothing else for staff.
--            Lock, unlock, year_close and reverse can never be prepared by staff: the api refuses them at prepare AND this policy admits no such row.
--    Still INSERT-ONLY: the books_insert_only() trigger refuses UPDATE and DELETE for every role; cb_app keeps SELECT, INSERT only; forced RLS stays.
--    ⚠️ "only the owner accepts" is APP-ENFORCED, as in b867 (a staff request and the owner's both bind the store's scope, so the database cannot tell them apart): the api's accept door is ownerOnly, and a staff step can only be `prepared`.
-- money-group: currency covers total_minor (unchanged)
-- OWNER: lib/books-action.js · lib/books-approval.js · routes/books-actions.js.
-- ROLL BACK (no row of role 'staff' or kind 'event' may exist first: delete nothing, the table is insert-only; if any exist, leave the file in place):
--    DROP POLICY IF EXISTS action_insert_staff ON books_action_step;
--    ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_staff_shape;
--    ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_role_check;
--    ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_role_check CHECK (role IN ('maker', 'checker', 'owner', 'delegated'));
--    ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_kind_check;
--    ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_kind_check CHECK (kind IN ('journal', 'reverse', 'lock', 'unlock', 'year_close'));
--    ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_grant_on_firm_steps;
--    ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_grant_on_firm_steps CHECK (step NOT IN ('prepared', 'reviewed') OR grant_id IS NOT NULL);
-- CHECK (read-only, all-true multi-row block; every row must read ok = true):
--    SELECT 'forced RLS still on' AS what, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'books_action_step') AS ok
--    UNION ALL SELECT 'insert-only trigger still on', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.books_action_step'::regclass AND tgname = 'books_action_step_insert_only')
--    UNION ALL SELECT 'cb_app: no UPDATE, no DELETE', NOT has_table_privilege('cb_app', 'public.books_action_step', 'UPDATE') AND NOT has_table_privilege('cb_app', 'public.books_action_step', 'DELETE')
--    UNION ALL SELECT 'role admits staff', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.books_action_step'::regclass AND conname = 'books_action_step_role_check') LIKE '%staff%'
--    UNION ALL SELECT 'kind admits event', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.books_action_step'::regclass AND conname = 'books_action_step_kind_check') LIKE '%event%'
--    UNION ALL SELECT 'staff insert policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'books_action_step' AND policyname = 'action_insert_staff' AND cmd = 'INSERT');
-- RLS: stated above (forced; select by store; insert by the firm with a live adviser grant, by the owner for its own store, and now by the store's own staff for a PREPARED step with no grant).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_role_check;
ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_role_check CHECK (role IN ('maker', 'checker', 'owner', 'delegated', 'staff'));
ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_kind_check;
ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_kind_check CHECK (kind IN ('journal', 'reverse', 'lock', 'unlock', 'year_close', 'event'));
-- a firm's prepared or reviewed step still names its grant; the shop's own staff step names none
ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_grant_on_firm_steps;
ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_grant_on_firm_steps CHECK (step NOT IN ('prepared', 'reviewed') OR grant_id IS NOT NULL OR role = 'staff');
-- a staff step is only ever the first one, and never names a grant
ALTER TABLE books_action_step DROP CONSTRAINT IF EXISTS books_action_step_staff_shape;
ALTER TABLE books_action_step ADD CONSTRAINT books_action_step_staff_shape CHECK (role <> 'staff' OR (step = 'prepared' AND grant_id IS NULL AND kind IN ('event', 'journal')));

DROP POLICY IF EXISTS action_insert_staff ON books_action_step;
CREATE POLICY action_insert_staff ON books_action_step FOR INSERT
  WITH CHECK (store = NULLIF(current_setting('app.current_entity', true), '')::uuid
    AND step = 'prepared' AND role = 'staff' AND grant_id IS NULL AND kind IN ('event', 'journal'));

COMMIT;
