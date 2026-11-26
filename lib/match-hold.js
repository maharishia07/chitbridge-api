// lib/match-hold.js — RAIL-1128 M1: THE THREE-WAY MATCH HOLD on a received invoice.
// OWNER  cb-rail
// RISK   a hold that cannot be read THROWS (fail closed, never "fine"); a wrong tolerance holds too much or too little of a supplier's bill, so the figures are the match's own, never recomputed here
// @stage tested
// @stage-note RAIL-1128 M1: the three-way match gates the buyer's acceptance. A received invoice billed above what was received, beyond the trade's tolerance, is HELD for a person.
// CARD 01-rail-core-the-chit/status-the-one-status-writer
// lib/match-hold.js — the three-way match holds a received bill that is above what was received
// OWNER     cb-rail
// RISK      money
// OWNS  holdFor(db, entity_id, chit_id) -> null | { held, order, lines[], money, words } · HELD_SAID (the refusal's words) · the statuses the hold guards.
// CALLED BY  lib/rail-status.js (matchHeldRefusal, asked by statusGate: the ONE status writer) · tests/rail-1128-match-hold.test.cjs.
// FLOW  my received invoice copy -> the order it names (business_json.order.from) -> lib/till-match matchOrders (the SAME computation GET /api/till/match shows, nothing recomputed) -> held when a line is billed_more or the money is apart and billed above what was received.
'use strict';
/**
 * ⭐ RAIL-1128 M1 (coordinator decision, industry practice: SAP / NetSuite / Xero AP three-way match): the match used to be a report. Accept posted the purchase at the supplier's
 * figure: PO 100 x 1,000 = 100,000, received 60 (60,000), bill 100,000 -> 100,000 booked, 40,000 payable and input tax for goods never received.
 *
 * THE HOLD IS NOT A NEW STATUS. The bill stays where it is (pending), the ONE status writer (rail-status statusGate) refuses the move to accepted / in_progress / completed with `match_held`,
 * and the sentence says why in words. A person who has looked at it moves it again WITH a reason (opts.matchOverride + the note): that reason goes on the bill's history, and the books
 * then post exactly as before (lib/books-hooks buyerGate is untouched: it never sees a held bill, because the bill never reaches accepted).
 *
 * WHAT HOLDS: a line billed above what was received beyond the trade's tolerance (till-match billed_more, OPS-351), or the invoice total above the goods received with tax (their-bill code 'apart', gap < 0).
 * WHAT NEVER HOLDS: no order named (nothing to match against) · an unknown figure (never 0, never a guess) · a short bill · agreed within tolerance · a bill already past acceptance.
 */
const log = require('./logger');
const { boundRead } = require('./bound-read'); /* SEC-198: the identities read runs under its own id's binding */
const GUARDED = Object.freeze(['accepted', 'in_progress', 'completed']);
/** only a bill not yet taken is held; once accepted the person already decided (the hold asks once) */
const BEFORE_ACCEPT = /^(pending|delivered|read)$/;

/** the words a held move says (a screen branches on `why`, never on the sentence) */
const HELD_SAID = (lines, money) => ({
  error: 'Held for the three-way match',
  code: 'match_held',
  why: 'match_held',
  message:
    'This bill is held: ' + (lines.length ? lines.join('; ') : 'it charges more than was received') +
    '. Check it with the supplier, or accept it anyway with a reason that goes on the bill.',
  lines,
  money: money || null
});

/** the one sentence of a billed-more line: figures as the match carries them */
const lineWords = (item) => item.name + ': billed ' + item.billed + ' ' + item.unit + ', received ' + item.received + ' (ordered ' + item.ordered + ')';

/** F7: a line billed above what was received by more than `tolerancePct` percent of what was received (integer thousandths; nothing received means any billed quantity counts). A unit that differs or an unknown billed quantity never holds. */
/** a percentage is read in hundredths (2.5 % = 250) so the compare stays in whole numbers; a QUANTITY rule, no money in it */
const PER_CENT = 100;
function qtyBeyond(item, tolerancePct) {
  if (item.billed == null || item.billed_unit) return false;
  const excess = Math.round(item.billed * 1000) - Math.round(item.received * 1000);
  return excess > 0 && excess * 10000 > Math.round(tolerancePct * PER_CENT) * Math.round(item.received * 1000);
}
/** gapMinor(order, currency) → { apart, excess } in minor units: `apart` the tax-inclusive gap (null when the door carried none), `excess` that gap, else the goods gap, else null */
function gapMinor(order, currency) {
  const money = require('./money');
  const apart = order.money_code === 'apart' && order.money_gap != null && order.money_gap < 0 ? money.toMinor(-order.money_gap, currency) : null;
  const goods = order.goods_gap != null && order.goods_gap > 0 ? money.toMinor(order.goods_gap, currency) : null;
  return { apart, excess: apart != null ? apart : goods };
}

