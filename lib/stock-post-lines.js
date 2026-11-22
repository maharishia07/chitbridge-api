'use strict';
// lib/stock-post-lines.js — one bill's stock lines on one handle
// OWNER     cb-operations
// RISK      money (stock value moves): a throw leaves to the caller, who rolls the bill back (fail closed, never half a bill)
// OWNS      SPEED (1129): the lines of ONE bill through the stock guard and the store on one handle (the caller's transaction); the direction of a reason asked of the engine's own table
// CALLED BY lib/stock-from-chit.postMovements (the one post loop: a chit's movements and a counted-in bill's both go through it)
// FLOW      ordered lines -> inventory direction -> store.issue (out) | store.post (in) -> moved · failed · duplicate · short; a throw leaves to the caller, who rolls the bill back
// CARD      13-inventory-stock-and-traceability/on-hand-and-movements
const store = require('./stock-store');

/** ⚠️ asked of the ENGINE's own table, so a reason added there cannot be mis-routed here */
function inventoryDirection(reason) {
  const known = require('./inventory').REASONS[reason];
  return known ? known.dir : null;
}

/** the lines of one bill through the guard and the store on ONE handle (`inTx` stands in for withEntity); a refused line is `failed`, a throw leaves to the caller (rolls the bill back) */
async function postLines(entity_id, lines, inTx, opts) {
  const result = { moved: 0, failed: [], duplicate: 0, short: [], below_zero: [] };
  for (const mv of lines) {
    /* ⭐⭐ OUT GOES THROUGH issue() (a sale of tracked stock names no batch: the server picks by FEFO and may split the line), IN THROUGH post() (a receipt names its batch) */
    const out = inventoryDirection(mv.reason);
    const posted = out === 'out' ? await store.issue(entity_id, mv, inTx, opts) : await store.post(entity_id, mv, inTx, opts);
    if (!posted.ok) {
      result.failed.push({ line_ref: mv.line_ref, why: posted.why });
      continue;
    }
    result.moved += posted.moved != null ? posted.moved : posted.duplicate ? 0 : 1;
    result.duplicate += posted.duplicate === true ? 1 : posted.duplicate || 0;
    /* ⚠️ A SHORT PICK IS REPORTED (shelf and record disagree: go and count), never a reason to have refused the sale */
    if (posted.short) result.short.push({ line_ref: mv.line_ref, item_id: mv.item_id, by: posted.short });
    /* OPS-121 ALLOW AND FLAG: a sale that took the shelf below zero is named (the owner reads the balance: Stock "below zero", Home; sendStock logs stock.oversold) */
    if (!posted.duplicate && (posted.below_zero === true || posted.short || (posted.parts || []).some((part) => part.below_zero === true))) result.below_zero.push({ line_ref: mv.line_ref, item_id: mv.item_id });
  }
  return result;
}

module.exports = { postLines, inventoryDirection };
