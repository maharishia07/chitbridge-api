// CARD 02-tasks-orders-and-workflow/open-orders-queue
// owns: the open-orders definition (which orders are tasks, their live lines, billed / despatched marks).
// called by: routes/till.js GET /tasks (RAIL-146c: a cost-blind reader's tasks go through lib/cost-view) · lib/home-facts.js orders · lib/work-rows.js.
// FLOW  select.rows (closed states left out) → liveLines (amended) → marks → orderLines → remaining → task
'use strict';
/**
 * lib/open-orders.js — THE OPEN ORDERS, ONE DEFINITION (M168). The till's order list (GET /api/till/tasks) and Home's Orders card
 * (lib/home-facts orders) both ask THIS function, so "19 orders open" on Home and "🛒 2" on the till can never be two answers.
 * An order is open for a side when its chit says that side (sideOf), and some line still has quantity remaining (lib/deliverline —
 * events, never a stored total). Trips: select.rows (1) + one chit_detail read + ONE progress read (progressMany), whatever the count.
 */
const select = require('./select');
const log = require('./logger');
const deliverline = require('./deliverline');
const costView = require('./cost-view');
const { withEntity } = require('../db');

/** ORD-FIX O2: an order the shop rejected or the customer cancelled is finished — never a task, never counted on Home */
const CLOSED_STATES = ['rejected', 'cancelled'];

/**
 * ⭐⭐ WHICH WAY DOES AN ORDER FACE? (2026-09-08)
 *
 * An order we SEND is a purchase; an order we RECEIVE is a sale. That held until the ordinary Indian case turned up: a supplier who
 * is not on ChitBridge cannot be a recipient of a chit, so a shop's own purchase order has to be recorded as a SELF chit — and a
 * self chit lands as direction 'received', exactly like a customer's order to us. Direction stopped being enough to tell them apart.
 *
 * ⚠️ SO IT IS DECLARED, NOT INFERRED. `business_json.side` says 'buy' or 'sell', written by whoever creates the order. A chit that
 * does not say keeps the old meaning, which is what every chit written before today meant.
 */
function sideOf(head, bj) {
  const said = bj && typeof bj.side === 'string' ? bj.side.toLowerCase() : null;
  if (said === 'buy' || said === 'sell') return said;
  return head.direction === 'sent' ? 'buy' : 'sell';
}
/** M126: the storefront's own words for an order (summary_json.order_details) as the till needs them; null when it is not an online order */
function orderOf(sum) {
  const d = sum && typeof sum === 'object' ? sum.order_details : null;
  if (!d || d.channel !== 'online') return null;
  return {
    channel: 'online',
    fulfilment: d.fulfilment === 'pickup' ? 'pickup' : 'delivery',
    address: d.address || null,
    requested_delivery: d.requested_delivery || null,
    remark: d.remark || null,
    name: d.name || null
  };
}

/**
 * ⭐ THE TWO MARKS THAT CLOSE AN ORDER WITHOUT A STATUS (M129b · M162b), as ONE statement and one reader — open-orders.tasks and the work
 * list (lib/work-rows) both ask it, so "billed" and "despatched" can never be two answers. $1 entity, $2 the order ids (text[]).
 */
/** the ONE billed test: a bill (bill_no set) that names the order as its order.from. `ids` is the SQL the order id is compared with. */
const billNames = (ids) => `business_json->>'bill_no' IS NOT NULL AND business_json->'order'->>'from' = ${ids}`;
const MARKS_SQL = `SELECT DISTINCT CASE WHEN business_json->>'doc' = 'despatch' THEN business_json->'against'->>'chit_id' END AS against,
                       CASE WHEN business_json->>'doc' IS DISTINCT FROM 'despatch' THEN business_json->'order'->>'from' END AS billed
         FROM chit_header
        WHERE entity_id = $1 AND ((business_json->>'doc' = 'despatch' AND business_json->'against'->>'chit_id' = ANY($2::text[]))
                               OR (${billNames('ANY($2::text[])')}))`;
/**
 * billedOfChitSql(entitySql, chitSql) — WALK2 W36: the same billed test as MARKS_SQL, as a scalar for ONE chit's read (routes/chits.js ONE_SHOT, no round trip):
 * true when a bill of mine names the chit as its order. entitySql, chitSql: the SQL placeholders for my entity and the chit id.
 */
