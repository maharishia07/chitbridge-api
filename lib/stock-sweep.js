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
 * ⚠️ A shop that never sells or replays again, and a bill older than DAYS, keep their gap: a walk over all shops needs one SECURITY DEFINER shop list
 *   (like ops.f_books_enabled) — a migration, filed as CTR-203. Until then the gap is NAMED (stock.repost.open, 30 days), not posted.
 * ⚠️ BOUNDED: DAYS back, LIMIT chits per pass, PASSES passes, newest first, GRACE_S old. A bill that posts and moves nothing (made to order) is remembered in `settled` and not read again.
 * ⚠️ A cancelled or rejected bill is left alone, as the books sweep leaves it.
 */
const logger = require('./logger');

const DAYS = 3;
const VISIBLE_DAYS = 30;
const PASSES = 5;
const LIMIT = 50;
const GRACE_S = 60;
const HEAL_EVERY_MS = 5 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const RETRIES = 5;

/** the document's ref as stock-from-chit.movementsFor stamps it on its movements */
const REF_SQL = `left(COALESCE(NULLIF(h.business_json ->> 'client_ref', ''), NULLIF(h.business_json ->> 'bill_no', ''), NULLIF(h.business_json ->> 'doc_no', ''), h.chit_id::text), 64)`;
/**
 * the counter's own documents that move stock — a till bill (order with a bill_no) and a credit note, the ones movementsFor reads — that still have a
 * STOCK LINE WITHOUT ITS MOVEMENT: a line with a product id and a quantity, judged per line_ref (the line's id, else its position), so a 2-line bill
 * whose second line failed is found. A '#top-up' movement counts as its line's. $1 shop · $2 days · $3 grace s · $4 limit · $5 chit ids to leave out.
 */
const GAPS_FROM = `
    FROM chit_header h JOIN chit_detail d ON d.entity_id = h.entity_id AND d.chit_id = h.chit_id
   WHERE h.entity_id = $1 AND h.sender_entity_id = h.entity_id AND h.role <> 'Draft'
     AND h.created_at >= now() - ($2::int * interval '1 day') AND h.created_at < now() - ($3::int * interval '1 second')
     AND ((h.purpose = 'order' AND h.business_json ? 'bill_no') OR h.purpose = 'credit_note')
     AND h.chit_id <> ALL ($5::uuid[])
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.line_items) = 'array' THEN d.line_items ELSE '[]'::jsonb END) WITH ORDINALITY AS l(line, n)
                  CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(l.line ->> 'line_id', ''), NULLIF(l.line -> 'item_data' ->> 'line_id', ''), l.n::text) AS line_ref) x
                 WHERE COALESCE(NULLIF(l.line ->> 'item_id', ''), NULLIF(l.line -> 'item_data' ->> 'item_id', '')) IS NOT NULL
                   AND CASE WHEN l.line ->> 'quantity' ~ '^[0-9]+([.][0-9]+)?$' THEN (l.line ->> 'quantity')::numeric ELSE 0 END > 0
                   AND NOT EXISTS (SELECT 1 FROM stock_movement m WHERE m.entity_id = h.entity_id AND m.ref = ${REF_SQL}
                                      AND (m.line_ref = x.line_ref OR left(m.line_ref, length(x.line_ref) + 7) = x.line_ref || '#top-up')))
     AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.current_status IN ('cancelled', 'rejected'))`;
/** newest first: a bill that moves no stock cannot sit in front of a real gap */
const GAPS_SQL = `SELECT h.chit_id, h.purpose, h.business_json, h.created_at, d.line_items${GAPS_FROM} ORDER BY h.created_at DESC LIMIT $4`;
const COUNT_SQL = `SELECT count(*)::int AS n, min(h.created_at) AS oldest${GAPS_FROM}`;

const settled = new Set(); /* chits this process posted and found nothing to move (labour, made to order, all duplicates): not read again until a restart */
const lastHeal = new Map(); /* shop -> ms of its last throttled heal */
const retrying = new Map(); /* shop -> tries so far, while a retry timer is set */

/** the chits of this shop that should have moved stock and have no movement → [{ chit_id, purpose, business_json, line_items, created_at }] */
async function gaps(entity_id, withEntity, options) {
  const { days = DAYS, grace = GRACE_S, limit = LIMIT, leave = [] } = options || {};
  const found = await withEntity(entity_id, (db) => db.query(GAPS_SQL, [entity_id, days, grace, limit, [...settled, ...leave]]));
  return found.rows.map((row) => ({ chit_id: row.chit_id, purpose: row.purpose, is_draft: false, business_json: row.business_json, line_items: row.line_items, created_at: row.created_at }));
}

