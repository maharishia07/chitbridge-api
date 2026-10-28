// @stage tested
// CALLED BY lib/books-payables.js, lib/home-facts.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
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
 * FLOW  read() → S.accounts · S.items ×2 · S.cheques · S.parties · B.asAtInput → P.gstPayableAt · returnDueFor · promisesOf → project() → datedSide ×2 · gstLine · the running balance
 * CARD 16-finance/books-cashflow
 * ⚠️ HONEST NUMBERS (cb-design §2): an overdue bill nobody has promised is NOT counted as money coming in — it is named in `uncounted` with its
 *   sentence; a disputed bill is frozen (C4) and not counted either way; a cheque counts on its date (C3: it pays nothing before it clears).
 *   An overdue payable IS counted today — you owe it now. Beyond the horizon nothing is counted and nothing is hidden: `to` says where it stops.
 * ⚠️ NO CLOCK: asOf is passed in (routes/books.js today() = the shop clock, lib/shop-clock).
 */
const E = require('./books-engines');
const S = require('./books-store');
const B = require('./books');
const P = require('./books-period');

/* ── dates: 'YYYY-MM-DD' ↔ a day number (no clock, no zone) — the receivables engine's own arithmetic, kept to three lines ── */
function day(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
const ymd = (n) => E.addDays('1970-01-01', n); /* a day number → its day, through the one day arithmetic (books-engines.addDays) */
/* ── the return calendar is the PACK's (engines gst-returns, adopted v1.39.0) — never a day typed here ─────────────────── */
const GR = () => require('./gst-returns');
const INDIA_RETURN = { form: 'GSTR-3B', short: 'GST' }; /* India's pack has no `returns` block: gst-returns.periodsFor names its form; the chip's word is GST */
const BAS_DEFAULT_FREQUENCY = 'quarterly'; /* the ATO's default (GST turnover under $20m) — the same default GET /returns takes */
const DUE_NEEDS_PERIOD = 'Due date unknown until the return period is picked under Returns.';
/** the words a screen calls this pack's return — the pack's own (`returns.id` · `returns.short`), India's from gst-returns */
function returnWords(pack) {
  const R = pack && pack.returns;
  if (R && R.id) return { form: R.id, short: R.short || R.id };
  return pack && pack.id === 'IN' ? Object.assign({}, INDIA_RETURN) : { form: null, short: 'Tax' };
}
/** the pack's period table around asOf: AU by the financial year that holds it (frequency as asked, else quarterly) · AE by the FTA stagger for that year and the one before */
function returnPeriodsAround(pack, asOf, opts) {
  const o = opts || {},
    R = pack.returns;
  if (R.id === 'BAS') return GR().periodsFor(pack, { fy: E.packs().fiscalYearOf(asOf, pack), frequency: o.frequency || BAS_DEFAULT_FREQUENCY });
  const year = Number(asOf.slice(0, 4)),
    rows = [];
  for (const y of [year - 1, year]) {
    const r = GR().periodsFor(pack, { year: y, stagger: o.stagger });
    if (!r.ok) return r;
    rows.push(...r.periods);
  }
  return { ok: true, periods: rows };
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
    if (pack.id === 'IN') return Object.assign(words, { due_date: GR().dueDate(day0.slice(0, 7)), why: null });
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

const money = (minor, cur) => require('./bill-privacy').money(minor, cur);
/* major ↔ minor at the engine's seam (propose speaks in amounts): the ONE rounder (money.round) and its decimals — never a second copy of the rule */
const M = () => require('./money');
const dec = (cur) => (M().decimals ? M().decimals(cur) : 2);
const toMinor = (amount, cur) => Math.round(M().round(Number(amount), cur) * Math.pow(10, dec(cur)));
const fromMinor = (minor, cur) => M().round(Number(minor) / Math.pow(10, dec(cur)), cur);
const nameOf = (names, pid) => {
  const p = names && (names.get ? names.get(String(pid)) : names[String(pid)]);
  return (p && (p.nickname || p.name)) || 'a party';
};

/**
 * ⭐ the dues of ONE side, dated: which open bill is expected on which day, after the held cheques have covered what they will settle.
 *   side 'in' (receivable items + cheques received) · 'out' (payable items + cheques written)
 * → { dated: [{ ref, party_id, amount_minor, date, due_date, bill_date, promised, overdue }], cheques: [{ payment_id, party_id, amount_minor, date, cheque_no, cheque_date }],
 *     uncounted: { overdue_minor, overdue_parties: Set, disputed_minor } }
 * The oldest-due-first coverage is CBReceivables.propose with a stand-in credit of the cheque's amount (the same way books.proposeFor previews a payment).
 */
function datedSide(side, items, cheques, promises, x) {
  const R = E.receivables(),
    cur = x.currency,
    asOf = x.asOf,
    t0 = day(asOf);
  const rows = (items || []).filter(Boolean);
  const out = { dated: [], cheques: [], uncounted: { overdue_minor: 0, overdue_parties: new Set(), disputed_minor: 0 } };
  const o = rows.length ? R.outstanding(rows) : { by_ref: {} };
  const cover = Object.create(null);
  /* a cheque in hand (C3: it pays nothing yet) covers the bills it will settle — oldest due first, the engine's rule, never a second one */
  const held = (cheques || []).filter((item) => item.direction === (side === 'in' ? 'in' : 'out'));
  if (held.length && rows.length) {
    const v = R.fromItems(rows),
      extra = [];
    held.forEach((item) => {
      const p = R.propose(
        v.debits,
        { id: 'pdc:' + item.payment_id, kind: 'payment', party: String(item.party_id), date: asOf, amount: fromMinor(item.amount_minor, cur), currency: cur },
        { credits: v.credits, allocations: v.allocations.concat(extra) }
      );
      if (!p.ok) return;
      p.allocations.forEach((item) => {
        const m = toMinor(item.amount, cur);
        cover[item.debit] = (cover[item.debit] || 0) + m;
        extra.push({ credit: item.credit, debit: item.debit, amount: item.amount });
      });
    });
  }
  held.forEach((item) => {
    const cd = day(item.cheque_date),
      d = cd === null || cd < t0 ? t0 : cd; /* a cheque dated before today and still in hand: expected today */
    out.cheques.push({
      payment_id: item.payment_id,
      party_id: item.party_id,
      amount_minor: Number(item.amount_minor),
      date: ymd(d),
      cheque_no: item.cheque_no || null,
      cheque_date: item.cheque_date || null
    });
  });
  /* a party's promise (the open follow-up Dues raised): the earliest day on or after today */
  const promise = Object.create(null);
  (promises || []).forEach((item) => {
    const d = day(item.due_day);
    if (d === null) return;
    const k = String(item.party_id),
      dd = d < t0 ? t0 : d;
    if (promise[k] == null || dd < promise[k]) promise[k] = dd;
  });
  Object.keys(o.by_ref).forEach((ref) => {
    const b = o.by_ref[ref];
    if (b.kind !== 'bill' || b.outstanding_minor <= 0) return;
    const left = b.outstanding_minor - (cover[ref] || 0);
    if (left <= 0) return;
    if (b.disputed) {
      out.uncounted.disputed_minor += left;
      return;
    } /* C4: frozen until the dispute is settled */
    const due = day(b.due_date || b.date),
      pid = String(b.party);
    let d = due === null ? t0 : due,
      promised = false;
    const overdue = due !== null && due < t0;
    if (overdue) {
      if (side === 'out') d = t0; /* you owe it now */
      else if (promise[pid] != null) {
        d = promise[pid];
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
      date: ymd(d),
      due_date: b.due_date || b.date || null,
      bill_date: b.date || null,
      promised,
      overdue
    }); /* bill_date: F4 Payables ages and dates MSME day 45 from it */
  });
  return out;
}

/**
 * ⭐⭐ project(x) — THE ONE CALCULATION. x: { asOf, days (7|30), currency, opening: [{ role, code, name, balance_minor }], receivable_items, payable_items,
 *   cheques: [{ payment_id, party_id, direction, amount_minor, cheque_no, cheque_date, status }] (the ones still HELD), promises: [{ party_id, due_day }],
 *   gst: { payable_minor, due_date, why } | null, names: Map(party_id → { name, nickname, party_no }) }
 * → { asOf, days, from, to, currency, opening_minor, opening[], in_minor, out_minor, closing_minor, lowest: { date, balance_minor },
 *     shortfall: null | { date, short_minor, balance_minor, driver: { kind, ref, name, amount_minor } | null, words }, words,
 *     uncounted: { overdue_in_minor, overdue_parties, disputed_in_minor, disputed_out_minor, words }, gst: { payable_minor, due_date, counted, why } | null,
 *     series: [{ date, in_minor, out_minor, balance_minor, items: [{ kind: due_in | due_out | cheque_in | cheque_out | gst, ref, party_id, name, amount_minor, due_date, promised, overdue, cheque_no }] }] }
 * Every figure is an integer of minor units. The series has one row per day, today first, days long — a quiet day is a row with no items.
 */
function project(x) {
  const cur = require('./country-setup').currencyStated(x.currency),
    asOf = x.asOf,
    days = HORIZONS.indexOf(Number(x.days)) >= 0 ? Number(x.days) : 7;
  const t0 = day(asOf);
  if (t0 === null) throw Object.assign(new Error('The cash position needs asOf as YYYY-MM-DD.'), { code: 'BOOKS_BAD_REQUEST' });
  const tEnd = t0 + days - 1,
    to = ymd(tEnd),
    names = x.names || new Map();
  const opening = (x.opening || []).map((item) => ({ role: item.role, code: item.code, name: item.name, balance_minor: Number(item.balance_minor || 0) }));
  const opening_minor = opening.reduce((total, item) => total + item.balance_minor, 0);
  const inSide = datedSide('in', x.receivable_items, x.cheques, x.promises, { currency: cur, asOf });
  const outSide = datedSide('out', x.payable_items, x.cheques, [], { currency: cur, asOf });
  const byDay = Object.create(null);
  for (let d = t0; d <= tEnd; d++) byDay[ymd(d)] = { date: ymd(d), in_minor: 0, out_minor: 0, balance_minor: 0, items: [] };
  const put = (it) => {
    const row = byDay[it.date];
    if (!row) return;
    row.items.push(it);
    if (/_in$/.test(it.kind)) row.in_minor += it.amount_minor;
    else row.out_minor += it.amount_minor;
  };
  inSide.dated.forEach((item) =>
    put({
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
    put({
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
    put({
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
    put({
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
  const taxLine = gstLine(x.gst, t0, tEnd),
    gst = taxLine.line;
  if (taxLine.item) put(taxLine.item);
  /* the running balance, and the FIRST day it goes below zero */
  const series = [],
    lowest = { date: asOf, balance_minor: opening_minor };
  let bal = opening_minor,
    in_minor = 0,
    out_minor = 0,
    shortfall = null;
  for (let d = t0; d <= tEnd; d++) {
    const row = byDay[ymd(d)];
    row.items.sort((first, second) => second.amount_minor - first.amount_minor);
    bal += row.in_minor - row.out_minor;
    row.balance_minor = bal;
    in_minor += row.in_minor;
    out_minor += row.out_minor;
    if (bal < lowest.balance_minor) {
      lowest.date = row.date;
      lowest.balance_minor = bal;
    }
    if (bal < 0 && !shortfall) {
      const driver = row.items.filter((item) => !/_in$/.test(item.kind)).sort((first, second) => second.amount_minor - first.amount_minor)[0] || null;
      shortfall = {
        date: row.date,
        short_minor: -bal,
        balance_minor: bal,
        driver: driver ? { kind: driver.kind, ref: driver.ref, name: driver.name, amount_minor: driver.amount_minor } : null,
        words: ''
      };
      shortfall.words = shortWords(shortfall, asOf, cur);
    }
    series.push(row);
  }
  const unc = {
    overdue_in_minor: inSide.uncounted.overdue_minor,
    overdue_parties: inSide.uncounted.overdue_parties.size,
    disputed_in_minor: inSide.uncounted.disputed_minor,
    disputed_out_minor: outSide.uncounted.disputed_minor,
    words: ''
  };
  unc.words =
    unc.overdue_in_minor > 0
      ? money(unc.overdue_in_minor, cur) +
        ' overdue from ' +
        unc.overdue_parties +
        (unc.overdue_parties === 1 ? ' party' : ' parties') +
        ' is not counted until it is promised or paid.'
      : '';
  const words = shortfall
    ? shortfall.words
    : 'You stay above zero for the next ' + days + ' days. Lowest ' + money(lowest.balance_minor, cur) + ' on ' + B.dateWords(lowest.date) + '.';
  return {
    asOf,
    days,
    from: asOf,
    to,
    currency: cur,
    opening_minor,
    opening,
    in_minor,
    out_minor,
    closing_minor: bal,
    lowest,
    shortfall,
    words,
    uncounted: unc,
    gst,
    series
  };
}
/**
 * the tax return's line of the answer and, when its due date falls inside the window, the series item that counts it (kind 'gst' — the one key the
 * screen's FC_KIND knows; `name` is the pack's word: GST · BAS · VAT return). g = read()'s { payable_minor, form, short, due_date, why } (returnDueFor's
 * words and date, gstPayableAt's figure); due_date null (AE without its stagger) is known, said in `why`, and never counted — a forecast dates nothing it cannot.
 */
function gstLine(g, t0, tEnd) {
  if (!g) return { line: null, item: null };
  const due = g.due_date || null,
    dueDay = day(due),
    payable = Number(g.payable_minor || 0);
  const counted = payable > 0 && dueDay !== null && dueDay >= t0 && dueDay <= tEnd;
  const line = { payable_minor: payable, due_date: due, counted, why: g.why || null, form: g.form || null, short: g.short || null };
  const item = counted
    ? {
        kind: 'gst',
        ref: 'gst:' + due,
        party_id: null,
        name: g.short,
        amount_minor: payable,
        date: due,
        due_date: due,
        promised: false,
        overdue: false,
        cheque_no: null
      }
    : null;
  return { line, item };
}
/** the shortfall line, in shopkeeper words: "On 18 Oct 2026 you will be ₹12,400 short — Sri Traders' ₹30,000 is due that day." (a return: "— BAS of A$5,000 is due that day.") */
function shortWords(s, asOf, cur) {
  const when = s.date === asOf ? 'Today you are ' : 'On ' + B.dateWords(s.date) + ' you will be ';
  const d = s.driver,
    who = !d
      ? ''
      : d.kind === 'gst'
        ? ' — ' + d.name + ' of ' + money(d.amount_minor, cur) + ' is due that day.'
        : d.kind === 'cheque_out'
          ? ' — your cheque of ' + money(d.amount_minor, cur) + ' to ' + d.name + ' is dated that day.'
          : ' — ' + d.name + (/s$/i.test(d.name) ? '’ ' : '’s ') + money(d.amount_minor, cur) + ' is due that day.';
  return when + money(s.short_minor, cur) + ' short' + (who || '.');
}

/* ── the reader: one query per source, then project() ──────────────────────────────────────────────────────────── */
/** the open follow-ups Dues raised (the promise a collector took down) — none before b276 ran, never a 500 */
async function promisesOf(h, entity) {
  const F = require('./crm-followups');
  try {
    if (!(await F.migrated(h))) return [];
    return (await F.list(h, entity, { done: 0 }))
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
async function read(h, entity, s, q) {
  const asOf = q.asOf,
    pack = B.packOf(s),
    cur = pack.currency;
  const chart = await S.accounts(h, entity);
  const acct = (role) => chart.find((item) => item.role === role);
  const deb = acct('debtors'),
    cred = acct('creditors');
  const receivable_items = deb ? (await S.items(h, entity, null, deb.account_id)).map(E.itemOf) : [];
  const payable_items = cred ? (await S.items(h, entity, null, cred.account_id)).map(E.itemOf) : [];
  const held = (await S.cheques(h, entity, false, 500)).map((item) => ({
    payment_id: item.payment_id,
    party_id: item.party_id,
    direction: item.direction,
    amount_minor: Number(item.amount_minor),
    cheque_no: item.cheque_no || null,
    cheque_date: E.ymd(item.cheque_date),
    status: item.status || 'received'
  }));
  const names = new Map();
  (await S.parties(h, entity)).forEach((item) => names.set(String(item.party_id), item));
  const inp = await B.asAtInput(h, entity, asOf);
  const bal = P.balancesOf(E.ledger().balanceAsAt(inp), inp.pack);
  const opening = CASH_ROLES.map((role) => {
    const a = bal.byRole[role];
    return a ? { role, code: a.code, name: a.name, balance_minor: Number(a.net_minor) } : null;
  }).filter(Boolean);
  const g = await P.gstPayableAt(h, entity, s, asOf, bal),
    due = returnDueFor(pack, asOf);
  const promises = await promisesOf(h, entity);
  const gst = {
    payable_minor: g.payable_minor,
    form: due.form,
    short: due.short,
    due_date: due.due_date,
    why: g.why || due.why
  }; /* the set-off's refusal first (then payable 0), else the date's */
  return project({ asOf, days: q.days, currency: cur, opening, receivable_items, payable_items, cheques: held, promises, gst, names });
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
  day,
  ymd,
  toMinor,
  fromMinor
}; /* day · ymd · toMinor · fromMinor: F4 Payables reuses them, never a second copy */
