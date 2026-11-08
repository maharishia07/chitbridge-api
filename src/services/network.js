/**
 * OWNS      the network tree and the edges between businesses: look up, register, request/approve/decline/suspend/resume/disconnect, claim, subtree, connections (who may do what is mayAct, one pure table)
 * CALLED BY lib/network-build-run.js, lib/network-membership.js, routes/assist.js, src/routes/network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * FLOW      signed-in business → nodeOf (its place on the tree) → mayAct / same-network test → cb_entity · cb_edge → a row, or the 404 a missing id gets (SEC-138)
 * CARD      04-network/connections-and-invitations
 */
const { pool, withTx } = require('../db');
const bridge = require('../lib/bridgeId');
const ctpaddress = require('../../lib/ctpaddress'); // NET-77: the one reader of "is this business on another installation"
const chit = require('./chit'); // NET-02 §F: real in-flight check
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
 * parent (and disconnecting it moves the subtree back to its own root): the one consented door through the root-immutable trigger, NET-93 reRootGuard.
 * `commercial` is a brand's network of stores: a store may hold many (one per brand — b261), and it never moves
 * the tree. Membership reads both (lib/network-membership.js).
 */
const TREE = 'governance';

async function register({ name, mode, businessType, ownerScope = 'entity', claimed = true, appRef = null }) {
  if (!name) throw err(400, 'name required', 'NAME_REQUIRED');
  // recon delta: derive mode from business_type when mode not explicitly given.
  // Aggregator/Circle = network host/group (b2b); Business = customer-facing leaf (b2c). [mapping to confirm]
  if (!mode) mode = businessType === 'Business' ? 'b2c' : businessType === 'Aggregator' || businessType === 'Circle' ? 'b2b' : 'b2b';
  for (let count = 0; count < 5; count++) {
    const bid = bridge.mint(),
      label = bridge.toLabel(bid);
    try {
      const { rows } = await pool.query(
        `insert into cb_entity(bridge_id,name,mode,owner_scope,path,claimed,app_ref)
         values ($1,$2,$3,$4,$5::ltree,$6,$7) returning *`,
        [bid, name, mode, ownerScope, label, claimed, appRef]
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') continue;
      throw e;
    } // bridge_id collision -> retry
  }
  throw err(500, 'could not mint a unique bridge id', 'MINT_FAILED');
}
const _card = (r) => r && { id: r.id, bridgeId: r.bridge_id, name: r.name, mode: r.mode, claimed: r.claimed, status: r.status };
async function lookup(bridgeId) {
  // PUBLIC card only — default-deny on internals
  const { rows } = await pool.query(`select * from cb_entity where bridge_id=$1`, [String(bridgeId).toUpperCase()]);
  return _card(rows[0]);
}
async function getById(id, client = pool) {
  const { rows } = await client.query(`select * from cb_entity where id=$1`, [id]);
  return rows[0] || null;
}
async function _full(bridgeId) {
  const { rows } = await pool.query(`select * from cb_entity where bridge_id=$1`, [String(bridgeId).toUpperCase()]);
  return rows[0] || null;
}
/** a bridge id as an ltree label — the same spelling the network build uses (dashes are not legal in a label) */
const _label = (bid) => String(bid).replace(/[^A-Za-z0-9_]/g, '_');
/**
 * nodeOf(entity_id, { ensure }) — the signed-in business's place on the tree. With `ensure`, a shop that has none gets its
 * own root (never placed under anybody: that takes an approved edge). null when the identity has no bridge id.
 */
async function nodeOf(entity_id, { ensure = false } = {}, client = pool) {
  if (!entity_id) return null;
  const {
    rows: [me]
  } = await client.query(`select identity_id, bridge_id, display_name from identities where identity_id = $1 and identity_type = 'entity'`, [entity_id]);
  if (!me || !me.bridge_id) return null;
  const {
    rows: [have]
  } = await client.query(`select * from cb_entity where bridge_id = $1`, [me.bridge_id]);
  if (have || !ensure) return have || null;
  await client.query(
    `insert into cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
     values ($1, $2, 'b2b', 'entity', $3::ltree, true) on conflict (bridge_id) do nothing`,
    [me.bridge_id, me.display_name || me.bridge_id, _label(me.bridge_id)]
  );
  const {
    rows: [made]
  } = await client.query(`select * from cb_entity where bridge_id = $1`, [me.bridge_id]);
  return made || null;
}
/** the identity a handle or bridge id names (a read, nothing written), or null */
async function identityOfHandle(ref, client = pool) {
  const {
    rows: [i]
  } = await client.query(
    `select identity_id from identities
      where (lower(user_id) = lower($1) or upper(bridge_id) = upper($1)) and identity_type = 'entity' and status = 'active'`,
    [String(ref || '')]
  );
  return i ? i.identity_id : null;
}
/** a business named by its handle or bridge id → its node (made a root if it has none) */
async function nodeOfHandle(ref, client = pool) {
  const identityId = await identityOfHandle(ref, client);
  return identityId ? nodeOf(identityId, { ensure: true }, client) : null;
}
async function hasLiveParent(childId, client = pool) {
  const { rows } = await client.query(`select 1 from cb_edge where child_id=$1 and type = $2 and state in ('active','suspended') limit 1`, [childId, TREE]);
  return rows.length > 0;
}

/**
 * mayAct(op, { edge, actorId, parentId, childId }) — PURE. The rule table in the header; true or a refusal message.
 * ⚠️ An edge from before `requested_by` was recorded is treated as asked by the PARENT, so the child consents — the rule
 * the service always had.
 */
function mayAct(op, { edge, actorId, parentId, childId }) {
  const a = String(actorId || ''),
    p = String(parentId || (edge && edge.parent_id) || ''),
    c = String(childId || (edge && edge.child_id) || '');
  if (!a) return 'sign in as a business first';
  const side = a === p ? 'parent' : a === c ? 'child' : null;
  if (!side) return 'only the two businesses on this connection can act on it';
  if (op === 'request' || op === 'decline' || op === 'disconnect') return true;
  if (op === 'suspend' || op === 'resume') return side === 'parent' ? true : 'only the network can suspend or resume a member';
  if (op === 'approve') {
    const asked = String((edge && edge.requested_by) || p);
    return a !== asked ? true : 'the other business has to accept this — you asked';
  }
  return 'unknown operation';
}
const _check = (op, ctx) => {
  const ok = mayAct(op, ctx);
  if (ok !== true) throw err(403, ok, 'NOT_ALLOWED');
};
/**
 * SEC-138 (K-1): an edge the caller is not a party to is answered EXACTLY as an edge that does not exist (404 EDGE_NOT_FOUND, the same words),
 * so the id tells a stranger nothing. A party still gets the rule's own 403 (asked it yourself, only the network may suspend): it already knows the edge.
 * A caller with no actor (no place on the tree) is a stranger too: the same 404, never the 403 "sign in as a business" an existing edge would give (residual A).
 */
const _edgeGone = () => err(404, 'edge not found', 'EDGE_NOT_FOUND');
const _checkEdge = (operation, edge, actor) => {
  const actorId = String((actor && actor.id) || '');
  if (!actorId || (actorId !== String(edge.parent_id) && actorId !== String(edge.child_id))) throw _edgeGone();
  _check(operation, { edge, actorId });
};

// ---- LINK ----
/**
 * NET-77 · a business on ANOTHER installation is only a stub row here. An edge to it would live on this server alone (the far server answers
 * EDGE_NOT_FOUND; this one would list it as asked forever, the RAIL-112 pattern). So the ask is refused in words and nothing is saved.
 * ⚠️ TEMPORARY: NET-79 is the real fix (the ask travels as a CTP event and the far side holds its copy). When it lands, delete this refusal.
 * The remote test is the one reader ctpaddress.resolve (the stamp, inactive installations included); a local business answers local.
 */
async function refuseRemote(identityIds) {
  for (const identityId of identityIds) {
    if (!identityId) throw err(409, 'We could not tell where that business is hosted, so the connection was not asked. Nothing was saved.', 'NETWORK_REMOTE_NOT_YET');
    const place = await ctpaddress.resolve(identityId);
    if (place.local === false) throw err(409, 'That business is on another ChitBridge installation, and a connection across installations cannot be asked yet. Nothing was saved.', 'NETWORK_REMOTE_NOT_YET');
    /* the same rule as lib/mint.refuseUnresolved: a business whose installation could not be read may belong to a remote one, so it is not asked either */
    if (place.resolved === false) throw err(409, 'We could not read where that business is hosted just now, so the connection was not asked. Nothing was saved.', 'NETWORK_REMOTE_NOT_YET');
  }
}
/** refuseRemoteNodes(nodes) — the same refusal for nodes already read: each node's identity is looked up by its bridge id (none found = refused, fail closed) */
async function refuseRemoteNodes(nodes) {
  const ids = [];
  for (const node of nodes) {
    const {
      rows: [identityRow]
    } = await pool.query(`select identity_id from identities where upper(bridge_id) = upper($1) and identity_type = 'entity'`, [node.bridge_id]);
    ids.push(identityRow && identityRow.identity_id);
  }
  await refuseRemote(ids);
}
/** a business named by handle, refused if remote BEFORE any node is made for it (a refused ask writes nothing) → its node, or null */
async function askableNodeOfHandle(handle) {
  const identityId = await identityOfHandle(handle);
  if (!identityId) return null;
  await refuseRemote([identityId]);
  return nodeOf(identityId, { ensure: true });
}
/** the network end of an ask: named by node id or handle, else the actor itself */
async function _askedParent({ parentId, parentHandle }, actor) {
  if (parentId) return getById(parentId);
  return parentHandle ? askableNodeOfHandle(parentHandle) : actor;
}
/** the business end of an ask: named by node id, handle or bridge id, else the actor when the actor is not the parent */
async function _askedChild({ childId, childHandle, childBridgeId }, parent, actor) {
  if (childId) return getById(childId);
  if (childHandle) return askableNodeOfHandle(childHandle);
  if (childBridgeId) return _full(childBridgeId);
  return String(parent.id) !== String(actor.id) ? actor : null;
}
/**
 * requestConnect({ parentId?, parentHandle?, childBridgeId?, childId?, childHandle?, type }, actor)
 * The actor is one of the two ends: a network inviting (parent = actor) or a business asking to join (child = actor).
 */
async function requestConnect({ parentId, parentHandle, childBridgeId, childId, childHandle, type = TREE }, actor) {
  if (!actor) throw err(401, 'sign in as a business first', 'NO_ACTOR');
  if ([TREE, 'commercial'].indexOf(type) < 0) throw err(400, 'type must be governance or commercial', 'BAD_TYPE');
  const parent = await _askedParent({ parentId, parentHandle }, actor);
  if (!parent) throw err(404, 'network not found', 'PARENT_NOT_FOUND');
  const child = await _askedChild({ childId, childHandle, childBridgeId }, parent, actor);
  if (!child) throw err(404, 'business not found — check the handle', 'CHILD_NOT_FOUND');
  if (child.id === parent.id) throw err(400, 'cannot connect to self', 'SELF');
  _check('request', { actorId: actor.id, parentId: parent.id, childId: child.id });
  await refuseRemoteNodes([parent, child]);
  if (type === TREE && (await hasLiveParent(child.id))) throw err(409, 'child already in a network (tree-only)', 'HAS_PARENT');
  const {
    rows: [open]
  } = await pool.query(`select * from cb_edge where parent_id=$1 and child_id=$2 and type=$3 and state in ('requested','active','suspended') limit 1`, [
    parent.id,
    child.id,
    type
  ]);
  if (open) throw err(409, open.state === 'requested' ? 'already asked — waiting for an answer' : 'already connected', 'EXISTS');
  const { rows } = await pool.query(
    `insert into cb_edge(parent_id,child_id,type,state,requested_by)
     values ($1,$2,$3,'requested',$4) returning *`,
    [parent.id, child.id, type, actor.id]
  );
  return rows[0];
}
/**
 * NET-93 · the ONE door through migration b843's root-immutable trigger. Joining a network (approve a governance edge) and leaving it (disconnect)
 * move a whole subtree to another root, which the trigger refuses unless this transaction names the business's OWN root (its label) in cb.net_reroot.
 * Called only after the edge's rule (mayAct: the child consented, or a party disconnects); the setting lasts for this transaction alone.
 * Before b843 is run the setting is simply never read, so this is safe on a database without the trigger.
 */
async function reRootGuard(dbClient, ownPath) {
  await dbClient.query(`select set_config('cb.net_reroot', subpath($1::ltree, 0, 1)::text, true)`, [ownPath]);
}
/** approve, tree edge: the child (a claimed root with no live parent) and its subtree move under the parent; a cycle or a node already inside a tree is a 409 with its code */
async function joinTree(dbClient, edge) {
  const parent = await getById(edge.parent_id, dbClient);
  const {
    rows: [child]
  } = await dbClient.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
  if (!child.claimed) throw err(409, 'child is an unclaimed stub — cannot consent', 'UNCLAIMED');
  if (await hasLiveParent(child.id, dbClient)) throw err(409, 'child already in a network (tree-only)', 'HAS_PARENT');
  const {
    rows: [{ bad, deep }]
  } = await dbClient.query(`select (($1::ltree) <@ ($2::ltree)) as bad, nlevel($2::ltree) > 1 as deep`, [parent.path, child.path]);
  if (bad) throw err(409, 'would create a cycle (parent under child)', 'CYCLE');
  // NET-93: only a business that is its own network can join one; a node already inside a tree (a stale edge) never walks out of it by this door
  if (deep) throw err(409, 'child already in a network (tree-only)', 'HAS_PARENT');
  await reRootGuard(dbClient, child.path);
  await dbClient.query(
    `update cb_entity set path = ($1::ltree) || subpath(path, nlevel($2::ltree)-1)
     where path <@ ($2::ltree)`,
    [parent.path, child.path]
  );
}
async function approve({ edgeId }, actor) {
  return withTx(async (c) => {
    const {
      rows: [edge]
    } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw _edgeGone();
    _checkEdge('approve', edge, actor);
    if (edge.state !== 'requested') throw err(409, `cannot approve from ${edge.state}`, 'BAD_STATE');
    if (edge.type === TREE) await joinTree(c, edge);
    const {
      rows: [updated]
    } = await c.query(`update cb_edge set state='active', approved_by=$2, decided_at=now() where id=$1 returning *`, [edgeId, actor.id]);
    if (edge.type === TREE) {
      await c.query(
        // any other pending tree requests for this child are now moot
        `update cb_edge set state='declined', decided_at=now()
         where child_id=$1 and type=$3 and state='requested' and id<>$2`,
        [edge.child_id, edgeId, TREE]
      );
    }
    return updated;
  });
}
/** NET-EDGE: the keys an edge answer names (docs/contracts/api-output-shapes.json, the five connections/:id routes) - a column added to cb_edge never reaches the answer unasked */
const EDGE_KEYS = ['id', 'parent_id', 'child_id', 'type', 'state', 'requested_by', 'in_flight', 'created_at'];
const EDGE_ASKED_KEYS = ['id', 'parent_id', 'child_id', 'type', 'state', 'requested_by'];
const edgeView = (row, keys = EDGE_KEYS) => (row ? Object.fromEntries(keys.map((key) => [key, row[key]])) : row);
async function _edge(edgeId) {
  const {
    rows: [edge]
  } = await pool.query(`select * from cb_edge where id=$1`, [edgeId]);
  if (!edge) throw _edgeGone();
  return edge;
}
async function decline({ edgeId }, actor) {
  _checkEdge('decline', await _edge(edgeId), actor);
  const {
    rows: [edge]
  } = await pool.query(
    `update cb_edge set state='declined', approved_by=$2, decided_at=now()
     where id=$1 and state='requested' returning *`,
    [edgeId, actor.id]
  );
  if (!edge) throw err(409, 'no pending request to decline', 'BAD_STATE');
  return edge;
}
async function _move(edgeId, from, to) {
  const {
    rows: [edge]
  } = await pool.query(`update cb_edge set state=$3 where id=$1 and state=$2 returning *`, [edgeId, from, to]);
  if (!edge) throw err(409, `cannot move to ${to}`, 'BAD_STATE');
  return edge;
}
async function suspend(edgeId, actor) {
  _checkEdge('suspend', await _edge(edgeId), actor);
  return _move(edgeId, 'active', 'suspended');
}
async function resume(edgeId, actor) {
  _checkEdge('resume', await _edge(edgeId), actor);
  return _move(edgeId, 'suspended', 'active');
}
// ---- UNLINK ----
async function disconnect({ edgeId, settle = false }, actor) {
  return withTx(async (c) => {
    const {
      rows: [edge]
    } = await c.query(`select * from cb_edge where id=$1 for update`, [edgeId]);
    if (!edge) throw _edgeGone();
    _checkEdge('disconnect', edge, actor);
    if (!['active', 'suspended'].includes(edge.state)) throw err(409, `cannot disconnect from ${edge.state}`, 'BAD_STATE');
    // NET-02 §F: truth is the open-chit query; in_flight flag kept as an optional cache (so NET-01 T6 still blocks).
    const open = (await chit.edgeHasOpenChit(edge.id, c)) || edge.in_flight;
    if (open && !settle) throw err(409, 'open chit on this edge — settle first', 'IN_FLIGHT');
    if (open && settle) {
      // compensation: withdraw open chits on this edge, clear the cache flag
      await c.query(
        `update cb_chit set txn_status='Withdrawn', updated_at=now()
                     where edge_id=$1 and txn_status in ('Active','Accepted','InProgress','Finished','Hold')`,
        [edge.id]
      );
      await c.query(`update cb_edge set in_flight=false where id=$1`, [edgeId]);
    }
    if (edge.type === TREE) {
      const {
        rows: [child]
      } = await c.query(`select * from cb_entity where id=$1 for update`, [edge.child_id]);
      // detach: re-root the child subtree to its own root
      await reRootGuard(c, child.path);
      await c.query(`update cb_entity set path = subpath(path, nlevel($1::ltree)-1) where path <@ ($1::ltree)`, [child.path]);
    }
    const {
      rows: [updated]
    } = await c.query(`update cb_edge set state='disconnected', archived_at=now() where id=$1 returning *`, [edgeId]);
    // TODO: cascade-revoke grants that flowed through this edge (cb_grant) when grants land
    return updated;
  });
}
// ---- reads ----
/**
 * a node may be read by a business in the same network (same root) — its own network, not somebody else's.
 * ⭐ TOP-CORRECT (2026-10-14): and the reader must be IN STANDING — suspend changes only cb_edge.state, never the path, so the
 * root alone let a suspended member go on reading the whole tree. The edge-state read is lib/network-membership.standingSql,
 * the same one the catalogue's `network` tier asks. A member's OWN node stays readable to it (it sees where it was suspended).
 */
async function _sameRoot(nodeId, actor) {
  if (!actor) return false;
  const standing = require('../../lib/network-membership').standingSql('$2::ltree');
  const {
    rows: [r]
  } = await pool.query(`select (subpath(e.path,0,1) = subpath($2::ltree,0,1) and (e.id = $3 or ${standing})) as same from cb_entity e where e.id = $1`, [
    nodeId,
    actor.path,
    actor.id
  ]);
  return !!(r && r.same);
}
const _nodeGone = () => err(404, 'not found', 'NOT_FOUND');
const _rootOf = (path) => String(path || '').split('.')[0];
async function subtree(entityId, actor) {
  const e = await getById(entityId);
  if (!e) throw _nodeGone();
  /* SEC-138: a node of ANOTHER network is answered as a node that does not exist (no second query: the root is the first label of the path).
     Only an id inside the caller's own network may say "suspended". */
  if (!actor || _rootOf(e.path) !== _rootOf(actor.path)) throw _nodeGone(); // no actor: a stranger too (residual A)
  if (!(await _sameRoot(e.id, actor)))
    throw err(403, 'that is not your network — or your membership is suspended; ask the network to resume it', 'NOT_ALLOWED');
  // b117: the PURPOSE joined in, so a member reading the tree sees why each branch exists rather than a list of
  // bare names. One LEFT JOIN on the same query — never a lookup per node, which at any real depth is the O(1)
  // rule broken in the least visible way.
  const { rows } = await pool.query(
    `select e.id, e.bridge_id, e.name, e.path::text, nlevel(e.path)-nlevel($1::ltree) as depth,
            i.purpose, i.sort_order, i.city, i.lat, i.lng, i.service_km
       from cb_entity e
       left join identities i on i.bridge_id = e.bridge_id and i.identity_type = 'entity'
      where e.path <@ ($1::ltree) order by e.path`,
    [e.path]
  );
  return rows;
}
async function connections(entityId, actor) {
  const e = await getById(entityId);
  if (!e) throw _nodeGone();
  /* the caller's own node or a node below it (the ltree test e.path <@ actor.path, done on the row already read: no second query).
     SEC-138: any other node answers as one that does not exist. */
  const mine = String((actor && actor.path) || ''); // no actor: nothing is below it, so the node answers as gone (residual A)
  if (!mine || (String(e.path) !== mine && !String(e.path).startsWith(mine + '.'))) throw _nodeGone();
  const { rows } = await pool.query(
    `select e.*, pp.name as parent_name, cc.name as child_name
     from cb_edge e join cb_entity pp on pp.id=e.parent_id join cb_entity cc on cc.id=e.child_id
     where (e.parent_id=$1 or e.child_id=$1) and e.state in ('requested','active','suspended')
     order by e.created_at desc`,
    [entityId]
  );
  return rows;
}
/** claim — only the business whose bridge id the node carries (the identity bridge is the proof) */
async function claim(entityId, actorEntityId) {
  const {
    rows: [e]
  } = await pool.query(
    `update cb_entity c set claimed=true
       from identities i
      where c.id=$1 and c.claimed=false and i.identity_id=$2 and i.bridge_id = c.bridge_id
      returning c.*`,
    [entityId, actorEntityId]
  );
  if (e) return e;
  /* SEC-138: "already claimed" is told ONLY to the business whose bridge id the node carries (it holds the claim path and knows the node);
     a missing node, a node of someone else and a node claimed by someone else all answer the one 404. One statement, so the work is the same for each. */
  const {
    rows: [seen]
  } = await pool.query(
    `select c.claimed as claimed, (i.bridge_id = c.bridge_id) as mine
       from cb_entity c left join identities i on i.identity_id=$2
      where c.id=$1`,
    [entityId, actorEntityId]
  );
  if (seen && seen.mine && seen.claimed) throw err(409, 'already claimed', 'ALREADY_CLAIMED');
  throw _nodeGone();
}
module.exports = {
  EDGE_KEYS,
  EDGE_ASKED_KEYS,
  edgeView,
  register,
  lookup,
  getById,
  nodeOf,
  nodeOfHandle,
  mayAct,
  requestConnect,
  approve,
  decline,
  suspend,
  resume,
  disconnect,
  subtree,
  connections,
  claim,
  _full
};
