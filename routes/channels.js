/*
 * OWNS      Settings › Channels: bindings, templates and the platform approval.
 * CALLED BY web Settings › Channels.
 * FLOW      bind → platform approve (admin key) → verified line
 *           session routes: auth → checked(route) → handler → res.json | problem(req, res, faultOf(err, req, label, relay)); platform doors: admin gate → checked(route) → handler
 *           the words and the contract (each route's operation, the relay mode of each catch) are lib/channels-contract.js
 * CARD      11-crm-and-marketing/channels
 */
// routes/channels.js — Settings → Channels. Which inbound number / address belongs to this entity, and whether the
// provider behind it is actually configured. This is the map the capture webhooks have been waiting for (b104 →
// b123). See SPEC-capture-connector.md.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { faultOf, adminOff, adminWrongKey, checked } = require('../lib/channels-contract'); // API-4: the contract (each route's operation) and the words of a refusal
const channels = require('../lib/channels');

const entityId = (req) => auth.entityOf(req);

// GET / — every channel, its provider state, and this entity's bindings. One read, so the panel cannot show a
// binding and a provider state that disagree with each other.
// @does Nothing in -> we read your channels, whether each provider is set up and your bound numbers in one go -> the list for the Channels panel.
router.get('/', auth, ...checked('GET /'), async (req, res) => {
  try {
    res.json(await channels.listChannels(entityId(req)));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'List failed', 'none'));
  }
});

// GET /outbound — the receipts: what we tried to send back, and what became of it (b126). ?purpose=marketing → Offers sent; ?page= ?limit= (total · page · limit).
// @does Optional purpose and page in -> we read the messages we tried to send for you and what became of each -> a page of sent-message receipts.
router.get('/outbound', auth, ...checked('GET /outbound'), async (req, res) => {
  try {
    res.json(await channels.listOutbound(entityId(req), req.query));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'List failed', 'none'));
  }
});

// POST /:id/provider-ref — Meta's phone_number_id for this line; a send cannot be addressed without it. { provider_ref }
// @does The provider's line id for one of your channels -> we save it so sends can be addressed -> the updated channel.
router.post('/:id/provider-ref', auth, ...checked('POST /:id/provider-ref'), async (req, res) => {
  try {
    res.json(await channels.setProviderRef(entityId(req), req.params.id, (req.body || {}).provider_ref));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Update failed', 'any'));
  }
});

// POST /:id/template — the OWNER states Meta approved a template on their number. { name, state }
// ⚠️ An entity action, not an admin one: only the owner can see Meta's approval screen, and asserting wrongly
// costs them a rejected send rather than anyone else's isolation.
/**
 * POST /:id/auto-raise { on } — hands-free raising for ONE line (b131).
 * ⚠️ The switch is not the permission: an unverified binding auto-raises nothing whatever this says.
 */
// @does On or off for one of your channels -> we switch hands-free raising of chits for that line (a line not yet verified still raises nothing) -> the updated channel.
router.post('/:id/auto-raise', auth, ...checked('POST /:id/auto-raise'), async (req, res) => {
  try {
    res.json(await channels.setAutoRaise(entityId(req), req.params.id, !!(req.body || {}).on));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Auto-raise update failed', 'any'));
  }
});

// @does A template name and state you were shown on Meta's approval screen -> we record it against your channel -> the updated channel.
router.post('/:id/template', auth, ...checked('POST /:id/template'), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await channels.setTemplate(entityId(req), req.params.id, b.name, b.state));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Template update failed', 'below500'));
  }
});

// POST / — bind an address to this entity. { channel, address, label }
// @does A channel, an address and a label -> we bind that address to your shop, waiting for platform approval -> the new binding.
router.post('/', auth, ...checked('POST /'), async (req, res) => {
  try {
    res.status(201).json(await channels.addBinding(entityId(req), req.body || {}));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Bind failed', 'below500'));
  }
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
  if (!key) return problem(req, res, { status: 503, ...adminOff() });
  const given = req.headers['x-cb-admin-key'];
  // Constant-time-ish: compare length first, then a crypto compare, so a wrong key leaks nothing by timing.
  const ok = typeof given === 'string' && given.length === key.length && require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return problem(req, res, { status: 403, ...adminWrongKey() });
  next();
}
// @does A channel id and the platform key -> we mark that number as verified for its shop -> the verified channel (platform operators only).
router.post('/:id/approve', admin, ...checked('POST /:id/approve'), async (req, res) => {
  try {
    res.json(await channels.approveBinding(req.params.id, (req.body || {}).via || 'platform'));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Approve failed', 'any'));
  }
});
// POST /:id/template-approve { entity_id, name } — the platform records Meta's approval (SEC-FIX3 S7: a shop cannot say it for itself)
// @does A channel id, the shop and the template name and the platform key -> we record Meta's approval of that template -> the updated channel (platform operators only).
router.post('/:id/template-approve', admin, ...checked('POST /:id/template-approve'), async (req, res) => {
  try {
    const given = req.body || {};
    res.json(await channels.setTemplate(given.entity_id, req.params.id, given.name, 'approved', true));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Template update failed', 'below500'));
  }
});
// @does A channel id and the platform key -> we withdraw the verification of that number -> the unverified channel (platform operators only).
router.post('/:id/revoke', admin, ...checked('POST /:id/revoke'), async (req, res) => {
  try {
    res.json(await channels.revokeBinding(req.params.id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Revoke failed', 'any'));
  }
});

// @does A channel id of yours -> we remove that binding -> a confirmation that it is gone.
router.delete('/:id', auth, ...checked('DELETE /:id'), async (req, res) => {
  try {
    res.json(await channels.removeBinding(entityId(req), req.params.id));
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Unbind failed', 'any'));
  }
});

router.openapi = { paths: require('../lib/channels-contract').contract.pathsOf(), schemas: {} };

module.exports = router;
