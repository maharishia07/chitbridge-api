// @stage tested
// @stage-note [BOOKS v2] postEntry — THE ONE WRITER of journal_entry / journal_line / account_balance / party_item, in one
// @stage-note transaction; reversals, cheques, allocations and status rows through it too. Off unless the shop enabled it.
'use strict';
/**
 * lib/books.js — A RECORD KEPT BY DOUBLE-ENTRY PRINCIPLE (SPEC-books-v2 §3, §6).
 *
 * ⚠️⚠️ Never called "accounting" or "books of account" on any screen (Athi, standing). Screens say Ledger, Day book,
 *   Dues, Statement, Trial balance.
 *
 * ⭐⭐⭐ postEntry(db, entity, event) IS THE ONLY WRITER of the journal, the monthly balances and the party items. It
 *   writes the lines, the monthly balance rows for EVERY line at both grains (account, and account+party — CBLedger's
 *   balanceAsAt reads a complete month from its row alone, so a row that missed a line would be silently wrong), the
 *   party items and the gap-free entry number, in ONE transaction: a failure anywhere rolls all of it back, the number
 *   included, so the series has no gap. tests/books-writer.test.cjs fails if anything else writes those tables.
 * ⭐ THE RULES ARE THE ENGINES': the lines are CBPosting.post's, the balance rows CBLedger.accumulate's, the party items
 *   CBReceivables' (itemsOfBill, itemsOfPayment, confirmItems, statusItem, itemsOfCheque, reverseItems). This file
 *   decides only WHERE and WHEN: which of the shop's ledgers a code is, which month is open, which number comes next.
 * ⭐ OFF IS A NO-OP. With books_setting.enabled false (or the tables not created yet) postEntry returns
 *   { ok: false, off: true } and says so once per shop in the log — never an error a chit could fail on.
 * ⭐ A LOCKED MONTH MOVES THE DATE, NEVER THE DOCUMENT: an entry aimed at a locked month posts on the first open date
 *   after it, doc_date kept (research §6.4; the fix for ERPNext #30547).
 */
const E = require('./books-engines');
const S = require('./books-store');

const offSaid = new Set();
/* ⚠️ the exact sentence the web's friendlyErr maps (code PERIOD_LOCKED) — the harness asserts it; change both together */
const PERIOD_LOCKED = 'That month is locked. Open it again (with a reason) to record this.';
const SUSPENSE_NOT_NIL = (fy) => 'The opening balances of ' + fy + ' did not balance: Suspense is not nil. Clear it to see figures after that year.';
function refuse(why, code) { const e = new Error(why); e.code = code || 'BOOKS_REFUSED'; e.refused = true; return e; }
const ymd = E.ymd;
function addDays(d, k) { const t = new Date(Date.parse(ymd(d) + 'T00:00:00Z') + k * 86400000); return t.toISOString().slice(0, 10); }
/** an engine refusal (status 409/422 on the Error) is a refusal here too — named, never a 500 */
function engineRefusal(e) { if (e && (e.status === 409 || e.status === 422) && !e.code) { e.code = 'BOOKS_REFUSED'; e.refused = true; } return e; }

/** the handle: the caller's (inside its transaction) or our own withEntity */
function onDb(db, entity, fn) { return db ? fn(db) : require('../db').withEntity(entity, fn); }

/**
 * the shop's switch — in a savepoint, so the transaction lives.
 * ⚠️⚠️ null means ONE thing: the table is not there (42P01, b272 not run). A shop that simply has no row yet is OFF —
 *   { entity_id, enabled: false } — never null: enable() read null as "not migrated", nothing else ever inserts the row,
 *   so no shop could be switched on (critic M1, 2026-09-30; every test had seeded a row first).
 */
async function settingOf(db, entity) {
  await db.query('SAVEPOINT books_setting_read');
  try { const r = await S.setting(db, entity); await db.query('RELEASE SAVEPOINT books_setting_read'); return r || { entity_id: entity, enabled: false }; }
  catch (e) { await db.query('ROLLBACK TO SAVEPOINT books_setting_read').catch(() => {}); if (e && e.code === '42P01') return null; throw e; }
}
function packOf(s) {
  const p = E.packs().packFor((s && s.country) || 'IN');
  return Object.assign({}, p, { fy_start_month: (s && s.fy_start_month) || p.fy_start_month, currency: (s && s.functional_currency) || p.currency });
}
const sideOfRole = (role) => (role === 'creditors' ? 'payable' : 'receivable');
const roleOfSide = (side) => (side === 'payable' || side === 'supplier' ? 'creditors' : 'debtors');

/* ═══ periods ══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** the year's months exist (created open, the first time an entry lands in that year) */
async function ensureYear(db, entity, fy, pack) {
  const have = await S.periods(db, entity, fy);
  if (have.length >= 13) return have;
  const A = E.packs(); const yr = A.fyRange(fy, pack);
  await S.insertPeriod(db, entity, { fiscal_year: fy, period: 0, start_date: yr.start, end_date: yr.start });
  for (let p = 1; p <= 12; p++) { const r = A.periodRange(fy, p, pack); await S.insertPeriod(db, entity, { fiscal_year: fy, period: p, start_date: r.start, end_date: r.end }); }
  return S.periods(db, entity, fy);
}
/**
 * ⭐ THE LEDGER'S FIRST DAY: the start of the financial year it was switched on in (books_setting.enabled_at, read as the
 * shop's day). Nothing posts before it — what was owed before then comes in as opening balances. null = not known.
 */
