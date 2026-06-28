const router = require("express").Router();
const net = require("../services/network");
const auth = require("../../middleware/auth");   // require a valid JWT on every network route
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
  catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || "ERR" }); }
};
router.post("/entities",               auth, gateWrite, h((req) => net.register(req.body)));
router.get ("/entities/lookup",        auth, h(async (req) => { const c = await net.lookup(req.query.bridgeId || ""); return c ? { found: true, entity: c } : { found: false }; }));
router.post("/entities/:id/claim",     auth, gateWrite, h((req) => net.claim(req.params.id)));
router.get ("/entities/:id/subtree",   auth, h((req) => net.subtree(req.params.id)));
router.get ("/entities/:id/connections", auth, h((req) => net.connections(req.params.id)));
router.post("/connections",                 auth, gateWrite, h((req) => net.requestConnect(req.body)));
router.post("/connections/:id/approve",     auth, gateWrite, h((req) => net.approve({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/decline",     auth, gateWrite, h((req) => net.decline({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/suspend",     auth, gateWrite, h((req) => net.suspend(req.params.id)));
router.post("/connections/:id/resume",      auth, gateWrite, h((req) => net.resume(req.params.id)));
router.post("/connections/:id/disconnect",  auth, gateWrite, h((req) => net.disconnect({ edgeId: req.params.id, settle: !!req.body.settle })));
module.exports = router;
