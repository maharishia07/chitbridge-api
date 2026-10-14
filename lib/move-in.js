// @stage tested
// @stage-note [BOOKS · MOVE IN] A practice moves a client's books in from Xero / QuickBooks Online: five exports (chart · contacts · items ·
// @stage-note trial balance · open invoices and bills) read as files, columns GUESSED and confirmed, a DRY RUN a person reads, then ONE write.
'use strict';
/**
 * lib/move-in.js — MOVE IN FROM XERO / QUICKBOOKS ONLINE (round IM1, 2026-10-12; the facts: chitbridge-web docs/research/XERO-QBO-EXPORTS-2026-10.md, IM0).
 *
 * Phase 1 is FILES, not a live connection: the practice exports from Xero / QBO and this takes the file in. Every import is the same four moves:
 *   1 pick the file          readFile()   — a .csv (lib/csv parseCSV) or one sheet of an .xlsx (lib/xlsx-read), the SAME two readers the catalogue import uses
 *   2 columns guessed, then CONFIRMED   guess()  — the export's headers are IM0's *recall*, not spec: each column is PROPOSED (its own synonyms first, then
 *                                                   csv-preflight's matcher — exact · fuzzy) and the person confirms (decisions), exactly as L3's lead import does
 *   3 a DRY RUN             plan()       — PURE: every row becomes add · merge · skip WITH its sentence; nothing is written, nothing is guessed in silence
 *   4 import                apply()      — the plan, written in ONE transaction through the doors that exist (addAccount · postOpening · party-fields.patch ·
 *                                           local-identity.mint · catalogue-write.writeItems); the outcome is counts + the skipped rows (downloadable, skippedCsv)
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1 — nothing here computes money or tax of its own) ──────────────────────────────────────────────────
 *   the mapping table   engines reg-au `moveIn` (adopted lib/reg-au.js, v1.38.0): THEIR account type → OUR group · their control account → our role ledger ·
 *                       their tax code → the pack's supplyKinds (the rate comes from the kind row, never from a name)
 *   the chart           lib/books addAccount (the system gives the code; `source_code` keeps theirs, b302) · books-store accounts / setSourceCode
 *   the opening entry   lib/books postOpening — the SAME door POST /api/books/opening uses; the difference lands on Suspense 2900 (the posting engine's rule)
 *   parties             lib/local-identity mint (the one mint) · party-fields patch (legal name, ABN — the ABN check is reg-au abn.check) · rewards.holderOf (the phone, as L3)
 *   products            lib/catalogue-write writeItems (the one product writer; the item shape is the connector kit's syncProducts shape) · item-cost setCost
 *   money               money.round + money.decimals → minor units; csv-preflight looseNumber reads "$1,234.50"
 *
 * ── WHAT IT REFUSES (never guesses) ───────────────────────────────────────────────────────────────────────────────────────────────────
 *   a type with no home · a tax code the pack does not know (the product is added, the rate left for the person) · a bad ABN · a trial balance whose
 *   debits and credits differ (the whole file, in words) · a party or ledger the file names and the shop does not have · a code another ledger holds.
 *   The debtors / creditors CONTROL totals of a trial balance are NOT posted (they arrive bill-wise from the aged file); Suspense shows the gap until then.
 */
const P = require('./csv-preflight');
const CSV = require('./csv');
const xlsxRead = require('./xlsx-read');
const M = require('./money');

const MAX_ROWS = 2000;                         /* the catalogue import's own ceiling; said when it bites */
const XLSX_MAX = 4 * 1024 * 1024;
const SOURCES = ['xero', 'qbo'];
const SOURCE_WORD = { xero: 'Xero', qbo: 'QuickBooks' };

function refuse(why, code, status) { const e = new Error(why); e.refused = true; e.code = code || 'BOOKS_REFUSED'; if (status) e.status = status; return e; }
function bad(why) { return refuse(why, 'BOOKS_BAD_REQUEST'); }
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const low = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
const up = (s) => String(s == null ? '' : s).trim().toUpperCase();
const txt = (v, n) => { const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' '); return n ? s.slice(0, n) : s; };