const billedOfChitSql = (entitySql, chitSql) => `EXISTS (SELECT 1 FROM chit_header WHERE entity_id = ${entitySql} AND ${billNames(chitSql + '::text')})`;
/** MARKS_SQL rows → { despatched: Set(chit_id), billed: Set(chit_id) } */
function marksFrom(rows) {
  const list = rows || [];
  return {
    despatched: new Set(list.filter((x) => x.against).map((x) => String(x.against))),
    billed: new Set(list.filter((x) => x.billed).map((x) => String(x.billed)))
  };
}

/**
 * ⭐ ORD-FIX O3 — THE LINES AS THEY ARE NOW, not as they were sealed. /amend and /reprice write chit_line; the frozen line_items never
 * change, so billing or working an order from them billed 10 kg after it was amended to 8 and billed a removed line. The delivery
 * progress read (deliverline.progress → chit_line) already carries the live quantity, price and removed flag: this lays them over the
 * frozen lines, and adds a line the amendment made. No progress (chit_line not migrated) → the frozen lines, as before.
 *   liveLines(chit_id, frozen[], progressMap|null) → [line]   (removed lines are gone; each kept line carries its line_id)
 */
function liveLines(chit_id, frozen, progressMap) {
  if (!progressMap || !progressMap.get || !progressMap.size) return frozen;
  const seen = new Set(),
    out = [];
  (frozen || []).forEach((line, pos) => {
    const id = deliverline.lineIdOf(chit_id, line, pos + 1),
      live = progressMap.get(id);
    seen.add(id);
    if (!live) {
      out.push(Object.assign({}, line, { line_id: id }));
      return;
    } /* the id is pinned: a removal above must not shift its position */
    if (live.removed) return;
    out.push(
      Object.assign({}, line, {
        line_id: id,
        quantity: live.ordered == null ? line.quantity : live.ordered,
        price: live.price == null ? line.price : live.price,
        unit: live.unit || line.unit
      })
    );
  });
  progressMap.forEach((live, id) => {
    if (!seen.has(String(id)) && !live.removed)
      out.push({ line_id: id, particulars: live.particulars, quantity: live.ordered, price: live.price, unit: live.unit });
  });
  return out;
}

/** the order's lines as the till and the work list read them: live (liveLines), each with what is ordered, moved and still owed (M162: the line_id it has in chit_line) */
function orderLines(chit_id, frozen, progressOfChit) {
  return liveLines(chit_id, Array.isArray(frozen) ? frozen : [], progressOfChit).map((line, pos) => {
    const line_id = deliverline.lineIdOf(chit_id, line, pos + 1);
    const prog = progressOfChit && progressOfChit.get ? progressOfChit.get(line_id) : null;
    const ordered = Number(line.quantity) || 0;
    const moved = prog && prog.delivered != null ? Number(prog.delivered) : 0;
    return {
      line_id,
      item_id: (line.item_data && line.item_data.item_id) || line.item_id || null,
      name: line.particulars || line.name || '',
      unit: line.unit || 'piece',
      rate: line.price == null ? null : Number(line.price),
      ordered,
      moved,
      remaining: Math.max(0, Math.round((ordered - moved) * 1000) / 1000)
    };
  });
}

/**
 * RAIL-146c · the tasks as a cost-blind reader may read them: each through lib/cost-view hideTaskCosts, its side from ONE blind-only workSides read for the page (the heads behind
 * the tasks). The owner, a cost-allowed actor and the paired till key never come here.
 */
async function tasksForBlind(db, entity_id, heads, out) {
  const shown = new Set(out.map((task) => String(task.chit_id)));
  return costView.tillRows(db, entity_id, heads.filter((head) => shown.has(String(head.chit_id))), out, costView.hideTaskCosts);
}

