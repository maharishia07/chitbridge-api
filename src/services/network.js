const { pool, withTx } = require("../db");
const bridge = require("../lib/bridgeId");
const chit = require("./chit");   // NET-02 §F: real in-flight check
const err = (status, message, code) => Object.assign(new Error(message), { status, code });
/**
 * ⭐⭐ AUTHORITY COMES FROM THE SIGNED-IN BUSINESS, NEVER FROM THE REQUEST BODY (docs/NETWORK-AUTHORITY.md, ATH-86 —
 * closed 2026-09-17, Athi: "brand should approve and remove members … we have that logic already").
 *
 * The bridge was always there: `identities.bridge_id` = `cb_entity.bridge_id`. `nodeOf(entity_id)` walks it, and gives a
 * shop that has never been on the tree its own ROOT the first time it takes part — exactly what the network build does
 * for a brand. Every mutation below takes that node as `actor` and decides with `mayAct()`, a pure rule table:
 *
 *   requestConnect   the actor is the parent or the child                      (either side may ask)
 *   approve          the side that did NOT ask                                 (the other party consents)
 *   decline          the parent or the child
 *   suspend/resume   the parent                                                (authority flows down)
 *   disconnect       the parent or the child
 *
 * ⭐ TWO KINDS OF EDGE. `governance` is the tree: one live parent, and approving it moves the child's subtree under the
 * parent. `commercial` is a brand's network of stores: a store may hold many (one per brand — b261), and it never moves
 * the tree. Membership reads both (lib/network-membership.js).
 */
const TREE = "governance";

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
/** a bridge id as an ltree label — the same spelling the network build uses (dashes are not legal in a label) */
const _label = (bid) => String(bid).replace(/[^A-Za-z0-9_]/g, "_");
/**
 * nodeOf(entity_id, { ensure }) — the signed-in business's place on the tree. With `ensure`, a shop that has none gets its
 * own root (never placed under anybody: that takes an approved edge). null when the identity has no bridge id.
 */
async function nodeOf(entity_id, { ensure = false } = {}, client = pool) {
  if (!entity_id) return null;
  const { rows: [me] } = await client.query(
    `select identity_id, bridge_id, display_name from identities where identity_id = $1 and identity_type = 'entity'`, [entity_id]);
  if (!me || !me.bridge_id) return null;
  const { rows: [have] } = await client.query(`select * from cb_entity where bridge_id = $1`, [me.bridge_id]);
  if (have || !ensure) return have || null;
  await client.query(
    `insert into cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
     values ($1, $2, 'b2b', 'entity', $3::ltree, true) on conflict (bridge_id) do nothing`,
    [me.bridge_id, me.display_name || me.bridge_id, _label(me.bridge_id)]);
  const { rows: [made] } = await client.query(`select * from cb_entity where bridge_id = $1`, [me.bridge_id]);
  return made || null;
}
/** a business named by its handle or bridge id → its node (made a root if it has none) */
async function nodeOfHandle(ref, client = pool) {
  const { rows: [i] } = await client.query(
    `select identity_id from identities
      where (lower(user_id) = lower($1) or upper(bridge_id) = upper($1)) and identity_type = 'entity' and status = 'active'`, [String(ref || "")]);
  return i ? nodeOf(i.identity_id, { ensure: true }, client) : null;
}
async function hasLiveParent(childId, client = pool) {
  const { rows } = await client.query(
    `select 1 from cb_edge where child_id=$1 and type = $2 and state in ('active','suspended') limit 1`, [childId, TREE]);
  return rows.length > 0;
}

/**
 * mayAct(op, { edge, actorId, parentId, childId }) — PURE. The rule table in the header; true or a refusal message.
 * ⚠️ An edge from before `requested_by` was recorded is treated as asked by the PARENT, so the child consents — the rule
 * the service always had.
 */
function mayAct(op, { edge, actorId, parentId, childId }) {
  const a = String(actorId || ""), p = String(parentId || (edge && edge.parent_id) || ""), c = String(childId || (edge && edge.child_id) || "");
  if (!a) return "sign in as a business first";
  const side = a === p ? "parent" : (a === c ? "child" : null);
  if (!side) return "only the two businesses on this connection can act on it";
  if (op === "request" || op === "decline" || op === "disconnect") return true;
  if (op === "suspend" || op === "resume") return side === "parent" ? true : "only the network can suspend or resume a member";
  if (op === "approve") {
    const asked = String((edge && edge.requested_by) || p);
    return a !== asked ? true : "the other business has to accept this — you asked";
  }
  return "unknown operation";
}
const _check = (op, ctx) => { const ok = mayAct(op, ctx); if (ok !== true) throw err(403, ok, "NOT_ALLOWED"); };

