-- b296_close_posted_counter_sales.sql — DRAFT — NOT RUN · Athi runs it. Round 2 of the walk, "STUCK = 0" (2026-10-09).
--
-- WHY: the till sends every counter sale — and every day / week / month summary — as a chit to its OWN shop. The sale reaches the books
-- through the day's walk-in entry, but the chit's status was never closed, so after overdue_days (7) Home counted it "stuck". On Mayur
-- Bhavan 20 of the 21 stuck chits were "You sent this to your own shop"; 12 of them were "Counter sale C1/26-27/…".
-- Going forward the API closes them itself the moment the books hold them (lib/books-hooks closeDone -> routes/chits moveStatus,
-- the one status writer). THIS FILE closes the ones that were already posted BEFORE that rule, for every shop.
--
-- WHAT IT CLOSES (only the shop's OWN copy of a chit the shop SENT TO ITSELF, still OPEN: pending · delivered · read · accepted · in_progress · partial):
--   1 · a counter sale a walk-in entry already covers: named in a journal_entry.source_chit_ids (the day entry), or the entry of its own
--       (source_ref 'bill:<chit>' per-bill grain, 'walkin-late:<chit>' the late catch-up)   -> completed
--   2 · a DAY summary chit whose day entry exists (journal_entry.source_ref 'walkin:<counter>:<YYYY-MM-DD>')   -> completed
--   3 · a WEEK / MONTH summary chit (period 'week' | 'month'): the record itself, nothing to post                -> completed
-- WHAT IT NEVER TOUCHES: a counter bill to a named customer / on credit / with a GSTIN (posted as a sale_bill, it stays open until paid —
-- a real exception), an order, a note to self, a chit from anyone else, anything already completed / cancelled / rejected.
--
-- Each close writes a state_log row ('status_completed', "Posted to the books - done (b296)") like the API's own transition does.
-- NO money, NO journal entry, NO ledger row is written. Only chit_status.current_status/updated_at and state_log.
--
-- ⭐ LOOK FIRST: STEP 1 lists, per shop, what STEP 2 would close (nothing is changed by it). STEP 2 runs inside the same transaction;
--    the last line is COMMIT — change it to ROLLBACK to run the whole file as a rehearsal.
-- SAFE TO RE-RUN: a closed chit is no longer open, so a second run matches nothing.
-- RLS: chit_status and state_log are FORCE ROW LEVEL SECURITY (policy: entity_id = app.current_entity). This file sets app.current_entity
--      to each shop in turn (transaction-local), so it works as the table owner AND as any role, and never reads across shops in one statement.
-- Needs: b273 (journal_entry.source_chit_ids) - already live on the books shops.
-- Run as postgres in the Supabase SQL editor (or `railway connect`).

BEGIN;

-- the open own-sent copies this file would close, one row per chit, with WHICH rule matched
CREATE TEMP TABLE b296_todo (entity_id uuid, chit_id uuid, rule text, subject text, created_at timestamp) ON COMMIT DROP;

DO $$
DECLARE
  e uuid; shops int := 0;
BEGIN
  FOR e IN SELECT identity_id FROM identities WHERE identity_type = 'entity' LOOP
    shops := shops + 1;
    PERFORM set_config('app.current_entity', e::text, true);
    INSERT INTO b296_todo (entity_id, chit_id, rule, subject, created_at)
    SELECT e, cs.chit_id,
           CASE WHEN ch.business_json ? 'summary' AND ch.purpose = 'general' THEN
                  CASE WHEN ch.business_json->'summary'->>'period' = 'day' THEN 'day summary posted' ELSE 'week/month summary' END
                ELSE 'counter sale posted in a walk-in entry' END,
           COALESCE(ch.manual_subject, ch.auto_subject), cs.created_at
      FROM chit_status cs
      JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
     WHERE cs.entity_id = e AND cs.direction = 'received' AND ch.sender_entity_id = e
       AND cs.current_status IN ('pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial')
       AND (
            /* 3 · a week / month summary */
            (ch.purpose = 'general' AND ch.business_json ? 'summary' AND ch.business_json->'summary'->>'period' IN ('week', 'month'))
            /* 2 · a day summary whose day entry exists */
         OR (ch.purpose = 'general' AND ch.business_json ? 'summary' AND ch.business_json->'summary'->>'period' = 'day'
             AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = e AND j.source_ref LIKE 'walkin:%:' ||
                         substring(coalesce(ch.business_json->'summary'->>'key', '') from '[0-9]{4}-[0-9]{2}-[0-9]{2}')))
            /* 1 · a counter sale a walk-in entry covers */
         OR (ch.business_json ? 'bill_no' AND NOT (ch.business_json ? 'summary')
             AND EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = e
                         AND (j.source_ref IN ('bill:' || cs.chit_id::text, 'walkin-late:' || cs.chit_id::text)
                              OR cs.chit_id = ANY (j.source_chit_ids)))));
  END LOOP;
  IF shops = 0 THEN RAISE EXCEPTION 'b296: no shop is visible (identities empty) - run as postgres / the owner'; END IF;
  RAISE NOTICE 'b296: looked at % shops', shops;
END $$;

-- ═══ STEP 1 · PREVIEW — what STEP 2 closes. Read it; nothing has changed yet. ═══
SELECT i.display_name AS shop, t.rule, count(*) AS chits, min(t.created_at)::date AS oldest, max(t.created_at)::date AS newest
  FROM b296_todo t JOIN identities i ON i.identity_id = t.entity_id
 GROUP BY i.display_name, t.rule ORDER BY i.display_name, t.rule;

-- ═══ STEP 2 · CLOSE ═══
DO $$
DECLARE e uuid; k int; total int := 0;
BEGIN
  FOR e IN SELECT DISTINCT entity_id FROM b296_todo LOOP
    PERFORM set_config('app.current_entity', e::text, true);
    WITH moved AS (
      UPDATE chit_status cs SET current_status = 'completed', updated_at = NOW()
        FROM b296_todo t
       WHERE t.entity_id = e AND cs.entity_id = e AND cs.chit_id = t.chit_id AND cs.direction = 'received'
         AND cs.current_status IN ('pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial')
      RETURNING cs.chit_id, cs.entity_id
    ), logged AS (
      INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, previous_status, new_status, detail)
      SELECT m.chit_id, m.entity_id, 'status_completed', m.entity_id, 'The books', NULL, 'completed', 'Posted to the books - done (b296)'
        FROM moved m
      RETURNING 1
    )
    SELECT count(*) INTO k FROM logged;
    total := total + k;
  END LOOP;
  RAISE NOTICE 'b296: closed % chits', total;
END $$;

-- ═══ AFTER · own-sent chits still open (should be notes to self, credit bills, and summaries whose day has not posted) ═══
DO $$
DECLARE e uuid; k int; left_over int := 0;
BEGIN
  FOR e IN SELECT identity_id FROM identities WHERE identity_type = 'entity' LOOP
    PERFORM set_config('app.current_entity', e::text, true);
    SELECT count(*) INTO k FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
     WHERE cs.entity_id = e AND cs.direction = 'received' AND ch.sender_entity_id = e
       AND cs.current_status IN ('pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial');
    left_over := left_over + k;
  END LOOP;
  RAISE NOTICE 'b296: own-sent chits still open: %', left_over;
END $$;

COMMIT;   -- change to ROLLBACK for a rehearsal
