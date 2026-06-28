const router = require("express").Router();
const net = require("../services/network");
const auth = require("../../middleware/auth");   // require a valid JWT on every network route
// NOTE: this closes UNAUTHENTICATED access. Full authority is still TODO — `actingEntityId` is taken from the
// body (client-supplied); the real fix derives it from req.identity via the cb_entity<->identities bridge.
const h = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || "ERR" }); }
};
router.post("/entities",               auth, h((req) => net.register(req.body)));
router.get ("/entities/lookup",        auth, h(async (req) => { const c = await net.lookup(req.query.bridgeId || ""); return c ? { found: true, entity: c } : { found: false }; }));
router.post("/entities/:id/claim",     auth, h((req) => net.claim(req.params.id)));
router.get ("/entities/:id/subtree",   auth, h((req) => net.subtree(req.params.id)));
router.get ("/entities/:id/connections", auth, h((req) => net.connections(req.params.id)));
router.post("/connections",                 auth, h((req) => net.requestConnect(req.body)));
router.post("/connections/:id/approve",     auth, h((req) => net.approve({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/decline",     auth, h((req) => net.decline({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/suspend",     auth, h((req) => net.suspend(req.params.id)));
router.post("/connections/:id/resume",      auth, h((req) => net.resume(req.params.id)));
router.post("/connections/:id/disconnect",  auth, h((req) => net.disconnect({ edgeId: req.params.id, settle: !!req.body.settle })));
module.exports = router;
