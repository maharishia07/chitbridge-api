// @stage tested
// @stage-note [BOOKS v2] The To-do feed for CB Accounts' home: GET /api/books/todo → [{ kind, count, words, action }], each from a real check of the books.
'use strict';
/**
 * lib/books-todo.js — WHAT THE OWNER HAS TO DO NEXT, READ FROM THE BOOKS (docs/design/cb-accounts-ia in chitbridge-web; the page only draws it).
 *
 * ⭐ ONLY A THING THAT NEEDS DOING EARNS A ROW (DECISIONS, the interface): a kind with nothing to do is left out, not shown as "0".
 * ⭐ EVERY ROW CARRIES ITS BUTTON: `action` = { label, screen, call } — what to press, the CB Accounts screen it opens, and the API call behind it.
 * ⭐ NOTHING IS COMPUTED HERE THAT AN ENGINE OWNS: the GST due date is gst-returns.dueDate, what is owed is the GST close's own balance read; the months are accounts-packs' periodRange; whether a
 *   year may close is the period engine's question (books.yearState); a reversal day is books-period's reversalDate. This file reads and counts.
 * ⭐ THE SHOP'S DAY, not the server's (books-hooks dayOf), decides "ended" and "overdue".
 * Kinds: bills_to_accept · advices_to_send · months_not_locked · closing_stock_missing · gst_due · recurring_due · accrual_reversals_due · year_close_possible.
 * ⭐ advices_to_send (M30, SPEC-payments §4.7): a payment to a party ON the rail with no advice sent or shared — the other side does not know
 *   you paid (silence is the bug). Counted only once b285's columns exist (books-store adviceReady); before that the kind is left out.
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');
const R = require('./books-recurring');

const KINDS = ['bills_to_accept', 'advices_to_send', 'months_not_locked', 'closing_stock_missing', 'gst_due', 'recurring_due', 'accrual_reversals_due', 'year_close_possible'];
const ymd = (v) => E.ymd(v);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWord = (iso) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
const dayWord = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3);

/** the months that have ended, this year and the one before (only years the books hold): [{ fy, period, start, end, status }] */
async function endedMonths(h, entity, pack, today) {
  const A = E.packs(), cur = A.fiscalYearOf(today, pack), prev = A.fiscalYearOf(B.addDays(A.fyRange(cur, pack).start, -1), pack);
  const out = [];
  for (const fy of [prev, cur]) {
    for (const r of await S.periods(h, entity, fy)) {
      if (Number(r.period) < 1) continue;
      const end = ymd(r.end_date);
      if (end && end < today) out.push({ fy, period: Number(r.period), start: ymd(r.start_date), end, status: r.status });
    }
  }
  return out.sort((a, b) => (a.end < b.end ? -1 : 1));
}

/**
 * todo(entity, s, today?) → [{ kind, count, words, action, items? }] — in the order a person works through them.
 * `items` (where a kind has a few things to name) lists them: the months, the references, the templates.
 */
