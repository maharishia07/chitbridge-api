// @stage tested
// @stage-note [BOOKS v2] postEntry — THE ONE WRITER of journal_entry / journal_line / account_balance / party_item, in one
// @stage-note transaction; reversals, cheques, allocations and status rows through it too. Off unless the shop enabled it.
'use strict';
/**
 * lib/books.js — A RECORD KEPT BY DOUBLE-ENTRY PRINCIPLE (SPEC-books-v2 §3, §6).
 *
 * OWNS       postEntry — the one writer of journal · lines · balances · party items; the period-open rule (postingDateFor); the allocation lock (lockedItems).
 * CALLED BY  lib/books-hooks (chits → entries) · lib/books-period · lib/books-recurring · routes/books.js
 * FLOW       postEntry → ensureYear (months FOR SHARE) → postingDateFor → plan lines → insert (party rows read under lib/xact-lock) → balances
 * CARD 16-finance/books-posting
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
const CLOCK = require('./shop-clock');
const log = require('./logger');
const E = require('./books-engines');
const S = require('./books-store');
const { replayOf } = require('./books-replay'); /* FIN-63 step 2: a repeated confirm answers duplicate */
const CS = require('./country-setup'); /* WX-R2R: enable() opens the ledger on the Country setup's country · currency · year start */

const offSaid = new Set();
/* ⚠️ the exact sentence the web's friendlyErr maps (code PERIOD_LOCKED) — the harness asserts it; change both together */
const PERIOD_LOCKED = 'That month is locked. Open it again (with a reason) to record this.';
const SUSPENSE_NOT_NIL = (fiscalYear) => 'The opening balances of ' + fiscalYear + ' did not balance: Suspense is not nil. Clear it to see figures after that year.';
const fxRates = () => require('./fx-rates'); /* FX1: lazy — fx-rates reads this module */
/** minor → major in the currency's own decimals: the api's ONE (books-cashflow.fromMinor), lazy — that module reads this one (ACC-179) */
const fromMinor = (minor, currency) => require('./books-cashflow').fromMinor(minor, currency);
/** a refusal as an Error: the words for the person, a code (BOOKS_REFUSED unless named) and refused: true — thrown, never a 500 */
function refuse(reason, code) {
  const e = new Error(reason);
  e.code = code || 'BOOKS_REFUSED';
  e.refused = true;
  return e;
}
const isoDay = E.ymd;
const addDays = E.addDays;
const stated = CS.currencyStated; /* T2-NATDEF: the stated currency or null — never INR by name */
/** an engine refusal (status 409/422 on the Error) is a refusal here too — named, never a 500 */
function engineRefusal(e) {
  if (e && (e.status === 409 || e.status === 422) && !e.code) {
    e.code = 'BOOKS_REFUSED';
    e.refused = true;
  }
  return e;
}

/** the handle: the caller's (inside its transaction) or our own withEntity */
function onDb(db, entity, fn) {
  return db ? fn(db) : require('../db').withEntity(entity, fn);
}

/**
 * the shop's switch — in a savepoint, so the transaction lives.
 * ⚠️⚠️ null means ONE thing: the table is not there (42P01, b272 not run). A shop that simply has no row yet is OFF —
 *   { entity_id, enabled: false } — never null: enable() read null as "not migrated", nothing else ever inserts the row,
 *   so no shop could be switched on (critic M1, 2026-09-30; every test had seeded a row first).
 */
async function settingOf(db, entity) {
  await db.query('SAVEPOINT books_setting_read');
  try {
    const settingRow = await S.setting(db, entity);
    await db.query('RELEASE SAVEPOINT books_setting_read');
    return settingRow || { entity_id: entity, enabled: false };
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT books_setting_read').catch(log.orElse('books settingOf: the read failed — carried on without it'));
    if (e && e.code === '42P01') return null;
    throw e;
  }
}
/** the country pack a books setting runs on, with the setting's own year start and money laid over it */
function packOf(setting) {
  const countryPack = E.packs().packFor(setting && setting.country); /* GOV-AU1: a books setting always holds its country (b272 NOT NULL; enable refuses none) — no 'IN' here */
  return Object.assign({}, countryPack, { fy_start_month: (setting && setting.fy_start_month) || countryPack.fy_start_month, currency: (setting && setting.functional_currency) || countryPack.currency });
}
/** CX2 (A3): the ledger's money — the setting's, else its country pack's; never 'INR' typed (a books route runs only for a shop with a country: CS.gate) */
function curOf(setting) {
  return packOf(setting).currency;
}
const sideOfRole = (role) => (role === 'creditors' ? 'payable' : 'receivable');
const roleOfSide = (side) => (side === 'payable' || side === 'supplier' ? 'creditors' : 'debtors');

/* ═══ periods ══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** the year's months exist (created open, the first time an entry lands in that year) */
async function ensureYear(db, entity, fy, pack, readOnly) {
  const have = await S.periods(db, entity, fy, !readOnly); /* M1: a posting holds the months FOR SHARE until it commits */
  if (have.length >= 13) return have;
  const packs = E.packs();
  const yearRange = packs.fyRange(fy, pack);
  /* ⭐ A PREVIEW WRITES NOTHING: a year not yet started is read as all open — the months it would create are created open — and nothing is inserted */
  if (readOnly) {
    const row = (period, range) =>
      have.find((x) => Number(x.period) === period) || { fiscal_year: fy, period, start_date: range.start, end_date: range.end, status: 'open' };
    const rows = [row(0, { start: yearRange.start, end: yearRange.start })];
    for (let count = 1; count <= 12; count++) rows.push(row(count, packs.periodRange(fy, count, pack)));
    return rows;
  }
  await S.insertPeriod(db, entity, { fiscal_year: fy, period: 0, start_date: yearRange.start, end_date: yearRange.start });
  for (let count = 1; count <= 12; count++) {
    const range = packs.periodRange(fy, count, pack);
    await S.insertPeriod(db, entity, { fiscal_year: fy, period: count, start_date: range.start, end_date: range.end });
  }
  return S.periods(db, entity, fy);
}
/**
 * ⭐ THE LEDGER'S FIRST DAY: the start of the financial year it was switched on in (books_setting.enabled_at, read as the
 * shop's day). Nothing posts before it — what was owed before then comes in as opening balances. null = not known.
 */
function ledgerStart(setting, pack) {
  if (!setting || !setting.enabled_at) return null;
  const ledgerDay = require('./books-hooks').dayOf(setting.enabled_at, setting);
  const packs = E.packs(),
    fiscalYear = ledgerDay ? packs.fiscalYearOf(ledgerDay, pack) : null;
  return fiscalYear ? isoDay(packs.fyRange(fiscalYear, pack).start) : null;
}
/**
 * ⚠️⚠️ A DATE A PERSON TYPED MUST BE ONE THE LEDGER CAN HOLD (critic M9, 2026-09-30): POST /payments with received_at
 * '2020-01-01' posted, and financial year 2019-20 then EXISTED — every later report carried forward from it. Refused in
 * words: before the ledger's first day (any typed date, and opening balances), or later than tomorrow (the shop's day).
 */
function typedDate(setting, pack, date, opening) {
  const typedDay = isoDay(date),
    first = ledgerStart(setting, pack);
  if (first && typedDay < first) throw refuse('That date is before this ledger began (' + first + '). What was owed before then goes in as an opening balance.');
  if (opening) return;
  const today = require('./books-hooks').dayOf(CLOCK.now(), setting);
  if (today && typedDay > addDays(today, 1)) throw refuse('That date is in the future.');
}
/**
 * the date an entry dated `date` posts on: itself when its month is open, else the first day of the first open month
 * after it (this year or the next two). Opening entries (period 0) never move: a locked period 0 refuses them.
 * ⭐ THE YEARS BEFORE THE LEDGER BEGAN ARE CLOSED, by the same rule as a locked month: a CHIT dated before the ledger's
 *   first day (a counter whose clock is wrong, a supplier's old invoice) posts on that first day, its own date kept
 *   (moved: true) — it never creates an old financial year. A date a person typed is refused instead (typedDate).
 */
async function postingDateFor(db, entity, date, pack, opening, strict, setting, readOnly) {
  const packs = E.packs();
  let entryDay = isoDay(date),
    early = false;
  if (!entryDay || !packs.fiscalYearOf(entryDay, pack)) throw refuse('The entry has no date.');
  if (strict || opening) typedDate(setting, pack, entryDay, opening);
  else {
    const first = ledgerStart(setting, pack);
    if (first && entryDay < first) {
      entryDay = first;
      early = true;
    }
  }
  date = entryDay;
  const fiscalYear = packs.fiscalYearOf(date, pack);
  const rows = await ensureYear(db, entity, fiscalYear, pack, readOnly);
  if (opening) {
    const openingPeriod = rows.find((item) => Number(item.period) === 0);
    if (openingPeriod && openingPeriod.status !== 'open') throw refuse('The opening balances of ' + fiscalYear + ' are locked.');
    return { date: isoDay(date), fy: fiscalYear, period: 0, moved: false };
  }
  /* ⭐ ONE RULE (engines v1.20.0 period.postingDate): where an entry lands, or why not. This function only READS the months the shop
     stores (this year's, and the next two for an automatic entry that has to move on) and WRITES the year it lands in. */
  const askEngine = (groups) => E.period().postingDate({ type: 'posting', date }, periodsOf(groups), { strict: !!strict, pack });
  let verdict = askEngine([rows]);
  if (!(verdict.ok && !verdict.moved)) {
    /* the month is locked: the next months may sit in the next years, whose rows are read now */
    const ahead = [];
    for (let index = 1, y = fiscalYear; index <= 2; index++) {
      y = packs.fiscalYearOf(addDays(packs.fyRange(y, pack).end, 1), pack);
      ahead.push(await S.periods(db, entity, y, !readOnly));
    }
    verdict = askEngine([rows].concat(ahead));
  }
  if (!verdict.ok) {
    if (strict) throw refuse(verdict.why, verdict.code);
    throw refuse('Every month from ' + isoDay(date) + ' on is locked — nothing can be posted until one is opened.');
  }
  if (verdict.fiscal_year !== fiscalYear) await ensureYear(db, entity, verdict.fiscal_year, pack, readOnly);
  return { date: verdict.date, fy: verdict.fiscal_year, period: verdict.period, moved: verdict.moved || early };
}
/**
 * the months the shop stores → the shape the period engine reads: only the locked ones, `locked` (soft or hard). A year whose twelve months are all
 * hard-locked is a CLOSED year (POST /year/:fy/close writes exactly that) and reads `closed`, so a typed date in it is refused as YEAR_CLOSED.
 */
function periodsOf(groups) {
  const out = [];
  for (const rows of groups) {
    const months = (rows || []).filter((item) => Number(item.period) >= 1);
    const closed = months.length >= 12 && months.every((item) => item.status === 'hard_locked');
    for (const r of rows || []) {
      if (Number(r.period) < 1 || r.status === 'open') continue;
      out.push({ fiscal_year: r.fiscal_year, period: Number(r.period), status: closed ? 'closed' : 'locked' });
    }
  }
  return out;
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
  return onDb(db, entity, async (handle) => {
    const setting = await settingOf(handle, entity);
    if (!setting || !setting.enabled) {
      if (!offSaid.has(String(entity))) {
        offSaid.add(String(entity));
        require('./logger').info('books.off', { entity_id: entity, why: setting ? 'switched off' : 'tables not created' });
      }
      return { ok: false, off: true };
    }
    const entryEvent = event || {};
    if (entryEvent.source_ref) {
      const seen = await S.entryBySource(handle, entity, entryEvent.source_ref);
      if (seen) return { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: isoDay(seen.posting_date) };
    }
    try {
      if (entryEvent.type === 'allocation') return await writeAllocation(handle, entity, entryEvent);
      if (entryEvent.type === 'party_status') return await writeStatus(handle, entity, entryEvent);
      if (entryEvent.type === 'cheque_received') return await writeChequeReceived(handle, entity, entryEvent);
      if (entryEvent.type === 'cheque_step') return await writeChequeStep(handle, entity, setting, entryEvent);
      if (entryEvent.type === 'reversal') return await writeReversal(handle, entity, setting, entryEvent, true);
      return await writeJournal(handle, entity, setting, entryEvent, true);
    } catch (e) {
      throw engineRefusal(e);
    }
  });
}

/** the chart, twice indexed */
async function chartOf(handle, entity) {
  const chart = await S.accounts(handle, entity);
  const byRole = new Map(),
    byCode = new Map(),
    byId = new Map();
  chart.forEach((item) => {
    if (item.role) byRole.set(item.role, item);
    byCode.set(String(item.code), item);
    byId.set(String(item.account_id), item);
  });
  return { chart, byRole, byCode, byId };
}

/**
 * ⭐ VOUCHER SERIES BY TYPE (engines v1.16.0; DECISIONS "Voucher numbering follows the standard", Athi 2026-10-02): an event takes the series of its
 * voucher type (SV · PV · RV · PY · CV · CN · DN · JV); an entry a PERSON made (the owner's door: manual entry, reversal, write-off) takes the single
 * series MJ and keeps its voucher type beside it. Issued JV/ numbers are never renumbered. The type is the engine's voucherTypeOf, never a table here.
 */
const JOURNAL_VOUCHER = { type: 'Journal', series: 'JV', manual: false };
/** the voucher (type and series) an event takes; an entry a person made (manual) takes the single MJ series */
function voucherOf(entryEvent, manual) {
  const voucher = E.posting().voucherTypeOf(entryEvent, { manual: !!manual });
  return voucher || (manual ? { type: 'Journal', series: E.packs().MANUAL_SERIES, manual: true } : JOURNAL_VOUCHER);
}
/**
 * the voucher type of a STORED entry. journal_entry has no voucher_type column until b279 is run (DRAFT), so it is derived: the column when present,
 * else the series prefix (SV → Sales …), else — an MJ entry — the type of its event (a manual entry is a Journal, a typed write-off a Journal).
 */
function voucherTypeOfEntry(row) {
  const storedEntry = row || {},
    seriesByType = E.packs().VOUCHER_SERIES;
  if (storedEntry.voucher_type) return storedEntry.voucher_type;
  const prefix = String(storedEntry.series || String(storedEntry.entry_no || '').split('/')[0] || 'JV');
  const typeName = Object.keys(seriesByType).find((item) => seriesByType[item] === prefix);
  if (typeName) return typeName;
  const voucher = E.posting().voucherTypeOf({ type: storedEntry.event_type }, { manual: true });
  return voucher ? voucher.type : 'Journal';
}
/**
 * ⭐ DEADLOCK GUARD: take several series counters for one transaction in ALPHABETICAL series order (one fiscal year), never in the order asked.
 * Two transactions that each need SV and PV would otherwise lock them SV→PV and PV→SV and wait on each other. Today an entry needs ONE counter
 * (and no path writes two entries in one transaction); this is the only door to counters, so a path that ever does inherits the order. → { SERIES: n }
 */
