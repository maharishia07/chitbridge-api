'use strict';
/**
 * lib/till-match.js — the three-way match's helpers: every purchase order beside what was received and invoiced, the verdicts and the money gap.
 * OWNS      matchSeen · matchOrders · matchDocuments · matchOrder · matchMoney and the line/receipt/invoice readers (no route, no state)
 * CALLED BY routes/till.js (GET /match); matchMoney is re-exported there for tests/ops83-match-money.test.cjs
 * FLOW      matchDocuments (orders, receipts, invoices) -> matchOrder per head -> matchSeen (a cost-blind reader's costs hidden) -> the orders
 * CARD      counter/till-routes
 */
const log = require('./logger');
const money_ = require('./money');
const { round: roundMoney } = money_; /* money.round - the one rounder */
/** RAIL-1128 N5: money sums in INTEGER minor units (each line rounded at the currency's own grain, then added): many lines can no longer drift by 0.01 as float major-unit sums did */
const minorFactor = (currency) => Math.pow(10, currency ? money_.decimals(currency) : 2);
const minorOf = (amount, factor) => Math.round(Math.abs(amount) * factor + 1e-9) * (amount < 0 ? -1 : 1);
const totalOf = (lines, key, currency) => { const factor = minorFactor(currency); return lines.reduce((sum, item) => sum + minorOf(item[key] * (item.rate || 0), factor), 0) / factor; };
const costView = require('./cost-view'); /* RAIL-146c: what a cost-blind reader may read */
const deliverline = require('./deliverline');
const { sideOf, CLOSED_STATES } = require('./open-orders'); /* ONE definition of an open order */
const lotfields = require('./lotfields');
const units = require('./units');
const theirBill = require('./their-bill'); /* the ONE comparison of a supplier's bill with what was counted */
const counterBill = require('./counter-bill'); /* the shop's own bill by its number */


/** the match orders for their reader: as built for the owner, a cost-allowed actor and the paired key; a cost-blind reader's through lib/cost-view (the old hideLanded folded in), ONE side read for the page */
async function matchSeen(db, entity_id, heads, blind, orders) {
  if (!blind || !orders.length) return orders;
  const shown = new Set(orders.map((order) => String(order.chit_id)));
  return costView.tillRows(db, entity_id, heads.filter((head) => shown.has(String(head.chit_id))), orders, costView.hideMatchCosts, 'buy'); /* the match is about what we BUY: cost-side whatever the party list says (no side read) */
}

/** every purchase order beside what was received and what was invoiced, read on one transaction handle */
async function matchOrders(db, entity_id, heads, days, tolerance, currency) {
  const { byId, receiptsFor, invoices } = await matchDocuments(db, entity_id, heads, days);
  const orders = [];
  for (const head of heads) {
    const detail = byId.get(String(head.chit_id)) || {};
    const business = detail.business_json || {};
    if (business.bill_no) continue; /* a counter sale is not a purchase order */
    if (sideOf(head, business) !== 'buy') continue; /* the match is about what we BUY */
    const progress = await deliverline.progress(entity_id, head.chit_id, db).catch(log.orElse('till GET /match: failed — answered with nothing', null));
    const order = matchOrder(head, detail, business, progress, receiptsFor.get(String(head.chit_id)) || [], invoices, tolerance, currency);
    if (order) orders.push(order);
  }
  return orders;
}

/** the three documents the match sets side by side: the orders' detail, the receipts our own door wrote against them, and the invoices they sent */
async function matchDocuments(db, entity_id, heads, days) {
  const detailRows = await db.query(
    `SELECT h.chit_id, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`,
    [entity_id, heads.map((item) => item.chit_id)]
  );
  const byId = new Map(detailRows.rows.map((item) => [String(item.chit_id), item]));

  /* the receipts our own counter wrote against these orders — that is where the supplier's bill figure was captured */
  const receiptRows = await db.query(
    `SELECT h.chit_id, h.created_at, h.business_json, d.line_items
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.purpose = 'receipt'   /* ⚠️ no direction: our own receipt is a SELF chit, which lands as 'received' */
            AND h.created_at > NOW() - ($2 || ' days')::interval`,
    [entity_id, String(days + 30)]
  );

  /* an invoice they SENT us, if they are on ChitBridge at all */
  const invoiceRows = await db.query(
    `SELECT h.chit_id, h.created_at, h.sender_entity_id, h.summary_json, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.direction = 'received' AND h.purpose = 'invoice'
            AND h.created_at > NOW() - ($2 || ' days')::interval`,
    [entity_id, String(days + 30)]
  );
  return { byId, receiptsFor: receiptsByOrder(receiptRows.rows), invoices: invoiceRows.rows };
}

