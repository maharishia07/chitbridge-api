// @stage tested
// @stage-note [BOOKS · PARALLEL RUN] An auditor's Tally (IN) or Xero / QuickBooks (AU) period beside ours: their trial balance, P&L, balance sheet and
// @stage-note return read from export files, kept as a snapshot (never posted), compared line by line — each difference with WHY in plain words.
'use strict';
/**
 * lib/parallel-run.js — THE PARALLEL-RUN COMPARE (round PR1, 2026-10-13; the critique: docs/critique/PR1.md).
 *
 * An auditor keeps the shop's books in Tally / Xero / QBO for a while beside ours. This takes THEIR period in (files, not a connection) and lays it beside
 * OUR statements, line by line: equal · different (both figures, the difference, and WHY where we can tell) · not mapped (their line has no ledger here) ·
 * only ours (a ledger of ours their file does not have). A difference names the entries behind OUR figure, so the screen opens them.
 *
 * OWNS      reading their statements into rows, mapping their lines to our ledgers, the line-by-line compare with its WHY, the auditor's csv. Pure: no database, no posting.
 * CALLED BY routes/books.js (the /compare routes: preflight · snapshot · compare · csv); tests/parallel-run.test.cjs · tests/acc-232-parallel-run.test.cjs.
 * FLOW      their file ──▶ preflight / read (normalise · tallyRows) ──▶ snapshot ──▶ compare(snapshot, OUR engines' answers) ──▶ lines per part ──▶ csv
 *
 * CARD 14-accounting/parallel-run
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1 — nothing here computes a balance, a total of ours, or tax) ──────────────────────────────────────────
 *   the file           lib/move-in readFile (csv · one xlsx sheet · "headings on row N") · guess / cells with THIS import's column table · toMinor (money.round)
 *   a Tally export     tools/tally-connector/adapters/tally.js `readers` (tag · tags · dataOf · unesc · num) — the one Tally XML reader
 *   the map            lib/move-in chartIndex (their code → `source_code`, the ledger's name, a control account's role) + Tally's group on every ledger (`tally_group`)
 *   OUR figures        handed in by the caller from the engines: lib/books trialBalance · profitAndLoss · balanceSheet, lib/books-period taxReturn (BAS · VAT201),
 *                      lib/tax-lines gstr3b over the rail (India) — this file only subtracts two integers per line and says why
 *   the entries        books-store entryLines (the day book's own read) — the ones behind a difference, with the chit that brought each in
 *
 * ── WHAT IS NEW, AND WHY ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   KINDS (the columns a TB / P&L / BS / return export carries) · tallyRows (a Tally TB / P&L / BS export as rows) · normalise (their rows → minor units) ·
 *   compare (the line-by-line answer) · effortOf (PR2's hook: entries per source) · csv (the auditor's file). Nothing existing read their statements or
 *   compared two sets of books — move-in POSTS a trial balance; this never does.
 *
 * ⚠️ THE TALLY XML SHAPES ARE RECALL, NOT SPEC (as IM0's export headers were): a Ledger collection (LEDGER · PARENT · CLOSINGBALANCE, Dr negative) and the
 *    report exports (DSPACCNAME › DSPDISPNAME with DSPCLDRAMTA / DSPCLCRAMTA for a trial balance, BSMAINAMT / PLSUBAMT for P&L and balance sheet). Proven on
 *    our fixtures only; Tally's Excel export (the columns step) is the door that never guesses.
 */
const moveIn = require('./move-in');
const money = require('./money');

const PARTS = ['tb', 'pl', 'bs', 'ret'];
const PART_WORD = { tb: 'Trial balance', pl: 'Profit and loss', bs: 'Balance sheet', ret: 'Return' };
const SOURCES = ['tally', 'xero', 'qbo'];
const SOURCE_WORD = { tally: 'Tally', xero: 'Xero', qbo: 'QuickBooks' };
const MAX_ENTRIES = 5; /* the entries shown under one difference (the count says how many there are) */

function refuse(reason, code) {
  const e = new Error(reason);
  e.refused = true;
  e.code = code || 'BOOKS_REFUSED';
  return e;
}
function badRequest(reason) {
  return refuse(reason, 'BOOKS_BAD_REQUEST');
}
const lowerText = (text) =>
  String(text == null ? '' : text)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const upperText = (text) =>
  String(text == null ? '' : text)
    .trim()
    .toUpperCase();
const cleanText = (value, maxLength) => {
  const cleaned = String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ');
  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
};
const squash = (text) => upperText(text).replace(/[^A-Z0-9]/g, '');

function partOf(part) {
  const lowered = lowerText(part);
  if (PARTS.indexOf(lowered) < 0) throw badRequest('Which of their statements is this — tb, pl, bs or ret?');
  return lowered;
}
function sourceOf(source) {
  const lowered = lowerText(source);
  if (SOURCES.indexOf(lowered) < 0) throw badRequest('Whose figures are these — tally, xero or qbo?');
  return lowered;
}

/* ═══ the columns each export carries — the trial balance is move-in's own, widened by the names Tally's Excel export uses ═══ */
const TRIAL_BALANCE = moveIn.KINDS.trial_balance;
const ACCOUNT = Object.assign(
  {},
  TRIAL_BALANCE.fields.find((item) => item.key === 'account'),
  { syn: TRIAL_BALANCE.fields.find((item) => item.key === 'account').syn.concat(['particulars', 'ledger name', 'line']) }
);
const CODE = TRIAL_BALANCE.fields.find((item) => item.key === 'code');
const AMOUNT = {
  key: 'amount',
  label: 'Amount',
  req: true,
  syn: ['amount', 'total', 'balance', 'value', 'net', 'closing balance', 'year to date', 'ytd', 'this period']
};
const KINDS = {
  tb: {
    label: 'Trial balance',
    fields: TRIAL_BALANCE.fields
      .map((item) =>
        item.key === 'account'
          ? ACCOUNT
          : item.key === 'debit' || item.key === 'credit'
            ? Object.assign({}, item, { syn: item.syn.concat([item.key + ' - year to date', 'ytd ' + item.key, 'closing ' + item.key, item.key + ' balance']) })
            : item
      )
      .concat([{ key: 'group', label: 'Group', req: false, syn: ['group', 'under', 'parent', 'account type', 'type', 'class'] }])
  },
  pl: { label: 'Profit and loss', fields: [ACCOUNT, CODE, AMOUNT] },
  bs: { label: 'Balance sheet', fields: [ACCOUNT, CODE, AMOUNT] },
  ret: {
    label: 'Return',
    fields: [
      { key: 'box', label: 'Box', req: true, syn: ['box', 'label', 'field', 'gst code', 'bas label', 'item', 'particulars', 'description', 'name', 'code'] },
      { key: 'amount', label: 'Amount', req: true, syn: ['amount', 'value', 'taxable value', 'figure', 'total'] },
      { key: 'tax', label: 'Tax', req: false, syn: ['tax', 'tax amount', 'gst', 'gst amount', 'vat', 'vat amount'] }
    ]
  }
};

