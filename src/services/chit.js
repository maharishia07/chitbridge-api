const { pool, withTx } = require("../db");
const err = (s, m, c) => Object.assign(new Error(m), { status: s, code: c });
const hash = () => require("crypto").randomBytes(16).toString("hex");        // 32-char, legacy-shaped
async function getEntity(id, c = pool) { const { rows } = await c.query(`select * from cb_entity where id=$1`, [id]); return rows[0]; }
// nodes from F down to T inclusive (tree route); [] if T not under F
async function routeDown(fromId, targetId, c = pool) {
  const f = await getEntity(fromId, c), t = await getEntity(targetId, c);
  if (!f || !t) throw err(404, "entity not found", "NOT_FOUND");
  const { rows } = await c.query(
    `select id, path::text from cb_entity
     where ($1::ltree) <@ path and path <@ ($2::ltree) order by nlevel(path)`, [t.path, f.path]);
  return rows; // [F, ..., T]
}
async function edgeBetween(parentId, childId, c = pool) {
  const { rows } = await c.query(
    `select * from cb_edge where parent_id=$1 and child_id=$2 and state in ('active','suspended') limit 1`, [parentId, childId]);
  return rows[0] || null;
}
// Create a network-aware chit: chains down the tree F -> ... -> T
async function createChit({ fromId, targetId, items = [], subject = "" }) {
  return withTx(async (c) => {
    const route = await routeDown(fromId, targetId, c);
    let hops;
    if (route.length >= 2) {
      hops = []; for (let i = 0; i < route.length - 1; i++) hops.push([route[i].id, route[i + 1].id]);
    } else {
      const e = await edgeBetween(fromId, targetId, c) || await edgeBetween(targetId, fromId, c);
      if (!e) throw err(409, "no route or direct connection F→T", "NO_ROUTE");
      hops = [[fromId, targetId]];
    }
    let originatorId = null, parentId = null; const created = [];
    for (const [a, b] of hops) {
      const edge = await edgeBetween(a, b, c);
      const { rows: [chit] } = await c.query(
        `insert into cb_chit(chit_hash, originator_id, parent_id, edge_id, from_entity, to_entity, for_entity, role, txn_status, subject)
         values ($1, coalesce($2, gen_random_uuid()), $3, $4, $5, $6, $7, 'Act', 'Active', $8)
         returning *`,
        [hash(), originatorId, parentId, edge ? edge.id : null, a, b, fromId, subject]);
      if (!originatorId) { originatorId = chit.id; await c.query(`update cb_chit set originator_id=$1 where id=$1`, [chit.id]); chit.originator_id = chit.id; }
      // copy items onto each hop
      for (const it of items)
        await c.query(`insert into cb_chit_item(chit_id, particulars, qty, price, total) values ($1,$2,$3,$4,$5)`,
          [chit.id, it.particulars || "", it.qty || 0, it.price || 0, (it.qty || 0) * (it.price || 0)]);
      created.push(chit); parentId = chit.id;
    }
    return { originatorId, hops: created };
  });
}
// chained forward/reply: a new hop off an existing chit
async function forwardChit({ chitId, toEntity }) {
  return withTx(async (c) => {
    const { rows: [p] } = await c.query(`select * from cb_chit where id=$1`, [chitId]);
    if (!p) throw err(404, "chit not found", "NOT_FOUND");
    const edge = await edgeBetween(p.to_entity, toEntity, c);
    const { rows: [chit] } = await c.query(
      `insert into cb_chit(chit_hash, originator_id, parent_id, edge_id, from_entity, to_entity, for_entity, role, txn_status, subject)
       values ($1,$2,$3,$4,$5,$6,$7,'Act','Active',$8) returning *`,
      [hash(), p.originator_id, p.id, edge ? edge.id : null, p.to_entity, toEntity, p.from_entity, p.subject]);
    await c.query(`insert into cb_chit_item(chit_id, particulars, qty, price, total)
                   select $1, particulars, qty, price, total from cb_chit_item where chit_id=$2`, [chit.id, p.id]);
    return chit;
  });
}
const NEXT = { Active:["Accepted","Withdrawn","Hold"], Accepted:["InProgress","Withdrawn","Hold"],
  InProgress:["Finished","Hold","Withdrawn"], Finished:["Completed","Closed"], Hold:["Active","Withdrawn"] };
async function advance({ chitId, to }) {
  const { rows: [chit] } = await pool.query(`select * from cb_chit where id=$1`, [chitId]);
  if (!chit) throw err(404, "chit not found", "NOT_FOUND");
  if (!(NEXT[chit.txn_status] || []).includes(to)) throw err(409, `illegal transition ${chit.txn_status}→${to}`, "BAD_TXN");
  const { rows: [u] } = await pool.query(`update cb_chit set txn_status=$2, updated_at=now() where id=$1 returning *`, [chitId, to]);
  return u;
}
// inbox by role — downstream sees its own hop only (for_entity not surfaced)
async function inbox(entityId) {
  const { rows } = await pool.query(
    `select id, chit_hash, from_entity, to_entity, role, txn_status, subject, created_at
     from cb_chit where to_entity=$1 or from_entity=$1 order by created_at desc`, [entityId]);
  return rows; // note: for_entity intentionally omitted
}
// N-level aggregator read (generalised aggregator_get)
async function aggregate(entityId) {
  const e = await getEntity(entityId); if (!e) throw err(404, "not found", "NOT_FOUND");
  const { rows } = await pool.query(
    `select id, bridge_id, name, path::text, nlevel(path)-nlevel($2::ltree) as depth
     from cb_entity where path <@ ($2::ltree) and id<>$1 order by path`, [entityId, e.path]);
  return rows;
}
// the real in-flight check used by NET-01 disconnect
async function edgeHasOpenChit(edgeId, c = pool) {
  const { rows } = await c.query(
    `select 1 from cb_chit where edge_id=$1 and txn_status in ('Active','Accepted','InProgress','Finished','Hold') limit 1`, [edgeId]);
  return rows.length > 0;
}
module.exports = { routeDown, createChit, forwardChit, advance, inbox, aggregate, edgeHasOpenChit };
