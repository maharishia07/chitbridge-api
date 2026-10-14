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
const log = require('./logger');

/**
 * ⭐⭐ A READ THAT FAILED IS NEVER "NO MEMBERS" (round T2-HONEST, 14 Oct). Every reader here used to answer `{ rows: [] }` when the
 * database did not answer — so a brand whose roster could not be read was told it had no stores, a store was told it was in no
 * network, and a release reached nobody while saying it had. Now each read goes through `read()`: on failure it logs, and throws
 * ONE error with words and a code (NETWORK_READ_FAILED, 503) that `answerReadFailed(res, e)` sends as it is.
 */
const READ_FAILED = 'NETWORK_READ_FAILED';
const READ_FAILED_WORDS = 'We could not read who is in the network just now. Nothing was changed. Try again in a minute.';
function readFailed(err, what) {
  log.error('network member read failed — ' + what, { err: err && (err.message || String(err)) });
  const e = new Error(READ_FAILED_WORDS);
  e.code = READ_FAILED; e.status = 503; e.cause = err;
  return e;
}
/** read(sql, params, what) — the one member reader: the rows, or a NETWORK_READ_FAILED error that says so */
async function read(sql, params, what) {
  try { return await query(sql, params); } catch (err) { throw readFailed(err, what); }
}
/** orElse(what, value) → a .catch handler for an OPTIONAL part of an answer: a member read that failed still fails the answer
 *  (rethrown); any other failure is logged and `value` stands in */
function orElse(what, value) {
  return (e) => { if (e && e.code === READ_FAILED) throw e; log.fellBack(what, e); return value; };
}
/** answerReadFailed(res, e) → true when e was a member read that failed, answered as one (503, words, code) */
function answerReadFailed(res, e) {
  if (!e || e.code !== READ_FAILED) return false;
  res.status(503).json({ error: 'Network not read', message: READ_FAILED_WORDS, code: READ_FAILED });
  return true;
}

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
  const r = await read(ROSTER_SQL, [brand_id], 'roster');
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
  const r = await read(
    `SELECT b FROM unnest($1::text[]) AS b WHERE ${isMemberSql('b', '$2')}`, [ids, String(store_id)], 'brandsOf');
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
  const r = await read(
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
    [store_id, ids], 'standing');
  for (const x of r.rows) {
    const st = x.built ? { state: x.tree_state || 'active', via: 'built', edge_id: x.tree_edge || null, asked_by: null }
      : x.edge_id ? { state: x.edge_state, via: 'joined', edge_id: x.edge_id, asked_by: x.asked_by }
      : { state: 'none', via: null, edge_id: null, asked_by: null };
    out[x.brand_id] = Object.assign(st, { brand_node: x.brand_node || null, store_node: x.store_node || null });
  }
  return out;
}

/**
 * treeOf(bridge_id, { under }) → the bridge_ids of every node under this one's ROOT (default), or under this node itself
 * (`under: 'self'` — a department store's own departments), at any depth, top first, then by depth and name. One reader for the
 * availability search, the store list (routes/network-design) and the network storefront (routes/catalogue), which each held their
 * own copy of this statement and each answered "not part of a network" / "shop not found" when it failed.
 */
async function treeOf(bridge_id, opts) {
  const top = (opts && opts.under === 'self') ? 'path' : 'subpath(path, 0, 1)';
  const r = await read(
    `SELECT e.bridge_id FROM cb_entity e
      WHERE e.path <@ (SELECT ${top} FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
      ORDER BY nlevel(e.path), e.name`, [bridge_id], 'treeOf');
  return r.rows.map((x) => x.bridge_id);
}

module.exports = { isMemberSql, ROSTER_SQL, ACTIVE_COUNT_SQL, roster, members, brandsOf, standing, treeOf,
                   READ_FAILED, answerReadFailed, orElse };