function ledgerStart(s, pack) {
  if (!s || !s.enabled_at) return null;
  const day = require('./books-hooks').dayOf(s.enabled_at, s.country);
  const A = E.packs(), fy = day ? A.fiscalYearOf(day, pack) : null;
  return fy ? ymd(A.fyRange(fy, pack).start) : null;
}
/**
 * ⚠️⚠️ A DATE A PERSON TYPED MUST BE ONE THE LEDGER CAN HOLD (critic M9, 2026-09-30): POST /payments with received_at
 * '2020-01-01' posted, and financial year 2019-20 then EXISTED — every later report carried forward from it. Refused in
 * words: before the ledger's first day (any typed date, and opening balances), or later than tomorrow (the shop's day).
 */
function typedDate(s, pack, date, opening) {
  const d = ymd(date), first = ledgerStart(s, pack);
  if (first && d < first) throw refuse('That date is before this ledger began (' + first + '). What was owed before then goes in as an opening balance.');
  if (opening) return;
  const today = require('./books-hooks').dayOf(new Date(), s && s.country);
  if (today && d > addDays(today, 1)) throw refuse('That date is in the future.');
}
/**
 * the date an entry dated `date` posts on: itself when its month is open, else the first day of the first open month
 * after it (this year or the next two). Opening entries (period 0) never move: a locked period 0 refuses them.
 * ⭐ THE YEARS BEFORE THE LEDGER BEGAN ARE CLOSED, by the same rule as a locked month: a CHIT dated before the ledger's
 *   first day (a counter whose clock is wrong, a supplier's old invoice) posts on that first day, its own date kept
 *   (moved: true) — it never creates an old financial year. A date a person typed is refused instead (typedDate).
 */
async function postingDateFor(db, entity, date, pack, opening, strict, s) {
  const A = E.packs();
  let d = ymd(date), early = false;
  if (!d || !A.fiscalYearOf(d, pack)) throw refuse('The entry has no date.');
  if (strict || opening) typedDate(s, pack, d, opening);
  else { const first = ledgerStart(s, pack); if (first && d < first) { d = first; early = true; } }
  date = d;
  let fy = A.fiscalYearOf(date, pack);
  let rows = await ensureYear(db, entity, fy, pack);
  if (opening) {
    const p0 = rows.find((r) => Number(r.period) === 0);
    if (p0 && p0.status !== 'open') throw refuse('The opening balances of ' + fy + ' are locked.');
    return { date: ymd(date), fy, period: 0, moved: false };
  }
  const p = A.periodOf(date, pack);
  const row = rows.find((r) => Number(r.period) === p);
  if (!row || row.status === 'open') return { date: ymd(date), fy, period: p, moved: early };
  /* ⚠️ a date a PERSON typed (a payment, a manual entry) is never moved behind their back — refused, in words */
  if (strict) throw refuse(PERIOD_LOCKED, 'PERIOD_LOCKED');
  for (let guard = 0; guard < 3; guard++) {
    const open = rows.filter((r) => Number(r.period) >= 1 && r.status === 'open' && ymd(r.start_date) > ymd(date)).sort((a, b) => a.period - b.period)[0];
    if (open) return { date: ymd(open.start_date), fy, period: Number(open.period), moved: true };
    fy = A.fiscalYearOf(addDays(A.fyRange(fy, pack).end, 1), pack);
    rows = await ensureYear(db, entity, fy, pack);
  }
  throw refuse('Every month from ' + ymd(date) + ' on is locked — nothing can be posted until one is opened.');
}

/* ═══ the one writer ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ⭐⭐⭐ postEntry(db, entity, event) → { ok, entry_id?, entry_no?, posting_date?, moved?, duplicate?, off? }
 *
 * A JOURNAL event is CBPosting's ({ type, ref, date, currency, … }) plus:
 *   source_ref       the idempotency key — a source posts once, ever (partial unique index)
 *   source_chit_id   the chit behind it          against_ref   a return / write-off / payment: the bill it settles
 *   due_date         a bill's own due date (else date + the party's credit days)
 *   doc_ref          the party-item document id (default: source_chit_id → source_ref → ref)
 *   counter          the counter's id, on every line          by   who
 *   source_chit_ids  the chits a SUMMARY entry covers (a walk-in day names its bills; one it does not name posts late)
 * PARTY-ITEM-ONLY events (no journal; still here, so nothing else writes party_item):
 *   { type: 'allocation', party, side, credit_ref, allocations: [{ against_ref, amount_minor }] }   — confirm (D1)
 *   { type: 'party_status', party, side, against_ref, status }                                       — dispute (C4)
 *   { type: 'cheque_received', party, side, payment_id, amount_minor, date, cheque }                — a status row (C3)
 *   { type: 'cheque_step', payment_id, to: deposited|cleared|bounced, date }                        — cleared posts, bounce reverses
 *   { type: 'reversal', reverses: entry_id, reason }                                                — the correction
 * Refused (thrown, code BOOKS_REFUSED / BOOKS_ENGINE): the engine refuses, a code has no ledger, no month is open. The
 * hooks queue a refused event and name it — a chit never fails on it.
 */
async function postEntry(db, entity, event) {
  return onDb(db, entity, async (h) => {
    const s = await settingOf(h, entity);
    if (!s || !s.enabled) {
      if (!offSaid.has(String(entity))) { offSaid.add(String(entity)); try { require('./logger').info('books.off', { entity_id: entity, why: s ? 'switched off' : 'tables not created' }); } catch (_) {} }
      return { ok: false, off: true };
    }
    const ev = event || {};
    if (ev.source_ref) {
      const seen = await S.entryBySource(h, entity, ev.source_ref);
      if (seen) return { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: ymd(seen.posting_date) };
    }
    try {
      if (ev.type === 'allocation') return await writeAllocation(h, entity, ev);
      if (ev.type === 'party_status') return await writeStatus(h, entity, ev);
      if (ev.type === 'cheque_received') return await writeChequeReceived(h, entity, ev);
      if (ev.type === 'cheque_step') return await writeChequeStep(h, entity, s, ev);
      if (ev.type === 'reversal') return await writeReversal(h, entity, s, ev, true);
      return await writeJournal(h, entity, s, ev, true);
    } catch (e) { throw engineRefusal(e); }
  });
}