/* ═══ their file → rows ═══ */
/** POST /compare/preflight: a table file → the columns guessed (move-in's matcher); a Tally XML → read at once (no columns to pick) */
function preflight(body, part, currency) {
  const request = body || {};
  if (typeof request.xml === 'string' && request.xml.trim()) {
    const rows = tallyRows(request.xml, part, currency);
    return { format: 'tally_xml', headers: [], fields: [], guess: [], missing: [], ready: true, rows_total: rows.length, sample: rows.slice(0, 5) };
  }
  const parsed = moveIn.readFile(request);
  const guessed = moveIn.guess(part, parsed.headers, KINDS);
  return Object.assign({ format: 'table', headers: parsed.headers }, guessed, {
    rows_total: parsed.rows.length,
    sample: parsed.rows.slice(0, 5),
    sheet: parsed.sheet || null,
    sheets: parsed.sheets || null,
    header_row: parsed.headerRow || 1
  });
}
/** the file, read as confirmed → { rows (their lines in minor units), skipped: [{ line, what, why }] } */
function read(body, part, currency) {
  const request = body || {};
  if (typeof request.xml === 'string' && request.xml.trim()) return { rows: tallyRows(request.xml, part, currency), skipped: [] };
  const cells = moveIn.cells(part, moveIn.readFile(request), request.decisions, KINDS);
  return normalise(part, cells, currency);
}

/** which side of a statement a heading row names — Xero's "Less Cost of Sales", QBO's "Total Income", a balance sheet's "Assets" */
function sideOfHeading(part, heading) {
  const words = lowerText(heading);
  if (part === 'pl') return /expense|cost|less|purchase/.test(words) ? 'expense' : /income|revenue|sales|turnover|trading/.test(words) ? 'income' : null;
  if (part === 'bs')
    return /liabilit|equity|capital|reserve|loan/.test(words) ? 'liabilities' : /asset|bank|cash|debtor|receivable|stock|inventor/.test(words) ? 'assets' : null;
  return null;
}
const TOTAL_ROW = /^(total|totals|grand total|net profit|net loss|gross profit|gross loss|net assets|net income|profit for|loss for)\b/i;
/** a cell as minor units: 0 when blank, null when it is not an amount */
const minorOrZero = (value, currency) => (cleanText(value) ? moveIn.toMinor(value, currency) : 0);
const notAnAmount = (value) => '"' + cleanText(value) + '" is not an amount.';
/** one trial-balance line → { row } · { skipped } · null (a blank or total line) */
function trialBalanceRow(cell, currency) {
  const { account, code } = moveIn.accountCode(cell.account, cell.code),
    what = account || code;
  if (!what || TOTAL_ROW.test(account)) return null;
  const debit = minorOrZero(cell.debit, currency),
    credit = minorOrZero(cell.credit, currency);
  if (debit === null || credit === null) return { skipped: { line: cell.line, what, why: notAnAmount(debit === null ? cell.debit : cell.credit) } };
  return {
    row: {
      line: cell.line,
      name: account || code,
      code: code || null,
      group: cleanText(cell.group, 80) || null,
      side: null,
      dr_minor: Math.abs(debit),
      cr_minor: Math.abs(credit),
      amount_minor: Math.abs(debit) - Math.abs(credit)
    }
  };
}
/** one return line (a box and its amount, maybe its tax) → { row } · { skipped } · null (no box named) */
function returnRow(cell, currency) {
  const box = cleanText(cell.box, 120);
  if (!box) return null;
  const amount = minorOrZero(cell.amount, currency),
    taxMinor = cleanText(cell.tax) ? moveIn.toMinor(cell.tax, currency) : null;
  if (amount === null) return { skipped: { line: cell.line, what: box, why: notAnAmount(cell.amount) } };
  return { row: { line: cell.line, name: box, code: null, group: null, side: null, amount_minor: amount, tax_minor: taxMinor } };
}
/** one P&L or balance-sheet line → { row } · { skipped } · null. A line with no amount is a HEADING: it sets the section (and side) of the lines below, in `state`. */
function statementRow(part, cell, currency, state) {
  const { account, code } = moveIn.accountCode(cell.account, cell.code),
    what = account || code;
  if (!what) return null;
  if (!cleanText(cell.amount)) {
    state.section = account;
    state.side = sideOfHeading(part, account) || state.side;
    return null;
  }
  if (TOTAL_ROW.test(account)) return null;
  const amount = moveIn.toMinor(cell.amount, currency);
  if (amount === null) return { skipped: { line: cell.line, what, why: notAnAmount(cell.amount) } };
  return { row: { line: cell.line, name: account || code, code: code || null, group: state.section, side: state.side, amount_minor: amount } };
}
/** their table lines → { rows (in minor units), skipped: [{ line, what, why }] } — one reader per kind of statement */
function normalise(part, cells, currency) {
  const rows = [],
    skipped = [],
    state = { section: null, side: null };
  for (const cell of cells) {
    const outcome = part === 'tb' ? trialBalanceRow(cell, currency) : part === 'ret' ? returnRow(cell, currency) : statementRow(part, cell, currency, state);
    if (!outcome) continue;
    if (outcome.row) rows.push(outcome.row);
    else skipped.push(outcome.skipped);
  }
  return { rows, skipped };
}

