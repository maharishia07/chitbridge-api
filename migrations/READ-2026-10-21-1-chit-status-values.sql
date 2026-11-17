-- READ-2026-10-21-1 · K-DB / DB-72 · every chit_status.current_status value production holds, with counts, before any CHECK is written
-- READ-ONLY. Paste the ONE json value back. The CHECK (NOT VALID, then VALIDATE) is written only from this paste, never from the code's list.
SELECT json_build_object(
  'rows', (SELECT count(*) FROM chit_status),
  'null_status', (SELECT count(*) FROM chit_status WHERE current_status IS NULL),
  'values', (SELECT json_agg(t ORDER BY t.n DESC) FROM (
               SELECT current_status AS status, count(*) n, count(*) FILTER (WHERE direction = 'sent') sent,
                      count(*) FILTER (WHERE direction = 'received') received, to_char(max(updated_at), 'YYYY-MM-DD') last_seen
                 FROM chit_status GROUP BY 1) t),
  'odd_spelling', (SELECT json_agg(DISTINCT current_status) FROM chit_status
                    WHERE current_status IS NOT NULL AND current_status !~ '^[a-z_]+$')
) AS chit_status_values;
