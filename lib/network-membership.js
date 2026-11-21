// OWNS      who is in a brand's network, one answer read from the network itself (cb_entity + cb_edge): isMemberSql · standingSql · sameTreeSql · roster · members · brandsOf
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
 
 * CALLED BY lib/network-catalogue.js, lib/network-offers.js, routes/assist.js, routes/catalogue.js, routes/network-design.js (+1 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * FLOW      brand ──▶ built (under it on the tree, not suspended) + joined (an active commercial edge) ──▶ member ids · a read that fails throws NETWORK_READ_FAILED (503, READ_FAILED_WORDS)
 *           store ──▶ suspendedWith(store, receivers) ──▶ true when any receiver suspended it (POST /chits/send refuses, MEMBERSHIP_SUSPENDED, NET-7)
 * CARD      04-network/connections-and-invitations
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
  e.code = READ_FAILED;
  e.status = 503;
  e.cause = err;
  return e;
}
/** read(sql, params, what) — the one member reader: the rows, or a NETWORK_READ_FAILED error that says so */
async function read(sql, params, what) {
  try {
    return await query(sql, params);
  } catch (err) {
    throw readFailed(err, what);
  }
}
/** orElse(what, value) → a .catch handler for an OPTIONAL part of an answer: a member read that failed still fails the answer
 *  (rethrown); any other failure is logged and `value` stands in */
function orElse(what, value) {
  return (e) => {
    if (e && e.code === READ_FAILED) throw e;
    log.fellBack(what, e);
    return value;
  };
}
/** answerReadFailed(res, e) → true when e was a member read that failed, answered as one (503, words, code) */
function answerReadFailed(res, e) {
  if (!e || e.code !== READ_FAILED) return false;
  res.status(503).json({ error: 'Network not read', message: READ_FAILED_WORDS, code: READ_FAILED });
  return true;
}

/**
 * ⭐⭐ STANDING (TOP-CORRECT, 2026-10-14). standingSql(pathExpr) — a boolean SQL expression: the node at `pathExpr` (an ltree) STANDS in its
 * tree — no governance edge on it or on any ancestor is SUSPENDED. Suspend changes only cb_edge.state (src/services/network.js suspend),
 * never the path, so a root-only path test (catalogue-view sameNetwork, network.js _sameRoot — both lifted onto this) let a suspended
 * member go on reading the network's catalogue and tree. A LEFT member is re-rooted by disconnect, so the path itself refuses it.
 * This is THE ONE edge-state read every "same network?" asks; isMemberSql's built branch asks it too.
 */
function standingSql(pathExpr) {
  return `NOT EXISTS (SELECT 1 FROM cb_edge g JOIN cb_entity x ON x.id = g.child_id
                       WHERE g.type = 'governance' AND g.state = 'suspended' AND (${pathExpr}) <@ x.path)`;
}
/** sameTreeSql(aPath, bPath) — one root, and both in standing */
function sameTreeSql(aPath, bPath) {
  return `(subpath(${aPath}, 0, 1) = subpath(${bPath}, 0, 1) AND ${standingSql(aPath)} AND ${standingSql(bPath)})`;
}
/**
 * sameNetwork(q, aBridge, bBridge) → the two businesses are in one network: one root, neither suspended. `q` is the caller's query
 * function (catalogue-view passes its own). False on anything unresolvable — cb_entity absent, either side not on the tree: a
 * membership test that fails OPEN is not a membership test.
 */
async function sameNetwork(q, aBridge, bBridge) {
  if (!aBridge || !bBridge) return false;
  if (String(aBridge) === String(bBridge)) return true;
  try {
    const r = await (q || query)(
      `SELECT ${sameTreeSql('a.path', 'b.path')} AS same FROM cb_entity a, cb_entity b WHERE a.bridge_id = $1 AND b.bridge_id = $2 LIMIT 1`,
      [String(aBridge), String(bBridge)]
    );
    return r.rows[0] ? r.rows[0].same === true : false;
  } catch (e) {
    log.fellBack('network-membership sameNetwork: the read failed — answered no', e);
    return false;
  } /* never silent (T2-HONEST): the person sees the public tier, the log says why */
}

/** the ONE FROM clause of a two-business test, aliases <a>i/<a>c and <b>i/<b>c: each business's identity row joined to its tree node (isMemberSql and isGrantParentSql both ride it, so identities is named in one place here) */
const pairOf = (first, second) => `FROM identities ${first}i JOIN cb_entity ${first}c ON ${first}c.bridge_id = ${first}i.bridge_id,
                  identities ${second}i JOIN cb_entity ${second}c ON ${second}c.bridge_id = ${second}i.bridge_id`;