async function nextNosInOrder(handle, entity, seriesList, fiscalYear) {
  const out = {};
  for (const setting of Array.from(new Set(seriesList.map(String))).sort()) out[setting] = await S.nextNo(handle, entity, setting, fiscalYear);
  return out;
}
/** lines → header, lines, the balance rows of every line (both grains), in this transaction */
async function writeLines(handle, entity, head, lines, fiscalYear, period, voucher) {
  const activeVoucher = voucher || JOURNAL_VOUCHER;
  /* ONE counter per entry, taken inside this transaction. Were an entry ever to need two, nextNosInOrder takes them in alphabetical order (no cross-wait). */
  const no = (await nextNosInOrder(handle, entity, [activeVoucher.series], fiscalYear))[activeVoucher.series];
  const entry_no = E.packs().voucherNo(activeVoucher.series, fiscalYear, no);
  const row = await S.insertEntry(handle, entity, Object.assign({}, head, { entry_no, series: activeVoucher.series, voucher_type: activeVoucher.type, fiscal_year: fiscalYear, period }));
  await S.insertLines(handle, entity, row.entry_id, lines);
  await S.addBalances(handle, entity, balanceRows(lines, fiscalYear, period));
  return { entry_id: row.entry_id, entry_no, voucher: { type: activeVoucher.type, series: activeVoucher.series, manual: !!activeVoucher.manual } };
}

/**
 * ⭐ A LEDGER ADDED ON FIRST USE (M158): a posting that needs a ledger the shop's chart lacks (a chart seeded before the template grew, or a used-only
 * ledger) takes it from the country pack's template — the row chartRows would have seeded — never a refusal. Read-only (a preview) answers the
 * ledger without writing it. Null only when the template itself has no such ledger.
 */
async function ledgerOnFirstUse(handle, entity, setting, chartIndex, line, readOnly) {
  const row = E.chartRows(packOf(setting)).find(
    (item) => !item.is_group && ((line.code && String(item.code) === String(line.code)) || (!line.code && line.account && item.role === line.account))
  );
  if (!row) return null;
  const parent = row.parent ? chartIndex.chart.find((item) => item.is_group && item.code === groupCodeOfKey(packOf(setting), row.parent)) : null;
  let id = null;
  if (!readOnly) {
    id = await S.insertAccount(handle, entity, {
      code: row.code,
      name: row.name,
      parent_id: parent ? parent.account_id : null,
      is_group: false,
      nature: row.nature,
      role: row.role,
      pack_code: (setting && setting.country) || null,
      pack_version: (setting && setting.pack_version) || null,
      tally_group: row.tally_group,
      sch3_line: row.sch3_line,
      saft_grouping: row.saft_grouping,
      by: line.by || null
    });
    await S.logChange(handle, entity, { by: null, table_name: 'ledger_account', row_id: id, field: 'created', new: row.code + ' ' + row.name + ' (first use)' });
  }
  const account = { account_id: id, code: row.code, name: row.name, role: row.role, is_group: false, nature: row.nature };
  chartIndex.byCode.set(String(account.code), account);
  if (account.role) chartIndex.byRole.set(account.role, account);
  return account;
}
/** the ledger code of a pack group, found by its key; null when the pack has no such group */
const groupCodeOfKey = (pack, key) => {
  const group = (pack.groups || []).find((x) => x.code === key);
  return group ? E.groupCode(group) : null;
};

/**
 * ⭐⭐⭐ composeEntry — THE ONE COMPOSITION of a journal event into its lines (the "＋ Entry" preview and the writer call THIS, never a copy):
 * the chart, the date it posts on (a locked month refuses a typed date), CBPosting.post's lines mapped onto the shop's ledgers, and the voucher.
 * It writes nothing and takes no counter: with { readOnly: true } even a financial year not yet started is read, not created.
 * → { C, pack, docDate, when, posted, lines, voucher }
 */
async function composeEntry(handle, entity, setting, entryEvent, opt) {
  const readOnly = !!(opt && opt.readOnly);
  const chartIndex = await chartOf(handle, entity);
  const pack = E.packWith(packOf(setting), chartIndex.chart);
  const docDate = isoDay(entryEvent.date);
  const when = await postingDateFor(handle, entity, docDate, pack, entryEvent.type === 'opening', !!entryEvent.strict_date, setting, readOnly);
  /* FX1: an event in another currency posts at the rate of its day (lib/fx-rates, b391) — a payment in one settles at what the books carry (fx_settlement) */
  const fxPosting = await fxRates().forEvent(handle, entity, entryEvent, pack.currency, docDate, chartIndex);
  const posted = E.posting().post(Object.assign({}, fxPosting ? fxPosting.ev : entryEvent, { date: when.date }), { pack, functional: pack.currency });
  if (!posted || !posted.ok) throw refuse(posted && posted.why ? posted.why : 'The posting rules refused the entry.');
  const lines = await composeLines(handle, entity, setting, chartIndex, posted, fxPosting, entryEvent, readOnly);
  return {
    C: chartIndex,
    pack,
    docDate,
    when,
    posted,
    lines,
    voucher: voucherOf(entryEvent, entryEvent.owner === true),
    fx: fxPosting ? { rate: fxPosting.stamp.rate, source: fxPosting.stamp.source, date: fxPosting.stamp.date, book_rate: fxPosting.book ? fxPosting.book.rate : null } : null
  }; /* owner: true = the owner-made door (manual entry, typed write-off) → MJ */
}
/** CBPosting's lines mapped onto the shop's ledgers (a missing ledger is added on first use; a group is refused), each stamped with its foreign-currency fields */
async function composeLines(handle, entity, setting, chartIndex, posted, fxPosting, entryEvent, readOnly) {
  const lines = [];
  for (const [i, l] of posted.lines.entries()) {
    let account = (l.code ? chartIndex.byCode.get(String(l.code)) : null) || (l.account ? chartIndex.byRole.get(l.account) : null);
    if (!account) account = await ledgerOnFirstUse(handle, entity, setting, chartIndex, l, readOnly);
    if (!account) throw refuse('The shop\'s chart has no ledger for "' + (l.account || '') + '"' + (l.code ? ' (' + l.code + ')' : '') + '.');
    if (account.is_group) throw refuse('"' + account.name + '" is a group — an entry posts to a ledger under it.');
    lines.push({
      line_no: i + 1,
      account_id: account.account_id,
      code: String(account.code),
      role: account.role,
      party_id: l.party || null,
      dr_minor: l.dr_minor,
      cr_minor: l.cr_minor,
      currency: l.currency,
      amount_txn_minor: l.amount_txn_minor,
      fx_rate: l.fx_rate,
      counter_id: entryEvent.counter || null,
      tax_rate: l.rate != null ? String(l.rate) : null
    });
    fxRates().stampLine(Object.assign(lines[lines.length - 1], { txn_currency: l.txn_currency || l.currency }), posted, fxPosting, entryEvent.fx_stamps);
  }
  return lines;
}
/** the entry an event WOULD post — composeEntry, read-only — or { ok: false, off: true } while the ledger is off. A refusal is thrown, as postEntry throws it. */
async function previewEntry(db, entity, event) {
  return onDb(db, entity, async (handle) => {
    const setting = await settingOf(handle, entity);
    if (!setting || !setting.enabled) return { ok: false, off: true };
    const entryEvent = event || {};
    const seen = entryEvent.source_ref ? await S.entryBySource(handle, entity, entryEvent.source_ref) : null;
    try {
      const composed = await composeEntry(handle, entity, setting, entryEvent, { readOnly: true });
      return Object.assign({ ok: true, duplicate: seen ? { entry_id: seen.entry_id, entry_no: seen.entry_no } : null }, composed);
    } catch (e) {
      throw engineRefusal(e);
    }
  });
}

/** write a journal entry: compose it, decide the party documents, write the lines + balances, then the party items */
async function writeJournal(handle, entity, setting, entryEvent, withItems) {
  const { docDate, when, posted, lines, voucher } = await composeEntry(handle, entity, setting, entryEvent);
  /* ⚠️ the party documents are decided (and a bill named for two parties refused) BEFORE the first row is written */
  const plan = withItems ? await planItems(handle, entity, entryEvent, lines) : null;
  const out = await writeLines(handle, entity, journalHead(entryEvent, posted, docDate, when), lines, when.fy, when.period, voucher);
  let items = [],
    note = null;
  if (withItems) {
    const itemsResult = await itemsFor(handle, entity, entryEvent, plan, out.entry_id, docDate);
    items = itemsResult.rows;
    note = itemsResult.note;
    await S.insertItems(handle, entity, items);
  }
  return {
    ok: true,
    entry_id: out.entry_id,
    entry_no: out.entry_no,
    posting_date: when.date,
    doc_date: docDate,
    moved: when.moved,
    lines: lines.length,
    items: items.length,
    note
  };
}
/** the journal_entry header a posted event writes (the number, series and year are added by writeLines) */
function journalHead(entryEvent, posted, docDate, when) {
  return {
    posting_date: when.date,
    doc_date: docDate,
    source_chit_id: entryEvent.source_chit_id,
    source_ref: entryEvent.source_ref,
    source_chit_ids: entryEvent.source_chit_ids,
    event_type: entryEvent.type,
    rule_version: posted.rule,
    reverses_entry_id: null,
    is_opening: !!posted.is_opening,
    narration: posted.narration || entryEvent.narration || null,
    currency: posted.currency,
    total_minor: posted.totals.dr_minor,
    created_by: entryEvent.by
  };
}

/**
 * lines → the monthly balance rows: every line on its account, and again on account+party when it names a party —
 * exactly CBLedger.accumulate's two grains (tests/books-post.test.cjs holds them equal).
 */
function balanceRows(lines, fiscalYear, period) {
  const lookup = new Map();
  const addToBalance = (account_id, party_key, line) => {
    const balanceKey = account_id + '|' + (party_key || S.ZERO) + '|' + line.currency;
    const balanceRow = lookup.get(balanceKey) || {
      account_id,
      party_key: party_key || S.ZERO,
      currency: line.currency,
      fiscal_year: fiscalYear,
      period,
      dr_minor: 0,
      cr_minor: 0,
      line_count: 0
    };
    balanceRow.dr_minor += line.dr_minor;
    balanceRow.cr_minor += line.cr_minor;
    balanceRow.line_count += 1;
    lookup.set(balanceKey, balanceRow);
  };
  for (const l of lines) {
    addToBalance(l.account_id, null, l);
    if (l.party_id) addToBalance(l.account_id, l.party_id, l);
  }
  return Array.from(lookup.values());
}

const BILL_KIND = { sale_bill: 'sale', purchase_bill: 'sale', credit_given: 'credit_given', opening: 'opening_balance', manual: 'debit_note', expense: 'sale' };
const CREDIT_KIND = {
  payment_received: 'payment',
  payment_made: 'payment',
  return: 'return',
  credit_note: 'credit_note',
  purchase_return: 'return',
  write_off: 'write_off',
  manual: 'credit_note',
  opening: 'payment'
};

/**
 * the party items a journal entry makes, one document per debtors / creditors line that names a party (CBReceivables):
 *   + on the party's side (a sale, a purchase, credit given, an opening bill) → itemsOfBill: +amount against itself, due date
 *   − (a payment, a return, a write-off)                                       → itemsOfPayment: −amount against itself …
 *     … and, when the event names the bill it settles, confirmItems() moves it onto that bill at once (a return against its
 *     own bill). A refusal there (the bill disputed, or already settled) leaves it on account — said in `note`, not failed.
 */
async function planItems(handle, entity, entryEvent, lines) {
  const baseRef =
    entryEvent.doc_ref ||
    (entryEvent.type === 'payment_received' || entryEvent.type === 'payment_made' ? entryEvent.against_ref : null) ||
    entryEvent.source_chit_id ||
    entryEvent.source_ref ||
    entryEvent.ref ||
    null;
  const base = baseRef == null ? null : String(baseRef); /* null: the entry's own id, which no other row can hold yet */
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
    const lineRef = Array.isArray(entryEvent.line_refs) ? entryEvent.line_refs[l.line_no - 1] : null;
    const ownBill = lineRef && String(lineRef.party || '') === String(l.party_id) && lineRef.bill_ref ? lineRef : null;
    const named = ownBill ? String(ownBill.bill_ref) : signed > 0 && entryEvent.type === 'opening' && entryEvent.against_ref ? String(entryEvent.against_ref) : null;
    plan.push({ l, signed, own: ownBill, named, own_doc: false });
  }
  const several = new Set(plan.map((item) => String(item.l.party_id))).size > 1;
  for (const p of plan) if (!p.named && several) p.own_doc = true;
  const docOf = (planned) => planned.named || (base == null ? null : base + (planned.own_doc ? ':' + planned.l.party_id : ''));
  const twoParties = (ref) => refuse('Bill ' + ref + ' is given for two parties — a bill reference belongs to one party. Give each its own.');
  const holder = new Map(); /* account|doc → the party this entry gives it to */
  for (const p of plan) {
    if (!p.named) continue;
    const docKey = p.l.account_id + '|' + p.named,
      heldBy = holder.get(docKey);
    if (heldBy !== undefined && heldBy !== String(p.l.party_id)) throw twoParties(p.named);
    holder.set(docKey, String(p.l.party_id));
  }
  for (const account_id of new Set(plan.map((item) => item.l.account_id))) {
    const mine = plan.filter((item) => item.l.account_id === account_id);
    const docs = Array.from(new Set(mine.map(docOf).filter(Boolean)));
    const held = docs.length ? await S.itemOwners(handle, entity, account_id, docs) : [];
    for (const p of mine) {
      if (!held.some((x) => String(x.ref) === docOf(p) && String(x.party_id) !== String(p.l.party_id))) continue;
      if (p.named) throw twoParties(p.named);
      p.own_doc = true;
    }
  }
  return { base, rows: plan };
}
/** the event's one-line word on its own documents (R106: "₹250 short against their ₹2,940" rides the bill's party_item.note, which Payables lists) */
const noteOf = (event) => (event.note ? String(event.note).slice(0, 300) : null);
/** the party items of a written entry: for each planned document line, a bill (itemsOfBill) or a payment (itemsOfPayment, set against its bill at once when it names one) */
async function itemsFor(handle, entity, entryEvent, plan, entry_id, docDate) {
  const receivables = E.receivables(),
    rows = [],
    notes = [];
  const base = plan.base == null ? String(entry_id) : plan.base;
  for (const p of plan.rows) {
    const line = p.l,
      signed = p.signed,
      id = p.named || base + (p.own_doc ? ':' + line.party_id : '');
    const side = sideOfRole(line.role);
    const extra = { entry_id, payment_id: entryEvent.payment_id || null, by: entryEvent.by, currency: line.currency, date: docDate, note: noteOf(entryEvent) };
    const documentLine = { receivables, line, signed, id, side, extra, docDate };
    if (signed > 0) rows.push(...(await billItemRows(handle, entity, entryEvent, p.own, documentLine)));
    else {
      const settled = await paymentItemRows(handle, entity, entryEvent, documentLine);
      rows.push(...settled.rows);
      if (settled.note) notes.push(settled.note);
    }
  }
  return { rows, note: notes.join(' ') || null };
}
/** a + line (a sale, a purchase, credit given, an opening bill) → the bill's party items, due on its own date, else the party's credit days */
async function billItemRows(handle, entity, entryEvent, ownBill, { receivables, line, signed, id, side, extra, docDate }) {
  const docId = id;
  const dueDate = (ownBill && ownBill.due_date) || entryEvent.due_date || null;
  const terms = dueDate ? null : await S.terms(handle, entity, line.party_id, side === 'payable' ? 'supplier' : 'customer');
  return receivables
    .itemsOfBill(
      {
        id: docId,
        party: line.party_id,
        side,
        kind: BILL_KIND[entryEvent.type] || 'debit_note',
        date: docDate,
        due: dueDate || undefined,
        amount_minor: signed,
        currency: line.currency
      },
      { credit_days: terms && terms.credit_days != null ? Number(terms.credit_days) : 0 }
    )
    .map((x) => E.itemRow(x, line.account_id, extra));
}
/** a − line (a payment, a return, a write-off) → its party items and, when the event names the bill it settles, that bill's confirmation (or the note saying it was left on account) */
async function paymentItemRows(handle, entity, entryEvent, { receivables, line, signed, id, extra, docDate }) {
  const made = receivables.itemsOfPayment({
    id,
    party: line.party_id,
    side: sideOfRole(line.role),
    kind: CREDIT_KIND[entryEvent.type] || 'credit_note',
    date: docDate,
    amount_minor: -signed,
    currency: line.currency
  });
  const rows = made.map((x) => E.itemRow(x, line.account_id, extra));
  let note = null;
  if (entryEvent.against_ref && String(entryEvent.against_ref) !== id && entryEvent.type !== 'payment_received' && entryEvent.type !== 'payment_made') {
    const have = (await lockedItems(handle, entity, line.party_id, line.account_id)).concat(made); /* C3: judged under the party's lock */
    const confirmation = receivables.confirmItems(have, [{ credit: id, debit: String(entryEvent.against_ref), amount: -signed / Math.pow(10, decimalPlaces(line.currency)) }], docDate);
    if (confirmation.ok) confirmation.rows.forEach((x) => rows.push(E.itemRow(x, line.account_id, extra)));
    else note = 'Left on account, not set against ' + entryEvent.against_ref + ': ' + (confirmation.why || 'refused');
  }
  return { rows, note };
}
/** the currency's decimals (money.decimals); 2 when that helper fails, said in the log */
function decimalPlaces(currency) {
  try {
    const moneyModule = require('./money');
    return moneyModule.decimals ? moneyModule.decimals(currency) : 2;
  } catch (e) {
    log.fellBack('books dp: the helper failed — counted as 2', e);
    return 2;
  }
}

