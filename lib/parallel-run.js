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
const MI = require('./move-in');
const M = require('./money');

const PARTS = ['tb', 'pl', 'bs', 'ret'];
const PART_WORD = { tb: 'Trial balance', pl: 'Profit and loss', bs: 'Balance sheet', ret: 'Return' };
const SOURCES = ['tally', 'xero', 'qbo'];
const SOURCE_WORD = { tally: 'Tally', xero: 'Xero', qbo: 'QuickBooks' };
const MAX_ENTRIES = 5;   /* the entries shown under one difference (the count says how many there are) */

function refuse(why, code) { const e = new Error(why); e.refused = true; e.code = code || 'BOOKS_REFUSED'; return e; }
function bad(why) { return refuse(why, 'BOOKS_BAD_REQUEST'); }
const low = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
const up = (s) => String(s == null ? '' : s).trim().toUpperCase();
const txt = (v, n) => { const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' '); return n ? s.slice(0, n) : s; };
const squash = (s) => up(s).replace(/[^A-Z0-9]/g, '');

function partOf(p) { const k = low(p); if (PARTS.indexOf(k) < 0) throw bad('Which of their statements is this — tb, pl, bs or ret?'); return k; }
function sourceOf(s) { const k = low(s); if (SOURCES.indexOf(k) < 0) throw bad('Whose figures are these — tally, xero or qbo?'); return k; }

/* ═══ the columns each export carries — the trial balance is move-in's own, widened by the names Tally's Excel export uses ═══ */
const TB = MI.KINDS.trial_balance;
const ACCOUNT = Object.assign({}, TB.fields.find((f) => f.key === 'account'), { syn: TB.fields.find((f) => f.key === 'account').syn.concat(['particulars', 'ledger name', 'line']) });
const CODE = TB.fields.find((f) => f.key === 'code');
const AMOUNT = { key: 'amount', label: 'Amount', req: true, syn: ['amount', 'total', 'balance', 'value', 'net', 'closing balance', 'year to date', 'ytd', 'this period'] };
const KINDS = {
  tb: { label: 'Trial balance', fields: TB.fields.map((f) => (f.key === 'account' ? ACCOUNT : f.key === 'debit' || f.key === 'credit' ? Object.assign({}, f, { syn: f.syn.concat([f.key + ' - year to date', 'ytd ' + f.key, 'closing ' + f.key, f.key + ' balance']) }) : f)).concat([{ key: 'group', label: 'Group', req: false, syn: ['group', 'under', 'parent', 'account type', 'type', 'class'] }]) },
  pl: { label: 'Profit and loss', fields: [ACCOUNT, CODE, AMOUNT] },
  bs: { label: 'Balance sheet', fields: [ACCOUNT, CODE, AMOUNT] },
  ret: { label: 'Return', fields: [
    { key: 'box', label: 'Box', req: true, syn: ['box', 'label', 'field', 'gst code', 'bas label', 'item', 'particulars', 'description', 'name', 'code'] },
    { key: 'amount', label: 'Amount', req: true, syn: ['amount', 'value', 'taxable value', 'figure', 'total'] },
    { key: 'tax', label: 'Tax', req: false, syn: ['tax', 'tax amount', 'gst', 'gst amount', 'vat', 'vat amount'] },
  ] },
};

/* ═══ their file → rows ═══ */
/** POST /compare/preflight: a table file → the columns guessed (move-in's matcher); a Tally XML → read at once (no columns to pick) */
function preflight(body, part, cur) {
  const b = body || {};
  if (typeof b.xml === 'string' && b.xml.trim()) {
    const rows = tallyRows(b.xml, part, cur);
    return { format: 'tally_xml', headers: [], fields: [], guess: [], missing: [], ready: true, rows_total: rows.length, sample: rows.slice(0, 5) };
  }
  const parsed = MI.readFile(b);
  const g = MI.guess(part, parsed.headers, KINDS);
  return Object.assign({ format: 'table', headers: parsed.headers }, g, { rows_total: parsed.rows.length, sample: parsed.rows.slice(0, 5), sheet: parsed.sheet || null, sheets: parsed.sheets || null, header_row: parsed.headerRow || 1 });
}
/** the file, read as confirmed → { rows (their lines in minor units), skipped: [{ line, what, why }] } */
function read(body, part, cur) {
  const b = body || {};
  if (typeof b.xml === 'string' && b.xml.trim()) return { rows: tallyRows(b.xml, part, cur), skipped: [] };
  const cells = MI.cells(part, MI.readFile(b), b.decisions, KINDS);
  return normalise(part, cells, cur);
}