/** an identity row IS the one a text expression names, said so the identities primary key can answer it: the column is compared as a uuid, never cast to text (that made every call a scan of all identities: 167 grants x 4 scans = 1.3 s of the practice list, 21 Nov). The guard keeps the old answer for a text that is not a uuid (no match, never a cast error). */
const UUID_TEXT = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";
const idIs = (alias, expr) => `${alias}.identity_id = CASE WHEN (${expr}) ~ ${UUID_TEXT} THEN (${expr})::uuid END`;

/**
 * isMemberSql(brandExpr, storeExpr) — a boolean SQL expression, for readers that must decide inside one statement
 * (catalogue-build's source read). Both arguments are SQL expressions yielding an identity_id as text.
 */
function isMemberSql(brandExpr, storeExpr) {
  return `EXISTS (
    SELECT 1 ${pairOf('b', 's')}
     WHERE ${idIs('bi', brandExpr)} AND ${idIs('si', storeExpr)}
       AND ( (sc.path <@ bc.path AND sc.id <> bc.id
              AND ${standingSql('sc.path')})
          OR EXISTS (SELECT 1 FROM cb_edge e WHERE e.parent_id = bc.id AND e.child_id = sc.id
                        AND e.type = 'commercial' AND e.state = 'active') ))`;
}

/**
 * isGrantParentSql(parentExpr, childExpr) — may the parent be given the child's books? The child is IN the parent's network (isMemberSql),
 * OR the parent is the child's firm: an active AGENCY edge (a firm acting for a client is not network membership, so isMemberSql, the roster and treeOf never see it).
 * Read at every request, never copied: ending or suspending the edge ends the access on the next one.
 */
function isGrantParentSql(parentExpr, childExpr) {
  return `(${isMemberSql(parentExpr, childExpr)} OR EXISTS (
    SELECT 1 ${pairOf('p', 'c')}
     WHERE ${idIs('pi', parentExpr)} AND ${idIs('ci', childExpr)}
       AND EXISTS (SELECT 1 FROM cb_edge a WHERE a.parent_id = pc.id AND a.child_id = cc.id AND a.type = 'agency' AND a.state = 'active')))`;
}

/** the SQL for a brand's roster; $1 = brand identity_id. Rows: id, via, state, edge_id, asked_by, node_id, parent_node
 *  (parent_node = the parent end of edge_id — the brand for a joined store, the store's own tree parent for a built one) */
