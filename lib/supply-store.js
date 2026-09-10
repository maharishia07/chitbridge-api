/**
 * ── lib/supply-store.js · WHAT A SHOP BUYS TO USE ──────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"i would purchase what I intend to sell, rest i may use it"* and *"we may have to have a
 * screen to add sundry items in case it is not coming through the channel."*
 *
 * ⭐⭐⭐ THE WHOLE POINT IS THAT NOTHING HERE CAN REACH A STOREFRONT. Supplies live in their own table (b217), so
 * a storefront query cannot accidentally include one by forgetting a WHERE clause — it would have to JOIN a table
 * it has no reason to know about. That is the difference between safe-by-construction and safe-if-everyone-
 * remembers, and the failure it prevents is floor cleaner on a customer-facing shop front.
 *
 * ⚠️ SUPPLIES ARE NOT PRODUCTS and this file gives them no way to become one. No price, no offers, no tax slab
 * for sale, no visibility. Adopting into the CATALOGUE is lib/adopt.js and it is a different act with a
 * confirmation in front of it.
 *
 * ⭐⭐ STOCKED OR EXPENSED. keep_stock=false — the default — means the purchase is recorded and costed and then
 * forgotten as a quantity: no balance, nothing to count. That is the materiality judgement every business makes,
 * and it is a per-item column because it is the shop's call and not ours. Under Ind AS 2 supplies to be consumed
 * ARE inventory, so expensing the small ones is a practical decision, not a rule.
 */
'use strict';
const stock = require('./stock-store');

/** ⚠️ one name per shop, case- and space-insensitively — two rows would split a spend figure nobody could add up */
function nameKey(name) { return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase(); }

/**
 * ⭐ A SUGGESTION, NOT A RULE. Below a de-minimis a shop almost never wants to count something, and above it they
 * usually do. It is offered as a default on the form and the shop overrules it freely — which is what materiality
 * actually is: a judgement about whether the tracking is worth more than the thing.
 */
function suggestKeepStock(o) {
  const line = o || {};
  const value = (Number(line.cost) || 0) * (Number(line.qty) || 0);
  if (value >= 5000) return { keep: true, why: 'worth counting — this one delivery is ' + Math.round(value) };
  if ((Number(line.qty) || 0) >= 100) return { keep: true, why: 'bought in quantity, so how many are left is a real question' };
  return { keep: false, why: 'small enough that counting it would cost more than it is worth' };
}

