-- b171a — DRY RUN. Counts only. DELETES NOTHING. Run this first.
--
-- Athi, 2026-08-20: *"We can remove the old customer details, we are in testing phase, just drop them down."*
-- The goal is IAM-SPEC §23 — moving the customer .cr handle from the Bridge ID to the readable User ID.
-- Rather than migrate existing handles, drop the test customers and let them re-register under the new scheme.
--
-- ⚠️⚠️ "DROP THE CUSTOMERS" IS NOT ONE DELETE. identities is referenced by chit_header, chit_detail,
-- chit_messages, chit_disputes, chit_status and customer_list, and NONE of those foreign keys cascade. A plain
-- DELETE fails on the first constraint. Actually removing a customer means removing EVERY ORDER THEY PLACED,
-- plus the messages and disputes on those orders. That may be entirely fine in a testing phase — it is still a
-- different sentence from "remove the customer details", and should be decided against real numbers.
--
-- ⚠️ NO psql META-COMMANDS. The first version used \echo for section headings and failed immediately with
-- "syntax error at or near \" — because Athi runs these in the Supabase SQL editor, which speaks SQL and not
-- psql. Every label below is therefore a plain column. Same lesson for every future migration here.

-- 1 · how many customers, and whose
SELECT 'customers by shop' AS report,
       e.display_name       AS shop,
       e.user_id            AS shop_user_id,
       count(c.*)           AS customers
  FROM identities c
  JOIN identities e ON e.identity_id = c.parent_entity_id
 WHERE c.identity_type = 'customer'
 GROUP BY e.display_name, e.user_id
 ORDER BY count(c.*) DESC;

-- 2 · the total
SELECT 'total customers' AS report, count(*) AS n
  FROM identities WHERE identity_type = 'customer';

-- 3 · ⚠️ WHAT WOULD HAVE TO GO WITH THEM. This is the number that decides it.
WITH cust AS (SELECT identity_id FROM identities WHERE identity_type = 'customer')
SELECT 'would also be deleted' AS report, t.table_name, t.n
  FROM (
        SELECT 'chit_header'   AS table_name, count(*) AS n FROM chit_header   WHERE entity_id IN (SELECT identity_id FROM cust)
  UNION ALL SELECT 'chit_detail',   count(*) FROM chit_detail   WHERE entity_id IN (SELECT identity_id FROM cust)
  UNION ALL SELECT 'chit_status',   count(*) FROM chit_status   WHERE entity_id IN (SELECT identity_id FROM cust)
  UNION ALL SELECT 'chit_messages', count(*) FROM chit_messages WHERE sender_entity_id     IN (SELECT identity_id FROM cust)
                                                                   OR visibility_entity_id IN (SELECT identity_id FROM cust)
  UNION ALL SELECT 'chit_disputes', count(*) FROM chit_disputes WHERE raised_by_entity_id   IN (SELECT identity_id FROM cust)
                                                                   OR resolved_by_entity_id IN (SELECT identity_id FROM cust)
                                                                   OR target_entity_id      IN (SELECT identity_id FROM cust)
  UNION ALL SELECT 'customer_list', count(*) FROM customer_list WHERE customer_identity_id IN (SELECT identity_id FROM cust)
  ) t
 ORDER BY t.n DESC;

-- 4 · entities with NO user_id — customers of these shops cannot get a readable handle yet.
--     If more than one row comes back, fix the pattern rather than writing a migration per shop.
SELECT 'entity missing user_id' AS report, display_name, bridge_id
  FROM identities
 WHERE identity_type = 'entity' AND user_id IS NULL
 ORDER BY display_name;

-- NOTHING WAS DELETED. Read the numbers. If they are acceptable, run b171b_customer_purge_APPLY.sql.