/** a Tally XML export (a Ledger collection, or the Trial Balance / P&L / Balance Sheet report) → rows. Dr is NEGATIVE in Tally's XML. */
function tallyRows(xmlText, part, currency) {
  if (part === 'ret') throw badRequest("Tally's GSTR-3B does not come as XML — export it to Excel and pick that file.");
  const tallyReaders = require('../tools/tally-connector/adapters/tally').readers;
  const data = tallyReaders.dataOf(xmlText),
    rows = [];
  const minorOf = (signed) => moveIn.toMinor(String(Math.abs(signed)), currency);
  const sink = { add: tallyRowAdder(rows, part, minorOf), minorOf, readers: tallyReaders };
  if (/<DSPACCNAME/i.test(data)) tallyReportRows(data, part, sink);
  else tallyLedgerRows(data, part, sink);
  if (!rows.length) throw badRequest('No ledgers with a balance in that Tally file — export the ' + PART_WORD[part] + ' as XML (or to Excel).');
  return rows;
}
/** the row writer of a Tally read: a trial-balance row carries Dr and Cr; a P&L / balance-sheet row carries one signed figure and the side it implies */
function tallyRowAdder(rows, part, minorOf) {
  return (line, name, group, debit, credit, signed) => {
    if (part === 'tb') {
      rows.push({ line, name, code: null, group, side: null, dr_minor: debit, cr_minor: credit, amount_minor: debit - credit });
      return;
    }
    const side = signed < 0 ? (part === 'pl' ? 'expense' : 'assets') : part === 'pl' ? 'income' : 'liabilities';
    rows.push({ line, name, code: null, group, side, amount_minor: minorOf(signed) });
  };
}
/** a Tally REPORT export (DSPACCNAME blocks): the closing Dr / Cr of a trial balance, or the one figure a P&L / balance-sheet line carries */
function tallyReportRows(data, part, sink) {
  const readers = sink.readers;
  data
    .split(/<DSPACCNAME(?:\s[^>]*)?>/i)
    .slice(1)
    .forEach((block, index) => {
      const name = cleanText(readers.unesc(readers.tag('DSPDISPNAME', block)), 150);
      if (!name) return;
      if (part === 'tb') {
        const debitFigure = readers.num(readers.tag('DSPCLDRAMTA', block)),
          creditFigure = readers.num(readers.tag('DSPCLCRAMTA', block));
        sink.add(index + 1, name, null, debitFigure == null ? 0 : sink.minorOf(debitFigure), creditFigure == null ? 0 : sink.minorOf(creditFigure));
        return;
      }
      const figure = ['BSMAINAMT', 'PLSUBAMT', 'BSSUBAMT', 'DSPCLDRAMTA', 'DSPCLCRAMTA']
        .map((tagName) => readers.num(readers.tag(tagName, block)))
        .find((value) => value != null && value !== 0);
      if (figure != null) sink.add(index + 1, name, null, 0, 0, figure);
    });
}
/** one LEDGER block of a Tally collection → { name, balance (Dr negative), group } or null (no name, or no balance) */
function tallyLedgerOf_(block, readers) {
  const attr = /\bNAME="([^"]*)"/i.exec(block[1] || ''),
    name = cleanText(readers.unesc(attr ? attr[1] : readers.tag('NAME', block[2])), 150);
  if (!name) return null;
  const balance = readers.num(readers.tag('CLOSINGBALANCE', block[2])) || 0,
    group = cleanText(readers.unesc(readers.tag('PARENT', block[2])), 80) || null;
  return balance ? { name, balance, group } : null;
}
/** a Tally LEDGER collection (LEDGER · PARENT · CLOSINGBALANCE, Dr negative): every ledger with a balance, under its Tally group */
function tallyLedgerRows(data, part, sink) {
  const ledgerPattern = /<LEDGER(\s[^>]*)?>([\s\S]*?)<\/LEDGER>/gi;
  let block,
    index = 0;
  while ((block = ledgerPattern.exec(data))) {
    index++;
    const ledger = tallyLedgerOf_(block, sink.readers);
    if (!ledger) continue;
    const { name, balance, group } = ledger;
    if (part === 'tb') sink.add(index, name, group, balance < 0 ? sink.minorOf(balance) : 0, balance > 0 ? sink.minorOf(balance) : 0);
    else sink.add(index, name, group, 0, 0, balance);
  }
}

/* ═══ the map: their line → our ledger(s) — IM1's chart index, our group accounts by name, and Tally's group on every ledger ═══ */
const PROFIT_NAMES = [
  'profit & loss a/c',
  'profit and loss a/c',
  'current year earnings',
  'current earnings',
  'net profit',
  'net loss',
  'profit for the year',
  'profit to date'
];
/** list.push(value) on the list kept under `key`, started when there is none */
function addToList(lists, key, value) {
  const list = lists.get(key) || [];
  list.push(value);
  lists.set(key, list);
}
/** move-in's chart index, widened with what the compare needs: group ledgers by name, children by parent, ledger codes by Tally group, `under` (a group's leaf codes) */
function mapIndex(chart) {
  const index = moveIn.chartIndex({ chart, pack: {} });
  const groupByName = new Map(),
    kids = new Map(),
    byTally = new Map();
  chart.forEach((item) => {
    if (item.is_group) groupByName.set(lowerText(item.name), item);
    if (item.parent_id) addToList(kids, String(item.parent_id), item);
    if (!item.is_group && item.tally_group) addToList(byTally, lowerText(item.tally_group), String(item.code));
  });
  const under = (group) => (kids.get(String(group.account_id)) || []).reduce((out, item) => out.concat(item.is_group ? under(item) : [String(item.code)]), []);
  const byCode = new Map(chart.map((item) => [String(item.code), item]));
  return Object.assign(index, { groupByName, byTally, under, byCode });
}
/** the ledger (or group) a name is known as: by their code, by name, or by the role move-in gives that name */
function ledgerForName_(index, lowered, viaCode) {
  const roleLedger = moveIn.NAME_ROLES[lowered] ? index.byRole.get(moveIn.NAME_ROLES[lowered]) : null;
  return viaCode || index.byName.get(lowered) || roleLedger;
}
/** → { codes, name, how } or null (a mapping gap) */
function matchOf(theirRow, index) {
  const lowered = lowerText(theirRow.name),
    viaCode = theirRow.code ? index.bySource.get(upperText(theirRow.code)) : null;
  const ledger = ledgerForName_(index, lowered, viaCode);
  if (ledger && !ledger.is_group) return { codes: [String(ledger.code)], name: ledger.name, how: viaCode ? 'code' : 'name' };
  if (PROFIT_NAMES.indexOf(lowered) >= 0) return { codes: ['profit_to_date'], name: 'Net profit', how: 'name' };
  const group = ledger && ledger.is_group ? ledger : index.groupByName.get(lowered);
  if (group) return { codes: index.under(group), name: group.name, how: 'group' };
  const codes = index.byTally.get(lowered);
  if (codes) return { codes, name: theirRow.name, how: 'tally_group' };
  return null;
}

/* ═══ OUR figures, as the engines answered them, keyed by ledger code (statement sign: Dr + for a trial balance; as printed for P&L and balance sheet) ═══ */
function oursOf(part, engineAnswer, chart) {
  const lookup = new Map(),
    nature = new Map(chart.map((item) => [String(item.code), item.nature]));
  if (!engineAnswer) return lookup;
  if (part === 'tb')
    (engineAnswer.rows || []).forEach((item) =>
      lookup.set(String(item.code), { code: String(item.code), name: item.name, amount_minor: Number(item.debit_minor || 0) - Number(item.credit_minor || 0) })
    );
  /* one side of a statement (income, expenses, assets, liabilities): each account added into the lookup by ledger code, summed where a code repeats */
  const lines = (list, side) =>
    (list || []).forEach((item) =>
      (item.accounts || []).forEach((entry) => {
        const code = entry.role === 'profit_to_date' || entry.code == null ? 'profit_to_date' : String(entry.code);
        const x = lookup.get(code) || {
          code,
          name: code === 'profit_to_date' ? 'Net profit' : entry.name,
          amount_minor: 0,
          side,
          nature: nature.get(code) || null
        };
        x.amount_minor += Number(entry.amount_minor || 0);
        lookup.set(code, x);
      })
    );
  if (part === 'pl') {
    lines(engineAnswer.income, 'income');
    lines(engineAnswer.expenses, 'expense');
  }
  if (part === 'bs') {
    lines(engineAnswer.assets, 'assets');
    lines(engineAnswer.liabilities, 'liabilities');
  }
  return lookup;
}