/** a party's control account (debtors for a customer / receivable, creditors for a supplier / payable) */
async function controlOf(handle, entity, side) {
  const role = roleOfSide(side);
  const account = (await S.accounts(handle, entity)).find((x) => x.role === role);
  if (!account) throw refuse("The shop's chart has no " + role + ' ledger.');
  return account;
}
/** a party's rows on one control account (every account when none is named), read as the engine reads them */
async function partyItems(handle, entity, party, account_id) {
  return (await S.items(handle, entity, party, account_id)).map(E.itemOf);
}
/**
 * ⭐ C3 (PAY-FIX): the party's rows READ UNDER THE LOCK — every writer that judges a read before it writes (confirmItems,
 * itemsOfCheque, reverseItems) comes here, so two payments recorded at once settle a bill ONCE: the second waits for the
 * first to commit and then reads the bill as settled. S.lockParty = pg_advisory_xact_lock(hashtext(entity|party|account)).
 */
async function lockedItems(handle, entity, party, account_id) {
  await S.lockParty(handle, entity, party, account_id);
  return partyItems(handle, entity, party, account_id);
}

/* ── M26 · the one proposal, the duplicate rule, the bills settled with the payment, the outcome in words ───────── */
const money = (minor, currency) => require('./bill-privacy').money(minor, currency);
/**
 * ⭐⭐ proposeFor(h, entity, question) — THE ONE PROPOSAL (M26, SPEC-payments §4.1): which open bills a payment settles, oldest due
 * first, and what stays on account. Preview (a payment not yet recorded), the one-call record (allocate: 'oldest_first') and
 * POST /payments/:id/propose all come here — the suggestion itself is CBReceivables.propose; nothing here is a second rule.
 *   question: { party, direction: in|out, amount_minor, currency, credit_ref? } — credit_ref ('pay:<id>') once the payment is among the
 *      party's rows; without it a stand-in credit of amount_minor is proposed against the same bills.
 * → { currency, account_id, items, outstanding, open_minor (every open bill, disputed included — W1/W2 read it),
 *     proposal: [{ against_ref, bill_no, due_date, open_minor, due_minor (net of the party's receipts on account — Remind's figure), apply_minor, disputed }],
 *     apply_minor, on_account_minor, skipped: [{ against_ref, why }], why }
 */
async function proposeFor(h, entity, question) {
  const acct = await controlOf(h, entity, question.direction === 'in' ? 'customer' : 'supplier');
  const items = await partyItems(h, entity, question.party, acct.account_id);
  const currency = stated(question.currency, items[0] && items[0].currency),
    scale = Math.pow(10, decimalPlaces(currency));
  const R = E.receivables(),
    amount_minor = Math.round(Number(question.amount_minor) || 0);
  const outstanding = items.length ? R.outstanding(items) : { by_ref: Object.create(null), by_party: Object.create(null) };
  const bills = Object.keys(outstanding.by_ref)
    .map((item) => outstanding.by_ref[item])
    .filter((item) => item.kind === 'bill' && item.outstanding_minor > 0)
    .sort(
      (first, second) =>
        String(first.due_date || first.date || '').localeCompare(String(second.due_date || second.date || '')) ||
        String(first.date || '').localeCompare(String(second.date || '')) ||
        String(first.ref).localeCompare(String(second.ref))
    );
  let suggestion;
  if (!items.length) suggestion = { ok: true, allocations: [], on_account: amount_minor / scale, skipped: [] };
  else if (question.credit_ref) suggestion = R.proposeItems(items, question.credit_ref, {});
  else {
    const split = R.fromItems(items);
    const stand = { id: 'preview', kind: 'payment', party: String(question.party), date: CLOCK.today(), amount: amount_minor / scale, currency: currency };
    suggestion = R.propose(split.debits, stand, { credits: split.credits, allocations: split.allocations });
  }
  const apply = Object.create(null);
  (suggestion.allocations || []).forEach((item) => {
    apply[item.debit] = (apply[item.debit] || 0) + Math.round(Number(item.amount) * scale);
  });
  const billNumbers = await S.billNos(
    h,
    entity,
    bills.map((item) => item.ref)
  );
  /* ⭐ due_minor — THE ONE DUE FIGURE (R73): the bill net of the party's receipts on account too (books-engines.netOpen), what Remind asks for;
     open_minor stays the amount a payment may still be allocated to (the Pay unit's figure) */
  const netted = items.length ? E.netOpen(items).by_ref : Object.create(null);
  const proposal = bills.map((item) => ({
    against_ref: item.ref,
    bill_no: billNumbers[item.ref] || null,
    due_date: item.due_date || null,
    open_minor: item.outstanding_minor,
    due_minor: netted[item.ref] ? netted[item.ref].outstanding_minor : item.outstanding_minor,
    apply_minor: item.disputed ? 0 : apply[item.ref] || 0,
    disputed: !!item.disputed
  }));
  return {
    currency: currency,
    account_id: acct.account_id,
    items,
    outstanding: outstanding,
    open_minor: bills.reduce((total, item) => total + item.outstanding_minor, 0),
    proposal,
    apply_minor: proposal.reduce((total, item) => total + item.apply_minor, 0),
    on_account_minor: Math.round(Number(suggestion.on_account || 0) * scale),
    skipped: (suggestion.skipped || []).map((item) => ({ against_ref: item.debit, why: item.why })),
    why: suggestion.ok === false ? suggestion.why || null : null
  };
}
/** the party's standing, in words (T59: never a minus) — + is "they owe you" on both sides, as /dues signs it */
function owesWords(balance_minor, currency) {
  if (!balance_minor) return 'settled';
  return balance_minor > 0 ? 'they owe you ' + money(balance_minor, currency) : 'you owe ' + money(-balance_minor, currency);
}
/** "₹3,720.12 settles 4 bills · ₹1,279.88 stays with Tally Test as an advance" — the line under the bills table */
function previewWords(prop, name, direction) {
  const settledCount = prop.proposal.filter((item) => item.apply_minor > 0).length,
    currency = prop.currency,
    parts = [];
  if (settledCount) parts.push(money(prop.apply_minor, currency) + ' settles ' + settledCount + (settledCount === 1 ? ' bill' : ' bills'));
  if (prop.on_account_minor > 0)
    parts.push(money(prop.on_account_minor, currency) + (direction === 'out' ? ' stays with ' + name + ' as an advance' : ' is kept as an advance from ' + name));
  if (!parts.length) parts.push(prop.why || 'Nothing to settle');
  return parts.join(' · ');
}
const DAY_MS = 86400000;
/** 'today' or 'yesterday' in the country's own day — the wording of the duplicate warnings */
const whenWords = (at, now, country) => {
  const dayOf = require('./books-hooks').dayOf;
  return dayOf(new Date(at), country) === dayOf(new Date(now), country) ? 'today' : 'yesterday';
};
/** W1 / W2 carry the amount OVER (over_minor, and over_words in the shop's own money words) so a screen names it in its confirm without composing (FIN-53) */
function overWarning(code, over_minor, currency, words) {
  return { code, over_minor, over_words: money(over_minor, currency), words };
}
/**
 * what "open" means to W1/W2 (critic on FIN-53, point 1): when the question names bills (allocations), the open of THOSE bills — a
 * Mark-paid on bill s asks against s, not against everything the party owes; otherwise the party's whole open (oldest_first, none)
 */
function openFor(question, prop) {
  if (!Array.isArray(question.allocations) || !question.allocations.length) return prop.open_minor;
  const byRef = (prop.outstanding && prop.outstanding.by_ref) || {};
  return question.allocations.reduce((total, item) => {
    const bill = byRef[String(item.against_ref)];
    return total + (bill && bill.kind === 'bill' ? Math.max(0, Number(bill.outstanding_minor) || 0) : 0);
  }, 0);
}
/** W2 excess: the amount is more than what is open — the rest would stay as an advance (out) or be kept as one (in) */
function excessWarning(amount_minor, open_minor, currency, direction, partyName) {
  const over = amount_minor - open_minor;
  const rest = direction === 'out' ? ' would stay with ' + partyName + ' as an advance.' : ' would be kept as an advance from ' + partyName + '.';
  return overWarning('excess', over, currency, money(amount_minor, currency) + ' is more than the ' + money(open_minor, currency) + ' open — ' + money(over, currency) + rest);
}
/**
 * ⭐⭐ duplicateWarnings(handle, entity, question, prop, name) — PAY D5 AS WRITTEN (SPEC-payments §2.4, default kept: W1–W4, a 24-hour window):
 *   W1 nothing_owed  no open bill on that side — only when bills are being settled (allocations, or allocate: 'oldest_first')
 *                    W2 excess       the amount is more than what is open (not when allocate: 'none' was chosen)
 *   W3 same_again    the same party · direction · amount recorded in the last 24 h, not reversed — its entry_no is named
 *   W4 just_settled  a bill now at 0 was settled by a payment in the last 24 h — its entry_no is named
 * → [{ code, words, entry_no?, payment_id? }]. The words are the shop's (the web never composes them); the codes are stable.
 * `prop` is proposeFor's answer for the same question; `question.now` (ms) is the clock, for tests.
 */
async function duplicateWarnings(handle, entity, question, prop, name) {
  const now = question.now || CLOCK.nowMs(),
    since = new Date(now - DAY_MS).toISOString(),
    currency = prop.currency,
    dir = question.direction === 'in' ? 'in' : 'out';
  const displayName = name || 'this party',
    amount_minor = Math.round(Number(question.amount_minor) || 0),
    list = [];
  /* W1 asks only when the payment means to settle bills (Athi, 2026-10-08: "W1 fires only when there is an allocation") */
  const allocating = question.allocate === 'oldest_first' || (Array.isArray(question.allocations) && question.allocations.length > 0);
  const open_minor = openFor(question, prop);
  if (open_minor === 0) {
    if (allocating) list.push(overWarning('nothing_owed', amount_minor, currency, 'Nothing is owed ' + (dir === 'out' ? 'to ' : 'by ') + displayName + '.'));
  } else if (question.allocate !== 'none' && amount_minor > open_minor) list.push(excessWarning(amount_minor, open_minor, currency, dir, displayName));
  /* W3: the same amount, same way, within the window — a cheque still held counts (it is the same money promised twice) */
  const again = await sameAgainWarning(handle, entity, question, { dir, amount_minor, currency, displayName, now, since });
  if (again) list.push(again);
  list.push(...(await justSettledWarnings(handle, entity, question, prop, now)));
  return list;
}
/** W3 same_again: the first payment of the same party, direction and amount inside the window that was not reversed (a held cheque counts) → one warning, or null */
async function sameAgainWarning(handle, entity, question, { dir, amount_minor, currency, displayName, now, since }) {
  for (const p of await S.paymentsSince(handle, entity, question.party, dir, since)) {
    if (Number(p.amount_minor) !== amount_minor) continue;
    const postedEntry = await S.entryBySource(handle, entity, 'pay:' + p.payment_id);
    if (postedEntry && (await S.entryBySource(handle, entity, 'reverse:' + postedEntry.entry_id))) continue;
    return {
      code: 'same_again',
      entry_no: postedEntry ? postedEntry.entry_no : null,
      payment_id: p.payment_id,
      words:
        'The same ' +
        money(p.amount_minor, currency) +
        (dir === 'out' ? ' was paid to ' : ' was received from ') +
        displayName +
        ' ' +
        whenWords(p.created_at, now, question.country) +
        ' (' +
        (postedEntry ? postedEntry.entry_no : 'cheque ' + (p.cheque_no || 'held')) +
        ').'
    };
  }
  return null;
}
/** W4 just_settled: bills now at 0 whose settling allocation (the − half, against the bill) was written inside the window, grouped by the payment that settled them → one warning each */
async function justSettledWarnings(handle, entity, question, prop, now) {
  const list = [];
  const byPay = Object.create(null);
  prop.items.forEach((item) => {
    if (item.ref_kind !== 'allocation' || !item.payment_id || item.against_ref === item.ref || !item.created_at) return;
    const bill = prop.outstanding.by_ref[item.against_ref];
    if (!bill || bill.kind !== 'bill' || bill.outstanding_minor !== 0 || new Date(item.created_at).getTime() < now - DAY_MS) return;
    const paymentKey = String(item.payment_id);
    byPay[paymentKey] = byPay[paymentKey] || { refs: [], at: item.created_at };
    if (byPay[paymentKey].refs.indexOf(item.against_ref) < 0) byPay[paymentKey].refs.push(item.against_ref);
  });
  for (const pid of Object.keys(byPay)) {
    const postedEntry = await S.entryBySource(handle, entity, 'pay:' + pid),
      refs = byPay[pid].refs,
      billNumbers = await S.billNos(handle, entity, refs);
    const named = refs.map((item) => billNumbers[item]).filter(Boolean);
    list.push({
      code: 'just_settled',
      entry_no: postedEntry ? postedEntry.entry_no : null,
      payment_id: pid,
      words:
        'The last ' +
        (refs.length === 1 ? 'bill' : refs.length + ' bills') +
        (named.length ? ' (' + named.join(', ') + ')' : '') +
        (refs.length === 1 ? ' was' : ' were') +
        ' settled by ' +
        (postedEntry ? postedEntry.entry_no : 'a payment') +
        ' ' +
        whenWords(byPay[pid].at, now, question.country) +
        '.'
    });
  }
  return list;
}
/**
 * the acknowledgements a body sends, one shape: [{ code, over_minor }] — a bare code (the Ledger's sheet, an older client) carries no figure;
 * { code, over_minor } (the Mark-paid popup) carries the figure the person SAW (critic on FIN-53, point 3)
 */