/** the receipts our own door wrote, grouped by the order they are against: Map(order chit id → [receipt]) */
function receiptsByOrder(rows) {
  const receiptsFor = new Map();
  for (const row of rows) {
    const business = row.business_json || {};
    const against = business.against && business.against.chit_id;
    const key = against ? String(against) : null;
    if (!key) continue;
    if (!receiptsFor.has(key)) receiptsFor.set(key, []);
    receiptsFor.get(key).push(receiptOf(row, business));
  }
  return receiptsFor;
}

/** one receipt of an order: its number and moment, the supplier's bill as keyed at the door, the goods · extras · landed figures and its lines */
function receiptOf(row, business) {
  return {
    chit_id: row.chit_id,
    no: business.doc_no || null,
    at: business.doc_at || row.created_at,
    their_bill: business.their_bill || null,
    input_tax: business.input_tax || null /* what the door counted, taxable + tax per received line (the tax engine's, at the counter) — the match's "ours" */,
    goods: business.goods == null ? null : Number(business.goods),
    extras: business.extras == null ? null : Number(business.extras),
    landed: business.landed_total == null ? null : Number(business.landed_total),
    lines: Array.isArray(row.line_items) ? row.line_items : []
  };
}

/**
 * one order beside its receipts and their invoice, or null when it has no lines.
 * ⭐ THE VERDICT IS ABOUT WHAT IS KNOWN, not about who is right.
 *   awaited   nothing has arrived yet
 *   open      some has, some has not: waiting for the rest (OPS-100: a short line on an order the shop has not closed is not a difference)
 *   agreed    everything arrived as ordered, and the money agrees
 *   differs   something does not agree, and the line says what
 */
function matchOrder(head, detail, business, progress, receipts, invoices, tolerance, currency) {
  const ordered_lines = Array.isArray(detail.line_items) ? detail.line_items : [];
  const billed = billedByLine(ordered_lines, billedLines(head, invoices));
  const lines = ordered_lines.map((item) => matchLine(item, progress, receipts, tolerance, billed.byLine.get(item.line_id)));
  if (!lines.length) return null;
  const invoice = theirInvoice(head, receipts, invoices);
  const ordered_total = totalOf(lines, 'ordered', currency);
  const received_total = totalOf(lines, 'received', currency);
  const closed = String(head.current_status) === 'completed';
  const differences = lines.filter((item) => countsAsDifference(item, closed)).length;
  const money = matchMoney(invoice, receipts, currency);
  return {
    chit_id: head.chit_id,
    at: head.created_at,
    ...orderParty(head, business),
    lines,
    billed_unmatched: billed.unmatched,
    differences,
    verdict: matchVerdict(lines, differences, money, closed),
    ordered_total,
    received_total,
    invoiced_total: invoice.total,
    invoiced_from: invoice.from,
    money_gap: money.gap,
    goods_gap: goodsGap(invoice, received_total, money, currency), /* RAIL-1128 L-F-07 */
    received_with_tax: money.received_with_tax,
    money_code: money.code,
    receipts: receipts.map((item) => ({
      chit_id: item.chit_id,
      no: item.no,
      at: item.at,
      landed: item.landed,
      their_bill_no: (item.their_bill && item.their_bill.no) || null
    }))
  };
}

/**
 * RAIL-1128 L-F-07: when the door carried no tax figure the money gap is unknown (no_tax_figure), yet a short delivery billed in full is still a gap in the goods: what they charge minus what was received at the order's rates (ordered 10, received 8, billed 10 at 20: 200 - 160 = 40).
 * A separate key, never the tax-inclusive money_gap; null whenever the invoice total, the money or the figure is unknown or the money code already carries a gap.
 */
function goodsGap(invoice, received_total, money, currency) {
  if (money.code !== 'no_tax_figure' || invoice.total == null || (invoice.currency && currency && invoice.currency !== String(currency).toUpperCase())) return null;
  const factor = minorFactor(currency);
  const gap = (minorOf(invoice.total, factor) - minorOf(received_total, factor)) / factor;
  return gap === 0 ? 0 : gap;
}
/** the order's subject line and who it is with */
function orderParty(head, business) {
  return {
    subject: head.manual_subject || head.auto_subject || '',
    party: head.counterparty_name || (business.party && business.party.name) || '',
    party_id: head.counterparty_id || null
  };
}