/** a date or timestamp as its YYYY-MM-DD day */
const dayOf_ = (value) => String(value instanceof Date ? value.toISOString() : value || '').slice(0, 10);
/** a ledger line that came on the rail: its entry has a source chit, or covers one */
const onRail_ = (item) => !!(item.source_chit_id || Number(item.covers) > 0);
/** the entries in the period, per ledger code: { entry_id, entry_no, date, net (Dr − Cr on that ledger), chit_id, ref, kind, rail } */
function entriesIndex(lines, from, to) {
  const by = new Map();
  (lines || []).forEach((item) => {
    const postedDay = dayOf_(item.posting_date);
    if ((from && postedDay < from) || (to && postedDay > to)) return;
    const code = String(item.code),
      entriesById = by.get(code) || new Map();
    const e = entriesById.get(item.entry_id) || entryOf_(item, postedDay);
    e.net += Number(item.dr_minor || 0) - Number(item.cr_minor || 0);
    entriesById.set(item.entry_id, e);
    by.set(code, entriesById);
  });
  return by;
}
/** the entries behind a set of our ledgers, in the statement's sign (a credit-natured ledger counts Cr − Dr in P&L and balance sheet) */
function entriesFor(codes, entriesByCode, index, part) {
  const all = new Map();
  codes.forEach((item) => {
    const ledger = index.byCode.get(item),
      flip = part !== 'tb' && ledger && ['income', 'liability', 'equity'].indexOf(ledger.nature) >= 0;
    (entriesByCode.get(item) || new Map()).forEach((e) => {
      const x = all.get(e.entry_id) || Object.assign({}, e, { amount_minor: 0 });
      x.amount_minor += flip ? -e.net : e.net;
      all.set(e.entry_id, x);
    });
  });
  return Array.from(all.values())
    .filter((e) => e.amount_minor !== 0)
    .sort((first, second) => second.date.localeCompare(first.date));
}

/* ═══ WHY two figures differ — said only where we can tell; otherwise the entries are opened ═══
   `side` −1 = a CREDIT-balance line of the trial balance (Dr-signed: Sales −1,000): "more" means a bigger balance on ITS side, so the
   difference and every entry are read with the sign turned. Without it theirs Sales ₹1,000 Cr vs ours ₹90 Cr said "Ours is ₹910 more"
   (local walk, 14 Oct). P&L and balance sheet lines are already in the statement's sign (entriesFor flips credit ledgers). */
function explain(diff, entries, currency, side) {
  const sign = side === -1 ? -1 : 1;
  diff = diff * sign;
  const signedAmount = (e) => e.amount_minor * sign;
  const unit = roundingUnit_(currency),
    words = (minor) => moveIn.moneyWords(Math.abs(minor), currency);
  const name = (e) => (e.rail && e.ref ? 'bill ' + e.ref : 'entry ' + e.entry_no) + ' of ' + e.date;
  if (Math.abs(diff) < unit) return { cause: 'rounding', why: 'Under ' + words(unit) + ' apart — a rounding rule, not a missing entry.', hit: [] };
  const wrong = oursWrong_(entries, diff, signedAmount, words, name);
  if (wrong) return wrong;
  return missingEntryAnswer_(entries, diff, signedAmount, words, name) || unmatchedAnswer_(diff, entries.length, words);
}
/** the smallest amount that is a real difference: one unit of the currency's smallest displayed digit (a rounding rule below it) */
const roundingUnit_ = (currency) => Math.pow(10, money.decimals ? money.decimals(currency) : 2);
/** the one entry (or the pair among the latest thirty) whose amount IS the difference → the explain answer: not in theirs, or on the rail and not yet keyed by them; else null */
function missingEntryAnswer_(entries, diff, signedAmount, words, name) {
  const single = entries.find((e) => signedAmount(e) === diff);
  if (single) {
    const reason = single.rail
      ? 'Our ' + name(single) + ' (' + words(diff) + ') came on the rail; theirs does not have it yet — keyed later, or not at all.'
      : 'Our ' + name(single) + ' (' + words(diff) + ') is not in theirs.';
    return { cause: single.rail ? 'rail_later' : 'only_ours_entry', why: reason, hit: [single] };
  }
  const firstThirty = entries.slice(0, 30);
  for (let index = 0; index < firstThirty.length; index++)
    for (let j = index + 1; j < firstThirty.length; j++) {
      if (signedAmount(firstThirty[index]) + signedAmount(firstThirty[j]) !== diff) continue;
      const rail = firstThirty[index].rail && firstThirty[j].rail;
      return {
        cause: rail ? 'rail_later' : 'only_ours_entry',
        why: 'Our ' + name(firstThirty[index]) + ' and ' + name(firstThirty[j]) + ' (' + words(diff) + ') are not in theirs' + (rail ? ' — both came on the rail.' : '.'),
        hit: [firstThirty[index], firstThirty[j]]
      };
    }
  return null;
}
/** no entry of ours matches the difference: theirs is more (look for it in our books, then ask them) or ours is more (open our entries) */
function unmatchedAnswer_(diff, entriesCount, words) {
  if (diff < 0) return { cause: 'only_theirs', why: 'Theirs is ' + words(diff) + ' more. Nothing of ours explains it: look for it in our books first, then ask them for the entry.', hit: [] };
  return { cause: 'unexplained', why: 'Ours is ' + words(diff) + ' more — open our ' + entriesCount + ' entries to find it.', hit: [] };
}
/** the entries to show under a difference: the ones that explain it first, then the rest, at most MAX_ENTRIES */
const shown = (list, hits) =>
  hits
    .concat(list.filter((e) => hits.indexOf(e) < 0))
    .slice(0, MAX_ENTRIES)
    .map((e) => ({
      entry_id: e.entry_id,
      entry_no: e.entry_no,
      date: e.date,
      amount_minor: e.amount_minor,
      chit_id: e.chit_id,
      ref: e.ref,
      kind: e.kind,
      rail: e.rail
    }));
const RANK = { different: 0, gap: 1, only_ours: 2, equal: 3 };
/* ── ACC-232 · a correct month compares equal: their ONE line may be several of our ledgers; their return is for THEIR period ─────────────────── */
const moneyOf_ = (minor, part, currency) => moveIn.moneyWords(Math.abs(minor), currency) + (part === 'tb' ? (minor < 0 ? ' Cr' : ' Dr') : minor < 0 ? ' less' : '');
/** "4000 Sales A$600.00 Cr and 4090 Sales returns A$100.00 Dr": the parts a pooled row is made of, so a pool can never hide offsetting errors */
function partsWords_(codes, ours, index, part, currency) {
  return codes
    .map((code) => code + ' ' + ((index.byCode.get(code) || {}).name || code) + ' ' + moneyOf_(((ours.get(code) || {}).amount_minor) || 0, part, currency))
    .join(' and ');
}
/** their lines that match a ledger of ours which has a returns ledger beside it (sales + sales_returns, derived from the chart's own roles, no names) when their
 *  file has no line for the returns ledger itself → { fold: base code → [returns codes], taken: every code one of their lines matched } */