/** the chart, twice indexed */
async function chartOf(h, entity) {
  const chart = await S.accounts(h, entity);
  const byRole = new Map(), byCode = new Map(), byId = new Map();
  chart.forEach((a) => { if (a.role) byRole.set(a.role, a); byCode.set(String(a.code), a); byId.set(String(a.account_id), a); });
  return { chart, byRole, byCode, byId };
}

/** lines → header, lines, the balance rows of every line (both grains), in this transaction */
async function writeLines(h, entity, head, lines, fy, period) {
  const no = await S.nextNo(h, entity, 'JV', fy);
  const entry_no = E.packs().jvNo(fy, no);
  const row = await S.insertEntry(h, entity, Object.assign({}, head, { entry_no, fiscal_year: fy, period }));
  await S.insertLines(h, entity, row.entry_id, lines);
  await S.addBalances(h, entity, balanceRows(lines, fy, period));
  return { entry_id: row.entry_id, entry_no };
}

async function writeJournal(h, entity, s, ev, withItems) {
  const C = await chartOf(h, entity);
  const pack = E.packWith(packOf(s), C.chart);
  const docDate = ymd(ev.date);
  const when = await postingDateFor(h, entity, docDate, pack, ev.type === 'opening', !!ev.strict_date, s);
  const posted = E.posting().post(Object.assign({}, ev, { date: when.date }), { pack, functional: pack.currency });
  if (!posted || !posted.ok) throw refuse(posted && posted.why ? posted.why : 'The posting rules refused the entry.');
  const lines = posted.lines.map((l, i) => {
    const a = (l.code ? C.byCode.get(String(l.code)) : null) || (l.account ? C.byRole.get(l.account) : null);
    if (!a) throw refuse('The shop\'s chart has no ledger for "' + (l.account || '') + '"' + (l.code ? ' (' + l.code + ')' : '') + '.');
    if (a.is_group) throw refuse('"' + a.name + '" is a group — an entry posts to a ledger under it.');
    return { line_no: i + 1, account_id: a.account_id, code: String(a.code), role: a.role, party_id: l.party || null, dr_minor: l.dr_minor, cr_minor: l.cr_minor,
             currency: l.currency, amount_txn_minor: l.amount_txn_minor, fx_rate: l.fx_rate, counter_id: ev.counter || null, tax_rate: l.rate != null ? String(l.rate) : null };
  });
  /* ⚠️ the party documents are decided (and a bill named for two parties refused) BEFORE the first row is written */
  const plan = withItems ? await planItems(h, entity, ev, lines) : null;
  const out = await writeLines(h, entity, {
    posting_date: when.date, doc_date: docDate, source_chit_id: ev.source_chit_id, source_ref: ev.source_ref, source_chit_ids: ev.source_chit_ids, event_type: ev.type, rule_version: posted.rule,
    reverses_entry_id: null, is_opening: !!posted.is_opening, narration: posted.narration || ev.narration || null, currency: posted.currency,
    total_minor: posted.totals.dr_minor, created_by: ev.by }, lines, when.fy, when.period);
  let items = [], note = null;
  if (withItems) { const r = await itemsFor(h, entity, ev, plan, out.entry_id, docDate); items = r.rows; note = r.note; await S.insertItems(h, entity, items); }
  return { ok: true, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: when.date, doc_date: docDate, moved: when.moved, lines: lines.length, items: items.length, note };
}

/**
 * lines → the monthly balance rows: every line on its account, and again on account+party when it names a party —
 * exactly CBLedger.accumulate's two grains (tests/books-post.test.cjs holds them equal).
 */
function balanceRows(lines, fy, period) {
  const m = new Map();
  const add = (account_id, party_key, l) => {
    const k = account_id + '|' + (party_key || S.ZERO) + '|' + l.currency;
    const r = m.get(k) || { account_id, party_key: party_key || S.ZERO, currency: l.currency, fiscal_year: fy, period, dr_minor: 0, cr_minor: 0, line_count: 0 };
    r.dr_minor += l.dr_minor; r.cr_minor += l.cr_minor; r.line_count += 1; m.set(k, r);
  };
  for (const l of lines) { add(l.account_id, null, l); if (l.party_id) add(l.account_id, l.party_id, l); }
  return Array.from(m.values());
}

const BILL_KIND = { sale_bill: 'sale', purchase_bill: 'sale', credit_given: 'credit_given', opening: 'opening_balance', manual: 'debit_note', expense: 'sale' };
const CREDIT_KIND = { payment_received: 'payment', payment_made: 'payment', return: 'return', credit_note: 'credit_note', purchase_return: 'return', write_off: 'write_off', manual: 'credit_note', opening: 'payment' };

/**
 * the party items a journal entry makes, one document per debtors / creditors line that names a party (CBReceivables):
 *   + on the party's side (a sale, a purchase, credit given, an opening bill) → itemsOfBill: +amount against itself, due date
 *   − (a payment, a return, a write-off)                                       → itemsOfPayment: −amount against itself …
 *     … and, when the event names the bill it settles, confirmItems() moves it onto that bill at once (a return against its
 *     own bill). A refusal there (the bill disputed, or already settled) leaves it on account — said in `note`, not failed.
 */
