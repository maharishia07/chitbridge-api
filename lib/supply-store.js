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
 *
 * owns: supply_item and the purchase of supplies (cost and stock only; books_posted is false — R9)
 * called by: routes/supplies.js
 * FLOW  purchase → ensureMany → last_cost stamp → stock.post (kept) | expensed++ (not in the books)
 * // CARD 16-finance/supply-store
 */
'use strict';
const stock = require('./stock-store');

/** ⚠️ one name per shop, case- and space-insensitively — two rows would split a spend figure nobody could add up */
function nameKey(name) {
  return String(name == null ? '' : name)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

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
  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT s.supply_item_id, s.name, s.unit, s.sku, s.keep_stock, s.last_cost, s.last_from, s.last_at, s.note,
            s.retired_at
       FROM supply_item s
      WHERE s.entity_id = $1 AND ($2::boolean IS TRUE OR s.retired_at IS NULL)
      ORDER BY s.name`,
      [entity_id, o.all === true]
    )
  );
  return r.rows.map((x) => ({
    supply_item_id: x.supply_item_id,
    name: x.name,
    unit: x.unit,
    sku: x.sku,
    keep_stock: x.keep_stock,
    last_cost: x.last_cost == null ? null : Number(x.last_cost),
    last_from: x.last_from,
    note: x.note,
    last_at: x.last_at instanceof Date ? x.last_at.toISOString() : x.last_at,
    retired: !!x.retired_at
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
  const name = String((item && item.name) || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return { error: 'a supply needs a name' };
  const keep = item.keep_stock === true;

  await withEntity(entity_id, (db) =>
    db.query(
      `INSERT INTO supply_item (entity_id, name, unit, sku, keep_stock, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [entity_id, name, item.unit || null, item.sku || null, keep, item.note || null, o.actor_id || null]
    )
  );

  const r = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT supply_item_id, name, unit, sku, keep_stock FROM supply_item
      WHERE entity_id = $1 AND lower(btrim(name)) = $2 AND retired_at IS NULL`,
      [entity_id, nameKey(name)]
    )
  );
  const row = r.rows[0];
  if (!row) return { error: 'the supply could not be created' };
  return { supply_item_id: row.supply_item_id, name: row.name, unit: row.unit, keep_stock: row.keep_stock, created: !!(r.rowCount && !item.supply_item_id) };
}

/**
 * ⭐ ensureMany(entity_id, items, withEntity, opts) → one result per item, IN ORDER — the same answer ensure() gives
 * for each, in TWO statements for the whole set instead of two per line (2026-09-28, tests/query-shape "known debt").
 * A twenty-line purchase was forty round trips before a single stock line moved.
 * ⚠️ Same rules as ensure(): names fold with nameKey (the unique index is lower(btrim(name))), an existing supply is
 * reused, a new one is created with that line's unit/sku/keep_stock. Two lines naming one supply share one row.
 */
async function ensureMany(entity_id, items, withEntity, opts) {
  const o = opts || {};
  const entries = Array.isArray(items) ? items : [];
  const out = entries.map((item) => {
    const name = String((item && item.name) || '')
      .trim()
      .replace(/\s+/g, ' ');
    return name ? { name, key: nameKey(name), item } : { error: 'a supply needs a name' };
  });
  const firstByKey = new Map();
  out.forEach((x) => {
    if (!x.error && !firstByKey.has(x.key)) firstByKey.set(x.key, x);
  });
  const fresh = [...firstByKey.values()];
  if (!fresh.length) return out.map((x) => ({ error: x.error }));
  const rows = await withEntity(entity_id, async (db) => {
    await db.query(
      `INSERT INTO supply_item (entity_id, name, unit, sku, keep_stock, note, created_by)
       SELECT $1, u.name, u.unit, u.sku, u.keep, u.note, $7
         FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[]) AS u(name, unit, sku, keep, note)
       ON CONFLICT DO NOTHING`,
      [
        entity_id,
        fresh.map((x) => x.name),
        fresh.map((x) => x.item.unit || null),
        fresh.map((x) => x.item.sku || null),
        fresh.map((x) => x.item.keep_stock === true),
        fresh.map((x) => x.item.note || null),
        o.actor_id || null
      ]
    );
    const r = await db.query(
      `SELECT supply_item_id, name, unit, sku, keep_stock, lower(btrim(name)) AS k FROM supply_item
        WHERE entity_id = $1 AND lower(btrim(name)) = ANY($2::text[]) AND retired_at IS NULL`,
      [entity_id, fresh.map((x) => x.key)]
    );
    return r.rows;
  });
  const byKey = new Map(rows.map((item) => [item.k, item]));
  return out.map((x) => {
    if (x.error) return { error: x.error };
    const row = byKey.get(x.key);
    if (!row) return { error: 'the supply could not be created' };
    return { supply_item_id: row.supply_item_id, name: row.name, unit: row.unit, keep_stock: row.keep_stock };
  });
}

/** ⚠️ a supply is a DESCRIPTION and may be edited — unlike a movement, which is a claim about an event */
async function update(entity_id, supply_item_id, patch, withEntity) {
  const p = patch || {};
  const r = await withEntity(entity_id, (db) =>
    db.query(
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
      [
        entity_id,
        supply_item_id,
        p.name == null ? null : String(p.name).trim(),
        p.unit == null ? null : String(p.unit),
        p.sku == null ? null : String(p.sku),
        p.keep_stock == null ? null : !!p.keep_stock,
        p.note == null ? null : String(p.note),
        p.retired == null ? null : !!p.retired
      ]
    )
  );
  return r.rows[0] || null;
}

/**
 * ⭐ OPS-72 — A BILL NUMBER IS THE SUPPLIER'S, NOT THE SHOP'S. The stock ledger keeps a document once per (ref, line); two suppliers who both
 * number a bill 1 are two bills, so the ref the ledger sees carries who it is from. No supplier named: the ref stands alone, as before.
 */
function stockRefOf(ref, from) {
  const supplier = nameKey(from).slice(0, 40);
  return supplier ? ref + ' · ' + supplier : ref;
}

/** the lines of this bill that the shop counts, by the line_ref the ledger keys them on */
function keptLines(lines, madeAll) {
  const kept = new Map();
  lines.forEach((line, index) => {
    const made = madeAll[index];
    if (made && !made.error && made.keep_stock && (Number((line || {}).qty) || 0) > 0) kept.set(String(index + 1), { item_id: made.supply_item_id, qty: Number(line.qty) });
  });
  return kept;
}

/** the ledger's lines for a bill against the lines sent: another item or amount where one sat, or a line the ledger has and this one lacks */
function differsFrom(held, kept) {
  return held.some((move) => {
    const sent = kept.get(String(move.line_ref));
    return !sent || sent.item_id !== move.item_id || sent.qty !== move.qty;
  });
}

/**
 * ⭐ OPS-72 — WHERE DOES THIS BILL STAND? → { differs, legacy }. The supplier-scoped ref is read first. A bill recorded BEFORE the scoping
 * sits under the bare number, so when the scoped ref holds nothing the bare one is read too: the same lines there are the same bill again
 * (legacy: said, never counted twice), other lines refuse. ⚠️ A different supplier's old bill with the same number and lines reads as
 * already recorded — the safe direction (refuse over double count).
 */
async function billStanding(entity_id, bill, kept, withEntity) {
  const held = await stock.movesOfRef(entity_id, bill.stockRef, 'purchase', withEntity);
  if (held.length || bill.stockRef === bill.ref) return { differs: differsFrom(held, kept), legacy: false };
  const old = await stock.movesOfRef(entity_id, bill.ref, 'purchase', withEntity);
  const exact = old.length === kept.size && !differsFrom(old, kept);
  return { differs: old.length > 0 && !exact, legacy: exact };
}

/** what it cost and who from, on the supply itself — one statement for every line; this is what makes a repeat purchase recognisable */
async function stampLastCost(entity_id, lines, madeAll, from, withEntity) {
  const stamp = new Map(); /* supply_item_id → its LAST line's cost, as the loop left it */
  lines.forEach((item, index) => {
    const m = madeAll[index];
    if (!m || m.error || !((Number((item || {}).qty) || 0) > 0)) return;
    stamp.set(m.supply_item_id, (item || {}).cost == null ? null : Number(item.cost));
  });
  if (stamp.size) {
    await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE supply_item s SET last_cost = COALESCE(u.cost, s.last_cost), last_from = COALESCE($3, s.last_from),
                                last_at = now(), updated_at = now()
         FROM unnest($2::uuid[], $4::numeric[]) AS u(id, cost)
        WHERE s.entity_id = $1 AND s.supply_item_id = u.id`,
        [entity_id, [...stamp.keys()], from, [...stamp.values()]]
      )
    );
  }
}