function foldedReturns_(snapshotPart, index) {
  const source = snapshotPart.source,
    matched = (snapshotPart.rows || []).map((theirRow) => matchOf(theirRow, index)),
    taken = new Set(),
    fold = new Map();
  matched.forEach((found) => found && found.codes.forEach((code) => taken.add(code)));
  /* Xero and QuickBooks book a credit note against the Sales account itself; Tally keeps a separate returns ledger, so nothing is folded there */
  if (source === 'tally') return { fold, taken };
  matched.forEach((found) => {
    const base = found && found.codes.length === 1 ? index.byCode.get(found.codes[0]) : null;
    const contra = base && base.role ? index.byRole.get(base.role + '_returns') : null;
    if (contra && !taken.has(String(contra.code))) fold.set(String(base.code), [String(contra.code)]);
  });
  return { fold, taken };
}
/** the other tax-account ledgers of ours (role gst_*) when their file has one GST account and no line for them */
function taxSiblings_(code, index, taken) {
  const mine = index.byCode.get(code);
  if (!mine || !/^gst_/.test(String(mine.role || ''))) return [];
  return Array.from(index.byCode.values())
    .filter((ledger) => !ledger.is_group && /^gst_/.test(String(ledger.role || '')) && String(ledger.code) !== code && !taken.has(String(ledger.code)))
    .map((ledger) => String(ledger.code));
}
/** the match for one of their lines, widened: our returns ledger folded in (the caller sums the amounts), or the sentence for their one GST account being our two */
function foldMatch_(found, context, ours, part, currency) {
  if (!found || found.codes.length !== 1) return found;
  const code = found.codes[0],
    extra = context.folded.fold.get(code) || [],
    siblings = taxSiblings_(code, context.index, context.folded.taken);
  if (!extra.length && !siblings.length) return found;
  if (extra.length) {
    const parts = 'Their line is our ' + partsWords_([code].concat(extra), ours, context.index, part, currency) + ' together.';
    return Object.assign({}, found, { codes: [code].concat(extra), how: 'fold', parts });
  }
  const all = [code].concat(siblings);
  return Object.assign({}, found, { parts: 'Their one GST account is our ' + all.length + ' (' + partsWords_(all, ours, context.index, part, currency) + '): compare their figure with them added.' });
}
/** the sentence of a difference, with the parts of a pooled row in front of it */
const withParts_ = (answer, found) => (found.parts ? Object.assign({}, answer, { why: found.parts + (answer.why ? ' ' + answer.why : '') }) : answer);
/** what a line says when no difference needs explaining: a pooled row names its parts; a plain name or code match says nothing; a group says how many ledgers */
function matchWords_(found, theirName) {
  if (found.how === 'code' || found.how === 'name' || found.how === 'fold') return found.parts || null;
  return 'Their ' + (found.how === 'pool' ? theirName : '"' + theirName + '"') + ' is ' + (found.codes.length === 1 ? 'one ledger' : found.codes.length + ' ledgers') + ' here.';
}
/** why a ledger of ours shows "only ours": the half of their one GST account is said as that, not as a missing entry */
function onlyOursWhy_(list, rail, code, index, taken) {
  const mine = index.byCode.get(code),
    twin = Array.from(taken).find((other) => taxSiblings_(other, index, new Set()).includes(code));
  if (mine && twin && /^gst_/.test(String(mine.role || '')))
    return 'Their file has one GST account (matched to ' + twin + '); this is the other half. Compare their figure with the two ledgers added.';
  if (!list.length) return 'Only in ours — the balance came in before this period.';
  const unit = rail ? ['bill', 'bills'] : ['entry', 'entries'];
  return 'Only in ours: ' + list.length + ' ' + unit[list.length === 1 ? 0 : 1] + (rail ? ' that came on the rail; their file has no such line.' : ' their file has no line for.');
}
/** the sentence of a return whose period is not ours: both periods, and what to do */
function periodMismatchWhy_(snapshotPart, ours, from) {
  const theirs = 'Their return covers ' + (from || '?') + ' to ' + dayOf_(snapshotPart.period_to),
    ourPeriod = ours.label || ours.period || 'a period';
  return theirs + '; ours is ' + ourPeriod + ' (' + dayOf_(ours.start) + ' to ' + dayOf_(ours.end) + '). Nothing was compared: load their return for the same period as ours.';
}
/** their return is for THEIR period: when it is not the period of ours, say so and compare nothing (a false box difference is worse than none) → [one gap line] or null */
function returnPeriodGuard_(snapshotPart, ourReturn) {
  const ours = ourReturn && ourReturn.period;
  if (!ours || !snapshotPart.period_to) return null;
  const from = snapshotPart.period_from ? dayOf_(snapshotPart.period_from) : null;
  if (dayOf_(snapshotPart.period_to) === dayOf_(ours.end) && (!from || from === dayOf_(ours.start))) return null;
  return [
    {
      key: snapshotPart.part + ':period',
      their_line: null,
      their_name: 'Period',
      their_code: null,
      status: 'gap',
      name: 'Return period',
      our_codes: [],
      ours_minor: null,
      theirs_minor: null,
      diff_minor: null,
      cause: 'period',
      why: periodMismatchWhy_(snapshotPart, ours, from),
      entries: [],
      entries_n: 0,
      open: null
    }
  ];
}
/** the note on the return part: our own note, and a line when their file names no start date (it is read as ours) */
function returnNote_(snapshotPart, ourReturn) {
  const open = !snapshotPart.period_from && ourReturn && ourReturn.period ? 'Their file names no start date: it is read as ours (' + dayOf_(ourReturn.period.start) + ' to ' + dayOf_(ourReturn.period.end) + ').' : null;
  return [ourReturn && ourReturn.note, open].filter(Boolean).join(' ') || null;
}
/** the entry of ours behind a ledger line, with the chit's status and whether it was reversed (ACC-232: explain reads them) */
function entryOf_(item, date) {
  return {
    entry_id: item.entry_id,
    entry_no: item.entry_no,
    date,
    net: 0,
    chit_id: item.src_chit_id || null,
    ref: item.src_ref || null,
    kind: item.event_type || null,
    rail: onRail_(item),
    status: item.src_status || null,
    reversed: !!item.reversed_by_id
  };
}
/** the chit statuses on which the books must NOT still count a sale: the one status writer's word for a bill that was called off */
const CALLED_OFF = ['cancelled'];
/** an entry of ours that is still counted although its bill was cancelled and nothing reversed it: OUR error, never theirs (ACC-232) */
const stillCounted = (entry) => CALLED_OFF.includes(String(entry.status || '').toLowerCase()) && !entry.reversed;
/** the entry (or pair) that makes the difference, when it is one of OURS that is wrong → the explain answer, said as ours to reverse, or null */
function oursWrong_(entries, diff, amount, words, name) {
  const single = entries.find((entry) => amount(entry) === diff);
  const firstThirty = entries.slice(0, 30);
  const pair = single ? null : firstThirty.find((first, index) => firstThirty.slice(index + 1).some((second) => amount(first) + amount(second) === diff));
  const hits = single ? [single] : pair ? [pair, firstThirty.slice(firstThirty.indexOf(pair) + 1).find((second) => amount(pair) + amount(second) === diff)] : [];
  const wrong = hits.filter(stillCounted);
  if (!wrong.length) return null;
  const total = wrong.reduce((sum, entry) => sum + Math.abs(entry.amount_minor), 0);
  return {
    cause: 'ours_wrong',
    why: 'Our ' + wrong.map(name).join(' and ') + ' (' + words(total) + ') is on a bill that was cancelled, but the books still count it. That is ours to reverse, not theirs to add.',
    hit: wrong
  };
}

