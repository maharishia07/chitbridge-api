'use strict';
// OWNS      CTR-178: the stock a recorded counter sale took out is never lost for good — a bill with no stock movement is found and posted again
// CALLED BY routes/chits.js (sendStock after a post, sendReplay on a duplicate) · tests/ctr-178-stock-repost.test.cjs
// FLOW      shop -> chits of the last days with no stock_movement under their ref (chit_header + chit_detail) -> lib/stock-from-chit.postFor (idempotent) -> moved / still failing, SAID
// CARD      13-inventory-stock-and-traceability/on-hand-and-movements
/**
 * lib/stock-sweep.js — THE SAME PATTERN AS THE BOOKS (books-store UNPOSTED_FROM + books-nightly sweep): the thing to post is DERIVED from the chit,
 * so a lost post is found by looking for the chit with nothing posted under its ref, never by a queue that could itself be lost. No new table.
 * postFor is idempotent on (entity, ref, line_ref, reason, lot), so posting a bill twice moves nothing twice.
 *
 * ⭐ WHEN IT RUNS (no new job, no cross-shop read):
 *   · after a stock post that left a line failed — retried in RETRY_MS, up to RETRIES times, and SAID each time it still fails;
 *   · after any later counter sale of the same shop (once per HEAL_EVERY_MS) — a restart that lost a post is healed by the next sale;
 *   · when the till replays a bill the server already holds (sendReplay answers duplicate:true) — that bill at once, no grace.
 * ⚠️ A shop that never sells or replays again keeps its gap until it does; a nightly walk over all shops needs one SECURITY DEFINER shop list
 *   (like ops.f_books_enabled) — a migration, left out on purpose. The gap is still findable: the sweep SQL is the query.
 * ⚠️ BOUNDED: DAYS back, LIMIT chits, GRACE_S old. A bill whose lines all move nothing (labour, made-to-order) is read again until it ages out.
 * ⚠️ A cancelled or rejected bill is left alone, as the books sweep leaves it.
 */
const logger = require('./logger');

const DAYS = 3;
const LIMIT = 50;
const GRACE_S = 60;
const HEAL_EVERY_MS = 5 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const RETRIES = 5;

/** the counter's own documents that move stock: a till bill (order with a bill_no) and a credit note — the same ones stock-from-chit.movementsFor reads */
const GAPS_SQL = `
  SELECT h.chit_id, h.purpose, h.business_json, h.created_at, d.line_items
    FROM chit_header h JOIN chit_detail d ON d.entity_id = h.entity_id AND d.chit_id = h.chit_id
   WHERE h.entity_id = $1 AND h.sender_entity_id = h.entity_id AND h.role <> 'Draft'
     AND h.created_at >= now() - ($2::int * interval '1 day') AND h.created_at < now() - ($3::int * interval '1 second')
     AND ((h.purpose = 'order' AND h.business_json ? 'bill_no') OR h.purpose = 'credit_note')
     AND NOT EXISTS (SELECT 1 FROM stock_movement m WHERE m.entity_id = h.entity_id
           AND m.ref = left(COALESCE(NULLIF(h.business_json ->> 'client_ref', ''), NULLIF(h.business_json ->> 'bill_no', ''), NULLIF(h.business_json ->> 'doc_no', ''), h.chit_id::text), 64))
     AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.current_status IN ('cancelled', 'rejected'))
   ORDER BY h.created_at LIMIT $4`;

const lastHeal = new Map(); /* shop -> ms of its last throttled heal */
const retrying = new Map(); /* shop -> tries so far, while a retry timer is set */

/** the chits of this shop that should have moved stock and have no movement → [{ chit_id, purpose, business_json, line_items, created_at }] */
async function gaps(entity_id, withEntity, opt) {
  const o = opt || {};
  const found = await withEntity(entity_id, (db) => db.query(GAPS_SQL, [entity_id, o.days || DAYS, o.grace == null ? GRACE_S : o.grace, o.limit || LIMIT]));
  return found.rows.map((row) => ({ chit_id: row.chit_id, purpose: row.purpose, is_draft: false, business_json: row.business_json, line_items: row.line_items, created_at: row.created_at }));
}

/**
 * post again every chit that has no movement → { found, moved, still: [{ chit_id, failed }] }. NEVER REJECTS. A chit that still fails is SAID (warn stock.repost), never swallowed.
 * opt: { grace, days, limit, actor_id, post (a stand-in for postFor, for a test) }
 */
async function healShop(entity_id, withEntity, opt) {
  const o = opt || {};
  const out = { found: 0, moved: 0, still: [] };
  try {
    const post = o.post || require('./stock-from-chit').postFor;
    const chits = await gaps(entity_id, withEntity, o);
    out.found = chits.length;
    for (const chit of chits) {
      const reply = await post(entity_id, chit, withEntity, { actor_id: o.actor_id || null });
      if (reply && reply.moved) out.moved += reply.moved;
      if (reply && reply.failed && reply.failed.length) out.still.push({ chit_id: chit.chit_id, failed: reply.failed });
    }
  } catch (e) {
    out.still.push({ chit_id: null, failed: [{ why: String(e && e.message) }] });
  }
  if (out.still.length) logger.warn('stock.repost', { entity_id, found: out.found, moved: out.moved, still: out.still });
  else if (out.moved) logger.info('stock.repost', { entity_id, found: out.found, moved: out.moved });
  return out;
}

/** heal this shop at most once per HEAL_EVERY_MS, off the sale's own path — the gap a restart or a lost post left behind */
function healSoon(entity_id, withEntity, opt) {
  const now = Date.now();
  if (now - (lastHeal.get(entity_id) || 0) < HEAL_EVERY_MS) return;
  lastHeal.set(entity_id, now);
  setImmediate(() => healShop(entity_id, withEntity, opt));
}

/** a post left a line failed: try this shop again in RETRY_MS (up to RETRIES), each try SAID by healShop; the last failure is named as given up */
function retryLater(entity_id, withEntity, opt) {
  if (retrying.has(entity_id)) return;
  retrying.set(entity_id, 0);
  const again = () => {
    const tries = retrying.get(entity_id) + 1;
    retrying.set(entity_id, tries);
    healShop(entity_id, withEntity, Object.assign({ grace: 0 }, opt)).then((r) => {
      if (!r.still.length) return retrying.delete(entity_id);
      if (tries >= RETRIES) {
        logger.warn('stock.repost.gave_up', { entity_id, tries, still: r.still });
        return retrying.delete(entity_id);
      }
      setTimeout(again, RETRY_MS).unref();
    });
  };
  setTimeout(again, RETRY_MS).unref();
}

module.exports = { gaps, healShop, healSoon, retryLater, GAPS_SQL, DAYS, LIMIT, GRACE_S, RETRIES };
