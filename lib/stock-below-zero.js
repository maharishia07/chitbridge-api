// lib/stock-below-zero.js — AT-F-03 (walk AT, 22 Nov): a movement that asks to be refused below zero is refused in words, before any write
// OWNS     the one refusal of "used more than is on hand" for a movement that sets refuse_below_zero (the supplies' "used some")
// CALLED BY lib/stock-store.js post, under the balance lock
// FLOW     O2P · supplies · used some
'use strict';

/** is this movement (the unique key: ref, line, reason, lot) already in the log? Read only on the refusal path: a resend of a recorded movement is a duplicate, never a refusal. */
async function recorded(db, entityId, movement, lotKeyed) {
  if (movement.ref == null) return false;
  const found = await db.query(
    `SELECT 1 FROM stock_movement WHERE entity_id = $1 AND ref = $2 AND line_ref IS NOT DISTINCT FROM $3 AND reason = $4 AND COALESCE(lot, '') = $5 LIMIT 1`,
    [entityId, movement.ref, movement.line_ref || null, movement.reason, lotKeyed || '']
  );
  return found.rows.length > 0;
}

/**
 * refusal(db, entityId, movement, before, after, lotKeyed) → { ok: false, why } or null.
 * No GOV setting for negative stock exists: the till allows it on purpose (an offline counter cannot know the shelf) and warns (below_zero); only a movement that sets
 * refuse_below_zero (a person at a screen, who knows what is on the shelf) is stopped here.
 */
async function refusal(db, entityId, movement, before, after, lotKeyed) {
  if (!(movement.refuse_below_zero && after.qty < 0) || (await recorded(db, entityId, movement, lotKeyed))) return null;
  return { ok: false, why: 'only ' + before.qty + (before.unit ? ' ' + before.unit : '') + ' on hand, so ' + Math.abs(Number(movement.qty)) + ' cannot be recorded as used. Count the stock, or record the purchase first.' };
}

module.exports = { refusal };
