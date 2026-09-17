/**
 * network-membership.js — WHO IS IN A BRAND'S NETWORK. One answer, read from the network itself (cb_entity + cb_edge).
 *
 * Athi, 2026-09-17: *"using our network architecture if we create stores, they are already approved. If some other existing
 * store wants to join, the network has to approve — we have that logic already … do not create another branch."*
 *
 *   BUILT    a store under the brand on the tree (the network build places it there) — a member by construction, unless its
 *            own governance edge is SUSPENDED.
 *   JOINED   an existing business with an ACTIVE `commercial` edge from the brand — it asked and the brand approved, or the
 *            brand invited and it accepted (src/services/network.js). A business may hold such an edge with many brands.
 *
 * Everything a brand sends its stores — released offers, published catalogue changes, withdrawals, the push itself — and
 * everything a store sells of a brand's (lib/catalogue-build.resolve) asks this module. The adoption-based list that stood
 * in for it on 2026-09-17 (policy_flags.network_members) is no longer read.
 *
 * ⚠️ identities, cb_entity and cb_edge carry no row security; these reads are plain queries.
 */
'use strict';
const { query } = require('../db');

/**
 * isMemberSql(brandExpr, storeExpr) — a boolean SQL expression, for readers that must decide inside one statement
 * (catalogue-build's source read). Both arguments are SQL expressions yielding an identity_id as text.
 */
function isMemberSql(brandExpr, storeExpr) {
  return `EXISTS (
    SELECT 1 FROM identities bi JOIN cb_entity bc ON bc.bridge_id = bi.bridge_id,
                  identities si JOIN cb_entity sc ON sc.bridge_id = si.bridge_id
     WHERE bi.identity_id::text = (${brandExpr}) AND si.identity_id::text = (${storeExpr})
       AND ( (sc.path <@ bc.path AND sc.id <> bc.id
              AND NOT EXISTS (SELECT 1 FROM cb_edge g WHERE g.child_id = sc.id AND g.type = 'governance' AND g.state = 'suspended'))
          OR EXISTS (SELECT 1 FROM cb_edge e WHERE e.parent_id = bc.id AND e.child_id = sc.id
                        AND e.type = 'commercial' AND e.state = 'active') ))`;
}

/** the SQL for a brand's roster; $1 = brand identity_id. Rows: id, via, state, edge_id, asked_by, node_id */
const ROSTER_SQL = `
  WITH b AS (SELECT c.id, c.path FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id WHERE i.identity_id = $1)
  SELECT i.identity_id::text AS id, 'built' AS via, COALESCE(g.state, 'active') AS state, g.id::text AS edge_id,
         NULL::text AS asked_by, c.id::text AS node_id
    FROM b JOIN cb_entity c ON c.path <@ b.path AND c.id <> b.id
           JOIN identities i ON i.bridge_id = c.bridge_id AND i.identity_type = 'entity'
           LEFT JOIN cb_edge g ON g.child_id = c.id AND g.type = 'governance' AND g.state IN ('active', 'suspended')
  UNION ALL
  SELECT i.identity_id::text, 'joined', e.state, e.id::text,
         CASE WHEN e.requested_by = b.id THEN 'brand' WHEN e.requested_by = c.id THEN 'store' ELSE NULL END, c.id::text
    FROM b JOIN cb_edge e ON e.parent_id = b.id AND e.type = 'commercial' AND e.state IN ('requested', 'active', 'suspended')
           JOIN cb_entity c ON c.id = e.child_id
           JOIN identities i ON i.bridge_id = c.bridge_id AND i.identity_type = 'entity'`;

/** roster(brand_id) → every store in or asking to join the network: [{ id, via, state, edge_id, asked_by, node_id }] */
async function roster(brand_id) {
  if (!brand_id) return [];
  const r = await query(ROSTER_SQL, [brand_id]).catch(() => ({ rows: [] }));
  return r.rows;
}
/** members(brand_id) → the ids of stores that are IN (state active) */
async function members(brand_id) {
  return (await roster(brand_id)).filter((m) => m.state === 'active').map((m) => m.id);
}
/** activeCountSql — the member count as a scalar sub-select; $1 = brand identity_id (for batched reads) */
const ACTIVE_COUNT_SQL = `(SELECT count(*) FROM (${ROSTER_SQL}) m WHERE m.state = 'active')::int`;

/** brandsOf(store_id, brandIds) → Set of the brands, among those, the store is an active member of */
async function brandsOf(store_id, brandIds) {
  const ids = [...new Set((brandIds || []).filter(Boolean).map(String))];
  if (!store_id || !ids.length) return new Set();
  const r = await query(
    `SELECT b FROM unnest($1::text[]) AS b WHERE ${isMemberSql('b', '$2')}`, [ids, String(store_id)]).catch(() => ({ rows: [] }));
  return new Set(r.rows.map((x) => String(x.b)));
}

/**
 * standing(store_id, brandIds) → { <brand_id>: { state, via, edge_id, asked_by, brand_node, store_node } } — how this store
 * stands with each brand whose catalogue it sells: in, asked, invited, suspended, or nothing yet (absent).
 */
async function standing(store_id, brandIds) {
  const ids = [...new Set((brandIds || []).filter(Boolean).map(String))];
  const out = {};
  if (!store_id || !ids.length) return out;
  const r = await query(
    `WITH s AS (SELECT c.id, c.path FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id WHERE i.identity_id = $1)
     SELECT bi.identity_id::text AS brand_id, bc.id::text AS brand_node, s.id::text AS store_node,
            (s.path <@ bc.path AND s.id <> bc.id) AS built,
            (SELECT g.state FROM cb_edge g WHERE g.child_id = s.id AND g.type = 'governance' AND g.state IN ('active','suspended') LIMIT 1) AS tree_state,
            (SELECT g.id::text FROM cb_edge g WHERE g.child_id = s.id AND g.type = 'governance' AND g.state IN ('active','suspended') LIMIT 1) AS tree_edge,
            e.id::text AS edge_id, e.state AS edge_state,
            CASE WHEN e.requested_by = bc.id THEN 'brand' WHEN e.requested_by = s.id THEN 'store' ELSE NULL END AS asked_by
       FROM unnest($2::uuid[]) AS want(id)
       JOIN identities bi ON bi.identity_id = want.id
       LEFT JOIN cb_entity bc ON bc.bridge_id = bi.bridge_id
       LEFT JOIN s ON true
       LEFT JOIN LATERAL (SELECT * FROM cb_edge x WHERE x.parent_id = bc.id AND x.child_id = s.id AND x.type = 'commercial'
                            AND x.state IN ('requested','active','suspended') ORDER BY x.created_at DESC LIMIT 1) e ON true`,
    [store_id, ids]).catch(() => ({ rows: [] }));
  for (const x of r.rows) {
    const st = x.built ? { state: x.tree_state || 'active', via: 'built', edge_id: x.tree_edge || null, asked_by: null }
      : x.edge_id ? { state: x.edge_state, via: 'joined', edge_id: x.edge_id, asked_by: x.asked_by }
      : { state: 'none', via: null, edge_id: null, asked_by: null };
    out[x.brand_id] = Object.assign(st, { brand_node: x.brand_node || null, store_node: x.store_node || null });
  }
  return out;
}

module.exports = { isMemberSql, ROSTER_SQL, ACTIVE_COUNT_SQL, roster, members, brandsOf, standing };
