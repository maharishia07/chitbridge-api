-- b171d — WHO are these customers and WHEN did they appear? Read-only. Deletes nothing.
--
-- b171c aborted: 71 customers found where 50 were approved twenty minutes earlier. The guard worked. Before
-- raising the number, it is worth knowing WHY it moved.
--
-- ⚠️ TWENTY-ONE NEW CUSTOMERS IN TWENTY MINUTES IS EITHER A TEST SUITE OR REAL TRAFFIC, and those want
-- opposite responses. A burst within a few seconds is a test run and safe to delete. A steady trickle across
-- the period is something actually using the storefront — and deleting a real customer's order history is not
-- recoverable.

-- 1 · when they arrived, bucketed by minute. A burst is a test; a spread is traffic.
SELECT 'by minute' AS report,
       date_trunc('minute', created_at) AS minute,
       count(*)                         AS customers
  FROM identities
 WHERE identity_type = 'customer'
 GROUP BY 1, 2
 ORDER BY 2 DESC
 LIMIT 30;

-- 2 · whose customers they are. Test shops have obvious names; a real shop does not.
SELECT 'by shop' AS report,
       e.display_name AS shop,
       e.user_id      AS shop_user_id,
       count(c.*)     AS customers,
       min(c.created_at) AS first_seen,
       max(c.created_at) AS last_seen
  FROM identities c
  LEFT JOIN identities e ON e.identity_id = c.parent_entity_id
 WHERE c.identity_type = 'customer'
 GROUP BY 1, 2, 3
 ORDER BY count(c.*) DESC;

-- 3 · the newest twenty, with their handle. The handle says how they arrived — a phone, or a test address.
SELECT 'newest' AS report,
       c.display_name,
       c.email        AS cr_handle,
       e.display_name AS shop,
       c.created_at
  FROM identities c
  LEFT JOIN identities e ON e.identity_id = c.parent_entity_id
 WHERE c.identity_type = 'customer'
 ORDER BY c.created_at DESC
 LIMIT 20;
