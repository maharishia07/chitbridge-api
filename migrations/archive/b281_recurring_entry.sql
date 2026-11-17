-- b281_recurring_entry.sql — DRAFT — NOT RUN · Athi runs it.
--
-- WHY: the owner's repeating journal entries (rent, a loan's interest, a retainer, insurance) and the daily sweep that walks them
-- (lib/books-recurring.js; Part of CB Accounts' To-do). A template is an EVENT — the same shape POST /api/books/events takes, without its
-- date and client_ref — plus how often it comes round and the next day it falls due. Each day the sweep PROPOSES a due template on the
-- To-do (the default) or, when the template says auto, posts it as an owner-made MJ entry with client_ref = template + date, so a re-run
-- never posts twice. The same sweep posts an accrual's reversal on the first day of the next period (api #17).
-- Until this runs every /api/books/recurring route answers 503 BOOKS_NOT_MIGRATED and the sweep skips the templates quietly (named once).
--
-- RUN AS postgres IN THE SUPABASE SQL EDITOR (it creates a table, a policy and grants). Needs b272 + b273 first. Safe to re-run.
-- The template holds no money of its own that the books read: what posts is whatever the event builds on the day, through the one writer.
-- The books stay insert-only: a template is stopped (active = false), never deleted — and what it posted stays in the journal.
--
-- Check row after:  SELECT count(*) FROM recurring_entry;   → 0
CREATE TABLE IF NOT EXISTS recurring_entry (
  recurring_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  name          text NOT NULL,                       -- what the owner calls it: "Shop rent"
  event         jsonb NOT NULL,                      -- { kind, …fields } as POST /api/books/events takes it, WITHOUT date and client_ref
  frequency     text NOT NULL,                       -- monthly · quarterly · yearly
  next_on       date NOT NULL,                       -- the day the next one falls due
  anchor_day    smallint NOT NULL,                   -- the day of the month it keeps to (a 31st that met February comes back to the 31st)
  end_on        date,                                -- the last day it may fall due (null = until stopped)
  auto          boolean NOT NULL DEFAULT false,      -- false: proposed on the To-do for the owner to accept · true: posted by the sweep
  active        boolean NOT NULL DEFAULT true,
  last_done_on  date,                                -- the due day last posted or skipped
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recurring_entry DROP CONSTRAINT IF EXISTS recurring_entry_frequency_chk;
ALTER TABLE recurring_entry ADD CONSTRAINT recurring_entry_frequency_chk CHECK (frequency IN ('monthly', 'quarterly', 'yearly'));
ALTER TABLE recurring_entry DROP CONSTRAINT IF EXISTS recurring_entry_anchor_chk;
ALTER TABLE recurring_entry ADD CONSTRAINT recurring_entry_anchor_chk CHECK (anchor_day BETWEEN 1 AND 31);
CREATE INDEX IF NOT EXISTS recurring_entry_due_idx ON recurring_entry (entity_id, next_on) WHERE active;
ALTER TABLE recurring_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_entry FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON recurring_entry;
CREATE POLICY rls_entity ON recurring_entry
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE DELETE ON recurring_entry FROM cb_app;          -- a template is stopped, never deleted
GRANT SELECT, INSERT, UPDATE ON recurring_entry TO cb_app;
