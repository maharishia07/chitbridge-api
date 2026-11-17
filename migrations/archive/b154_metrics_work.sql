-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b154 — cycle time and throughput, added to the metrics schema.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-14: *"this is work management. What you are saying is history, his effort, time management etc,
-- which requires different structure storing that data — we have to [see] whether we can extract or not."*
--
-- Mostly we can, and this file is the proof. `chit_line_assignment` has been append-only with seq and created_at
-- since b143: every reassignment, every date change and every mark-done is a timestamped row that was never
-- overwritten. So cycle time and throughput are a QUERY, not a new structure — the event log was already there,
-- being written for a different reason.
--
-- ⚠️ A SEPARATE FILE BECAUSE b151 IS ALREADY APPLIED. Editing a migration that has run is how two environments
-- end up believing they are the same version while holding different schemas. b151 stands as it ran; this adds.
--
-- ── ⚠️⚠️ THE PRIVACY TRAP IN THIS PARTICULAR DATA ───────────────────────────────────────────────────────────────
-- Assignment is the PRIVATE half of the rail. lib/assign.js opens by saying the counterparty must never learn
-- that Murugan has their onions, because that is headcount, capacity and who is behind on what.
--
-- The obvious shape for "throughput" is per-person — and it is exactly the shape that must not exist here. The
-- metrics schema is read by a BI tool with NO entity context, so a per-person view would put one customer's staff
-- names, and how fast each of them works, on an operator dashboard. That is worse than the cross-tenant order-book
-- leak b151 was built to prevent, because it is about identifiable people rather than commercial figures.
--
-- So NOTHING BELOW IS PER PERSON OR PER TENANT. Everything aggregates to the platform and to a week. "How long
-- does work take on this rail" is answerable; "how fast is laxman" is not, and must not become answerable here.
-- If Athi ever wants per-person figures they belong INSIDE the app, under RLS, visible only to the entity that
-- employs those people.
--
-- ⚠️ AND b151'S OWN GUARD WOULD NOT HAVE CAUGHT IT. Its assertion lists entity_id, chit_id, particulars and
-- friends — all identifiers of RECORDS, none of PEOPLE. A view exposing `assignee_name` would have passed clean.
-- The guard is widened here to the columns that name a human, because the next person adding a view will read
-- neither this header nor b151's.
--
-- Safe to re-run. Read-only: creates two views and tightens one assertion.

-- ── ① CYCLE TIME — how long work actually takes, first assignment to done ──────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.f_cycle_time()
RETURNS TABLE (week date, lines_done bigint, avg_days numeric, median_days numeric, p90_days numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH started AS (
    /* The FIRST time anyone was put on this line. Append-only means this is simply the earliest row. */
    SELECT entity_id, chit_id, line_id, min(created_at) AS at
      FROM chit_line_assignment
     GROUP BY 1, 2, 3
  ), finished AS (
    /* The LATEST row, and only if it says done — so a line marked done and then reopened correctly stops
       counting as finished, rather than being frozen as a completion that was taken back. */
    SELECT DISTINCT ON (entity_id, chit_id, line_id) entity_id, chit_id, line_id, created_at AS at, state
      FROM chit_line_assignment
     ORDER BY entity_id, chit_id, line_id, seq DESC
  )
  SELECT date_trunc('week', f.at)::date                                            AS week,
         count(*)                                                                  AS lines_done,
         round(avg(extract(epoch FROM f.at - s.at) / 86400.0)::numeric, 2)         AS avg_days,
         round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM f.at - s.at) / 86400.0)::numeric, 2)  AS median_days,
         /* ⚠️ THE MEDIAN AND THE p90 TOGETHER, NEVER THE AVERAGE ALONE. One line stuck for three months drags a
            mean into meaninglessness while the median says the work is fine — and the gap between them IS the
            finding. An average on its own would hide exactly the tail worth looking at. */
         round(percentile_cont(0.9) WITHIN GROUP (
                 ORDER BY extract(epoch FROM f.at - s.at) / 86400.0)::numeric, 2)  AS p90_days
    FROM finished f
    JOIN started s USING (entity_id, chit_id, line_id)
   WHERE f.state = 'done'
   GROUP BY 1
$$;
CREATE OR REPLACE VIEW metrics.cycle_time AS SELECT * FROM metrics.f_cycle_time();

