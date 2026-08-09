// routes/kyb.js — the "Know your business" value panel. Sections 1-3 are computed from owned data → FREE (SELECTs over
// the entity's own rows). Section 4 (field) is metered per search + 24h-cached. Entity-scoped; identity from the token.
// Makes NO governance claim. See CB-CLI-DIRECTIVE-know-your-business-panel + lib/kyb.js.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const kyb = require('../lib/kyb');
const entityId = (req) => auth.entityOf(req);

// Section 1 — Yourself (free)
router.get('/yourself', auth, async (req, res) => {
  try { res.json(await kyb.yourself(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'Yourself failed', message: safeErr(err) }); }
});
// open registry — add a credential CB doesn't know (village NOC etc.) → declared, rises to documented with an owned chit
router.post('/credential', auth, async (req, res) => {
  try { res.json(await kyb.addCredential(entityId(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: 'Add credential failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});
// Section 2 — Position (free) — where you can sell, directionally
router.get('/position', auth, async (req, res) => {
  try { res.json(await kyb.position(entityId(req), { vertical: req.query.vertical, origin: req.query.origin })); }
  catch (err) { res.status(err.status || 500).json({ error: 'Position failed', message: safeErr(err) }); }
});
// Section 3 — Risk (free)
router.get('/risk', auth, async (req, res) => {
  try { res.json(await kyb.risk(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'Risk failed', message: safeErr(err) }); }
});
// Section 4 — Field / direction (metered per search, 24h cache; walled-off, declared-only, source+as-of enforced)
router.post('/field', auth, async (req, res) => {
  try { res.json(await kyb.field(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'Field failed', message: safeErr(err) }); }
});

module.exports = router;
