/**
 * ── routes/supplies.js · WHAT A SHOP BUYS TO USE ───────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"we may have to have a screen to add sundry items in case if it is not coming through the
 * channel."* — and that is the COMMON case, not the exception. Most sundry buying is a cash purchase from the
 * hardware shop on the corner, with a paper bill and no CB relationship at all. A feature reachable only through
 * a supplier's delivery would cover the minority.
 *
 * ⭐⭐ NOTHING HERE CAN REACH A STOREFRONT. Supplies are their own table (b217), so it is not a filter anybody has
 * to remember — a storefront query would have to JOIN a table it has no reason to know about.
 *
 * ⚠️ AND NOTHING HERE HAS A SELLING PRICE. There is no field for one, deliberately. A supply that could be priced
 * would eventually be sold, and the whole point of the split is that it cannot.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const supplies = require('../lib/supply-store');

const ctx = (req) => auth.entityOf(req);
const fail = (res, e, what) => res.status(500).json({ error: what, message: String(e && e.message) });

/** the shop's own list of things it uses — never products, never priced */
router.get('/', auth, async (req, res) => {
  try {
    res.json({ supplies: await supplies.list(ctx(req), withEntity, { all: req.query.all === '1' }) });
  } catch (e) {
    /* ⚠️ BEFORE b217 THE TABLE DOES NOT EXIST, and a screen must not break because a migration is pending */
    if (e && e.code === '42P01') return res.json({ supplies: [], not_ready: 'supplies are not switched on yet (b217)' });
    fail(res, e, 'Could not read the supplies');
  }
});

/**
 * ⭐ ADD ONE BY HAND — the off-channel case. Name, unit, and whether the shop keeps stock of it.
 * ⚠️ keep_stock DEFAULTS TO FALSE. Most sundries are expensed on receipt because counting them costs more than
 * they are worth; a shop that wants a balance says so. That is materiality, and it is the shop's judgement.
 */
router.post('/', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const made = await supplies.ensure(ctx(req), {
      name: b.name, unit: b.unit, sku: b.sku, note: b.note, keep_stock: b.keep_stock === true,
    }, withEntity, { actor_id: req.identity && req.identity.identity_id });
    if (made.error) return res.status(400).json({ error: 'validation', message: made.error });
    res.json({ message: 'Supply added', supply: made });
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Not ready', message: 'run b217 first' });
    fail(res, e, 'Could not add the supply');
  }
});

/** rename it, or change whether it is counted — a supply is a DESCRIPTION and may be edited */
router.patch('/:id', auth, async (req, res) => {
  try {
    const row = await supplies.update(ctx(req), String(req.params.id), req.body || {}, withEntity);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Saved', supply: row });
  } catch (e) { fail(res, e, 'Could not save the supply'); }
});

/**
 * ⭐⭐⭐ RECORD A PURCHASE that never came through a channel.
 *   { ref, from, at, lines: [{ name | supply_item_id, qty, unit, cost, keep_stock }] }
 *
 * ⚠️ `from` IS FREE TEXT. The hardware shop on the corner is not an entity and never will be, and requiring one
 * would make this route useless for the case it exists to serve.
 *
 * ⚠️ EVERY LINE IS RECORDED AND COSTED. Only the ones the shop keeps stock of move a balance — the rest are
 * expensed on receipt. Nothing is ignored: money left the business, and there may be input credit to claim.
 */
router.post('/purchase', auth, async (req, res) => {
  try {
    const out = await supplies.purchase(ctx(req), req.body || {}, withEntity,
      { actor_id: req.identity && req.identity.identity_id });
    if (out.error) return res.status(400).json({ error: 'validation', message: out.error });
    res.json(Object.assign({ message: 'Purchase recorded' }, out,
      { says: out.recorded.length + ' line(s) recorded · ' + out.stocked + ' counted · '
            + out.expensed + ' expensed on receipt' }));
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Not ready', message: 'run b217 first' });
    fail(res, e, 'Could not record the purchase');
  }
});

/** ⭐ used some — the movement that turns a purchase into a spend figure somebody can read */
router.post('/:id/issue', auth, async (req, res) => {
  try {
    const r = await supplies.issue(ctx(req), String(req.params.id), (req.body || {}).qty, withEntity,
      { actor_id: req.identity && req.identity.identity_id, ref: (req.body || {}).ref });
    if (r.error) return res.status(400).json({ error: 'validation', message: r.error });
    if (!r.ok) return res.status(400).json({ error: 'validation', message: r.why });
    res.json({ message: 'Recorded as used', balance: r.balance });
  } catch (e) { fail(res, e, 'Could not record it'); }
});

router.openapi = { paths: {
  '/api/supplies': { get: { summary: 'What this shop buys to use — never products, never priced', tags: ['supplies'] } },
  '/api/supplies/purchase': { post: { summary: 'Record a sundry purchase that came from outside ChitBridge', tags: ['supplies'] } },
} , schemas: {} };

module.exports = router;
