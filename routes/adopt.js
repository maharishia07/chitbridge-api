/**
 * ── routes/adopt.js · TAKING A SUPPLIER'S DELIVERY INTO YOUR OWN CATALOGUE ─────────────────────────────────────
 *
 * Athi, 2026-09-10: *"create the product and SKU etc according to your own way of doing and then accept the
 * product, but we can offer that facility so he doesn't need to create all by himself. So offer is the right way
 * of doing, but should not be so easy — just a button should not accept the product, it has to ask for
 * confirmation. If it is not his own vertical, refuse and say if you want to override then please say so."*
 *
 * TWO ROUTES, AND THE SPLIT IS THE DESIGN:
 *
 *   GET  /api/adopt/:chit_id   what this delivery OFFERS. Reads nothing into anything. Safe to call twice.
 *   POST /api/adopt/:chit_id   accept named lines, with the shop's OWN name, SKU and price for each.
 *
 * ⭐⭐⭐ THE POST CANNOT BE A ONE-TAP ACCEPT, and that is enforced rather than requested: it takes an explicit list
 * of lines, and each one must carry the shop's own `name` and `sku`. There is no "accept everything" parameter.
 * A caller that wanted to skip the confirmation would have to compose the confirmation's own output by hand,
 * which is exactly the friction Athi asked for.
 *
 * ⚠️ THE RULES LIVE IN lib/adopt.js, NOT HERE. This route reads a chit, asks the engine, and mints what the engine
 * allowed. It re-checks on POST rather than trusting what the GET said, because the two calls are minutes apart
 * and a shop's sector or a supplier's kind can change between them.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withEntity } = require('../db');
const adopt = require('../lib/adopt');
const { mintProduct } = require('../lib/mint-product');

const ctx = (req) => auth.entityOf(req);
const fail = (res, e, what) => res.status(500).json({ error: what, message: String(e && e.message) });

/**
 * ⚠️ THE SENDER'S TRADE TRAVELS WITH THE GOODS, and where it is not on the chit it is looked up. A batch number is
 * a fact about the medicine, not about who is holding it — so the RECEIVER'S sector cannot make an expiry
 * optional, and the requirement has to come from the party that sent it.
 */
async function senderOf(chit) {
  const bj = chit.business_json || {};
  if (bj.source && bj.source.sectors) return { name: bj.source.name || bj.party && bj.party.name, sectors: bj.source.sectors };
  const from = chit.sender_entity_id;
  const out = { name: (bj.party && bj.party.name) || chit.sender_name || null, sectors: [] };
  if (!from) return out;
  try {
    const p = await query(`SELECT sectors, profile_json FROM entity_profile WHERE entity_id = $1`, [from]);
    const row = p.rows[0] || {};
    out.sectors = row.sectors || (row.profile_json && row.profile_json.sectors) || [];
  } catch (_) { /* a profile we cannot read is a trade we cannot judge — see the engine's undeclared case */ }
  return out;
}

/** what the receiving shop is, and what it already stocks — the two things the engine needs about "me" */
async function receiverOf(entity_id) {
  let sectors = [];
  try {
    const p = await query(`SELECT sectors, profile_json FROM entity_profile WHERE entity_id = $1`, [entity_id]);
    const row = p.rows[0] || {};
    sectors = row.sectors || (row.profile_json && row.profile_json.sectors) || [];
  } catch (_) {}
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT lower(btrim(item_data->>'name')) AS n FROM catalogue_items WHERE entity_id = $1`, [entity_id]));
  const have = new Set(r.rows.map((x) => x.n).filter(Boolean));
  return { sectors, has_item: (n) => have.has(String(n || '').trim().toLowerCase()) };
}

/** the delivery itself, from THIS shop's own copy — never the sender's */
async function deliveryOf(entity_id, chit_id) {
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT h.chit_id, h.purpose, h.business_json, h.created_at, h.sender_entity_id, d.line_items
       FROM chit_header h
       LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
      WHERE h.entity_id = $1 AND h.chit_id = $2`, [entity_id, chit_id]));
  return r.rows[0] || null;
}