function acknowledgements(sent) {
  if (!Array.isArray(sent)) return [];
  return sent
    .map((item) => (item && typeof item === 'object' ? { code: String(item.code || ''), over_minor: item.over_minor == null ? null : Math.round(Number(item.over_minor)) } : { code: String(item), over_minor: null }))
    .filter((item) => item.code);
}
/** a warning is acknowledged by its code — and, when both carry a figure, by the SAME figure: a stale ask (a colleague recorded in between) is asked again */
function acknowledged(warning, sent) {
  return sent.some((item) => item.code === warning.code && (item.over_minor == null || warning.over_minor == null || item.over_minor === warning.over_minor));
}
/** the same money twice (W3 same_again · W4 just_settled) is in the list: the question is "Already paid?"; without them it is only "More than is owed" (FIN-53) */
function sameMoneyTwice(list) {
  return list.some((item) => item.code === 'same_again' || item.code === 'just_settled');
}
/** the 409's title, one of two: "Already paid?" (the same money twice) · "More than is owed" (W1/W2 alone) — the route's legacy `error` reads it */
function warningTitle(list) {
  return sameMoneyTwice(list) ? 'Already paid?' : 'More than is owed';
}
/**
 * the 409's one sentence (Athi, 2026-10-29, FIN-53 c):
 *   the same money twice → "Already paid? <each warning> Pay ₹5,000 again as an advance?"
 *   more than is owed only → "More than is owed by ₹3,820. <each warning> Keep ₹3,820 as an advance?" — the owner confirms once
 */
function warningWords(list, question, currency) {
  const over = list.find((item) => item.code === 'nothing_owed' || item.code === 'excess');
  const joined = list.map((item) => item.words).join(' ');
  if (sameMoneyTwice(list))
    return 'Already paid? ' + joined + (over ? ' ' + (question.direction === 'out' ? 'Pay ' : 'Receive ') + money(question.amount_minor, currency) + ' again as an advance?' : '');
  const overWords = money(over.over_minor, currency);
  return 'More than is owed by ' + overWords + '. ' + joined + ' Keep ' + overWords + ' as an advance?';
}
/**
 * ⭐ settleBills(h, entity, p, payment_id) — the bills a just-recorded payment settles, in the SAME transaction as its entry (M26):
 * the list the caller chose, or the engine's own proposal (allocate: 'oldest_first'). Through postEntry's allocation event, so
 * confirmItems still judges it — and a refusal THROWS, which rolls the payment back with it: nothing half-recorded.
 * A held cheque settles nothing until it clears: a list sent with one is refused in words; 'oldest_first' is said in the outcome.
 */
async function settleBills(h, entity, p, payment_id) {
  const ref = 'pay:' + payment_id,
    given = Array.isArray(p.allocations) && p.allocations.length;
  if (p.mode === 'cheque') {
    if (given) throw refuse('A cheque settles bills when it clears — record it now and choose the bills then.');
    return null;
  }
  let list = given
    ? p.allocations
        .filter((item) => item && Number(item.amount_minor) > 0)
        .map((item) => ({ against_ref: String(item.against_ref || ''), amount_minor: Math.round(Number(item.amount_minor)) }))
    : null;
  if (!list && p.allocate === 'oldest_first') {
    const prop = await proposeFor(h, entity, {
      party: p.party_id,
      direction: p.direction,
      amount_minor: p.amount_minor,
      currency: p.currency,
      credit_ref: ref
    });
    list = prop.proposal.filter((x) => x.apply_minor > 0).map((x) => ({ against_ref: x.against_ref, amount_minor: x.apply_minor }));
  }
  if (!list || !list.length) return null;
  const out = await postEntry(h, entity, {
    type: 'allocation',
    party: p.party_id,
    side: p.direction === 'in' ? 'customer' : 'supplier',
    credit_ref: ref,
    payment_id,
    allocations: list,
    currency: p.currency,
    date: p.received_at,
    by: p.by
  });
  return Object.assign({ settled: list }, out);
}
/* ═══ M30 · THE PAYMENT ADVICE, OUT (SPEC-payments §3 · §4.3; MASTER-BUILD row M30; FIT-shell: the payer settles its own books and informs) ═══
 * The advice is a CHIT the WEB sends (purpose 'general', business_json.kind 'payment_advice' — §3.1, D2): this file composes the
 * ready body and answers MAY (the same rule PATCH /payments/:id enforces), so the unit paints and never decides.
 * Invariants: an advice is sent only for a RECORDED payment (posted, not reversed, a cheque only once cleared) · ONE advice per payment
 * (store setAdvice first-wins) · nothing posts on the payee side at send (the hook classifies payment_advice as a queue until M31 Accept). */
const MODE_WORDS = { cash: 'cash', upi: 'by UPI', bank: 'by bank', card: 'by card', cheque: 'by cheque' };
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-04' → '4 Oct 2026' (the advice names its day the way a person says it) */
function dateWords(date) {
  const dateText = isoDay(date);
  return dateText ? Number(dateText.slice(8, 10)) + ' ' + MONTHS3[Number(dateText.slice(5, 7)) - 1] + ' ' + dateText.slice(0, 4) : '';
}
/** the refusal words of the advice, keyed like a rail verdict: { ok: false, why, say } — the level words are the rail engine's own (one vocabulary) */
const ADVICE_SAY = {
  off_rail: (partyName) => partyName + ' is not on ChitBridge — share the advice instead.',
  on_rail: (partyName) => partyName + ' is on ChitBridge — send the advice instead.',
  not_posted: () => 'Nothing to advise — the payment did not post.',
  reversed: () => 'This payment was reversed.',
  cheque_held: () => 'A cheque is advised when it clears.',
  already_sent: () => 'An advice is already sent for this payment.',
  not_available: () => 'Advice not available yet — the books need an update (b285).'
};
const adviceNo = (reason, name) => ({ ok: false, why: reason, say: ADVICE_SAY[reason] ? ADVICE_SAY[reason](name || 'This party') : require('./rail').say(reason) });
/**
 * ⭐ adviceMay(facts) — MAY THIS LOGIN SEND / SHARE THE ADVICE OF THIS PAYMENT. The one rule: PATCH /payments/:id refuses with the same
 *   answer the read paints greyed. facts = { level (viewer·commenter·editor), ready, posted, reversed, cheque_held, on_rail, sent, name }
 *   → { send_advice: { ok } | { ok: false, why, say }, share_advice: … }
 *   send = on rail; share = off rail (copy / WhatsApp / e-mail — never a chit to nowhere). Both: a recorded payment, not reversed,
 *   not a held cheque, no advice sent yet; and a level that may answer the other party (rail byLevel: viewer → read_only, commenter → comment_only).
 */
function adviceMay(facts) {
  const x = facts || {},
    levelVerdict = require('./rail').byLevel(x.level, 'advice');
  const common = levelVerdict
    ? adviceNo(levelVerdict)
    : !x.ready
      ? adviceNo('not_available')
      : x.cheque_held
        ? adviceNo('cheque_held')
        : !x.posted
          ? adviceNo('not_posted')
          : x.reversed
            ? adviceNo('reversed')
            : x.sent
              ? adviceNo('already_sent')
              : null;
  return {
    send_advice: common || (x.on_rail ? { ok: true } : adviceNo('off_rail', x.name)),
    share_advice: common || (!x.on_rail ? { ok: true } : adviceNo('on_rail', x.name))
  };
}
/** the advice STATE a statement line paints (SPEC §4.4): none · sent · delivered · shared · disputed — from the payment's columns and my copy's chit status */
function adviceState(row, chitStatus) {
  const payment = row || {};
  if (payment.advice_chit_id) {
    const chitCopy = chitStatus || null;
    return chitCopy && chitCopy.disputed ? 'disputed' : chitCopy && /^(delivered|read|accepted|completed|in_progress)$/.test(String(chitCopy.status || '')) ? 'delivered' : 'sent';
  }
  return payment.advice_shared_at ? 'shared' : 'none';
}
/**
 * ⭐ adviceBody(payment, context) — THE CHIT SEND BODY (§3.2, one shape): recipients · purpose 'general' · client_ref 'advice:pay:<id>' (chits /send dedupes on
 *   it — a retry answers the first chit) · line_items = the bills settled (ref_chit_id = the bill's chit_id, the same on both copies, which is what
 *   lets the payee settle the same bills in M31) · business_json.payment_advice (minor-unit integers are the source; amount / on_account in
 *   major units ride beside them for folders and the CRM timeline, derived here by the currency's own decimals — money.decimals).
 *   payment = the payment row; context = { me, party: { party_id, name }, entry_no, settled: [{ against_ref, bill_no, amount_minor }], on_account_minor }
 *   → { words, body, share: { text, wa, mailto } }
 */
function adviceBody(payment, context) {
  const currency = stated(payment.currency),
    decimals = decimalPlaces(currency),
    major = (minor) => Number(minor) / Math.pow(10, decimals);
  const out = payment.direction === 'out',
    shopName = context.me || 'We',
    partyName = (context.party && context.party.name) || 'you';
  const settled = (context.settled || []).filter((item) => Number(item.amount_minor) > 0),
    applied = settled.reduce((total, item) => total + Number(item.amount_minor), 0);
  const on_account = Math.max(0, Number(context.on_account_minor != null ? context.on_account_minor : payment.amount_minor - applied));
  const words = adviceWords(payment, { currency, shopName, settled, applied, on_account });
  const adviceBlock = {
    action: out ? 'paid' : 'received',
    adviser_payment_id: payment.payment_id,
    adviser_entry_no: context.entry_no || null,
    amount: major(payment.amount_minor),
    amount_minor: Number(payment.amount_minor),
    currency: currency,
    mode: payment.mode,
    reference: payment.reference || null,
    paid_on: isoDay(payment.received_at),
    applied_minor: applied,
    on_account: major(on_account),
    on_account_minor: on_account,
    collected_by: null,
    reverses_advice_chit_id: null,
    words
  };
  const body = adviceChitBody(payment, context, { currency, settled, major, adviceBlock });
  const subject = 'Payment advice' + (context.entry_no ? ' ' + context.entry_no : '') + ' — ' + shopName;
  const share = {
    text: words,
    wa: 'https://wa.me/?text=' + encodeURIComponent(words),
    mailto: 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(words)
  };
  return { words, body, share, to: partyName };
}
/** the one sentence of the advice: "We paid you ₹5,000 by UPI on 4 Oct 2026 for bills A-1 (₹3,000) · ₹2,000 as an advance." */
function adviceWords(payment, { currency, shopName, settled, applied, on_account }) {
  const out = payment.direction === 'out';
  let words =
    shopName +
    (out ? ' paid you ' : ' received ') +
    money(payment.amount_minor, currency) +
    ' ' +
    (MODE_WORDS[payment.mode] || payment.mode) +
    (out ? '' : ' from you') +
    ' on ' +
    dateWords(payment.received_at);
  if (settled.length)
    words +=
      ' for ' +
      (settled.length === 1 ? 'bill ' : 'bills ') +
      settled.map((item) => item.bill_no || item.against_ref).join(', ') +
      ' (' +
      money(applied, currency) +
      ')';
  if (on_account > 0) words += (settled.length ? ' · ' : ' · ') + money(on_account, currency) + ' as an advance';
  words += '.';
  if (payment.reference) words += ' Ref ' + String(payment.reference) + '.';
  return words;
}
/** the chit /send body of an advice (§3.2): the recipient, the bills settled as line items, and the payment_advice block */
function adviceChitBody(payment, context, { currency, settled, major, adviceBlock }) {
  return {
    recipients: context.party && context.party.party_id ? [{ entity_id: context.party.party_id, role: 'to' }] : [],
    purpose: 'general',
    manual_subject: 'Payment advice' + (context.entry_no ? ' ' + context.entry_no : ''),
    client_ref: 'advice:pay:' + payment.payment_id,
    line_items: settled.map((item) => ({
      particulars: 'Bill ' + (item.bill_no || item.against_ref),
      quantity: 1,
      unit: 'bill',
      price: major(item.amount_minor),
      total: major(item.amount_minor),
      currency: currency,
      ref_chit_id: item.against_ref,
      bill_no: item.bill_no || null,
      applied: major(item.amount_minor),
      applied_minor: Number(item.amount_minor)
    })),
    business_json: { kind: 'payment_advice', currency: currency, payment_advice: adviceBlock }
  };
}
/** the bills a payment settled, read back from the party rows (the engine's allocations) and named once, with what stayed on account → { settled, on_account_minor } */
async function settledFromRows(handle, entity, payment) {
  const items = await partyItems(handle, entity, payment.party_id, null);
  const mine = items.filter((item) => item.ref === 'pay:' + payment.payment_id && item.ref_kind === 'allocation' && item.against_ref !== item.ref);
  const billNumbers = await S.billNos(
    handle,
    entity,
    mine.map((item) => item.against_ref)
  );
  const settled = mine.map((item) => ({
    against_ref: item.against_ref,
    bill_no: billNumbers[item.against_ref] || null,
    amount_minor: Math.abs(Number(item.amount_minor))
  }));
  const outstandingPay = items.length ? E.receivables().outstanding(items).by_ref['pay:' + payment.payment_id] : null;
  const on_account_minor =
    payment.mode === 'cheque'
      ? 0
      : outstandingPay
        ? Math.abs(Number(outstandingPay.outstanding_minor))
        : Math.max(0, payment.amount_minor - settled.reduce((total, item) => total + item.amount_minor, 0));
  return { settled, on_account_minor };
}
/**
 * ⭐ adviceFor(handle, entity, payment, context) — THE ADVICE READ (GET /payments/:id/advice; the same block rides on POST /payments). All from facts already in
 *   hand or ONE read each, never per row: the payment, its entry (posted · reversed, via entryBySource ×2), the party row (name · on_rail),
 *   the bills it settled (party_item once → the engine's allocations), their numbers (billNos once), my copy's chit status (adviceStates once).
 *   context = { level, me (shop name), names (partyNames map), ready, settled? (known from the record just made), entry_no?, on_account_minor? }
 *   → { payment_id, party: { party_id, name, on_rail }, advice: { chit_id, state, shared_at }, may, words, body, share }
 */