/** where a line's entries open on the screen: a single numbered ledger over the period (a group or a pool opens nothing) → { code, from, to } or null */
const openEntries_ = (codes, win) => (codes.length === 1 && /^\d/.test(codes[0]) ? { code: codes[0], from: win.from, to: win.to } : null);
const statementOrder_ = (first, second) =>
  RANK[first.status] - RANK[second.status] || Math.abs(second.diff_minor || 0) - Math.abs(first.diff_minor || 0) || String(first.name).localeCompare(String(second.name));
/** the line of one of their rows that matched ledger(s) of ours: both figures, the difference, and WHY where we can tell. Claims the ledgers, so "only ours" skips them. */
function matchedLine_(context, key, theirRow, found) {
  const { part, ours, index, entriesByCode, currency } = context;
  found.codes.forEach((code) => context.claimed.add(code));
  const ourMinor = found.codes.reduce((total, code) => total + ((ours.get(code) || {}).amount_minor || 0), 0),
    diff = ourMinor - theirRow.amount_minor;
  const side = part === 'tb' && (theirRow.amount_minor < 0 || (!theirRow.amount_minor && ourMinor < 0)) ? -1 : 1; /* a credit-balance TB line */
  const entries = entriesFor(found.codes, entriesByCode, index, part),
    answer = diff ? withParts_(explain(diff, entries, currency, side), found) : { cause: null, why: matchWords_(found, theirRow.name), hit: [] };
  return {
    key,
    their_line: theirRow.line,
    their_name: theirRow.name,
    their_code: theirRow.code || null,
    theirs_minor: theirRow.amount_minor,
    status: diff ? 'different' : 'equal',
    name: found.name,
    our_codes: found.codes,
    ours_minor: ourMinor,
    diff_minor: diff,
    cause: answer.cause,
    why: answer.why,
    entries: shown(entries, answer.hit),
    entries_n: entries.length,
    open: openEntries_(found.codes, context.win)
  };
}
/** the line of a row of theirs that no ledger of ours matches, by name, code or group: a mapping gap, said with what to do */
function mappingGapLine_(part, theirRow) {
  return {
    key: part + ':' + theirRow.line,
    their_line: theirRow.line,
    their_name: theirRow.name,
    their_code: theirRow.code || null,
    theirs_minor: theirRow.amount_minor,
    status: 'gap',
    name: theirRow.name,
    our_codes: [],
    ours_minor: null,
    diff_minor: null,
    cause: 'mapping',
    why:
      'No ledger here matches "' +
      theirRow.name +
      '"' +
      (theirRow.code ? ' or their code ' + theirRow.code : '') +
      (theirRow.group ? ' (under ' + theirRow.group + ')' : '') +
      ' — move their chart in, or name a ledger the same.',
    entries: [],
    entries_n: 0,
    open: null
  };
}
/** the line of a ledger of ours with a balance that none of their rows claimed: "only ours", with its entries */
function onlyOursLine_(context, item, code) {
  const entries = entriesFor([code], context.entriesByCode, context.index, context.part),
    rail = entries.length && entries.every((e) => e.rail);
  return {
    key: context.part + ':ours:' + code,
    their_line: null,
    their_name: null,
    their_code: null,
    theirs_minor: null,
    status: 'only_ours',
    name: item.name,
    our_codes: [code],
    ours_minor: item.amount_minor,
    diff_minor: item.amount_minor,
    cause: rail ? 'rail_later' : 'only_ours_entry',
    why: onlyOursWhy_(entries, rail, code, context.index, context.folded.taken),
    entries: shown(entries, []),
    entries_n: entries.length,
    open: openEntries_([code], context.win)
  };
}
/** a pool of their rows (parties under one Tally group) as one row against the whole group of ours */
function poolLine_(context, pool) {
  const count = pool.rows.length,
    sum = pool.rows.reduce((total, item) => total + item.amount_minor, 0),
    first = pool.rows[0];
  const pooledRow = { line: first.line, name: first.group + (count > 1 ? ' (' + count + ' ledgers)' : ' (' + first.name + ')'), code: null, amount_minor: sum };
  return matchedLine_(context, context.part + ':pool:' + pool.group.codes.join(','), pooledRow, Object.assign({}, pool.group, { how: 'pool' }));
}
/** one statement (tb · pl · bs) — their rows beside ours, through the map. A ledger of theirs whose NAME has no match here but whose GROUP does (Tally lists every
 *  party under Sundry Debtors; ours keeps them on one control ledger) is pooled into one line per group — never compared alone against the whole group. */
function compareStatement(snapshotPart, ours, index, entriesByCode, currency, win) {
  const part = snapshotPart.part,
    context = { part, ours, index, entriesByCode, currency, win, claimed: new Set(), folded: foldedReturns_(snapshotPart, index) },
    lines = [],
    pools = new Map();
  for (const theirRow of snapshotPart.rows || []) {
    const found = foldMatch_(matchOf(theirRow, index), { folded: context.folded, index }, ours, part, currency);
    if (found) {
      lines.push(matchedLine_(context, part + ':' + theirRow.line, theirRow, found));
      continue;
    }
    const groupFound = theirRow.group ? matchOf({ name: theirRow.group }, index) : null;
    if (groupFound && (groupFound.how === 'group' || groupFound.how === 'tally_group')) {
      const poolKey = groupFound.codes.join(','),
        pool = pools.get(poolKey) || { group: groupFound, rows: [] };
      pool.rows.push(theirRow);
      pools.set(poolKey, pool);
      continue;
    }
    lines.push(mappingGapLine_(part, theirRow));
  }
  pools.forEach((pool) => lines.push(poolLine_(context, pool)));
  ours.forEach((item, code) => {
    if (!context.claimed.has(code) && item.amount_minor) lines.push(onlyOursLine_(context, item, code));
  });
  return lines.sort(statementOrder_);
}
/** the side (income · expense · assets · liabilities) of one of their rows: by the nature of the ledger of ours it maps to, else as their file said */
function sideOfTheirRow_(snapshotPart, index, theirRow) {
  const found = matchOf(theirRow, index);
  const ledger = found && found.codes.length && index.byCode.get(found.codes[0]);
  const nature = ledger && ledger.nature;
  if (snapshotPart.part === 'pl') return nature === 'income' ? 'income' : nature === 'expense' ? 'expense' : theirRow.side;
  return nature === 'asset' ? 'assets' : nature ? 'liabilities' : theirRow.side;
}
/** the one total of a statement, as both sides add it up → { label, ours (the engine's), theirs (summed from their lines) } */
function statementTotals_(snapshotPart, engineAnswer, index) {
  const rows = snapshotPart.rows || [],
    sideOf = (theirRow) => sideOfTheirRow_(snapshotPart, index, theirRow);
  if (snapshotPart.part === 'tb') {
    return { label: 'Total debits', ours: Number(engineAnswer.total_dr_minor || 0), theirs: rows.reduce((total, item) => total + (item.dr_minor || 0), 0) };
  }
  if (snapshotPart.part === 'pl') {
    const profit = (total, item) => total + (sideOf(item) === 'income' ? item.amount_minor : sideOf(item) === 'expense' ? -item.amount_minor : 0);
    return { label: 'Net profit', ours: Number(engineAnswer.profit_minor || 0), theirs: rows.reduce(profit, 0) };
  }
  return {
    label: 'Total assets',
    ours: Number(engineAnswer.total_assets_minor || 0),
    theirs: rows.reduce((total, item) => total + (sideOf(item) === 'assets' ? item.amount_minor : 0), 0)
  };
}
/** the statement's one total, first: total debits (TB) · net profit (P&L) · total assets (BS) — ours as the engine answered, theirs added up from their lines */
function totalOf(snapshotPart, engineAnswer, index, currency) {
  const { label, ours, theirs } = statementTotals_(snapshotPart, engineAnswer, index);
  const diff = ours - theirs;
  return {
    key: snapshotPart.part + ':total',
    total: true,
    their_line: null,
    their_name: label,
    their_code: null,
    status: diff ? 'different' : 'equal',
    name: label,
    our_codes: [],
    ours_minor: ours,
    theirs_minor: theirs,
    diff_minor: diff,
    cause: diff ? 'total' : null,
    why: diff ? 'The totals are ' + moveIn.moneyWords(Math.abs(diff), currency) + ' apart — the lines below say where.' : null,
    entries: [],
    entries_n: 0,
    open: null
  };
}