/** which side of a statement a heading row names — Xero's "Less Cost of Sales", QBO's "Total Income", a balance sheet's "Assets" */
function sideOfHeading(part, s) {
  const w = low(s);
  if (part === 'pl') return /expense|cost|less|purchase/.test(w) ? 'expense' : /income|revenue|sales|turnover|trading/.test(w) ? 'income' : null;
  if (part === 'bs') return /liabilit|equity|capital|reserve|loan/.test(w) ? 'liabilities' : /asset|bank|cash|debtor|receivable|stock|inventor/.test(w) ? 'assets' : null;
  return null;
}
const TOTAL_ROW = /^(total|totals|grand total|net profit|net loss|gross profit|gross loss|net assets|net income|profit for|loss for)\b/i;
function normalise(part, cells, cur) {
  const rows = [], skipped = [];
  let section = null, side = null;
  const minor = (v) => (txt(v) ? MI.toMinor(v, cur) : 0);
  for (const r of cells) {
    if (part === 'tb') {
      const { account, code } = MI.accountCode(r.account, r.code), what = account || code;
      if (!what || TOTAL_ROW.test(account)) continue;
      const dr = minor(r.debit), cr = minor(r.credit);
      if (dr === null || cr === null) { skipped.push({ line: r.line, what, why: '"' + txt(dr === null ? r.debit : r.credit) + '" is not an amount.' }); continue; }
      rows.push({ line: r.line, name: account || code, code: code || null, group: txt(r.group, 80) || null, side: null, dr_minor: Math.abs(dr), cr_minor: Math.abs(cr), amount_minor: Math.abs(dr) - Math.abs(cr) });
      continue;
    }
    if (part === 'ret') {
      const box = txt(r.box, 120); if (!box) continue;
      const amt = minor(r.amount), tax = txt(r.tax) ? MI.toMinor(r.tax, cur) : null;
      if (amt === null) { skipped.push({ line: r.line, what: box, why: '"' + txt(r.amount) + '" is not an amount.' }); continue; }
      rows.push({ line: r.line, name: box, code: null, group: null, side: null, amount_minor: amt, tax_minor: tax });
      continue;
    }
    const { account, code } = MI.accountCode(r.account, r.code), what = account || code;
    if (!what) continue;
    if (!txt(r.amount)) { section = account; side = sideOfHeading(part, account) || side; continue; }   /* a heading: the section the lines below sit in */
    if (TOTAL_ROW.test(account)) continue;
    const amt = MI.toMinor(r.amount, cur);
    if (amt === null) { skipped.push({ line: r.line, what, why: '"' + txt(r.amount) + '" is not an amount.' }); continue; }
    rows.push({ line: r.line, name: account || code, code: code || null, group: section, side, amount_minor: amt });
  }
  return { rows, skipped };
}