/** the invoices THIS counterparty sent that name THIS order (business_json.order.from), the one reading theirInvoice and billedLines share */
function billingInvoices(head, invoices) {
  return invoices.filter((invoice) => head.counterparty_id && String(invoice.sender_entity_id) === String(head.counterparty_id)
    && String(((invoice.business_json || {}).order || {}).from || '') === String(head.chit_id));
}

/**
 * their invoice: the chit THIS counterparty sent that bills THIS order, else the figure keyed off their paper bill at the door → { total, from, currency } (null when there is none; currency only when the invoice states one).
 * ⭐ OPS-82: a bill belongs to an order by what it names, never by being the first from the same supplier. The link is the one the books read
 * (business_json.order.from = the order's chit id, lib/books-hooks receiptFacts; lib/open-orders billNames). Two bills naming the order is two candidates:
 * the match picks neither, names both in `from`, and the figure stays unknown. A bill whose total_value is not stated is an unknown figure, never 0.
 */
function theirInvoice(head, receipts, invoices) {
  const billing = billingInvoices(head, invoices);
  if (billing.length > 1) return { total: null, from: 'several invoices name this order: ' + billing.map(invoiceNo).join(', ') };
  if (billing.length) {
    const picked = counterBill.pickOf(billing[0]);
    if (!picked.agree) return { total: null, from: 'the copies of their invoice carry different totals', currency: null }; /* pickOf agree:false = no settled figure: unknown, never one of them */
    if (picked.total != null) return { total: Number(picked.total), from: 'their invoice', currency: invoiceCurrency(billing[0]) };
  }
  const keyed = keyedBills(receipts);
  return keyed.length ? { total: keyed.reduce((first, second) => first + second, 0), from: 'their bill, keyed at the door', currency: null } : { total: null, from: null, currency: null };
}

/** the supplier's bills as keyed at the door, each number counted ONCE: one paper bill keyed on two partial receipts is one bill, not two */
function keyedBills(receipts) {
  const seen = new Set();
  return receipts
    .map((item) => item.their_bill)
    .filter((bill) => bill && bill.total != null && bill.total !== '' && isFinite(Number(bill.total)))
    .filter((bill) => {
      const no = String(bill.no == null ? '' : bill.no).trim();
      if (!no) return true;
      if (seen.has(no)) return false;
      seen.add(no);
      return true;
    })
    .map((bill) => Number(bill.total));
}

/** the money an invoice chit states its figures in (business_json.currency, else summary_json.currency_code), upper-case, or null when it states none */
function invoiceCurrency(invoice) {
  const stated = (invoice.business_json || {}).currency || (invoice.summary_json || {}).currency_code;
  return stated ? String(stated).trim().toUpperCase() || null : null;
}

/** one carried figure as a number, or null when it is absent or not a number (null stays unknown, never 0) */
const carriedFigure = (value) => (value == null || value === '' || !isFinite(Number(value)) ? null : Number(value));

/** what the door counted, taxable and tax summed over the order's receipts from their carried input_tax; null when there is no receipt or ANY receipt carries no figure */
function receivedTax(receipts) {
  if (!receipts.length) return null;
  const parts = receipts.map((item) => ({ taxable: carriedFigure((item.input_tax || {}).taxable), tax: carriedFigure((item.input_tax || {}).tax) }));
  if (parts.some((part) => part.taxable == null || part.tax == null)) return null;
  return { taxable: parts.reduce((sum, part) => sum + part.taxable, 0), tax: parts.reduce((sum, part) => sum + part.tax, 0) };
}

/**
 * ⭐ THE MATCH'S MONEY (OPS-83): what was counted WITH tax against what they charge, through the one comparison lib/their-bill.check (FX-F10W2) — total against total,
 * both CARRIED (the door's input_tax, their invoice's stated total), nothing recomputed here. → { received_with_tax, gap, code }
 *   gap   received − invoiced in the shop's money (their-bill's gap, sign flipped; never -0), null whenever a side is unknown
 *   code  their-bill's code (agrees · round_off · apart · no_total · no_engine) plus the two this caller refuses BEFORE asking it:
 *         'currency_mismatch' (their invoice is in another money: never converted, never compared) and 'no_tax_figure' (a receipt carries no input_tax: the check would
 *         read it as 0 and call the bill apart)
 */
