// @stage tested
// @stage-note [CB FINANCE F3] The cash position: today's cash/bank balance, then day by day what comes in (receivable dues by due date,
// @stage-note promised dates, held cheques) and goes out (payable dues, cheques written, GST by the 20th) — and the FIRST day it goes below zero.
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
 * ⭐ NEW PATHS (rule 4): project() — no engine projects a balance forward by date; read() — gathers the sources; GST_DUE_DAY — the regulation pack
 *   carries no return calendar yet, so the one rule is a named constant here (GSTR-3B: the 20th of the month after; CGST Rules r.61(1)).
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
function day(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; }
const ymd = (n) => E.addDays('1970-01-01', n);   /* a day number → its day, through the one day arithmetic (books-engines.addDays) */
/** the GST return calendar: GSTR-3B (the monthly filer) is due on the 20th of the month AFTER the tax period — CGST Rules r.61(1)(i). The pack has no return calendar yet (named in the PR). */
const GST_DUE_DAY = 20;
function gstDueAfter(asOf) { const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7)); const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1; return ny + '-' + String(nm).padStart(2, '0') + '-' + String(GST_DUE_DAY).padStart(2, '0'); }

/** the ledgers that ARE cash: the roles the India chart (and every pack) posts a receipt or a payment to — Cash · Bank · UPI · Card */
const CASH_ROLES = ['cash', 'bank', 'upi', 'card'];
const HORIZONS = [7, 30];

const money = (minor, cur) => require('./bill-privacy').money(minor, cur);
/* major ↔ minor at the engine's seam (propose speaks in amounts): the ONE rounder (money.round) and its decimals — never a second copy of the rule */
const M = () => require('./money');
const dec = (cur) => (M().decimals ? M().decimals(cur) : 2);
const toMinor = (amount, cur) => Math.round(M().round(Number(amount), cur) * Math.pow(10, dec(cur)));
const fromMinor = (minor, cur) => M().round(Number(minor) / Math.pow(10, dec(cur)), cur);
const nameOf = (names, pid) => { const p = names && (names.get ? names.get(String(pid)) : names[String(pid)]); return (p && (p.nickname || p.name)) || 'a party'; };

/**
 * ⭐ the dues of ONE side, dated: which open bill is expected on which day, after the held cheques have covered what they will settle.
 *   side 'in' (receivable items + cheques received) · 'out' (payable items + cheques written)
 * → { dated: [{ ref, party_id, amount_minor, date, due_date, bill_date, promised, overdue }], cheques: [{ payment_id, party_id, amount_minor, date, cheque_no, cheque_date }],
 *     uncounted: { overdue_minor, overdue_parties: Set, disputed_minor } }
 * The oldest-due-first coverage is CBReceivables.propose with a stand-in credit of the cheque's amount (the same way books.proposeFor previews a payment).
 */