/* ═══ 2 · the columns: what each export is asked for, and what a real export calls it (IM0 §1.2–1.6, §2.1–2.6 — recall, confirmed by the person) ═══ */
const KINDS = {
  accounts: { label: 'Chart of accounts', fields: [
    { key: 'code', label: 'Their code', req: false, syn: ['code', 'account code', 'account number', 'acct num', 'acctnum', 'number', 'account no', 'no'] },
    { key: 'name', label: 'Account name', req: true, syn: ['name', 'account name', 'account', 'fully qualified name', 'full name'] },
    { key: 'type', label: 'Account type', req: true, syn: ['type', 'account type', 'class', 'classification'] },
    { key: 'system', label: 'System account', req: false, syn: ['system account', 'systemaccount', 'system'] },
    { key: 'tax_code', label: 'Default tax', req: false, syn: ['tax code', 'tax type', 'default tax', 'default tax code', 'tax rate', 'gst code', 'tax'] },
    { key: 'description', label: 'Description', req: false, syn: ['description', 'desc', 'memo'] },
  ] },
  contacts: { label: 'Contacts', fields: [
    { key: 'name', label: 'Name', req: true, syn: ['contact name', 'contactname', 'name', 'customer', 'supplier', 'vendor', 'display name', 'customer full name', 'full name', 'contact'] },
    { key: 'legal_name', label: 'Legal name', req: false, syn: ['legal name', 'legalname', 'company', 'company name', 'business name', 'trading name'] },
    { key: 'email', label: 'Email', req: false, syn: ['email address', 'emailaddress', 'email', 'e mail', 'primary email'] },
    { key: 'phone', label: 'Phone', req: false, syn: ['phone number', 'phonenumber', 'phone', 'mobile number', 'mobilenumber', 'mobile', 'telephone', 'primary phone'] },
    { key: 'abn', label: 'ABN', req: false, syn: ['abn', 'tax number', 'taxnumber', 'abn number', 'business number', 'tax reg number', 'tax id', 'tax identifier', 'primary tax identifier'] },
    { key: 'gstin', label: 'GSTIN', req: false, syn: ['gstin', 'gst number', 'gst no', 'gst registration'] },
  ] },
  items: { label: 'Items', fields: [
    { key: 'code', label: 'Code', req: false, syn: ['item code', 'itemcode', 'code', 'sku', 'product code', 'item no', 'item id'] },
    { key: 'name', label: 'Name', req: true, syn: ['item name', 'itemname', 'name', 'product/service', 'product service', 'product', 'service', 'item', 'product name'] },
    { key: 'description', label: 'Description', req: false, syn: ['sales description', 'salesdescription', 'description', 'memo/description', 'memo description', 'desc'] },
    { key: 'sales_price', label: 'Sales price', req: false, syn: ['sales unit price', 'salesunitprice', 'sales price', 'unit price', 'price', 'rate', 'sell price', 'selling price', 'price/rate', 'price rate'] },
    { key: 'purchase_price', label: 'Purchase price', req: false, syn: ['purchases unit price', 'purchasesunitprice', 'purchase unit price', 'purchase price', 'purchase cost', 'cost', 'cost price', 'buy price'] },
    { key: 'sales_tax', label: 'Sales tax code', req: false, syn: ['sales tax rate', 'salestaxrate', 'sales tax code', 'sales tax', 'tax code', 'tax rate', 'tax', 'gst', 'sales tax code ref'] },
    { key: 'purchase_tax', label: 'Purchase tax code', req: false, syn: ['purchases tax rate', 'purchasestaxrate', 'purchase tax rate', 'purchase tax code', 'purchase tax', 'purchase tax code ref'] },
  ] },
  trial_balance: { label: 'Trial balance', fields: [
    { key: 'account', label: 'Account', req: true, syn: ['account', 'account name', 'name', 'ledger', 'description'] },
    { key: 'code', label: 'Their code', req: false, syn: ['code', 'account code', 'account number', 'acct num', 'number', 'account no', 'no'] },
    { key: 'debit', label: 'Debit', req: true, syn: ['debit', 'dr', 'debit amount', 'debits'] },
    { key: 'credit', label: 'Credit', req: true, syn: ['credit', 'cr', 'credit amount', 'credits'] },
  ] },
  open_bills: { label: 'Open invoices and bills', fields: [
    { key: 'contact', label: 'Contact', req: true, syn: ['contact name', 'contactname', 'contact', 'customer', 'supplier', 'vendor', 'name', 'customer name', 'supplier name'] },
    { key: 'invoice_no', label: 'Invoice number', req: true, syn: ['invoice number', 'invoicenumber', 'invoice no', 'num', 'number', 'doc number', 'docnumber', 'bill number', 'reference', 'no'] },
    { key: 'date', label: 'Date', req: false, syn: ['invoice date', 'invoicedate', 'date', 'txn date', 'transaction date', 'bill date'] },
    { key: 'due_date', label: 'Due date', req: false, syn: ['due date', 'duedate', 'due'] },
    { key: 'amount_due', label: 'Amount still owed', req: true, syn: ['invoice amount due', 'invoiceamountdue', 'amount due', 'open balance', 'balance', 'outstanding', 'amount outstanding', 'amount owing', 'owing', 'remaining'] },
    { key: 'total', label: 'Total', req: false, syn: ['total', 'amount', 'invoice total', 'total amt'] },
  ] },
};
const KIND_KEYS = Object.keys(KINDS);
function kindOf(k) { const s = String(k == null ? '' : k).trim().toLowerCase().replace(/-/g, '_'); if (!own(KINDS, s)) throw bad('Which file is this — ' + KIND_KEYS.join(', ') + '?'); return s; }
function sourceOf(s) { const k = String(s == null ? '' : s).trim().toLowerCase(); if (SOURCES.indexOf(k) < 0) throw bad('Which system is it from — xero or qbo?'); return k; }
const squash = (s) => P.normalise(s).replace(/\s+/g, '');

/* ═══ 1 · the file, as { headers, rows } — the two readers the catalogue import already uses ═══ */
function readFile(b) {
  const body = b || {};
  if (typeof body.xlsx === 'string' && body.xlsx.trim()) {
    let buf = null; try { buf = Buffer.from(body.xlsx, 'base64'); } catch (_) { buf = null; }
    if (!buf || !buf.length) throw bad('That file could not be read.');
    if (buf.length > XLSX_MAX) throw bad('That workbook is ' + Math.round(buf.length / 1048576) + ' MB — send just the sheet with the export on it.');
    try { return xlsxRead.sheetRows(buf, { sheet: body.sheet || null, headerRow: body.header_row }); }
    catch (e) { throw bad(e.userMessage || String(e.message)); }
  }
  const text = String(body.csv || '');
  if (!text.trim()) throw bad('The file is empty.');
  const want = Number(body.header_row);
  if (Number.isInteger(want) && want > 1) {
    /* "my headings are on row N" (a report export opens with the shop's name): the SAME parser, run positionally — a synthetic wide header keeps every cell
       of every row (the title row is narrower than the table, and parseCSV keys cells by the first row), then row N becomes the headings */
    const WIDE = 64, cols = Array.from({ length: WIDE }, (_, i) => 'c' + i);
    const kept = text.split(/\r?\n/).map((l) => (l.trim() === '' ? ',' : l)).join('\n');   /* a blank line stays a row, so row N is the row a person counts */
    const raw = CSV.parseCSV(cols.join(',') + '\n' + kept).rows;
    const at = want - 1;
    if (at < 0 || at >= raw.length) throw bad('Row ' + want + ' is past the end of that file — it has ' + raw.length + ' rows.');
    const heads = cols.map((c) => txt(raw[at][c]));
    while (heads.length && !heads[heads.length - 1]) heads.pop();
    const seen = new Map();
    const headers = heads.map((h, i) => { let n = h || ('Column ' + String.fromCharCode(65 + (i % 26))); if (seen.has(n)) { const k = seen.get(n) + 1; seen.set(n, k); n = n + ' (' + k + ')'; } else seen.set(n, 1); return n; });
    const rows = raw.slice(at + 1).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = r[cols[i]] == null ? '' : r[cols[i]]; }); return o; }).filter((o) => headers.some((h) => String(o[h]).trim() !== ''));
    return { headers, rows, headerRow: want };
  }
  return Object.assign({}, CSV.parseCSV(text), { headerRow: 1 });
}

