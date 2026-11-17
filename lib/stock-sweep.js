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
 * ⚠️ BOUNDED: DAYS back, LIMIT chits per pass, PASSES passes, newest first, GRACE_S old. A product the shop marked not stocked is out by SQL; a bill that came back only not_stocked is memoed for 6 h (per shop, 500 at most).
 * ⚠️ A cancelled or rejected bill is left alone, as the books sweep leaves it.
 */
const logger = require('./logger');

const DAYS = 3;
const VISIBLE_DAYS = 30;
const OPEN_LIMIT = 200;
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
 * whose second line failed is found. A '#top-up' movement counts as its line's. A product the shop itself marked item_data.stocked = false (made to
 * order) is not a stock line: that is permanent by type and costs no memo. $1 shop · $2 days · $3 grace s · and, for a page, $4 limit · $5 only bills older than this moment (null = all).
 */
function gapsFrom(paged) {
  return `
    FROM chit_header h JOIN chit_detail d ON d.entity_id = h.entity_id AND d.chit_id = h.chit_id
   WHERE h.entity_id = $1 AND h.sender_entity_id = h.entity_id AND h.role <> 'Draft'
     AND h.created_at >= now() - ($2::int * interval '1 day') AND h.created_at < now() - ($3::int * interval '1 second')
     AND ((h.purpose = 'order' AND h.business_json ? 'bill_no') OR h.purpose = 'credit_note')
     ${paged ? 'AND ($5::timestamptz IS NULL OR h.created_at < $5::timestamptz)' : ''}
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.line_items) = 'array' THEN d.line_items ELSE '[]'::jsonb END) WITH ORDINALITY AS l(line, n)
                  CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(l.line ->> 'line_id', ''), NULLIF(l.line -> 'item_data' ->> 'line_id', ''), l.n::text) AS line_ref,
                                             COALESCE(NULLIF(l.line ->> 'item_id', ''), NULLIF(l.line -> 'item_data' ->> 'item_id', '')) AS item_id) x
                 WHERE x.item_id IS NOT NULL
                   AND CASE WHEN l.line ->> 'quantity' ~ '^[0-9]+([.][0-9]+)?$' THEN (l.line ->> 'quantity')::numeric ELSE 0 END > 0
                   AND NOT EXISTS (SELECT 1 FROM catalogue_items ci WHERE ci.entity_id = h.entity_id AND ci.item_id::text = x.item_id AND ci.item_data ->> 'stocked' = 'false')
                   AND NOT EXISTS (SELECT 1 FROM stock_movement m WHERE m.entity_id = h.entity_id AND m.ref = ${REF_SQL}
                                      AND (m.line_ref = x.line_ref OR left(m.line_ref, length(x.line_ref) + 7) = x.line_ref || '#top-up')))
     AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = h.chit_id AND cs.entity_id = h.entity_id AND cs.current_status IN ('cancelled', 'rejected'))`;
}
/** a page, newest first (a bill that moves no stock cannot sit in front of a real gap); the next page asks for bills older than the last one's created_at */
const GAPS_SQL = `SELECT h.chit_id, h.purpose, h.business_json, h.created_at, d.line_items${gapsFrom(true)} ORDER BY h.created_at DESC LIMIT $4`;
/** the bills that still have an unposted stock line over the visible window, newest first (a read, posts nothing) — $1 shop · $2 days · $3 grace s */
const OPEN_SQL = `SELECT h.chit_id, h.created_at${gapsFrom(false)} ORDER BY h.created_at DESC LIMIT ${OPEN_LIMIT}`;

/**
 * THE MEMO — only what is known to move nothing FOR NOW: a bill whose every line came back not_stocked (a trade default the SQL cannot see) or already posted.
 * Per shop, at most MEMO_CAP bills, each good for MEMO_MS (a trade or flag change heals within hours). Never no_cost, batch_unreadable or any failure: those can heal.
 */
