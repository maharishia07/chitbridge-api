const router = require("express").Router();
const net = require("../services/network");
const auth = require("../../middleware/auth");   // require a valid JWT on every network route
const { safeErr } = require("../../lib/respond");   // generic client error + server-side log (C3)
// SECURITY (interim must-fix): cb_entity is DORMANT (2026-06-27 ruling) and these MUTATION routes still take
// authority from the request body (`actingEntityId`) — there is no cb_entity<->identities bridge yet to verify
// that the caller actually owns the entity/edge they are acting on. Until that bridge lands (Track B / ATH-86:
// derive actingEntityId from req.identity + check authority/cascade per op), writes are DISABLED unless
// NETWORK_WRITE_ENABLED=true (dev only). This removes the body-authority exposure in prod without shipping the
// half-built authority model. Reads stay available (auth still required). Full spec: docs/NETWORK-AUTHORITY.md.
const WRITES_ENABLED = process.env.NETWORK_WRITE_ENABLED === "true";
const gateWrite = (req, res, next) => WRITES_ENABLED ? next()
  : res.status(503).json({ error: "Network editing disabled",
      message: "Network changes aren't available yet.", code: "NET_WRITE_DISABLED" });
const h = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) {
    // C3: deliberate service errors (err(status,msg,code)) carry a safe message; anything else is unexpected —
    // log it server-side + return a generic message so we never leak err.message (DB/stack) to the client.
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code || "ERR" });
    res.status(500).json({ error: safeErr(e), code: "ERR" });
  }
};
router.post("/entities",               auth, gateWrite, h((req) => net.register(req.body)));
router.get ("/entities/lookup",        auth, h(async (req) => { const c = await net.lookup(req.query.bridgeId || ""); return c ? { found: true, entity: c } : { found: false }; }));
router.post("/entities/:id/claim",     auth, gateWrite, h((req) => net.claim(req.params.id)));
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
router.get ("/place", auth, h(async (req) => {
  const card = await net.lookup(req.query.bridgeId || "");
  if (!card) return { found: false };
  const me = card.entity || card;
  if (!me || !me.id) return { found: false };

  const mine = await net.subtree(me.id);
  const nodes0 = Array.isArray(mine) ? mine : (mine && mine.nodes) || [];

  /* WALK UP. subtree(me) is me AND MY DESCENDANTS, so a leaf gets back only itself — the one view that cannot
     answer "where do I sit?". The path names the root, so resolve that and take ITS subtree: the whole network,
     me included. Exactly the walk the client was making, minus three round trips. */
  const path = (nodes0[0] && nodes0[0].path) || "";
  const rootLabel = path ? String(path).split(".")[0] : "";
  const rootBridge = rootLabel ? rootLabel.replace(/_/g, "-") : "";

  let nodes = nodes0;
  if (rootBridge && rootBridge !== String(me.bridgeId || me.bridge_id || "")) {
    const rc = await net.lookup(rootBridge);
    const root = rc && (rc.entity || rc);
    if (root && root.id) {
      const whole = await net.subtree(root.id);
      const w = Array.isArray(whole) ? whole : (whole && whole.nodes) || null;
      if (w && w.length) nodes = w;
    }
  }
  return { found: true, entity: me, rootBridge, nodes };
}));

router.get ("/entities/:id/subtree",   auth, h((req) => net.subtree(req.params.id)));
router.get ("/entities/:id/connections", auth, h((req) => net.connections(req.params.id)));
router.post("/connections",                 auth, gateWrite, h((req) => net.requestConnect(req.body)));
router.post("/connections/:id/approve",     auth, gateWrite, h((req) => net.approve({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/decline",     auth, gateWrite, h((req) => net.decline({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/suspend",     auth, gateWrite, h((req) => net.suspend(req.params.id)));
router.post("/connections/:id/resume",      auth, gateWrite, h((req) => net.resume(req.params.id)));
router.post("/connections/:id/disconnect",  auth, gateWrite, h((req) => net.disconnect({ edgeId: req.params.id, settle: !!req.body.settle })));
module.exports = router;
