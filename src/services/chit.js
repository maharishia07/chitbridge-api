/*
 * OWNS      the dormant cb_chit table service behind the network in-flight check
 * CALLED BY src/services/network.js
 * FLOW      takes a pooled connection from ../db, runs the in-flight query or the transaction, throws an error with status and code on a refusal
 * CARD      04-network/connections-and-invitations
 */
/* CALLED BY src/services/network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs] */
const { pool, withTx } = require('../db');
const err = (s, m, c) => Object.assign(new Error(m), { status: s, code: c });
const hash = () => require('crypto').randomBytes(16).toString('hex'); // 32-char, legacy-shaped
async function getEntity(id, c = pool) {
  const { rows } = await c.query(`select * from cb_entity where id=$1`, [id]);
  return rows[0];
}
// nodes from F down to T inclusive (tree route); [] if T not under F
async function routeDown(fromId, targetId, c = pool) {
  const f = await getEntity(fromId, c),
    t = await getEntity(targetId, c);
  if (!f || !t) throw err(404, 'entity not found', 'NOT_FOUND');
  const { rows } = await c.query(
    `select id, path::text from cb_entity
     where ($1::ltree) <@ path and path <@ ($2::ltree) order by nlevel(path)`,
    [t.path, f.path]
  );
  return rows; // [F, ..., T]
}
async function edgeBetween(parentId, childId, c = pool) {
  const { rows } = await c.query(`select * from cb_edge where parent_id=$1 and child_id=$2 and state in ('active','suspended') limit 1`, [parentId, childId]);
  return rows[0] || null;
}
// In-flight settle-guard for NET-01 disconnect. Reads cb_chit (the NETWORK chit model).
// CONSOLIDATION NOTE (2026-06-27): the cb_chit chit-loop ROUTE is retired and the cb_chit
// TABLE is dormant (no new rows), so this guard currently never blocks a disconnect.
// It is deliberately NOT repointed to chit_header: chit_header has no edge_id / cb_edge
// concept and keys off identities (not cb_entity) — there is no edge->chit_header link to
// query. A real "block disconnect on live legacy activity" guard needs a cb_entity<->identities
// bridge + connection-level open-chit semantics = a design item (network/Track B), not a
// consolidation fix. Left intact so the network-model invariant still holds if cb_chit is ever revived.
async function edgeHasOpenChit(edgeId, c = pool) {
  const { rows } = await c.query(`select 1 from cb_chit where edge_id=$1 and txn_status in ('Active','Accepted','InProgress','Finished','Hold') limit 1`, [
    edgeId
  ]);
  return rows.length > 0;
}
module.exports = { routeDown, edgeHasOpenChit };