/** how many chits of the last `days` still have a stock line with no movement, and the oldest → { n, oldest } (a count, posts nothing) */
async function countGaps(entity_id, withEntity, days) {
  const found = await withEntity(entity_id, (db) => db.query(COUNT_SQL, [entity_id, days || VISIBLE_DAYS, GRACE_S, 0, []]));
  const row = found.rows[0] || {};
  return { n: row.n || 0, oldest: row.oldest || null };
}

/** fold one postFor answer into the pass: lines moved, a chit that failed again (named), or a chit with nothing to move (settled) */
function noteReply(out, chit_id, reply) {
  out.moved += (reply && reply.moved) || 0;
  if (reply && reply.failed && reply.failed.length) out.still.push({ chit_id, failed: reply.failed });
  else if (!reply || !reply.moved) settled.add(chit_id);
}

/** post each chit again → { found, moved, still } where still lists the chits whose lines failed again */
async function repostAll(entity_id, withEntity, options) {
  const out = { found: 0, moved: 0, still: [] };
  const post = options.post || require('./stock-from-chit').postFor;
  const seen = [];
  for (let pass = 0; pass < PASSES; pass++) {
    const chits = await gaps(entity_id, withEntity, Object.assign({}, options, { leave: seen }));
    out.found += chits.length;
    for (const chit of chits) {
      seen.push(chit.chit_id);
      noteReply(out, chit.chit_id, await post(entity_id, chit, withEntity, { actor_id: options.actor_id || null }));
    }
    if (chits.length < (options.limit || LIMIT)) break;
  }
  return out;
}

/**
 * post again every chit that has no movement → { found, moved, still: [{ chit_id, failed }] }. NEVER REJECTS. A chit that still fails is SAID (warn stock.repost), never swallowed.
 * options: { grace, days, limit, actor_id, post (a stand-in for postFor, for a test) }
 */
async function healShop(entity_id, withEntity, options) {
  let out;
  try {
    out = await repostAll(entity_id, withEntity, options || {});
  } catch (e) {
    out = { found: 0, moved: 0, still: [{ chit_id: null, failed: [{ why: String(e && e.message) }] }] };
  }
  await sayOpenGaps(entity_id, withEntity, out);
  if (out.still.length) logger.warn('stock.repost', { entity_id, found: out.found, moved: out.moved, still: out.still });
  else if (out.moved) logger.info('stock.repost', { entity_id, found: out.found, moved: out.moved });
  return out;
}

/**
 * THE GAP STAYS VISIBLE past a restart: every pass counts the 30 days' bills that still have a stock line with no movement and WARNS stock.repost.open while there are any
 * (re-said by the shop's next sale after a boot — the log, not a process counter, is the record). No migration: there is no all-shops tick without one.
 */
async function sayOpenGaps(entity_id, withEntity, out) {
  try {
    const open = await countGaps(entity_id, withEntity, VISIBLE_DAYS);
    out.open = open.n;
    if (open.n) logger.warn('stock.repost.open', { entity_id, days: VISIBLE_DAYS, bills: open.n, oldest: open.oldest });
  } catch (e) {
    logger.fellBack('stock-sweep: the open-gap count failed', e);
  }
}

/** heal this shop at most once per HEAL_EVERY_MS, off the sale's own path — the gap a restart or a lost post left behind */
function healSoon(entity_id, withEntity, options) {
  const now = Date.now();
  if (now - (lastHeal.get(entity_id) || 0) < HEAL_EVERY_MS) return;
  lastHeal.set(entity_id, now);
  setImmediate(() => healShop(entity_id, withEntity, options));
}

/** a post left a line failed: try this shop again in RETRY_MS (up to RETRIES), each try SAID by healShop; the last failure is named as given up */
function retryLater(entity_id, withEntity, options) {
  if (retrying.has(entity_id)) return;
  retrying.set(entity_id, 0);
  /** one retry: heal, and set the next one unless it is clean or RETRIES are used */
  const again = () => {
    const tries = retrying.get(entity_id) + 1;
    retrying.set(entity_id, tries);
    healShop(entity_id, withEntity, Object.assign({ grace: 0 }, options)).then((result) => {
      if (!result.still.length) return retrying.delete(entity_id);
      if (tries >= RETRIES) {
        logger.warn('stock.repost.gave_up', { entity_id, tries, still: result.still });
        return retrying.delete(entity_id);
      }
      setTimeout(again, RETRY_MS).unref();
    });
  };
  setTimeout(again, RETRY_MS).unref();
}

module.exports = { gaps, countGaps, healShop, healSoon, retryLater, GAPS_SQL, COUNT_SQL, settled, DAYS, LIMIT, GRACE_S, RETRIES };
