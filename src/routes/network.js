const router = require("express").Router();
const net = require("../services/network");
const h = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || "ERR" }); }
};
router.post("/entities",               h((req) => net.register(req.body)));
router.get ("/entities/lookup",        h(async (req) => { const c = await net.lookup(req.query.bridgeId || ""); return c ? { found: true, entity: c } : { found: false }; }));
router.post("/entities/:id/claim",     h((req) => net.claim(req.params.id)));
router.get ("/entities/:id/subtree",   h((req) => net.subtree(req.params.id)));
router.get ("/entities/:id/connections", h((req) => net.connections(req.params.id)));
router.post("/connections",                 h((req) => net.requestConnect(req.body)));
router.post("/connections/:id/approve",     h((req) => net.approve({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/decline",     h((req) => net.decline({ edgeId: req.params.id, actingEntityId: req.body.actingEntityId })));
router.post("/connections/:id/suspend",     h((req) => net.suspend(req.params.id)));
router.post("/connections/:id/resume",      h((req) => net.resume(req.params.id)));
router.post("/connections/:id/disconnect",  h((req) => net.disconnect({ edgeId: req.params.id, settle: !!req.body.settle })));
module.exports = router;