/** kind 'receive' (orders WE SENT, goods to count in) or 'despatch' (orders WE RECEIVED, goods to send) → [task]; `blind` (a co-assist without can_see_costs, read ONCE by the route) hides the purchase money */
async function tasks(entity_id, kind, limit, blind = false) {
  const want = kind === 'receive' ? 'buy' : 'sell';
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  /* ⚠️ BOTH DIRECTIONS, and sideOf decides — a purchase order for an off-platform supplier arrives as 'received' and is still a purchase */
  /* own_bills:false — my counter sales never fill the 300 (WX-O2C); the `bj.bill_no && !theirBill` check below stays as the belt */
  let heads = await select.rows(entity_id, { purpose: 'order', since, limit: 300, own_bills: false, status_not: CLOSED_STATES });
  /* ⭐ a supplier's counter bill reaches me as purpose 'invoice' + counter_bill (routes/chits.js billCopyFor) — goods to
     count in, so goods-in reads those too (only those: an app invoice is not a counter's delivery) */
  if (kind === 'receive') {
    const bills = await select.rows(entity_id, { purpose: 'invoice', direction: 'received', since, limit: 300 });
    heads = heads
      .concat(bills.map((item) => Object.assign({ _counterBillOnly: true }, item)))
      .sort((first, second) => String(second.created_at || '').localeCompare(String(first.created_at || '')));
  }
  if (!heads.length) return [];
  return withEntity(entity_id, async (db) => {
    const ids = heads.map((item) => item.chit_id);
    const li = await db.query(
      `SELECT h.chit_id, d.line_items, h.business_json
         FROM chit_header h
         LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
        WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`,
      [entity_id, ids]
    );
    const byId = new Map(li.rows.map((item) => [String(item.chit_id), item]));
    const prog = await deliverline.progressMany(entity_id, ids, db).catch(log.orElse('open-orders tasks: failed — answered with nothing', null));
    /* M129b: an order the OLD counter despatched (a D/… note against it, no movement ever written) is not open.
       M162b: nor is an order a BILL was made against (the bill's business_json.order.from = the order's chit id) - the till's done-write may never have happened.
       ONE read answers both, for every order, not one per order. */
    const { despatched, billed } = marksFrom(
      (await db.query(MARKS_SQL, [entity_id, ids.map(String)]).catch(log.orElse('open-orders tasks: the read failed — answered with none', { rows: [] }))).rows
    );
    const out = [];
    for (const h of heads) {
      const det = byId.get(String(h.chit_id)) || {};
      const bj = det.business_json || {};
      if (h._counterBillOnly && bj.counter_bill !== true) continue;
      /* ⭐ A SUPPLIER'S COUNTER BILL SENT TO ME is goods to count in (the two-sided counter bill, 2026-10-01): a purchase,
         whatever its direction says — and receiving every line accepts it (routes/chits.js deliver-lines) */
      const theirBill = require('./tax-copy').billReceived(Object.assign({}, h, { business_json: bj }), entity_id);
      if (bj.bill_no && !theirBill) continue; /* MY counter sale is a record, not a task */
      if ((theirBill ? 'buy' : sideOf(h, bj)) !== want) continue; /* the other way round belongs to the other screen */
      if (out.length >= limit) break;
      const p0 = prog && prog.get ? prog.get(String(h.chit_id)) : null;
      const lines = orderLines(h.chit_id, det.line_items, p0);
      if (!lines.length) continue;
      if (lines.every((line) => line.remaining <= 0)) continue; /* nothing owed: not a task */
      /* M129b despatched · M162b billed — each hides the order only while nothing has moved: a note or bill whose delivery write has not landed yet.
         ORD-FIX O1: once goods HAVE moved, what is left (remaining) decides — a partial bill leaves the rest open, not owed-and-invisible */
      const nothingMoved = lines.every((line) => !(line.moved > 0));
      if (nothingMoved && (despatched.has(String(h.chit_id)) || billed.has(String(h.chit_id)))) continue;
      out.push({
        chit_id: h.chit_id,
        at: h.created_at,
        subject: h.manual_subject || h.auto_subject || '',
        party: (orderOf(h.summary_json) || {}).name || h.counterparty_name || (bj.party && bj.party.name) || '',
        party_id: h.counterparty_id || null,
        ref: bj.order_no || bj.ref || null,
        /* M74: the till's order list shows it (who · ₹ · age · STATUS) */
        status: h.current_status || null,
        /* M126: how an ONLINE order was placed (summary_json.order_details, written by the storefront) - the till bills it
                    as ordered (Delivery / Pickup) instead of packing it; null for an order typed or sent in any other way */
        order: orderOf(h.summary_json),
        lines
      });
    }
    return blind ? tasksForBlind(db, entity_id, heads, out) : out;
  });
}

module.exports = { tasks, liveLines, orderLines, CLOSED_STATES, sideOf, orderOf, MARKS_SQL, marksFrom, billedOfChitSql };
