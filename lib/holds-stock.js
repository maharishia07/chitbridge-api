'use strict';
/**
 * lib/holds-stock.js — DOES THIS SHOP HOLD STOCK? (M127, moved out of routes/till.js on 21 Nov so Home's Operations card asks the same question: WALK-H H-F-05)
 * OWNER    cb-operations
 * OWNS      holdsStockOf (one read)
 * FLOW      entity id ──▶ stock_movement (opening or purchase) or a batch-tracked product ──▶ true · false · null (unknown, never a guess)
 * RISK      a wrong false hides Receive and Despatch on a shop that holds stock; a failed read answers null, never false
 * CALLED BY routes/till.js (snapshot shop.holds_stock) · lib/home-facts.js operations (a shop that keeps no stock gets no below-zero alarm)
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
const { withEntity } = require('../db');
const log = require('./logger');

/**
 * M127: DOES THIS SHOP HOLD STOCK? The shop's own DATA decides, never its trade (Athi: "the data decides, not the trade").
 * Two signals, both already in the platform: the shop has RECEIVED stock (a stock_movement of reason opening or purchase - what a
 * Receive / GRN posts, lib/stock-from-chit), or a product of its own says it is kept per batch (item_data.batch_tracked true - the
 * product's word that lotfields.tracksBatch honours first). Neither => false. One read; a table not migrated yet, or a read that
 * fails, answers null (unknown) and the counter then shows Receive and Despatch as usual - it never hides on a guess.
 */
async function holdsStockOf(entity_id) {
  try {
    if (!(await require('../lib/schema').hasTable('stock_movement'))) return null;
    const found = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT (EXISTS (SELECT 1 FROM stock_movement WHERE entity_id = $1 AND reason IN ('opening','purchase'))
            OR EXISTS (SELECT 1 FROM catalogue_items WHERE entity_id = $1 AND is_active = true AND item_data->>'batch_tracked' = 'true')) AS held`,
        [entity_id]
      )
    );
    return !!(found.rows[0] && found.rows[0].held);
  } catch (e) {
    log.fellBack('till holdsStockOf: the read failed — answered with nothing', e);
    return null;
  }
}

module.exports = { holdsStockOf };