/** a Tally XML export (a Ledger collection, or the Trial Balance / P&L / Balance Sheet report) → rows. Dr is NEGATIVE in Tally's XML. */
function tallyRows(xml, part, cur) {
  if (part === 'ret') throw bad('Tally\'s GSTR-3B does not come as XML — export it to Excel and pick that file.');
  const R = require('../tools/tally-connector/adapters/tally').readers;
  const data = R.dataOf(xml), rows = [];
  const amt = (v) => MI.toMinor(String(Math.abs(v)), cur);
  const push = (line, name, group, dr, cr, signed) => {
    if (part === 'tb') { rows.push({ line, name, code: null, group, side: null, dr_minor: dr, cr_minor: cr, amount_minor: dr - cr }); return; }
    const s = signed < 0 ? (part === 'pl' ? 'expense' : 'assets') : (part === 'pl' ? 'income' : 'liabilities');
    rows.push({ line, name, code: null, group, side: s, amount_minor: amt(signed) });
  };
  if (/<DSPACCNAME/i.test(data)) {
    data.split(/<DSPACCNAME(?:\s[^>]*)?>/i).slice(1).forEach((c, i) => {
      const name = txt(R.unesc(R.tag('DSPDISPNAME', c)), 150); if (!name) return;
      if (part === 'tb') { const d = R.num(R.tag('DSPCLDRAMTA', c)), k = R.num(R.tag('DSPCLCRAMTA', c)); push(i + 1, name, null, d == null ? 0 : amt(d), k == null ? 0 : amt(k)); return; }
      const v = ['BSMAINAMT', 'PLSUBAMT', 'BSSUBAMT', 'DSPCLDRAMTA', 'DSPCLCRAMTA'].map((t) => R.num(R.tag(t, c))).find((x) => x != null && x !== 0);
      if (v != null) push(i + 1, name, null, 0, 0, v);
    });
  } else {
    const re = /<LEDGER(\s[^>]*)?>([\s\S]*?)<\/LEDGER>/gi; let m, i = 0;
    while ((m = re.exec(data))) {
      i++;
      const attr = /\bNAME="([^"]*)"/i.exec(m[1] || ''), name = txt(R.unesc(attr ? attr[1] : R.tag('NAME', m[2])), 150); if (!name) continue;
      const bal = R.num(R.tag('CLOSINGBALANCE', m[2])) || 0, group = txt(R.unesc(R.tag('PARENT', m[2])), 80) || null;
      if (!bal) continue;
      if (part === 'tb') push(i, name, group, bal < 0 ? amt(bal) : 0, bal > 0 ? amt(bal) : 0); else push(i, name, group, 0, 0, bal);
    }
  }
  if (!rows.length) throw bad('No ledgers with a balance in that Tally file — export the ' + PART_WORD[part] + ' as XML (or to Excel).');
  return rows;
}

/* ═══ the map: their line → our ledger(s) — IM1's chart index, our group accounts by name, and Tally's group on every ledger ═══ */
const PROFIT_NAMES = ['profit & loss a/c', 'profit and loss a/c', 'current year earnings', 'current earnings', 'net profit', 'net loss', 'profit for the year', 'profit to date'];
function mapIndex(chart) {
  const X = MI.chartIndex({ chart, pack: {} });
  const groupByName = new Map(), kids = new Map(), byTally = new Map();
  chart.forEach((a) => {
    if (a.is_group) groupByName.set(low(a.name), a);
    if (a.parent_id) { const k = kids.get(String(a.parent_id)) || []; k.push(a); kids.set(String(a.parent_id), k); }
    if (!a.is_group && a.tally_group) { const t = byTally.get(low(a.tally_group)) || []; t.push(String(a.code)); byTally.set(low(a.tally_group), t); }
  });
  const under = (g) => (kids.get(String(g.account_id)) || []).reduce((out, a) => out.concat(a.is_group ? under(a) : [String(a.code)]), []);
  const byCode = new Map(chart.map((a) => [String(a.code), a]));
  return Object.assign(X, { groupByName, byTally, under, byCode });
}
/** → { codes, name, how } or null (a mapping gap) */
function matchOf(r, X) {
  const nm = low(r.name), viaCode = r.code ? X.bySource.get(up(r.code)) : null;
  const a = viaCode || X.byName.get(nm) || (MI.NAME_ROLES[nm] ? X.byRole.get(MI.NAME_ROLES[nm]) : null);
  if (a && !a.is_group) return { codes: [String(a.code)], name: a.name, how: viaCode ? 'code' : 'name' };
  if (PROFIT_NAMES.indexOf(nm) >= 0) return { codes: ['profit_to_date'], name: 'Net profit', how: 'name' };
  const g = (a && a.is_group) ? a : X.groupByName.get(nm);
  if (g) return { codes: X.under(g), name: g.name, how: 'group' };
  const t = X.byTally.get(nm);
  if (t) return { codes: t, name: r.name, how: 'tally_group' };
  return null;
}