async function planItems(h, entity, ev, lines) {
  const b0 = ev.doc_ref || (ev.type === 'payment_received' || ev.type === 'payment_made' ? ev.against_ref : null) || ev.source_chit_id || ev.source_ref || ev.ref || null;
  const base = b0 == null ? null : String(b0);                     /* null: the entry's own id, which no other row can hold yet */
  /**
   * ⚠️⚠️ A DOCUMENT BELONGS TO ONE PARTY (critic M2, 2026-09-30). CBReceivables.outstanding() refuses a document stamped
   * with two parties, and Dues reads the whole control account — so ONE such row broke Dues, every balance and every
   * proposal for the whole shop, and the rows are insert-only: it could not be repaired. So, before anything is a row:
   *   · an entry that names several parties gives each its OWN default document (<id>:<party>);
   *   · a default id another party already holds on that account (two entries typed with one reference) gets the same;
   *   · a bill reference a PERSON named for two parties is refused in words — a bill is one party's.
   */
  const plan = [];
  for (const l of lines) {
    if (!l.party_id || (l.role !== 'debtors' && l.role !== 'creditors')) continue;
    const signed = l.role === 'debtors' ? l.dr_minor - l.cr_minor : l.cr_minor - l.dr_minor;
    if (!signed) continue;
    /* opening / manual lines may each name their own bill (line_refs, in the order handed in — CBPosting keeps it) */
    const lr = Array.isArray(ev.line_refs) ? ev.line_refs[l.line_no - 1] : null;
    const own = lr && String(lr.party || '') === String(l.party_id) && lr.bill_ref ? lr : null;
    const named = own ? String(own.bill_ref) : (signed > 0 && ev.type === 'opening' && ev.against_ref ? String(ev.against_ref) : null);
    plan.push({ l, signed, own, named, own_doc: false });
  }
  const several = new Set(plan.map((p) => String(p.l.party_id))).size > 1;
  for (const p of plan) if (!p.named && several) p.own_doc = true;
  const docOf = (p) => p.named || (base == null ? null : base + (p.own_doc ? ':' + p.l.party_id : ''));
  const twoParties = (ref) => refuse('Bill ' + ref + ' is given for two parties — a bill reference belongs to one party. Give each its own.');
  const holder = new Map();                                        /* account|doc → the party this entry gives it to */
  for (const p of plan) {
    if (!p.named) continue;
    const k = p.l.account_id + '|' + p.named, was = holder.get(k);
    if (was !== undefined && was !== String(p.l.party_id)) throw twoParties(p.named);
    holder.set(k, String(p.l.party_id));
  }
  for (const account_id of new Set(plan.map((p) => p.l.account_id))) {
    const mine = plan.filter((p) => p.l.account_id === account_id);
    const docs = Array.from(new Set(mine.map(docOf).filter(Boolean)));
    const held = docs.length ? await S.itemOwners(h, entity, account_id, docs) : [];
    for (const p of mine) {
      if (!held.some((x) => String(x.ref) === docOf(p) && String(x.party_id) !== String(p.l.party_id))) continue;
      if (p.named) throw twoParties(p.named);
      p.own_doc = true;
    }
  }
  return { base, rows: plan };
}
async function itemsFor(h, entity, ev, plan, entry_id, docDate) {
  const R = E.receivables(), rows = [], notes = [];
  const base = plan.base == null ? String(entry_id) : plan.base;
  for (const p of plan.rows) {
    const l = p.l, signed = p.signed, own = p.own, id = p.named || (base + (p.own_doc ? ':' + l.party_id : ''));
    const side = sideOfRole(l.role);
    const extra = { entry_id, payment_id: ev.payment_id || null, by: ev.by, currency: l.currency, date: docDate };
    if (signed > 0) {
      const docId = id;
      const due = (own && own.due_date) || ev.due_date || null;
      const t = due ? null : await S.terms(h, entity, l.party_id, side === 'payable' ? 'supplier' : 'customer');
      R.itemsOfBill({ id: docId, party: l.party_id, side, kind: BILL_KIND[ev.type] || 'debit_note', date: docDate, due: due || undefined,
                      amount_minor: signed, currency: l.currency }, { credit_days: t && t.credit_days != null ? Number(t.credit_days) : 0 })
        .forEach((x) => rows.push(E.itemRow(x, l.account_id, extra)));
    } else {
      const made = R.itemsOfPayment({ id, party: l.party_id, side, kind: CREDIT_KIND[ev.type] || 'credit_note', date: docDate, amount_minor: -signed, currency: l.currency });
      made.forEach((x) => rows.push(E.itemRow(x, l.account_id, extra)));
      if (ev.against_ref && String(ev.against_ref) !== id && ev.type !== 'payment_received' && ev.type !== 'payment_made') {
        const have = (await S.items(h, entity, l.party_id, l.account_id)).map(E.itemOf).concat(made);
        const c = R.confirmItems(have, [{ credit: id, debit: String(ev.against_ref), amount: -signed / Math.pow(10, dp(l.currency)) }], docDate);
        if (c.ok) c.rows.forEach((x) => rows.push(E.itemRow(x, l.account_id, extra)));
        else notes.push('Left on account, not set against ' + ev.against_ref + ': ' + (c.why || 'refused'));
      }
    }
  }
  return { rows, note: notes.join(' ') || null };
}
function dp(cur) { try { const M = require('./money'); return M.decimals ? M.decimals(cur) : 2; } catch (_) { return 2; } }

/** a party's control account (debtors for a customer / receivable, creditors for a supplier / payable) */
async function controlOf(h, entity, side) {
  const role = roleOfSide(side);
  const a = (await S.accounts(h, entity)).find((x) => x.role === role);
  if (!a) throw refuse('The shop\'s chart has no ' + role + ' ledger.');
  return a;
}
async function partyItems(h, entity, party, account_id) { return (await S.items(h, entity, party, account_id)).map(E.itemOf); }

