/*
 * OWNS      /api/network: the tree of businesses and the edges between them (register · look up · place · subtree · connections · claim · request · approve · decline · suspend · resume · disconnect).
 * CALLED BY server.js (app.use('/api/network', ...))
 * FLOW      auth → write switch (gateWrite) → schema check (lib/network-contract.js) → src/services/network.js → res.json | problem(req, res, netFault(e, req))
 *           (API-STANDARD S1: every refusal is a Problem that keeps the keys it always had, frozen in docs/contracts/api-legacy.json)
 * CARD      04-network/connections-and-invitations
 */
const router = require('express').Router();
const net = require('../services/network');
const auth = require('../../middleware/auth'); // require a valid JWT on every network route
const { problem } = require('../../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../../middleware/validate'); // S9: the request is checked against the route's own schema
const contract = require('../../lib/network-contract'); // the contract (each route's operation) and the words of a refusal
// SECURITY (interim must-fix): cb_entity is DORMANT (2026-06-27 ruling) and these MUTATION routes still take
// authority from the request body (`actingEntityId`) — there is no cb_entity<->identities bridge yet to verify
// that the caller actually owns the entity/edge they are acting on. Until that bridge lands (Track B / ATH-86:
// derive actingEntityId from req.identity + check authority/cascade per op), writes are DISABLED unless
// NETWORK_WRITE_ENABLED=true (dev only). This removes the body-authority exposure in prod without shipping the
// half-built authority model. Reads stay available (auth still required). Full spec: docs/NETWORK-AUTHORITY.md.
/* ⭐ 2026-09-17: the authority half is built (src/services/network.js — the actor comes from the token, per-op rules), so writes
   are ON unless switched off. NETWORK_WRITE_ENABLED=false is the kill switch. */
const WRITES_ENABLED = process.env.NETWORK_WRITE_ENABLED !== 'false';
const auth_ = require('../../middleware/auth');
/** the signed-in business's node — made a root the first time it takes part */
const actorOf = (req) => net.nodeOf(auth_.entityOf(req), { ensure: true });
const gateWrite = (req, res, next) => (WRITES_ENABLED ? next() : problem(req, res, { status: 503, ...contract.words.writesOff() }));
/** the schema check of one route (its own operation in lib/network-contract.js) */
const checked = (route) => schemaValidate(contract.network.operationFor(route), contract.schemaOptions.network);
/** NET-48: a connection that names someone who cannot exist is answered "not found" before the database is asked */
const namesOne = (req, res, next) => {
  const refusal = contract.unknownSide(req.body || {});
  return refusal ? problem(req, res, refusal) : next();
};
const h = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    // C3: deliberate service errors (err(status,msg,code)) carry a safe message and keep it; anything else is unexpected —
    // logged server-side with the request id, and the caller gets the generic sentence, never err.message (netFault).
    problem(req, res, contract.netFault(e, req));
  }
};
router.post(
  '/entities',
  auth,
  gateWrite,
  checked('POST /entities'),
  h((req) => net.register(req.body))
);
router.get(
  '/entities/lookup',
  auth,
  checked('GET /entities/lookup'),
  h(async (req) => {
    const c = await net.lookup(req.query.bridgeId || '');
    return c ? { found: true, entity: c } : { found: false };
  })
);
router.post(
  '/entities/:id/claim',
  auth,
  gateWrite,
  checked('POST /entities/:id/claim'),
  h((req) => net.claim(req.params.id, auth_.entityOf(req)))
);
/**
 * ⭐⭐ GET /network/place?bridgeId=… — "where do I sit, and what is the whole network?", in ONE round trip.
 *
 * ⚠️ THE CLIENT WAS DOING THIS AS A SEQUENTIAL CHAIN OF FOUR DEPENDENT CALLS: lookup(me) → subtree(me) → read
 * the root out of the path → lookup(root) → subtree(root). Each step needs the previous one's answer, so they
 * cannot be parallelised on the client — and each is a full HTTP round trip.
 *
 * ⚠️ MEASURED 2026-08-18 against production, which is what makes this worth doing rather than tidy:
 *     entities/me                 3986 ms
 *     network-design              1578 ms
 *     network/entities/lookup     2373 ms
 * At those latencies a four-hop chain is 6–10 SECONDS of a screen with nothing on it. Server-side the same work
 * is two cheap queries on one pool with no network in between.
 *
 * ⚠️ IT DISCLOSES NOTHING NEW. Every field here is already reachable by the caller through the exact calls it
 * replaces — this removes trips, not permission checks. `auth` still applies, as on every route in this file.
 */
