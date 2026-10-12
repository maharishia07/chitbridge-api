-- b299_created_at_timestamptz.sql — M210: the columns a shop's DAY is cut from become `timestamptz` (known fault "day-close breaks past midnight").
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER TABLE needs the table owner, cb_app cannot).
--    Written offline, read, never executed. Safe to re-run: each column is converted only while it is still
--    `timestamp without time zone` (information_schema check), so a second run does nothing.
--    ORDER: the code of round M210 lands FIRST (it is right before and after this runs); this file second, any time after.
--
-- WHY. chit_header.created_at is `timestamp WITHOUT time zone`: the database stamps now() in ITS zone and the server reads
--    the value back in ITS zone. Live (DB UTC + server UTC) both midnight sales land on the right day only because both clocks
--    happen to be UTC. DB UTC + server IST puts a 00:05 IST sale on the PREVIOUS day; DB IST + server UTC puts a 23:55 sale on
--    the NEXT day — counted in the wrong day's close. A timestamptz names one instant; the shop's zone (identities.timezone, b176)
--    then decides the day, in code (lib/books-hooks.dayOf / dayBounds), once.
--
-- ASSUMPTION the USING clause rests on: the naive values ARE UTC wall clocks — true on Supabase (timezone = UTC) and now pinned by
--    db/index.js on every connection (SET TimeZone 'UTC' on connect, SET LOCAL in every BEGIN). A database that ever ran in another
--    zone must say that zone instead of 'UTC' below for the rows it stamped then — check first:  SHOW timezone;  (expect UTC).
--
-- WHICH COLUMNS (every one that buckets by day, found in 000_baseline / b195 / b197 — and why):
--    chit_header.created_at            the day close window (books-store counterBills · countersBilling · unpostedChits), the chit
--                                      lists' date filter (routes/chits.js chitFilters), classify()'s fallback moment, the nightly sweep
--    chit_header.sent_at               classify()'s posting moment (billed_at → sent_at → created_at), tax-copy's window, governance's "sent today"
--    chit_status.retention_expires_at  retention: compared with now() — a naive value read in the wrong zone retires 5½ h early or late
--    LEFT AS THEY ARE, on purpose (not day-bucketed, or a function declares their type and would break on RETURN QUERY):
--      chit_status.read_at · updated_at · deleted_at   returned by chit_participants() / chit_participant_parity() (000_baseline_part2, b50)
--                                                      as `timestamp` — converting the column without re-creating both functions breaks them
--      identities.created_at · last_active_at           the ops entity list's `::date` (joined / last seen, platform-wide, UTC is right there)
--                                                      and ops.f_standing_of(p_last_active timestamp, …) (b242) takes the naive type: its own round
--      chit_status.created_at · updated_at · assigned_at · archived_at · snoozed_until · cancel_requested_at · cancel_confirmed_at,
--      chit_detail.*_at, connections.*, state_log.created_at, entity_actor_settings / entity_schemas / schema_fields   audit stamps, never a day
--
-- RLS: UNCHANGED — chit_header and chit_status keep their b49 policies (expressions on entity_id); a column's type change does not
--    touch a policy, a trigger or a default (now() is already timestamptz; `now() + '90 days'` likewise).
--
-- LOCK / SIZE NOTE for the owner: ALTER COLUMN … TYPE … USING REWRITES the table and rebuilds its indexes
--    (idx_chit_header_entity_created, idx_chit_header_sender, cs_retire_due's partial scan) under an ACCESS EXCLUSIVE lock — every
--    read and write of that table waits for the rewrite. Time is proportional to size; run off-peak; one table per transaction so
--    the lock on chit_status does not wait on chit_header's rewrite. Size first:
--      SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relname IN ('chit_header','chit_status');
--    (Postgres 12+ skips the rewrite for timestamp→timestamptz ONLY without a USING clause and with the session zone at UTC; the
--    explicit USING is kept because it states the assumption and does not depend on the editor's session.)

-- ── 1 · chit_header ─────────────────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chit_header'
              AND column_name = 'created_at' AND data_type = 'timestamp without time zone') THEN
    ALTER TABLE chit_header ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chit_header'
              AND column_name = 'sent_at' AND data_type = 'timestamp without time zone') THEN
    ALTER TABLE chit_header ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';
  END IF;
END $$;
COMMIT;

-- ── 2 · chit_status ─────────────────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chit_status'
              AND column_name = 'retention_expires_at' AND data_type = 'timestamp without time zone') THEN
    ALTER TABLE chit_status ALTER COLUMN retention_expires_at TYPE timestamptz USING retention_expires_at AT TIME ZONE 'UTC';
  END IF;
END $$;
COMMIT;

-- check after (expect 3 rows, all 'timestamp with time zone'):
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--    WHERE (table_name, column_name) IN (('chit_header','created_at'), ('chit_header','sent_at'), ('chit_status','retention_expires_at'));
-- and a known bill keeps its instant (pick one billed near midnight IST; the day is the shop's, the clock reads 'Z'):
--   SELECT chit_id, created_at, created_at AT TIME ZONE 'Asia/Kolkata' AS ist FROM chit_header ORDER BY created_at DESC LIMIT 3;
