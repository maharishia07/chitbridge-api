// FLOW      the shop's books for a period ──▶ one real check per kind ──▶ todo() ──▶ [{ kind, count, words, action }]; endedMonths() names the months that have ended
// @stage tested
// OWNS  the books to-do: what a period still needs before it closes (unposted · unmatched · unpaid), in the shop's words.
// CALLED BY routes/books.js (GET /todo) and the Home facts.
// CARD 16-finance/books-todo
// @stage-note [BOOKS v2] The To-do feed for CB Accounts' home: GET /api/books/todo → [{ kind, count, words, action }], each from a real check of the books.
'use strict';
const CLOCK = require('./shop-clock');
/**
 * lib/books-todo.js — WHAT THE OWNER HAS TO DO NEXT, READ FROM THE BOOKS (docs/design/cb-accounts-ia in chitbridge-web; the page only draws it).
 *
 * ⭐ ONLY A THING THAT NEEDS DOING EARNS A ROW (DECISIONS, the interface): a kind with nothing to do is left out, not shown as "0".
 * ⭐ EVERY ROW CARRIES ITS BUTTON: `action` = { label, screen, call } — what to press, the CB Accounts screen it opens, and the API call behind it.
 * ⭐ NOTHING IS COMPUTED HERE THAT AN ENGINE OWNS: the GST due date is gst-returns.dueDate, what is owed is the GST close's own balance read; the months are accounts-packs' periodRange; whether a
 *   year may close is the period engine's question (books.yearState); a reversal day is books-period's reversalDate. This file reads and counts.
 * ⭐ THE SHOP'S DAY, not the server's (books-hooks dayOf), decides "ended" and "overdue".
 * Kinds: entries_to_ok (SHOPBK-B: the Bookkeeper's entries, or an adviser's reviewed ones, waiting for the OWNER's OK: the ONE queue read, lib/books-action.waitingForOwner) · bills_to_accept · suppliers_to_add · bills_unrated · zero_kind_unanswered · bills_not_in_books · cash_bills_waiting · advices_to_send · months_not_locked · closing_stock_missing · gst_due · recurring_due · accrual_reversals_due · year_close_possible.
 * ⭐ cash_bills_waiting (ACC-199, lifecycle S10-2): the walk-in bills paid in cash that only join the books at the day close — said, never silent. Count and sum
 *   come from books-hooks waitingWalkIns, the same fold postDay posts (the engine's daySummary adds; nothing is added here); the currency is the shop's, the day its zone's.
 * ⭐ bills_not_in_books (ACC-342): a saved bill past the 2-minute grace with no entry and no Waiting row (the hook died and the park failed too) — the owner's word for what /health
 *   calls books_unposted. The COUNT is books-reconcile unpostedOf (the one predicate: a chit already shown as a Waiting row is not counted twice); the pass re-posts it by itself, so this one row carries NO button (the Waiting retry walks parked rows only).
 * ⭐ advices_to_send (M30, SPEC-payments §4.7): a payment to a party ON the rail with no advice sent or shared — the other side does not know
 *   you paid (silence is the bug). Counted only once b285's columns exist (books-store adviceReady); before that the kind is left out.
 * ⭐ bills_unrated (F5 A1, critic 10; Athi 24 Oct (c)): a sale bill in the books whose line carries NO rate, in a shop that CHARGES its tax
 *   (tax-shelf.chargesTax — never "has a GSTIN"; a composition shop lists none) — such a line would file as nil-rated in GSTR-1 table 8.
 *   LISTED, never changed: the shop's CA decides (credit note and reissue, or a correction in the return). The words are the pack's.
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');
const Evidence = require('./books-evidence');
const R = require('./books-recurring');
const taxShelf = require('./tax-shelf');

const KINDS = [
  'entries_to_ok',
  'entries_returned',
  'bills_to_accept',
  'evidence_gaps',
  'suppliers_to_add',
  'bills_unrated',
  'zero_kind_unanswered',
  'bills_not_in_books',
  'cash_bills_waiting',
  'advices_to_send',
  'months_not_locked',
  'closing_stock_missing',
  'return_overdue',
  'gst_due',
  'recurring_due',
  'accrual_reversals_due',
  'year_close_possible'
];
const ymd = (v) => E.ymd(v);
/** the To do line for the evidence counts: only the parts that are above nothing, in the strip's own words */
function evidenceWords(gaps) {
  const part = (n, words) => (n > 0 ? n + ' ' + words : null);
  const list = [part(gaps.no_tax_invoice, 'with no tax invoice'), part(gaps.no_file, 'with no file'), part(gaps.no_source, 'with no source'), part(gaps.open_queries, 'with an open query')].filter(Boolean);
  return 'Entries this year: ' + list.join(' · ') + '. Open the Day book to see each one.';
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWord = (iso) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
const dayWord = (iso) => Number(iso.slice(8, 10)) + ' ' + MONTH_NAMES[Number(iso.slice(5, 7)) - 1].slice(0, 3);

/** the months that have ended, this year and the one before (only years the books hold): [{ fy, period, start, end, status }] */
async function endedMonths(h, entity, pack, today) {
  const A = E.packs(),
    cur = A.fiscalYearOf(today, pack),
    prev = A.fiscalYearOf(B.addDays(A.fyRange(cur, pack).start, -1), pack);
  const out = [];
  for (const fy of [prev, cur]) {
    for (const r of await S.periods(h, entity, fy)) {
      if (Number(r.period) < 1) continue;
      const end = ymd(r.end_date);
      if (end && end < today) out.push({ fy, period: Number(r.period), start: ymd(r.start_date), end, status: r.status });
    }
  }
  return out.sort((first, second) => (first.end < second.end ? -1 : 1));
}

/**
 * F5 A1 · the sale bills in the books with a line nobody rated, from `from` to `day` — ONLY where the shop charges its tax (tax-shelf.chargesTax:
 * registration + tax id, never "has a GSTIN"; a composition shop answers none). A read: the bills stay as issued. → store rows, newest first
 */
async function unratedBillsOf(handle, entity, setting, from, until) {
  if (!(await require('./books-period').shopChargesTax(handle, entity, setting))) return [];
  return S.unratedSaleBills(handle, entity, from, until, 50);
}
/** the bills_unrated row: a line with no rate files as nil-rated on the return (critic 10) — listed, never changed; the shop's CA decides (Athi, 24 Oct) */
function addUnrated(addRow, unrated, setting) {
  const bills = unrated || [],
    taxWord = taxShelf.taxWordOf(setting && setting.country);
  addRow(
    'bills_unrated',
    bills.length,
    plural(bills.length, 'bill has', 'bills have') +
      ' a line with no ' +
      taxWord +
      ' rate. The bills stay as issued: set the rate on the product, and ask your CA what to do about these bills.',
    { label: 'See the bills', screen: 'gst', call: 'GET /api/books/todo' },
    bills.map((item) => ({ chit_id: item.chit_id, ref: item.printed_as || item.bill_no || null, date: item.posting_date, unrated_lines: item.unrated, lines: item.lines, items: item.items || [] }))
  );
}
/**
 * the zero_kind_unanswered row (supply kind, AE-F-11; Athi 21 Nov, India Q2: ask the owner): the catalogue's 0% slabs and items that name no kind (the pack's own question, never a default). ONE read
 * (books-store zeroRateKindless, the same one the return's needs_answer note uses); a shop that charges no tax, or a pack with no such question, lists nothing. The button opens the catalogue.
 */
async function zeroKindOf(handle, entity, setting, pack) {
  const row = require('./supply-kind').unknownKindRowOf(pack);
  if (!row || !(await require('./books-period').shopChargesTax(handle, entity, setting))) return null;
  const waiting = await S.zeroRateKindless(handle, entity);
  return waiting.slab_count + waiting.item_count > 0 ? { row, waiting, country: pack.id } : null;
}
/** the zero_kind_unanswered row: how many 0% slabs and products have no kind, the pack's question, and the button to the catalogue */
function addZeroKind(addRow, found) {
  if (!found) return;
  const count = found.waiting.slab_count + found.waiting.item_count;
  addRow(
    'zero_kind_unanswered',
    count,
    plural(count, 'tax rate or product is', 'tax rates and products are') + ' at 0% with no kind. ' + found.row.ask + ' Until you answer, a sale at 0% is not filed under any of them.',
    { label: 'Answer in the catalogue', screen: 'catalogue', call: 'GET /api/books/todo' },
    found.waiting.slabs.map((slab) => ({ id: slab.id, name: slab.name, suggested: require('./supply-kind').suggestFromName(slab.name, found.country) }))
  );
}
/** the money_unbalanced row (ACC-206 B): sales the owner let through although the money did not add up — loud and open until someone resolves each; a filter on stored data, no arithmetic */
function addMoneyUnbalanced(addRow, held) {
  const sales = held || [];
  addRow(
    'money_unbalanced',
    sales.length,
    plural(sales.length, 'sale was', 'sales were') + ' let through although the money did not add up. Check each one: confirm it is right, or issue a credit note or a corrected bill.',
    { label: 'Check the sales', screen: 'todo', call: 'POST /api/books/money-check/resolve' },
    sales.map((item) => ({ chit_id: item.chit_id, ref: item.ref, step: item.step, unexplained_minor: item.unexplained_minor, words: item.words, by: item.by, at: item.at, why: item.why }))
  );
}
/** the bills_not_in_books row (ACC-342): a saved bill the books have not taken and nothing has parked — the 30-second pass is already trying it again; the owner is told, not left to find /health */
function addNotInBooks(addRow, count) {
  addRow(
    'bills_not_in_books',
    count,
    plural(count, 'bill is', 'bills are') + ' not in your books yet. They are tried again on their own about every minute; if a bill stays here, tell support.'
  ); /* no button: the Waiting retry walks parked rows only and this kind has none — the pass is the retry */
}
/** the rows about bills: those the books have not taken (ACC-342), the unrated lines (F5) and the sales let through unbalanced (ACC-206 B) */
function addBillRows(addRow, read, setting) {
  addNotInBooks(addRow, read.unposted);
  addUnrated(addRow, read.unrated, setting);
  addZeroKind(addRow, read.zeroKind);
  addMoneyUnbalanced(addRow, read.overridden);
}
/** the cash_bills_waiting row (ACC-199): the cash walk-in bills not yet in the books, and the day close that posts them — the shop's own currency, named by its code */
function addCashWaiting(addRow, waiting) {
  if (!waiting) return;
  addRow(
    'cash_bills_waiting',
    waiting.bills,
    plural(waiting.bills, 'cash bill', 'cash bills') +
      ' · ' +
      require('./money').format({ amount: waiting.amount, currency: waiting.currency }) +
      (waiting.bills === 1 ? ' waits' : ' wait') +
      " for today's day close. Close the day at the counter and they join the books.",
    { label: 'Close the day', screen: 'till', call: 'POST /api/chits/send' },
    (waiting.days || []).map((item) => ({ counter: item.counter, day: item.day, bills: item.bills }))
  );
}
/** the months_not_locked row. FX-UX1 (F2): a month before the one the ledger went on (books_setting.enabled_at, the shop's day) has no books — it is not "open", never work */
function addMonthsNotLocked(addRow, months, setting) {
  const began = setting && setting.enabled_at ? require('./books-hooks').dayOf(setting.enabled_at, setting) : null,
    firstMonth = began ? began.slice(0, 7) + '-01' : '';
  const open = months.filter((item) => item.status === 'open' && item.end >= firstMonth);
  addRow(
    'months_not_locked',
    open.length,
    plural(open.length, 'month is', 'months are') +
      ' over but still open: ' +
      open
        .slice(0, 4)
        .map((item) => monthWord(item.end))
        .join(', ') +
      (open.length > 4 ? ' and more' : '') +
      '. Lock each once its books are done, so nothing changes behind you.',
    { label: 'Lock the months', screen: 'periods', call: 'POST /api/books/periods/:fy/:period/lock' },
    open.map((item) => ({ fiscal_year: item.fy, period: item.period, month: item.end.slice(0, 7) }))
  );
}

/** the India GST line: what the books still owe on the last month that ended (null when nothing is owed, the shop is not India, or no month ended) */
async function gstLine(handle, entity, shop, pack, last, dayText) {
  if (String((shop && shop.country) || '').toUpperCase() !== 'IN' || !last) return null;
  /* GOV-AU1: India's GST line only for a shop stated as India */
  /* ACC-336: what the period still owes is the CLOSE'S own figure — a closed month from the figures its entry carried less the payments named for it since; an open one from the close's
     calculation over the payments the period NAMES. No date rule here: a challan paid on the 18th for last month counts the day it is posted. Where the payments cannot be read
     (the carrier columns not applied, a payment with no period) the old read stands: the whole balance less the challans posted since the month ended. */
  const periods = require('./books-period');
  let owed;
  const still = await periods.gstStillOwed(handle, entity, shop, periods.closeSpan(shop, { fy: last.fy, period: last.period }, pack));
  if (still) owed = still.still_minor;
  else {
    const g = await periods.gstBalances(handle, entity, last.end, null, pack);
    const stood = ['cgst', 'sgst', 'igst', 'cess'].reduce((total, item) => total + g.output[item], 0) + g.rcm.cgst + g.rcm.sgst + g.rcm.igst;
    const paid = (await S.entries(handle, entity, B.addDays(last.end, 1), dayText))
      .filter((x) => x.event_type === 'gst_payment')
      .reduce((total, x) => total + Number(x.total_minor || 0), 0);
    owed = stood - paid;
  }
  if (owed > 0) {
    const month = last.end.slice(0, 7),
      nestedDue = require('./gst-returns').dueDate(month);
    return { fy: last.fy, period: last.period, month, due: nestedDue, overdue: nestedDue < dayText, owed_minor: owed };
  }
  return null;
}
/**
 * holdsStock - does this shop hold counted stock up to a day? THE DATA DECIDES, not the trade: a plumber with no stock movement is never asked for a closing stock.
 * The ONE read is the stock ledger's own (stock-store.asAt, counted_only: a made-to-order dish is not stock), the one books-period.ledgerValue values from.
 * No ledger on this server (b214 not run) reads as "holds none": the ask is dropped, never a made-up figure.
 */
async function holdsStock(handle, entity, shop, day) {
  if (!(await require('./schema').hasTable('stock_movement'))) return false;
  const until = require('./books-hooks').dayBounds(day, shop).to;
  const shelf = await require('./stock-store').asAt(entity, (e, fn) => fn(handle), until, { counted_only: true });
  return shelf.rows.length > 0;
}
/** the last ended month, when it had business, no closing stock was recorded and the shop holds counted stock: the month the To do asks a closing stock for; else null */
async function closingStockGap(handle, entity, shop, last) {
  const rows = await S.entries(handle, entity, last.start, last.end);
  const active = rows.some((x) => /^(sale_bill|purchase_bill|walkin_day|expense|other_income)$/.test(String(x.event_type)));
  if (!active || rows.some((x) => x.event_type === 'closing_stock')) return null;
  return (await holdsStock(handle, entity, shop, last.end)) ? last : null;
}
/** the year just ended, once its twelve months are locked and the engine says it can close; else null */
async function yearReadyToClose(handle, entity, previousYear) {
  const monthRows = (await S.periods(handle, entity, previousYear)).filter((item) => Number(item.period) >= 1);
  if (monthRows.length < 12 || !monthRows.every((item) => item.status !== 'open') || monthRows.every((item) => item.status === 'hard_locked')) return null;
  const state = await B.yearState(handle, entity, previousYear);
  return state.can_close && !state.closed ? previousYear : null;
}
/** W15-102: the Day book's evidence counts over this year — the SAME counts the strip shows; a read that fails leaves this one line out (null), never the whole to-do */
async function evidenceCounts(handle, entity, shop, pack, day) {
  const yearSpan = E.packs().fyRange(E.packs().fiscalYearOf(day, pack), pack);
  await handle.query('SAVEPOINT todo_attention'); /* a failed read must not abort the to-do's own transaction */
  try {
    const counts = await Evidence.attentionIn(handle, entity, { pack, cur: B.curOf(shop) }, yearSpan.start, day > yearSpan.end ? yearSpan.end : day, null, null);
    await handle.query('RELEASE SAVEPOINT todo_attention');
    return counts;
  } catch (err) {
    await handle.query('ROLLBACK TO SAVEPOINT todo_attention').catch(require('./logger').orElse('books todo: the rollback after the evidence read failed', undefined));
    require('./logger').fellBack('books todo: the evidence counts could not be read — the line is left out', err);
    return null;
  }
}
/** SHOPBK-B: the entries waiting for the owner's OK (the maker-checker queue, state waiting_accept): one row, each item carrying what the owner needs to Accept or Return it — the amount WITH its currency, who prepared it, what it says */
function addEntriesToOk(addRow, held) {
  const list = (held && held.actions) || [];
  addRow(
    'entries_to_ok',
    held ? held.total : 0,
    plural(held ? held.total : 0, 'entry is', 'entries are') + ' waiting for your OK. Accept it and it posts; return it with a note and nothing is posted.',
    { label: 'Open the entries', screen: 'daybook', call: 'POST /api/books-actions/:id/accept' },
    list.map((item) => ({ action_id: item.action_id, store_id: item.store, kind: item.kind, body_hash: item.body_hash, total_minor: item.total_minor, currency: item.currency, ref: item.client_ref, narration: (item.body && item.body.narration) || null, by: item.prepared ? item.prepared.name : null, at: item.prepared ? item.prepared.at : null }))
  );
}
/** SHOPBK-B: the Bookkeeper's OWN entries the owner returned (last 14 days), each with the owner's note; only asked for the Bookkeeper seat, so it never shows to the owner */
function addEntriesReturned(addRow, back) {
  const list = (back && back.actions) || [];
  addRow(
    'entries_returned',
    back ? back.total : 0,
    plural(back ? back.total : 0, 'entry was', 'entries were') + ' sent back to you. Read the note, fix it and save it again. Nothing was posted.',
    { label: 'Open the Day book', screen: 'daybook', call: 'POST /api/books/events' },
    list.map((item) => ({ action_id: item.action_id, kind: item.kind, total_minor: item.total_minor, currency: item.currency, narration: (item.body && item.body.narration) || null, note: item.closed ? item.closed.reason : null, by: item.closed ? item.closed.name : null, at: item.closed ? item.closed.at : null }))
  );
}
/** the Waiting list's own rows: supplier bills to accept, bills naming a supplier to add (FX-F10W), and the Day book's evidence gaps (W15-102) */
function addWaitingRows(addRow, read) {
  addRow(
    'bills_to_accept',
    read.counts.accept,
    plural(read.counts.accept, 'supplier bill is', 'supplier bills are') + ' waiting for you to confirm the goods. Confirm them and they post.',
    { label: 'Open the bills', screen: 'waiting', call: 'GET /api/books/health' },
    read.waiting.map((item) => ({ id: item.id, chit_id: item.source_chit_id || null, ref: item.source_ref || null }))
  );

  /* FX-F10W: a bill naming a supplier the books do not know — the Waiting row asks "Is this …?" (its candidates) or adds them */
  addRow(
    'suppliers_to_add',
    read.counts.add_supplier,
    plural(read.counts.add_supplier, 'bill names a supplier', 'bills name suppliers') +
      ' the books do not know. Pick yours, or add them, and the bill waits for you to accept it.',
    { label: 'Open the bills', screen: 'waiting', call: 'PUT /api/chits/:id/use' },
    read.toAdd.map((item) => ({ id: item.id, chit_id: item.source_chit_id || null, ref: item.source_ref || null }))
  );

  const gaps = read.attention || {};
  addRow(
    'evidence_gaps',
    (gaps.no_tax_invoice || 0) + (gaps.no_file || 0) + (gaps.no_source || 0) + (gaps.open_queries || 0),
    evidenceWords(gaps),
    { label: 'See them', screen: 'daybook', call: 'GET /api/books/attention' },
    []
  );
}
/** M30: the payments with no advice yet — one line, and the rows to send */
function addAdvicesToSend(addRow, advices) {
  const adv = advices || [],
    first = adv[0];
  addRow(
    'advices_to_send',
    adv.length,
    adv.length === 1
      ? '1 payment has no advice yet — ' + (first.name || 'the other side') + ' does not know you ' + (first.direction === 'out' ? 'paid' : 'received it') + '.'
      : adv.length + ' payments have no advice yet — the other side does not know.',
    { label: 'Send advice', screen: 'ledgers', call: 'PATCH /api/books/payments/:id' },
    adv.map((item) => ({
      payment_id: item.payment_id,
      party_id: item.party_id,
      name: item.name || null,
      direction: item.direction,
      amount_minor: item.amount_minor,
      currency: item.currency,
      received_at: ymd(item.received_at)
    }))
  );
}
/** the last ended month with business and no closing stock recorded: one row naming it */
function addClosingStockMissing(addRow, missing) {
  if (!missing) return;
  addRow(
    'closing_stock_missing',
    1,
    'No closing stock for ' + monthWord(missing.end) + ' yet. Count the stock and enter its value, so profit is right.',
    { label: 'Enter closing stock', screen: 'closing-stock', call: 'POST /api/books/closing-stock' },
    [{ fiscal_year: missing.fy, period: missing.period, date: missing.end }]
  );
}
/**
 * YE-F-07 · the returns (BAS) whose due day has passed and the books do not hold closed (lib/return-overdue, the one rule the firm's row reads too): closed = its tax close posted, its months locked, or its year closed.
 * ChitBridge records no lodgement, so the words say "not closed in the books" — the owner closes the period (or the year, with the returns declared lodged) to clear it.
 */
async function overdueReturnsOf(handle, entity, setting, pack, shopDay) {
  const R = require('./return-overdue'),
    rows = await S.periods(handle, entity, null),
    states = await require('./books-period').returnStatesFor(handle, entity, setting, rows),
    marked = B.markBeforeBooks(rows, B.booksLockLine(rows, await S.periodFigures(handle, entity, null)).books_start),
    closed = new Set(),
    byMonths = R.closedByMonths(marked);
  for (const state of states.values()) for (const period of state.periods || []) if (period.closed) closed.add(period.period);
  return R.overdueReturns(pack, shopDay, Array.from(new Set(rows.map((row) => row.fiscal_year))), (item) => closed.has(item.period) || byMonths(item));
}
/** the overdue-return row: the oldest named with its due day, the rest counted */
function addReturnOverdue(addRow, overdue) {
  if (!overdue || !overdue.length) return;
  const first = overdue[0];
  addRow(
    'return_overdue',
    overdue.length,
    first.form + ' ' + first.label + ' was due ' + dayWord(first.due) + ' ' + first.due.slice(0, 4) + ' and is not closed in the books' + (overdue.length > 1 ? ' — and ' + (overdue.length - 1) + ' more' : '') + '. Close the period, or lodge it and say so when you close the year.',
    { label: 'Open ' + first.form, screen: 'gstclose', call: 'POST /api/books/gst/close' },
    overdue.map((item) => ({ period: item.period, label: item.label, due: item.due, days_late: item.days_late }))
  );
}
/** what the books still owe in GST on the last ended month: one row with the due date */
function addGstDue(addRow, owed) {
  if (!owed) return;
  addRow(
    'gst_due',
    1,
    'GST for ' +
      monthWord(owed.month + '-01') +
      ' is still to pay, due by ' +
      dayWord(owed.due) +
      (owed.overdue ? ' — that day has passed' : '') +
      '. Close the month, then pay by challan.',
    { label: 'Close GST', screen: 'gst', call: 'POST /api/books/gst/close' },
    [owed]
  );
}
/** the repeating entries due and the accruals due to turn back (auto only when the flag lets it: otherwise the row reads "ask me") */
async function addRecurringRows(addRow, entity, shop, shopDay) {
  const due = await R.dueOn(entity, shopDay),
    autoOn = await R.autoPostOn(entity);
  addRow(
    'recurring_due',
    due.length,
    plural(due.length, 'repeating entry is', 'repeating entries are') +
      ' due: ' +
      due
        .slice(0, 3)
        .map((item) => item.name)
        .join(', ') +
      (due.length > 3 ? ' and more' : '') +
      '. Accept each to post it, or skip it.',
    { label: 'Review', screen: 'recurring', call: 'POST /api/books/recurring/:id/post' },
    due.map((item) => ({ recurring_id: item.recurring_id, name: item.name, due: item.next_on, auto: item.auto && autoOn }))
  );
  const reversals = await R.reversalsDue(entity, shop, shopDay);
  addRow(
    'accrual_reversals_due',
    reversals.length,
    plural(reversals.length, 'accrual is', 'accruals are') +
      ' due to turn back: ' +
      reversals
        .slice(0, 3)
        .map((item) => item.ref)
        .join(', ') +
      (reversals.length > 3 ? ' and more' : '') +
      (autoOn ? '. The nightly run posts them; press to do it now.' : '. Press each to turn it back.'),
    { label: 'Reverse now', screen: 'accruals', call: 'POST /api/books/accruals/:ref/reverse' },
    reversals
  );
}
/** the year just ended, when it can be closed: one row with the call */
function addYearClose(addRow, year) {
  if (!year) return;
  addRow(
    'year_close_possible',
    1,
    'Financial year ' + year + ' can be closed: every month is locked, Suspense is nil and the books balance. Closing carries it forward and locks it for good.',
    { label: 'Close the year', screen: 'year-close', call: 'POST /api/books/year/' + year + '/close' },
    [{ fiscal_year: year }]
  );
}
/**
 * todo(entity, s, today?) → [{ kind, count, words, action, items? }] — in the order a person works through them.
 * `items` (where a kind has a few things to name) lists them: the months, the references, the templates.
 */
async function todo(entity, s, today, bookkeeperId) {
  const shopDay = today || CLOCK.today(s); /* the shop's shopDay (dayOf of a moment is never null) */
  const pack = B.packOf(s),
    A = E.packs(),
    items = [];
  const add = (kind, count, words, action, list) => {
    if (count > 0) items.push(Object.assign({ kind, count, words }, action ? { action } : {}, list && list.length ? { items: list } : {})); /* a row with no button carries no `action` key (bills_not_in_books) */
  };

  const read = await require('../db').withEntity(entity, async (h) => {
    const months = await endedMonths(h, entity, pack, shopDay);
    /* STD1: the COUNT is the one count (books-store waitingCount, GROUP BY todo over every open row — Home, the Accounts card and /health say it);
       the items are a page of the rows behind it (their `todo` is the row's data) */
    const counts = await S.waitingCount(h, entity),
      wrows = await S.waiting(h, entity, 200);
    const waiting = wrows.filter((item) => item.todo === 'accept'),
      toAdd = wrows.filter((item) => item.todo === 'add_supplier');
    /* the last ended month, and whether anything happened in it / a closing stock or a GST close was recorded */
    const last = months.length ? months[months.length - 1] : null;
    const closingMissing = last ? await closingStockGap(h, entity, s, last) : null;
    /* GST: what the books still owe on the last month that ended — the output tax (and any reverse-charge tax) not yet paid by a challan, read from the
       same balances the GST close reads (books-period gstBalances). It is the whole balance, so an older month left unpaid is inside it. */
    const gst = await gstLine(h, entity, s, pack, last, shopDay);
    const overdue = await overdueReturnsOf(h, entity, s, pack, shopDay);
    /* the year just ended: only worth asking the engine once its twelve months are locked */
    const cur = A.fiscalYearOf(shopDay, pack),
      prev = A.fiscalYearOf(B.addDays(A.fyRange(cur, pack).start, -1), pack);
    const year = await yearReadyToClose(h, entity, prev);
    /* M30: payments with no advice yet, to parties who could receive one — one read, only once b285 is in */
    const advices = (await S.adviceReady(h, entity)) ? await S.paymentsNeedingAdvice(h, entity, 50) : [];
    const attention = await evidenceCounts(h, entity, s, pack, shopDay);
    return { returned: bookkeeperId ? await require('./books-action').returnedFor(h, entity, bookkeeperId, 20, shopDay) : null, held: await require('./books-action').waitingForOwner(h, entity, 50), attention, months, waiting, toAdd, counts, closingMissing, gst, overdue, year, advices, unrated: await unratedBillsOf(h, entity, s, A.fyRange(prev, pack).start, shopDay), zeroKind: await zeroKindOf(h, entity, s, pack), overridden: await S.moneyOverrides(h, entity, 50), unposted: await require('./books-reconcile').unpostedOf(h, entity, s) };
  });

  addEntriesToOk(add, read.held);
  addEntriesReturned(add, read.returned);
  addWaitingRows(add, read);
  addBillRows(add, read, s);
  addCashWaiting(add, await require('./books-hooks').waitingWalkIns(entity, s, shopDay));
  addAdvicesToSend(add, read.advices);
  addMonthsNotLocked(add, read.months, s);
  addClosingStockMissing(add, read.closingMissing);
  addReturnOverdue(add, read.overdue);
  addGstDue(add, read.gst);
  await addRecurringRows(add, entity, s, shopDay);
  addYearClose(add, read.year);
  return items;
}

module.exports = { KINDS, todo, endedMonths };
