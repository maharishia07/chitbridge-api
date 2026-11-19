-- b886_access_events_practice_switch.sql — the practice switches that decide who sees which client (client_access, staff_pick_up, all_task_visible, assignment_model) leave an access_events row (l20/hunt-h1, 20 Nov 2026; ISO 27001 A.8.15, Companies Act Accounts Rules r.3(1)).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b882. Safe to repeat (DROP ... IF EXISTS first, then ADD). Run it BEFORE the code deploys, or the row is refused, counted as audit_lost, and the settings change still succeeds.
-- Every value allowed before stays allowed; the list is b882's plus 'practice_switch_changed'. Touches no rows.
ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close', 'followups_restored', 'practice_switch_changed'));
