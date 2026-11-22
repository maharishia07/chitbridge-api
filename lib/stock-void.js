'use strict';
// OWNER     cb-operations
// RISK      money
// OWNS      AU-F-01: a withdrawn goods receipt takes its stock back off the shelf, once
// CALLED BY routes/chits.js (PUT /:chit_id/void)
// FLOW      receipt chit -> its 'purchase' movements (by the document's ref) -> one 'purchase_return' each through lib/stock-store.post (the ONE writer) -> said back
// CARD      13-inventory-stock-and-traceability/on-hand-and-movements
/**
 * lib/stock-void.js — VOIDING A RECEIPT REVERSES WHAT IT PUT ON THE SHELF.
 *
 * Walk AU: a goods receipt of 60 and one of 10, the 60 voided -> the void answered "Order withdrawn" and the shelf still held 70 (hand 10).
 * The movements the receipt wrote are found by the document's own ref (stock-from-chit.refOf, the key they were posted under) and each is
 * given back as a `purchase_return` under ref 'void:<ref>' with the same line_ref and lot. store.post is idempotent on
 * (entity, ref, line_ref, reason, lot), so a second void, or a retry after a failure, moves nothing twice.
 * ⚠️ Goods already sold are not refused: the balance may go below zero and the answer SAYS so (below_zero), as every other out-movement does.
 */
const store = require('./stock-store');
const fromChit = require('./stock-from-chit');

const WORDS = 'Goods receipt withdrawn';

/** the receipt's header: its purpose and business_json, the two things that give the ref and say it is a receipt */
async function headerOf(entity_id, chit_id, withEntity) {
  const found = await withEntity(entity_id, (db) =>
    db.query(`SELECT purpose, business_json FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
  );
  return found.rows[0] || null;
}

/** is this chit a goods receipt (the same two signs movementsFor reads) */
function isReceipt(header) {
  return !!header && (String(header.purpose || '') === 'receipt' || (header.business_json || {}).doc === 'receipt');
}

/** what the receipt put on the shelf: one row per movement, with the lot and where it went */
async function receivedOf(entity_id, ref, withEntity) {
  const found = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT item_id, location, qty, unit, lot, expires_at, item_kind, line_ref
         FROM stock_movement WHERE entity_id = $1 AND ref = $2 AND reason = 'purchase'`,
      [entity_id, ref]
    )
  );
  return found.rows;
}

/** one received movement turned round: the same quantity, line and lot, going back out */
function givenBack(row, ref) {
  return {
    item_id: row.item_id,
    location: row.location,
    reason: 'purchase_return',
    qty: Math.abs(Number(row.qty)),
    unit: row.unit || null,
    ref: 'void:' + ref,
    line_ref: row.line_ref,
    lot: row.lot || null,
    expires_at: row.expires_at || null,
    item_kind: row.item_kind || 'catalogue',
    note: 'goods receipt withdrawn'
  };
}

/**
 * reverseReceipt(entity_id, chit_id, withEntity, opts) -> null when the chit is no goods receipt, else { moved, duplicate, failed:[{line_ref, why}], below_zero:[line_ref] }.
 * It never throws for a refused line: it is said in `failed`, and the void route answers it in words.
 */
async function reverseReceipt(entity_id, chit_id, withEntity, opts) {
  const header = await headerOf(entity_id, chit_id, withEntity);
  if (!isReceipt(header)) return null;
  const ref = fromChit.refOf({ chit_id, business_json: header.business_json });
  const result = { moved: 0, duplicate: 0, failed: [], below_zero: [] };
  for (const row of await receivedOf(entity_id, ref, withEntity)) {
    const posted = await store.post(entity_id, givenBack(row, ref), withEntity, opts);
    if (!posted.ok) result.failed.push({ line_ref: row.line_ref, why: posted.why });
    else if (posted.duplicate) result.duplicate++;
    else result.moved++;
    if (posted.below_zero) result.below_zero.push(row.line_ref);
  }
  return result;
}

/** the void answer's words for a receipt: what went back off the shelf, and what could not */
function wordsFor(reversed) {
  if (!reversed) return null;
  const said = reversed.failed.length ? ' ' + reversed.failed.length + ' line(s) could not come off the shelf: ' + reversed.failed.map((line) => line.why).join('; ') + '.' : '';
  const under = reversed.below_zero.length ? ' Some of it was already sold, so the stock now reads below zero - count it.' : '';
  return WORDS + '.' + said + under;
}

module.exports = { reverseReceipt, wordsFor, isReceipt, WORDS };
