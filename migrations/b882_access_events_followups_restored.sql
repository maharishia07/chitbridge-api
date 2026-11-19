-- b882 · the Undo of a hand-over of follow-ups (PATCH /api/crm/followups) leaves one access_events row (S40 audit_logged): the action list gains 'followups_restored'.
-- Every value allowed before stays allowed (the list is b866's plus one). Additive and idempotent; run it BEFORE the code deploys, or the row is refused, counted as audit_lost and the Undo still succeeds.
ALTER TABLE access_events DROP CONSTRAINT IF EXISTS access_events_action_check;
ALTER TABLE access_events ADD CONSTRAINT access_events_action_check
  CHECK (action IN ('created', 'hat_changed', 'costs_changed', 'break_changed', 'removed', 'reactivated', 'reach_changed', 'code_issued', 'books_grant_given', 'books_grant_changed', 'books_grant_revoked', 'books_delegated_first', 'books_delegated_unlock', 'books_delegated_year_close', 'followups_restored'));