/** the box of ours a line of theirs names: by its code, its label, or the code as a prefix (G1 matches "G1 Total sales"; 1A does not match "1A2") — longest codes first */
function returnBoxFinder_(boxes) {
  return (name) => {
    const text = squash(name);
    return (
      boxes.find((item) => {
        const boxCode = squash(item.code);
        return text === boxCode || text === squash(item.label) || (text.indexOf(boxCode) === 0 && !/\d/.test(text.charAt(boxCode.length)));
      }) || null
    );
  };
}
/** the status of a return line: no box of ours = gap; no line of theirs = only ours; else equal or different */
const returnStatus_ = (box, theirRow, diff) => (!box ? 'gap' : !theirRow ? 'only_ours' : diff ? 'different' : 'equal');
/** why two return figures differ: a rounding rule below one unit of the currency, else a box difference */
function returnCause_(box, diff, currency) {
  if (!box) return 'mapping';
  if (!diff) return null;
  return Math.abs(diff) < roundingUnit_(currency) ? 'rounding' : 'box';
}
/** the sentence of a return line: the missing box, only-ours, a rounding rule, or how far ours is off and which ledgers the box counts */
function returnWhy_(context, theirRow, box, diff) {
  if (!box) return 'No box of ours is called "' + theirRow.name + '" — name it as the form does (G1, 1A, 3.1(a)…).';
  if (!theirRow) return 'Only in ours.';
  if (!diff) return null;
  if (Math.abs(diff) < roundingUnit_(context.currency)) return 'A rounding rule, not a missing entry.';
  const ledgers = (box.accounts || [])
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  return (
    'Ours is ' +
    moveIn.moneyWords(Math.abs(diff), context.currency) +
    (diff > 0 ? ' more' : ' less') +
    (ledgers ? ' — it counts ' + ledgers + '.' : '.') +
    (context.ours.note ? ' ' + context.ours.note : '')
  );
}
/** one line of the return comparison: their line (maybe none) beside a box of ours (maybe none) */
function returnLine_(context, key, theirRow, box, oursMinor, theirsMinor, word) {
  const diff = oursMinor == null || theirsMinor == null ? null : oursMinor - theirsMinor;
  return {
    key,
    their_line: theirRow ? theirRow.line : null,
    their_name: theirRow ? theirRow.name : null,
    their_code: null,
    status: returnStatus_(box, theirRow, diff),
    name: box ? box.code + ' ' + (word || box.label) : theirRow.name,
    our_codes: [],
    ours_minor: oursMinor,
    theirs_minor: theirsMinor,
    diff_minor: !box ? null : diff == null ? oursMinor : diff,
    cause: returnCause_(box, diff, context.currency),
    why: returnWhy_(context, theirRow, box, diff),
    entries: [],
    entries_n: 0,
    open: null
  };
}
/** a box's figure: its amount, else its tax (a box that carries only tax) */
const boxFigure_ = (box) => (box.amount_minor == null ? box.tax_minor : box.amount_minor);
/** whether a box and the line that names it both carry a tax figure beside the amount (compared as a second line) */
const hasTaxFigure_ = (theirRow, box) => !!box && theirRow.tax_minor != null && box.tax_minor != null && box.amount_minor != null;
/** differences first, then by how far apart */
const returnOrder_ = (first, second) => RANK[first.status] - RANK[second.status] || Math.abs(second.diff_minor || 0) - Math.abs(first.diff_minor || 0);
/** the return — box by box. ours: { boxes: [{ code, label, amount_minor, tax_minor, accounts }], note } */
function compareReturn(snapshotPart, ours, currency) {
  const boxes = ((ours && ours.boxes) || []).slice().sort((first, second) => squash(second.code).length - squash(first.code).length);
  const find = returnBoxFinder_(boxes),
    context = { ours, currency },
    part = snapshotPart.part,
    lines = [],
    claimed = new Set();
  for (const theirRow of snapshotPart.rows || []) {
    const box = find(theirRow.name);
    if (box) claimed.add(box.code);
    lines.push(returnLine_(context, part + ':' + theirRow.line, theirRow, box, box ? boxFigure_(box) : null, theirRow.amount_minor));
    if (hasTaxFigure_(theirRow, box)) {
      lines.push(returnLine_(context, part + ':' + theirRow.line + ':tax', theirRow, box, box.tax_minor, theirRow.tax_minor, 'tax'));
    }
  }
  boxes.forEach((item) => {
    const figure = boxFigure_(item);
    if (!claimed.has(item.code) && figure) lines.push(returnLine_(context, part + ':ours:' + item.code, null, item, figure, null));
  });
  return lines.sort(returnOrder_);
}

