const { pool, withTx } = require("../db");
const bridge = require("../lib/bridgeId");
const chit = require("./chit");   // NET-02 §F: real in-flight check
const err = (status, message, code) => Object.assign(new Error(message), { status, code });
async function register({ name, mode, businessType, ownerScope = "entity", claimed = true, appRef = null }) {
  if (!name) throw err(400, "name required", "NAME_REQUIRED");
  // recon delta: derive mode from business_type when mode not explicitly given.
  // Aggregator/Circle = network host/group (b2b); Business = customer-facing leaf (b2c). [mapping to confirm]
  if (!mode) mode = (businessType === "Business") ? "b2c"
                  : (businessType === "Aggregator" || businessType === "Circle") ? "b2b" : "b2b";
  for (let t = 0; t < 5; t++) {
    const bid = bridge.mint(), label = bridge.toLabel(bid);
    try {
      const { rows } = await pool.query(
        `insert into cb_entity(bridge_id,name,mode,owner_scope,path,claimed,app_ref)
         values ($1,$2,$3,$4,$5::ltree,$6,$7) returning *`,
        [bid, name, mode, ownerScope, label, claimed, appRef]);
      return rows[0];
    } catch (e) { if (e.code === "23505") continue; throw e; }   // bridge_id collision -> retry
  }
  throw err(500, "could not mint a unique bridge id", "MINT_FAILED");
}
const _card = (r) => r && ({ id: r.id, bridgeId: r.bridge_id, name: r.name, mode: r.mode, claimed: r.claimed, status: r.status });
async function lookup(bridgeId) {                 // PUBLIC card only — default-deny on internals
  const { rows } = await pool.query(`select * from cb_entity where bridge_id=$1`, [String(bridgeId).toUpperCase()]);
  return _card(rows[0]);
}
async function getById(id, client = pool) {
  const { rows } = await client.query(`select * from cb_entity where id=$1`, [id]); return rows[0] || null;
}
async function _full(bridgeId) {
  const { rows } = await pool.query(`select * from cb_entity where bridge_id=$1`, [String(bridgeId).toUpperCase()]); return rows[0] || null;
}
async function hasLiveParent(childId, client = pool) {
  const { rows } = await client.query(
    `select 1 from cb_edge where child_id=$1 and state in ('active','suspended') limit 1`, [childId]);
  return rows.length > 0;
}
// ---- LINK ----
async function requestConnect({ parentId, childBridgeId, childId, type = "governance", requestedBy = null }) {
  const parent = await getById(parentId);
  if (!parent) throw err(404, "parent not found", "PARENT_NOT_FOUND");
  const child = childId ? await getById(childId) : (childBridgeId ? await _full(childBridgeId) : null);
  if (!child) throw err(404, "child not found — register first", "CHILD_NOT_FOUND");
  if (child.id === parent.id) throw err(400, "cannot connect to self", "SELF");
  if (await hasLiveParent(child.id)) throw err(409, "child already in a network (tree-only)", "HAS_PARENT");
  const { rows } = await pool.query(
    `insert into cb_edge(parent_id,child_id,type,state,requested_by)
     values ($1,$2,$3,'requested',$4) returning *`, [parent.id, child.id, type, requestedBy]);
  return rows[0];
}
async function approve({ edgeId, actingEntityId = null }) {
  return withTx(async (c) => {
    const { rows: [edge] } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw err(404, "edge not found", "EDGE_NOT_FOUND");
    if (edge.state !== "requested") throw err(409, `cannot approve from ${edge.state}`, "BAD_STATE");
    const parent = await getById(edge.parent_id, c);
    const { rows: [child] } = await c.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
    if (!actingEntityId) throw err(400, "actingEntityId required — only the child entity can consent", "ACTOR_REQUIRED");
    if (actingEntityId !== child.id) throw err(403, "only the child entity can consent", "NOT_APPROVER");
    if (!child.claimed) throw err(409, "child is an unclaimed stub — cannot consent", "UNCLAIMED");
    if (await hasLiveParent(child.id, c)) throw err(409, "child already in a network (tree-only)", "HAS_PARENT");
    const { rows: [{ bad }] } = await c.query(`select (($1::ltree) <@ ($2::ltree)) as bad`, [parent.path, child.path]);
    if (bad) throw err(409, "would create a cycle (parent under child)", "CYCLE");
    // reparent child subtree under parent (works whether child is a root or not)
    await c.query(
      `update cb_entity set path = ($1::ltree) || subpath(path, nlevel($2::ltree)-1)
       where path <@ ($2::ltree)`, [parent.path, child.path]);
    const { rows: [updated] } = await c.query(
      `update cb_edge set state='active', approved_by=$2, decided_at=now() where id=$1 returning *`,
      [edgeId, actingEntityId]);
    await c.query(    // any other pending requests for this child are now moot
      `update cb_edge set state='declined', decided_at=now()
       where child_id=$1 and state='requested' and id<>$2`, [child.id, edgeId]);
    return updated;
  });
}
async function decline({ edgeId, actingEntityId = null }) {
  const { rows: [edge] } = await pool.query(
    `update cb_edge set state='declined', approved_by=$2, decided_at=now()
     where id=$1 and state='requested' returning *`, [edgeId, actingEntityId]);
  if (!edge) throw err(409, "no pending request to decline", "BAD_STATE");
  return edge;
}
async function _move(edgeId, from, to) {
  const { rows: [edge] } = await pool.query(
    `update cb_edge set state=$3 where id=$1 and state=$2 returning *`, [edgeId, from, to]);
  if (!edge) throw err(409, `cannot move to ${to}`, "BAD_STATE");
  return edge;
}
const suspend = (edgeId) => _move(edgeId, "active", "suspended");
const resume  = (edgeId) => _move(edgeId, "suspended", "active");
// ---- UNLINK ----
async function disconnect({ edgeId, settle = false }) {
  return withTx(async (c) => {
    const { rows: [edge] } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw err(404, "edge not found", "EDGE_NOT_FOUND");
    if (!["active", "suspended"].includes(edge.state)) throw err(409, `cannot disconnect from ${edge.state}`, "BAD_STATE");
    // NET-02 §F: truth is the open-chit query; in_flight flag kept as an optional cache (so NET-01 T6 still blocks).
    const open = (await chit.edgeHasOpenChit(edge.id, c)) || edge.in_flight;
    if (open && !settle) throw err(409, "open chit on this edge — settle first", "IN_FLIGHT");
    if (open && settle) {   // compensation: withdraw open chits on this edge, clear the cache flag
      await c.query(`update cb_chit set txn_status='Withdrawn', updated_at=now()
                     where edge_id=$1 and txn_status in ('Active','Accepted','InProgress','Finished','Hold')`, [edge.id]);
      await c.query(`update cb_edge set in_flight=false where id=$1`, [edgeId]);
    }
    const { rows: [child] } = await c.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
    // detach: re-root the child subtree to its own root
    await c.query(
      `update cb_entity set path = subpath(path, nlevel($1::ltree)-1) where path <@ ($1::ltree)`, [child.path]);
    const { rows: [updated] } = await c.query(
      `update cb_edge set state='disconnected', archived_at=now() where id=$1 returning *`, [edgeId]);
    // TODO: cascade-revoke grants that flowed through this edge (cb_grant) when grants land
    return updated;
  });
}
// ---- reads ----
async function subtree(entityId) {
  const e = await getById(entityId); if (!e) throw err(404, "not found", "NOT_FOUND");
  // b117: the PURPOSE joined in, so a member reading the tree sees why each branch exists rather than a list of
  // bare names. One LEFT JOIN on the same query — never a lookup per node, which at any real depth is the O(1)
  // rule broken in the least visible way.
  const { rows } = await pool.query(
    `select e.id, e.bridge_id, e.name, e.path::text, nlevel(e.path)-nlevel($1::ltree) as depth,
            i.purpose, i.sort_order, i.city, i.lat, i.lng, i.service_km
       from cb_entity e
       left join identities i on i.bridge_id = e.bridge_id and i.identity_type = 'entity'
      where e.path <@ ($1::ltree) order by e.path`, [e.path]);
  return rows;
}
async function connections(entityId) {
  const { rows } = await pool.query(
    `select e.*, pp.name as parent_name, cc.name as child_name
     from cb_edge e join cb_entity pp on pp.id=e.parent_id join cb_entity cc on cc.id=e.child_id
     where (e.parent_id=$1 or e.child_id=$1) and e.state in ('requested','active','suspended')
     order by e.created_at desc`, [entityId]);
  return rows;
}
async function claim(entityId) {   // full identity verification is ATH-86 (needs the cb_entity<->identities bridge).
  // Until then, at least prevent re-claiming an already-owned entity (no hijack of a claimed node).
  const { rows: [e] } = await pool.query(
    `update cb_entity set claimed=true where id=$1 and claimed=false returning *`, [entityId]);
  if (e) return e;
  const { rows: [exists] } = await pool.query(`select claimed from cb_entity where id=$1`, [entityId]);
  if (!exists) throw err(404, "not found", "NOT_FOUND");
  throw err(409, "already claimed", "ALREADY_CLAIMED");
}
module.exports = { register, lookup, getById, requestConnect, approve, decline, suspend, resume, disconnect, subtree, connections, claim, _full };