router.get(
  '/place',
  auth,
  checked('GET /place'),
  h(async (req) => {
    const card = await net.lookup(req.query.bridgeId || '');
    if (!card) return { found: false };
    const me = card.entity || card;
    if (!me || !me.id) return { found: false };

    const actor = await actorOf(req);
    const mine = await net.subtree(me.id, actor);
    const nodes0 = Array.isArray(mine) ? mine : (mine && mine.nodes) || [];

    /* WALK UP. subtree(me) is me AND MY DESCENDANTS, so a leaf gets back only itself — the one view that cannot
     answer "where do I sit?". The path names the root, so resolve that and take ITS subtree: the whole network,
     me included. Exactly the walk the client was making, minus three round trips. */
    const path = (nodes0[0] && nodes0[0].path) || '';
    const rootLabel = path ? String(path).split('.')[0] : '';
    const rootBridge = rootLabel ? rootLabel.replace(/_/g, '-') : '';

    let nodes = nodes0,
      refused = null;
    if (rootBridge && rootBridge !== String(me.bridgeId || me.bridge_id || '')) {
      const rc = await net.lookup(rootBridge);
      const root = rc && (rc.entity || rc);
      if (root && root.id) {
        /* ⭐ TOP-CORRECT: a SUSPENDED member is refused the network's tree (net.subtree, NOT_ALLOWED) — its own subtree still answers,
         with the refusal as a code + sentence the screen can branch on, never a 403 that reads like an outage */
        let whole = null;
        try {
          whole = await net.subtree(root.id, actor);
        } catch (e) {
          if (e.code !== 'NOT_ALLOWED') throw e;
          refused = { code: e.code, message: e.message };
        }
        const w = Array.isArray(whole) ? whole : (whole && whole.nodes) || null;
        if (w && w.length) nodes = w;
      }
    }
    return Object.assign({ found: true, entity: me, rootBridge, nodes }, refused ? { refused } : {});
  })
);

/* ⚠️ every write and scoped read acts AS the signed-in business — anything in the body that claims to be the actor is ignored */
router.get(
  '/entities/:id/subtree',
  auth,
  checked('GET /entities/:id/subtree'),
  h(async (req) => net.subtree(req.params.id, await actorOf(req)))
);
router.get(
  '/entities/:id/connections',
  auth,
  checked('GET /entities/:id/connections'),
  h(async (req) => net.connections(req.params.id, await actorOf(req)))
);
router.post(
  '/connections',
  auth,
  gateWrite,
  checked('POST /connections'),
  namesOne,
  h(async (req) => {
    const b = req.body || {};
    const out = await net.requestConnect(
      { parentId: b.parentId, parentHandle: b.parentHandle, childId: b.childId, childBridgeId: b.childBridgeId, childHandle: b.childHandle, type: b.type },
      await actorOf(req)
    );
    _told(out);
    return out;
  })
);
router.post(
  '/connections/:id/approve',
  auth,
  gateWrite,
  checked('POST /connections/:id/approve'),
  h(async (req) => _told(await net.approve({ edgeId: req.params.id }, await actorOf(req))))
);
router.post(
  '/connections/:id/decline',
  auth,
  gateWrite,
  checked('POST /connections/:id/decline'),
  h(async (req) => _told(await net.decline({ edgeId: req.params.id }, await actorOf(req))))
);
router.post(
  '/connections/:id/suspend',
  auth,
  gateWrite,
  checked('POST /connections/:id/suspend'),
  h(async (req) => _told(await net.suspend(req.params.id, await actorOf(req))))
);
router.post(
  '/connections/:id/resume',
  auth,
  gateWrite,
  checked('POST /connections/:id/resume'),
  h(async (req) => _told(await net.resume(req.params.id, await actorOf(req))))
);
router.post(
  '/connections/:id/disconnect',
  auth,
  gateWrite,
  checked('POST /connections/:id/disconnect'),
  h(async (req) => _told(await net.disconnect({ edgeId: req.params.id, settle: !!(req.body || {}).settle }, await actorOf(req))))
);
/** ⭐ both businesses on an edge hear that it moved — a store's counters re-read when it joins, is suspended or removed */
function _told(edge) {
  if (!edge || !edge.parent_id) return edge;
  require('../../db')
    .query("select i.identity_id from cb_entity c join identities i on i.bridge_id = c.bridge_id and i.identity_type = 'entity' where c.id = any($1::uuid[])", [
      [edge.parent_id, edge.child_id]
    ])
    .then((reply) =>
      reply.rows.forEach((x) => {
        try {
          require('../../lib/shopchanged').shopChanged(x.identity_id, 'network membership');
        } catch (signalError) {
          require('../../lib/logger').fellBack('network: the shop-changed signal was not sent — the shop sees the change on its next read', signalError);
        }
      })
    )
    .catch(() => {});
  return edge;
}
router.openapi = { paths: contract.network.pathsOf(), schemas: {} };

module.exports = router;