function matchMoney(invoice, receipts, currency) {
  const ours = receivedTax(receipts);
  const received_with_tax = ours ? theirBill.check({ taxable: ours.taxable, tax: ours.tax, currency }).ours : null;
  if (invoice.total == null) return { received_with_tax, gap: null, code: 'no_total' };
  if (invoice.currency && currency && invoice.currency !== String(currency).toUpperCase()) return { received_with_tax, gap: null, code: 'currency_mismatch' };
  if (!ours) return { received_with_tax, gap: null, code: 'no_tax_figure' };
  const verdict = theirBill.check({ total: invoice.total, taxable: ours.taxable, tax: ours.tax, currency });
  return { received_with_tax, gap: verdict.gap == null ? null : verdict.gap === 0 ? 0 : -verdict.gap, code: verdict.code };
}

/** the number an invoice chit carries: the same reading as lib/books-hooks receiptFacts, else its chit id */
function invoiceNo(invoice) {
  const business = invoice.business_json || {};
  return String(business.bill_no || business.invoice_no || business.doc_no || invoice.chit_id);
}

/**
 * OPS-351 · the lines of THE invoice that bills this order, or null: more than one invoice, copies that disagree (pickOf agree false), no lines (a total-only bill) and a bill keyed at the door
 * all leave the billed quantity unknown. Carried as the supplier wrote them (quantity · unit · particulars); nothing is converted or recomputed here.
 */
function billedLines(head, invoices) {
  const billing = billingInvoices(head, invoices);
  if (billing.length !== 1 || !counterBill.pickOf(billing[0]).agree) return null;
  return Array.isArray(billing[0].line_items) && billing[0].line_items.length ? billing[0].line_items : null;
}

/**
 * OPS-351 · join the invoice's lines to the order's by the EXACT name (the join doorReason uses; the supplier's item ids are their own catalogue, so none joins).
 * → { byLine: Map(line_id → { qty, unit, unit_differs }), unmatched }. A line gets NO entry (billed stays null: unknown, never 0) when its name is duplicated on either side,
 * the invoice names no such line, or the quantity is not a positive number. A unit that is not the ordered one (units.sameUnit; blank = as ordered) gives unit_differs: no conversion
 * is guessed. `unmatched` counts the invoice lines naming no order line: said, never judged.
 */
function billedByLine(orderLines, invoiceLines) {
  const byLine = new Map();
  if (!invoiceLines) return { byLine, unmatched: 0 };
  const unmatched = invoiceLines.filter((bill) => !namedIn(orderLines, lineName(bill))).length;
  for (const ordered of orderLines) {
    const billed = billedFor(ordered, orderLines, invoiceLines);
    if (billed) byLine.set(ordered.line_id, billed);
  }
  return { byLine, unmatched };
}

/** the name a line is joined on: exact, as written (the door's own join) */
const lineName = (line) => String(line.particulars || line.name || '');
const namedIn = (list, name) => list.filter((line) => lineName(line) === name).length;

/** one order line's billed figure { qty, unit, unit_differs }, or null when it is unknown: no name, the name twice on either side, no invoice line, or a quantity that is not a positive number */
function billedFor(ordered, orderLines, invoiceLines) {
  const name = lineName(ordered);
  const mine = invoiceLines.filter((bill) => lineName(bill) === name);
  if (!name || namedIn(orderLines, name) !== 1 || mine.length !== 1) return null;
  const billed_qty = Number(mine[0].quantity);
  if (!isFinite(billed_qty) || billed_qty <= 0) return null;
  const unit = mine[0].unit == null ? '' : String(mine[0].unit).trim();
  return { qty: billed_qty, unit, unit_differs: !!unit && !units.sameUnit(ordered.unit || 'piece', unit) };
}

/**
 * OPS-100 · is this line a difference to chase? An excess always is; a short only once the shop has closed the order (rail status completed). While the order is open a short line
 * is the rest still to come, and one this trade absorbs (matchLine, lib/lotfields tolerance) never is. The same matchLine figures: no second compare.
 */
function countsAsDifference(item, closed) {
  if (item.billed_more) return true; /* OPS-351: billed above what was received, a difference whatever the status */
  if (item.difference === 0 || item.absorbed) return false;
  return item.difference > 0 || closed;
}

/** OPS-100 · an invoice above the goods received is a variance whatever the order's status (reason: billed more than received): the carried code and gap, nothing recomputed */
function billedMoreThanReceived(money) {
  return money.code === 'apart' && money.gap < 0;
}