async function adviceFor(handle, entity, payment, context) {
  const party = (context.names && context.names.get(String(payment.party_id))) || {},
    name = party.nickname || party.name || 'this party';
  const ready = context.ready !== false;
  const row = ready ? (await S.paymentsAdvice(handle, entity, [payment.payment_id]))[0] || {} : {};
  const posted = context.entry_no ? { entry_no: context.entry_no, entry_id: context.entry_id } : await S.entryBySource(handle, entity, 'pay:' + payment.payment_id);
  const reversed = !!(posted && posted.entry_id && (await S.entryBySource(handle, entity, 'reverse:' + posted.entry_id)));
  let settled = context.settled || null,
    on_account_minor = context.on_account_minor;
  if (!settled) ({ settled, on_account_minor } = await settledFromRows(handle, entity, payment));
  const cheque_held = payment.mode === 'cheque' && !(posted && posted.entry_id);
  const chitStatus = row.advice_chit_id ? (await S.adviceStates(handle, entity, [row.advice_chit_id]))[row.advice_chit_id] : null;
  const permissions = adviceMay({
    level: context.level,
    ready,
    posted: !!(posted && posted.entry_id),
    reversed,
    cheque_held,
    on_rail: party.on_rail === true,
    sent: !!row.advice_chit_id,
    name
  });
  const advice = adviceBody(payment, { me: context.me, party: { party_id: payment.party_id, name }, entry_no: posted ? posted.entry_no : null, settled, on_account_minor });
  return {
    payment_id: payment.payment_id,
    party: { party_id: payment.party_id, name, on_rail: party.on_rail === true },
    advice: {
      chit_id: row.advice_chit_id || null,
      state: ready ? adviceState(row, chitStatus) : 'none',
      shared_at: row.advice_shared_at ? new Date(row.advice_shared_at).toISOString() : null
    },
    may: permissions,
    words: advice.words,
    body: permissions.send_advice.ok ? advice.body : null,
    share: permissions.share_advice.ok ? advice.share : null
  };
}

/**
 * ⭐ paymentOutcome(handle, entity, payment, payment_id, alloc, name) — what happened, in the shopkeeper's words (M26, SPEC-payments §1.1 step 4):
 *   "Paid ₹5,000 cash to Tally Test. Settled 4 bills (₹3,720.12). ₹1,279.88 left with Tally Test as an advance — they owe you this."
 * Read back from the rows just written (same transaction); the figures are the engine's (outstanding), the sentence is built here only.
 * → { words, settled: [{ against_ref, bill_no, amount_minor }], applied_minor, on_account_minor, balance_minor, balance_words }
 */
async function paymentOutcome(handle, entity, payment, payment_id, alloc, name) {
  const currency = stated(payment.currency),
    displayName = name || 'the party',
    out = payment.direction === 'out';
  const acct = await controlOf(handle, entity, out ? 'supplier' : 'customer');
  const items = await partyItems(handle, entity, payment.party_id, acct.account_id);
  const outstanding = items.length ? E.receivables().outstanding(items) : { by_ref: Object.create(null), by_party: Object.create(null) };
  const refs = (alloc && alloc.settled) || [],
    billNumbers = await S.billNos(
      handle,
      entity,
      refs.map((item) => item.against_ref)
    );
  const settled = refs.map((item) => ({ against_ref: item.against_ref, bill_no: billNumbers[item.against_ref] || null, amount_minor: item.amount_minor }));
  const applied = settled.reduce((total, item) => total + item.amount_minor, 0),
    mine = outstanding.by_ref['pay:' + payment_id];
  const on_account = payment.mode === 'cheque' ? 0 : mine ? -mine.outstanding_minor : Math.max(0, payment.amount_minor - applied);
  let words = (out ? 'Paid ' : 'Received ') + money(payment.amount_minor, currency) + ' ' + (MODE_WORDS[payment.mode] || payment.mode) + (out ? ' to ' : ' from ') + displayName + '.';
  if (payment.mode === 'cheque') words += ' Held until it clears — the bills are chosen then.';
  else if (settled.length) words += ' Settled ' + settled.length + (settled.length === 1 ? ' bill' : ' bills') + ' (' + money(applied, currency) + ').';
  if (on_account > 0)
    words +=
      ' ' +
      money(on_account, currency) +
      (out ? ' left with ' + displayName + ' as an advance — they owe you this.' : ' kept as an advance from ' + displayName + ' — you owe them this.');
  /* the sign /dues gives: + they owe you, on both sides (a supplier's open bill is −; an advance left with them is +) */
  const balance_minor = (out ? -1 : 1) * Number(outstanding.by_party[String(payment.party_id)] || 0);
  return { words, settled, applied_minor: applied, on_account_minor: on_account, balance_minor, balance_words: owesWords(balance_minor, currency) };
}

/** ⭐ propose → the owner confirms → confirmItems() checks it (disputed frozen, uncleared cheque, never more than is left) */
async function writeAllocation(handle, entity, entryEvent) {
  const acct = await controlOf(handle, entity, entryEvent.side);
  const items = await lockedItems(handle, entity, entryEvent.party, acct.account_id); /* C3: the lock BEFORE the read */
  /* FIN-63 step 2: the confirm door asks (replay: true) whether this is the latest live batch pressed again; settleBills never does */
  const again = entryEvent.replay ? replayOf(items, entryEvent.payment_id, (entryEvent.allocations || []).map((item) => [item.against_ref, item.amount_minor]), CLOCK.nowMs()) : null;
  if (again) return again;
  const currency = stated(entryEvent.currency, items[0] && items[0].currency);
  const confirmed = (entryEvent.allocations || [])
    .filter((item) => Number(item.amount_minor) > 0)
    .map((item) => ({ credit: String(entryEvent.credit_ref), debit: String(item.against_ref), amount: Number(item.amount_minor) / Math.pow(10, decimalPlaces(currency)) }));
  if (!confirmed.length) throw refuse('Nothing to allocate.');
  const confirmation = E.receivables().confirmItems(items, confirmed, isoDay(entryEvent.date) || CLOCK.today());
  if (!confirmation.ok) throw refuse(confirmation.why || 'The allocation was refused.');
  const rows = confirmation.rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: entryEvent.payment_id, by: entryEvent.by, currency: currency }));
  await S.insertItems(handle, entity, rows);
  return { ok: true, items: rows.length, allocated_minor: rows.filter((item) => item.amount_minor < 0).reduce((total, item) => total - item.amount_minor, 0) };
}
/** is this id a party of the shop (a list, or its books)? the ONE stranger rule of the party reads and the status write (S35: a stranger is answered as a missing party) */
async function knownParty(handle, entity, party_id) {
  const on = await S.partyOn(handle, entity, party_id);
  return !!(on.customer || on.supplier || on.ledgered);
}
/** a status row (disputed · undisputed) — never an UPDATE */
async function writeStatus(handle, entity, entryEvent) {
  if (!(await knownParty(handle, entity, entryEvent.party))) throw refuse('No such party.', 'BOOKS_NOT_FOUND');
  const acct = await controlOf(handle, entity, entryEvent.side);
  const x = E.receivables().statusItem(
    { ref: String(entryEvent.against_ref), party: entryEvent.party, side: sideOfRole(acct.role), currency: stated(entryEvent.currency) },
    entryEvent.status,
    isoDay(entryEvent.date) || CLOCK.today()
  );
  await S.insertItems(handle, entity, [E.itemRow(x, acct.account_id, { by: entryEvent.by, note: entryEvent.note })]);
  return { ok: true, status: entryEvent.status };
}
/** a cheque received / issued: only a status row holding the amount as pending, until it clears (C3) */
async function writeChequeReceived(handle, entity, entryEvent) {
  const acct = await controlOf(handle, entity, entryEvent.side);
  const rows = E.receivables().itemsOfPayment({
    id: 'pay:' + entryEvent.payment_id,
    party: entryEvent.party,
    side: sideOfRole(acct.role),
    kind: 'payment',
    date: isoDay(entryEvent.date),
    amount_minor: entryEvent.amount_minor,
    currency: entryEvent.currency,
    cheque: Object.assign({ status: 'received' }, entryEvent.cheque || {})
  });
  await S.insertItems(
    handle,
    entity,
    rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: entryEvent.payment_id, by: entryEvent.by }))
  );
  return { ok: true, items: rows.length };
}
/**
 * a cheque's next step, from its own rows (itemsOfCheque enforces received → deposited → cleared | bounced). CLEARED
 * posts the payment's journal entry; BOUNCED after clearing reverses it — the party rows (the money row on clearing, the
 * reversal rows on a bounce) come from the engine, so the journal writes none of its own here.
 */
