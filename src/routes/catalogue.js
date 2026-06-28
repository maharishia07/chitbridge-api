const router = require("express").Router();
const cat = require("../services/catalogue");
const auth = require("../../middleware/auth");   // require a valid JWT on every cb_* catalogue route
const { safeErr } = require("../../lib/respond");   // generic client error + server-side log (C3)
// SECURITY (interim must-fix — mirrors src/routes/network.js): cb_* is DORMANT (2026-06-27 ruling). These routes
// previously had NEITHER auth NOR a write gate and took entityId straight from the client URL param, so they were
// reachable UNAUTHENTICATED on the public internet (read/write/delete + insert-bloat). Now: `auth` on EVERY route;
// the 4 MUTATION routes are DISABLED unless NETWORK_WRITE_ENABLED=true (dev only) via the same gateWrite as
// network.js. Reads stay available (auth still required). Full spec: docs/NETWORK-AUTHORITY.md.
// RESIDUAL (Track B / ATH-86 — do NOT silently fix here): even with auth, the GET routes still trust the
// client-supplied :id, so an authenticated entity could read ANOTHER entity's cb_* catalogue. Tolerated as
// interim ONLY because cb_* is dormant; the real fix derives entityId from req.identity via the
// cb_entity<->identities bridge (same as network.js's reads).
const WRITES_ENABLED = process.env.NETWORK_WRITE_ENABLED === "true";
const gateWrite = (req, res, next) => WRITES_ENABLED ? next()
  : res.status(503).json({ error: "Network editing disabled",
      message: "Network changes aren't available yet.", code: "NET_WRITE_DISABLED" });
const h = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, code: e.code||"ERR" }); res.status(500).json({ error: safeErr(e), code: "ERR" }); } };  // C3: no err.message leak on unexpected errors
router.get ("/entities/:id/catalogue",            auth,            h((req) => cat.listItems({ entityId: req.params.id, tier: req.query.tier || null })));
router.post("/entities/:id/catalogue",            auth, gateWrite, h((req) => cat.createItem({ ...req.body, entityId: req.params.id })));
router.get ("/entities/:id/catalogue/categories", auth,            h((req) => cat.listCategories(req.params.id)));
router.post("/entities/:id/catalogue/categories", auth, gateWrite, h((req) => cat.createCategory({ ...req.body, entityId: req.params.id })));
router.patch ("/catalogue/:itemId",               auth, gateWrite, h((req) => cat.updateItem(req.params.itemId, req.body)));
router.delete("/catalogue/:itemId",               auth, gateWrite, h((req) => cat.deleteItem(req.params.itemId)));
module.exports = router;
