/*
 * OWNS      the dormant cb_chit table service behind the network in-flight check
 * CALLED BY src/services/network.js
 * FLOW      takes a pooled connection from ../db, runs the in-flight query or the transaction, throws an error with status and code on a refusal
 * CARD      04-network/connections-and-invitations
 */
/* CALLED BY src/services/network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs] */
const { pool } = require('../db');
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
module.exports = { edgeHasOpenChit };