/** ⭐ propose → the owner confirms → confirmItems() checks it (disputed frozen, uncleared cheque, never more than is left) */
async function writeAllocation(h, entity, ev) {
  const acct = await controlOf(h, entity, ev.side);
  const items = await partyItems(h, entity, ev.party, acct.account_id);
  const cur = (ev.currency || (items[0] && items[0].currency) || 'INR').toUpperCase();
  const confirmed = (ev.allocations || []).filter((a) => Number(a.amount_minor) > 0)
    .map((a) => ({ credit: String(ev.credit_ref), debit: String(a.against_ref), amount: Number(a.amount_minor) / Math.pow(10, dp(cur)) }));
  if (!confirmed.length) throw refuse('Nothing to allocate.');
  const c = E.receivables().confirmItems(items, confirmed, ymd(ev.date) || new Date().toISOString().slice(0, 10));
  if (!c.ok) throw refuse(c.why || 'The allocation was refused.');
  const rows = c.rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: ev.payment_id, by: ev.by, currency: cur }));
  await S.insertItems(h, entity, rows);
  return { ok: true, items: rows.length, allocated_minor: rows.filter((r) => r.amount_minor < 0).reduce((t, r) => t - r.amount_minor, 0) };
}
/** a status row (disputed · undisputed) — never an UPDATE */
async function writeStatus(h, entity, ev) {
  const acct = await controlOf(h, entity, ev.side);
  const x = E.receivables().statusItem({ ref: String(ev.against_ref), party: ev.party, side: sideOfRole(acct.role), currency: ev.currency || 'INR' }, ev.status, ymd(ev.date) || new Date().toISOString().slice(0, 10));
  await S.insertItems(h, entity, [E.itemRow(x, acct.account_id, { by: ev.by, note: ev.note })]);
  return { ok: true, status: ev.status };
}
/** a cheque received / issued: only a status row holding the amount as pending, until it clears (C3) */
async function writeChequeReceived(h, entity, ev) {
  const acct = await controlOf(h, entity, ev.side);
  const rows = E.receivables().itemsOfPayment({ id: 'pay:' + ev.payment_id, party: ev.party, side: sideOfRole(acct.role), kind: 'payment', date: ymd(ev.date),
    amount_minor: ev.amount_minor, currency: ev.currency, cheque: Object.assign({ status: 'received' }, ev.cheque || {}) });
  await S.insertItems(h, entity, rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: ev.payment_id, by: ev.by })));
  return { ok: true, items: rows.length };
}
/**
 * a cheque's next step, from its own rows (itemsOfCheque enforces received → deposited → cleared | bounced). CLEARED
 * posts the payment's journal entry; BOUNCED after clearing reverses it — the party rows (the money row on clearing, the
 * reversal rows on a bounce) come from the engine, so the journal writes none of its own here.
 */
async function writeChequeStep(h, entity, s, ev) {
  const p = await S.payment(h, entity, ev.payment_id);
  if (!p || p.mode !== 'cheque') throw refuse('No such cheque.', 'BOOKS_NOT_FOUND');
  const acct = await controlOf(h, entity, p.direction === 'in' ? 'customer' : 'supplier');
  const ref = 'pay:' + p.payment_id, on = ymd(ev.date) || new Date().toISOString().slice(0, 10);
  const items = await partyItems(h, entity, p.party_id, acct.account_id);
  const rows = E.receivables().itemsOfCheque(items, ref, ev.to, on);
  await S.insertItems(h, entity, rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: p.payment_id, by: ev.by })));
  const out = { ok: true, status: ev.to, items: rows.length };
  if (ev.to === 'cleared') {
    out.posted = await writeJournal(h, entity, s, paymentEvent(p, { mode: 'cheque', date: on, by: ev.by }), false);
  }
  if (ev.to === 'bounced') {
    const done = await S.entryBySource(h, entity, ref);
    if (done && !(await S.entryBySource(h, entity, 'reverse:' + done.entry_id)))
      out.reversed = await writeReversal(h, entity, s, { reverses: done.entry_id, reason: 'Cheque ' + (p.cheque_no || '') + ' bounced', by: ev.by, source_ref: 'reverse:' + done.entry_id }, false);
  }
  return out;
}
/**
 * ⭐ recordPayment(h, entity, p) — THE ONE WAY A PAYMENT IS RECORDED (POST /api/books/payments, and the counter's
 * "money received" chit through lib/books-hooks): the payment row and its entry in the caller's ONE transaction, so a
 * refusal (a locked month) leaves nothing half-recorded. A cheque is HELD: a status row only, until it clears (C3).
 *   p: { party_id, direction: in|out, amount_minor, currency, mode, reference?, cheque_no?, cheque_bank?, cheque_date?,
 *        received_at: 'YYYY-MM-DD', client_ref? (a replay never records it twice), source_chit_id?, by?, strict_date? }
 * ⭐ IDEMPOTENT ON client_ref (unique per shop; critic M11): the same ref returns the FIRST result — that payment, its
 *   own status, its own entry, `duplicate: true` — before anything about the new body is looked at, and never posts again.
 * ⚠️⚠️ FOR EVERY CALLER (the route, and the counter's chit through the hook; critic M9): the party must be on the shop's
 *   customer or supplier list — money was paid OUT to any uuid; and a typed date must be one the ledger can hold (a cheque
 *   included: it posts nothing until it clears, so nothing else would have looked at its date).
 */
