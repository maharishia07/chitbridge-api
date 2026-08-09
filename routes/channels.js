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

// POST / — bind an address to this entity. { channel, address, label }
router.post('/', auth, async (req, res) => {
  try { res.status(201).json(await channels.addBinding(entityId(req), req.body || {})); }
  catch (err) { res.status(err.status || 500).json({ error: 'Bind failed', message: err.status && err.status < 500 ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.delete('/:id', auth, async (req, res) => {
  try { res.json(await channels.removeBinding(entityId(req), req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: 'Unbind failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

module.exports = router;