function datedSide(side, items, cheques, promises, x) {
  const R = E.receivables(), cur = x.currency, asOf = x.asOf, t0 = day(asOf);
  const rows = (items || []).filter(Boolean);
  const out = { dated: [], cheques: [], uncounted: { overdue_minor: 0, overdue_parties: new Set(), disputed_minor: 0 } };
  const o = rows.length ? R.outstanding(rows) : { by_ref: {} };
  const cover = Object.create(null);
  /* a cheque in hand (C3: it pays nothing yet) covers the bills it will settle — oldest due first, the engine's rule, never a second one */
  const held = (cheques || []).filter((c) => c.direction === (side === 'in' ? 'in' : 'out'));
  if (held.length && rows.length) {
    const v = R.fromItems(rows), extra = [];
    held.forEach((c) => {
      const p = R.propose(v.debits, { id: 'pdc:' + c.payment_id, kind: 'payment', party: String(c.party_id), date: asOf, amount: fromMinor(c.amount_minor, cur), currency: cur },
        { credits: v.credits, allocations: v.allocations.concat(extra) });
      if (!p.ok) return;
      p.allocations.forEach((a) => { const m = toMinor(a.amount, cur); cover[a.debit] = (cover[a.debit] || 0) + m; extra.push({ credit: a.credit, debit: a.debit, amount: a.amount }); });
    });
  }
  held.forEach((c) => {
    const cd = day(c.cheque_date), d = cd === null || cd < t0 ? t0 : cd;   /* a cheque dated before today and still in hand: expected today */
    out.cheques.push({ payment_id: c.payment_id, party_id: c.party_id, amount_minor: Number(c.amount_minor), date: ymd(d), cheque_no: c.cheque_no || null, cheque_date: c.cheque_date || null });
  });
  /* a party's promise (the open follow-up Dues raised): the earliest day on or after today */
  const promise = Object.create(null);
  (promises || []).forEach((p) => { const d = day(p.due_day); if (d === null) return; const k = String(p.party_id), dd = d < t0 ? t0 : d; if (promise[k] == null || dd < promise[k]) promise[k] = dd; });
  Object.keys(o.by_ref).forEach((ref) => {
    const b = o.by_ref[ref];
    if (b.kind !== 'bill' || b.outstanding_minor <= 0) return;
    const left = b.outstanding_minor - (cover[ref] || 0);
    if (left <= 0) return;
    if (b.disputed) { out.uncounted.disputed_minor += left; return; }                /* C4: frozen until the dispute is settled */
    const due = day(b.due_date || b.date), pid = String(b.party);
    let d = due === null ? t0 : due, promised = false;
    const overdue = due !== null && due < t0;
    if (overdue) {
      if (side === 'out') d = t0;                                                     /* you owe it now */
      else if (promise[pid] != null) { d = promise[pid]; promised = true; }
      else { out.uncounted.overdue_minor += left; out.uncounted.overdue_parties.add(pid); return; }   /* not counted until promised or paid */
    }
    out.dated.push({ ref, party_id: pid, amount_minor: left, date: ymd(d), due_date: b.due_date || b.date || null, bill_date: b.date || null, promised, overdue });   /* bill_date: F4 Payables ages and dates MSME day 45 from it */
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
  const cur = require('./country-setup').currencyStated(x.currency), asOf = x.asOf, days = HORIZONS.indexOf(Number(x.days)) >= 0 ? Number(x.days) : 7;
  const t0 = day(asOf); if (t0 === null) throw Object.assign(new Error('The cash position needs asOf as YYYY-MM-DD.'), { code: 'BOOKS_BAD_REQUEST' });
  const tEnd = t0 + days - 1, to = ymd(tEnd), names = x.names || new Map();
  const opening = (x.opening || []).map((a) => ({ role: a.role, code: a.code, name: a.name, balance_minor: Number(a.balance_minor || 0) }));
  const opening_minor = opening.reduce((t, a) => t + a.balance_minor, 0);
  const inSide = datedSide('in', x.receivable_items, x.cheques, x.promises, { currency: cur, asOf });
  const outSide = datedSide('out', x.payable_items, x.cheques, [], { currency: cur, asOf });
  const byDay = Object.create(null); for (let d = t0; d <= tEnd; d++) byDay[ymd(d)] = { date: ymd(d), in_minor: 0, out_minor: 0, balance_minor: 0, items: [] };
  const put = (it) => { const row = byDay[it.date]; if (!row) return; row.items.push(it); if (/_in$/.test(it.kind)) row.in_minor += it.amount_minor; else row.out_minor += it.amount_minor; };
  inSide.dated.forEach((d) => put({ kind: 'due_in', ref: d.ref, party_id: d.party_id, name: nameOf(names, d.party_id), amount_minor: d.amount_minor, date: d.date, due_date: d.due_date, promised: d.promised, overdue: d.overdue, cheque_no: null }));
  outSide.dated.forEach((d) => put({ kind: 'due_out', ref: d.ref, party_id: d.party_id, name: nameOf(names, d.party_id), amount_minor: d.amount_minor, date: d.date, due_date: d.due_date, promised: false, overdue: d.overdue, cheque_no: null }));
  inSide.cheques.forEach((c) => put({ kind: 'cheque_in', ref: 'pay:' + c.payment_id, party_id: c.party_id, name: nameOf(names, c.party_id), amount_minor: c.amount_minor, date: c.date, due_date: c.cheque_date, promised: false, overdue: false, cheque_no: c.cheque_no }));
  outSide.cheques.forEach((c) => put({ kind: 'cheque_out', ref: 'pay:' + c.payment_id, party_id: c.party_id, name: nameOf(names, c.party_id), amount_minor: c.amount_minor, date: c.date, due_date: c.cheque_date, promised: false, overdue: false, cheque_no: c.cheque_no }));
  let gst = null;
  if (x.gst) {
    const due = x.gst.due_date || gstDueAfter(asOf), gd = day(due), counted = x.gst.payable_minor > 0 && gd !== null && gd >= t0 && gd <= tEnd;
    gst = { payable_minor: Number(x.gst.payable_minor || 0), due_date: due, counted, why: x.gst.why || null };
    if (counted) put({ kind: 'gst', ref: 'gst:' + due, party_id: null, name: 'GST', amount_minor: gst.payable_minor, date: due, due_date: due, promised: false, overdue: false, cheque_no: null });
  }
  /* the running balance, and the FIRST day it goes below zero */
  const series = [], lowest = { date: asOf, balance_minor: opening_minor };
  let bal = opening_minor, in_minor = 0, out_minor = 0, shortfall = null;
  for (let d = t0; d <= tEnd; d++) {
    const row = byDay[ymd(d)];
    row.items.sort((a, b) => b.amount_minor - a.amount_minor);
    bal += row.in_minor - row.out_minor; row.balance_minor = bal; in_minor += row.in_minor; out_minor += row.out_minor;
    if (bal < lowest.balance_minor) { lowest.date = row.date; lowest.balance_minor = bal; }
    if (bal < 0 && !shortfall) {
      const driver = row.items.filter((i) => !/_in$/.test(i.kind)).sort((a, b) => b.amount_minor - a.amount_minor)[0] || null;
      shortfall = { date: row.date, short_minor: -bal, balance_minor: bal, driver: driver ? { kind: driver.kind, ref: driver.ref, name: driver.name, amount_minor: driver.amount_minor } : null, words: '' };
      shortfall.words = shortWords(shortfall, asOf, cur);
    }
    series.push(row);
  }
  const unc = { overdue_in_minor: inSide.uncounted.overdue_minor, overdue_parties: inSide.uncounted.overdue_parties.size, disputed_in_minor: inSide.uncounted.disputed_minor, disputed_out_minor: outSide.uncounted.disputed_minor, words: '' };
  unc.words = unc.overdue_in_minor > 0 ? money(unc.overdue_in_minor, cur) + ' overdue from ' + unc.overdue_parties + (unc.overdue_parties === 1 ? ' party' : ' parties') + ' is not counted until it is promised or paid.' : '';
  const words = shortfall ? shortfall.words : 'You stay above zero for the next ' + days + ' days. Lowest ' + money(lowest.balance_minor, cur) + ' on ' + B.dateWords(lowest.date) + '.';
  return { asOf, days, from: asOf, to, currency: cur, opening_minor, opening, in_minor, out_minor, closing_minor: bal, lowest, shortfall, words, uncounted: unc, gst, series };
}
/** the shortfall line, in shopkeeper words: "On 18 Oct 2026 you will be ₹12,400 short — Sri Traders' ₹30,000 is due that day." */
function shortWords(s, asOf, cur) {
  const when = s.date === asOf ? 'Today you are ' : 'On ' + B.dateWords(s.date) + ' you will be ';
  const d = s.driver, who = !d ? '' : d.kind === 'gst' ? ' — GST of ' + money(d.amount_minor, cur) + ' is due that day.'
    : d.kind === 'cheque_out' ? ' — your cheque of ' + money(d.amount_minor, cur) + ' to ' + d.name + ' is dated that day.'
    : ' — ' + d.name + (/s$/i.test(d.name) ? '’ ' : '’s ') + money(d.amount_minor, cur) + ' is due that day.';
  return when + money(s.short_minor, cur) + ' short' + (who || '.');
}

/* ── the reader: one query per source, then project() ──────────────────────────────────────────────────────────── */
/** the open follow-ups Dues raised (the promise a collector took down) — none before b276 ran, never a 500 */
async function promisesOf(h, entity) {
  const F = require('./crm-followups');
  try {
    if (!(await F.migrated(h))) return [];
    return (await F.list(h, entity, { done: 0 })).filter((r) => r.source === 'dues' && r.due_day && !r.done_at).map((r) => ({ party_id: r.party_id, due_day: r.due_day }));
  } catch (e) { if (e && e.code === 'CRM_NOT_MIGRATED') return []; throw e; }
}
/**
 * read(h, entity, s, { asOf, days }) → project()'s answer for this shop. s = the books setting (req.books). Reads only.
 * Trips: chart 1 · debtor items 1 · creditor items 1 · cheques 1 · parties 1 · the ledger as at asOf (asAtInput: setting · chart · years · year rows · the month's lines)
 * · follow-ups (migrated? · list · its two party reads · the shop's country). Nothing per party.
 */
async function read(h, entity, s, q) {
  const asOf = q.asOf, cur = B.curOf(s);
  const chart = await S.accounts(h, entity);
  const acct = (role) => chart.find((a) => a.role === role);
  const deb = acct('debtors'), cred = acct('creditors');
  const receivable_items = deb ? (await S.items(h, entity, null, deb.account_id)).map(E.itemOf) : [];
  const payable_items = cred ? (await S.items(h, entity, null, cred.account_id)).map(E.itemOf) : [];
  const held = (await S.cheques(h, entity, false, 500)).map((c) => ({ payment_id: c.payment_id, party_id: c.party_id, direction: c.direction, amount_minor: Number(c.amount_minor), cheque_no: c.cheque_no || null, cheque_date: E.ymd(c.cheque_date), status: c.status || 'received' }));
  const names = new Map(); (await S.parties(h, entity)).forEach((p) => names.set(String(p.party_id), p));
  const inp = await B.asAtInput(h, entity, asOf);
  const bal = P.balancesOf(E.ledger().balanceAsAt(inp), inp.pack);
  const opening = CASH_ROLES.map((role) => { const a = bal.byRole[role]; return a ? { role, code: a.code, name: a.name, balance_minor: Number(a.net_minor) } : null; }).filter(Boolean);
  const g = await P.gstPayableAt(h, entity, s, asOf, bal);
  const promises = await promisesOf(h, entity);
  return project({ asOf, days: q.days, currency: cur, opening, receivable_items, payable_items, cheques: held, promises, gst: { payable_minor: g.payable_minor, due_date: gstDueAfter(asOf), why: g.why }, names });
}

module.exports = { project, read, datedSide, gstDueAfter, shortWords, CASH_ROLES, HORIZONS, GST_DUE_DAY, day, ymd, toMinor, fromMinor };   /* day · ymd · toMinor · fromMinor: F4 Payables reuses them, never a second copy */