/* ═══ OUR figures, as the engines answered them, keyed by ledger code (statement sign: Dr + for a trial balance; as printed for P&L and balance sheet) ═══ */
function oursOf(part, o, chart) {
  const m = new Map(), nature = new Map(chart.map((a) => [String(a.code), a.nature]));
  if (!o) return m;
  if (part === 'tb') (o.rows || []).forEach((r) => m.set(String(r.code), { code: String(r.code), name: r.name, amount_minor: Number(r.debit_minor || 0) - Number(r.credit_minor || 0) }));
  const lines = (list, side) => (list || []).forEach((L) => (L.accounts || []).forEach((a) => {
    const code = a.role === 'profit_to_date' || a.code == null ? 'profit_to_date' : String(a.code);
    const x = m.get(code) || { code, name: code === 'profit_to_date' ? 'Net profit' : a.name, amount_minor: 0, side, nature: nature.get(code) || null };
    x.amount_minor += Number(a.amount_minor || 0); m.set(code, x);
  }));
  if (part === 'pl') { lines(o.income, 'income'); lines(o.expenses, 'expense'); }
  if (part === 'bs') { lines(o.assets, 'assets'); lines(o.liabilities, 'liabilities'); }
  return m;
}

/** the entries in the period, per ledger code: { entry_id, entry_no, date, net (Dr − Cr on that ledger), chit_id, ref, kind, rail } */
function entriesIndex(lines, from, to) {
  const by = new Map();
  (lines || []).forEach((l) => {
    const d = String(l.posting_date instanceof Date ? l.posting_date.toISOString() : l.posting_date || '').slice(0, 10);
    if ((from && d < from) || (to && d > to)) return;
    const code = String(l.code), m = by.get(code) || new Map();
    const e = m.get(l.entry_id) || { entry_id: l.entry_id, entry_no: l.entry_no, date: d, net: 0, chit_id: l.src_chit_id || null, ref: l.src_ref || null, kind: l.event_type || null,
      rail: !!(l.source_chit_id || Number(l.covers) > 0) };
    e.net += Number(l.dr_minor || 0) - Number(l.cr_minor || 0); m.set(l.entry_id, e); by.set(code, m);
  });
  return by;
}
/** the entries behind a set of our ledgers, in the statement's sign (a credit-natured ledger counts Cr − Dr in P&L and balance sheet) */
function entriesFor(codes, E, X, part) {
  const all = new Map();
  codes.forEach((c) => {
    const a = X.byCode.get(c), flip = part !== 'tb' && a && ['income', 'liability', 'equity'].indexOf(a.nature) >= 0;
    (E.get(c) || new Map()).forEach((e) => { const x = all.get(e.entry_id) || Object.assign({}, e, { amount_minor: 0 }); x.amount_minor += flip ? -e.net : e.net; all.set(e.entry_id, x); });
  });
  return Array.from(all.values()).filter((e) => e.amount_minor !== 0).sort((a, b) => b.date.localeCompare(a.date));
}

/* ═══ WHY two figures differ — said only where we can tell; otherwise the entries are opened ═══
   `side` −1 = a CREDIT-balance line of the trial balance (Dr-signed: Sales −1,000): "more" means a bigger balance on ITS side, so the
   difference and every entry are read with the sign turned. Without it theirs Sales ₹1,000 Cr vs ours ₹90 Cr said "Ours is ₹910 more"
   (local walk, 14 Oct). P&L and balance sheet lines are already in the statement's sign (entriesFor flips credit ledgers). */