// ---- LINK ----
/**
 * requestConnect({ parentId?, parentHandle?, childBridgeId?, childId?, childHandle?, type }, actor)
 * The actor is one of the two ends: a network inviting (parent = actor) or a business asking to join (child = actor).
 */
async function requestConnect({ parentId, parentHandle, childBridgeId, childId, childHandle, type = TREE }, actor) {
  if (!actor) throw err(401, "sign in as a business first", "NO_ACTOR");
  if ([TREE, "commercial"].indexOf(type) < 0) throw err(400, "type must be governance or commercial", "BAD_TYPE");
  const parent = parentId ? await getById(parentId) : (parentHandle ? await nodeOfHandle(parentHandle) : actor);
  if (!parent) throw err(404, "network not found", "PARENT_NOT_FOUND");
  const child = childId ? await getById(childId)
    : childHandle ? await nodeOfHandle(childHandle)
    : childBridgeId ? await _full(childBridgeId)
    : (String(parent.id) !== String(actor.id) ? actor : null);
  if (!child) throw err(404, "business not found — check the handle", "CHILD_NOT_FOUND");
  if (child.id === parent.id) throw err(400, "cannot connect to self", "SELF");
  _check("request", { actorId: actor.id, parentId: parent.id, childId: child.id });
  if (type === TREE && await hasLiveParent(child.id)) throw err(409, "child already in a network (tree-only)", "HAS_PARENT");
  const { rows: [open] } = await pool.query(
    `select * from cb_edge where parent_id=$1 and child_id=$2 and type=$3 and state in ('requested','active','suspended') limit 1`,
    [parent.id, child.id, type]);
  if (open) throw err(409, open.state === "requested" ? "already asked — waiting for an answer" : "already connected", "EXISTS");
  const { rows } = await pool.query(
    `insert into cb_edge(parent_id,child_id,type,state,requested_by)
     values ($1,$2,$3,'requested',$4) returning *`, [parent.id, child.id, type, actor.id]);
  return rows[0];
}
async function approve({ edgeId }, actor) {
  return withTx(async (c) => {
    const { rows: [edge] } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw err(404, "edge not found", "EDGE_NOT_FOUND");
    _check("approve", { edge, actorId: actor && actor.id });
    if (edge.state !== "requested") throw err(409, `cannot approve from ${edge.state}`, "BAD_STATE");
    if (edge.type === TREE) {
      const parent = await getById(edge.parent_id, c);
      const { rows: [child] } = await c.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
      if (!child.claimed) throw err(409, "child is an unclaimed stub — cannot consent", "UNCLAIMED");
      if (await hasLiveParent(child.id, c)) throw err(409, "child already in a network (tree-only)", "HAS_PARENT");
      const { rows: [{ bad }] } = await c.query(`select (($1::ltree) <@ ($2::ltree)) as bad`, [parent.path, child.path]);
      if (bad) throw err(409, "would create a cycle (parent under child)", "CYCLE");
      // reparent child subtree under parent (works whether child is a root or not)
      await c.query(
        `update cb_entity set path = ($1::ltree) || subpath(path, nlevel($2::ltree)-1)
         where path <@ ($2::ltree)`, [parent.path, child.path]);
    }
    const { rows: [updated] } = await c.query(
      `update cb_edge set state='active', approved_by=$2, decided_at=now() where id=$1 returning *`,
      [edgeId, actor.id]);
    if (edge.type === TREE) {
      await c.query(    // any other pending tree requests for this child are now moot
        `update cb_edge set state='declined', decided_at=now()
         where child_id=$1 and type=$3 and state='requested' and id<>$2`, [edge.child_id, edgeId, TREE]);
    }
    return updated;
  });
}
async function _edge(edgeId) {
  const { rows: [edge] } = await pool.query(`select * from cb_edge where id=$1`, [edgeId]);
  if (!edge) throw err(404, "edge not found", "EDGE_NOT_FOUND");
  return edge;
}
async function decline({ edgeId }, actor) {
  _check("decline", { edge: await _edge(edgeId), actorId: actor && actor.id });
  const { rows: [edge] } = await pool.query(
    `update cb_edge set state='declined', approved_by=$2, decided_at=now()
     where id=$1 and state='requested' returning *`, [edgeId, actor.id]);
  if (!edge) throw err(409, "no pending request to decline", "BAD_STATE");
  return edge;
}
async function _move(edgeId, from, to) {
  const { rows: [edge] } = await pool.query(
    `update cb_edge set state=$3 where id=$1 and state=$2 returning *`, [edgeId, from, to]);
  if (!edge) throw err(409, `cannot move to ${to}`, "BAD_STATE");
  return edge;
}
async function suspend(edgeId, actor) { _check("suspend", { edge: await _edge(edgeId), actorId: actor && actor.id }); return _move(edgeId, "active", "suspended"); }
async function resume(edgeId, actor)  { _check("resume",  { edge: await _edge(edgeId), actorId: actor && actor.id }); return _move(edgeId, "suspended", "active"); }
// ---- UNLINK ----
async function disconnect({ edgeId, settle = false }, actor) {
  return withTx(async (c) => {
    const { rows: [edge] } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw err(404, "edge not found", "EDGE_NOT_FOUND");
    _check("disconnect", { edge, actorId: actor && actor.id });
    if (!["active", "suspended"].includes(edge.state)) throw err(409, `cannot disconnect from ${edge.state}`, "BAD_STATE");
    // NET-02 §F: truth is the open-chit query; in_flight flag kept as an optional cache (so NET-01 T6 still blocks).
    const open = (await chit.edgeHasOpenChit(edge.id, c)) || edge.in_flight;
    if (open && !settle) throw err(409, "open chit on this edge — settle first", "IN_FLIGHT");
    if (open && settle) {   // compensation: withdraw open chits on this edge, clear the cache flag
      await c.query(`update cb_chit set txn_status='Withdrawn', updated_at=now()
                     where edge_id=$1 and txn_status in ('Active','Accepted','InProgress','Finished','Hold')`, [edge.id]);
      await c.query(`update cb_edge set in_flight=false where id=$1`, [edgeId]);
    }
    if (edge.type === TREE) {
      const { rows: [child] } = await c.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
      // detach: re-root the child subtree to its own root
      await c.query(
        `update cb_entity set path = subpath(path, nlevel($1::ltree)-1) where path <@ ($1::ltree)`, [child.path]);
    }
    const { rows: [updated] } = await c.query(
      `update cb_edge set state='disconnected', archived_at=now() where id=$1 returning *`, [edgeId]);
    // TODO: cascade-revoke grants that flowed through this edge (cb_grant) when grants land
    return updated;
  });
}
// ---- reads ----
/** a node may be read by a business in the same network (same root) — its own network, not somebody else's */
async function _sameRoot(nodeId, actor) {
  if (!actor) return false;
  const { rows: [r] } = await pool.query(
    `select subpath(e.path,0,1) = subpath($2::ltree,0,1) as same from cb_entity e where e.id = $1`, [nodeId, actor.path]);
  return !!(r && r.same);
}
async function subtree(entityId, actor) {
  const e = await getById(entityId); if (!e) throw err(404, "not found", "NOT_FOUND");
  if (!(await _sameRoot(e.id, actor))) throw err(403, "that is not your network", "NOT_ALLOWED");
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
async function connections(entityId, actor) {
  const e = await getById(entityId); if (!e) throw err(404, "not found", "NOT_FOUND");
  /* the node itself or one of its ancestors */
  const { rows: [ok] } = await pool.query(`select ($1::ltree <@ $2::ltree) as ok`, [e.path, actor ? actor.path : ""]).catch(() => ({ rows: [] }));
  if (!ok || !ok.ok) throw err(403, "those are not your connections", "NOT_ALLOWED");
  const { rows } = await pool.query(
    `select e.*, pp.name as parent_name, cc.name as child_name
     from cb_edge e join cb_entity pp on pp.id=e.parent_id join cb_entity cc on cc.id=e.child_id
     where (e.parent_id=$1 or e.child_id=$1) and e.state in ('requested','active','suspended')
     order by e.created_at desc`, [entityId]);
  return rows;
}
/** claim — only the business whose bridge id the node carries (the identity bridge is the proof) */
async function claim(entityId, actorEntityId) {
  const { rows: [e] } = await pool.query(
    `update cb_entity c set claimed=true
       from identities i
      where c.id=$1 and c.claimed=false and i.identity_id=$2 and i.bridge_id = c.bridge_id
      returning c.*`, [entityId, actorEntityId]);
  if (e) return e;
  const { rows: [exists] } = await pool.query(`select claimed from cb_entity where id=$1`, [entityId]);
  if (!exists) throw err(404, "not found", "NOT_FOUND");
  if (exists.claimed) throw err(409, "already claimed", "ALREADY_CLAIMED");
  throw err(403, "only the business this node belongs to can claim it", "NOT_ALLOWED");
}
module.exports = { register, lookup, getById, nodeOf, nodeOfHandle, mayAct, requestConnect, approve, decline, suspend, resume, disconnect, subtree, connections, claim, _full };