/* ═══ 2 · the guess: each header → a field, with how sure and why; the person confirms ═══ */
/** `table` (optional, PR1): another import's own { kind: { label, fields } } — the parallel-run compare guesses ITS columns with this same matcher */
function guess(kind, headers, table) {
  const K = table ? table[kind] : KINDS[kindOf(kind)], fields = K.fields, taken = new Set(), out = [];
  const bySquash = new Map();
  fields.forEach((f) => f.syn.forEach((s) => { const k = squash(s); if (!bySquash.has(k)) bySquash.set(k, f.key); }));
  /* pass 1 — a name the export is known to use (IM0's recall list, the first match per field wins; "*Code" and "ItemCode" both land) */
  const guessed = headers.map((h) => {
    const n = squash(String(h).replace(/^\*/, ''));
    const f = n && bySquash.get(n);
    if (f && !taken.has(f)) { taken.add(f); return { incoming: h, field: f, how: 'known', confidence: 1, why: '"' + h + '" is what ' + K.label.toLowerCase() + ' exports call ' + labelOf(fields, f).toLowerCase() }; }
    return null;
  });
  /* pass 2 — csv-preflight's own matcher for the rest (exact on the key or label, else similarity — reported as a guess to confirm, never acted on alone) */
  const accepted = fields.map((f) => f.key).filter((k) => !taken.has(k));
  const labels = {}; fields.forEach((f) => { labels[f.key] = f.label; });
  headers.forEach((h, i) => {
    if (guessed[i]) { out.push(guessed[i]); return; }
    const m = accepted.length ? P.matchHeader(String(h).replace(/^\*/, ''), accepted, labels) : { canonical: null, how: 'unmatched', confidence: 0, why: 'every column is already placed' };
    if (m.canonical && !taken.has(m.canonical) && m.how !== 'blocked') { taken.add(m.canonical); out.push({ incoming: h, field: m.canonical, how: m.how, confidence: m.confidence, why: m.why }); }
    else out.push({ incoming: h, field: null, how: 'unmatched', confidence: 0, why: m.how === 'blocked' ? m.why : 'not one of the columns this import reads — ignored unless you pick a field' });
  });
  const missing = fields.filter((f) => f.req && !taken.has(f.key)).map((f) => f.key);
  return { fields: fields.map((f) => ({ key: f.key, label: f.label, required: !!f.req })), guess: out, missing,
    ready: missing.length === 0 && out.every((g) => !g.field || g.how === 'known' || g.how === 'exact') };
}
function labelOf(fields, key) { const f = fields.find((x) => x.key === key); return f ? f.label : key; }

/** the confirmed columns → rows keyed by field, each with the line a person sees (header = 1). A column with no decision is not read. */
function cells(kind, parsed, decisions, table) {
  const K = table ? table[kind] : KINDS[kindOf(kind)], keys = new Set(K.fields.map((f) => f.key));
  const d = Array.isArray(decisions) ? decisions : [];
  const map = new Map();
  for (const x of d) {
    if (!x || !x.field || x.action === 'ignore') continue;
    if (!keys.has(x.field)) throw bad('"' + x.incoming + '" cannot be read as ' + x.field + ' — this import has no such column.');
    if (parsed.headers.indexOf(x.incoming) < 0) throw bad('The file has no column called "' + x.incoming + '".');
    if (map.has(x.field)) throw bad('Both "' + map.get(x.field) + '" and "' + x.incoming + '" were picked as ' + labelOf(K.fields, x.field) + '. Pick one.');
    map.set(x.field, x.incoming);
  }
  const missing = K.fields.filter((f) => f.req && !map.has(f.key));
  if (missing.length) throw bad('Pick the column for ' + missing.map((f) => f.label).join(', ') + ' first.');
  if (parsed.rows.length > MAX_ROWS) throw bad('This file has ' + parsed.rows.length + ' rows and one import can carry ' + MAX_ROWS + '. Nothing was imported — split the file.');
  return parsed.rows.map((r, i) => { const o = { line: i + 2 }; map.forEach((h, f) => { o[f] = r[h] == null ? '' : String(r[h]); }); return o; });
}

