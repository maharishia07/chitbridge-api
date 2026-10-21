-- b619 · DRY RUN — does the 20-second notifications poll have the index it needs? Reads only; changes nothing.
--
-- SEC-SMALL item 6 (2026-10-14) said "the 20-second notifications poll is unindexed". Checked against the code and the
-- baseline before writing this: it is NOT unindexed on paper —
--     idx_state_log_entity (entity_id, created_at DESC)   000_baseline_part2.sql:265
--     the 90-day bound  sl.created_at > now() - interval '90 days'   routes/notifications.js (fb9c5615, review M21)
--     RLS pins entity_id = app.current_entity on state_log (b49), so the planner always has the leading column
--     the join sides: idx_chit_status_chit (chit_id) · idx_chit_header_chit (chit_id) · notif_dismissed PK (entity_id, log_id)
-- What no index removes is the DISTINCT ON sort over one shop's 90 days of events. Whether that is the cost, or the
-- index is missing on THIS database, is a question only the live plan answers — so this file asks it, the b180 way.
--
-- ⚠️ RUN AS THE APPLICATION ROLE for the plan the api actually gets: `SET ROLE cb_app;` first. A superuser bypasses
--    RLS and sees a different plan. Replace the two uuids: the shop's entity_id and the caller's identity_id.
-- ⚠️ EXPLAIN ANALYZE RUNS THE STATEMENT. It is a read; it writes nothing; it takes as long as one poll takes.
--
-- READ THE PLAN FOR TWO THINGS:
--   1. `Index Scan using idx_state_log_entity` (or a Bitmap scan on it) with `Index Cond: entity_id = ... AND created_at > ...`
--      → the index is serving the read. If instead you see `Seq Scan on state_log`, the index is missing here: run b620.
--   2. the `Sort` (or `Unique`) node's `rows=` — that is the DISTINCT ON over the 90-day window. If it is in the tens of
--      thousands for a busy shop, the answer is a shorter window (NOTIF_FEED_DAYS on the host), not another index.
--
-- RLS: this file creates nothing and changes no policy.

SET ROLE cb_app;
SELECT set_config('app.current_entity', '00000000-0000-0000-0000-000000000000', false);   -- the shop (entity_id)

-- ⚠️ THE STATEMENT BELOW IS THE LIVE FEED, VERBATIM (routes/notifications.js FEED_FROM with lib/bill-privacy rendered;
--    tests/notif-feed-dryrun.test.cjs fails if the two drift). $1 = the shop, $2 = the caller, 90 = NOTIF_FEED_DAYS.
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM (
  SELECT DISTINCT ON (sl.chit_id, sl.action, sl.created_at, sl.detail)
         sl.log_id, sl.chit_id, sl.action, sl.created_at
  FROM state_log sl
         JOIN chit_status cs
           ON cs.chit_id = sl.chit_id AND cs.entity_id = '00000000-0000-0000-0000-000000000000' AND cs.deleted_at IS NULL
         LEFT JOIN chit_header ch
           ON ch.chit_id = sl.chit_id AND ch.entity_id = '00000000-0000-0000-0000-000000000000' AND ch.direction = cs.direction
        WHERE (sl.action_by_identity_id <> '00000000-0000-0000-0000-000000000000'
               OR sl.action IN ('dispute_raised','dispute_resolved','voided'))
          AND ( sl.entity_id = '00000000-0000-0000-0000-000000000000' OR sl.action IN ('dispute_raised','dispute_resolved','voided') )
          AND NOT (COALESCE((CASE WHEN ch.sender_entity_id IS NULL THEN NULL WHEN ch.purpose IN ('order', 'offer', 'subscription') AND (COALESCE(ch.business_json->>'bill_no', '') <> '' AND COALESCE(ch.business_json->'till'->>'id', '') <> '') AND ch.sender_entity_id = cs.entity_id THEN 'bill_issued' WHEN ch.purpose IN ('order', 'offer', 'subscription') AND (COALESCE(ch.business_json->>'bill_no', '') <> '' AND COALESCE(ch.business_json->'till'->>'id', '') <> '') AND ch.sender_entity_id <> cs.entity_id THEN 'bill_received' WHEN ch.purpose IN ('invoice') AND ch.sender_entity_id <> cs.entity_id THEN 'bill_received' WHEN ch.purpose IN ('credit_note') THEN 'return' WHEN ch.purpose IN ('receipt') AND (COALESCE(btrim(ch.business_json->'their_bill'->>'no'), '') <> '' AND COALESCE(ch.business_json->'their_bill'->>'total', '') <> '') THEN 'bill_received' WHEN ch.purpose IN ('receipt') THEN 'receipt' WHEN ch.purpose IN ('general') AND ch.business_json->>'kind' = 'payment_received' THEN 'receipt' WHEN ch.purpose IN ('expense') THEN 'expense' END), '') IN ('bill_received', 'bill_issued') AND (sl.action NOT IN ('created', 'dispute_raised', 'dispute_resolved', 'voided', 'message_sent', 'bill_step')
           AND sl.action_by_identity_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'
           AND NOT EXISTS (SELECT 1 FROM identities bpi WHERE bpi.identity_id = sl.action_by_identity_id AND bpi.parent_entity_id = '00000000-0000-0000-0000-000000000000')))
          AND NOT EXISTS (SELECT 1 FROM notif_dismissed nd
                           WHERE nd.entity_id = '00000000-0000-0000-0000-000000000000' AND nd.log_id = sl.log_id)
          AND sl.created_at > now() - interval '90 days'
        ORDER BY sl.chit_id, sl.action, sl.created_at DESC, sl.detail
) d
ORDER BY d.created_at DESC
LIMIT 30;

-- what state_log already carries, so nothing is added blind
SELECT indexname, pg_size_pretty(pg_relation_size((quote_ident(schemaname) || '.' || quote_ident(indexname))::regclass)) AS size, indexdef
  FROM pg_indexes WHERE tablename = 'state_log' ORDER BY indexname;

-- verdict on the one index the plan needs
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'state_log' AND indexname = 'idx_state_log_entity')
            THEN 'idx_state_log_entity present — nothing to add; if the poll is still slow, the Sort rows above are the cost (shorten NOTIF_FEED_DAYS)'
            ELSE 'idx_state_log_entity MISSING on this database — run b620 (CONCURRENTLY, on its own)' END AS verdict;

RESET ROLE;
