-- b302_repeat_supply.sql — RI1 (2026-10-12): REPEAT SUPPLY AS AN AGREEMENT BOTH PARTIES HOLD — the living schedule beside the
--   agreement chit. The agreement itself is a CHIT (purpose 'subscription', business_json.repeat) sent through the one send path, so
--   both parties already hold the lines, the price and the terms, sealed. What a chit cannot carry is a thing that MOVES — the next
--   date, the last run, paused, ended, the customer's open counter, the skips, which run minted which invoice — and that is this table.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — it creates a table, a policy, an ops function and grants,
--    which cb_app cannot). Written offline, read, never executed. Safe to re-run (every statement is IF NOT EXISTS / OR REPLACE / guarded).
--    Until it runs: every /api/repeat route answers 503 { code: 'REPEAT_NOT_MIGRATED' } in words ("Repeat supply arrives after the
--    next update"), the nightly sweep skips quietly (named once), and the web greys the tab with the sentence — never a 500.
--
-- WHY NOT recurring_entry (b281): its `event` is a books EVENT (what POST /api/books/events takes), owner-only, RLS to the shop and
--    503 while the ledger's tables are not there — an agreement is a chit the CUSTOMER acts on (accept · counter · skip) and runs
--    whether or not the shop keeps its ledger here. The DATE MATH is shared (lib/books-recurring nextAfter, widened), not the table.
--
-- RLS: entity_id = the SELLER (the shop that made the agreement). The customer never reads this table directly: the rail route
--    (routes/repeat-supply.js) first proves the caller holds a copy of the agreement chit (its own chit_header row, under its own
--    RLS), then reads or moves the row AS the seller — the server decides, the way lib/autoraise and chit_deliver run as the sender.
--    NEVER shared across shops by policy. ops.f_repeat_supply_due is SECURITY DEFINER (ids only, the one cross-shop read, exactly as
--    ops.f_books_enabled in b272) so the nightly sweep can find the shops with a run due without the ledger being on.
--
-- Check rows after:  SELECT count(*) FROM repeat_supply;   → 0      SELECT * FROM ops.f_repeat_supply_due(current_date);   → 0 rows

BEGIN;

CREATE TABLE IF NOT EXISTS repeat_supply (
  agreement_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL,                      -- the seller (RLS)
  chit_id             uuid NOT NULL,                      -- the agreement chit both parties hold (purpose 'subscription')
  customer_entity_id  uuid NOT NULL,                      -- who accepts, counters, skips
  source_chit_id      uuid,                               -- the invoice "Repeat this…" was pressed on
  every               smallint NOT NULL DEFAULT 1,        -- every N …
  unit                text NOT NULL,                      -- daily · weekly · monthly  (lib/books-recurring nextAfter's words)
  anchor_day          smallint,                           -- monthly: the day of the month it keeps to (31 → month end in a short month)
  next_on             date NOT NULL,                      -- the next run's day, in the shop's calendar (M210)
  end_on              date,                               -- the last day a run may fall on (null = no date)
  runs_max            smallint,                           -- stop after N runs (null = no count)
  runs_done           smallint NOT NULL DEFAULT 0,
  mode                text NOT NULL DEFAULT 'draft',      -- draft: each run lands in Tasks & Orders for a person · send: each run is sent
  state               text NOT NULL DEFAULT 'proposed',   -- proposed · agreed · countered · declined · paused · ended
  terms               jsonb NOT NULL DEFAULT '{}'::jsonb, -- what was AGREED over the chit's lines: { lines: [{ line_id, quantity }], start_on }
  counter             jsonb,                              -- the customer's open proposal: { lines?, every?, unit?, start_on?, note, by, at }
  skips               jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ date, by_entity_id, reason, at }]
  runs                jsonb NOT NULL DEFAULT '{}'::jsonb, -- { 'YYYY-MM-DD': chit_id } — one run per (agreement, day), ever
  last_run_on         date,
  state_by            uuid,                               -- who moved it last (an entity or an actor)
  state_at            timestamptz,
  state_note          text,                               -- the reason given (a skip, an end, a decline)
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE repeat_supply DROP CONSTRAINT IF EXISTS repeat_supply_unit_chk;
ALTER TABLE repeat_supply ADD CONSTRAINT repeat_supply_unit_chk CHECK (unit IN ('daily', 'weekly', 'monthly'));
ALTER TABLE repeat_supply DROP CONSTRAINT IF EXISTS repeat_supply_mode_chk;
ALTER TABLE repeat_supply ADD CONSTRAINT repeat_supply_mode_chk CHECK (mode IN ('draft', 'send'));
ALTER TABLE repeat_supply DROP CONSTRAINT IF EXISTS repeat_supply_state_chk;
ALTER TABLE repeat_supply ADD CONSTRAINT repeat_supply_state_chk CHECK (state IN ('proposed', 'agreed', 'countered', 'declined', 'paused', 'ended'));
ALTER TABLE repeat_supply DROP CONSTRAINT IF EXISTS repeat_supply_every_chk;
ALTER TABLE repeat_supply ADD CONSTRAINT repeat_supply_every_chk CHECK (every BETWEEN 1 AND 365);
ALTER TABLE repeat_supply DROP CONSTRAINT IF EXISTS repeat_supply_anchor_chk;
ALTER TABLE repeat_supply ADD CONSTRAINT repeat_supply_anchor_chk CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31);
CREATE UNIQUE INDEX IF NOT EXISTS repeat_supply_chit_uq ON repeat_supply (entity_id, chit_id);   -- one agreement per agreement chit
CREATE INDEX IF NOT EXISTS repeat_supply_due_idx ON repeat_supply (entity_id, next_on) WHERE state = 'agreed';

ALTER TABLE repeat_supply ENABLE ROW LEVEL SECURITY;
ALTER TABLE repeat_supply FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON repeat_supply;
CREATE POLICY rls_entity ON repeat_supply
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE DELETE ON repeat_supply FROM cb_app;            -- an agreement is ended, never deleted — what it minted stays
GRANT SELECT, INSERT, UPDATE ON repeat_supply TO cb_app;

-- the one cross-shop read: WHICH shops have an agreed run due on or before `day` — ids only (as ops.f_books_enabled, b272)
CREATE SCHEMA IF NOT EXISTS ops;
DROP FUNCTION IF EXISTS ops.f_repeat_supply_due(date);   -- CREATE OR REPLACE cannot change a row type (42P13): drop first, grant after (tests/migration-rerunnable)
CREATE OR REPLACE FUNCTION ops.f_repeat_supply_due(day date)
RETURNS TABLE (entity_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT DISTINCT r.entity_id FROM repeat_supply r WHERE r.state = 'agreed' AND r.next_on <= day
$f$;
REVOKE ALL ON FUNCTION ops.f_repeat_supply_due(date) FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_repeat_supply_due(date) TO cb_app;

COMMIT;
