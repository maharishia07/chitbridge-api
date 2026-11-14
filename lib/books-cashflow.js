// @stage tested
// @stage-note [CB FINANCE F3] The cash position: today's cash/bank balance, then day by day what comes in (receivable dues by due date,
// @stage-note promised dates, held cheques) and goes out (payable dues, cheques written, the tax return on the pack's own due date) — and the FIRST day it goes below zero.
'use strict';
/**
 * lib/books-cashflow.js — CB FINANCE · CASH POSITION (round F3, CB-FINANCE-PLAN §4). Finance SUGGESTS, the owner decides: nothing here posts.
 *
 * ⭐ REUSE (CLAUDE.md rule 1): the dues are the receivables engine's own rows and sums — CBReceivables.outstanding (what each bill still owes, its due
 *   date, its dispute), fromItems + propose (the oldest-due-first rule, so a cheque in hand covers the bills it will settle instead of counting twice);
 *   the balance is CBLedger.balanceAsAt over books.asAtInput (the input the trial balance reads); GST is books-period.gstPayableAt (gstBalances →
 *   CBPosting.gstSetOff, the set-off the month close posts); promise dates are lib/crm-followups (the open follow-ups Dues raised); the words are
 *   bill-privacy.money and books.dateWords. ONE QUERY PER SOURCE (chart · debtor items · creditor items · cheques · parties · the ledger · follow-ups),
 *   grouped in memory — never a query per party.
 * ⭐ ONE CALCULATION (rule 2): project() is the only place a running balance is worked out. The route shapes; the screen paints it and adds nothing.
 * ⭐ NEW PATHS (rule 4): project() — no engine projects a balance forward by date; read() — gathers the sources; returnDueFor() — WHEN the tax owed falls
 *   due is the pack's own calendar (W1-FIN FIN-R4: gst-returns.dueDate for India's GSTR-3B, periodsFor for the BAS quarters and the FTA staggers — it was
 *   "the 20th" for every country); a date the pack will not guess (AE without its stagger) is null, said in words, never a 28th typed here.
 * ⭐ ONE DUE FIGURE (walk R73/R75/R76, 24 Oct): a bill's open amount is books-engines.netOpen's — net of its allocations and of the party's receipts
 *   on account — the same figure Remind (books.proposeFor due_minor) and the age buckets (/dues) read. The entries that come round (books-recurring
 *   templates) are counted on each due day in the window (recurringLines); `lowest` is always one day's closing figure.
 * OWNS  the cash position (project · read) and the api's ONE major <-> minor pair, toMinor · fromMinor (money.round + money.decimals; ACC-179 folded the copies)
 * FLOW  read() → S.accounts · S.items ×2 · S.cheques · S.parties · B.asAtInput → P.gstPayableAt · returnDueFor · promisesOf · books-recurring.templates → project() → datedSide ×2 · recurringLines · gstLine · the running balance
 * CALLED BY routes/books.js GET /api/books/cashflow (read) · lib/books-payables · books-period · books-engines · home-facts (its helpers) · tests
 * CARD 16-finance/books-cashflow
 * ⚠️ HONEST NUMBERS (cb-design §2): an overdue bill nobody has promised is NOT counted as money coming in — it is named in `uncounted` with its
 *   sentence; a disputed bill is frozen (C4) and not counted either way; a cheque counts on its date (C3: it pays nothing before it clears).
 *   An overdue payable IS counted today — you owe it now. Beyond the horizon nothing is counted and nothing is hidden: `to` says where it stops.
 * ⚠️ NO CLOCK: asOf is passed in (routes/books.js today() = the shop clock, lib/shop-clock).
 */
const engines = require('./books-engines');
const store = require('./books-store');
const books = require('./books');
const periods = require('./books-period');

