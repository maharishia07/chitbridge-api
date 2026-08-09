// routes/channels.js — Settings → Channels. Which inbound number / address belongs to this entity, and whether the
// provider behind it is actually configured. This is the map the capture webhooks have been waiting for (b104 →
// b123). See SPEC-capture-connector.md.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const channels = require('../lib/channels');

const entityId = (req) => req.identity.parent_entity_id || req.identity.identity_id;

// GET / — every channel, its provider state, and this entity's bindings. One read, so the panel cannot show a
// binding and a provider state that disagree with each other.
router.get('/', auth, async (req, res) => {
  try { res.json(await channels.listChannels(entityId(req))); }
  catch (err) { res.status(err.status || 500).json({ error: 'List failed', message: safeErr(err) }); }
});

// GET /outbound — the receipts: what we tried to send back, and what became of it (b126).
router.get('/outbound', auth, async (req, res) => {
  try { res.json(await channels.listOutbound(entityId(req), req.query.limit)); }
  catch (err) { res.status(err.status || 500).json({ error: 'List failed', message: safeErr(err) }); }
});

// POST /:id/provider-ref — Meta's phone_number_id for this line; a send cannot be addressed without it. { provider_ref }
router.post('/:id/provider-ref', auth, async (req, res) => {
  try { res.json(await channels.setProviderRef(entityId(req), req.params.id, (req.body || {}).provider_ref)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Update failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

// POST /:id/template — the OWNER states Meta approved a template on their number. { name, state }
// ⚠️ An entity action, not an admin one: only the owner can see Meta's approval screen, and asserting wrongly
// costs them a rejected send rather than anyone else's isolation.
/**
 * POST /:id/auto-raise { on } — hands-free raising for ONE line (b131).
 * ⚠️ The switch is not the permission: an unverified binding auto-raises nothing whatever this says.
 */
router.post('/:id/auto-raise', auth, async (req, res) => {
  try { res.json(await channels.setAutoRaise(entityId(req), req.params.id, !!(req.body || {}).on)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Auto-raise update failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.post('/:id/template', auth, async (req, res) => {
  try { const b = req.body || {}; res.json(await channels.setTemplate(entityId(req), req.params.id, b.name, b.state)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Template update failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});

// POST / — bind an address to this entity. { channel, address, label }
router.post('/', auth, async (req, res) => {
  try { res.status(201).json(await channels.addBinding(entityId(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: 'Bind failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});

/**
 * ── PLATFORM APPROVAL ──────────────────────────────────────────────────────────────────────────────────────────
 * POST /:id/approve  ·  POST /:id/revoke   — header `x-cb-admin-key` must equal CB_ADMIN_KEY.
 *
 * ⚠️ NOT `auth`. This is deliberately NOT an entity action: an entity approving its own claim is the gap, not the
 * fix. The platform operator is the one who provisions numbers into the WhatsApp Business Account, so the platform
 * is the only party that actually knows whose number it is.
 *
 * ⚠️ AND IT IS OFF UNLESS CB_ADMIN_KEY IS SET. An unset key does not mean "no check" — it means the route does not
 * work at all. A missing secret must never widen access; that is the same rule the webhooks follow.
 */
function admin(req, res, next) {
  const key = process.env.CB_ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'Admin disabled', message: 'CB_ADMIN_KEY is not set on this server.' });
  const given = req.headers['x-cb-admin-key'];
  // Constant-time-ish: compare length first, then a crypto compare, so a wrong key leaks nothing by timing.
  const ok = typeof given === 'string' && given.length === key.length &&
    require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return res.status(403).json({ error: 'Forbidden' });
  next();
}
router.post('/:id/approve', admin, async (req, res) => {
  try { res.json(await channels.approveBinding(req.params.id, (req.body || {}).via || 'platform')); }
  catch (err) { res.status(err.status || 500).json({ error: 'Approve failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});
router.post('/:id/revoke', admin, async (req, res) => {
  try { res.json(await channels.revokeBinding(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Revoke failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.delete('/:id', auth, async (req, res) => {
  try { res.json(await channels.removeBinding(entityId(req), req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Unbind failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

module.exports = router;