async function list(entity_id, withEntity, opts) {
  const o = opts || {};
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT s.supply_item_id, s.name, s.unit, s.sku, s.keep_stock, s.last_cost, s.last_from, s.last_at, s.note,
            s.retired_at
       FROM supply_item s
      WHERE s.entity_id = $1 AND ($2::boolean IS TRUE OR s.retired_at IS NULL)
      ORDER BY s.name`, [entity_id, o.all === true]));
  return r.rows.map((x) => ({
    supply_item_id: x.supply_item_id, name: x.name, unit: x.unit, sku: x.sku,
    keep_stock: x.keep_stock, last_cost: x.last_cost == null ? null : Number(x.last_cost),
    last_from: x.last_from, note: x.note,
    last_at: x.last_at instanceof Date ? x.last_at.toISOString() : x.last_at,
    retired: !!x.retired_at,
  }));
}

/**
 * ⭐⭐ FIND OR CREATE — the operation a repeat purchase actually needs. Buying floor cleaner for the fourth time
 * must land on the same row, or the spend figure is four rows nobody adds up.
 * ⚠️ ON CONFLICT DO NOTHING then re-select, rather than checking first: two tills recording the same purchase at
 * once would both find nothing and both insert, and the unique index is the only thing that can actually settle it.
 */
async function ensure(entity_id, item, withEntity, opts) {
  const o = opts || {};
  const name = String((item && item.name) || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'a supply needs a name' };
  const keep = item.keep_stock === true;

  await withEntity(entity_id, (db) => db.query(
    `INSERT INTO supply_item (entity_id, name, unit, sku, keep_stock, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [entity_id, name, item.unit || null, item.sku || null, keep, item.note || null, o.actor_id || null]));

  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT supply_item_id, name, unit, sku, keep_stock FROM supply_item
      WHERE entity_id = $1 AND lower(btrim(name)) = $2 AND retired_at IS NULL`,
    [entity_id, nameKey(name)]));
  const row = r.rows[0];
  if (!row) return { error: 'the supply could not be created' };
  return { supply_item_id: row.supply_item_id, name: row.name, unit: row.unit,
           keep_stock: row.keep_stock, created: !!(r.rowCount && !item.supply_item_id) };
}

/** ⚠️ a supply is a DESCRIPTION and may be edited — unlike a movement, which is a claim about an event */
async function update(entity_id, supply_item_id, patch, withEntity) {
  const p = patch || {};
  const r = await withEntity(entity_id, (db) => db.query(
    `UPDATE supply_item
        SET name       = COALESCE($3, name),
            unit       = COALESCE($4, unit),
            sku        = COALESCE($5, sku),
            keep_stock = COALESCE($6, keep_stock),
            note       = COALESCE($7, note),
            retired_at = CASE WHEN $8::boolean IS TRUE THEN now()
                              WHEN $8::boolean IS FALSE THEN NULL ELSE retired_at END,
            updated_at = now()
      WHERE entity_id = $1 AND supply_item_id = $2
      RETURNING supply_item_id, name, unit, sku, keep_stock, note, retired_at`,
    [entity_id, supply_item_id,
     p.name == null ? null : String(p.name).trim(),
     p.unit == null ? null : String(p.unit),
     p.sku == null ? null : String(p.sku),
     p.keep_stock == null ? null : !!p.keep_stock,
     p.note == null ? null : String(p.note),
     p.retired == null ? null : !!p.retired]));
  return r.rows[0] || null;
}

/**
 * ⭐⭐⭐ RECORD A PURCHASE. Every line is costed and recorded; only the ones the shop keeps stock of move a balance.
 *
 * ⚠️ NOTHING IS "IGNORED". Athi asked whether some goods need no accounting — money left the business, and there
 * may be input credit to claim, so the answer is no. What varies is whether it is COUNTED. An expensed supply
 * still updates last_cost and last_from, because "what did we pay for this last time" is the question a shopkeeper
 * asks at the counter of the hardware shop, and it is the whole reason to keep the list at all.
 */
async function purchase(entity_id, doc, withEntity, opts) {
  const o = opts || {};
  const lines = Array.isArray(doc && doc.lines) ? doc.lines : [];
  if (!lines.length) return { error: 'a purchase needs at least one line' };
  const ref = String((doc && doc.ref) || '').trim().slice(0, 64);
  if (!ref) return { error: 'a purchase needs its own reference — the bill number, or the date and the shop' };
  const from = (doc && doc.from) || null;

  const out = { ref, from, recorded: [], stocked: 0, expensed: 0, failed: [] };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || {};
    const made = await ensure(entity_id, l, withEntity, o);
    if (made.error) { out.failed.push({ line: i, why: made.error }); continue; }

    const qty = Number(l.qty) || 0;
    const cost = l.cost == null ? null : Number(l.cost);
    if (qty <= 0) { out.failed.push({ line: i, why: 'a purchase of nothing records nothing' }); continue; }

    /* what it cost and who from, on the item itself — this is what makes a repeat purchase recognisable */
    await withEntity(entity_id, (db) => db.query(
      `UPDATE supply_item SET last_cost = COALESCE($3, last_cost), last_from = COALESCE($4, last_from),
                              last_at = now(), updated_at = now()
        WHERE entity_id = $1 AND supply_item_id = $2`,
      [entity_id, made.supply_item_id, cost, from]));

    if (made.keep_stock) {
      /**
       * ⚠️ THE SAME LEDGER AS PRODUCTS, and it has to be: a shop counts both, and Ind AS 2 calls both inventory.
       * item_kind is what says which list the id points into — without it a supply and a product could share an
       * id space and nothing would be able to tell a balance apart.
       */
      const r = await stock.post(entity_id, {
        item_id: made.supply_item_id, item_kind: 'supply', reason: 'purchase',
        qty, rate: cost == null ? 0 : cost, unit: l.unit || made.unit || null,
        ref, line_ref: String(i + 1), note: made.name, at: doc.at || null,
      }, withEntity, o);
      if (!r.ok) { out.failed.push({ line: i, why: r.why }); continue; }
      out.stocked++;
    } else {
      out.expensed++;
    }
    out.recorded.push({ supply_item_id: made.supply_item_id, name: made.name, qty,
                        cost, kept: made.keep_stock });
  }
  return out;
}

/**
 * ⭐ USED SOME. The movement that turns a sundry purchase into a spend a person can read — "₹2,300 of packaging
 * used in July" — rather than a cost that vanished the day it arrived.
 * ⚠️ Only meaningful for a supply the shop keeps stock of; an expensed one was already spent on arrival, and
 * saying so is more useful than recording a movement against a balance that does not exist.
 */
async function issue(entity_id, supply_item_id, qty, withEntity, opts) {
  const o = opts || {};
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT name, keep_stock, unit FROM supply_item WHERE entity_id = $1 AND supply_item_id = $2`,
    [entity_id, supply_item_id]));
  const row = r.rows[0];
  if (!row) return { error: 'no such supply' };
  if (!row.keep_stock) return { error: 'this supply is expensed when it arrives, so there is no balance to issue from' };
  return stock.post(entity_id, {
    item_id: supply_item_id, item_kind: 'supply', reason: 'issued', qty: Number(qty) || 0,
    unit: row.unit || null, ref: (o.ref || ('use-' + Date.now())), line_ref: '1', note: row.name,
  }, withEntity, o);
}

module.exports = { nameKey, suggestKeepStock, list, ensure, update, purchase, issue };