function explain(diff, entries, cur, side) {
  const s = side === -1 ? -1 : 1; diff = diff * s;
  const amt = (e) => e.amount_minor * s;
  const d = M.decimals ? M.decimals(cur) : 2, unit = Math.pow(10, d), W = (n) => MI.moneyWords(Math.abs(n), cur);
  const name = (e) => (e.rail && e.ref ? 'bill ' + e.ref : 'entry ' + e.entry_no) + ' of ' + e.date;
  if (Math.abs(diff) < unit) return { cause: 'rounding', why: 'Under ' + W(unit) + ' apart — a rounding rule, not a missing entry.', hit: [] };
  const one = entries.find((e) => amt(e) === diff);
  if (one) return one.rail
    ? { cause: 'rail_later', why: 'Our ' + name(one) + ' (' + W(diff) + ') came on the rail; theirs does not have it yet — keyed later, or not at all.', hit: [one] }
    : { cause: 'only_ours_entry', why: 'Our ' + name(one) + ' (' + W(diff) + ') is not in theirs.', hit: [one] };
  const few = entries.slice(0, 30);
  for (let i = 0; i < few.length; i++) for (let j = i + 1; j < few.length; j++) {
    if (amt(few[i]) + amt(few[j]) !== diff) continue;
    const rail = few[i].rail && few[j].rail;
    return { cause: rail ? 'rail_later' : 'only_ours_entry', why: 'Our ' + name(few[i]) + ' and ' + name(few[j]) + ' (' + W(diff) + ') are not in theirs' + (rail ? ' — both came on the rail.' : '.'), hit: [few[i], few[j]] };
  }
  if (diff < 0) return { cause: 'only_theirs', why: 'Theirs is ' + W(diff) + ' more — an entry only in their books. Ask them for it.', hit: [] };
  return { cause: 'unexplained', why: 'Ours is ' + W(diff) + ' more — open our ' + entries.length + ' entries to find it.', hit: [] };
}
const shown = (list, hit) => hit.concat(list.filter((e) => hit.indexOf(e) < 0)).slice(0, MAX_ENTRIES).map((e) => ({ entry_id: e.entry_id, entry_no: e.entry_no, date: e.date, amount_minor: e.amount_minor, chit_id: e.chit_id, ref: e.ref, kind: e.kind, rail: e.rail }));
const RANK = { different: 0, gap: 1, only_ours: 2, equal: 3 };

/** one statement (tb · pl · bs) — their rows beside ours, through the map. A ledger of theirs whose NAME has no match here but whose GROUP does (Tally lists every
 *  party under Sundry Debtors; ours keeps them on one control ledger) is pooled into one line per group — never compared alone against the whole group. */
