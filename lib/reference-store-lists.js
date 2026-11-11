'use strict';
/**
 * lib/reference-store-lists.js — THE LAB READS EACH STARTER LIST FROM ITS STORE (CAT-124 C1+C2, 11 Nov 2026)
 * OWNS     which entity is the store of which list (STORES) and reading a list's rows back out of its store.
 * CALLED BY routes/products.js GET /lists (readStoreLists, cardOf: one card per store) · scripts/reference-stores.cjs (STORES).
 * FLOW     GET /lists → readStoreLists (one look-up of the six store ids, then one withEntity read per store, kept 60 s) → fromStore
 *          (catalogue-blueprint, amount only) → cardOf; a list with no loaded store answers from the constant, store_id null.
 * CARD     06-catalogue-pim/README (reference lists & adopt a list)
 *
 * Athi, 27 Sep: "separate stores, so we know each store and it can be one catalogue item in the product lab". Athi, 11 Nov:
 * "yes, switch to the six reference stores" — the shadow period ended. The store is the source; lib/catalogue-blueprint.js still
 * defines what a list IS (words, shelves, units, load/parity) and is the fallback.
 *
 * ⚠️ A STORE THAT IS NOT LOADED IS NOT AN EMPTY LAB. A box where `reference-stores.cjs load` has not run (a fresh database, CI)
 * answers that list from the constant, with no store id, and logs it — never a 500, never a blank card.
 * ⚠️ THE CURRENCY STOPS IN fromStore (an amount only); the adopting shop stamps its own. Unchanged.
 * ⚠️ Stores are internal + private (scripts `internal`), so the directory and network search never list them (business-search.js:68,
 * network-search.js:75). Only this server-side read reaches them, one withEntity per store; the asking shop never switches owner.
 */
const blueprints = require('./catalogue-blueprint');
const log = require('./logger');

const LABEL = { veg: 'Vegetables & fruit', fish: 'Fish & seafood', chicken: 'Chicken', meat: 'Meat', egg: 'Eggs', hotel: 'Hotel' };
const CACHE_MS = 60 * 1000; /* reference lists change by a deliberate load only, so one minute per process is safe */
let cache = null;

/* ⚠️ 'cbrefhotel' is refused: cb + exactly 8 characters is reserved as bridge-id shaped (lib/handle.js LOOKS_LIKE_BRIDGE). Athi chose 'cbrefhotels' (27 Sep). */
const STORES = Object.keys(blueprints.BLUEPRINTS).map((key) => ({
  key,
  user_id: key === 'hotel' ? 'cbrefhotels' : 'cbref' + key,
  email: 'ref-' + key + '@chitbridge.com',
  display_name: 'Reference · ' + (LABEL[key] || blueprints.blueprint(key).label)
}));

const CATEGORY_SQL = `SELECT definition_id, name FROM definition WHERE entity_id = $1 AND kind = 'category'`;
const ITEMS_SQL = `SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND is_active IS NOT FALSE LIMIT 5000`;

const rowKey = (row) => String(row.name).trim().toLowerCase() + '\u0001' + String(row.unit || '').trim().toLowerCase();

/** Rows in the list's own order (the constant's), anything the store added after it. Stable, so a card never reshuffles between reads. */
function inListOrder(key, rows) {
  const list = blueprints.blueprint(key);
  const place = new Map(list.starter.map((item, index) => [rowKey({ name: item.name, unit: item.unit || list.defaultUnit }), index]));
  const rank = (row) => (place.has(rowKey(row)) ? place.get(rowKey(row)) : place.size);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((first, second) => rank(first.row) - rank(second.row) || first.index - second.index)
    .map((entry) => entry.row);
}

/** One store's rows as the lab shows them, or null when it holds none (not loaded). */
async function readStore(store, identityId, database) {
  const held = await database.withEntity(identityId, async (db) => ({
    items: (await db.query(ITEMS_SQL, [identityId])).rows,
    categories: (await db.query(CATEGORY_SQL, [identityId])).rows
  }));
  const names = new Map(held.categories.map((category) => [String(category.definition_id), category.name]));
  const rows = inListOrder(store.key, blueprints.fromStore(store.key, held.items, (id) => names.get(String(id))));
  return rows.length ? { store_id: identityId, store_name: store.display_name, rows } : null;
}

/** Reads every registered store into `out`; the lists that gave nothing are logged once, and that list falls back to the constant. */
async function readEachStore(database, idOf, out) {
  const unloaded = [];
  for (const store of STORES) {
    const identityId = idOf.get(store.user_id);
    if (!identityId) {
      unloaded.push(store.key);
      continue;
    }
    try {
      const loaded = await readStore(store, identityId, database);
      if (loaded) out.set(store.key, loaded);
      else unloaded.push(store.key);
    } catch (failure) {
      log.fellBack('reference lists: a store could not be read — the lab shows the built-in list', failure);
    }
  }
  if (unloaded.length) log.warn('reference lists: store not registered or empty — the lab shows the built-in list', { lists: unloaded });
}

/**
 * key → { store_id, store_name, rows } for every list whose store is registered AND loaded; a list not in the map is answered from the constant.
 * @param database { query, withEntity } — injected so the test needs no database
 */
async function readStoreLists(database) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.lists;
  const lists = new Map();
  try {
    const found = await database.query('SELECT identity_id, LOWER(user_id) AS user_id FROM identities WHERE LOWER(user_id) = ANY($1)', [STORES.map((store) => store.user_id)]);
    await readEachStore(database, new Map(found.rows.map((row) => [row.user_id, row.identity_id])), lists);
  } catch (failure) {
    log.fellBack('reference lists: the stores could not be looked up — the lab shows the built-in lists', failure);
    return lists; /* not kept: the next read tries again */
  }
  cache = { at: Date.now(), lists };
  return lists;
}

/**
 * One starter list as the Product Lab shows it (GET /lists): its words, its shelves and units, the languages its rows carry, and every row with the unit it will be adopted under.
 * @param store the entry readStoreLists gave for this list, or undefined (not loaded: the constant answers, store_id null)
 */
function cardOf(source, item, store) {
  const list = source.blueprint(item);
  const rows = store ? store.rows : list.starter;
  return {
    key: list.key,
    label: list.label,
    outcome: list.outcome,
    pin: source.pin(list),
    store_id: store ? store.store_id : null,
    store_name: store ? store.store_name : null,
    categories: list.categories,
    units: list.units,
    languages: source.languagesOf(item),
    count: rows.length,
    rows: rows.map((row) => ({
      name: row.name,
      unit: row.unit || list.defaultUnit,
      price: row.price,
      category: row.category || null,
      names: row.names || null
    }))
  };
}

function invalidate() {
  cache = null;
}

module.exports = { STORES, LABEL, readStoreLists, cardOf, invalidate };