/** ⭐ ONE KEPT LINE onto the shelf: the same post() as products, keyed on the supplier-scoped ref and the line's place on the bill */
function countLine(entity_id, bill, withEntity, opts) {
  const { made, line, amount, cost, stockRef, index, at } = bill;
  return stock.post(
    entity_id,
    {
      item_id: made.supply_item_id,
      item_kind: 'supply',
      reason: 'purchase',
      qty: amount,
      rate: cost == null ? 0 : cost,
      unit: line.unit || made.unit || null,
      ref: stockRef,
      line_ref: String(index + 1),
      note: made.name,
      at: at || null
    },
    withEntity,
    opts
  );
}

/**
 * ⭐⭐⭐ RECORD A PURCHASE. Every line is costed and recorded; only the ones the shop keeps stock of move a balance.
 *
 * ⚠️ NOTHING IS "IGNORED". Athi asked whether some goods need no accounting — money left the business, and there
 * may be input credit to claim, so the answer is no. What varies is whether it is COUNTED. An expensed supply
 * still updates last_cost and last_from, because "what did we pay for this last time" is the question a shopkeeper
 * asks at the counter of the hardware shop, and it is the whole reason to keep the list at all.
 */
/* books_posted: false on the answer — this store keeps cost and stock only; no expense, payable or input tax is posted (R9: say so, never imply it) */
async function purchase(entity_id, doc, withEntity, opts) {
  const o = opts || {};
  const lines = Array.isArray(doc && doc.lines) ? doc.lines : [];
  if (!lines.length) return { error: 'a purchase needs at least one line' };
  const ref = String((doc && doc.ref) || '')
    .trim()
    .slice(0, 64);
  if (!ref) return { error: 'a purchase needs its own reference — the bill number, or the date and the shop' };
  const from = (doc && doc.from) || null;

  const out = { ref, from, recorded: [], stocked: 0, already: 0, expensed: 0, books_posted: false, failed: [] };
  /* ⭐ every line's supply in two statements, and every "last cost / who from" in one (2026-09-28) — the stock
     postings below stay one per line on purpose: the weighted-average ledger is ORDER-dependent */
  const madeAll = await ensureMany(
    entity_id,
    lines.map((item) => item || {}),
    withEntity,
    o
  );
  const stockRef = stockRefOf(ref, from);
  const kept = keptLines(lines, madeAll);
  const standing = kept.size ? await billStanding(entity_id, { ref, stockRef }, kept, withEntity) : { differs: false, legacy: false };
  if (standing.differs) return { conflict: 'bill-differs', ref, from };
  await stampLastCost(entity_id, lines, madeAll, from, withEntity);
  for (let index = 0; index < lines.length; index++) {
    const l = lines[index] || {};
    const made = madeAll[index];
    if (made.error) {
      out.failed.push({ line: index, why: made.error });
      continue;
    }

    const qty = Number(l.qty) || 0;
    const cost = l.cost == null ? null : Number(l.cost);
    if (qty <= 0) {
      out.failed.push({ line: index, why: 'a purchase of nothing records nothing' });
      continue;
    }

    if (made.keep_stock) {
      /**
       * ⚠️ THE SAME LEDGER AS PRODUCTS, and it has to be: a shop counts both, and Ind AS 2 calls both inventory.
       * item_kind is what says which list the id points into — without it a supply and a product could share an
       * id space and nothing would be able to tell a balance apart.
       */
      const r = standing.legacy ? { ok: true, duplicate: true } : await countLine(entity_id, { made, line: l, amount: qty, cost, stockRef, index, at: doc.at }, withEntity, o);
      if (!r.ok) {
        out.failed.push({ line: index, why: r.why });
        continue;
      }
      if (r.duplicate) out.already++;
      else out.stocked++;
    } else {
      out.expensed++;
    }
    out.recorded.push({ supply_item_id: made.supply_item_id, name: made.name, qty, cost, kept: made.keep_stock });
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
  const r = await withEntity(entity_id, (db) =>
    db.query(`SELECT name, keep_stock, unit FROM supply_item WHERE entity_id = $1 AND supply_item_id = $2`, [entity_id, supply_item_id])
  );
  const row = r.rows[0];
  if (!row) return { error: 'no such supply' };
  if (!row.keep_stock) return { error: 'this supply is expensed when it arrives, so there is no balance to issue from' };
  return stock.post(
    entity_id,
    {
      item_id: supply_item_id,
      item_kind: 'supply',
      reason: 'issued',
      qty: Number(qty) || 0,
      unit: row.unit || null,
      ref: o.ref || 'use-' + Date.now(),
      line_ref: '1',
      note: row.name
    },
    withEntity,
    o
  );
}

module.exports = { nameKey, suggestKeepStock, list, ensure, ensureMany, update, purchase, issue };