/** awaited · differs · open · agreed — see matchOrder */
function matchVerdict(lines, differences, money, closed) {
  if (lines.some((item) => item.billed_more)) return 'differs'; /* OPS-351 (Oracle Qty Rec hold, SAP DQ/DW keys): billed more than received, even when nothing has arrived: before 'awaited' */
  if (lines.every((item) => item.received === 0 && !item.counted_in_another_unit)) return 'awaited';
  if (differences || lines.some((item) => item.state === 'other_unit')) return 'differs';
  if (!closed && lines.some((item) => item.received < item.ordered)) return billedMoreThanReceived(money) ? 'differs' : 'open';
  return money.code === 'apart' || money.code === 'currency_mismatch' ? 'differs' : 'agreed'; /* a round-off or an unknown figure is not a difference */
}

/** one ordered line beside what was received: the difference, the reason the door gave, and whether this trade absorbs it */
function matchLine(item, progress, receipts, tolerance, bill) {
  const ordered = Number(item.quantity) || 0;
  const received = receivedOf(progress, item);
  const otherUnits = otherUnitsOf(progress, item);
  const diff = (Math.round(received * 1000) - Math.round(ordered * 1000)) / 1000; /* RAIL-1128 N5: integer thousandths, no float subtraction */
  /* ⭐ THE SAME TOLERANCE THE DOOR APPLIED (lib/lotfields, one definition for both ends). A difference this trade absorbs is
     not a difference to chase — and both figures still show, because tolerance decides what is worth a conversation, never
     what is true. */
  const absorbed = diff !== 0 && lotfields.withinTolerance(diff, ordered, item.unit, tolerance);
  const billed = billedFigures(bill, received, ordered, item.unit, tolerance);
  return {
    line_id: item.line_id,
    name: item.particulars || item.name || '',
    unit: item.unit || 'piece',
    rate: item.price == null ? null : Number(item.price),
    ordered,
    received,
    ...billed,
    difference: diff,
    reason: doorReason(item, receipts),
    absorbed,
    ...(otherUnits.length ? { counted_in_another_unit: true, other_units: otherUnits } : {}),
    state: lineState(diff, received, absorbed, otherUnits.length > 0)
  };
}

/** the billed keys of a line: `billed` (null = unknown) · `billed_unit` only when the units differ · `billed_more` only when billed is above received outside the trade's tolerance (OPS-351) */
function billedFigures(bill, received, ordered, unit, tolerance) {
  const billed = bill && !bill.unit_differs ? bill.qty : null;
  const more = billed != null && billed > received && !lotfields.withinTolerance(billed - received, ordered, unit, tolerance);
  return { billed, ...(bill && bill.unit_differs ? { billed_unit: bill.unit } : {}), ...(more ? { billed_more: true } : {}) };
}

/** how much of the line has been received, from the delivery events (lib/deliverline progress) */
function receivedOf(progress, item) {
  const delivered = progress && progress.get ? progress.get(item.line_id) : null;
  return delivered && delivered.delivered != null ? Number(delivered.delivered) : 0;
}

/**
 * OPS-87: what was counted in a unit other than the ordered one - lib/deliverline keeps it beside the total (other_units), never summed into it,
 * so the match says so instead of reading it as nothing received. → [{ unit, mine, theirs }], [] when none. No conversion is guessed: a person settles it.
 */
function otherUnitsOf(progress, item) {
  const entry = progress && progress.get ? progress.get(item.line_id) : null;
  return entry && Array.isArray(entry.other_units) ? entry.other_units : [];
}

/** agreed · awaited · short · excess · other_unit (goods counted in another unit: neither awaited nor settled) */
function lineState(diff, received, absorbed, otherUnit) {
  if (otherUnit && received === 0) return 'other_unit';
  if (diff === 0) return received > 0 ? 'agreed' : 'awaited';
  if (absorbed) return 'agreed';
  return diff < 0 ? 'short' : 'excess';
}

/** the reason the person at the door gave, carried on the receipt's own line (the last one given) */
function doorReason(item, receipts) {
  let reason = null;
  for (const receipt of receipts) {
    for (const line of receipt.lines) {
      const lineData = line.item_data || {};
      const sameLine = lineData.line_id === item.line_id || line.particulars === (item.particulars || item.name);
      if (sameLine && lineData.reason) reason = lineData.reason;
    }
  }
  return reason;
}

module.exports = { matchSeen, matchOrders, matchMoney };
