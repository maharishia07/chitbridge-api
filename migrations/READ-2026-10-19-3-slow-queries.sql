-- READ-2026-10-19-3-slow-queries.sql · DB-5 (plan topic 7d) · census 3 of 4 · READ-ONLY.
--
-- WHAT IT DOES: the slowest statements the database has seen, from the pg_stat_statements extension (Supabase has it on by default):
--    by_total   the 25 statements with the most time in total (where the database spends its day)
--    by_mean    the 15 slowest on average, among those called at least 5 times (what one screen waits for)
--    The text is the normalised statement ($1, $2 … in place of values), cut to 300 characters, so no customer data travels.
--
-- READ-ONLY: SELECT on a statistics view. It writes nothing, creates nothing, and does NOT reset the counters.
-- HOW: Supabase SQL editor, as postgres. One statement → ONE row, ONE column ("slow_queries"). Copy the JSON value and paste it back to Claude.
-- IF IT FAILS with 'relation "pg_stat_statements" does not exist' (42P01): the extension is off. Paste that error back; that is the answer.
SELECT jsonb_build_object(
  'census', 'READ-2026-10-19-3 slow queries',
  'at',     now(),
  'db',     current_database(),
  'by_total', (SELECT jsonb_agg(q ORDER BY ord) FROM (
                 SELECT row_number() OVER (ORDER BY s.total_exec_time DESC) AS ord,
                        jsonb_build_object('role', r.rolname, 'calls', s.calls, 'total_ms', round(s.total_exec_time::numeric),
                                           'mean_ms', round(s.mean_exec_time::numeric, 1), 'rows', s.rows,
                                           'sql', left(regexp_replace(s.query, '\s+', ' ', 'g'), 300)) AS q
                   FROM pg_stat_statements s LEFT JOIN pg_roles r ON r.oid = s.userid
                  WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                  ORDER BY s.total_exec_time DESC LIMIT 25) a),
  'by_mean',  (SELECT jsonb_agg(q ORDER BY ord) FROM (
                 SELECT row_number() OVER (ORDER BY s.mean_exec_time DESC) AS ord,
                        jsonb_build_object('role', r.rolname, 'calls', s.calls, 'mean_ms', round(s.mean_exec_time::numeric, 1),
                                           'max_ms', round(s.max_exec_time::numeric), 'rows', s.rows,
                                           'sql', left(regexp_replace(s.query, '\s+', ' ', 'g'), 300)) AS q
                   FROM pg_stat_statements s LEFT JOIN pg_roles r ON r.oid = s.userid
                  WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND s.calls >= 5
                  ORDER BY s.mean_exec_time DESC LIMIT 15) b)
) AS slow_queries;
