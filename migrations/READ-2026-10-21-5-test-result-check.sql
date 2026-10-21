-- READ-2026-10-21-5-test-result-check.sql · DB-8 (b221 v2, step 5 of 5) · READ-ONLY, after the monthly -5 and -6. Paste the row back.
-- Source: C:/dev/sql-to-run/2026-10-18/b221-5-check.sql (now marked SUPERSEDED).
SELECT (SELECT count(*) FROM test_result)        AS detail_rows_left,
       (SELECT count(*) FROM test_result_month)  AS summary_rows,
       (SELECT min(at)::date FROM test_result)   AS oldest_detail,
       (SELECT min(month) FROM test_result_month) AS oldest_summary;