const memo = new Map(); /* shop -> Map(chit_id -> expires ms) */
const MEMO_CAP = 500;
const MEMO_MS = 6 * 60 * 60 * 1000;
function memoed(entity_id, chit_id) {
  const mine = memo.get(entity_id);
  const until = mine && mine.get(chit_id);
  if (until && until > Date.now()) return true;
  if (until && mine) mine.delete(chit_id);
  return false;
}
function remember(entity_id, chit_id) {
  if (!memo.has(entity_id)) memo.set(entity_id, new Map());
  const mine = memo.get(entity_id);
  mine.delete(chit_id);
  mine.set(chit_id, Date.now() + MEMO_MS);
  if (mine.size > MEMO_CAP) mine.delete(mine.keys().next().value);
}

const lastHeal = new Map(); /* shop -> ms of its last throttled heal */
const retrying = new Map(); /* shop -> tries so far, while a retry timer is set */

/** one page of this shop's chits that should have moved stock and have no movement, older than options.before → [{ chit_id, purpose, business_json, line_items, created_at }] */
async function gaps(entity_id, withEntity, options) {
  const { days = DAYS, grace = GRACE_S, limit = LIMIT, before = null } = options || {};
  const found = await withEntity(entity_id, (db) => db.query(GAPS_SQL, [entity_id, days, grace, limit, before]));
  return found.rows.map((row) => ({ chit_id: row.chit_id, purpose: row.purpose, is_draft: false, business_json: row.business_json, line_items: row.line_items, created_at: row.created_at }));
}

/** the bills of the last `days` with a stock line still unposted that the memo does not know to be nothing → { n, oldest } (a read) */
async function countGaps(entity_id, withEntity, days) {
  const found = await withEntity(entity_id, (db) => db.query(OPEN_SQL, [entity_id, days || VISIBLE_DAYS, GRACE_S]));
  const open = found.rows.filter((row) => !memoed(entity_id, row.chit_id));
  return { n: open.length, oldest: open.length ? open[open.length - 1].created_at : null };
}

/** fold one postFor answer into the pass: lines moved, a chit that failed again (named), or a chit that moves nothing for now (memoed) */
function noteReply(out, entity_id, chit_id, reply) {
  const { moved = 0, failed = [], skipped = [] } = reply || {};
  out.moved += moved;
  if (failed.length) return out.still.push({ chit_id, failed });
  if (!moved && skipped.every((item) => item.code === 'not_stocked')) remember(entity_id, chit_id);
}

/** post each chit of one page again, leaving out the bills the memo knows move nothing for now */
async function repostPage(entity_id, withEntity, chits, options, out) {
  const post = options.post || require('./stock-from-chit').postFor;
  for (const waiting of chits.filter((chit) => !memoed(entity_id, chit.chit_id)))
    noteReply(out, entity_id, waiting.chit_id, await post(entity_id, waiting, withEntity, { actor_id: options.actor_id || null }));
}

/** post each chit again → { found, moved, still } where still lists the chits whose lines failed again */
async function repostAll(entity_id, withEntity, options) {
  const out = { found: 0, moved: 0, still: [] };
  let before = null;
  for (let pass = 0; pass < PASSES; pass++) {
    const chits = await gaps(entity_id, withEntity, Object.assign({}, options, { before }));
    out.found += chits.length;
    await repostPage(entity_id, withEntity, chits, options, out);
    if (chits.length < (options.limit || LIMIT)) break;
    before = chits[chits.length - 1].created_at;
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
  if ((options || {}).say) await sayOpenGaps(entity_id, withEntity, out);
  sayResult(entity_id, out);
  return out;
}

/** a pass that still has a failed chit WARNS stock.repost with the lines and why; one that moved something says so */
function sayResult(entity_id, out) {
  if (out.still.length) logger.warn('stock.repost', { entity_id, found: out.found, moved: out.moved, still: out.still });
  else if (out.moved) logger.info('stock.repost', { entity_id, found: out.found, moved: out.moved });
}

/**
 * THE GAP STAYS VISIBLE past a restart: the throttled pass (healSoon, once per 5 min per shop — never a replay) counts the 30 days' bills that still have a stock line with no movement and WARNS stock.repost.open while there are any
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
  setImmediate(() => healShop(entity_id, withEntity, Object.assign({ say: true }, options)));
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

module.exports = { gaps, countGaps, remember, MEMO_CAP, healShop, healSoon, retryLater, GAPS_SQL, OPEN_SQL, memo, DAYS, LIMIT, GRACE_S, RETRIES };