async function writeChequeStep(handle, entity, setting, entryEvent) {
  const payment = await S.payment(handle, entity, entryEvent.payment_id);
  if (!payment || payment.mode !== 'cheque') throw refuse('No such cheque.', 'BOOKS_NOT_FOUND');
  const acct = await controlOf(handle, entity, payment.direction === 'in' ? 'customer' : 'supplier');
  const ref = 'pay:' + payment.payment_id,
    on = isoDay(entryEvent.date) || CLOCK.today(setting);
  /* the step's date is typed by a person (POST /cheques/:id/status) — held to the typed-date rule BEFORE any row is written */
  if (entryEvent.strict_date) typedDate(setting, packOf(setting), on, false);
  const items = await lockedItems(handle, entity, payment.party_id, acct.account_id); /* C3: clear and bounce at the same moment — one at a time */
  const rows = E.receivables().itemsOfCheque(items, ref, entryEvent.to, on);
  await S.insertItems(
    handle,
    entity,
    rows.map((x) => E.itemRow(x, acct.account_id, { payment_id: payment.payment_id, by: entryEvent.by }))
  );
  const out = { ok: true, status: entryEvent.to, items: rows.length };
  if (entryEvent.to === 'cleared') {
    out.posted = await writeJournal(handle, entity, setting, paymentEvent(payment, { mode: 'cheque', date: on, by: entryEvent.by }), false);
  }
  if (entryEvent.to === 'bounced') {
    const done = await S.entryBySource(handle, entity, ref);
    if (done && !(await S.entryBySource(handle, entity, 'reverse:' + done.entry_id)))
      out.reversed = await writeReversal(
        handle,
        entity,
        setting,
        { reverses: done.entry_id, reason: 'Cheque ' + (payment.cheque_no || '') + ' bounced', by: entryEvent.by, source_ref: 'reverse:' + done.entry_id },
        false
      );
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
async function firstPayment(handle, entity, payment_id) {
  const existing = await S.payment(handle, entity, payment_id);
  const seen = await S.entryBySource(handle, entity, 'pay:' + payment_id);
  return {
    payment: { payment_id, status: existing && existing.mode === 'cheque' ? 'cheque_received' : 'recorded', duplicate: true },
    posted: seen
      ? { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: isoDay(seen.posting_date) }
      : { ok: true, duplicate: true }
  };
}
/** THE STRANGER RULE, once (M9; FIN-55): money is recorded only for a party on the shop's customer or supplier list — recordPayment and the chit door both ask it, before anything waits or is written */
async function partyOnList(handle, entity, party_id) {
  const on = await S.partyOn(handle, entity, party_id);
  if (!on || !(on.customer || on.supplier)) throw refuse("That party is not on this shop's customer or supplier list — add them first.");
}
/** record a payment and its entry in the caller's one transaction (see the block above firstPayment for the contract) */
async function recordPayment(h, entity, p) {
  if (p.client_ref) {
    const first = await S.paymentByRef(h, entity, p.client_ref);
    if (first) return firstPayment(h, entity, first.payment_id);
  }
  if (!Number.isSafeInteger(p.amount_minor) || !(p.amount_minor > 0)) throw refuse('A payment is a whole amount of minor units, more than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.received_at || ''))) throw refuse('A payment needs its date (YYYY-MM-DD).');
  await partyOnList(h, entity, p.party_id);
  if (p.strict_date) {
    const setting = await settingOf(h, entity);
    typedDate(setting, packOf(setting), p.received_at, false);
  }
  /* ⭐ M26 · THE DUPLICATE RULE (PAY D5), after the gates above and before anything is written — only when the caller ASKS
     (the route: p.warn = { acknowledge: [codes], country, name }); the counter's money chit (lib/books-hooks) never asks, a
     walk-in's payment has nothing "owed" and must not park. A warning not acknowledged throws ALREADY_PAID; the route says 409. */
  if (p.warn) {
    const prop = await proposeFor(h, entity, { party: p.party_id, direction: p.direction, amount_minor: p.amount_minor, currency: p.currency });
    const list = await duplicateWarnings(
      h,
      entity,
      {
        party: p.party_id,
        direction: p.direction,
        amount_minor: p.amount_minor,
        allocate: p.allocate,
        allocations: p.allocations,
        country: p.warn.country,
        now: p.warn.now
      },
      prop,
      p.warn.name
    );
    const sentAcknowledgements = acknowledgements(p.warn.acknowledge);
    if (list.some((item) => !acknowledged(item, sentAcknowledgements)))
      throw Object.assign(new Error(warningWords(list, p, prop.currency)), { code: 'ALREADY_PAID', status: 409, warnings: list, title: warningTitle(list) });
  }
  const pay = await S.insertPayment(h, entity, p);
  const status = p.mode === 'cheque' ? 'cheque_received' : 'recorded';
  if (pay.duplicate) return firstPayment(h, entity, pay.payment_id); /* two requests at once: the index decided */
  const row = Object.assign({}, p, { payment_id: pay.payment_id });
  const posted =
    p.mode === 'cheque'
      ? await postEntry(h, entity, {
          type: 'cheque_received',
          party: p.party_id,
          side: p.direction === 'in' ? 'customer' : 'supplier',
          payment_id: pay.payment_id,
          amount_minor: p.amount_minor,
          currency: p.currency,
          date: p.received_at,
          cheque: { no: p.cheque_no || null },
          by: p.by
        })
      : await postEntry(
          h,
          entity,
          Object.assign(paymentEvent(row, { by: p.by }), { strict_date: !!p.strict_date, source_chit_id: p.source_chit_id || undefined })
        );
  /* ⭐ M26: the bills it settles (p.allocations, or allocate: 'oldest_first') on the SAME handle — a refusal throws, and the
     caller's transaction takes the payment row and its entry back with it. No list, no allocate → as before. */
  const allocation = await settleBills(h, entity, row, pay.payment_id);
  return { payment: { payment_id: pay.payment_id, status, duplicate: false }, posted, allocation };
}
/** the payment's journal event (CBPosting payment_received / payment_made) */
function paymentEvent(payment, options) {
  const currency = stated(payment.currency);
  return {
    type: payment.direction === 'in' ? 'payment_received' : 'payment_made',
    party: payment.party_id,
    amount: Number(payment.amount_minor) / Math.pow(10, decimalPlaces(currency)),
    currency: currency,
    mode: options.mode || payment.mode,
    cheque_status: (options.mode || payment.mode) === 'cheque' ? 'cleared' : undefined,
    date: options.date || isoDay(payment.received_at),
    ref: 'pay:' + payment.payment_id,
    source_ref: 'pay:' + payment.payment_id,
    payment_id: payment.payment_id,
    against_ref: 'pay:' + payment.payment_id,
    doc_ref: 'pay:' + payment.payment_id,
    by: options.by
  };
}

/**
 * reversalRowsOf(store, entity, engine, items, on, stamp) → the party rows that reverse every document the original entry's rows came from.
 * FIN-64 (engines 1.75.2): reversing a bill also releases the payment allocated to it. When ONE entry holds a bill and its payment for
 * the same party, the second reverseItems call must see the first call's reversal rows, or the allocation is released twice; the engine
 * skips any row already named by a reversal (ref_kind 'reversal' + reverses), so its own output is fed back in, per party and account.
 */
async function reversalRowsOf(store, entity, engine, items, on, stamp) {
  const refs = new Map();
  (items || []).forEach((item) => {
    if (item.ref_kind !== 'status') refs.set(item.party_id + '|' + item.account_id + '|' + item.ref, item);
  });
  const rows = [],
    madeFor = new Map();
  for (const doc of refs.values()) {
    const all = await lockedItems(store, entity, doc.party_id, doc.account_id); /* C3 */
    const partyKey = doc.party_id + '|' + doc.account_id,
      madeBefore = madeFor.get(partyKey) || [];
    const reversals = engine.reverseItems(all.concat(madeBefore), doc.ref, on);
    madeFor.set(partyKey, madeBefore.concat(reversals));
    reversals.forEach((row) => rows.push(E.itemRow(row, doc.account_id, stamp)));
  }
  return rows;
}

/**
 * ⭐ the correction: the same lines, debit and credit swapped, pointing at the original — dated in the original's month
 * when that month is open, else on the first open date. Its party rows: CBReceivables.reverseItems for every document
 * the original's rows came from (a cheque bounce passes withItems=false: itemsOfCheque already wrote them).
 */
async function writeReversal(handle, entity, setting, entryEvent, withItems) {
  const orig = await S.entry(handle, entity, entryEvent.reverses);
  if (!orig) throw refuse('No such entry.', 'BOOKS_NOT_FOUND');
  if (orig.reverses_entry_id) throw refuse('That entry is itself a reversal — post the original again instead.');
  if (!String(entryEvent.reason || '').trim()) throw refuse('A reversal needs a reason.');
  const pack = packOf(setting);
  const when = await postingDateFor(handle, entity, isoDay(orig.posting_date), pack, !!orig.is_opening, false, setting);
  const chartIndex = await chartOf(handle, entity);
  const lines = swappedLines(orig, chartIndex);
  const out = await writeLines(
    handle,
    entity,
    reversalHead(orig, entryEvent, when),
    lines,
    when.fy,
    when.period,
    /* a reversal is a Journal; the owner's correction (reverseEntry, owner: true) is a person's entry → MJ, a cheque bounce's own reversal → JV */
    entryEvent.owner === true ? voucherOf({ type: 'manual' }, true) : JOURNAL_VOUCHER
  );
  let items = 0,
    reopened = [];
  if (withItems) {
    const receivables = E.receivables();
    const rows = await reversalRowsOf(handle, entity, receivables, orig.items, when.date, { entry_id: out.entry_id, by: entryEvent.by }); /* handle = the open transaction, receivables = CBReceivables */
    await S.insertItems(handle, entity, rows);
    items = rows.length;
    /* M29: the bills this reversal REOPENED — the engine's one answer (reopenedBy, v1.31.0) over the rows just written, named by bill number (one read) */
    const refsOpen = receivables.reopenedBy ? receivables.reopenedBy(rows) : [];
    const billNumbers = refsOpen.length ? await S.billNos(handle, entity, refsOpen) : {};
    reopened = refsOpen.map((ref) => ({ against_ref: ref, bill_no: billNumbers[ref] || null }));
  }
  return {
    ok: true,
    entry_id: out.entry_id,
    entry_no: out.entry_no,
    posting_date: when.date,
    moved: when.moved,
    reverses: orig.entry_no,
    reverses_entry_id: orig.entry_id,
    items,
    reopened,
    words: reversalWords(orig, out, reopened)
  };
}
/** the original's lines with debit and credit swapped, each on the same account and party */
function swappedLines(orig, chartIndex) {
  return orig.lines.map((item, index) => ({
    line_no: index + 1,
    account_id: item.account_id,
    code: (chartIndex.byId.get(String(item.account_id)) || {}).code,
    role: (chartIndex.byId.get(String(item.account_id)) || {}).role,
    party_id: item.party_id,
    dr_minor: Number(item.cr_minor),
    cr_minor: Number(item.dr_minor),
    currency: item.currency,
    amount_txn_minor: item.amount_txn_minor,
    fx_rate: item.fx_rate,
    counter_id: item.counter_id,
    tax_rate: item.tax_rate
  }));
}
/** the journal_entry header of a reversal, pointing at the original */
function reversalHead(orig, entryEvent, when) {
  return {
    posting_date: when.date,
    doc_date: isoDay(orig.doc_date || orig.posting_date),
    source_chit_id: orig.source_chit_id,
    source_ref: entryEvent.source_ref || 'reverse:' + orig.entry_id,
    event_type: 'reversal',
    rule_version: orig.rule_version,
    reverses_entry_id: orig.entry_id,
    is_opening: !!orig.is_opening,
    narration: 'Reversal of ' + orig.entry_no + ' — ' + String(entryEvent.reason).slice(0, 300),
    currency: orig.currency,
    total_minor: Number(orig.total_minor),
    created_by: entryEvent.by
  };
}
/** "Reversed SV/2026-27/0004 — ₹1,180.00 — by MJ/… . Reopened 2 bills (A-1, A-2)." — the sentence the owner reads after a reversal */
function reversalWords(orig, out, reopened) {
  const currency = stated(orig.currency);
  let words = 'Reversed ' + orig.entry_no + ' — ' + money(Number(orig.total_minor), currency) + ' — by ' + out.entry_no + '.';
  if (reopened.length)
    words +=
      ' Reopened ' +
      reopened.length +
      (reopened.length === 1 ? ' bill' : ' bills') +
      ' (' +
      reopened.map((item) => item.bill_no || item.against_ref).join(', ') +
      ').';
  return words;
}
/** the reason a reversal was made, read back from the narration writeReversal composed ('Reversal of <no> — <reason>') — one writer, one reader */
function reversalWhy(narration) {
  const text = String(narration || ''),
    separatorAt = text.indexOf(' — ');
  return text.startsWith('Reversal of ') && separatorAt > 0 ? text.slice(separatorAt + 3) : text || null;
}

/** reverseEntry — the owner's correction, through the one writer */
async function reverseEntry(db, entity, entry_id, opt) {
  const options = opt || {};
  if (!String(options.reason || '').trim()) throw refuse('A reversal needs a reason.');
  return postEntry(db, entity, { type: 'reversal', owner: true, reverses: entry_id, reason: options.reason, by: options.by, source_ref: 'reverse:' + entry_id });
}

/* ═══ the switch: seed the chart and the year, then turn on ══════════════════════════════════════════════════════ */

/**
 * enable(db, entity, { by, walkin_grain, today }) — the shop's chart from its country pack (groups, then ledgers under
 * them), this year's months, party numbers for everyone already on the lists, then the switch. Safe to run twice.
 */
async function enable(db, entity, opt) {
  const options = opt || {};
  return onDb(db, entity, async (handle) => enableOn(handle, entity, options));
}
/** enable's work inside the shop's transaction: read the country, lay the chart, open the year, switch on, number the parties */
async function enableOn(h, entity, o) {
  const cur = await settingOf(h, entity);
  if (cur === null) throw refuse('The ledger tables are not created yet — run migrations b272–b274 first.', 'BOOKS_NOT_MIGRATED');
  /* ⭐ CX0 + CS2 (2026-10-13): the shop's country · money · year are READ from their one home — Country setup (lib/country-setup.profile,
     read FRESH: the gate's status() is cached a minute and would hand back the country of a moment ago) — never 'IN' by default; a caller
     may hand them in (sim-load). `constitution: false`: the books need no product/transaction read here. The route's CS.gate already
     refused a shop whose setup is not done. ⚠️ accounts-packs v1.20 holds India's chart only: another country's chart is India's with
     `fallback: true` until the books engines are adopted at ≥ v1.41 (web docs/design/standards/COUNTRY-COVERAGE.md, fix round 2). */
  const cs = await CS.profile(h, entity, { constitution: false });
  const { country, pack } = enablePackOf(o, cur, cs);
  const added = await seedChart(h, entity, pack, country, o);
  /* the year the ledger opens in is the SHOP's day (M210: books-hooks.dayOf in the shop's zone), not the UTC date — 09:00 on 1 July
     in Sydney is still 30 June in UTC, which opened an AU ledger a year early (WX-R2R) */
  const fiscalYear = E.packs().fiscalYearOf(o.today || require('./books-hooks').dayOf(CLOCK.now(), { country, timezone: cs && cs.timezone }), pack);
  await ensureYear(h, entity, fiscalYear, pack);
  await switchOn(h, entity, { currentSetting: cur, pack, country, options: o });
  /* every party already on the lists gets its number now, oldest first (b274; skipped without it) */
  const numbered = await require('../db').trySavepoint(h, () => require('./party-fields').numberAll(h, entity), null);
  offSaid.delete(String(entity));
  return { ok: true, accounts_added: added, fiscal_year: fiscalYear, parties_numbered: numbered };
}
/** the country and the country pack an enable() lays: the caller's, the stored setting's, else the setup's; refused in words when the country or the money is unstated */
function enablePackOf(o, cur, cs) {
  const country = countryOfEnable(o, cur, cs);
  const pack0 = E.packs().packFor(country);
  /* the setup's money and year count only when it is THIS country's setup (a profile row of another country is not this shop's fact) */
  const own = cs.country && cs.country.code && String(cs.country.code).toUpperCase() === country ? cs : {};
  /* the YEAR is the pack's (CS2: until the shop is constituted, a country correction re-derives the FY from the new pack — a stored month
     may still be the old country's; an Australian shop opened on India's April). The caller may hand one in. ⚠️ debt: a country whose
     businesses CHOOSE their year (UAE) needs the setup's month here once CS2's correction rewrites it — CX2 (accounts). */
  const pack = Object.assign({}, pack0, {
    fy_start_month: Number(o.fy_start_month) || pack0.fy_start_month || Number(own.fy_start_month),
    currency: o.currency || own.currency || pack0.currency
  });
  /* STD2: neither the setup nor the pack states the money or the year → asked in the ONE sentence, before a single ledger is laid */
  if (!pack.currency || !pack.fy_start_month) throw refuse(CS.MONEY_UNSTATED, 'NO_MONEY');
  return { country, pack };
}
/** the country an enable() opens the books in: the caller's, a ledger already open (its country is fixed), else the setup's; none → refused in words */
function countryOfEnable(o, cur, cs) {
  const country = String(o.country || (cur && cur.country) || (cs.country && cs.country.code) || '').toUpperCase();
  /* GOV-AU1: no country anywhere → refused in words (books_setting.country is NOT NULL); never India's books by default */
  if (!country) throw refuse('Set the shop\u2019s country first (Country setup) — the books are kept by its law.', 'NO_COUNTRY');
  return country;
}
/** lay the pack's chart over what the shop already has (groups first, ledgers under them); → how many accounts were added */
async function seedChart(handle, entity, pack, country, options) {
  const rows = E.chartRows(pack);
  const idOf = new Map((await S.accounts(handle, entity)).map((item) => [item.code, item.account_id]));
  const keyToCode = new Map(rows.map((item) => [item.key, item.code]));
  let added = 0;
  for (const r of rows) {
    if (idOf.has(r.code)) continue;
    const parent = r.parent ? idOf.get(keyToCode.get(r.parent)) : null;
    const id = await S.insertAccount(handle, entity, {
      code: r.code,
      name: r.name,
      parent_id: parent || null,
      is_group: r.is_group,
      nature: r.nature,
      role: r.role,
      pack_code: country,
      pack_version: options.pack_version || null,
      tally_group: r.tally_group,
      sch3_line: r.sch3_line,
      saft_grouping: r.saft_grouping,
      by: options.by
    });
    if (id) {
      idOf.set(r.code, id);
      added++;
    }
  }
  return added;
}
/** the switch itself: the books_setting row (enabled) and its change-log line */
async function switchOn(handle, entity, { currentSetting, pack, country, options }) {
  await S.saveSetting(handle, entity, {
    enabled: true,
    walkin_grain: options.walkin_grain || (currentSetting && currentSetting.walkin_grain) || 'day',
    fy_start_month: pack.fy_start_month,
    functional_currency: pack.currency,
    country,
    pack_version: options.pack_version || null,
    by: options.by,
    /* ⚠️ WX-O2C (2026-10-13): the year above is read off the shop clock, so its first moment is too — enabled_at was SQL now(), and a loader
       that set the clock to 2023 got a ledger that "began" in 2026 and refused its own opening balances. Real clock: null → now(), as before. */
    at: CLOCK.isSimulated && CLOCK.isSimulated() ? CLOCK.now().toISOString() : null
  });
  await S.logChange(handle, entity, {
    by: options.by,
    table_name: 'books_setting',
    row_id: entity,
    field: 'enabled',
    old: currentSetting ? String(!!currentSetting.enabled) : null,
    new: 'true'
  });
}

/**
 * ⭐ reseedUnposted(h, entity, { country, by }) — CS2: the country was CORRECTED on the setup step before the shop was constituted (lib/country-setup.save, same
 * transaction). A ledger that was switched on but never posted (no journal_entry — country-setup.isConstituted said so) drops its chart and its periods and is
 * seeded again from the new pack through enable(): nothing posted exists, so nothing is converted. The counters stay (a party number is assigned once, never
 * reused). null when there is no ledger row to re-seed; { accounts_added, fiscal_year } otherwise. Refused when an entry exists — this is never a conversion.
 */
async function reseedUnposted(handle, entity, options) {
  const currentSetting = await settingOf(handle, entity);
  if (!currentSetting || !currentSetting.entity_id || currentSetting.country === undefined) return null;
  if ((await S.entries(handle, entity, '0001-01-01', '9999-12-31')).length)
    throw refuse('This ledger has posted entries — its chart is never re-seeded.', 'BOOKS_CONSTITUTED');
  const pack = E.packs().packFor(options.country),
    packs = E.packs();
  const rows = E.chartRows(pack),
    keyToCode = new Map(rows.map((item) => [item.key, item.code]));
  const laid = rows.map((item) => Object.assign({}, item, { parent_code: item.parent ? keyToCode.get(item.parent) || null : null }));
  /* ⚠️ no DELETE on the setup tables (b272): park → re-label the year by period number → enable() inserts what the new pack adds and the new year if it is new → lay the pack over the existing codes */
  await S.parkChart(handle, entity);
  const today = options.today || CLOCK.today(),
    fiscalYear = packs.fiscalYearOf(today, pack);
  const have = await S.periods(handle, entity);
  /* ⚠️ FX-AU1: a year is re-laid when its DATES are not the new pack's — not only when its label differs. India and Australia both call
     Oct 2026 "2026-27" (April vs July), so the label test kept India's April–March under an Australian ledger and the To-do counted
     April … September as over and open. The year already carrying the new label is re-laid in place; else the old one is re-labelled. */
  const yearRange = packs.fyRange(fiscalYear, pack),
    firstMonth = packs.periodRange(fiscalYear, 1, pack);
  const same = have.filter((item) => item.fiscal_year === fiscalYear);
  const laidRight = same.some((item) => Number(item.period) === 1 && isoDay(item.start_date) === firstMonth.start);
  const oldFy = same.length ? (laidRight ? null : fiscalYear) : [...new Set(have.map((item) => item.fiscal_year))].filter((y) => y !== fiscalYear)[0] || null;
  if (oldFy) {
    const relabel = [{ period: 0, fiscal_year: fiscalYear, start_date: yearRange.start, end_date: yearRange.start }];
    for (let count = 1; count <= 12; count++) {
      const monthRange = packs.periodRange(fiscalYear, count, pack);
      relabel.push({ period: count, fiscal_year: fiscalYear, start_date: monthRange.start, end_date: monthRange.end });
    }
    await S.relabelPeriods(handle, entity, oldFy, relabel);
  }
  if (!currentSetting.enabled) {
    await S.rechart(handle, entity, laid, { pack_code: options.country });
    await S.saveSetting(handle, entity, {
      enabled: false,
      walkin_grain: currentSetting.walkin_grain,
      fy_start_month: pack.fy_start_month,
      functional_currency: pack.currency,
      country: options.country,
      by: options.by
    });
    return { accounts_added: 0, fiscal_year: null };
  }
  const enabled = await enable(handle, entity, { country: options.country, by: options.by, walkin_grain: currentSetting.walkin_grain, today });
  await S.rechart(handle, entity, laid, { pack_code: options.country });
  return { accounts_added: enabled.accounts_added, fiscal_year: enabled.fiscal_year };
}

/**
 * a ledger the shop adds under a group: the next free code in the group's range, role null (SPEC §0).
 * ⭐ IM1 (widened, additively): `a.source_code` — the code the ledger had in Xero / QuickBooks, KEPT beside ours (b302). A source code another ledger
 *   already holds is a COLLISION, refused in words; before b302 it cannot be kept and the answer says so (`source_code_written: false`). `pre`
 *   ({ chart, setting }) lets the move-in importer hand in the chart it already read, so a file of 80 ledgers is one read, not 80 (rule: no per-row queries).
 */
async function addAccount(db, entity, ledgerInput, preread) {
  /* ⭐ THE SYSTEM GIVES THE CODE (REQUIREMENT: "who chooses the numbers"): a code a person typed is refused, never used or "corrected" — engines nextCode finds the next free one */
  if (ledgerInput.code != null && String(ledgerInput.code).trim() !== '') throw refuse('The code is given by the system — name the ledger and pick its group.');
  return onDb(db, entity, async (handle) => addAccountOn(handle, entity, ledgerInput, preread));
}
/** addAccount's work inside the shop's transaction: validate, take the next free code, insert, log, and keep the caller's pre-read chart current */
async function addAccountOn(handle, entity, ledgerInput, preread) {
  const chart = (preread && preread.chart) || (await S.accounts(handle, entity));
  const group = chart.find((x) => String(x.account_id) === String(ledgerInput.parent_id) && x.is_group);
  if (!group) throw refuse('Pick the group this ledger belongs under.');
  const { name, text } = ledgerNameAndSourceCode(ledgerInput, chart);
  const setting = (preread && preread.setting) || (await settingOf(handle, entity));
  const code = freeCodeUnder(packOf(setting), chart, group, name);
  const id = await S.insertAccount(handle, entity, {
    code,
    name,
    parent_id: group.account_id,
    is_group: false,
    nature: group.nature,
    role: null,
    tally_group: group.tally_group,
    sch3_line: group.sch3_line,
    saft_grouping: group.saft_grouping,
    by: ledgerInput.by,
    source_code: text || null
  });
  await S.logChange(handle, entity, {
    by: ledgerInput.by,
    table_name: 'ledger_account',
    row_id: id,
    field: 'created',
    new: code + ' ' + name + (text ? ' (was ' + text + ')' : '')
  });
  const written = text ? await require('./schema').hasColumn('ledger_account', 'source_code') : null;
  if (preread && preread.chart)
    preread.chart.push({
      account_id: id,
      code,
      name,
      parent_id: group.account_id,
      is_group: false,
      nature: group.nature,
      role: null,
      tally_group: group.tally_group,
      sch3_line: group.sch3_line,
      saft_grouping: group.saft_grouping,
      active: true,
      source_code: written ? text : null
    });
  return Object.assign({ ok: true, account_id: id, code, name }, text ? { source_code: written ? text : null, source_code_written: !!written } : {});
}
/** the ledger's name (trimmed, 120 characters) and its kept source code (20), refused in words when the name is empty or the source code is already on another ledger */
function ledgerNameAndSourceCode(ledgerInput, chart) {
  const name = String(ledgerInput.name || '')
    .trim()
    .slice(0, 120);
  if (!name) throw refuse('A ledger needs a name.');
  const text = ledgerInput.source_code == null ? '' : String(ledgerInput.source_code).trim().slice(0, 20);
  if (text) {
    const held = chart.find((x) => x.source_code && String(x.source_code).toUpperCase() === text.toUpperCase());
    if (held) throw refuse('Code ' + text + ' is already on ledger ' + held.code + ' ' + held.name + ' — a code clash.');
  }
  return { name, text };
}
/** the next free code under a group (the engine's nextCode), checked by the engine's own withAccounts; refused in words when none is left */
function freeCodeUnder(pack, chart, group, name) {
  const key = (pack.groups || []).find((item) => E.groupCode(item) === group.code);
  const code = key
    ? E.packs().nextCode(
        E.packWith(pack, chart),
        key.code,
        chart.map((x) => x.code)
      )
    : null;
  if (!code) throw refuse('The group "' + group.name + '" has no free code left.');
  try {
    E.packs().withAccounts(E.packWith(pack, chart), [{ code, name, group: key.code }]);
  } catch (e) {
    throw refuse(e.message);
  }
  return code;
}

/** the opening rows → CBPosting lines (major units) and, beside them, each row's party, bill reference and due date; a party is named by its number or its id */
function openingLinesOf(rows, byNo, currency) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    DATE = /^\d{4}-\d{2}-\d{2}$/;
  const lines = [],
    refs = [];
  for (const [i, openingRow] of rows.entries()) {
    const party = openingRow.party_no
      ? byNo.get(String(openingRow.party_no).toUpperCase())
      : UUID.test(String(openingRow.party_id || ''))
        ? openingRow.party_id
        : undefined;
    if (openingRow.party_no && !party) throw refuse('Row ' + (i + 1) + ': no party numbered ' + openingRow.party_no + '.');
    lines.push({ account: String(openingRow.code), dr: fromMinor(openingRow.dr_minor || 0, currency), cr: fromMinor(openingRow.cr_minor || 0, currency), party }); /* ACC-179: was / 100 */
    refs.push({
      party,
      bill_ref: openingRow.bill_ref ? String(openingRow.bill_ref).slice(0, 60) : null,
      due_date: DATE.test(String(openingRow.due_date || '')) ? openingRow.due_date : null
    });
  }
  return { lines, refs };
}
/**
 * ⭐ IM1 — THE OPENING ENTRY, AS ONE FUNCTION (moved here from routes/books.js POST /opening, unchanged in what it does, so the move-in importer posts a
 * trial balance and the open bills through the SAME door). rows: [{ code, party_no? | party_id?, dr_minor, cr_minor, bill_ref?, due_date? }] → ONE entry,
 * period 0 (is_opening); a party row names its bill (bill_ref) so dues are bill-wise from day one; any difference goes to Suspense 2900.
 * `pre.parties` lets a caller hand in the party list it already read. Answers postEntry's result plus `suspense_minor`.
 */
async function postOpening(handle, entity, opening, preread) {
  const rows = Array.isArray(opening.rows) ? opening.rows : [];
  if (!rows.length) throw Object.assign(refuse('No rows.', 'BOOKS_BAD_REQUEST'), { status: 400 });
  const badRows = rows.map((item, index) => (Number(item.dr_minor) > 0 === Number(item.cr_minor) > 0 ? index + 1 : 0)).filter(Boolean);
  if (badRows.length) throw refuse('Row ' + badRows.join(', ') + ': one amount — a debit or a credit, not both.', 'BOOKS_BAD_REQUEST');
  const parties = (preread && preread.parties) || (await S.parties(handle, entity));
  const byNo = new Map(parties.filter((item) => item.party_no).map((item) => [String(item.party_no).toUpperCase(), item.party_id]));
  const { lines, refs } = openingLinesOf(rows, byNo, opening.currency);
  const posted = await postEntry(handle, entity, {
    type: 'opening',
    date: opening.date,
    currency: opening.currency,
    lines,
    line_refs: refs,
    source_ref: opening.client_ref ? 'opening:' + String(opening.client_ref).slice(0, 80) : null,
    narration: opening.narration || 'Opening balances',
    by: opening.by
  });
  const entry = posted.entry_id ? await S.entry(handle, entity, posted.entry_id) : null;
  const chart = (preread && preread.chart) || (await S.accounts(handle, entity));
  const suspense = chart.find((item) => item.role === 'suspense');
  const list = entry && suspense ? entry.lines.filter((item) => String(item.account_id) === String(suspense.account_id)) : [];
  return Object.assign({}, posted, { suspense_minor: list.reduce((total, item) => total + Number(item.cr_minor) - Number(item.dr_minor), 0) });
}

/**
 * ⭐ M157 — WHAT A MONTH MAY DO, said by the server, one rule: Lock is offered for a FINISHED month (its last day is before today), oldest first (every earlier
 * month of that year already locked); a soft lock can be opened again with a reason, a hard lock never. Each month carries its entries and its sales.
 * → rows with { entries, sales_minor, lock: { may, why }, reopen: { may, why }, return?: { form, period, label, closed } }
 * ACC-204 (Athi, 30 Oct): the lock stays allowed; `return` names the tax period the month ends in and whether its close has run (taxPeriods =
 * books-period.returnStatesFor's periods, each with its form) — only for a pack whose return the ledgers close; India's rows are unchanged.
 */
function periodAdvice(rows, figures, today, taxPeriods) {
  const lookup = new Map((figures || []).map((item) => [item.fiscal_year + '|' + item.period, item]));
  const locked = (period) => period.status === 'soft_locked' || period.status === 'hard_locked';
  const taxPeriodOf = (item) => {
    const end = String(item.end_date || '').slice(0, 10);
    const found = Number(item.period) >= 1 && end ? (taxPeriods || []).find((taxPeriod) => taxPeriod.start <= end && end <= taxPeriod.end) : null;
    return found ? { return: { form: found.form, period: found.period, label: found.label, closed: found.closed } } : {};
  };
  return (rows || []).map((item, index) => {
    const monthFigures = lookup.get(item.fiscal_year + '|' + Number(item.period)) || { entries: 0, sales_minor: 0 };
    /* the earlier MONTHS (1-12, never the opening period 0) of this year and of any earlier year the books hold; the first month of the first year has none */
    const earlier = rows.slice(0, index).filter((x) => Number(x.period) >= 1 && !locked(x));
    let lock = { may: false, why: null };
    if (locked(item)) lock.why = 'Already locked.';
    else if (!(item.end_date && String(item.end_date).slice(0, 10) < today)) lock.why = 'This month is not over yet.';
    else if (earlier.length) lock.why = 'Lock the earlier months first.';
    else lock = { may: true, why: null };
    const reopen =
      item.status === 'soft_locked'
        ? { may: true, why: 'Opening it again needs a reason.' }
        : item.status === 'hard_locked'
          ? { may: false, why: 'Closed for good — it never opens again.' }
          : { may: false, why: null };
    return Object.assign({}, item, { entries: monthFigures.entries, sales_minor: monthFigures.sales_minor, lock, reopen }, taxPeriodOf(item));
  });
}

/** lock / unlock a month — soft is reversible with a reason, hard is not (Odoo lock vs hard lock) */
async function setPeriod(db, entity, fiscalYear, period, status, by, reason) {
  return onDb(db, entity, async (handle) => {
    const rows = await S.periods(handle, entity, fiscalYear);
    const row = rows.find((item) => Number(item.period) === Number(period));
    if (!row) throw refuse('No such month.', 'BOOKS_NOT_FOUND');
    if (row.status === 'hard_locked') throw refuse('That month is closed for good.');
    if (status === 'open' && !String(reason || '').trim()) throw refuse('Opening a locked month needs a reason.');
    await S.setPeriodStatus(handle, entity, fiscalYear, period, status, by, reason);
    await S.logChange(handle, entity, {
      by,
      table_name: 'fiscal_period',
      row_id: fiscalYear + '/' + period,
      field: 'status',
      old: row.status,
      new: status + (reason ? ' — ' + reason : '')
    });
    return { ok: true, fiscal_year: fiscalYear, period: Number(period), status };
  });
}

/* ═══ the year close ═════════════════════════════════════════════════════════════════════════════════════════════ */

/** the financial year after `fy` */
const nextYearOf = (fiscalYear, pack) => E.packs().fiscalYearOf(addDays(E.packs().fyRange(fiscalYear, pack).end, 1), pack);
/* the refusals the books add beside the period engine's — each one stops the close on its own */
const BOOKS_REFUSALS = ['year_not_ended', 'return_open'];
/** ACC-204: the refusal that names every tax period of the year not closed yet — the screen branches on its code and opens Tax close with the labels */
const returnOpenRefusal = (taxState) => ({
  name: 'return_open',
  code: 'PERIOD_RETURN_OPEN',
  why: 'Close each ' + taxState.short + ' period first — not closed yet: ' + taxState.open.join(', ') + '.',
  periods: taxState.open
});
/**
 * ⭐ yearState(handle, entity, fiscalYear) → { fiscal_year, closed, months: [{ period, status }], can_close, refusals[], next } — the engine's own question
 *   (CBPeriod.yearClose) asked of the books as they stand; nothing is written. A refusal is { name, why } in plain words.
 * The trial balance and Suspense are READ from the ledger engine over the year's rows (yearBalances), never typed in.
 * ACC-204 (Athi, 30 Oct 2026): a pack whose return the ledgers close (BAS, VAT201) must have every tax period of the year closed first —
 *   books-period.returnStateFor reads the closes' own records; the refusal `return_open` carries the code and the open labels. IN: unchanged.
 */
async function yearState(handle, entity, fiscalYear) {
  const setting = await settingOf(handle, entity),
    pack = packOf(setting),
    packs = E.packs();
  const range = packs.fyRange(fiscalYear, pack);
  if (!range) throw refuse('Which financial year? e.g. ' + packs.fiscalYearOf(isoDay(CLOCK.now()), pack) + '.', 'BOOKS_BAD_REQUEST');
  const allRows = await S.periods(handle, entity, null),
    rows = allRows.filter((item) => item.fiscal_year === fiscalYear);
  const periods = periodsOf([rows]);
  const months = rows.filter((item) => Number(item.period) >= 1).map((item) => ({ period: Number(item.period), status: item.status }));
  const closed = months.length >= 12 && months.every((item) => item.status === 'hard_locked');
  const ledgerContext = await ledgerCtx(handle, entity);
  const closing = E.period().yearClose({ fiscal_year: fiscalYear, periods, pack: ledgerContext.pack, balances: await yearBalances(handle, entity, fiscalYear, ledgerContext), lines: [], asOf: isoDay(range.end) });
  const refusals = closing.refusals.map((x) => ({ name: x.name, why: x.why }));
  const taxState = await require('./books-period').returnStateFor(handle, entity, setting, fiscalYear, { rows: allRows });
  if (taxState.open.length) refusals.unshift(returnOpenRefusal(taxState));
  /* a year still running is not closed: the shop's day (the same reader the writer uses) must be past its last day */
  const shopDay = require('./books-hooks').dayOf(CLOCK.now(), setting),
    end = isoDay(range.end);
  if (shopDay && shopDay <= end) refusals.unshift({ name: 'year_not_ended', why: fiscalYear + ' ends on ' + end + ' — close it once it has ended.' });
  return {
    fiscal_year: fiscalYear,
    closed,
    months,
    can_close: closing.ok && !refusals.some((x) => BOOKS_REFUSALS.includes(x.name)),
    refusals,
    next: nextYearOf(fiscalYear, pack),
    carry: closing.carryForward,
    rows
  };
}
/**
 * ⭐ closeYear(db, entity, fiscalYear, by) — POST /year/:fy/close. The period engine decides (every month locked · Suspense nil · trial balance balanced);
 * a refusal comes back NAMED and nothing is written. When it says ok, the year is closed for good: every month and the brought-forward row of
 * `fy` go to hard_locked (a status change, logged — no entry is edited or deleted) and the NEXT year's months are created open, so its
 * period 0 can take opening entries. The next year's opening balances are CBLedger.carryForward's rows — the ones yearBalances already
 * derives for every report, which is why nothing is stored a second time (it would be counted twice, and the nightly check would call it drift).
 * IDEMPOTENT BY FY: a closed year answers { ok, duplicate: true } and changes nothing.
 */
async function closeYear(db, entity, fiscalYear, by) {
  return onDb(db, entity, async (handle) => {
    const state = await yearState(handle, entity, fiscalYear);
    if (state.closed) return { ok: true, duplicate: true, fiscal_year: fiscalYear, next: state.next };
    if (!state.can_close) return { ok: false, fiscal_year: fiscalYear, refusals: state.refusals, next: state.next };
    const setting = await settingOf(handle, entity),
      pack = packOf(setting);
    for (const r of state.rows) {
      if (r.status === 'hard_locked') continue;
      await S.setPeriodStatus(handle, entity, fiscalYear, Number(r.period), 'hard_locked', by, 'Year close ' + fiscalYear);
    }
    await S.logChange(handle, entity, { by, table_name: 'fiscal_period', row_id: fiscalYear, field: 'year_closed', old: 'open', new: 'closed — carried to ' + state.next });
    await ensureYear(handle, entity, state.next, pack);
    const carry = state.carry || {};
    return {
      ok: true,
      fiscal_year: fiscalYear,
      next: state.next,
      locked: state.rows.length,
      opening: { rows: (carry.rows || []).length, retained_minor: carry.retained_minor, profit_minor: carry.profit_minor, balanced: carry.balanced }
    };
  });
}

/* ═══ what the ledger engine reads: month rows (with the COMPUTED carryforward) + the open month's lines ════════ */

/**
 * yearBalances(h, entity, fy) → CBLedger balance rows for one year: the stored month rows (period 0 holds any opening
 * entries) + period 0 carried forward from the year before, COMPUTED by CBLedger.carryForward (SAP carryforward; no
 * journal entry, never stored — so a permitted late correction to the old year flows through by itself).
 */
async function yearBalances(handle, entity, fiscalYear, ctx, depth) {
  const ledgerContext = ctx || (await ledgerCtx(handle, entity));
  if (ledgerContext.cache[fiscalYear]) return ledgerContext.cache[fiscalYear];
  const packs = E.packs();
  /* PERF1: the month rows of EVERY year this carry walks back through, in ONE read (the shop's years up to fy) — it was one trip per year, each
     scanning the shop's whole account_balance (its key leads with account, not year; b406 adds the year index). Still computed, never stored. */
  if (!ledgerContext.rowsOf) {
    const want = ledgerContext.years.filter((y) => y <= fiscalYear).slice(-31);
    if (want.indexOf(fiscalYear) < 0) want.push(fiscalYear);
    ledgerContext.rowsOf = {};
    want.forEach((y) => {
      ledgerContext.rowsOf[y] = [];
    });
    (await S.yearRows(handle, entity, want)).forEach((item) => {
      (ledgerContext.rowsOf[item.fiscal_year] = ledgerContext.rowsOf[item.fiscal_year] || []).push(item);
    });
  }
  let rows = (ledgerContext.rowsOf[fiscalYear] || (await S.yearRows(handle, entity, fiscalYear))).map((item) => E.balanceOf(item, S.ZERO));
  const prev = packs.fiscalYearOf(addDays(packs.fyRange(fiscalYear, ledgerContext.pack).start, -1), ledgerContext.pack);
  if (ledgerContext.years.length && ledgerContext.years[0] <= prev && (depth || 0) < 30) {
    const before = await yearBalances(handle, entity, prev, ledgerContext, (depth || 0) + 1);
    const carry = E.ledger().carryForward({ pack: ledgerContext.pack, balances: before, lines: [], fiscal_year: prev });
    /* ⚠️⚠️ NEVER AN EMPTY CARRY, SILENTLY (engines v1.8.1): while last year's Suspense is not nil the engine carries NOTHING —
       and a new year that opened at zero would still "balance". Refused by name instead; clearing Suspense lifts it. */
    if (carry.ok === false) throw refuse(SUSPENSE_NOT_NIL(prev), 'SUSPENSE_NOT_NIL');
    rows = rows.concat(
      carry.rows.map((item) => ({
        fiscal_year: item.fiscal_year,
        period: 0,
        code: item.code,
        party: item.party,
        dr_minor: item.dr_minor,
        cr_minor: item.cr_minor
      }))
    );
  }
  ledgerContext.cache[fiscalYear] = rows;
  return rows;
}
/** what a report needs once: the setting, the chart, the pack with that chart, the shop's years and an empty year cache */
async function ledgerCtx(handle, entity) {
  const setting = await settingOf(handle, entity);
  const chart = await S.accounts(handle, entity);
  return { s: setting, chart, pack: E.packWith(packOf(setting), chart), years: await S.years(handle, entity), cache: {} };
}
const lineRows = async (handle, entity, from, to, party) => (await S.ledgerLines(handle, entity, from, to, party)).map(E.lineOf);
/** the first day of the month a date falls in, by the pack's own year */
function monthStart(pack, date) {
  const packs = E.packs();
  return packs.periodRange(packs.fiscalYearOf(date, pack), packs.periodOf(date, pack), pack).start;
}

/** CBLedger's input for "as at `asOf`": the year's rows + the lines of asOf's month up to asOf */
async function asAtInput(handle, entity, asOf, ledgerContext) {
  const x = ledgerContext || (await ledgerCtx(handle, entity));
  const packs = E.packs();
  const fiscalYear = packs.fiscalYearOf(asOf, x.pack),
    period = packs.periodOf(asOf, x.pack);
  /* ⚠️ A MID-MONTH DATE READS ITS MONTH FROM LINES ONLY (local walk, 14 Oct). The ledger engine (v1.44.1, H1) takes a month from its LINES when
     any are given and from its ROW when none are — and refuses a row for a mid-month date, because a row is a whole month. A month whose only
     entries come AFTER the date (sale on the 14th, ledger "from the 14th" asks for the 13th) gave no lines and its whole-month row → 422 on every
     ledger, Bank rec, TB/BS as at that day. So on a date that is not its month's end, that month's row is left out: no lines = nothing moved yet. */
  const monthEnd = packs.periodRange(fiscalYear, period, x.pack).end === asOf;
  const rows = await yearBalances(handle, entity, fiscalYear, x);
  const balances = monthEnd ? rows : rows.filter((item) => !(item && item.fiscal_year === fiscalYear && Number(item.period) === Number(period)));
  return { pack: x.pack, balances, lines: await lineRows(handle, entity, monthStart(x.pack, asOf), asOf), asOf };
}
/** the trial balance as at a date, from the ledger engine over the stored rows */
async function trialBalance(handle, entity, asOf) {
  return E.ledger().trialBalance(await asAtInput(handle, entity, asOf));
}
/** basis (optional): the shop's entity basis (company · proprietor · partnership …) — a proprietor / partnership then sees ONE Capital account (v1.16.0, presentation only). None → Schedule III as before. */
async function balanceSheet(handle, entity, asOf, basis) {
  const input = await asAtInput(handle, entity, asOf);
  if (basis) input.entity_basis = basis;
  return E.ledger().balanceSheet(input);
}
/**
 * the shop's entity basis, only when it is KNOWN: a setting `entity_basis` that names one of the pack's entity_bases. Nothing holds it today.
 * TODO(Athi, open decision): where entity_type lives (shop setting at books-enable? the profile?) is NOT decided — never guessed from the PAN.
 * Until then every shop keeps the company / Schedule III grouping.
 */
function entityBasisOf(setting) {
  const basisName = setting && setting.entity_basis ? String(setting.entity_basis) : '';
  return basisName && Object.prototype.hasOwnProperty.call(packOf(setting).entity_bases || {}, basisName) ? basisName : undefined;
}
/** P&L inside one fiscal year: the rows + the lines of the month of `to` and of the day before `from` */
async function profitAndLoss(handle, entity, from, to) {
  const ledgerContext = await ledgerCtx(handle, entity);
  const packs = E.packs();
  const fiscalYear = packs.fiscalYearOf(to, ledgerContext.pack);
  const prev = addDays(from, -1);
  const lines = (await lineRows(handle, entity, monthStart(ledgerContext.pack, to), to)).concat(
    packs.fiscalYearOf(prev, ledgerContext.pack) === fiscalYear && packs.periodOf(prev, ledgerContext.pack) !== packs.periodOf(to, ledgerContext.pack) ? await lineRows(handle, entity, monthStart(ledgerContext.pack, prev), prev) : []
  );
  return E.ledger().profitAndLoss({ pack: ledgerContext.pack, balances: await yearBalances(handle, entity, fiscalYear, ledgerContext), lines, from, to });
}
/** one party on one control account: rows of from's year + every line from the month of `from` to `to` */
async function partyStatement(handle, entity, party, role, from, to) {
  const ledgerContext = await ledgerCtx(handle, entity);
  const packs = E.packs();
  const account = ledgerContext.chart.find((x) => x.role === role);
  if (!account) return null;
  const fiscalYear = packs.fiscalYearOf(from, ledgerContext.pack);
  return E.ledger().partyStatement({
    pack: ledgerContext.pack,
    balances: await yearBalances(handle, entity, fiscalYear, ledgerContext),
    lines: await lineRows(handle, entity, monthStart(ledgerContext.pack, from), to, party),
    party,
    code: String(account.code),
    from,
    to
  });
}
/** one ledger (any account, or account+party) between two dates: its opening from the rows, then its lines */
async function ledgerOf(handle, entity, account, party, from, to) {
  const ledgerContext = await ledgerCtx(handle, entity);
  const packs = E.packs();
  const prev = addDays(from, -1),
    fiscalYear = packs.fiscalYearOf(from, ledgerContext.pack);
  /* ⚠️ on the first day of a year the opening is the CARRIED period 0 (an income ledger opens at nil), not last year's close */
  const first = packs.fiscalYearOf(prev, ledgerContext.pack) !== fiscalYear;
  const input = !first
    ? await asAtInput(handle, entity, prev, ledgerContext)
    : {
        pack: ledgerContext.pack,
        balances: (await yearBalances(handle, entity, fiscalYear, ledgerContext)).filter((item) => Number(item.period) === 0),
        lines: [],
        asOf: from
      }; /* period 0 only: the engine refuses a mid-month date whose own month row is given without its lines */
  const balances = E.ledger().balanceAsAt(input);
  const code = String(account.code);
  const open = party ? (((balances.parties || {})[code] || {})[party] || { net_minor: 0 }).net_minor : ((balances.accounts || {})[code] || { net_minor: 0 }).net_minor;
  /* ⭐ WX-R2R (2026-10-13): from the year's first day the opening IS period 0 — so period 0's own entries (the shop's opening JV, dated that day)
     are already in it; `period0` tells the reader to leave them out of the lines, or the Cash ledger closed at ₹10,07,689.62 against the
     trial balance's ₹5,07,689.62 (the ₹5,00,000 opening counted twice). */
  return { opening_minor: open, period0: first };
}
/** the nightly controls (CBLedger.controls) as at a date */
async function controls(handle, entity, asOf) {
  return E.ledger().controls(await asAtInput(handle, entity, asOf));
}

module.exports = {
  composeEntry,
  previewEntry,
  chartOf,
  nextNosInOrder,
  entityBasisOf,
  voucherOf,
  voucherTypeOfEntry,
  postEntry,
  reverseEntry,
  reversalWhy,
  recordPayment,
  partyOnList,
  knownParty,
  refuse,
  enable,
  reseedUnposted,
  addAccount,
  postOpening,
  setPeriod,
  periodAdvice,
  settingOf,
  packOf,
  curOf,
  controlOf,
  partyItems,
  paymentEvent,
  proposeFor,
  duplicateWarnings,
  warningWords,
  warningTitle,
  excessWarning,
  acknowledgements,
  acknowledged,
  previewWords,
  paymentOutcome,
  owesWords,
  adviceMay,
  adviceState,
  adviceBody,
  adviceFor,
  dateWords,
  addDays,
  ensureYear,
  postingDateFor,
  yearState,
  closeYear,
  periodsOf,
  balanceRows,
  yearBalances,
  ledgerCtx,
  asAtInput,
  trialBalance,
  balanceSheet,
  profitAndLoss,
  partyStatement,
  ledgerOf,
  controls,
  monthStart
};