/** India: the rail's GSTR-3B (lib/tax-lines gstr3b, rupees) as boxes, in minor units — the form's own tables, so a box reads as the portal names it */
function gstr3bBoxes(gstr3b) {
  if (gstr3b && gstr3b.ok === false) throw new Error('ACC-278: ' + gstr3b.why); /* a refused return (no GSTIN) is not zero boxes: the caller's catch says our GSTR-3B could not be read */
  const outward = (gstr3b && gstr3b.sup_details && gstr3b.sup_details.osup_det) || {},
    inputTaxCredit = (gstr3b && gstr3b.itc_elg && gstr3b.itc_elg.itc_net) || {},
    minor = (value) => moveIn.toMinor(String(value == null ? 0 : value), 'INR');
  return {
    boxes: [
      { code: '3.1(a)', label: 'Outward taxable value', amount_minor: minor(outward.txval) },
      { code: '3.1(a) IGST', label: 'Integrated tax', amount_minor: minor(outward.iamt) },
      { code: '3.1(a) CGST', label: 'Central tax', amount_minor: minor(outward.camt) },
      { code: '3.1(a) SGST', label: 'State tax', amount_minor: minor(outward.samt) },
      { code: '3.1(a) Cess', label: 'Cess', amount_minor: minor(outward.csamt) },
      { code: '4(C) IGST', label: 'Net ITC integrated', amount_minor: minor(inputTaxCredit.iamt) },
      { code: '4(C) CGST', label: 'Net ITC central', amount_minor: minor(inputTaxCredit.camt) },
      { code: '4(C) SGST', label: 'Net ITC state', amount_minor: minor(inputTaxCredit.samt) },
      { code: '4(C) Cess', label: 'Net ITC cess', amount_minor: minor(inputTaxCredit.csamt) }
    ].map((item) => Object.assign({ tax_minor: null, accounts: [] }, item)),
    note: 'Ours is read from the frozen invoices on the rail; a purchase off the rail is not in it.'
  };
}

/** PR2's hook: the period's entries by how they arrived — structured (a chit on the rail, or a counter's day) vs keyed (typed here: journals, openings, payments) */
function effortOf(lines, from, to) {
  const seen = new Map();
  (lines || []).forEach((item) => {
    const postedDay = dayOf_(item.posting_date);
    if ((from && postedDay < from) || (to && postedDay > to) || seen.has(item.entry_id)) return;
    seen.set(item.entry_id, { kind: item.event_type || 'other', structured: onRail_(item) });
  });
  const by_kind = {};
  let structured = 0;
  seen.forEach((e) => {
    by_kind[e.kind] = (by_kind[e.kind] || 0) + 1;
    if (e.structured) structured++;
  });
  return { from, to, entries: seen.size, structured, keyed: seen.size - structured, by_kind };
}

const emptyCounts_ = () => ({ equal: 0, different: 0, gap: 0, only_ours: 0 });
/** the words for a part we could not compare: our engine's own refusal, "could not be read", or "not built yet" */
function unreadablePartWhy_(part, engineAnswer) {
  if (!(engineAnswer instanceof Error)) return 'Ours is not built for this part yet.';
  return engineAnswer.refused || engineAnswer.code ? engineAnswer.message : 'Our ' + PART_WORD[part].toLowerCase() + ' could not be read.';
}
/** the lines of one part counted by status (the total line is not a difference), and added into the whole compare's `counts` */
function countLines_(lines, counts) {
  const partCounts = emptyCounts_();
  lines
    .filter((item) => !item.total)
    .forEach((item) => {
      partCounts[item.status]++;
      counts[item.status]++;
    });
  return partCounts;
}
/** the heading every part of the compare carries, whether or not ours could be read */
const partHead_ = (snapshotPart) => ({
  part: snapshotPart.part,
  title: PART_WORD[snapshotPart.part],
  from: snapshotPart.period_from || null,
  to: snapshotPart.period_to,
  file_name: snapshotPart.file_name || null,
  source: snapshotPart.source
});
/** the lines of a readable part: the return box by box, or a statement's total first and then its lines */
function partLines_(input, snapshotPart, engineAnswer, index, entriesByCode) {
  const part = snapshotPart.part,
    currency = input.currency;
  if (part === 'ret') return returnPeriodGuard_(snapshotPart, engineAnswer) || compareReturn(snapshotPart, engineAnswer, currency);
  const ours = oursOf(part, engineAnswer, input.chart || []),
    window = { from: input.from, to: input.to };
  return [totalOf(snapshotPart, engineAnswer, index, currency)].concat(compareStatement(snapshotPart, ours, index, entriesByCode, currency, window));
}
/** one part of the compare: the lines (return, or total + statement), counted into `counts`, under its heading — or the words for a part we could not read */
function comparePart_(input, snapshotPart, index, entriesByCode, counts) {
  const part = snapshotPart.part,
    engineAnswer = (input.ours || {})[part],
    head = partHead_(snapshotPart);
  if (!engineAnswer || engineAnswer instanceof Error) return Object.assign(head, { lines: [], counts: null, error: unreadablePartWhy_(part, engineAnswer) });
  const lines = partLines_(input, snapshotPart, engineAnswer, index, entriesByCode);
  return Object.assign(head, {
    lines,
    counts: countLines_(lines, counts),
    error: null,
    note: part === 'ret' ? returnNote_(snapshotPart, engineAnswer) : null,
    form: part === 'ret' ? engineAnswer.short || engineAnswer.form || null : null
  });
}
/**
 * THE COMPARE — pure. in: { parts: [the snapshot's rows as kept], chart, ours: { tb, pl, bs, ret } (the engines' answers; an Error = said in words), lines (entryLines of the
 * period), currency, from, to } → { parts: { tb|pl|bs|ret: { part, title, as_at, from, to, file_name, lines, counts, error } }, counts, effort }
 */
function compare(input) {
  const index = mapIndex(input.chart || []),
    entriesByCode = entriesIndex(input.lines, input.from, input.to),
    out = {},
    counts = emptyCounts_();
  for (const snapshotPart of input.parts || []) out[snapshotPart.part] = comparePart_(input, snapshotPart, index, entriesByCode, counts);
  return { parts: out, counts, effort: effortOf(input.lines, input.from, input.to) };
}

/** the auditor's file: every line of every part, differences first (as the screen lists them) */
function auditorCsv(result, currency) {
  const decimals = money.decimals ? money.decimals(currency) : 2,
    figure = (value) => (value == null ? '' : (Number(value) / Math.pow(10, decimals)).toFixed(decimals)),
    quoted = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  const out = ['statement,status,line,their line,their code,our ledgers,theirs,ours,difference,why'];
  PARTS.forEach((item) => {
    const statement = result.parts[item];
    if (!statement) return;
    (statement.lines || []).forEach((entry) =>
      out.push(
        [
          statement.title,
          entry.status,
          entry.name,
          entry.their_line,
          entry.their_code,
          (entry.our_codes || []).join(' '),
          figure(entry.theirs_minor),
          figure(entry.ours_minor),
          figure(entry.diff_minor),
          entry.why
        ]
          .map(quoted)
          .join(',')
      )
    );
  });
  return out.join('\n') + '\n';
}

module.exports = {
  PARTS,
  PART_WORD,
  SOURCES,
  SOURCE_WORD,
  KINDS,
  partOf,
  sourceOf,
  preflight,
  read,
  normalise,
  tallyRows,
  mapIndex,
  matchOf,
  oursOf,
  entriesIndex,
  explain,
  compare,
  compareReturn,
  gstr3bBoxes,
  effortOf,
  csv: auditorCsv
};