/** F7 / L-F-07: the money beyond `tolerancePct` percent of the bill: the match's tax-inclusive gap when the door carried a tax figure, else the goods gap (what they charge minus what was received at the order's rates). null when none or unknown. */
function moneyBeyond(order, tolerancePct, currency) {
  const money = require('./money'); /* red1128: the money module reads every figure into whole minor units (no hand rounding here) */
  const factor = Math.pow(10, money.decimals(currency));
  const billed = order.invoiced_total == null ? null : money.toMinor(order.invoiced_total, currency);
  if (billed == null) return null;
  const { apart, excess } = gapMinor(order, currency);
  if (excess == null || excess * 10000 <= Math.round(tolerancePct * PER_CENT) * billed) return null;
  return { figures: { invoiced: order.invoiced_total, gap: excess / factor, kind: apart != null ? 'with_tax' : 'goods' }, words: 'the bill is ' + order.invoiced_total + ' but ' + (apart != null ? 'the goods counted come to ' + order.received_with_tax + ' with tax' : 'the goods received come to ' + order.received_total) + ' (' + excess / factor + ' more)' };
}
/** orderNamedBy(row, entity_id) → the chit id of the order a received invoice names (business_json.order.from), or a falsy value when the row is no invoice from someone else or names none */
function orderNamedBy(row, entity_id) {
  if (!row || row.purpose !== 'invoice' || String(row.sender_entity_id) === String(entity_id)) return null;
  return row.business_json && row.business_json.order && row.business_json.order.from;
}

/** the order one of MY received invoices bills, as a head the match reads; null when the copy is no invoice I received or names no order I hold */
async function orderHeadOf(db, entity_id, chit_id) {
  const mine = await db.query(`SELECT purpose, sender_entity_id, business_json FROM chit_header WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received'`, [chit_id, entity_id]);
  const row = mine.rows[0];
  const from = orderNamedBy(row, entity_id);
  if (!from) return null;
  const order = await db.query(
    `SELECT h.chit_id, h.direction, h.created_at, s.current_status
       FROM chit_header h LEFT JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id AND s.direction = h.direction
      WHERE h.entity_id = $1 AND h.chit_id = $2 AND h.purpose = 'order' LIMIT 1`,
    [entity_id, String(from)]
  );
  return order.rows[0] ? Object.assign({}, order.rows[0], { counterparty_id: row.sender_entity_id }) : null;
}

/** tolerancesOf(flags) → { tolerance: { weight_bp, count_units }, tolerancePct } from the shop's policy flags, each with its default */
function tolerancesOf(flags) {
  const tolerance = { weight_bp: flags.tol_weight_bp == null ? 50 : Number(flags.tol_weight_bp), count_units: Number(flags.tol_count_units) || 0 };
  const tolerancePct = flags.match_tolerance_pct == null ? 2 : Number(flags.match_tolerance_pct); /* F7: THE tolerance of this gate: the one setting, default 2 */
  return { tolerance, tolerancePct };
}

/** the tolerance this trade absorbs (the same numbers the door and GET /match use) and the shop's money */
async function matchSettings(entity_id) {
  const flags = await require('./policy').get(entity_id).catch((err) => {
    log.warn('match-hold: policy unreadable, the default tolerance is used', { err: String(err) });
    return {};
  });
  const { tolerance, tolerancePct } = tolerancesOf(flags);
  const found = await require('../db').boundRead(query, entity_id, 'SELECT currency_code, country FROM identities WHERE identity_id = $1', [entity_id]);
  const shop = found.rows[0] || {};
  let currency = null;
  try { currency = require('./country-setup').shopMoney(shop.currency_code, shop.country); } catch (err) { log.warn('match-hold: shop money unreadable, lines compare without it', { err: String(err) }); currency = null; } /* a shop with no money: the lines still compare, the money does not */
  return { tolerance, currency, tolerancePct };
}

/**
 * is the invoice I received held by the three-way match? -> null (not held) | { order, lines[], money, words }
 * `db` = my own handle (the caller's open transaction). A failed read THROWS: a hold that cannot be read never reads "fine" (fail closed, as the paid read does).
 */
async function holdFor(db, entity_id, chit_id) {
  const head = await orderHeadOf(db, entity_id, chit_id);
  if (!head) return null;
  const { tolerance, currency, tolerancePct } = await matchSettings(entity_id);
  const orders = await require('./till-match').matchOrders(db, entity_id, [head], 365, tolerance, currency);
  const order = orders[0];
  if (!order) return null;
  const over = order.lines.filter((item) => qtyBeyond(item, tolerancePct));
  const money = moneyBeyond(order, tolerancePct, currency);
  if (!over.length && !money) return null;
  const lines = over.map(lineWords).concat(money ? [money.words] : []);
  return { order: order.chit_id, lines, money: money ? money.figures : null, words: HELD_SAID(lines, money ? money.figures : null) };
}

module.exports = { holdFor, HELD_SAID, GUARDED, BEFORE_ACCEPT };