async function todo(entity, s, today) {
  const day = today || require('./books-hooks').dayOf(new Date(), s && s.country) || new Date().toISOString().slice(0, 10);
  const pack = B.packOf(s), A = E.packs(), items = [];
  const add = (kind, count, words, action, list) => { if (count > 0) items.push(Object.assign({ kind, count, words, action }, list && list.length ? { items: list } : {})); };

  const read = await require('../db').withEntity(entity, async (h) => {
    const months = await endedMonths(h, entity, pack, day);
    const waiting = (await S.waiting(h, entity, 200)).filter((w) => (w.event && typeof w.event === 'object' ? w.event : {}).waiting === 'acceptance');
    /* the last ended month, and whether anything happened in it / a closing stock or a GST close was recorded */
    const last = months.length ? months[months.length - 1] : null;
    let closingMissing = null;
    if (last) {
      const rows = await S.entries(h, entity, last.start, last.end);
      const active = rows.some((x) => /^(sale_bill|purchase_bill|walkin_day|expense|other_income)$/.test(String(x.event_type)));
      if (active && !rows.some((x) => x.event_type === 'closing_stock')) closingMissing = last;
    }
    /* GST: what the books still owe on the last month that ended — the output tax (and any reverse-charge tax) not yet paid by a challan, read from the
       same balances the GST close reads (books-period gstBalances). It is the whole balance, so an older month left unpaid is inside it. */
    let gst = null;
    if (((s && s.country) || 'IN') === 'IN' && last) {
      const g = await require('./books-period').gstBalances(h, entity, last.end);
      const stood = ['cgst', 'sgst', 'igst', 'cess'].reduce((t, k) => t + g.output[k], 0) + g.rcm.cgst + g.rcm.sgst + g.rcm.igst;
      /* …less the challans posted since that month ended (they settle it) */
      const paid = (await S.entries(h, entity, B.addDays(last.end, 1), day)).filter((x) => x.event_type === 'gst_payment').reduce((t, x) => t + Number(x.total_minor || 0), 0);
      const owed = stood - paid;
      if (owed > 0) { const month = last.end.slice(0, 7), due = require('./gst-returns').dueDate(month); gst = { fy: last.fy, period: last.period, month, due, overdue: due < day, owed_minor: owed }; }
    }
    /* the year just ended: only worth asking the engine once its twelve months are locked */
    let year = null;
    const cur = A.fiscalYearOf(day, pack), prev = A.fiscalYearOf(B.addDays(A.fyRange(cur, pack).start, -1), pack);
    const prows = (await S.periods(h, entity, prev)).filter((r) => Number(r.period) >= 1);
    if (prows.length >= 12 && prows.every((r) => r.status !== 'open') && !prows.every((r) => r.status === 'hard_locked')) {
      const st = await B.yearState(h, entity, prev);
      if (st.can_close && !st.closed) year = prev;
    }
    /* M30: payments with no advice yet, to parties who could receive one — one read, only once b285 is in */
    const advices = (await S.adviceReady(h, entity)) ? await S.paymentsNeedingAdvice(h, entity, 50) : [];
    return { months, waiting, closingMissing, gst, year, advices };
  });

  add('bills_to_accept', read.waiting.length, plural(read.waiting.length, 'supplier bill is', 'supplier bills are') + ' waiting for you to confirm the goods. Confirm them and they post.',
    { label: 'Open the bills', screen: 'waiting', call: 'GET /api/books/health' },
    read.waiting.map((w) => ({ id: w.id, chit_id: w.source_chit_id || null, ref: w.source_ref || null })));

  const adv = read.advices || [], a0 = adv[0];
  add('advices_to_send', adv.length, adv.length === 1
    ? '1 payment has no advice yet — ' + (a0.name || 'the other side') + ' does not know you ' + (a0.direction === 'out' ? 'paid' : 'received it') + '.'
    : adv.length + ' payments have no advice yet — the other side does not know.',
    { label: 'Send advice', screen: 'ledgers', call: 'PATCH /api/books/payments/:id' },
    adv.map((p) => ({ payment_id: p.payment_id, party_id: p.party_id, name: p.name || null, direction: p.direction, amount_minor: p.amount_minor, currency: p.currency, received_at: ymd(p.received_at) })));

  const open = read.months.filter((m) => m.status === 'open');
  add('months_not_locked', open.length, plural(open.length, 'month is', 'months are') + ' over but still open: ' + open.slice(0, 4).map((m) => monthWord(m.end)).join(', ')
    + (open.length > 4 ? ' and more' : '') + '. Lock each once its books are done, so nothing changes behind you.',
    { label: 'Lock the months', screen: 'periods', call: 'POST /api/books/periods/:fy/:period/lock' },
    open.map((m) => ({ fiscal_year: m.fy, period: m.period, month: m.end.slice(0, 7) })));

  if (read.closingMissing) {
    const m = read.closingMissing;
    add('closing_stock_missing', 1, 'No closing stock for ' + monthWord(m.end) + ' yet. Count the stock and enter its value, so profit is right.',
      { label: 'Enter closing stock', screen: 'closing-stock', call: 'POST /api/books/closing-stock' }, [{ fiscal_year: m.fy, period: m.period, date: m.end }]);
  }

  if (read.gst) {
    const g = read.gst;
    add('gst_due', 1, 'GST for ' + monthWord(g.month + '-01') + ' is still to pay, due by ' + dayWord(g.due) + (g.overdue ? ' — that day has passed' : '') + '. Close the month, then pay by challan.',
      { label: 'Close GST', screen: 'gst', call: 'POST /api/books/gst/close' }, [g]);
  }

  const due = await R.dueOn(entity, day), autoOn = await R.autoPostOn(entity);
  add('recurring_due', due.length, plural(due.length, 'repeating entry is', 'repeating entries are') + ' due: ' + due.slice(0, 3).map((t) => t.name).join(', ')
    + (due.length > 3 ? ' and more' : '') + '. Accept each to post it, or skip it.',
    { label: 'Review', screen: 'recurring', call: 'POST /api/books/recurring/:id/post' }, due.map((t) => ({ recurring_id: t.recurring_id, name: t.name, due: t.next_on, auto: t.auto && autoOn })));     /* auto only when the flag lets it: otherwise the row reads "ask me" */

  const rev = await R.reversalsDue(entity, s, day);
  add('accrual_reversals_due', rev.length, plural(rev.length, 'accrual is', 'accruals are') + ' due to turn back: ' + rev.slice(0, 3).map((a) => a.ref).join(', ')
    + (rev.length > 3 ? ' and more' : '') + (autoOn ? '. The nightly run posts them; press to do it now.' : '. Press each to turn it back.'),
    { label: 'Reverse now', screen: 'accruals', call: 'POST /api/books/accruals/:ref/reverse' }, rev);

  if (read.year) add('year_close_possible', 1, 'Financial year ' + read.year + ' can be closed: every month is locked, Suspense is nil and the books balance. Closing carries it forward and locks it for good.',
    { label: 'Close the year', screen: 'year-close', call: 'POST /api/books/year/' + read.year + '/close' }, [{ fiscal_year: read.year }]);

  return items;
}

module.exports = { KINDS, todo, endedMonths };