/* ═══ money and dates, through the one rounder ═══ */
function toMinor(v, cur) {
  const n = P.looseNumber(v);
  if (n.value === null) return null;
  const d = M.decimals ? M.decimals(cur) : 2;
  return Math.round(M.round(n.value, cur) * Math.pow(10, d));
}
function moneyWords(minor, cur) {
  const d = M.decimals ? M.decimals(cur) : 2, n = Number(minor || 0) / Math.pow(10, d);
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(n); } catch (_) { return cur + ' ' + n.toFixed(d); }
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** a date as an export writes it — 2026-07-01 · 01/07/2026 (AU: day first) · 1 Jul 2026 · 2026-07-01T00:00:00 — to YYYY-MM-DD, or null (said, never guessed from a bare number) */
function isoDate(v) {
  const s = txt(v); if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return check_(m[1], m[2], m[3]);
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s); if (m) return check_(m[3], m[2], m[1]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,4})[ -](\d{4})$/.exec(s); if (m && MON[m[2].toLowerCase()]) return check_(m[3], MON[m[2].toLowerCase()], m[1]);
  m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(s); if (m && MON[m[1].slice(0, 3).toLowerCase()]) return check_(m[3], MON[m[1].slice(0, 3).toLowerCase()], m[2]);
  return null;
}
function check_(y, mo, d) { const t = new Date(Date.UTC(+y, +mo - 1, +d)); if (t.getUTCFullYear() !== +y || t.getUTCMonth() !== +mo - 1 || t.getUTCDate() !== +d) return null; return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

/* ═══ 3 · THE DRY RUN — pure. in: { kind, source, rows (cells), world, side?, as_at?, currency } → { rows: [{ line, what, action, why, data }], counts, refusal, notes } ═══ */
function plan(kind, inp) {
  const k = kindOf(kind), src = sourceOf(inp.source);
  const AU = require('./reg-au');
  const out = PLANNERS[k](Object.assign({}, inp, { source: src, AU }));
  const counts = { add: 0, merge: 0, skip: 0 };
  out.rows.forEach((r) => { counts[r.action] = (counts[r.action] || 0) + 1; });
  return Object.assign({ kind: k, source: src, counts, refusal: null, notes: [] }, out);
}
const row_ = (line, what, action, why, data) => ({ line, what: what || '', action, why, data: data || null });

/** the chart, read once, indexed: groups by pack key · ledgers by role · by their code · by name */
function chartIndex(world) {
  const E = require('./books-engines');
  const chart = world.chart || [], pack = world.pack || {};
  const groupRows = new Map(); (pack.groups || []).forEach((g) => { const row = chart.find((a) => a.is_group && String(a.code) === E.groupCode(g)); if (row) groupRows.set(g.code, row); });
  const byRole = new Map(), bySource = new Map(), byName = new Map();
  chart.forEach((a) => { if (a.role) byRole.set(a.role, a); if (a.source_code) bySource.set(up(a.source_code), a); if (!a.is_group) byName.set(low(a.name), a); });
  return { chart, pack, groupRows, byRole, bySource, byName };
}

/** a trial-balance row's account and code: Xero writes the row as "Sales (200)" — the code is split off when the file has no code column (the compare reads it too) */
function accountCode(acc, cod) {
  let account = txt(acc, 150), code = txt(cod, 20);
  const m = /^(.*?)\s*\((\w[\w-]*)\)\s*$/.exec(account);
  if (m && !code) { account = txt(m[1]); code = m[2]; }
  return { account, code };
}
/** the names Xero / QBO give their control accounts when the file has no system-account column; the dry run names the ledger it lands on */
const NAME_ROLES = { 'accounts receivable': 'debtors', 'trade debtors': 'debtors', 'accounts receivable (a/r)': 'debtors', 'accounts payable': 'creditors', 'trade creditors': 'creditors', 'accounts payable (a/p)': 'creditors', 'gst': 'gst_collected', 'gst payable': 'gst_collected' };
const PLANNERS = {
  accounts(inp) {
    const { AU, source } = inp, X = chartIndex(inp.world), rows = [], seenCode = new Map(), seenName = new Map(), srcWord = SOURCE_WORD[source];
    const groupName = (key) => { const g = (X.pack.groups || []).find((x) => x.code === key); return g ? g.name : key; };
    for (const r of inp.rows) {
      const name = txt(r.name, 120), code = txt(r.code, 20), type = txt(r.type), what = name || code;
      const kind = AU.moveIn.supplyKindFor(source, r.tax_code);
      const taxNote = txt(r.tax_code) ? (kind ? 'default tax ' + txt(r.tax_code) + ' = ' + kind.name + ' ' + kind.rate + '% — not kept (no slot for a per-account default)' : kind === null ? 'default tax ' + txt(r.tax_code) + ' = no GST — not kept' : 'default tax "' + txt(r.tax_code) + '" is not a code this import knows — not kept') : null;
      if (!name) { rows.push(row_(r.line, what, 'skip', 'No account name.')); continue; }
      if (code && seenCode.has(up(code))) { rows.push(row_(r.line, what, 'skip', 'Code ' + code + ' is already on line ' + seenCode.get(up(code)) + ' of this file.')); continue; }
      if (seenName.has(low(name))) { rows.push(row_(r.line, what, 'skip', '"' + name + '" is already on line ' + seenName.get(low(name)) + ' of this file.')); continue; }
      seenName.set(low(name), r.line); if (code) seenCode.set(up(code), r.line);
      const held = code ? X.bySource.get(up(code)) : null;
      if (held) {
        rows.push(row_(r.line, what, 'skip', low(held.name) === low(name) ? 'Already moved in as ' + held.code + ' ' + held.name + '.' : 'Code ' + code + ' is already on ledger ' + held.code + ' ' + held.name + ' — a code clash.'));
        continue;
      }
      /* a control account: Xero's CSV carries no SystemAccount column (IM0 §1.2), so its NAME says it — shown as a merge the person reads, never silent */
      const role = AU.moveIn.roleFor(source, r.system) || AU.moveIn.roleFor(source, type) || NAME_ROLES[low(name)] || null;
      const target = (role && X.byRole.get(role)) || X.byName.get(low(name)) || null;
      if (target) {
        if (code && target.source_code && up(target.source_code) !== up(code)) { rows.push(row_(r.line, what, 'skip', target.code + ' ' + target.name + ' already carries ' + srcWord + ' code ' + target.source_code + ' — a code clash.')); continue; }
        const why = (role ? 'Is your ' + target.name + ' ledger (' + target.code + ')' : 'A ledger named "' + target.name + '" exists (' + target.code + ')') + (code && !target.source_code ? ' — keeps ' + srcWord + ' code ' + code : '') + '.';
        rows.push(row_(r.line, what, 'merge', why, { account_id: target.account_id, code: target.code, source_code: code && !target.source_code ? code : null, note: taxNote }));
        continue;
      }
      const key = AU.moveIn.groupFor(source, type);
      if (!key) { rows.push(row_(r.line, what, 'skip', 'No home for ' + srcWord + ' type "' + (type || '(blank)') + '" — add it under Shop ledgers and pick its group.')); continue; }
      const g = X.groupRows.get(key);
      if (!g) { rows.push(row_(r.line, what, 'skip', 'Your chart has no group "' + groupName(key) + '" for ' + srcWord + ' type ' + type + ' — add it under Shop ledgers.')); continue; }
      rows.push(row_(r.line, what, 'add', 'Under ' + g.name + (code ? ', keeping ' + srcWord + ' code ' + code : '') + '.', { name, group_code: g.code, group_id: g.account_id, group_name: g.name, source_code: code || null, note: taxNote }));
    }
    return { rows };
  },

  contacts(inp) {
    const { AU, source } = inp, side = inp.side === 'supplier' ? 'supplier' : 'customer', W = inp.world || {}, rows = [];
    const rewards = require('./rewards'), PM = require('./profile-map');
    const parties = W.parties || [], byName = new Map(), byNameOther = new Map();
    parties.forEach((p) => { if (p[side]) byName.set(low(p.name), p); else byNameOther.set(low(p.name), p); });
    const byAbn = new Map(); (W.taxIds || []).forEach((t) => { if (up(t.scheme) === 'ABN') byAbn.set(String(t.value).replace(/\D/g, ''), t.party_id); });
    const byPhone = new Map(); (W.phones || []).forEach((x) => { if (x.phone) byPhone.set(String(x.phone), x.party_id); });
    const legalOf = new Map(); parties.forEach((p) => legalOf.set(String(p.party_id), p.legal_name || null));
    const pById = new Map(); parties.forEach((p) => pById.set(String(p.party_id), p));
    const seen = { name: new Map(), abn: new Map(), phone: new Map() };
    for (const r of inp.rows) {
      const name = txt(r.name, 120), what = name;
      if (!name) { rows.push(row_(r.line, what, 'skip', 'No name.')); continue; }
      if (name.indexOf('@') >= 0) { rows.push(row_(r.line, what, 'skip', 'The name looks like an email — put the email in its own column.')); continue; }
      const notes = [];
      let phone = null; if (txt(r.phone)) { const h = rewards.holderOf({ phone: r.phone }); if (h && h.scheme === 'phone') phone = h.value; else notes.push('phone "' + txt(r.phone) + '" is too short to keep'); }
      let abn = null; if (txt(r.abn)) { const c = AU.abn.check(r.abn); if (!c.ok) { rows.push(row_(r.line, what, 'skip', 'ABN ' + txt(r.abn) + ': ' + c.why)); continue; } abn = c.abn; }
      let gstin = null; if (txt(r.gstin)) { const g = up(r.gstin).replace(/\s+/g, ''); const ck = PM.gstinChecksum(g); if (!ck.ok) { rows.push(row_(r.line, what, 'skip', 'GSTIN ' + g + ' does not check out.')); continue; } gstin = g; }
      const legal = txt(r.legal_name, 200) || null, email = txt(r.email, 200) || null;
      if (seen.name.has(low(name))) { rows.push(row_(r.line, what, 'skip', '"' + name + '" is already on line ' + seen.name.get(low(name)) + ' of this file.')); continue; }
      if (abn && seen.abn.has(abn)) { rows.push(row_(r.line, what, 'skip', 'ABN ' + abn + ' is already on line ' + seen.abn.get(abn) + ' of this file.')); continue; }
      if (phone && seen.phone.has(phone)) { rows.push(row_(r.line, what, 'skip', 'Phone ' + phone + ' is already on line ' + seen.phone.get(phone) + ' of this file.')); continue; }
      seen.name.set(low(name), r.line);                                              /* a name twice in one file is one contact, whatever became of the first row */
      const remember = () => { if (abn) seen.abn.set(abn, r.line); if (phone) seen.phone.set(phone, r.line); };
      /* who is this already? the ABN, then the phone (as L3's lead import), then the name on this list, then the name on the other list */
      const viaAbn = abn ? byAbn.get(abn) : null, viaPhone = phone ? byPhone.get(phone) : null;
      if (viaAbn && viaPhone && viaAbn !== viaPhone) { rows.push(row_(r.line, what, 'skip', 'ABN ' + abn + ' belongs to ' + (pById.get(String(viaAbn)) || {}).name + ' and phone ' + phone + ' to ' + (pById.get(String(viaPhone)) || {}).name + ' — merge them first.')); continue; }
      const hitId = viaAbn || viaPhone || null;
      const hit = hitId ? pById.get(String(hitId)) : (byName.get(low(name)) || byNameOther.get(low(name)) || null);
      if (hit) {
        const sets = {};
        if (!hit[side]) sets.list = side;
        if (abn && !byAbn.has(abn)) sets.abn = abn;
        if (legal && !legalOf.get(String(hit.party_id))) sets.legal_name = legal;
        if (phone && !byPhone.has(phone)) sets.phone = phone;
        if (gstin && !hit.gstin) sets.gstin = gstin;
        const words = [].concat(sets.list ? ['added as a ' + side + ' too'] : [], sets.abn ? ['ABN kept'] : [], sets.legal_name ? ['legal name kept'] : [], sets.phone ? ['phone kept'] : [], sets.gstin ? ['GSTIN kept'] : []);
        if (!words.length) { rows.push(row_(r.line, what, 'skip', 'Already here as ' + (hit.party_no ? hit.party_no + ' ' : '') + hit.name + ' — nothing new in this row.')); continue; }
        remember();
        rows.push(row_(r.line, what, 'merge', 'Is ' + (hit.party_no ? hit.party_no + ' ' : '') + hit.name + ': ' + words.join(', ') + '.', { party_id: hit.party_id, side, sets, notes }));
        continue;
      }
      remember();
      rows.push(row_(r.line, what, 'add', 'New ' + side + (abn ? ', ABN ' + abn : '') + (phone ? ', phone ' + phone : '') + '.', { name, side, phone, email, abn, gstin, legal_name: legal, notes }));
    }
    return { rows };
  },

  items(inp) {
    const { AU, source } = inp, W = inp.world || {}, rows = [], srcWord = SOURCE_WORD[source];
    const byCode = new Map(); (W.products || []).forEach((p) => { if (p.code) byCode.set(low(p.code), p); });
    const seen = new Map();
    const kindWords = (code) => { const k = AU.moveIn.supplyKindFor(source, code); if (k) return { rate: k.rate, note: txt(code) + ' = ' + k.name + ' ' + k.rate + '%' }; if (k === null) return { rate: 0, note: txt(code) + ' = no GST' }; return { rate: null, note: 'tax code "' + txt(code) + '" is not one this import knows — set the rate on the product' }; };
    for (const r of inp.rows) {
      const name = txt(r.name, 120), code = txt(r.code, 60), what = name || code;
      if (!name) { rows.push(row_(r.line, what, 'skip', 'No item name.')); continue; }
      const price = txt(r.sales_price) ? P.looseNumber(r.sales_price) : { value: null };
      if (txt(r.sales_price) && price.value === null) { rows.push(row_(r.line, what, 'skip', 'Sales price "' + txt(r.sales_price) + '" is not a number.')); continue; }
      const cost = txt(r.purchase_price) ? P.looseNumber(r.purchase_price) : { value: null };
      if (txt(r.purchase_price) && cost.value === null) { rows.push(row_(r.line, what, 'skip', 'Purchase price "' + txt(r.purchase_price) + '" is not a number.')); continue; }
      if (code && seen.has(low(code))) { rows.push(row_(r.line, what, 'skip', 'Code ' + code + ' is already on line ' + seen.get(low(code)) + ' of this file.')); continue; }
      if (code) seen.set(low(code), r.line);
      const have = code ? byCode.get(low(code)) : null;
      if (have) { rows.push(row_(r.line, what, 'skip', 'Already in the catalogue as ' + (have.name || code) + ' (' + code + ') — prices are not overwritten by a move-in.')); continue; }
      const notes = [];
      const tax = txt(r.sales_tax) ? kindWords(r.sales_tax) : null; if (tax) notes.push(tax.note);
      if (txt(r.purchase_tax)) { const pt = kindWords(r.purchase_tax); notes.push('purchase tax ' + pt.note + ' — a product carries one rate, the sales one'); }
      if (!code) notes.push('no code: a second import of this file would add it again');
      const rec = { name, code: code || null, unit: 'unit', price: price.value == null ? 0 : price.value, gst_rate: tax && tax.rate != null ? tax.rate : null, cost: cost.value, source_system: source, source_ref: code || null, description: txt(r.description, 500) || null };
      rows.push(row_(r.line, what, 'add', (price.value != null ? moneyWords(toMinor(String(price.value), inp.currency || 'AUD'), inp.currency || 'AUD') : 'no price') + (tax && tax.rate != null ? ' · GST ' + tax.rate + '%' : tax ? ' · tax to set' : '') + '.', { rec, notes }));
    }
    return { rows };
  },

  trial_balance(inp) {
    const X = chartIndex(inp.world), cur = inp.currency || 'AUD', rows = [], srcWord = SOURCE_WORD[inp.source];
    let dr = 0, cr = 0;
    const parsed = inp.rows.map((r) => {
      const { account, code } = accountCode(r.account, r.code);
      const total = /^(total|totals|grand total)$/i.test(account) || (!account && !code);
      const d = txt(r.debit) ? toMinor(r.debit, cur) : 0, c = txt(r.credit) ? toMinor(r.credit, cur) : 0;
      return { line: r.line, account, code, total, dr: d, cr: c, badDr: txt(r.debit) && d === null, badCr: txt(r.credit) && c === null };
    });
    for (const p of parsed) if (!p.total && !p.badDr && !p.badCr) { dr += p.dr || 0; cr += p.cr || 0; }
    const refusal = dr !== cr ? 'The trial balance does not balance: debits ' + moneyWords(dr, cur) + ', credits ' + moneyWords(cr, cur) + ' — the difference is ' + moneyWords(Math.abs(dr - cr), cur) + '. Export it again as at the move date, with every account.' : null;
    const control = { debtors_minor: 0, creditors_minor: 0 };
    for (const p of parsed) {
      const what = p.account || p.code;
      if (p.total) { rows.push(row_(p.line, what || 'Total', 'skip', 'A total row.')); continue; }
      if (p.badDr || p.badCr) { rows.push(row_(p.line, what, 'skip', '"' + (p.badDr ? txt(inp.rows.find((r) => r.line === p.line).debit) : txt(inp.rows.find((r) => r.line === p.line).credit)) + '" is not an amount.')); continue; }
      /* THEIR code (kept on the ledger by the chart import), else the NAME, else a control account by the name their system gives it (before b302 keeps the codes) */
      const a = (p.code && X.bySource.get(up(p.code))) || X.byName.get(low(p.account)) || (NAME_ROLES[low(p.account)] ? X.byRole.get(NAME_ROLES[low(p.account)]) : null) || null;
      if (!a) { rows.push(row_(p.line, what, 'skip', 'No ledger named "' + p.account + '"' + (p.code ? ' (' + srcWord + ' code ' + p.code + ')' : '') + ' — move the chart of accounts in first, or add it under Shop ledgers.')); continue; }
      if (a.is_group) { rows.push(row_(p.line, what, 'skip', a.name + ' is a group, not a ledger.')); continue; }
      if (a.role === 'debtors' || a.role === 'creditors') {
        control[a.role + '_minor'] += (p.dr || 0) - (p.cr || 0);
        rows.push(row_(p.line, what, 'skip', (a.role === 'debtors' ? 'Customers' : 'Suppliers') + ' balance ' + moneyWords(Math.abs((p.dr || 0) - (p.cr || 0)), cur) + ' arrives bill-wise from the open ' + (a.role === 'debtors' ? 'invoices' : 'bills') + ' file — Suspense holds it until then.')); continue;
      }
      if (!p.dr && !p.cr) { rows.push(row_(p.line, what, 'skip', 'Nil.')); continue; }
      const net = (p.dr || 0) - (p.cr || 0);
      rows.push(row_(p.line, what, 'add', (net >= 0 ? 'Debit ' : 'Credit ') + moneyWords(Math.abs(net), cur) + ' on ' + a.code + ' ' + a.name + '.', { code: a.code, name: a.name, dr_minor: net > 0 ? net : 0, cr_minor: net < 0 ? -net : 0 }));
    }
    const notes = [];
    if (control.debtors_minor || control.creditors_minor) notes.push('Suspense will hold ' + moneyWords(Math.abs(control.debtors_minor - control.creditors_minor), cur) + ' until the open invoices and bills are moved in.');
    return { rows, refusal, notes, totals: { dr_minor: dr, cr_minor: cr }, control };
  },

  open_bills(inp) {
    const X = chartIndex(inp.world), W = inp.world || {}, cur = inp.currency || 'AUD', rows = [];
    const side = inp.side === 'payable' || inp.side === 'supplier' ? 'payable' : 'receivable';
    const role = side === 'payable' ? 'creditors' : 'debtors', flag = side === 'payable' ? 'supplier' : 'customer';
    const ctl = X.byRole.get(role);
    const byName = new Map(), byNo = new Map(); (W.parties || []).forEach((p) => { if (p[flag]) { byName.set(low(p.name), p); if (p.party_no) byNo.set(up(p.party_no), p); } });
    const seen = new Map();
    for (const r of inp.rows) {
      const who = txt(r.contact, 150), no = txt(r.invoice_no, 60), what = (who ? who + ' · ' : '') + no;
      if (!who) { rows.push(row_(r.line, what, 'skip', 'No contact name.')); continue; }
      if (!ctl) { rows.push(row_(r.line, what, 'skip', 'Your chart has no ' + (side === 'payable' ? 'Suppliers' : 'Customers') + ' ledger.')); continue; }
      if (!no) { rows.push(row_(r.line, what, 'skip', 'No invoice number — a bill-wise balance needs one.')); continue; }
      const amt = txt(r.amount_due) ? toMinor(r.amount_due, cur) : null;
      if (amt === null) { rows.push(row_(r.line, what, 'skip', txt(r.amount_due) ? '"' + txt(r.amount_due) + '" is not an amount.' : 'No amount still owed.')); continue; }
      if (!amt) { rows.push(row_(r.line, what, 'skip', 'Nothing owed on it.')); continue; }
      const p = byName.get(low(who)) || byNo.get(up(who)) || null;
      if (!p) { rows.push(row_(r.line, what, 'skip', 'No ' + flag + ' named "' + who + '" — move the contacts in first.')); continue; }
      const key = String(p.party_id) + '|' + up(no);
      if (seen.has(key)) { rows.push(row_(r.line, what, 'skip', no + ' for ' + p.name + ' is already on line ' + seen.get(key) + ' of this file.')); continue; }
      seen.set(key, r.line);
      const due = isoDate(r.due_date), notes = [];
      if (txt(r.due_date) && !due) notes.push('due date "' + txt(r.due_date) + '" could not be read — left blank');
      const debit = side === 'receivable' ? amt > 0 : amt < 0;
      rows.push(row_(r.line, what, 'add', (amt < 0 ? 'A credit of ' : '') + moneyWords(Math.abs(amt), cur) + (amt < 0 ? ' in ' : ' owed ') + (side === 'receivable' ? 'by ' : 'to ') + p.name + (due ? ', due ' + due : '') + '.',
        { code: ctl.code, party_id: p.party_id, party_no: p.party_no || null, name: p.name, bill_ref: no, due_date: due, dr_minor: debit ? Math.abs(amt) : 0, cr_minor: debit ? 0 : Math.abs(amt), notes }));
    }
    return { rows, side };
  },
};

/* ═══ the world — what the shop already has, read ONCE per import (no per-row queries); each read in its own savepoint so a table that is not there yet reads as empty ═══ */
async function world(h, entity, kind, setting) {
  const S = require('./books-store'), B = require('./books'), E = require('./books-engines');
  const tsp = (fn, fb) => require('../db').trySavepoint(h, fn, fb);
  const k = kindOf(kind);
  const out = { pack: B.packOf(setting), setting };
  if (k === 'accounts' || k === 'trial_balance' || k === 'open_bills') out.chart = await S.accounts(h, entity);
  if (k === 'contacts' || k === 'open_bills') {
    out.parties = await tsp(() => S.parties(h, entity), []);
    const ids = out.parties.map((p) => p.party_id);
    out.taxIds = ids.length ? await tsp(async () => (await h.query(`SELECT party_id, scheme, value FROM party_tax_id WHERE owner_entity_id = $1`, [entity])).rows, []) : [];
    out.phones = ids.length ? await tsp(async () => (await h.query(`SELECT identity_id AS party_id, COALESCE(NULLIF(phone, ''), otp_contact) AS phone FROM identities WHERE identity_id = ANY($1::uuid[])`, [ids])).rows.filter((x) => x.phone), []) : [];
    out.listIds = ids.length ? await tsp(async () => (await h.query(`SELECT 'customer' AS side, customer_list_id AS id, customer_identity_id AS party_id FROM customer_list WHERE owner_entity_id = $1
                                                                          UNION ALL SELECT 'supplier', supplier_list_id, supplier_entity_id FROM supplier_list WHERE owner_entity_id = $1`, [entity])).rows, []) : [];
  }
  if (k === 'items') out.products = await tsp(async () => (await h.query(`SELECT item_id, COALESCE(item_data->>'code', item_data->>'sku') AS code, item_data->>'name' AS name FROM catalogue_items WHERE entity_id = $1 AND is_active = true`, [entity])).rows, []);
  E.packs();   /* the engines must be there before anything is planned against the chart */
  return out;
}

/* ═══ 4 · THE WRITE — one transaction (the caller's withEntity), the plan as planned, through the doors that exist ═══ */
/** a NEW contact on the shop's connection (split out of apply for the fn-size ratchet, INT6a) → { id } (the list row) or { why } (skipped).
 *  `bare` = no legal name / tax ids follow, so the party number is given here (PF.patch numbers it otherwise). */
async function addNew_(h, entity, d, bare, ins) {
  const L = require('./local-identity'), PF = require('./party-fields');
  if (d.side === 'customer') {
    /* ⭐ CRM-MINT1: the one add-customer (mint · list row · contact · number) on this transaction; PF.patch numbers when it runs */
    const a = await L.addCustomer(h, entity, { name: d.name, phone: d.phone, gstin: d.gstin, email: d.email, via: 'move_in', number: bare });
    if (a.refused) return { why: (a.refused.error && a.refused.error.message) || 'Could not add them.' };
    if (a.exists) return { why: d.name + ' is already on your ' + d.side + ' list.' };
    return { id: a.customer_list_id };
  }
  const local = await L.mint(entity, d.name, { query: h.query.bind(h), kind: 'sup' });
  if (local.error) return { why: (local.error && local.error.message) || 'Could not add them.' };
  if (d.phone || d.gstin || d.email) await h.query(`UPDATE identities SET otp_contact = COALESCE(otp_contact, $2), gstn = COALESCE(gstn, $3), email = COALESCE(email, $4) WHERE identity_id = $1 AND parent_entity_id = $5`, [local.identity_id, d.phone || null, d.gstin || null, d.email || null, entity]);
  const id = await ins(d.side, local.identity_id);
  if (!id) return { why: d.name + ' is already on your ' + d.side + ' list.' };
  if (bare) await require('../db').trySavepoint(h, () => PF.ensureNo(h, entity, local.identity_id), null);
  return { id };
}
async function apply(h, entity, pl, ctx) {
  const S = require('./books-store'), B = require('./books'), schema = require('./schema');
  const k = pl.kind, by = ctx.by || null, out = { kind: k, source: pl.source, added: 0, merged: 0, skipped: 0, rows: [], notes: pl.notes || [] };
  const skipped = (r, why) => { out.skipped++; out.rows.push({ line: r.line, what: r.what, why: why || r.why }); };
  if (pl.refusal) throw refuse(pl.refusal);
  if (k === 'accounts') {
    const chart = ctx.world.chart, pre = { chart, setting: ctx.setting };
    out.source_code_written = await schema.hasColumn('ledger_account', 'source_code');
    for (const r of pl.rows) {
      if (r.action === 'skip') { skipped(r); continue; }
      if (r.action === 'merge') { if (r.data.source_code && out.source_code_written) await S.setSourceCode(h, entity, r.data.account_id, r.data.source_code); out.merged++; continue; }
      try { await B.addAccount(h, entity, { name: r.data.name, parent_id: r.data.group_id, source_code: r.data.source_code, by }, pre); out.added++; }
      catch (e) { if (e && (e.refused || e.status === 409 || e.status === 422)) skipped(r, e.message); else throw e; }
    }
    if (!out.source_code_written && pl.rows.some((r) => r.action !== 'skip' && r.data && r.data.source_code)) out.notes = out.notes.concat(['Their account codes could not be kept yet (a database update, b302, is still to run) — a trial balance will match on names.']);
    return out;
  }
  if (k === 'contacts') {
    const L = require('./local-identity'), PF = require('./party-fields');
    const listId = new Map(); (ctx.world.listIds || []).forEach((x) => listId.set(x.side + '|' + String(x.party_id), x.id));
    /* the list rows, on the shop's own connection (h = the withEntity handle) — the same inserts POST /relationships/customers and /suppliers make */
    const ins = async (side, party_id) => {
      const r = side === 'customer'
        ? await h.query(`INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at) VALUES ($1, $2, 'entity', 'move_in', 0, NULL)
                         ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id AS id`, [entity, party_id])
        : await h.query(`INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via) VALUES ($1, $2, 'resale', 'move_in')
                         ON CONFLICT DO NOTHING RETURNING supplier_list_id AS id`, [entity, party_id]);
      return r.rows[0] ? r.rows[0].id : null;
    };
    const fields = (d, sets) => { const b = {}; if (sets.legal_name) b.legal_name = sets.legal_name; const t = []; if (sets.abn) t.push({ scheme: 'ABN', value: sets.abn }); if (sets.gstin) t.push({ scheme: 'GSTIN', value: sets.gstin }); if (t.length) b.tax_ids = t; return b; };
    for (const r of pl.rows) {
      if (r.action === 'skip') { skipped(r); continue; }
      const d = r.data;
      try {
        if (r.action === 'merge') {
          let id = listId.get(d.side + '|' + String(d.party_id));
          if (d.sets.list) { id = await ins(d.side, d.party_id) || id; if (id) listId.set(d.side + '|' + String(d.party_id), id); }
          if (d.sets.phone || d.sets.gstin) await h.query(`UPDATE identities SET otp_contact = COALESCE(otp_contact, $2), gstn = COALESCE(gstn, $3) WHERE identity_id = $1 AND parent_entity_id = $4`, [d.party_id, d.sets.phone || null, d.sets.gstin || null, entity]);
          const b = fields(d, d.sets);
          if (id && Object.keys(b).length) await PF.patch(h, entity, d.side, id, b, by);
          out.merged++; continue;
        }
        const b = fields(d, { legal_name: d.legal_name, abn: d.abn, gstin: d.gstin });
        const got = await addNew_(h, entity, d, !Object.keys(b).length, ins);
        if (got.why) { skipped(r, got.why); continue; }
        const id = got.id;
        if (Object.keys(b).length) await PF.patch(h, entity, d.side, id, b, by);
        out.added++;
      } catch (e) { if (e && (e.status === 409 || e.status === 400 || e.status === 422 || e.refused)) skipped(r, e.message); else throw e; }
    }
    return out;
  }
  if (k === 'items') {
    const catwrite = require('./catalogue-write'), IC = require('./item-cost');
    const adds = pl.rows.filter((r) => r.action === 'add');
    pl.rows.filter((r) => r.action === 'skip').forEach((r) => skipped(r));
    if (adds.length) {
      const items = adds.map((r) => { const x = r.data.rec, it = { name: x.name, unit: x.unit, price: x.price, source_system: x.source_system }; if (x.code) { it.code = x.code; it.source_ref = x.source_ref; } if (x.gst_rate != null) it.gst_rate = x.gst_rate; if (x.description) it.desc = x.description; if (x.cost != null) Object.assign(it, IC.setCost(x.cost, pl.source, 'moved in from ' + SOURCE_WORD[pl.source])); return it; });
      const w = await catwrite.writeItems({ entity_id: entity, items });
      if (!w.ok) throw refuse('Nothing was imported — ' + (w.message || w.error || 'the catalogue refused the file') + (w.invalid ? ' (' + JSON.stringify(w.invalid).slice(0, 200) + ')' : ''));
      out.added = (w.rows || []).length;
    }
    return out;
  }
  /* the trial balance and the open bills: ONE opening entry each, through the same door POST /opening uses */
  const adds = pl.rows.filter((r) => r.action === 'add');
  pl.rows.filter((r) => r.action === 'skip').forEach((r) => skipped(r));
  if (!adds.length) throw refuse('Nothing to post: every row was skipped — read the reasons beside them.');
  const rows = adds.map((r) => (k === 'trial_balance' ? { code: r.data.code, dr_minor: r.data.dr_minor, cr_minor: r.data.cr_minor } : { code: r.data.code, party_id: r.data.party_id, bill_ref: r.data.bill_ref, due_date: r.data.due_date, dr_minor: r.data.dr_minor, cr_minor: r.data.cr_minor }));
  const tag = k === 'trial_balance' ? 'tb' : (pl.side || 'receivable');
  const r = await B.postOpening(h, entity, { rows, date: ctx.as_at, currency: ctx.currency, client_ref: ctx.client_ref || ('movein:' + tag + ':' + ctx.as_at), by,
    narration: 'Opening balances moved in from ' + SOURCE_WORD[pl.source] + (k === 'trial_balance' ? ' (trial balance as at ' + ctx.as_at + ')' : ' (open ' + (tag === 'payable' ? 'bills' : 'invoices') + ' as at ' + ctx.as_at + ')') }, { parties: ctx.world.parties, chart: ctx.world.chart });
  out.added = r.duplicate ? 0 : adds.length;
  out.entry = { entry_no: r.entry_no || null, entry_id: r.entry_id || null, posting_date: r.posting_date || null, suspense_minor: r.suspense_minor == null ? null : r.suspense_minor, duplicate: !!r.duplicate };
  if (r.duplicate) out.notes = out.notes.concat(['This file was already moved in as ' + (r.entry_no || 'an earlier entry') + ' — nothing was posted twice.']);
  return out;
}

/** the skipped rows as a .csv a person downloads (line · what · why) */
function skippedCsv(rows) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return ['line,what,why'].concat((rows || []).map((r) => [r.line, r.what, r.why].map(q).join(','))).join('\n') + '\n';
}

module.exports = { KINDS, KIND_KEYS, SOURCES, MAX_ROWS, NAME_ROLES, readFile, guess, cells, plan, world, apply, skippedCsv, toMinor, isoDate, moneyWords, kindOf, sourceOf, chartIndex, accountCode };
