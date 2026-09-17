/**
 * /api/quick-keys — Level 1 (permanent, manager-side) quick-key groups. Back-office only: a till key marks
 * items sold out and picks which groups show (routes/till.js's /quick-keys/* — Level 2); it does not author
 * groups, exactly like a till key cannot rewrite a product (handoff §1: "back-office behaviour (maintenance)").
 *
 * GET    /groups                      -> [{id,name,color,sort_order,window_from,window_to,suggest_on_start,version,items:[...]}]
 * POST   /groups                      { name, color?, sort_order?, window_from?, window_to?, suggest_on_start? }
 * PATCH  /groups/:id                  { ...fields, version }        -> 409 {code:'conflict', current} if stale
 * DELETE /groups/:id                  { version }                   -> soft delete
 * POST   /groups/:id/items            { product_id, position? }
 * DELETE /groups/:id/items/:productId
 * PATCH  /groups/:id/items            { items: [{product_id, position}] }   -> rewrite the group's whole order
 * GET    /screen-config/default       -> the shop-wide default a new counter starts from
 * PUT    /screen-config/default       { config }
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const qk = require('../lib/quick-keys');

const sessionOnly = (req, res, next) => {
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Quick-key groups are managed by a signed-in person, not by a key.' });
  next();
};

const userOf = (req) => req.identity.identity_id;

router.get('/groups', auth, sessionOnly, async (req, res) => {
  try {
    const groups = await withEntity(auth.entityOf(req), (db) => qk.listGroups(db, auth.entityOf(req)));
    res.json({ groups });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.post('/groups', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const group = await withEntity(entity_id, (db) => qk.createGroup(db, entity_id, req.body, userOf(req)));
    res.status(201).json({ group });
  } catch (e) {
    if (e.code === 'validation') return res.status(400).json({ error: 'validation', message: e.message });
    res.status(500).json({ error: 'Failed', message: String(e && e.message) });
  }
});

router.patch('/groups/:id', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { version, ...patch } = req.body || {};
    const group = await withEntity(entity_id, (db) => qk.updateGroup(db, entity_id, req.params.id, patch, version, userOf(req)));
    res.json({ group });
  } catch (e) {
    if (e.code === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (e.code === 'conflict') return res.status(409).json({ error: 'conflict', message: e.message, current: e.current });
    res.status(500).json({ error: 'Failed', message: String(e && e.message) });
  }
});

router.delete('/groups/:id', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const version = req.body && req.body.version;
    const group = await withEntity(entity_id, (db) => qk.deleteGroup(db, entity_id, req.params.id, version, userOf(req)));
    res.json({ group });
  } catch (e) {
    if (e.code === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (e.code === 'conflict') return res.status(409).json({ error: 'conflict', message: e.message, current: e.current });
    res.status(500).json({ error: 'Failed', message: String(e && e.message) });
  }
});

router.post('/groups/:id/items', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { product_id, position } = req.body || {};
    if (!product_id) return res.status(400).json({ error: 'validation', message: 'product_id required' });
    const item = await withEntity(entity_id, (db) => qk.addItem(db, entity_id, req.params.id, product_id, position, userOf(req)));
    res.status(201).json({ item });
  } catch (e) {
    if (e.code === 'not_found') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Failed', message: String(e && e.message) });
  }
});

router.delete('/groups/:id/items/:productId', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => qk.removeItem(db, entity_id, req.params.id, req.params.productId, userOf(req)));
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.patch('/groups/:id/items', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) => qk.reorderItems(db, entity_id, req.params.id, (req.body || {}).items, userOf(req)));
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.get('/screen-config/default', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const cfg = await withEntity(entity_id, (db) => qk.getScreenConfig(db, entity_id, null));
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.put('/screen-config/default', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const cfg = await withEntity(entity_id, (db) => qk.setScreenConfig(db, entity_id, null, (req.body || {}).config, userOf(req)));
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

module.exports = router;
