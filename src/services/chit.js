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
// Create a network-aware chit: chains down the tree F -> ... -> T
async function createChit({ fromId, targetId, items = [], subject = '' }) {
  return withTx(async (c) => {
    const route = await routeDown(fromId, targetId, c);
    let hops;
    if (route.length >= 2) {
      hops = [];
      for (let index = 0; index < route.length - 1; index++) hops.push([route[index].id, route[index + 1].id]);
    } else {
      const e = (await edgeBetween(fromId, targetId, c)) || (await edgeBetween(targetId, fromId, c));
      if (!e) throw err(409, 'no route or direct connection F→T', 'NO_ROUTE');
      hops = [[fromId, targetId]];
    }
    let originatorId = null,
      parentId = null;
    const created = [];
    for (const [a, b] of hops) {
      const edge = await edgeBetween(a, b, c);
      const {
        rows: [chit]
      } = await c.query(
        `insert into cb_chit(chit_hash, originator_id, parent_id, edge_id, from_entity, to_entity, for_entity, role, txn_status, subject)
         values ($1, coalesce($2, gen_random_uuid()), $3, $4, $5, $6, $7, 'Act', 'Active', $8)
         returning *`,
        [hash(), originatorId, parentId, edge ? edge.id : null, a, b, fromId, subject]
      );
      if (!originatorId) {
        originatorId = chit.id;
        await c.query(`update cb_chit set originator_id=$1 where id=$1`, [chit.id]);
        chit.originator_id = chit.id;
      }
      // copy items onto each hop
      for (const it of items)
        await c.query(`insert into cb_chit_item(chit_id, particulars, qty, price, total) values ($1,$2,$3,$4,$5)`, [
          chit.id,
          it.particulars || '',
          it.qty || 0,
          it.price || 0,
          (it.qty || 0) * (it.price || 0)
        ]);
      created.push(chit);
      parentId = chit.id;
    }
    return { originatorId, hops: created };
  });
}
// chained forward/reply: a new hop off an existing chit
async function forwardChit({ chitId, toEntity }) {
  return withTx(async (c) => {
    const {
      rows: [p]
    } = await c.query(`select * from cb_chit where id=$1`, [chitId]);
    if (!p) throw err(404, 'chit not found', 'NOT_FOUND');
    const edge = await edgeBetween(p.to_entity, toEntity, c);
    const {
      rows: [chit]
    } = await c.query(
      `insert into cb_chit(chit_hash, originator_id, parent_id, edge_id, from_entity, to_entity, for_entity, role, txn_status, subject)
       values ($1,$2,$3,$4,$5,$6,$7,'Act','Active',$8) returning *`,
      [hash(), p.originator_id, p.id, edge ? edge.id : null, p.to_entity, toEntity, p.from_entity, p.subject]
    );
    await c.query(
      `insert into cb_chit_item(chit_id, particulars, qty, price, total)
                   select $1, particulars, qty, price, total from cb_chit_item where chit_id=$2`,
      [chit.id, p.id]
    );
    return chit;
  });
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
module.exports = { routeDown, createChit, forwardChit, edgeHasOpenChit };
