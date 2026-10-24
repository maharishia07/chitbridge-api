/**
 * ── lib/stocked.js · IS THIS ITEM COUNTED AS STOCK? (R104, 2026-10-24) ───────────────────────────────────────────
 * OWNS      stockedFor (pure) · flagsFor (the ONE read of a product's stock flags: batch_tracked + stocked, per chit or per shelf) · the FIELDS.md line item_data.stocked
 * CALLED BY lib/stock-from-chit.js (trackingFor → postFor: a line of a not-counted item is a NAMED skip) · lib/stock-store.js (onHand · asAt { counted_only })
 * FLOW      govresolve.verticalOf (ONE trip) + catalogue_items flags (ONE query) → per item: lotfields.tracksBatch + stockedFor → { tracked, counted }
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * A made-to-order dish is not stock. Kaveri Tiffins cooks a Masala Dosa when it is ordered, so a sale must never move a balance and
 * Operations › Stock must never list it at −40 "below zero". The precedent is `batch_tracked` (lotfields.tracksBatch):
 * ⭐ THE VERTICAL ANSWERS FIRST AND THE ITEM OVERRIDES BOTH WAYS — `item_data.stocked: true|false` wins; otherwise the trade decides.
 *
 * ⚠️ NOT beside tracksBatch in lib/lotfields.js, where the requirement first put it: that file is ADOPTED from chitbridge-engines
 * (its first line; the operations ledger, 18 Oct) and R104 owns no engines change. VB6 may later move both answers onto the vertical
 * row (cb-vertical); until then this is the api's one door.
 * ⚠️ THE DEFAULT IS THE VERTICAL'S ANSWER, NOT A THIRD WORD LIST: catalogue-blueprint.forVertical(trade) === 'hotel' — the one list that
 * already holds hotel · restaurant · cafe · canteen · tiffin · mess · eatery. No trade declared → every item is counted: a default is
 * not an answer to a question nobody asked (lotfields header). Hazard, recorded not fixed: a shop that declares the sector
 * "food-service" also hits lotfields.PACKS food (/food|…/) and is asked batch and expiry on every dish — declare `tiffin` or `restaurant`.
 * ⚠️ FAILS SAFE TOWARDS "COUNTED" (the behaviour before R104): an unreadable flag must not make a receipt of Ghee vanish as a dish.
 */
'use strict';
const logger = require('./logger');
const lotfields = require('./lotfields');
const govresolve = require('./govresolve'); /* VERT-1: the ONE resolver of the shop's trade; called through the module so a test may stand in */
const blueprint = require('./catalogue-blueprint');

/** the starter list whose trade cooks to order — forVertical's own key, never a word list of our own */
const COOKED_LIST = 'hotel';
/** ONE query for both per-product flags, over the ids a chit or a shelf actually names (never per line) */
const FLAGS_SQL = `SELECT item_id, item_data->'batch_tracked' AS batch_tracked, item_data->'stocked' AS stocked FROM catalogue_items
          WHERE entity_id = $1 AND item_id = ANY($2::uuid[])`;
/** a JSON flag read back: true · false · undefined (unsaid) — undefined is genuinely different from false */
const boolOf = (value) => (value === true || value === false ? value : undefined);

/**
 * stockedFor(trade, flag) → { counted, source: 'product' | 'vertical' | 'none', why }
 * `trade` is govresolve.verticalFrom's answer ({ key, sectors, … }) or null; `flag` the product's own item_data.stocked.
 */
function stockedFor(trade, flag) {
  if (flag === true || flag === false) {
    return { counted: flag, source: 'product', why: flag ? 'this product says it is counted as stock' : 'this product says it is not counted as stock' };
  }
  const key = trade && trade.key;
  if (!key) return { counted: true, source: 'none', why: 'this shop has not declared a trade, so every item is counted as stock' };
  const cooked = blueprint.forVertical(key) === COOKED_LIST;
  return {
    counted: !cooked,
    source: 'vertical',
    vertical: key,
    why: cooked ? key + ' makes its dishes to order, so an item is not counted unless it says so' : key + ' sells what it stocks, so every item is counted unless it says otherwise'
  };
}

/** the trade a caller already knows (opts.trade, or opts.sectors — tests, a known profile); undefined = ask the resolver */
function knownTrade(options) {
  if (options.trade !== undefined) return options.trade;
  return options.sectors ? govresolve.verticalFrom({ sectors: options.sectors }) : undefined;
}

/**
 * readFlags(entity_id, ids, withEntity, options) → { trade, flags: Map(item_id → { batch_tracked, stocked }), readable }
 * The trade is one trip (govresolve.verticalOf), the flags one query over the ids named. A read that fails answers as before
 * R104 — one pool, every item counted — and says so in the log (readable: false).
 */
async function readFlags(entity_id, ids, withEntity, options) {
  let trade = knownTrade(options);
  const flags = new Map();
  try {
    if (trade === undefined) trade = await govresolve.verticalOf(entity_id);
    if (!ids.length) return { trade, flags, readable: true };
    const reply = await withEntity(entity_id, (db) => db.query(FLAGS_SQL, [entity_id, ids]));
    for (const row of reply.rows) flags.set(String(row.item_id), { batch_tracked: boolOf(row.batch_tracked), stocked: boolOf(row.stocked) });
    return { trade, flags, readable: true };
  } catch (e) {
    logger.fellBack('stocked flagsFor: the product flags could not be read — kept as one pool, every item counted', e);
    return { trade: trade || null, flags, readable: false };
  }
}

/** one item's two answers: tracked by batch (lotfields.tracksBatch, the engine's own door) · counted as stock (stockedFor) */
function answerFor(flag, read, words) {
  const item = flag.batch_tracked === undefined ? {} : { item_data: { batch_tracked: flag.batch_tracked } };
  const counted = read.readable ? stockedFor(read.trade, flag.stocked).counted : true;
  return { tracked: lotfields.tracksBatch({ sectors: words, item }).tracked, counted };
}

/**
 * flagsFor(entity_id, item_ids, withEntity, opts) → { by: Map(item_id → { tracked, counted }), trade, counted_default }
 * Asked ONCE for a chit or a shelf, never per line: readFlags (one trip + one query), then answerFor each id named.
 */
async function flagsFor(entity_id, item_ids, withEntity, opts) {
  const ids = Array.isArray(item_ids) ? item_ids.map(String) : [];
  const read = await readFlags(entity_id, ids, withEntity, opts || {});
  /* the resolved trade's words go to the engine's own door (lotfields.tracksBatch reads sectors; the engine is not edited here) */
  const words = read.trade ? [read.trade.key].concat(read.trade.sectors).filter(Boolean) : [];
  const by = new Map();
  for (const id of ids) by.set(id, answerFor(read.flags.get(id) || {}, read, words));
  return { by, trade: read.trade, counted_default: read.readable ? stockedFor(read.trade, undefined).counted : true };
}

/** the ids among `item_ids` the shop does NOT count — what a stock reader drops or stamps (stock-store onHand · asAt) */
async function notCountedOf(entity_id, item_ids, withEntity, opts) {
  const answer = await flagsFor(entity_id, item_ids, withEntity, opts);
  return new Set([...answer.by.entries()].filter(([, flag]) => flag.counted === false).map(([id]) => id));
}

module.exports = { stockedFor, flagsFor, notCountedOf, FLAGS_SQL, COOKED_LIST };