function compareStatement(p, ours, X, E, cur, win) {
  const lines = [], claimed = new Set(), pools = new Map();
  const open = (codes) => (codes.length === 1 && /^\d/.test(codes[0]) ? { code: codes[0], from: win.from, to: win.to } : null);
  const lineFor = (key, r, m) => {
    m.codes.forEach((c) => claimed.add(c));
    const ourMinor = m.codes.reduce((t, c) => t + ((ours.get(c) || {}).amount_minor || 0), 0), diff = ourMinor - r.amount_minor;
    const side = p.part === 'tb' && (r.amount_minor < 0 || (!r.amount_minor && ourMinor < 0)) ? -1 : 1;   /* a credit-balance TB line */
    const ent = entriesFor(m.codes, E, X, p.part), x = diff ? explain(diff, ent, cur, side) : { cause: null, why: m.how === 'code' || m.how === 'name' ? null : 'Their ' + (m.how === 'pool' ? r.name : '"' + r.name + '"') + ' is ' + (m.codes.length === 1 ? 'one ledger' : m.codes.length + ' ledgers') + ' here.', hit: [] };
    lines.push({ key, their_line: r.line, their_name: r.name, their_code: r.code || null, theirs_minor: r.amount_minor, status: diff ? 'different' : 'equal', name: m.name, our_codes: m.codes, ours_minor: ourMinor,
      diff_minor: diff, cause: x.cause, why: x.why, entries: shown(ent, x.hit), entries_n: ent.length, open: open(m.codes) });
  };
  for (const r of p.rows || []) {
    const m = matchOf(r, X);
    if (m) { lineFor(p.part + ':' + r.line, r, m); continue; }
    const g = r.group ? matchOf({ name: r.group }, X) : null;
    if (g && (g.how === 'group' || g.how === 'tally_group')) { const k = g.codes.join(','), x = pools.get(k) || { g, rows: [] }; x.rows.push(r); pools.set(k, x); continue; }
    lines.push({ key: p.part + ':' + r.line, their_line: r.line, their_name: r.name, their_code: r.code || null, theirs_minor: r.amount_minor, status: 'gap', name: r.name, our_codes: [], ours_minor: null, diff_minor: null,
      cause: 'mapping', why: 'No ledger here matches "' + r.name + '"' + (r.code ? ' or their code ' + r.code : '') + (r.group ? ' (under ' + r.group + ')' : '') + ' — move their chart in, or name a ledger the same.', entries: [], entries_n: 0, open: null });
  }
  pools.forEach((x) => {
    const n = x.rows.length, sum = x.rows.reduce((t, r) => t + r.amount_minor, 0);
    lineFor(p.part + ':pool:' + x.g.codes.join(','), { line: x.rows[0].line, name: x.rows[0].group + (n > 1 ? ' (' + n + ' ledgers)' : ' (' + x.rows[0].name + ')'), code: null, amount_minor: sum }, Object.assign({}, x.g, { how: 'pool' }));
  });
  ours.forEach((o, code) => {
    if (claimed.has(code) || !o.amount_minor) return;
    const ent = entriesFor([code], E, X, p.part), rail = ent.length && ent.every((e) => e.rail);
    lines.push({ key: p.part + ':ours:' + code, their_line: null, their_name: null, their_code: null, theirs_minor: null, status: 'only_ours', name: o.name, our_codes: [code], ours_minor: o.amount_minor, diff_minor: o.amount_minor,
      cause: rail ? 'rail_later' : 'only_ours_entry', why: !ent.length ? 'Only in ours — the balance came in before this period.' : rail ? 'Only in ours: ' + ent.length + ' ' + (ent.length === 1 ? 'bill' : 'bills') + ' that came on the rail; their file has no such line.' : 'Only in ours: ' + ent.length + ' ' + (ent.length === 1 ? 'entry' : 'entries') + ' their file has no line for.',
      entries: shown(ent, []), entries_n: ent.length, open: open([code]) });
  });
  lines.sort((a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.diff_minor || 0) - Math.abs(a.diff_minor || 0) || String(a.name).localeCompare(String(b.name)));
  return lines;
}
/** the statement's one total, first: total debits (TB) · net profit (P&L) · total assets (BS) — ours as the engine answered, theirs added up from their lines */
function totalOf(p, o, X, cur) {
  const rows = p.rows || [], side = (r) => { const m = matchOf(r, X); const a = m && m.codes.length && X.byCode.get(m.codes[0]); const n = a && a.nature;
    if (p.part === 'pl') return n === 'income' ? 'income' : n === 'expense' ? 'expense' : r.side;
    return n === 'asset' ? 'assets' : n ? 'liabilities' : r.side; };
  let label, ours, theirs;
  if (p.part === 'tb') { label = 'Total debits'; ours = Number(o.total_dr_minor || 0); theirs = rows.reduce((t, r) => t + (r.dr_minor || 0), 0); }
  else if (p.part === 'pl') { label = 'Net profit'; ours = Number(o.profit_minor || 0); theirs = rows.reduce((t, r) => t + (side(r) === 'income' ? r.amount_minor : side(r) === 'expense' ? -r.amount_minor : 0), 0); }
  else { label = 'Total assets'; ours = Number(o.total_assets_minor || 0); theirs = rows.reduce((t, r) => t + (side(r) === 'assets' ? r.amount_minor : 0), 0); }
  const diff = ours - theirs;
  return { key: p.part + ':total', total: true, their_line: null, their_name: label, their_code: null, status: diff ? 'different' : 'equal', name: label, our_codes: [], ours_minor: ours, theirs_minor: theirs, diff_minor: diff,
    cause: diff ? 'total' : null, why: diff ? 'The totals are ' + MI.moneyWords(Math.abs(diff), cur) + ' apart — the lines below say where.' : null, entries: [], entries_n: 0, open: null };
}

