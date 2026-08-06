const router = require("express").Router();
const cat = require("../services/catalogue");
const auth = require("../../middleware/auth");   // require a valid JWT on every cb_* catalogue route
const { safeErr } = require("../../lib/respond");   // generic client error + server-side log (C3)
// SECURITY (interim must-fix — mirrors src/routes/network.js): cb_* is DORMANT (2026-06-27 ruling). These routes
// previously had NEITHER auth NOR a write gate and took entityId straight from the client URL param, so they were
// reachable UNAUTHENTICATED on the public internet (read/write/delete + insert-bloat). Now: `auth` on EVERY route;
// the 4 MUTATION routes are DISABLED unless NETWORK_WRITE_ENABLED=true (dev only) via the same gateWrite as
// network.js. Reads stay available (auth still required). Full spec: docs/NETWORK-AUTHORITY.md.
// ── ATH-86 RESOLVED, 2026-08-06 ────────────────────────────────────────────────────────────────────────────────
// The residual note that used to sit here said: "even with auth, the GET routes still trust the client-supplied
// :id, so an authenticated entity could read ANOTHER entity's cb_* catalogue… do NOT silently fix here; the real
// fix derives entityId from req.identity via the cb_entity<->identities bridge."
//
// Athi found it from the other direction — *"if we see the network, it should show only the public catalogue"* —
// and asked for it closed. So this is the real fix, not a patch over it: the bridge the note asked for exists,
// because `cb_entity.bridge_id` and `identities.bridge_id` are the same value, and the JWT carries it.
//
// THE RULE IS THE STOREFRONT'S RULE, deliberately — SPEC-one-path-many-principals. A reader gets their OWN network
// catalogue always; anyone else's only when that owner has published. Two code paths answering the same question
// differently is how the supplier view once showed nothing while the storefront showed everything.
//
// ⚠️ cb_* remains DORMANT and EMPTY, and the mutation routes stay 503 behind NETWORK_WRITE_ENABLED. This closes a
// door into an empty room — worth doing precisely because the room will not stay empty, and a read gate retrofitted
// after the data arrives is a migration rather than an edit.

const { query } = require("../../db");

/**
 * canRead(req, cbEntityId) — may this caller read that entity's network catalogue?
 *
 * Own catalogue: always. Someone else's: only when that owner has PUBLISHED, which is the same gate the storefront
 * and the supplier view use. Anything unresolvable is refused, because a read gate that fails open is not one.
 */
async function canRead(req, cbEntityId) {
  const myBridge = req.identity && req.identity.bridge_id;
  if (!myBridge || !cbEntityId) return false;
  let owner;
  try {
    const r = await query('SELECT bridge_id FROM cb_entity WHERE id = $1', [cbEntityId]);
    owner = r.rows[0] && r.rows[0].bridge_id;
  } catch (_) { return false; }        // cb_entity absent → nothing to read anyway
  if (!owner) return false;
  if (String(owner) === String(myBridge)) return true;          // my own
  try {
    const v = await query(
      "SELECT catalogue_visibility FROM identities WHERE bridge_id = $1 AND identity_type = 'entity'", [owner]);
    return (v.rows[0] && v.rows[0].catalogue_visibility) === 'public';
  } catch (_) { return false; }
}

/** A refusal that reveals nothing — identical to a catalogue that is not there. */
const deny = (res) => res.status(404).json({ error: "Not found", message: "Shop not found" });

const WRITES_ENABLED = process.env.NETWORK_WRITE_ENABLED === "true";
const gateWrite = (req, res, next) => WRITES_ENABLED ? next()
  : res.status(503).json({ error: "Network editing disabled",
      message: "Network changes aren't available yet.", code: "NET_WRITE_DISABLED" });
const h = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, code: e.code||"ERR" }); res.status(500).json({ error: safeErr(e), code: "ERR" }); } };  // C3: no err.message leak on unexpected errors
router.get ("/entities/:id/catalogue", auth, async (req, res, next) => {
  if (!(await canRead(req, req.params.id))) return deny(res); next();
}, h((req) => cat.listItems({ entityId: req.params.id, tier: req.query.tier || null })));
router.post("/entities/:id/catalogue",            auth, gateWrite, h((req) => cat.createItem({ ...req.body, entityId: req.params.id })));
router.get ("/entities/:id/catalogue/categories", auth, async (req, res, next) => {
  if (!(await canRead(req, req.params.id))) return deny(res); next();
}, h((req) => cat.listCategories(req.params.id)));
router.post("/entities/:id/catalogue/categories", auth, gateWrite, h((req) => cat.createCategory({ ...req.body, entityId: req.params.id })));
router.patch ("/catalogue/:itemId",               auth, gateWrite, h((req) => cat.updateItem(req.params.itemId, req.body)));
router.delete("/catalogue/:itemId",               auth, gateWrite, h((req) => cat.deleteItem(req.params.itemId)));
module.exports = router;
