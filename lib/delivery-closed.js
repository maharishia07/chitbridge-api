'use strict';
/**
 * lib/delivery-closed.js — may goods be recorded on this chit at all? A rejected or cancelled order takes none (RAIL-193), whichever side withdrew it (BA-F-05).
 * OWNER     cb-orders
 * RISK      stock
 * OWNS      refuseWithdrawn(db, entity_id, chit_id, refusal) → throws the 409 'Order closed' (why wrong_step) when any copy I hold, or every OTHER party's copy, is rejected or cancelled
 * CALLED BY lib/deliverline.js refuseWithdrawnCopy
 * CARD      01-rail-core-the-chit/line-model
 * FLOW      my chit_status rows + chit_participants (the reader the rail's credit-note and match gates use) ──▶ railActions.deliveryOn (the rail's own table and words) ──▶ refusal
 * ⚠️ Each copy keeps its OWN status: when the seller rejects an order the buyer placed, the buyer's sent copy still says pending. So the buyer's delivery was recorded on a rejected order
 *    (walk BA, BA-F-05) until the other parties' statuses were read too. Several receivers: one rejecting does not close it for the others, so every other party must have withdrawn.
 */
const railActions = require('./rail-actions');
const closedBody = (verdict) => ({ error: 'Order closed', message: verdict.say, why: verdict.why, from: verdict.from });

async function refuseWithdrawn(db, entity_id, chit_id, refusal) {
  const mine = await db.query('SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2', [chit_id, entity_id]);
  for (const copy of mine.rows) {
    const verdict = railActions.deliveryOn(copy.current_status);
    if (!verdict.ok) throw refusal(409, closedBody(verdict));
  }
  const others = (await db.query('SELECT entity_id, current_status FROM chit_participants($1)', [chit_id])).rows.filter((row) => String(row.entity_id) !== String(entity_id));
  if (others.length && others.every((row) => !railActions.deliveryOn(row.current_status).ok)) throw refusal(409, closedBody(railActions.deliveryOn(others[0].current_status)));
}
module.exports = { refuseWithdrawn };