-- ── ② THROUGHPUT — how much work moved, and how much churn it took ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.f_throughput()
RETURNS TABLE (week date, lines_assigned bigint, lines_done bigint, people_active bigint,
               handovers bigint, dates_moved bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ev AS (
    SELECT a.*,
           /* Did this row hand the line to someone ELSE, or move the date? Comparing each row with the one
              before it is the whole reason the table is append-only rather than an UPDATE. */
           lag(a.assignee_actor_id) OVER w AS prev_actor,
           lag(a.due_date)          OVER w AS prev_due,
           lag(a.state)             OVER w AS prev_state
      FROM chit_line_assignment a
    WINDOW w AS (PARTITION BY a.entity_id, a.chit_id, a.line_id ORDER BY a.seq)
  )
  SELECT date_trunc('week', created_at)::date AS week,
         count(*) FILTER (WHERE prev_actor IS NULL)                              AS lines_assigned,
         count(*) FILTER (WHERE state = 'done' AND COALESCE(prev_state,'open') <> 'done') AS lines_done,
         /* ⚠️ COUNTED, NEVER NAMED — see the header. How many people were working is a platform figure; WHICH
            people, and how fast each one is, belongs inside the tenant and nowhere near a BI tool. */
         count(DISTINCT assignee_actor_id) FILTER (WHERE assignee_actor_id IS NOT NULL) AS people_active,
         count(*) FILTER (WHERE prev_actor IS NOT NULL AND assignee_actor_id IS DISTINCT FROM prev_actor) AS handovers,
         count(*) FILTER (WHERE prev_due IS NOT NULL AND due_date IS DISTINCT FROM prev_due)              AS dates_moved
    FROM ev
   GROUP BY 1
$$;
CREATE OR REPLACE VIEW metrics.throughput AS SELECT * FROM metrics.f_throughput();

GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO cb_metrics;

-- ── ⚠️ THE ANTI-LEAK ASSERTION, WIDENED TO PEOPLE ─────────────────────────────────────────────────────────────
DO $$
DECLARE leaks int; who int;
BEGIN
  SELECT count(*) INTO leaks
    FROM information_schema.columns
   WHERE table_schema = 'metrics'
     AND column_name IN ('entity_id', 'chit_id', 'line_id', 'identity_id', 'particulars',
                         'manual_subject', 'auto_subject', 'sender_entity_display_name', 'raw_text');
  IF leaks > 0 THEN
    RAISE EXCEPTION 'b154: a metrics view exposes % row-identifying column(s).', leaks;
  END IF;

  /* b151 guarded RECORD identifiers and no PERSON ones — a view exposing assignee_name would have passed it
     clean. Assignment is the private half of the rail; a name here would put one customer's staff, and how fast
     each of them works, on an operator dashboard. */
  SELECT count(*) INTO who
    FROM information_schema.columns
   WHERE table_schema = 'metrics'
     AND (column_name IN ('assignee_name', 'assignee_actor_id', 'actor_id', 'display_name',
                          'recorded_by_name', 'recorded_by_actor_name', 'assigned_by_name', 'email', 'phone')
       OR column_name LIKE '%_name');
  IF who > 0 THEN
    RAISE EXCEPTION 'b154: a metrics view exposes % column(s) naming a PERSON. Aggregate to a count instead — per-person figures belong inside the app under RLS, never in a schema a BI tool reads with no entity context.', who;
  END IF;

  RAISE NOTICE 'b154: cycle_time + throughput added. 8 views, none per-person, none per-tenant.';
  RAISE NOTICE 'b154: elapsed time is now extractable. EFFORT is not — it is captured as b152 add-events in hours, not derived.';
END $$;

-- ── ⚠️ WHAT THIS STILL CANNOT ANSWER, SO NOBODY GOES LOOKING ───────────────────────────────────────────────────
--
-- STAGE DWELL TIME — "how long do orders sit in accepted before anyone starts?" chit_status is written with
-- UPDATE ... SET current_status, in place, with no history table anywhere. Those transitions are destroyed as
-- they happen, and no query will recover the past ones. It needs a small append-only table written by the same
-- route that already does the update. NOT built here: it is capture, not extraction, and Athi has not asked.
--
-- EFFORT, as distinct from ELAPSED. "Assigned Monday, done Friday" is above. "Four hours of work" is not, and
-- never will be derivable — the two differ by however long the thing sat waiting. Effort is already capturable
-- with no new structure: a b152 'add' event with unit='hour' ("Labour · 1.5 hour · ₹900") is a time entry that is
-- stamped, attributed, and totals in money while refusing to total across units.
