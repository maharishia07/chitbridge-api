'use strict';
/**
 * lib/product-categories.js — ADD OR REMOVE A CATEGORY ON A PRODUCT, as a set operation (QA-130, 11 Nov 2026).
 *
 * OWNS      idsOf(item_data) · applyChange(item_data, { add, remove }, names) → { changed, item_data } · changeCategories(db, entity_id, change) (the locked read, the per-product answer, the one write)
 * CALLED BY routes/products.js (POST /categories/bulk)
 * FLOW      locked read of the products → applyChange per product → only the products that changed are written, through catwrite.patchItems
 * CARD      06-catalogue-pim/categories-and-fields
 *
 * A category is a classification, many per product, mostly set once (Athi, 11 Nov): the request says "add X" / "remove X", never the
 * whole record. Adding one already there, or removing one that is absent, changes nothing: safe to repeat, safe to resume, and no other
 * key of the product is read back and written, so a newer edit of the price is never overwritten.
 * ⚠️ The storage is the one the single attach writes (web catgSetOn): `categories` = the ids, `category_names` = a positional copy of the
 * names for a counterparty who cannot resolve our ids, and the legacy `category` / `category_name` never survive a write. The reader of the
 * ids (catgIdsOf) is the same too: `categories`, else the legacy single `category`.
 * ⚠️ A category's rate (rules.default_slab) is NOT touched here and not gated here: attaching never writes an item's own rate keys
 * (rate-door RATE_KEYS), exactly as the single attach (PATCH /:id with categories) has never needed the rate door.
 */

/** the codes a product's answer carries (the client branches on these, never on the words) */
const RESULT = { DONE: 'done', UNCHANGED: 'unchanged', REFUSED: 'refused' };
const REASON_NOT_FOUND = 'NOT_FOUND';

/** the category ids a product cites: `categories`, else the legacy single `category` (read, never written again) */
function idsOf(itemData) {
  const d = itemData || {};
  if (Array.isArray(d.categories)) return d.categories.map(String).filter(Boolean);
  return d.category ? [String(d.category)] : [];
}

/** the names a product travelled with, positional to its ids (`category_names`, else the legacy `category_name`) */
function namesOf(itemData) {
  const d = itemData || {};
  if (Array.isArray(d.category_names)) return d.category_names.map(String);
  return d.category_name ? [String(d.category_name)] : [];
}

/** the new id list: current ids plus the added ones not there yet, minus the removed ones (order kept, no duplicates) */
function nextIds(current, add, remove) {
  const gone = new Set(remove);
  const kept = current.concat(add.filter((id) => current.indexOf(id) < 0));
  return kept.filter((id) => !gone.has(id));
}

/** the positional names for `ids`: the master's name, else the name the product already carried for that id, else the id (never lose the word) */
function namesFor(ids, wasIds, wasNames, names) {
  return ids.map((id) => {
    if (names && names.get(id)) return names.get(id);
    const at = wasIds.indexOf(id);
    return at >= 0 && wasNames[at] ? wasNames[at] : id;
  });
}

/**
 * → { changed: false } when the set of ids would not move (nothing is written, not even the legacy key), else
 *   { changed: true, item_data } = the SAME record with only the category keys different (a copy; the argument is not touched).
 * @param names Map id → current name from the master (may be empty)
 */
function applyChange(itemData, change, names) {
  const was = idsOf(itemData);
  const next = nextIds(was, change.add || [], change.remove || []);
  if (next.length === was.length && next.every((id, at) => id === was[at])) return { changed: false };
  const out = Object.assign({}, itemData);
  delete out.category;
  delete out.category_name;
  if (!next.length) {
    delete out.categories;
    delete out.category_names;
  } else {
    out.categories = next;
    out.category_names = namesFor(next, was, namesOf(itemData), names);
  }
  return { changed: true, item_data: out };
}

const UUID = require('./namedentity').UUID;
const catwrite = require('./catalogue-write'); /* the one writer of a product */
const categories = require('./categories'); /* the category master, read as itself */

/** the products asked for that exist and are on the shelf, locked for the transaction → Map id → item_data. Only a real uuid is asked of the uuid column. */
async function lockedRows(db, entity_id, ids) {
  const real = ids.filter((id) => UUID.test(id));
  if (!real.length) return new Map();
  const found = await db.query('SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true AND item_id = ANY($2::uuid[]) FOR UPDATE', [entity_id, real]);
  return new Map(found.rows.map((row) => [row.item_id, row.item_data || {}]));
}

/** the added category ids the master does not hold (a typo or another shop's id never lands on a product) */
const unknownAdds = (add, names) => add.filter((id) => !names.has(id));

/** the one answer line of a product: its result, and for a refusal the code the client branches on */
const lineOf = (id, result, reason) => Object.assign({ id, result }, reason ? { reason } : {});

/**
 * ONE transaction for the lot (the caller owns it): read the names, lock the rows, work out each change, write only the products that moved.
 * → { unknown: [ids] } when an added category is not in the master (nothing written), else { results: [{ id, result, reason? }] } in the order asked.
 */
async function changeCategories(db, entity_id, change) {
  const names = await categories.categoryNames(entity_id, { withEntity: (_id, run) => run(db) });
  const unknown = unknownAdds(change.add, names);
  if (unknown.length) return { unknown };
  const rows = await lockedRows(db, entity_id, change.ids);
  const edits = [];
  const results = change.ids.map((id) => {
    if (!rows.has(id)) return lineOf(id, RESULT.REFUSED, REASON_NOT_FOUND);
    const next = applyChange(rows.get(id), change, names);
    if (!next.changed) return lineOf(id, RESULT.UNCHANGED);
    edits.push({ item_id: id, replace: next.item_data });
    return lineOf(id, RESULT.DONE);
  });
  if (edits.length) await catwrite.patchItems(db, entity_id, edits);
  return { results };
}

module.exports = { idsOf, applyChange, changeCategories, RESULT, REASON_NOT_FOUND };
