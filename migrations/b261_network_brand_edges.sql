-- b261_network_brand_edges.sql — a store may sit in MANY brands' networks, and still has ONE place on the tree.
--
-- Athi, 2026-09-17: *"a store can have catalogue of many brands and be part of many networks"* — and *"using our network
-- architecture … if some other existing store wants to join, the network has to approve, we have that logic already."*
--
-- The logic is src/services/network.js (cb_edge). Its one obstacle is an index written when every edge was a TREE edge:
-- `cb_edge_one_live_parent` allows ONE live edge per child, of any type. So a store that joined one brand could never
-- join a second. The tree rule belongs to `governance` edges only; a brand's network of stores is a `commercial` edge
-- (already an allowed type), which never moves the tree.
--
--   cb_edge_one_live_parent   one live GOVERNANCE parent per child (the tree, unchanged in meaning)
--   cb_edge_one_live_pair     at most one open COMMERCIAL edge per brand–store pair (no duplicate requests)
--
-- ⚠️ RUN IN THE SUPABASE SQL EDITOR (owner) — DDL. Safe to re-run.
-- ⚠️ BEFORE: the code already works without this, one network per store; with it, many.
--
-- CHECK FIRST (should return no rows — two open commercial edges for one pair would stop the second index):
--   SELECT parent_id, child_id, count(*) FROM cb_edge
--    WHERE type = 'commercial' AND state IN ('requested','active','suspended') GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Rollback:
--   DROP INDEX IF EXISTS cb_edge_one_live_pair;
--   DROP INDEX IF EXISTS cb_edge_one_live_parent;
--   CREATE UNIQUE INDEX cb_edge_one_live_parent ON cb_edge (child_id) WHERE state IN ('active','suspended');

BEGIN;

DROP INDEX IF EXISTS cb_edge_one_live_parent;
CREATE UNIQUE INDEX IF NOT EXISTS cb_edge_one_live_parent
  ON cb_edge (child_id) WHERE type = 'governance' AND state IN ('active', 'suspended');

CREATE UNIQUE INDEX IF NOT EXISTS cb_edge_one_live_pair
  ON cb_edge (parent_id, child_id) WHERE type = 'commercial' AND state IN ('requested', 'active', 'suspended');

-- the membership read walks edges by child and type
CREATE INDEX IF NOT EXISTS cb_edge_child_type ON cb_edge (child_id, type, state);

COMMIT;

-- PROOFS (expect: two rows, the predicates as written above)
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'cb_edge' AND indexname IN ('cb_edge_one_live_parent', 'cb_edge_one_live_pair') ORDER BY indexname;
