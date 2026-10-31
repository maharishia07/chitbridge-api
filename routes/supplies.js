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
 *
 * owns: /api/supplies — what a shop buys to use (sundries): list · add · purchase · issue
 * called by: server.js (mounted at /api/supplies)
 * FLOW  POST /purchase → lib/supply-store.purchase → says (expensed — not in your books yet)
 *       every route: sign-in → schema check (lib/supplies-contract.js) → the handler → lib/supply-store.js. A refusal or a fault → problem(req, res, ...), the old { error, message }
 *       kept beside the Problem fields (docs/contracts/api-legacy.json). The shop is the caller's own (auth.entityOf); a supply is found under it, so another shop's id is an unknown one.
 * // CARD 16-finance/supplies-routes
 */
'use strict';
const express = require('express');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { contract, words, notMigrated, faultOf } = require('../lib/supplies-contract'); // the contract (each route's operation), the words of a refusal and of a fault
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity } = require('../db');
const supplies = require('../lib/supply-store');

const ctx = (req) => auth.entityOf(req);

/** the shop's own list of things it uses — never products, never priced */
router.get('/', auth, ...contract.checked('GET /'), async (req, res) => {
  try {
    const list = await supplies.list(ctx(req), withEntity, { all: req.query.all === '1' });
    /* [OFFR-04] last_cost is what the shop paid: an actor without can_see_costs does not get it — the ONE strip (lib/cost dropCostKeys; last_cost is on its list, RAIL-146) */
    if (!(await require('../lib/cost').canReadSafe(req, ctx(req)))) list.forEach(require('../lib/cost').dropCostKeys);
    res.json({ supplies: list });
  } catch (e) {
    /* ⚠️ BEFORE b217 THE TABLE DOES NOT EXIST, and a screen must not break because a migration is pending */
    if (e && e.code === '42P01') return res.json({ supplies: [], not_ready: 'supplies are not switched on yet (b217)' });
    problem(req, res, faultOf(e, req, 'Could not read the supplies'));
  }
});

/**
 * ⭐ ADD ONE BY HAND — the off-channel case. Name, unit, and whether the shop keeps stock of it.
 * ⚠️ keep_stock DEFAULTS TO FALSE. Most sundries are expensed on receipt because counting them costs more than
 * they are worth; a shop that wants a balance says so. That is materiality, and it is the shop's judgement.
 */
router.post('/', auth, ...contract.checked('POST /'), async (req, res) => {
  try {
    const b = req.body || {};
    const made = await supplies.ensure(
      ctx(req),
      {
        name: b.name,
        unit: b.unit,
        sku: b.sku,
        note: b.note,
        keep_stock: b.keep_stock === true
      },
      withEntity,
      { actor_id: req.identity && req.identity.identity_id }
    );
    if (made.error) return problem(req, res, { status: 400, ...words.refused(made.error) });
    res.json({ message: 'Supply added', supply: made });
  } catch (e) {
    if (notMigrated(e)) return problem(req, res, { status: 503, ...words.notReady() });
    problem(req, res, faultOf(e, req, 'Could not add the supply'));
  }
});

/** rename it, or change whether it is counted — a supply is a DESCRIPTION and may be edited */
router.patch('/:id', auth, ...contract.checked('PATCH /:id'), async (req, res) => {
  try {
    const row = await supplies.update(ctx(req), String(req.params.id), req.body || {}, withEntity);
    if (!row) return problem(req, res, { status: 404, ...words.notFound() });
    res.json({ message: 'Saved', supply: row });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not save the supply'));
  }
});

/** WX-P2P-04 (2026-10-13): the toast read "1 line(s) recorded · 1 counted · 0 expensed on receipt" — never "(s)", never a zero that is
   fine (SYSTEM rule 1: only a failing thing earns words); what happened, in a shopkeeper's words. OPS-72: a line already on the shelf is said, and then "0 counted" is the truth */
function purchaseSays(out) {
  const lines = out.recorded.length,
    parts = [lines + (lines === 1 ? ' line recorded' : ' lines recorded')];
  if (out.already) parts.push(out.already + ' already recorded');
  if (out.stocked || out.already) parts.push(out.stocked + ' counted');
  if (out.expensed) parts.push(out.expensed + ' expensed — not in your books yet');
  if (out.failed && out.failed.length) parts.push(out.failed.length + ' not recorded');
  return parts.join(' · ');
}

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
router.post('/purchase', auth, ...contract.checked('POST /purchase'), async (req, res) => {
  try {
    const out = await supplies.purchase(ctx(req), req.body || {}, withEntity, { actor_id: req.identity && req.identity.identity_id });
    if (out.error) return problem(req, res, { status: 400, ...words.refused(out.error) });
    if (out.conflict) return problem(req, res, { status: 409, ...words.billDiffers(out.ref, out.from) });
    res.json(Object.assign({ message: out.already && !out.stocked ? 'Purchase already recorded' : 'Purchase recorded' }, out, { says: purchaseSays(out) }));
  } catch (e) {
    if (notMigrated(e)) return problem(req, res, { status: 503, ...words.notReady() });
    problem(req, res, faultOf(e, req, 'Could not record the purchase'));
  }
});

/** ⭐ used some — the movement that turns a purchase into a spend figure somebody can read */
router.post('/:id/issue', auth, ...contract.checked('POST /:id/issue'), async (req, res) => {
  try {
    const r = await supplies.issue(ctx(req), String(req.params.id), (req.body || {}).qty, withEntity, {
      actor_id: req.identity && req.identity.identity_id,
      ref: (req.body || {}).ref
    });
    if (r.error) return problem(req, res, { status: 400, ...words.refused(r.error) });
    if (!r.ok) return problem(req, res, { status: 400, ...words.refused(r.why) });
    res.json({ message: 'Recorded as used', balance: r.balance });
  } catch (e) {
    problem(req, res, faultOf(e, req, 'Could not record it'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