/* ── dates: 'YYYY-MM-DD' ↔ a day number (no clock, no zone) — the receivables engine's own arithmetic, kept to three lines ── */
function dayNumber(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateText || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
const dayOf = (n) => engines.addDays('1970-01-01', n); /* a day number → its day, through the one day arithmetic (books-engines.addDays) */
/* ── the return calendar is the PACK's (engines gst-returns, adopted v1.39.0) — never a day typed here ─────────────────── */
const gstReturns = () => require('./gst-returns');
const INDIA_RETURN = { form: 'GSTR-3B', short: 'GST' }; /* India's pack has no `returns` block: gst-returns.periodsFor names its form; the chip's word is GST */
const BAS_DEFAULT_FREQUENCY = 'quarterly'; /* the ATO's default (GST turnover under $20m); the table itself is books-period.returnPeriods, which takes the same default (ACC-204: one table) */
const DUE_NEEDS_PERIOD = 'Due date unknown until the return period is picked under Returns.';
/** the words a screen calls this pack's return — the pack's own (`returns.id` · `returns.short`), India's from gst-returns */
function returnWords(pack) {
  const receivables = pack && pack.returns;
  if (receivables && receivables.id) return { form: receivables.id, short: receivables.short || receivables.id };
  return pack && pack.id === 'IN' ? Object.assign({}, INDIA_RETURN) : { form: null, short: 'Tax' };
}
/** the pack's period table around asOf — the ONE table (books-period.returnPeriods: the year that holds asOf and the one before; BAS quarterly unless asked monthly, AE by the stagger asked, never guessed) → { ok, periods } | { ok: false, why } */
function returnPeriodsAround(pack, asOf, opts) {
  try {
    const table = periods.returnPeriods(pack, opts || {}, asOf);
    return table.needs ? { ok: false, why: table.why } : { ok: true, periods: table.periods };
  } catch (e) {
    return { ok: false, why: e.message }; /* the engine refused the table (a frequency or stagger it does not know): the due date stays unknown, in its words */
  }
}
/**
 * ⭐ returnDueFor(pack, asOf, opts?) → { form, short, due_date, why } — WHEN what the ledgers owe at asOf falls due: the return of the period that HOLDS asOf,
 * by the pack's own calendar. IN: gst-returns.dueDate (the 20th after the month). AU: the BAS quarter's `due` (the 28th after; monthly the 21st). AE: the
 * stagger's `due` (the 28th after) — and with NO stagger (opts.stagger; nothing stores it yet) the date is null and `why` says so: it is never guessed.
 */
function returnDueFor(pack, asOf, opts) {
  const words = returnWords(pack),
    day0 = String(asOf || '').slice(0, 10);
  if (!pack || !pack.id) return Object.assign(words, { due_date: null, why: 'The shop has no country pack: no return calendar.' });
  if (!pack.returns || !pack.returns.id) {
    if (pack.id === 'IN') return Object.assign(words, { due_date: gstReturns().dueDate(day0.slice(0, 7)), why: null });
    return Object.assign(words, { due_date: null, why: 'No return is built for the ' + pack.id + ' pack yet.' });
  }
  const table = returnPeriodsAround(pack, day0, opts);
  if (!table.ok) return Object.assign(words, { due_date: null, why: DUE_NEEDS_PERIOD });
  const period = table.periods.find((item) => item.start <= day0 && day0 <= item.end) || null;
  return Object.assign(words, { due_date: period ? period.due : null, why: period ? null : 'No ' + words.short + ' period is known for ' + day0 + '.' });
}

/** the ledgers that ARE cash: the roles the India chart (and every pack) posts a receipt or a payment to — Cash · Bank · UPI · Card */
const CASH_ROLES = ['cash', 'bank', 'upi', 'card'];
const HORIZONS = [7, 30];

const money = (minor, currency) => require('./bill-privacy').money(minor, currency);
/* ⭐ THE API'S ONE major ↔ minor (ACC-179): money.round, then the CURRENCY's own decimals (money.decimals: INR 2 · JPY 0 · KWD 3) — never 100 typed.
   Called by routes/books minorOf · books postOpening · books-manual givenLines · books-hooks · books-period · move-in · finance-terms · pack-words · bill-paper.
   A copy anywhere else is a bug: call these (lazily where the caller is required by this module). */
const moneyModule = () => require('./money');
const decimalsOf = (currency) => (moneyModule().decimals ? moneyModule().decimals(currency) : 2);
const toMinor = (amount, currency) => Math.round(moneyModule().round(Number(amount), currency) * Math.pow(10, decimalsOf(currency)));
const fromMinor = (minor, currency) => moneyModule().round(Number(minor) / Math.pow(10, decimalsOf(currency)), currency);
const nameOf = (names, pid) => {
  const proposal = names && (names.get ? names.get(String(pid)) : names[String(pid)]);
  return (proposal && (proposal.nickname || proposal.name)) || 'a party';
};

/** R106: a frozen (disputed) bill is not counted but NAMED — its figure in disputed_minor, the bill itself in disputed_bills (Payables lists it so Release has a row) */
function markHeld(uncounted, ref, bill, left) {
  uncounted.disputed_minor += left;
  uncounted.disputed_bills.push({ ref, party_id: String(bill.party), amount_minor: left, due_date: bill.due_date || bill.date || null, bill_date: bill.date || null });
}
/**
 * ⭐ the dues of ONE side, dated: which open bill is expected on which day, after the held cheques have covered what they will settle.
 *   side 'in' (receivable items + cheques received) · 'out' (payable items + cheques written)
 * → { dated: [{ ref, party_id, amount_minor, date, due_date, bill_date, promised, overdue }], cheques: [{ payment_id, party_id, amount_minor, date, cheque_no, cheque_date }],
 *     uncounted: { overdue_minor, overdue_parties: Set, disputed_minor, disputed_bills: [{ ref, party_id, amount_minor, due_date, bill_date }] } }
 * The oldest-due-first coverage is CBReceivables.propose with a stand-in credit of the cheque's amount (the same way books.proposeFor previews a payment).
 */
function datedSide(side, items, cheques, promises, x) {
  const receivables = engines.receivables(),
    currency = x.currency,
    asOf = x.asOf,
    today = dayNumber(asOf);
  const rows = (items || []).filter(Boolean);
  const out = { dated: [], cheques: [], uncounted: { overdue_minor: 0, overdue_parties: new Set(), disputed_minor: 0, disputed_bills: [] } };
  const netOpen = engines.netOpen(rows); /* ⭐ THE ONE DUE FIGURE (R75): each bill net of its allocations AND the party's receipts on account (books-engines.netOpen) */
  const cover = Object.create(null);
  /* a cheque in hand (C3: it pays nothing yet) covers the bills it will settle — oldest due first, the engine's rule, never a second one */
  const held = (cheques || []).filter((item) => item.direction === (side === 'in' ? 'in' : 'out'));
  if (held.length && rows.length) {
    const view = netOpen.view,
      extra = [];
    held.forEach((item) => {
      const proposal = receivables.propose(
        view.debits,
        { id: 'pdc:' + item.payment_id, kind: 'payment', party: String(item.party_id), date: asOf, amount: fromMinor(item.amount_minor, currency), currency: currency },
        { credits: view.credits, allocations: view.allocations.concat(extra) }
      );
      if (!proposal.ok) return;
      proposal.allocations.forEach((entry) => {
        const m = toMinor(entry.amount, currency);
        cover[entry.debit] = (cover[entry.debit] || 0) + m;
        extra.push({ credit: entry.credit, debit: entry.debit, amount: entry.amount });
      });
    });
  }
  held.forEach((item) => {
    const chequeDay = dayNumber(item.cheque_date),
      expected = chequeDay === null || chequeDay < today ? today : chequeDay; /* a cheque dated before today and still in hand: expected today */
    out.cheques.push({
      payment_id: item.payment_id,
      party_id: item.party_id,
      amount_minor: Number(item.amount_minor),
      date: dayOf(expected),
      cheque_no: item.cheque_no || null,
      cheque_date: item.cheque_date || null
    });
  });
  /* a party's promise (the open follow-up Dues raised): the earliest day on or after today */
  const promise = Object.create(null);
  (promises || []).forEach((item) => {
    const expected = dayNumber(item.due_day);
    if (expected === null) return;
    const k = String(item.party_id),
      dd = expected < today ? today : expected;
    if (promise[k] == null || dd < promise[k]) promise[k] = dd;
  });
  Object.keys(netOpen.by_ref).forEach((ref) => {
    const bill = netOpen.by_ref[ref];
    if (bill.kind !== 'bill' || bill.outstanding_minor <= 0) return;
    const left = bill.outstanding_minor - (cover[ref] || 0);
    if (left <= 0) return;
    if (bill.disputed) {
      markHeld(out.uncounted, ref, bill, left);
      return;
    } /* C4: frozen until the dispute is settled */
    const dueDay = dayNumber(bill.due_date || bill.date),
      pid = String(bill.party);
    let expected = dueDay === null ? today : dueDay,
      promised = false;
    const overdue = dueDay !== null && dueDay < today;
    if (overdue) {
      if (side === 'out') expected = today; /* you owe it now */
      else if (promise[pid] != null) {
        expected = promise[pid];
        promised = true;
      } else {
        out.uncounted.overdue_minor += left;
        out.uncounted.overdue_parties.add(pid);
        return;
      } /* not counted until promised or paid */
    }
    out.dated.push({
      ref,
      party_id: pid,
      amount_minor: left,
      date: dayOf(expected),
      due_date: bill.due_date || bill.date || null,
      bill_date: bill.date || null,
      promised,
      overdue
    }); /* bill_date: F4 Payables ages and dates MSME day 45 from it */
  });
  return out;
}

/* the "＋ Entry" kinds whose cash moves on the day, and which way — an expense on credit (a supplier named) becomes a payable and is counted when it is a bill */
const RECURRING_WAY = { expense: 'out', drawings: 'out', staff_advance: 'out', other_income: 'in', capital: 'in' };
/**
 * ⭐ recurringLines(recurring, t0, tEnd) → the series items of the entries that come round (R75: rent ₹25,000 on the 1st was not in the 30-day view).
 * recurring: read()'s [{ recurring_id, name, direction: in|out, amount_minor, next_on, frequency, anchor_day, end_on }] — every due day from next_on to the
 * horizon, stepped by books-recurring.nextAfter (the ONE "next one"); a next_on already past (the sweep has not run) is expected today, as a cheque dated
 * before today is. kind recurring_in | recurring_out; ref 'rec:<id>'; no party. Nothing is read or posted here.
 */
function recurringLines(recurring, firstDay, lastDay) {
  const lines = [];
  (recurring || []).forEach((template) => {
    if (!(Number(template.amount_minor) > 0) || ['in', 'out'].indexOf(template.direction) < 0) return;
    dueDays(template, lastDay).forEach((on) =>
      lines.push({
        kind: 'recurring_' + template.direction,
        ref: 'rec:' + template.recurring_id,
        party_id: null,
        name: template.name,
        amount_minor: Number(template.amount_minor),
        date: dayOf(Math.max(dayNumber(on), firstDay)),
        due_date: on,
        promised: false,
        overdue: false,
        cheque_no: null
      })
    );
  });
  return lines;
}
/** a template's due days from next_on to lastDay — books-recurring.nextAfter is the ONE "next one"; end_on stops it; never more than 400 */
function dueDays(template, lastDay) {
  const next = require('./books-recurring').nextAfter;
  const stop = template.end_on ? Math.min(lastDay, dayNumber(template.end_on)) : lastDay;
  const days = [];
  for (let on = template.next_on; dayNumber(on) !== null && dayNumber(on) <= stop && days.length < 400; on = next(on, template.frequency, template.anchor_day)) days.push(on);
  return days;
}
/** which way a template's cash moves on its day, or null: an expense on credit (a supplier named) or with a bill's tax heads is not cash that day */
function cashWay(event) {
  const kind = String(event.kind || event.type || '');
  if (kind === 'expense' && (event.supplier || event.party_id || event.bill)) return null;
  return RECURRING_WAY[kind] || null;
}
/**
 * a template → recurringLines' row, or null when its amount is not its cash (cashWay) or it is not due. The amount is read by the builder's own
 * reader (books-period.amountOf: `amount_minor` or `amount` in the currency's units) — never re-derived.
 */
function recurringOf(template, currency) {
  const event = (template && template.event) || {},
    direction = cashWay(event);
  if (!direction || !template.active || !template.next_on) return null;
  const amount_minor = periods.amountOf(event, 'amount', currency, { optional: true });
  if (!(amount_minor > 0)) return null;
  return { recurring_id: template.recurring_id, name: template.name, direction, amount_minor, next_on: template.next_on, frequency: template.frequency, anchor_day: template.anchor_day, end_on: template.end_on || null };
}
/**
 * splitOpening(opening) → { drawer_minor, bank_minor } — WALK2 W32: today's money in the shopkeeper's two places, the cash drawer (role cash) and
 * everything else (bank · UPI · card); the two sum to project()'s opening_minor.
 */
function splitOpening(opening) {
  const sumOf = (ledgers) => ledgers.reduce((total, ledger) => total + ledger.balance_minor, 0);
  const drawer_minor = sumOf(opening.filter((ledger) => ledger.role === 'cash'));
  return { drawer_minor, bank_minor: sumOf(opening) - drawer_minor };
}
/**
 * ⭐⭐ project(x) — THE ONE CALCULATION. x: { asOf, days (7|30), currency, opening: [{ role, code, name, balance_minor }], receivable_items, payable_items,
 *   cheques: [{ payment_id, party_id, direction, amount_minor, cheque_no, cheque_date, status }] (the ones still HELD), promises: [{ party_id, due_day }],
 *   gst: { payable_minor, due_date, why } | null, names: Map(party_id → { name, nickname, party_no }),
 *   recurring: recurringOf()'s rows (the entries that come round, counted on each due day in the window — kind recurring_in | recurring_out) }
 * → { asOf, days, from, to, currency, opening_minor, drawer_minor, bank_minor, opening[], in_minor, out_minor, closing_minor, lowest: { date, balance_minor },
 *     shortfall: null | { date, short_minor, balance_minor, driver: { kind, ref, name, amount_minor } | null, words }, words,
 *     uncounted: { overdue_in_minor, overdue_parties, disputed_in_minor, disputed_out_minor, words }, gst: { payable_minor, due_date, counted, why } | null,
 *     series: [{ date, in_minor, out_minor, balance_minor, items: [{ kind: due_in | due_out | cheque_in | cheque_out | gst, ref, party_id, name, amount_minor, due_date, promised, overdue, cheque_no }] }] }
 * Every figure is an integer of minor units. The series has one row per day, today first, days long — a quiet day is a row with no items.
 */
function project(x) {
  const currency = require('./country-setup').currencyStated(x.currency),
    asOf = x.asOf,
    days = HORIZONS.indexOf(Number(x.days)) >= 0 ? Number(x.days) : 7;
  const today = dayNumber(asOf);
  if (today === null) throw Object.assign(new Error('The cash position needs asOf as YYYY-MM-DD.'), { code: 'BOOKS_BAD_REQUEST' });
  const tEnd = today + days - 1,
    to = dayOf(tEnd),
    names = x.names || new Map();
  const opening = (x.opening || []).map((item) => ({ role: item.role, code: item.code, name: item.name, balance_minor: Number(item.balance_minor || 0) }));
  const opening_minor = opening.reduce((total, item) => total + item.balance_minor, 0);
  const inSide = datedSide('in', x.receivable_items, x.cheques, x.promises, { currency: currency, asOf });
  const outSide = datedSide('out', x.payable_items, x.cheques, [], { currency: currency, asOf });
  const byDay = Object.create(null);
  for (let d = today; d <= tEnd; d++) byDay[dayOf(d)] = { date: dayOf(d), in_minor: 0, out_minor: 0, balance_minor: 0, items: [] };
  const record = (it) => {
    const row = byDay[it.date];
    if (!row) return;
    row.items.push(it);
    if (/_in$/.test(it.kind)) row.in_minor += it.amount_minor;
    else row.out_minor += it.amount_minor;
  };
  inSide.dated.forEach((item) =>
    record({
      kind: 'due_in',
      ref: item.ref,
      party_id: item.party_id,
      name: nameOf(names, item.party_id),
      amount_minor: item.amount_minor,
      date: item.date,
      due_date: item.due_date,
      promised: item.promised,
      overdue: item.overdue,
      cheque_no: null
    })
  );
  outSide.dated.forEach((item) =>
    record({
      kind: 'due_out',
      ref: item.ref,
      party_id: item.party_id,
      name: nameOf(names, item.party_id),
      amount_minor: item.amount_minor,
      date: item.date,
      due_date: item.due_date,
      promised: false,
      overdue: item.overdue,
      cheque_no: null
    })
  );
  inSide.cheques.forEach((item) =>
    record({
      kind: 'cheque_in',
      ref: 'pay:' + item.payment_id,
      party_id: item.party_id,
      name: nameOf(names, item.party_id),
      amount_minor: item.amount_minor,
      date: item.date,
      due_date: item.cheque_date,
      promised: false,
      overdue: false,
      cheque_no: item.cheque_no
    })
  );
  outSide.cheques.forEach((item) =>
    record({
      kind: 'cheque_out',
      ref: 'pay:' + item.payment_id,
      party_id: item.party_id,
      name: nameOf(names, item.party_id),
      amount_minor: item.amount_minor,
      date: item.date,
      due_date: item.cheque_date,
      promised: false,
      overdue: false,
      cheque_no: item.cheque_no
    })
  );
  const taxLine = gstLine(x.gst, today, tEnd),
    gstAmount = taxLine.line;
  if (taxLine.item) record(taxLine.item);
  recurringLines(x.recurring, today, tEnd).forEach(record);
  /* the running balance, and the FIRST day it goes below zero. `lowest` is a DAY's closing figure (R75: the header named the opening,
     before today's receipts, as "Lowest … on <today>" while today's row showed more) — it always agrees with one row of the series */
  const series = [];
  let balance = opening_minor,
    in_minor = 0,
    out_minor = 0,
    shortfall = null,
    lowest = { date: asOf, balance_minor: Infinity };
  for (let d = today; d <= tEnd; d++) {
    const row = byDay[dayOf(d)];
    row.items.sort((first, second) => second.amount_minor - first.amount_minor);
    balance += row.in_minor - row.out_minor;
    row.balance_minor = balance;
    in_minor += row.in_minor;
    out_minor += row.out_minor;
    if (balance < lowest.balance_minor) lowest = { date: row.date, balance_minor: balance };
    if (balance < 0 && !shortfall) {
      const driver = row.items.filter((item) => !/_in$/.test(item.kind)).sort((first, second) => second.amount_minor - first.amount_minor)[0] || null;
      shortfall = {
        date: row.date,
        short_minor: -balance,
        balance_minor: balance,
        driver: driver ? { kind: driver.kind, ref: driver.ref, name: driver.name, amount_minor: driver.amount_minor } : null,
        words: ''
      };
      shortfall.words = shortWords(shortfall, asOf, currency);
    }
    series.push(row);
  }
  const uncovered = {
    overdue_in_minor: inSide.uncounted.overdue_minor,
    overdue_parties: inSide.uncounted.overdue_parties.size,
    disputed_in_minor: inSide.uncounted.disputed_minor,
    disputed_out_minor: outSide.uncounted.disputed_minor,
    words: ''
  };
  uncovered.words =
    uncovered.overdue_in_minor > 0
      ? money(uncovered.overdue_in_minor, currency) +
        ' overdue from ' +
        uncovered.overdue_parties +
        (uncovered.overdue_parties === 1 ? ' party' : ' parties') +
        ' is not counted until it is promised or paid.'
      : '';
  const words = shortfall
    ? shortfall.words
    : 'You stay above zero for the next ' + days + ' days. Lowest ' + money(lowest.balance_minor, currency) + ' on ' + books.dateWords(lowest.date) + '.';
  return {
    asOf,
    days,
    from: asOf,
    to,
    currency: currency,
    opening_minor,
    ...splitOpening(opening),
    opening,
    in_minor,
    out_minor,
    closing_minor: balance,
    lowest,
    shortfall,
    words,
    uncounted: uncovered,
    gst: gstAmount,
    series
  };
}
/**
 * the tax return's line of the answer and, when its due date falls inside the window, the series item that counts it (kind 'gst' — the one key the
 * screen's FC_KIND knows; `name` is the pack's word: GST · BAS · VAT return). g = read()'s { payable_minor, form, short, due_date, why } (returnDueFor's
 * words and date, gstPayableAt's figure); due_date null (AE without its stagger) is known, said in `why`, and never counted — a forecast dates nothing it cannot.
 */
function gstLine(gstRow, today, tEnd) {
  if (!gstRow) return { line: null, item: null };
  const dueOn = gstRow.due_date || null,
    dueDay = dayNumber(dueOn),
    payable = Number(gstRow.payable_minor || 0);
  const counted = payable > 0 && dueDay !== null && dueDay >= today && dueDay <= tEnd;
  const line = { payable_minor: payable, due_date: dueOn, counted, why: gstRow.why || null, form: gstRow.form || null, short: gstRow.short || null };
  const item = counted
    ? {
        kind: 'gst',
        ref: 'gst:' + dueOn,
        party_id: null,
        name: gstRow.short,
        amount_minor: payable,
        date: dueOn,
        due_date: dueOn,
        promised: false,
        overdue: false,
        cheque_no: null
      }
    : null;
  return { line, item };
}
/** the shortfall line, in shopkeeper words: "On 18 Oct 2026 you will be ₹12,400 short — Sri Traders' ₹30,000 is due that day." (a return: "— BAS of A$5,000 is due that day.") */
function shortWords(summary, asOf, currency) {
  const when = summary.date === asOf ? 'Today you are ' : 'On ' + books.dateWords(summary.date) + ' you will be ';
  const driver = summary.driver,
    person = !driver
      ? ''
      : driver.kind === 'gst'
        ? ' — ' + driver.name + ' of ' + money(driver.amount_minor, currency) + ' is due that day.'
        : driver.kind === 'cheque_out'
          ? ' — your cheque of ' + money(driver.amount_minor, currency) + ' to ' + driver.name + ' is dated that day.'
          : ' — ' + driver.name + (/s$/i.test(driver.name) ? '’ ' : '’s ') + money(driver.amount_minor, currency) + ' is due that day.';
  return when + money(summary.short_minor, currency) + ' short' + (person || '.');
}

/* ── the reader: one query per source, then project() ──────────────────────────────────────────────────────────── */
/** the open follow-ups Dues raised (the promise a collector took down) — none before b276 ran, never a 500 */
async function promisesOf(db, entity) {
  const followups = require('./crm-followups');
  try {
    if (!(await followups.migrated(db))) return [];
    return (await followups.list(db, entity, { done: 0 }))
      .filter((item) => item.source === 'dues' && item.due_day && !item.done_at)
      .map((item) => ({ party_id: item.party_id, due_day: item.due_day }));
  } catch (e) {
    if (e && e.code === 'CRM_NOT_MIGRATED') return [];
    throw e;
  }
}
/**
 * read(h, entity, s, { asOf, days }) → project()'s answer for this shop. s = the books setting (req.books). Reads only.
 * Trips: chart 1 · debtor items 1 · creditor items 1 · cheques 1 · parties 1 · the ledger as at asOf (asAtInput: setting · chart · years · year rows · the month's lines)
 * · follow-ups (migrated? · list · its two party reads · the shop's country). Nothing per party. The return's due date is the pack's calendar in memory (no trip).
 */
async function read(db, entity, settings, query) {
  const asOf = query.asOf,
    pack = books.packOf(settings),
    currency = pack.currency;
  const chart = await store.accounts(db, entity);
  const acct = (role) => chart.find((item) => item.role === role);
  const debtors = acct('debtors'),
    cred = acct('creditors');
  const receivable_items = debtors ? (await store.items(db, entity, null, debtors.account_id)).map(engines.itemOf) : [];
  const payable_items = cred ? (await store.items(db, entity, null, cred.account_id)).map(engines.itemOf) : [];
  const held = (await store.cheques(db, entity, false, 500)).map((item) => ({
    payment_id: item.payment_id,
    party_id: item.party_id,
    direction: item.direction,
    amount_minor: Number(item.amount_minor),
    cheque_no: item.cheque_no || null,
    cheque_date: engines.ymd(item.cheque_date),
    status: item.status || 'received'
  }));
  const names = new Map();
  (await store.parties(db, entity)).forEach((item) => names.set(String(item.party_id), item));
  const input = await books.asAtInput(db, entity, asOf);
  const balance = periods.balancesOf(engines.ledger().balanceAsAt(input), input.pack);
  const opening = CASH_ROLES.map((role) => {
    const a = balance.byRole[role];
    return a ? { role, code: a.code, name: a.name, balance_minor: Number(a.net_minor) } : null;
  }).filter(Boolean);
  const gstRow = await periods.gstPayableAt(db, entity, settings, asOf, balance),
    dueDay = returnDueFor(pack, asOf);
  const promises = await promisesOf(db, entity);
  const recurring = (await require('./books-recurring').templates(db, entity)).map((template) => recurringOf(template, currency)).filter(Boolean);
  const gstAmount = {
    payable_minor: gstRow.payable_minor,
    form: dueDay.form,
    short: dueDay.short,
    due_date: dueDay.due_date,
    why: gstRow.why || dueDay.why
  }; /* the set-off's refusal first (then payable 0), else the date's */
  return project({ asOf, days: query.days, currency: currency, opening, receivable_items, payable_items, cheques: held, promises, gst: gstAmount, names, recurring });
}

module.exports = {
  project,
  read,
  datedSide,
  returnDueFor,
  returnWords,
  gstLine,
  shortWords,
  CASH_ROLES,
  HORIZONS,
  BAS_DEFAULT_FREQUENCY,
  day: dayNumber,
  ymd: dayOf,
  toMinor,
  fromMinor
}; /* day · ymd · toMinor · fromMinor: F4 Payables reuses them, never a second copy */