/** the return — box by box. ours: { boxes: [{ code, label, amount_minor, tax_minor, accounts }], note } */
function compareReturn(p, ours, cur) {
  const boxes = ((ours && ours.boxes) || []).slice().sort((a, b) => squash(b.code).length - squash(a.code).length);
  const find = (name) => { const k = squash(name); return boxes.find((b) => { const c = squash(b.code); return k === c || k === squash(b.label) || (k.indexOf(c) === 0 && !/\d/.test(k.charAt(c.length))); }) || null; };
  const lines = [], claimed = new Set();
  const line = (key, r, b, oursMinor, theirsMinor, word) => {
    const diff = oursMinor == null || theirsMinor == null ? null : oursMinor - theirsMinor;
    const led = b && (b.accounts || []).map((a) => a.name).filter(Boolean).slice(0, 3).join(', ');
    lines.push({ key, their_line: r ? r.line : null, their_name: r ? r.name : null, their_code: null, status: !b ? 'gap' : !r ? 'only_ours' : diff ? 'different' : 'equal', name: b ? b.code + ' ' + (word || b.label) : r.name,
      our_codes: [], ours_minor: oursMinor, theirs_minor: theirsMinor, diff_minor: !b ? null : diff == null ? oursMinor : diff,
      cause: !b ? 'mapping' : diff ? (Math.abs(diff) < Math.pow(10, M.decimals ? M.decimals(cur) : 2) ? 'rounding' : 'box') : null,
      why: !b ? 'No box of ours is called "' + r.name + '" — name it as the form does (G1, 1A, 3.1(a)…).' : !r ? 'Only in ours.' : !diff ? null
        : Math.abs(diff) < Math.pow(10, M.decimals ? M.decimals(cur) : 2) ? 'A rounding rule, not a missing entry.' : 'Ours is ' + MI.moneyWords(Math.abs(diff), cur) + (diff > 0 ? ' more' : ' less') + (led ? ' — it counts ' + led + '.' : '.') + (ours.note ? ' ' + ours.note : ''),
      entries: [], entries_n: 0, open: null });
  };
  for (const r of p.rows || []) {
    const b = find(r.name);
    if (b) claimed.add(b.code);
    line(p.part + ':' + r.line, r, b, b ? (b.amount_minor == null ? b.tax_minor : b.amount_minor) : null, r.amount_minor);
    if (b && r.tax_minor != null && b.tax_minor != null && b.amount_minor != null) line(p.part + ':' + r.line + ':tax', r, b, b.tax_minor, r.tax_minor, 'tax');
  }
  boxes.forEach((b) => { const v = b.amount_minor == null ? b.tax_minor : b.amount_minor; if (!claimed.has(b.code) && v) line(p.part + ':ours:' + b.code, null, b, v, null); });
  lines.sort((a, b) => RANK[a.status] - RANK[b.status] || Math.abs(b.diff_minor || 0) - Math.abs(a.diff_minor || 0));
  return lines;
}

/** India: the rail's GSTR-3B (lib/tax-lines gstr3b, rupees) as boxes, in minor units — the form's own tables, so a box reads as the portal names it */
function gstr3bBoxes(g) {
  const s = (g && g.sup_details && g.sup_details.osup_det) || {}, i = (g && g.itc_elg && g.itc_elg.itc_net) || {}, m = (v) => MI.toMinor(String(v == null ? 0 : v), 'INR');
  return { boxes: [
    { code: '3.1(a)', label: 'Outward taxable value', amount_minor: m(s.txval) }, { code: '3.1(a) IGST', label: 'Integrated tax', amount_minor: m(s.iamt) },
    { code: '3.1(a) CGST', label: 'Central tax', amount_minor: m(s.camt) }, { code: '3.1(a) SGST', label: 'State tax', amount_minor: m(s.samt) }, { code: '3.1(a) Cess', label: 'Cess', amount_minor: m(s.csamt) },
    { code: '4(C) IGST', label: 'Net ITC integrated', amount_minor: m(i.iamt) }, { code: '4(C) CGST', label: 'Net ITC central', amount_minor: m(i.camt) },
    { code: '4(C) SGST', label: 'Net ITC state', amount_minor: m(i.samt) }, { code: '4(C) Cess', label: 'Net ITC cess', amount_minor: m(i.csamt) },
  ].map((b) => Object.assign({ tax_minor: null, accounts: [] }, b)), note: 'Ours is read from the frozen invoices on the rail; a purchase off the rail is not in it.' };
}