async function firstPayment(h, entity, payment_id) {
  const was = await S.payment(h, entity, payment_id);
  const seen = await S.entryBySource(h, entity, 'pay:' + payment_id);
  return { payment: { payment_id, status: was && was.mode === 'cheque' ? 'cheque_received' : 'recorded', duplicate: true },
    posted: seen ? { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: ymd(seen.posting_date) } : { ok: true, duplicate: true } };
}
async function recordPayment(h, entity, p) {
  if (p.client_ref) { const first = await S.paymentByRef(h, entity, p.client_ref); if (first) return firstPayment(h, entity, first.payment_id); }
  if (!Number.isSafeInteger(p.amount_minor) || !(p.amount_minor > 0)) throw refuse('A payment is a whole amount of minor units, more than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.received_at || ''))) throw refuse('A payment needs its date (YYYY-MM-DD).');
  const on = await S.partyOn(h, entity, p.party_id);
  if (!on || !(on.customer || on.supplier)) throw refuse('That party is not on this shop\'s customer or supplier list — add them first.');
  if (p.strict_date) { const s = await settingOf(h, entity); typedDate(s, packOf(s), p.received_at, false); }
  const pay = await S.insertPayment(h, entity, p);
  const status = p.mode === 'cheque' ? 'cheque_received' : 'recorded';
  if (pay.duplicate) return firstPayment(h, entity, pay.payment_id);   /* two requests at once: the index decided */
  const row = Object.assign({}, p, { payment_id: pay.payment_id });
  const posted = p.mode === 'cheque'
    ? await postEntry(h, entity, { type: 'cheque_received', party: p.party_id, side: p.direction === 'in' ? 'customer' : 'supplier', payment_id: pay.payment_id,
        amount_minor: p.amount_minor, currency: p.currency, date: p.received_at, cheque: { no: p.cheque_no || null }, by: p.by })
    : await postEntry(h, entity, Object.assign(paymentEvent(row, { by: p.by }), { strict_date: !!p.strict_date, source_chit_id: p.source_chit_id || undefined }));
  return { payment: { payment_id: pay.payment_id, status, duplicate: false }, posted };
}
/** the payment's journal event (CBPosting payment_received / payment_made) */
function paymentEvent(p, o) {
  const cur = String(p.currency || 'INR').toUpperCase();
  return { type: p.direction === 'in' ? 'payment_received' : 'payment_made', party: p.party_id, amount: Number(p.amount_minor) / Math.pow(10, dp(cur)), currency: cur,
           mode: o.mode || p.mode, cheque_status: (o.mode || p.mode) === 'cheque' ? 'cleared' : undefined, date: o.date || ymd(p.received_at),
           ref: 'pay:' + p.payment_id, source_ref: 'pay:' + p.payment_id, payment_id: p.payment_id, against_ref: 'pay:' + p.payment_id, doc_ref: 'pay:' + p.payment_id, by: o.by };
}

/**
 * ⭐ the correction: the same lines, debit and credit swapped, pointing at the original — dated in the original's month
 * when that month is open, else on the first open date. Its party rows: CBReceivables.reverseItems for every document
 * the original's rows came from (a cheque bounce passes withItems=false: itemsOfCheque already wrote them).
 */
async function writeReversal(h, entity, s, ev, withItems) {
  const orig = await S.entry(h, entity, ev.reverses);
  if (!orig) throw refuse('No such entry.', 'BOOKS_NOT_FOUND');
  if (orig.reverses_entry_id) throw refuse('That entry is itself a reversal — post the original again instead.');
  if (!String(ev.reason || '').trim()) throw refuse('A reversal needs a reason.');
  const pack = packOf(s);
  const when = await postingDateFor(h, entity, ymd(orig.posting_date), pack, !!orig.is_opening, false, s);
  const C = await chartOf(h, entity);
  const lines = orig.lines.map((l, i) => ({ line_no: i + 1, account_id: l.account_id, code: (C.byId.get(String(l.account_id)) || {}).code, role: (C.byId.get(String(l.account_id)) || {}).role,
    party_id: l.party_id, dr_minor: Number(l.cr_minor), cr_minor: Number(l.dr_minor), currency: l.currency, amount_txn_minor: l.amount_txn_minor, fx_rate: l.fx_rate,
    counter_id: l.counter_id, tax_rate: l.tax_rate }));
  const out = await writeLines(h, entity, { posting_date: when.date, doc_date: ymd(orig.doc_date || orig.posting_date), source_chit_id: orig.source_chit_id,
    source_ref: ev.source_ref || ('reverse:' + orig.entry_id), event_type: 'reversal', rule_version: orig.rule_version, reverses_entry_id: orig.entry_id,
    is_opening: !!orig.is_opening, narration: 'Reversal of ' + orig.entry_no + ' — ' + String(ev.reason).slice(0, 300), currency: orig.currency,
    total_minor: Number(orig.total_minor), created_by: ev.by }, lines, when.fy, when.period);
  let items = 0;
  if (withItems) {
    const R = E.receivables(), rows = [];
    const refs = new Map();
    (orig.items || []).forEach((it) => { if (it.ref_kind !== 'status') refs.set(it.party_id + '|' + it.account_id + '|' + it.ref, it); });
    for (const it of refs.values()) {
      const all = await partyItems(h, entity, it.party_id, it.account_id);
      R.reverseItems(all, it.ref, when.date).forEach((x) => rows.push(E.itemRow(x, it.account_id, { entry_id: out.entry_id, by: ev.by })));
    }
    await S.insertItems(h, entity, rows); items = rows.length;
  }
  return { ok: true, entry_id: out.entry_id, entry_no: out.entry_no, posting_date: when.date, moved: when.moved, reverses: orig.entry_no, items };
}

/** reverseEntry — the owner's correction, through the one writer */
async function reverseEntry(db, entity, entry_id, opt) {
  const o = opt || {};
  if (!String(o.reason || '').trim()) throw refuse('A reversal needs a reason.');
  return postEntry(db, entity, { type: 'reversal', reverses: entry_id, reason: o.reason, by: o.by, source_ref: 'reverse:' + entry_id });
}

/* ═══ the switch: seed the chart and the year, then turn on ══════════════════════════════════════════════════════ */

/**
 * enable(db, entity, { by, walkin_grain, today }) — the shop's chart from its country pack (groups, then ledgers under
 * them), this year's months, party numbers for everyone already on the lists, then the switch. Safe to run twice.
 */
async function enable(db, entity, opt) {
  const o = opt || {};
  return onDb(db, entity, async (h) => {
    const cur = await settingOf(h, entity);
    if (cur === null) throw refuse('The ledger tables are not created yet — run migrations b272–b274 first.', 'BOOKS_NOT_MIGRATED');
    const country = String(o.country || (cur && cur.country) || 'IN').toUpperCase();
    const pack = E.packs().packFor(country);
    const rows = E.chartRows(pack);
    const idOf = new Map((await S.accounts(h, entity)).map((a) => [a.code, a.account_id]));
    const keyToCode = new Map(rows.map((r) => [r.key, r.code]));
    let added = 0;
    for (const r of rows) {
      if (idOf.has(r.code)) continue;
      const parent = r.parent ? idOf.get(keyToCode.get(r.parent)) : null;
      const id = await S.insertAccount(h, entity, { code: r.code, name: r.name, parent_id: parent || null, is_group: r.is_group, nature: r.nature, role: r.role,
        pack_code: country, pack_version: o.pack_version || null, tally_group: r.tally_group, sch3_line: r.sch3_line, saft_grouping: r.saft_grouping, by: o.by });
      if (id) { idOf.set(r.code, id); added++; }
    }
    const fy = E.packs().fiscalYearOf(o.today || new Date().toISOString().slice(0, 10), pack);
    await ensureYear(h, entity, fy, pack);
    await S.saveSetting(h, entity, { enabled: true, walkin_grain: o.walkin_grain || (cur && cur.walkin_grain) || 'day', fy_start_month: pack.fy_start_month,
      functional_currency: pack.currency, country, pack_version: o.pack_version || null, by: o.by });
    await S.logChange(h, entity, { by: o.by, table_name: 'books_setting', row_id: entity, field: 'enabled', old: cur ? String(!!cur.enabled) : null, new: 'true' });
    /* every party already on the lists gets its number now, oldest first (b274; skipped without it) */
    const numbered = await require('../db').trySavepoint(h, () => require('./party-fields').numberAll(h, entity), null);
    offSaid.delete(String(entity));
    return { ok: true, accounts_added: added, fiscal_year: fy, parties_numbered: numbered };
  });
}

/** a ledger the shop adds under a group: the next free code in the group's range, role null (SPEC §0) */
async function addAccount(db, entity, a) {
  return onDb(db, entity, async (h) => {
    const chart = await S.accounts(h, entity);
    const group = chart.find((x) => String(x.account_id) === String(a.parent_id) && x.is_group);
    if (!group) throw refuse('Pick the group this ledger belongs under.');
    const name = String(a.name || '').trim().slice(0, 120);
    if (!name) throw refuse('A ledger needs a name.');
    const s = await settingOf(h, entity); const pack = packOf(s);
    const key = (pack.groups || []).find((g) => E.groupCode(g) === group.code);
    const code = key ? E.packs().nextCode(E.packWith(pack, chart), key.code, chart.map((x) => x.code)) : null;
    if (!code) throw refuse('The group "' + group.name + '" has no free code left.');
    try { E.packs().withAccounts(E.packWith(pack, chart), [{ code, name, group: key.code }]); } catch (e) { throw refuse(e.message); }
    const id = await S.insertAccount(h, entity, { code, name, parent_id: group.account_id, is_group: false, nature: group.nature, role: null, tally_group: group.tally_group,
      sch3_line: group.sch3_line, saft_grouping: group.saft_grouping, by: a.by });
    await S.logChange(h, entity, { by: a.by, table_name: 'ledger_account', row_id: id, field: 'created', new: code + ' ' + name });
    return { ok: true, account_id: id, code, name };
  });
}

/** lock / unlock a month — soft is reversible with a reason, hard is not (Odoo lock vs hard lock) */
async function setPeriod(db, entity, fy, period, status, by, reason) {
  return onDb(db, entity, async (h) => {
    const rows = await S.periods(h, entity, fy);
    const row = rows.find((r) => Number(r.period) === Number(period));
    if (!row) throw refuse('No such month.', 'BOOKS_NOT_FOUND');
    if (row.status === 'hard_locked') throw refuse('That month is closed for good.');
    if (status === 'open' && !String(reason || '').trim()) throw refuse('Opening a locked month needs a reason.');
    await S.setPeriodStatus(h, entity, fy, period, status, by, reason);
    await S.logChange(h, entity, { by, table_name: 'fiscal_period', row_id: fy + '/' + period, field: 'status', old: row.status, new: status + (reason ? ' — ' + reason : '') });
    return { ok: true, fiscal_year: fy, period: Number(period), status };
  });
}

/* ═══ what the ledger engine reads: month rows (with the COMPUTED carryforward) + the open month's lines ════════ */

/**
 * yearBalances(h, entity, fy) → CBLedger balance rows for one year: the stored month rows (period 0 holds any opening
 * entries) + period 0 carried forward from the year before, COMPUTED by CBLedger.carryForward (SAP carryforward; no
 * journal entry, never stored — so a permitted late correction to the old year flows through by itself).
 */
async function yearBalances(h, entity, fy, ctx, depth) {
  const c = ctx || await ledgerCtx(h, entity);
  if (c.cache[fy]) return c.cache[fy];
  const A = E.packs();
  let rows = (await S.yearRows(h, entity, fy)).map((r) => E.balanceOf(r, S.ZERO));
  const prev = A.fiscalYearOf(addDays(A.fyRange(fy, c.pack).start, -1), c.pack);
  if (c.years.length && c.years[0] <= prev && (depth || 0) < 30) {
    const before = await yearBalances(h, entity, prev, c, (depth || 0) + 1);
    const cf = E.ledger().carryForward({ pack: c.pack, balances: before, lines: [], fiscal_year: prev });
    /* ⚠️⚠️ NEVER AN EMPTY CARRY, SILENTLY (engines v1.8.1): while last year's Suspense is not nil the engine carries NOTHING —
       and a new year that opened at zero would still "balance". Refused by name instead; clearing Suspense lifts it. */
    if (cf.ok === false) throw refuse(SUSPENSE_NOT_NIL(prev), 'SUSPENSE_NOT_NIL');
    rows = rows.concat(cf.rows.map((r) => ({ fiscal_year: r.fiscal_year, period: 0, code: r.code, party: r.party, dr_minor: r.dr_minor, cr_minor: r.cr_minor })));
  }
  c.cache[fy] = rows;
  return rows;
}
async function ledgerCtx(h, entity) {
  const s = await settingOf(h, entity);
  const chart = await S.accounts(h, entity);
  return { s, chart, pack: E.packWith(packOf(s), chart), years: await S.years(h, entity), cache: {} };
}
const lineRows = async (h, entity, from, to, party) => (await S.ledgerLines(h, entity, from, to, party)).map(E.lineOf);
function monthStart(pack, date) { const A = E.packs(); return A.periodRange(A.fiscalYearOf(date, pack), A.periodOf(date, pack), pack).start; }

/** CBLedger's input for "as at `asOf`": the year's rows + the lines of asOf's month up to asOf */
async function asAtInput(h, entity, asOf, c) {
  const x = c || await ledgerCtx(h, entity);
  const fy = E.packs().fiscalYearOf(asOf, x.pack);
  return { pack: x.pack, balances: await yearBalances(h, entity, fy, x), lines: await lineRows(h, entity, monthStart(x.pack, asOf), asOf), asOf };
}
async function trialBalance(h, entity, asOf) { return E.ledger().trialBalance(await asAtInput(h, entity, asOf)); }
async function balanceSheet(h, entity, asOf) { return E.ledger().balanceSheet(await asAtInput(h, entity, asOf)); }
/** P&L inside one fiscal year: the rows + the lines of the month of `to` and of the day before `from` */
async function profitAndLoss(h, entity, from, to) {
  const c = await ledgerCtx(h, entity); const A = E.packs();
  const fy = A.fiscalYearOf(to, c.pack);
  const prev = addDays(from, -1);
  const lines = (await lineRows(h, entity, monthStart(c.pack, to), to))
    .concat(A.fiscalYearOf(prev, c.pack) === fy && A.periodOf(prev, c.pack) !== A.periodOf(to, c.pack) ? await lineRows(h, entity, monthStart(c.pack, prev), prev) : []);
  return E.ledger().profitAndLoss({ pack: c.pack, balances: await yearBalances(h, entity, fy, c), lines, from, to });
}
/** one party on one control account: rows of from's year + every line from the month of `from` to `to` */
async function partyStatement(h, entity, party, role, from, to) {
  const c = await ledgerCtx(h, entity); const A = E.packs();
  const a = c.chart.find((x) => x.role === role); if (!a) return null;
  const fy = A.fiscalYearOf(from, c.pack);
  return E.ledger().partyStatement({ pack: c.pack, balances: await yearBalances(h, entity, fy, c), lines: await lineRows(h, entity, monthStart(c.pack, from), to, party),
    party, code: String(a.code), from, to });
}
/** one ledger (any account, or account+party) between two dates: its opening from the rows, then its lines */
async function ledgerOf(h, entity, account, party, from, to) {
  const c = await ledgerCtx(h, entity); const A = E.packs();
  const prev = addDays(from, -1), fy = A.fiscalYearOf(from, c.pack);
  /* ⚠️ on the first day of a year the opening is the CARRIED period 0 (an income ledger opens at nil), not last year's close */
  const inp = A.fiscalYearOf(prev, c.pack) === fy ? await asAtInput(h, entity, prev, c)
    : { pack: c.pack, balances: (await yearBalances(h, entity, fy, c)).filter((r) => Number(r.period) === 0), lines: [], asOf: from };   /* period 0 only: the engine refuses a mid-month date whose own month row is given without its lines */
  const b = E.ledger().balanceAsAt(inp);
  const code = String(account.code);
  const open = party ? (((b.parties || {})[code] || {})[party] || { net_minor: 0 }).net_minor : ((b.accounts || {})[code] || { net_minor: 0 }).net_minor;
  return { opening_minor: open };
}
/** the nightly controls (CBLedger.controls) as at a date */
async function controls(h, entity, asOf) { return E.ledger().controls(await asAtInput(h, entity, asOf)); }

module.exports = { postEntry, reverseEntry, recordPayment, enable, addAccount, setPeriod, settingOf, packOf, controlOf, partyItems, paymentEvent,
  addDays, ensureYear, postingDateFor, balanceRows, yearBalances, ledgerCtx, asAtInput, trialBalance, balanceSheet, profitAndLoss,
  partyStatement, ledgerOf, controls, monthStart, _resetOffSaid: () => offSaid.clear() };