/** ⚠️ the supplier's own designation (b216) — resale or own_use, answered once for the relationship */
async function supplierKind(entity_id, supplier_entity_id) {
  if (!supplier_entity_id) return null;
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT supply_kind, nickname FROM supplier_list
        WHERE owner_entity_id = $1 AND supplier_entity_id = $2`, [entity_id, supplier_entity_id]));
    return r.rows[0] ? { supply_kind: r.rows[0].supply_kind, nickname: r.rows[0].nickname } : null;
  } catch (_) { return null; }
}

/** ⭐ WHAT THIS DELIVERY OFFERS — reads only. Grouped the way a person reads it, never as forty rows. */
router.get('/:chit_id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const chit = await deliveryOf(entity_id, String(req.params.chit_id));
    if (!chit) return res.status(404).json({ error: 'Not found' });

    const from = await senderOf(chit);
    const kind = await supplierKind(entity_id, chit.sender_entity_id);
    if (kind) { from.supply_kind = kind.supply_kind; from.name = kind.nickname || from.name; }
    const me = await receiverOf(entity_id);

    const out = adopt.considerAll(chit.line_items || [], from, me, {});
    res.json({
      chit_id: chit.chit_id, from: { name: from.name, vertical: adopt.verticalOf(from.sectors),
                                     supply_kind: from.supply_kind || null },
      says: out.says, rows: out.rows,
      /* ⚠️ counts, so a screen can lead with what needs a person rather than with a list */
      counts: { offer: out.offer.length, refused: out.refused.length,
                already: out.already.length, not_for_sale: out.not_for_sale.length },
    });
  } catch (e) { fail(res, e, 'Could not read the delivery'); }
});

/**
 * ⭐⭐⭐ ACCEPT — and only what was named, with the shop's own words for it.
 *   { accept: [ { line, name, sku, price, unit, override, keep_stock } ] }
 *
 * ⚠️ EVERY LINE IS RE-CONSIDERED. What the GET offered is not a token: the shop's sector, the supplier's kind or
 * the catalogue can all have changed since, and a POST that trusted a minutes-old answer would be a way to adopt
 * something the rules now refuse.
 *
 * ⚠️ `name` IS REQUIRED even though the seed suggested one. Athi: the receiver creates the product "according to
 * your own way of doing" — so the shop has to have looked at it. Accepting a supplier's wording by default is how
 * a catalogue slowly becomes somebody else's.
 */
router.post('/:chit_id', auth, async (req, res) => {
  try {
    const entity_id = ctx(req);
    const wanted = Array.isArray((req.body || {}).accept) ? req.body.accept : [];
    if (!wanted.length) return res.status(400).json({ error: 'validation',
      message: 'name the lines to accept — there is no "accept everything"' });

    const chit = await deliveryOf(entity_id, String(req.params.chit_id));
    if (!chit) return res.status(404).json({ error: 'Not found' });
    const lines = chit.line_items || [];
    const from = await senderOf(chit);
    const kind = await supplierKind(entity_id, chit.sender_entity_id);
    if (kind) { from.supply_kind = kind.supply_kind; from.name = kind.nickname || from.name; }
    const me = await receiverOf(entity_id);

    const made = [], refused = [];
    for (const w of wanted) {
      const i = Number(w.line);
      const line = lines[i];
      if (!line) { refused.push({ line: i, why: 'no such line on this delivery' }); continue; }

      /* ⚠️ RE-CHECKED HERE, against the rules as they are NOW */
      const say = adopt.consider(line, from, me, { purpose: w.purpose, override: w.override === true });
      if (say.may !== 'offer') { refused.push({ line: i, why: say.why || say.may, refused: say.refused }); continue; }

      const name = String(w.name || '').trim();
      if (!name) { refused.push({ line: i, why: 'this needs your own name for it before it can be added' }); continue; }
      if (!String(w.sku || '').trim()) {
        refused.push({ line: i, why: 'this needs your own SKU — the supplier\'s is never adopted' }); continue; }

      /**
       * ⭐ THE SHOP'S PRODUCT, seeded from theirs. The attributes the vertical requires travel; the COST travels
       * as a cost; the selling price is whatever the shop said and nothing else.
       * ⚠️ batch_tracked rides along so a pharma product arrives already keeping stock per batch (b215) rather
       * than needing somebody to remember afterwards.
       */
      const item_data = Object.assign({}, say.seed.attributes, {
        name, sku: String(w.sku).trim(),
        unit: w.unit || say.seed.unit || null,
        price: w.price == null ? null : Number(w.price),
        cost: say.seed.cost,
        batch_tracked: w.batch_tracked == null ? say.seed.batch_tracked : !!w.batch_tracked,
        adopted_from: say.seed.from,
        adopted_at: new Date().toISOString(),
        /* ⚠️ AN OVERRIDE LEAVES A TRACE ON THE PRODUCT ITSELF, not only in a log. Somebody looking at a pharma
           line in a grocery's catalogue in a year should be able to see that a person decided that. */
        adopted_override: say.overridden ? say.vertical : undefined,
      });
      Object.keys(item_data).forEach((k) => item_data[k] === undefined && delete item_data[k]);

      const r = await mintProduct({ query, withEntity, entity_id, schema_id: req.body.schema_id,
        item_data, rid: req.id, note: 'adopted from a delivery' });
      if (r.error) { refused.push({ line: i, why: r.error }); continue; }
      made.push({ line: i, item_id: r.item.item_id, name, missing: say.missing });
    }

    res.json({ message: made.length + ' added to your catalogue', added: made, refused,
      says: made.length + ' added' + (refused.length ? ' · ' + refused.length + ' not' : '') });
  } catch (e) { fail(res, e, 'Could not adopt'); }
});

router.openapi = { paths: {
  '/api/adopt/{chit_id}': {
    get:  { summary: 'What a delivery offers to this catalogue, and what it refuses', tags: ['adopt'] },
    post: { summary: 'Accept named lines as your OWN products', tags: ['adopt'] },
  } }, schemas: {} };

module.exports = router;
