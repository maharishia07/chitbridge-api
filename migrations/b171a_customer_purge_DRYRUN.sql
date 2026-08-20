-- b171a — DRY RUN. Counts only. DELETES NOTHING. Run this first.
--
-- Athi, 2026-08-20: *"We can remove the old customer details, we are in testing phase, just drop them down."*
-- The goal is §23 of IAM-BUSINESS-TAB-SPEC.md — moving the customer .cr handle from the Bridge ID to the
-- readable User ID. Rather than migrate existing handles, drop the test customers and let them re-register
-- under the new scheme.
--
-- ⚠️⚠️ "DROP THE CUSTOMERS" IS NOT ONE DELETE. identities is referenced by chit_header, chit_detail,
-- chit_messages, chit_disputes, chit_status and customer_list, and NONE of those foreign keys cascade. A plain
-- DELETE fails on the first constraint. Actually removing a customer means removing EVERY ORDER THEY PLACED,
-- plus the messages and disputes on those orders.
--
-- That may be entirely fine in a testing phase. It is still a different sentence from "remove the customer
-- details", and it should be decided against real numbers rather than an assumption. Hence this file.

\echo '=== customer identities ==='
SELECT count(*) AS customers FROM identities WHERE identity_type = 'customer';

\echo '=== ...and which shop they belong to ==='
SELECT e.display_name AS shop, e.user_id, count(c.*) AS customers
  FROM identities c
  JOIN identities e ON e.identity_id = c.parent_entity_id
 WHERE c.identity_type = 'customer'
 GROUP BY e.display_name, e.user_id
 ORDER BY count(c.*) DESC;

\echo '=== what would have to go with them ==='
WITH cust AS (SELECT identity_id FROM identities WHERE identity_type = 'customer')
SELECT 'chit_header'   AS table_name, count(*) FROM chit_header   WHERE entity_id IN (SELECT identity_id FROM cust)
UNION ALL SELECT 'chit_detail',   count(*) FROM chit_detail   WHERE entity_id IN (SELECT identity_id FROM cust)
UNION ALL SELECT 'chit_status',   count(*) FROM chit_status   WHERE entity_id IN (SELECT identity_id FROM cust)
UNION ALL SELECT 'chit_messages', count(*) FROM chit_messages WHERE sender_entity_id IN (SELECT identity_id FROM cust)
                                                                 OR visibility_entity_id IN (SELECT identity_id FROM cust)
UNION ALL SELECT 'chit_disputes', count(*) FROM chit_disputes WHERE raised_by_entity_id   IN (SELECT identity_id FROM cust)
                                                                 OR resolved_by_entity_id IN (SELECT identity_id FROM cust)
                                                                 OR target_entity_id      IN (SELECT identity_id FROM cust)
UNION ALL SELECT 'customer_list', count(*) FROM customer_list WHERE customer_identity_id IN (SELECT identity_id FROM cust);

\echo '=== entities with NO user_id — customers here CANNOT get a readable handle yet ==='
SELECT display_name, bridge_id
  FROM identities
 WHERE identity_type = 'entity' AND user_id IS NULL
 ORDER BY display_name;

\echo ''
\echo 'DRY RUN COMPLETE — nothing was deleted.'
\echo 'Read the numbers. If they are acceptable, run b171b_customer_purge_APPLY.sql.'