const ROSTER_SQL = `
  WITH b AS (SELECT c.id, c.path FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id WHERE i.identity_id = $1)
  SELECT i.identity_id::text AS id, 'built' AS via, COALESCE(g.state, 'active') AS state, g.id::text AS edge_id,
         NULL::text AS asked_by, c.id::text AS node_id, g.parent_id::text AS parent_node
    FROM b JOIN cb_entity c ON c.path <@ b.path AND c.id <> b.id
           JOIN identities i ON i.bridge_id = c.bridge_id AND i.identity_type = 'entity'
           LEFT JOIN cb_edge g ON g.child_id = c.id AND g.type = 'governance' AND g.state IN ('active', 'suspended')
  UNION ALL
  SELECT i.identity_id::text, 'joined', e.state, e.id::text,
         CASE WHEN e.requested_by = b.id THEN 'brand' WHEN e.requested_by = c.id THEN 'store' ELSE NULL END, c.id::text, b.id::text
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
  return (await roster(brand_id)).filter((item) => item.state === 'active').map((item) => item.id);
}
/** activeCountSql — the member count as a scalar sub-select; $1 = brand identity_id (for batched reads) */
const ACTIVE_COUNT_SQL = `(SELECT count(*) FROM (${ROSTER_SQL}) m WHERE m.state = 'active')::int`;

/** brandsOf(store_id, brandIds) → Set of the brands, among those, the store is an active member of */
async function brandsOf(store_id, brandIds) {
  const ids = [...new Set((brandIds || []).filter(Boolean).map(String))];
  if (!store_id || !ids.length) return new Set();
  const r = await read(`SELECT b FROM unnest($1::text[]) AS b WHERE ${isMemberSql('b', '$2')}`, [ids, String(store_id)], 'brandsOf');
  return new Set(r.rows.map((x) => String(x.b)));
}

/**
 * standing(store_id, brandIds) → { <brand_id>: { state, via, edge_id, asked_by, brand_node, store_node, parent_node,
 * brand_bridge_id, root_bridge_id } } — how this store stands with each brand asked about: in, asked, invited, suspended,
 * or nothing yet (absent). root_bridge_id is the top of the brand's tree — the bridge id the network store reads by
 * (routes/catalogue.js GET /network/:bridge_id); the root is `subpath(path, 0, 1)`, as lib/catalogue-view.js reads it.
 */
/** the standing statement — $1 = store identity_id, $2 = uuid[] of brand identity_ids (exported so a batched read can carry it) */
const STANDING_SQL = `WITH s AS (SELECT c.id, c.path FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id WHERE i.identity_id = $1)
     SELECT bi.identity_id::text AS brand_id, bc.id::text AS brand_node, s.id::text AS store_node,
            bi.bridge_id AS brand_bridge_id,
            (SELECT r.bridge_id FROM cb_entity r WHERE r.path = subpath(bc.path, 0, 1) LIMIT 1) AS root_bridge_id,
            (SELECT g.parent_id::text FROM cb_edge g WHERE g.child_id = s.id AND g.type = 'governance' AND g.state IN ('active','suspended') LIMIT 1) AS tree_parent,
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
                            AND x.state IN ('requested','active','suspended') ORDER BY x.created_at DESC LIMIT 1) e ON true`;
/** standingOf(rows) → the standing map from STANDING_SQL's rows (the one shaper, whoever ran the statement) */
function standingOf(rows) {
  const out = {};
  for (const x of rows || []) {
    const st = x.built
      ? { state: x.tree_state || 'active', via: 'built', edge_id: x.tree_edge || null, asked_by: null, parent_node: x.tree_parent || null }
      : x.edge_id
        ? { state: x.edge_state, via: 'joined', edge_id: x.edge_id, asked_by: x.asked_by, parent_node: x.brand_node || null }
        : { state: 'none', via: null, edge_id: null, asked_by: null, parent_node: null };
    out[x.brand_id] = Object.assign(st, {
      brand_node: x.brand_node || null,
      store_node: x.store_node || null,
      brand_bridge_id: x.brand_bridge_id || null,
      root_bridge_id: x.root_bridge_id || null
    });
  }
  return out;
}
async function standing(store_id, brandIds) {
  const ids = [...new Set((brandIds || []).filter(Boolean).map(String))];
  if (!store_id || !ids.length) return {};
  const r = await read(STANDING_SQL, [store_id, ids], 'standing');
  return standingOf(r.rows);
}

/**
 * suspendedWith(store_id, receiverIds) → true when this store is SUSPENDED by any of those receivers' networks — the one read behind
 * POST /chits/send's refusal (NET-7). It asks standing() (above), never a second 'is suspended' check, so built and joined members
 * answer the same way; a receiver the store has no edge with reads 'none' and does not count. One statement for all receivers.
 */
async function suspendedWith(store_id, receiverIds) {
  const stands = await standing(store_id, receiverIds);
  return Object.values(stands).some((edge) => edge.state === 'suspended');
}

/**
 * treeOf(bridge_id, { under }) → the bridge_ids of every node under this one's ROOT (default), or under this node itself
 * (`under: 'self'` — a department store's own departments), at any depth, top first, then by depth and name. One reader for the
 * availability search, the store list (routes/network-design) and the network storefront (routes/catalogue), which each held their
 * own copy of this statement and each answered "not part of a network" / "shop not found" when it failed.
 */
async function treeOf(bridge_id, opts) {
  const top = opts && opts.under === 'self' ? 'path' : 'subpath(path, 0, 1)';
  const r = await read(
    `SELECT e.bridge_id FROM cb_entity e
      WHERE e.path <@ (SELECT ${top} FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
      ORDER BY nlevel(e.path), e.name`,
    [bridge_id],
    'treeOf'
  );
  return r.rows.map((x) => x.bridge_id);
}

/**
 * clientsOf(bridge_id) → the bridge_ids of the businesses this one is the FIRM of (active agency edges, downward only). The firm lists its clients
 * from here; a client never lists its firm's other clients, because it reads treeOf and no agency edge is in the path.
 */
async function clientsOf(bridge_id) {
  const r = await read(
    `SELECT c.bridge_id FROM cb_edge a JOIN cb_entity p ON p.id = a.parent_id JOIN cb_entity c ON c.id = a.child_id
      WHERE p.bridge_id = $1 AND a.type = 'agency' AND a.state = 'active' ORDER BY c.name`,
    [bridge_id],
    'clientsOf'
  );
  return r.rows.map((x) => x.bridge_id);
}

/**
 * treeAndClientsOf(bridge_id) → treeOf(bridge_id) then clientsOf(bridge_id), in ONE read: the same two statements' rows as one UNION (tree rows first by depth and name, then the firm's clients by name).
 * The store list asks both on every call; as two reads it paid a trip for the second.
 */
async function treeAndClientsOf(bridge_id) {
  const rows = await read(
    `SELECT bridge_id FROM (
       SELECT e.bridge_id, 0 AS part, nlevel(e.path) AS depth, e.name AS name FROM cb_entity e
        WHERE e.path <@ (SELECT subpath(path, 0, 1) FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
       UNION ALL
       SELECT c.bridge_id, 1, 0, c.name FROM cb_edge a JOIN cb_entity p ON p.id = a.parent_id JOIN cb_entity c ON c.id = a.child_id
        WHERE p.bridge_id = $1 AND a.type = 'agency' AND a.state = 'active') u
      ORDER BY part, depth, name`,
    [bridge_id],
    'treeAndClientsOf'
  );
  return rows.rows.map((x) => x.bridge_id);
}

/**
 * standsInTree(bridge_id) → false only when this business's node (or an ancestor's governance edge) is SUSPENDED (standingSql, the one rule);
 * true when it stands or is on no tree at all (those callers answer "not in a network" themselves). The read gate of GET /stores and /availability.
 */
async function standsInTree(bridge_id) {
  const r = await read(`SELECT ${standingSql('e.path')} AS stands FROM cb_entity e WHERE e.bridge_id = $1 LIMIT 1`, [String(bridge_id)], 'standsInTree');
  return r.rows[0] ? r.rows[0].stands !== false : true;
}

/**
 * ⭐ WHAT THIS BUSINESS MAY DO ON ONE MEMBERSHIP ROW — the server's answer, so no screen re-derives who approves (NET-SRV1 G2).
 * The rule is src/services/network.mayAct (the one the POSTs enforce), behind the same state gates the service refuses on.
 *   m      a roster / standing row: { state, via, edge_id, asked_by, parent_node, node_id | store_node, brand_node }
 *   actor  the cb_entity node of the business reading the row (the brand for its roster, the store for its networks)
 * → { request, approve, decline, suspend, resume, disconnect } each { ok, code, why }. The client branches on ok / code
 *   (NO_ACTOR · NO_EDGE · BAD_STATE · NOT_ALLOWED), never on the sentence. PURE — no query.
 * ⚠️ disconnect may still be refused at the POST when a chit is open on the edge (IN_FLIGHT): that needs a read per row.
 */
const OPEN_STATES = { approve: ['requested'], decline: ['requested'], suspend: ['active'], resume: ['suspended'], disconnect: ['active', 'suspended'] };
const STATE_WHY = {
  request: 'Already in this network, or already asked.',
  approve: 'Nothing is waiting for an answer.',
  decline: 'Nothing is waiting for an answer.',
  suspend: 'Only an active member can be suspended.',
  resume: 'Only a suspended member can be resumed.',
  disconnect: 'Not connected yet.'
};
const sentence = (t) => {
  const text = String(t || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.') : text;
};
function mayOn(m, actor) {
  const { mayAct } = require('../src/services/network');
  const row = m || {};
  const child = row.node_id || row.store_node || null;
  const parent = row.parent_node || null;
  const edge = { parent_id: parent, child_id: child, requested_by: row.asked_by === 'brand' ? parent : row.asked_by === 'store' ? child : null };
  const no = (code, why) => ({ ok: false, code, why });
  const one = (op) => {
    if (!actor) return no('NO_ACTOR', 'Sign in as the business first.');
    if (op === 'request') {
      if (row.edge_id || row.via === 'built' || (row.state && row.state !== 'none')) return no('BAD_STATE', STATE_WHY.request);
      /* a store not yet on the tree gets its node the first time it asks (src/services/network.nodeOf ensure) — it is the child */
      const nestedR = mayAct('request', { actorId: actor, parentId: row.brand_node, childId: child || actor });
      return nestedR === true ? { ok: true, code: null, why: null } : no('NOT_ALLOWED', sentence(nestedR));
    }
    if (!row.edge_id || !parent) return no('NO_EDGE', 'There is no connection to act on yet.');
    if (OPEN_STATES[op].indexOf(row.state) < 0) return no('BAD_STATE', STATE_WHY[op]);
    const r = mayAct(op, { edge, actorId: actor });
    return r === true ? { ok: true, code: null, why: null } : no('NOT_ALLOWED', sentence(r));
  };
  const out = {};
  for (const op of ['request', 'approve', 'decline', 'suspend', 'resume', 'disconnect']) out[op] = one(op);
  return out;
}

module.exports = {
  treeAndClientsOf,
  isMemberSql,
  isGrantParentSql,
  standingSql,
  sameTreeSql,
  sameNetwork,
  ROSTER_SQL,
  ACTIVE_COUNT_SQL,
  STANDING_SQL,
  standingOf,
  readFailed,
  roster,
  members,
  brandsOf,
  standing,
  suspendedWith,
  standsInTree,
  treeOf,
  clientsOf,
  mayOn,
  READ_FAILED,
  READ_FAILED_WORDS,
  answerReadFailed,
  orElse
}; /* standingSql · sameTreeSql · sameNetwork: TOP-CORRECT (the one edge-state read); treeOf · mayOn · the loud-read helpers: NET-SRV1 / T2-HONEST */