/** PR2's hook: the period's entries by how they arrived — structured (a chit on the rail, or a counter's day) vs keyed (typed here: journals, openings, payments) */
function effortOf(lines, from, to) {
  const seen = new Map();
  (lines || []).forEach((l) => {
    const d = String(l.posting_date instanceof Date ? l.posting_date.toISOString() : l.posting_date || '').slice(0, 10);
    if ((from && d < from) || (to && d > to) || seen.has(l.entry_id)) return;
    seen.set(l.entry_id, { kind: l.event_type || 'other', structured: !!(l.source_chit_id || Number(l.covers) > 0) });
  });
  const by_kind = {}; let structured = 0;
  seen.forEach((e) => { by_kind[e.kind] = (by_kind[e.kind] || 0) + 1; if (e.structured) structured++; });
  return { from, to, entries: seen.size, structured, keyed: seen.size - structured, by_kind };
}

/**
 * THE COMPARE — pure. in: { parts: [the snapshot's rows as kept], chart, ours: { tb, pl, bs, ret } (the engines' answers; an Error = said in words), lines (entryLines of the
 * period), currency, from, to } → { parts: { tb|pl|bs|ret: { part, title, as_at, from, to, file_name, lines, counts, error } }, counts, effort }
 */
function compare(inp) {
  const cur = inp.currency, X = mapIndex(inp.chart || []), E = entriesIndex(inp.lines, inp.from, inp.to), out = {}, counts = { equal: 0, different: 0, gap: 0, only_ours: 0 };
  for (const p of inp.parts || []) {
    const o = (inp.ours || {})[p.part], head = { part: p.part, title: PART_WORD[p.part], from: p.period_from || null, to: p.period_to, file_name: p.file_name || null, source: p.source };
    if (!o || o instanceof Error) { out[p.part] = Object.assign(head, { lines: [], counts: null, error: o instanceof Error ? (o.refused || o.code ? o.message : 'Our ' + PART_WORD[p.part].toLowerCase() + ' could not be read.') : 'Ours is not built for this part yet.' }); continue; }
    const lines = p.part === 'ret' ? compareReturn(p, o, cur) : [totalOf(p, o, X, cur)].concat(compareStatement(p, oursOf(p.part, o, inp.chart || []), X, E, cur, { from: inp.from, to: inp.to }));
    const c = { equal: 0, different: 0, gap: 0, only_ours: 0 };
    lines.filter((l) => !l.total).forEach((l) => { c[l.status]++; counts[l.status]++; });
    out[p.part] = Object.assign(head, { lines, counts: c, error: null, note: p.part === 'ret' ? o.note || null : null, form: p.part === 'ret' ? o.short || o.form || null : null });
  }
  return { parts: out, counts, effort: effortOf(inp.lines, inp.from, inp.to) };
}

/** the auditor's file: every line of every part, differences first (as the screen lists them) */
function csv(result, cur) {
  const d = M.decimals ? M.decimals(cur) : 2, n = (v) => (v == null ? '' : (Number(v) / Math.pow(10, d)).toFixed(d)), q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const out = ['statement,status,line,their line,their code,our ledgers,theirs,ours,difference,why'];
  PARTS.forEach((k) => { const P = result.parts[k]; if (!P) return; (P.lines || []).forEach((l) => out.push([P.title, l.status, l.name, l.their_line, l.their_code, (l.our_codes || []).join(' '), n(l.theirs_minor), n(l.ours_minor), n(l.diff_minor), l.why].map(q).join(','))); });
  return out.join('\n') + '\n';
}

module.exports = { PARTS, PART_WORD, SOURCES, SOURCE_WORD, KINDS, partOf, sourceOf, preflight, read, normalise, tallyRows, mapIndex, matchOf, oursOf, entriesIndex, explain, compare, compareReturn, gstr3bBoxes, effortOf, csv };
