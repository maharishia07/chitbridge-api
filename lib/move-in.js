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
 * OWNS      the move-in readers, the column guess, plan() and apply(); a cell's figure → minor units (toMinor: the loose reading here, the conversion books-cashflow's).
 * FLOW      readFile ──▶ guess ──▶ plan (pure) ──▶ apply (one transaction: addAccount · postOpening · party-fields.patch · writeItems)
 * CALLED BY routes/books.js (POST /api/books/move-in/preview · /move-in/import) · lib/parallel-run.js (the same readers for a compare)
 * CARD 14-accounting/move-in-from-xero-quickbooks
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1 — nothing here computes money or tax of its own) ──────────────────────────────────────────────────
 *   the country gate    lib/move-in-gate (engines country.moveInFor · fingerprint, v1.67.0): the SHOP's pack and ITS map only — else the whole file is refused (W1.1)
 *   the mapping table   the shop's pack's `moveIn` (only AU's today, engines reg-au v1.38.0): THEIR account type → OUR group · their control account → our role ledger ·
 *                       their tax code → the pack's supplyKinds (the rate comes from the kind row, never from a name)
 *   the chart           lib/books addAccount (the system gives the code; `source_code` keeps theirs, b302) · books-store accounts / setSourceCode
 *   the opening entry   lib/books postOpening — the SAME door POST /api/books/opening uses; the difference lands on Suspense 2900 (the posting engine's rule)
 *   parties             lib/local-identity mint (the one mint) · party-fields patch (legal name, the tax ID — its check is the pack's, country.taxId) · rewards.holderOf (the phone, as L3)
 *   the proof           lib/move-in-proof build + store (b765): held rows with their code, the source country, their company id (W1.10 · W1.4)
 *   products            lib/catalogue-write writeItems (the one product writer; the item shape is the connector kit's syncProducts shape) · item-cost setCost
 *   money               money.round + money.decimals → minor units; csv-preflight looseNumber reads "$1,234.50"
 *
 * ── WHAT IT REFUSES (never guesses) ───────────────────────────────────────────────────────────────────────────────────────────────────
 *   books from another country (MOVE_IN_COUNTRY …, the whole file) · a type with no home · a tax code the pack does not know (the item / document is HELD,
 *   code tax_code — never 0 %) · an unknown unit (HELD, unit) · a bad tax ID · a trial balance whose
 *   debits and credits differ (the whole file, in words) · a party or ledger the file names and the shop does not have · a code another ledger holds.
 *   The debtors / creditors CONTROL totals of a trial balance are NOT posted (they arrive bill-wise from the aged file); Suspense shows the gap until then.
 */
const { waiting } = require('./not-migrated');
const P = require('./csv-preflight');
const log = require('./logger');
const CSV = require('./csv');
const xlsxRead = require('./xlsx-read');
const M = require('./money');

const MAX_ROWS = 2000; /* the catalogue import's own ceiling; said when it bites */
const XLSX_MAX = 4 * 1024 * 1024;
const SOURCES = ['xero', 'qbo'];
const SOURCE_WORD = { xero: 'Xero', qbo: 'QuickBooks' };
/* the provenance a moved-in party carries on customer_list / supplier_list. ⚠️ ONE of the values the added_via CHECKs allow (b227 · b297):
   'move_in' was refused by every real database (QM-1, 17 Oct) while the stub-DB test stayed green. tests/move-in-added-via.test.cjs reads the
   allowed sets FROM the migrations and holds this to them. */
const ADDED_VIA = 'import';

function refuse(why, code, status) {
  const e = new Error(why);
  e.refused = true;
  e.code = code || 'BOOKS_REFUSED';
  if (status) e.status = status;
  return e;
}
function bad(why) {
  return refuse(why, 'BOOKS_BAD_REQUEST');
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const low = (s) =>
  String(s == null ? '' : s)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const up = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
const txt = (v, n) => {
  const s = String(v == null ? '' : v)
    .trim()
    .replace(/\s+/g, ' ');
  return n ? s.slice(0, n) : s;
};

/* ═══ 2 · the columns: what each export is asked for, and what a real export calls it (IM0 §1.2–1.6, §2.1–2.6 — recall, confirmed by the person) ═══ */
const KINDS = {
  accounts: {
    label: 'Chart of accounts',
    fields: [
      { key: 'code', label: 'Their code', req: false, syn: ['code', 'account code', 'account number', 'acct num', 'acctnum', 'number', 'account no', 'no'] },
      { key: 'name', label: 'Account name', req: true, syn: ['name', 'account name', 'account', 'fully qualified name', 'full name'] },
      { key: 'type', label: 'Account type', req: true, syn: ['type', 'account type', 'class', 'classification'] },
      { key: 'system', label: 'System account', req: false, syn: ['system account', 'systemaccount', 'system'] },
      { key: 'tax_code', label: 'Default tax', req: false, syn: ['tax code', 'tax type', 'default tax', 'default tax code', 'tax rate', 'gst code', 'tax'] },
      { key: 'description', label: 'Description', req: false, syn: ['description', 'desc', 'memo'] }
    ]
  },
  contacts: {
    label: 'Contacts',
    fields: [
      {
        key: 'name',
        label: 'Name',
        req: true,
        syn: ['contact name', 'contactname', 'name', 'customer', 'supplier', 'vendor', 'display name', 'customer full name', 'full name', 'contact']
      },
      { key: 'legal_name', label: 'Legal name', req: false, syn: ['legal name', 'legalname', 'company', 'company name', 'business name', 'trading name'] },
      { key: 'email', label: 'Email', req: false, syn: ['email address', 'emailaddress', 'email', 'e mail', 'primary email'] },
      {
        key: 'phone',
        label: 'Phone',
        req: false,
        syn: ['phone number', 'phonenumber', 'phone', 'mobile number', 'mobilenumber', 'mobile', 'telephone', 'primary phone']
      },
      {
        key: 'abn',
        label: 'ABN',
        req: false,
        syn: ['abn', 'tax number', 'taxnumber', 'abn number', 'business number', 'tax reg number', 'tax id', 'tax identifier', 'primary tax identifier']
      },
      { key: 'gstin', label: 'GSTIN', req: false, syn: ['gstin', 'gst number', 'gst no', 'gst registration'] },
      {
        key: 'source_ref',
        label: 'Their contact id',
        req: false,
        syn: ['contact id', 'contactid', 'customer id', 'vendor id', 'supplier id']
      } /* W1.8: kept on the party */
    ]
  },
  items: {
    label: 'Items',
    fields: [
      { key: 'code', label: 'Code', req: false, syn: ['item code', 'itemcode', 'code', 'sku', 'product code', 'item no', 'item id'] },
      {
        key: 'name',
        label: 'Name',
        req: true,
        syn: ['item name', 'itemname', 'name', 'product/service', 'product service', 'product', 'service', 'item', 'product name']
      },
      {
        key: 'description',
        label: 'Description',
        req: false,
        syn: ['sales description', 'salesdescription', 'description', 'memo/description', 'memo description', 'desc']
      },
      {
        key: 'sales_price',
        label: 'Sales price',
        req: false,
        syn: ['sales unit price', 'salesunitprice', 'sales price', 'unit price', 'price', 'rate', 'sell price', 'selling price', 'price/rate', 'price rate']
      },
      {
        key: 'purchase_price',
        label: 'Purchase price',
        req: false,
        syn: ['purchases unit price', 'purchasesunitprice', 'purchase unit price', 'purchase price', 'purchase cost', 'cost', 'cost price', 'buy price']
      },
      {
        key: 'sales_tax',
        label: 'Sales tax code',
        req: false,
        syn: ['sales tax rate', 'salestaxrate', 'sales tax code', 'sales tax', 'tax code', 'tax rate', 'tax', 'gst', 'sales tax code ref']
      },
      {
        key: 'purchase_tax',
        label: 'Purchase tax code',
        req: false,
        syn: ['purchases tax rate', 'purchasestaxrate', 'purchase tax rate', 'purchase tax code', 'purchase tax', 'purchase tax code ref']
      },
      {
        key: 'unit',
        label: 'Unit',
        req: false,
        syn: ['unit', 'units', 'unit of measure', 'uom', 'usage unit']
      } /* W1.7: mapped to our units; an unknown one is held */,
      {
        key: 'hsn',
        label: 'HSN / SAC',
        req: false,
        syn: ['hsn', 'hsn/sac', 'hsn sac', 'hsn code', 'sac', 'sac code', 'hsn or sac']
      } /* W1.11: read only to HOLD a taxed item when the pack has no map; not kept */
    ]
  },
  trial_balance: {
    label: 'Trial balance',
    fields: [
      { key: 'account', label: 'Account', req: true, syn: ['account', 'account name', 'name', 'ledger', 'description'] },
      { key: 'code', label: 'Their code', req: false, syn: ['code', 'account code', 'account number', 'acct num', 'number', 'account no', 'no'] },
      { key: 'debit', label: 'Debit', req: true, syn: ['debit', 'dr', 'debit amount', 'debits'] },
      { key: 'credit', label: 'Credit', req: true, syn: ['credit', 'cr', 'credit amount', 'credits'] }
    ]
  },
  open_bills: {
    label: 'Open invoices and bills',
    fields: [
      {
        key: 'contact',
        label: 'Contact',
        req: true,
        syn: ['contact name', 'contactname', 'contact', 'customer', 'supplier', 'vendor', 'name', 'customer name', 'supplier name']
      },
      {
        key: 'invoice_no',
        label: 'Invoice number',
        req: true,
        syn: ['invoice number', 'invoicenumber', 'invoice no', 'num', 'number', 'doc number', 'docnumber', 'bill number', 'reference', 'no']
      },
      { key: 'date', label: 'Date', req: false, syn: ['invoice date', 'invoicedate', 'date', 'txn date', 'transaction date', 'bill date'] },
      { key: 'due_date', label: 'Due date', req: false, syn: ['due date', 'duedate', 'due'] },
      {
        key: 'amount_due',
        label: 'Amount still owed',
        req: true,
        syn: [
          'invoice amount due',
          'invoiceamountdue',
          'amount due',
          'open balance',
          'balance',
          'outstanding',
          'amount outstanding',
          'amount owing',
          'owing',
          'remaining'
        ]
      },
      { key: 'total', label: 'Total', req: false, syn: ['total', 'amount', 'invoice total', 'total amt'] },
      {
        key: 'contact_ref',
        label: 'Their contact id',
        req: false,
        syn: ['contact id', 'contactid', 'customer id', 'vendor id', 'supplier id']
      } /* W1.8: matched first */,
      { key: 'tax_codes', label: 'Tax codes on its lines', req: false, syn: ['tax codes', 'line tax codes'] } /* W1.2: a code our pack does not know → held */,
      {
        key: 'currency',
        label: 'Currency',
        req: false,
        syn: ['currency', 'currency code', 'currencycode', 'curr']
      } /* ACC-241: a row in a currency other than the shop's is HELD (guessed wording, Xero API CurrencyCode) */,
      {
        key: 'currency_rate',
        label: 'Their exchange rate',
        req: false,
        syn: ['currency rate', 'currencyrate', 'exchange rate', 'rate']
      } /* ACC-241: shown as a proposal on a held row, never applied unasked (the direction is the person's word) */,
      {
        key: 'doc_type',
        label: 'Type',
        req: false,
        syn: ['type', 'invoice type', 'document type', 'doc type']
      } /* ACC-244: ACCRECCREDIT / ACCPAYCREDIT = a credit note (guessed CSV wording; an unknown Type is HELD) */
    ]
  }
};
const KIND_KEYS = Object.keys(KINDS);
function kindOf(k) {
  const s = String(k == null ? '' : k)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (!own(KINDS, s)) throw bad('Which file is this — ' + KIND_KEYS.join(', ') + '?');
  return s;
}
function sourceOf(s) {
  const k = String(s == null ? '' : s)
    .trim()
    .toLowerCase();
  if (SOURCES.indexOf(k) < 0) throw bad('Which system is it from — xero or qbo?');
  return k;
}
const squash = (s) => P.normalise(s).replace(/\s+/g, '');

/* ═══ 1 · the file, as { headers, rows } — the two readers the catalogue import already uses ═══ */
function readFile(b) {
  const body = b || {};
  if (typeof body.xlsx === 'string' && body.xlsx.trim()) {
    let buf = null;
    try {
      buf = Buffer.from(body.xlsx, 'base64');
    } catch (e) {
      log.fellBack('move-in readFile: did not parse — answered with nothing', e, 'debug');
      buf = null;
    }
    if (!buf || !buf.length) throw bad('That file could not be read.');
    if (buf.length > XLSX_MAX) throw bad('That workbook is ' + Math.round(buf.length / 1048576) + ' MB — send just the sheet with the export on it.');
    try {
      return xlsxRead.sheetRows(buf, { sheet: body.sheet || null, headerRow: body.header_row });
    } catch (e) {
      throw bad(e.userMessage || String(e.message));
    }
  }
  const text = String(body.csv || '');
  if (!text.trim()) throw bad('The file is empty.');
  const want = Number(body.header_row);
  if (Number.isInteger(want) && want > 1) {
    /* "my headings are on row N" (a report export opens with the shop's name): the SAME parser, run positionally — a synthetic wide header keeps every cell
       of every row (the title row is narrower than the table, and parseCSV keys cells by the first row), then row N becomes the headings */
    const WIDE = 64,
      cols = Array.from({ length: WIDE }, (_, i) => 'c' + i);
    const kept = text
      .split(/\r?\n/)
      .map((item) => (item.trim() === '' ? ',' : item))
      .join('\n'); /* a blank line stays a row, so row N is the row a person counts */
    const raw = CSV.parseCSV(cols.join(',') + '\n' + kept).rows;
    const at = want - 1;
    if (at < 0 || at >= raw.length) throw bad('Row ' + want + ' is past the end of that file — it has ' + raw.length + ' rows.');
    const heads = cols.map((item) => txt(raw[at][item]));
    while (heads.length && !heads[heads.length - 1]) heads.pop();
    const seen = new Map();
    const headers = heads.map((item, index) => {
      let n = item || 'Column ' + String.fromCharCode(65 + (index % 26));
      if (seen.has(n)) {
        const k = seen.get(n) + 1;
        seen.set(n, k);
        n = n + ' (' + k + ')';
      } else seen.set(n, 1);
      return n;
    });
    const rows = raw
      .slice(at + 1)
      .map((item) => {
        const o = {};
        headers.forEach((h, index) => {
          o[h] = item[cols[index]] == null ? '' : item[cols[index]];
        });
        return o;
      })
      .filter((item) => headers.some((h) => String(item[h]).trim() !== ''));
    return { headers, rows, headerRow: want };
  }
  return Object.assign({}, CSV.parseCSV(text), { headerRow: 1 });
}

/* ═══ 2 · the guess: each header → a field, with how sure and why; the person confirms ═══ */
/** `table` (optional, PR1): another import's own { kind: { label, fields } } — the parallel-run compare guesses ITS columns with this same matcher */
function guess(kind, headers, table) {
  const K = table ? table[kind] : KINDS[kindOf(kind)],
    fields = K.fields,
    taken = new Set(),
    out = [];
  const bySquash = new Map();
  fields.forEach((item) =>
    item.syn.forEach((s) => {
      const k = squash(s);
      if (!bySquash.has(k)) bySquash.set(k, item.key);
    })
  );
  /* pass 1 — a name the export is known to use (IM0's recall list, the first match per field wins; "*Code" and "ItemCode" both land) */
  const guessed = headers.map((item) => {
    const n = squash(String(item).replace(/^\*/, ''));
    const f = n && bySquash.get(n);
    if (f && !taken.has(f)) {
      taken.add(f);
      return {
        incoming: item,
        field: f,
        how: 'known',
        confidence: 1,
        why: '"' + item + '" is what ' + K.label.toLowerCase() + ' exports call ' + labelOf(fields, f).toLowerCase()
      };
    }
    return null;
  });
  /* pass 2 — csv-preflight's own matcher for the rest (exact on the key or label, else similarity — reported as a guess to confirm, never acted on alone) */
  const accepted = fields.map((item) => item.key).filter((item) => !taken.has(item));
  const labels = {};
  fields.forEach((item) => {
    labels[item.key] = item.label;
  });
  headers.forEach((item, index) => {
    if (guessed[index]) {
      out.push(guessed[index]);
      return;
    }
    const m = accepted.length
      ? P.matchHeader(String(item).replace(/^\*/, ''), accepted, labels)
      : { canonical: null, how: 'unmatched', confidence: 0, why: 'every column is already placed' };
    if (m.canonical && !taken.has(m.canonical) && m.how !== 'blocked') {
      taken.add(m.canonical);
      out.push({ incoming: item, field: m.canonical, how: m.how, confidence: m.confidence, why: m.why });
    } else
      out.push({
        incoming: item,
        field: null,
        how: 'unmatched',
        confidence: 0,
        why: m.how === 'blocked' ? m.why : 'not one of the columns this import reads — ignored unless you pick a field'
      });
  });
  const missing = fields.filter((item) => item.req && !taken.has(item.key)).map((item) => item.key);
  return {
    fields: fields.map((item) => ({ key: item.key, label: item.label, required: !!item.req })),
    guess: out,
    missing,
    ready: missing.length === 0 && out.every((item) => !item.field || item.how === 'known' || item.how === 'exact')
  };
}
function labelOf(fields, key) {
  const f = fields.find((x) => x.key === key);
  return f ? f.label : key;
}

/** the confirmed columns → rows keyed by field, each with the line a person sees (header = 1). A column with no decision is not read. */
function cells(kind, parsed, decisions, table) {
  const K = table ? table[kind] : KINDS[kindOf(kind)],
    keys = new Set(K.fields.map((item) => item.key));
  const d = Array.isArray(decisions) ? decisions : [];
  const map = new Map();
  for (const x of d) {
    if (!x || !x.field || x.action === 'ignore') continue;
    if (!keys.has(x.field)) throw bad('"' + x.incoming + '" cannot be read as ' + x.field + ' — this import has no such column.');
    if (parsed.headers.indexOf(x.incoming) < 0) throw bad('The file has no column called "' + x.incoming + '".');
    if (map.has(x.field)) throw bad('Both "' + map.get(x.field) + '" and "' + x.incoming + '" were picked as ' + labelOf(K.fields, x.field) + '. Pick one.');
    map.set(x.field, x.incoming);
  }
  const missing = K.fields.filter((item) => item.req && !map.has(item.key));
  if (missing.length) throw bad('Pick the column for ' + missing.map((item) => item.label).join(', ') + ' first.');
  if (parsed.rows.length > MAX_ROWS)
    throw bad('This file has ' + parsed.rows.length + ' rows and one import can carry ' + MAX_ROWS + '. Nothing was imported — split the file.');
  const rows = parsed.rows.map((item, index) => {
    const o = { line: index + 2 };
    map.forEach((h, position) => {
      o[position] = item[h] == null ? '' : String(item[h]);
    });
    return o;
  });
  return attachAnswers_(rows, d, table ? null : kindOf(kind));
}
const ANSWER_KIND = { home_amount: 'open_bills', confirm_rate: 'open_bills', merge: 'accounts' };
/** a person's answer to one row (ACC-241 home_amount / confirm_rate on a held open item; ACC-231 merge on an account), bound to its LINE and its REFERENCE (the
 *  invoice number, their account code): an edited or re-uploaded file cannot send it to another row; one that finds no row, or the wrong reference, is REFUSED */
function attachAnswers_(rows, decisions, kind) {
  decisions
    .filter((entry) => entry && !entry.field && entry.line != null && entry.action !== 'ignore')
    .forEach((given) => {
      const row = rows.find((x) => x.line === Number(given.line));
      answerRefused_(row, given, kind);
      row.answer = { action: String(given.action), ref: txt(given.ref), value: given.value, per: given.per, code: given.code };
    });
  return rows;
}
/** the refusals for one answer, each in words: not for this file · no such line · twice · no reference */
function answerRefused_(row, given, kind) {
  const line = 'Line ' + given.line;
  if (ANSWER_KIND[given.action] !== kind) throw bad('"' + given.action + '" is not an answer for this file. Nothing was imported.');
  if (!row) throw bad(line + ' is not in this file — the answer for it was not used. Nothing was imported.');
  if (row.answer) throw bad(line + ' was answered twice. Nothing was imported.');
  if (!txt(given.ref)) throw bad('The answer for ' + line.toLowerCase() + ' must name its reference (the invoice number or their account code), so it cannot land on another row.');
}

/* ═══ money and dates, through the one rounder ═══ */
/** a cell's figure → minor units (null when the cell holds no number): the loose reading is the importer's, the conversion the api's ONE (books-cashflow.toMinor, ACC-179 fold) */
function toMinor(v, cur) {
  const n = P.looseNumber(v);
  return n.value === null ? null : require('./books-cashflow').toMinor(n.value, cur);
}
function moneyWords(minor, cur) {
  const d = M.decimals ? M.decimals(cur) : 2,
    n = Number(minor || 0) / Math.pow(10, d);
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(n);
  } catch (_) {
    return cur + ' ' + n.toFixed(d);
  }
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** a date as an export writes it — 2026-07-01 · 01/07/2026 (AU: day first) · 1 Jul 2026 · 2026-07-01T00:00:00 — to YYYY-MM-DD, or null (said, never guessed from a bare number) */
function isoDate(v) {
  const s = txt(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return check_(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return check_(m[3], m[2], m[1]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,4})[ -](\d{4})$/.exec(s);
  if (m && MON[m[2].toLowerCase()]) return check_(m[3], MON[m[2].toLowerCase()], m[1]);
  m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MON[m[1].slice(0, 3).toLowerCase()]) return check_(m[3], MON[m[1].slice(0, 3).toLowerCase()], m[2]);
  return null;
}
function check_(y, mo, d) {
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/* ═══ 3 · THE DRY RUN — pure. in: { kind, source, rows (cells), world, side?, as_at?, currency } → { rows: [{ line, what, action, why, data }], counts, refusal, notes } ═══ */
/**
 * ⭐ W1.1 THE COUNTRY GATE FIRST (DECISIONS 2026-10-18:62): the SHOP's country (inp.country, else world.setting.country — never a pack's id) through
 * lib/move-in-gate; a refusal throws before a row is read. The planners are handed THAT pack's own map (`map`) and pack — never reg-au by name.
 * inp: { source, source_country, country_how, source_company, country?, rows, world, side?, as_at?, currency }
 */
function plan(kind, inp) {
  const kindKey = kindOf(kind),
    src = sourceOf(inp.source),
    Gate = Gate_(),
    shopWorld = inp.world || {};
  const rules = Gate.gate({
    kind: kindKey,
    country: inp.country || (shopWorld.setting && shopWorld.setting.country) || null,
    source_country: inp.source_country,
    country_how: inp.country_how
  });
  const companyId = Gate.company(inp.source_company, shopWorld.companies);
  Gate.foreign(rules, kindKey, src, inp.rows);
  const out = PLANNERS[kindKey](Object.assign({}, inp, { source: src, map: rules.map, pack: rules.pack }));
  const counts = { add: 0, merge: 0, skip: 0, hold: 0 };
  out.rows.forEach((row) => {
    counts[row.action] = (counts[row.action] || 0) + 1;
  });
  return Object.assign(
    {
      kind: kindKey,
      source: src,
      counts,
      refusal: null,
      notes: [],
      country: { shop: rules.id, source: rules.source_country, how: rules.country_how },
      company_id: companyId
    },
    out
  );
}
/** the country gate, loaded when asked (it reads the engines registry) */
const Gate_ = () => require('./move-in-gate');
const row_ = (line, what, action, why, data) => ({ line, what: what || '', action, why, data: data || null });
/** a HELD row (W1.10): nothing is written; the code says which rule held it (move-in-proof HOLD_CODES) and the sentence what to do */
const hold_ = (line, what, code, sentence, data) => Object.assign(row_(line, what, 'hold', sentence, data), { code });
/** the tax codes a file names, each once, with what the pack's map makes of it → [{ code, verdict: maps · no_tax · held, kind, rate }] */
function taxCodesSeen(map, source, codes) {
  const seen = new Map();
  for (const given of codes) {
    const code = txt(given);
    if (!code || seen.has(up(code))) continue;
    const supply = map.supplyKindFor(source, code);
    seen.set(up(code), {
      code,
      verdict: supply ? 'maps' : supply === null ? 'no_tax' : 'held',
      kind: supply ? supply.name : null,
      rate: supply ? supply.rate : supply === null ? 0 : null
    });
  }
  return Array.from(seen.values());
}

/** the chart, read once, indexed: groups by pack key · ledgers by role · by their code · by name */
function chartIndex(nestedWorld) {
  const E = require('./books-engines');
  const chart = nestedWorld.chart || [],
    pack = nestedWorld.pack || {};
  const groupRows = new Map();
  (pack.groups || []).forEach((item) => {
    const row = chart.find((a) => a.is_group && String(a.code) === E.groupCode(item));
    if (row) groupRows.set(item.code, row);
  });
  const byRole = new Map(),
    bySource = new Map(),
    byName = new Map();
  chart.forEach((item) => {
    if (item.role) byRole.set(item.role, item);
    if (item.source_code) bySource.set(up(item.source_code), item);
    if (!item.is_group) byName.set(low(item.name), item);
  });
  return { chart, pack, groupRows, byRole, bySource, byName };
}

/** a trial-balance row's account and code: Xero writes the row as "Sales (200)" — the code is split off when the file has no code column (the compare reads it too) */
function accountCode(acc, cod) {
  let account = txt(acc, 150),
    code = txt(cod, 20);
  const m = /^(.*?)\s*\((\w[\w-]*)\)\s*$/.exec(account);
  if (m && !code) {
    account = txt(m[1]);
    code = m[2];
  }
  return { account, code };
}
/** the names Xero / QBO give their control accounts when the file has no system-account column; the dry run names the ledger it lands on */
const NAME_ROLES = {
  'accounts receivable': 'debtors',
  'trade debtors': 'debtors',
  'accounts receivable (a/r)': 'debtors',
  'accounts payable': 'creditors',
  'trade creditors': 'creditors',
  'accounts payable (a/p)': 'creditors',
  'gst': 'gst_collected',
  'gst payable': 'gst_collected'
};
/* ── the CONTACTS planner's steps (W1.3 the tax ID by the pack · W1.8 their contact id first) ── */
/** the shop's pack's tax ID: its word (ABN · TRN · UEN …) and its check (engines country.taxId — never reg-au by name). India's check is null in the
 *  registry: a GSTIN rides in the gstin column (profile-map.gstinChecksum) and party-fields checks its scheme at the write. */
function taxIdOf_(pack) {
  const rule = require('./country').taxId(pack);
  return { word: rule.word || 'Tax ID', check: rule.check };
}
const idKey_ = (value) => up(value).replace(/\s+/g, '');
/** the phone kept from a contact row, or null with a note why not */
function contactPhone_(row, notes) {
  if (!txt(row.phone)) return null;
  const holder = require('./rewards').holderOf({ phone: row.phone });
  if (holder && holder.scheme === 'phone') return holder.value;
  notes.push('phone "' + txt(row.phone) + '" is too short to keep');
  return null;
}
/** the tax ID by the pack's own check → { taxId } or { why } (the row is skipped) */
function contactTaxId_(row, rule) {
  const given = txt(row.abn);
  if (!given) return { taxId: null };
  if (!rule.check) return { taxId: idKey_(given) };
  const checked = rule.check(given);
  return checked.ok ? { taxId: idKey_(checked.value) } : { why: rule.word + ' ' + given + ': ' + checked.why };
}
/** one contact row read: name · phone · the tax ID by the pack · GSTIN · legal name · e-mail · their id → the row's facts, or { why } (skipped) */
function contactRow_(row, pack) {
  const rule = taxIdOf_(pack),
    name = txt(row.name, 120),
    notes = [];
  if (!name) return { name, why: 'No name.' };
  if (name.indexOf('@') >= 0) return { name, why: 'The name looks like an email — put the email in its own column.' };
  const phone = contactPhone_(row, notes),
    taxRead = contactTaxId_(row, rule);
  if (taxRead.why) return { name, why: taxRead.why };
  const gstin = txt(row.gstin) ? idKey_(row.gstin) : null;
  if (gstin && !require('./profile-map').gstinChecksum(gstin).ok) return { name, why: 'GSTIN ' + gstin + ' does not check out.' };
  return {
    name,
    phone,
    taxId: taxRead.taxId,
    word: rule.word,
    gstin,
    legal: txt(row.legal_name, 200) || null,
    email: txt(row.email, 200) || null,
    ref: txt(row.source_ref, 80) || null,
    notes
  };
}
/** who the shop already has, indexed once: by name on this list / the other, by tax ID (the pack's scheme), by phone, by THEIR id (source pair) */
function contactIndex_(shopWorld, side, source, word) {
  const parties = shopWorld.parties || [],
    byName = new Map(),
    byNameOther = new Map(),
    pById = new Map(),
    legalOf = new Map();
  parties.forEach((item) => {
    (item[side] ? byName : byNameOther).set(low(item.name), item);
    pById.set(String(item.party_id), item);
    legalOf.set(String(item.party_id), item.legal_name || null);
  });
  const byTax = new Map();
  (shopWorld.taxIds || []).forEach((entry) => {
    if (up(entry.scheme) === up(word)) byTax.set(idKey_(entry.value), entry.party_id);
  });
  const byPhone = new Map();
  (shopWorld.phones || []).forEach((x) => {
    if (x.phone) byPhone.set(String(x.phone), x.party_id);
  });
  const bySrc = new Map(),
    srcOf = new Map();
  (shopWorld.sourceRefs || []).forEach((x) => {
    if (x.source_system === source && x.source_ref) bySrc.set(String(x.source_ref), x.party_id);
    srcOf.set(String(x.party_id) + '|' + x.side, x.source_ref || null);
  });
  return { byName, byNameOther, pById, legalOf, byTax, byPhone, bySrc, srcOf };
}
/** the same name / tax ID / phone earlier in this file → its sentence, or null */
function seenAlready_(seen, contact) {
  if (seen.name.has(low(contact.name))) return '"' + contact.name + '" is already on line ' + seen.name.get(low(contact.name)) + ' of this file.';
  if (contact.taxId && seen.tax.has(contact.taxId))
    return contact.word + ' ' + contact.taxId + ' is already on line ' + seen.tax.get(contact.taxId) + ' of this file.';
  if (contact.phone && seen.phone.has(contact.phone))
    return 'Phone ' + contact.phone + ' is already on line ' + seen.phone.get(contact.phone) + ' of this file.';
  return null;
}
/** who is this already? THEIR id (W1.8), then the tax ID, then the phone (as L3's lead import), then the name on this list, then on the other */
function whoIs_(index, contact) {
  const viaRef = contact.ref ? index.bySrc.get(contact.ref) : null;
  if (viaRef && index.pById.has(String(viaRef))) return { hit: index.pById.get(String(viaRef)) };
  const viaTax = contact.taxId ? index.byTax.get(contact.taxId) : null,
    viaPhone = contact.phone ? index.byPhone.get(contact.phone) : null;
  const nameOf = (id) => (index.pById.get(String(id)) || {}).name;
  if (viaTax && viaPhone && viaTax !== viaPhone)
    return {
      why:
        contact.word +
        ' ' +
        contact.taxId +
        ' belongs to ' +
        nameOf(viaTax) +
        ' and phone ' +
        contact.phone +
        ' to ' +
        nameOf(viaPhone) +
        ' — merge them first.'
    };
  const hitId = viaTax || viaPhone || null;
  return { hit: hitId ? index.pById.get(String(hitId)) : index.byName.get(low(contact.name)) || index.byNameOther.get(low(contact.name)) || null };
}
/** the fields a merge fills on a party that is already here — only the empty ones */
function mergeSets_(index, party, side, contact) {
  const sets = {},
    partyKey = String(party.party_id);
  if (!party[side]) sets.list = side;
  if (contact.taxId && !index.byTax.has(contact.taxId)) Object.assign(sets, { abn: contact.taxId, tax_scheme: contact.word });
  if (contact.legal && !index.legalOf.get(partyKey)) sets.legal_name = contact.legal;
  if (contact.phone && !index.byPhone.has(contact.phone)) sets.phone = contact.phone;
  if (contact.gstin && !party.gstin) sets.gstin = contact.gstin;
  if (contact.ref && !index.srcOf.get(partyKey + '|' + side)) Object.assign(sets, { source_ref: contact.ref, source_system: contact.source });
  return sets;
}
/** what a merge adds, in words → { sets, words } */
function mergeWords_(index, party, side, contact) {
  const sets = mergeSets_(index, party, side, contact);
  const said = [
    ['list', 'added as a ' + side + ' too'],
    ['abn', contact.word + ' kept'],
    ['legal_name', 'legal name kept'],
    ['phone', 'phone kept'],
    ['gstin', 'GSTIN kept'],
    ['source_ref', 'their id kept']
  ];
  return { sets, words: said.filter((pair) => sets[pair[0]]).map((pair) => pair[1]) };
}

/* ── words from the shop's own pack (never "GST" or "Australia" typed) ── */
/** the tax's name in the pack's words (GST · VAT …) */
function taxWord_(pack) {
  const words = require('./country').meta(pack).words;
  return (words && words.taxName) || 'tax';
}
/** the country's name, for a sentence */
function countryName_(pack) {
  return require('./country-setup').nameOf(pack.id);
}

/* ── the ITEMS planner's steps (W1.2 the code inside the pack · W1.7 the unit kept) ── */
/** a row that cannot be read at all → its sentence, or null */
function itemRefusal_(row, name) {
  if (!name) return 'No item name.';
  if (txt(row.sales_price) && P.looseNumber(row.sales_price).value === null) return 'Sales price "' + txt(row.sales_price) + '" is not a number.';
  if (txt(row.purchase_price) && P.looseNumber(row.purchase_price).value === null) return 'Purchase price "' + txt(row.purchase_price) + '" is not a number.';
  return null;
}
/** their tax code through the pack's map → { rate, note } — rate undefined when the pack does not know the code (the item is HELD, never 0 %) */
function itemTax_(map, source, code, word) {
  const supply = map.supplyKindFor(source, code);
  if (supply) return { rate: supply.rate, note: txt(code) + ' = ' + supply.name + ' ' + supply.rate + '%' };
  if (supply === null) return { rate: 0, note: txt(code) + ' = no ' + word };
  return { rate: undefined, note: 'tax code "' + txt(code) + '" is not one this import knows' };
}
/** the holds an item meets before it lands → { hold: row } or { tax, unit }: W1.11 a taxed item while the pack has no map (the not-ready
 *  sentence) · W1.2 a tax code the pack does not know (never 0 %) · W1.7 a unit we do not have */
function itemHolds_(row, what, input, word) {
  const { map, source, pack } = input;
  if (!map && Gate_().taxBearing('items', row))
    return { hold: hold_(row.line, what, 'tax_code', Gate_().notReady(pack.id) + ' This item has tax on it, so it waits.') };
  const salesTax = txt(row.sales_tax) ? itemTax_(map, source, row.sales_tax, word) : null,
    unit = itemUnit_(row);
  if (salesTax && salesTax.rate === undefined)
    return {
      hold: hold_(
        row.line,
        what,
        'tax_code',
        'Tax code "' + txt(row.sales_tax) + '" is not one of ' + countryName_(pack) + "'s codes here — pick one of your own codes for it."
      )
    };
  if (unit.why) return { hold: hold_(row.line, what, 'unit', unit.why) };
  return { tax: salesTax, unit };
}
/** the tax codes an items file names, through the pack's map — none while the pack has no map (W1.11: every taxed item is held then) */
const itemCodes_ = (input) =>
  input.map ? taxCodesSeen(input.map, input.source, input.rows.map((x) => x.sales_tax).concat(input.rows.map((x) => x.purchase_tax))) : [];
/** their unit → one of our units (lib/units, the engine's names and aliases) — { unit, note } · blank: "unit" (their file has none) · unknown: { why } */
function itemUnit_(row) {
  const theirs = txt(row.unit, 40);
  if (!theirs) return { unit: 'unit', note: null };
  const ours = require('./units').unitOf(theirs);
  if (!ours) return { why: 'Their unit "' + theirs + '" is not one of ours — pick one of our units for it, then load it again.' };
  return { unit: ours, note: low(theirs) !== ours ? 'unit ' + theirs + ' = ' + ours : null };
}

/* ── ACC-231 · an account lands on the pack's ROLE ledger, not on a new twin of it ──────────────────────────────────────────────────────────────
 *  1 a control account or an exact same name (as before) · 2 a REVENUE account whose default tax code is a supply kind the pack has a ledger for
 *  (GST-free → sales_gst_free, input-taxed → sales_input_taxed): the posting engine's own rule, base + '_' + kind (engines posting.js kindBase_, v1.76.0;
 *  a local copy until the engines export lands, pinned by tests/acc-231-move-in-role-ledgers.test.cjs) · 3 an expense or bank account: a PREVIEW row with
 *  the pack's candidate ledgers and, when one name is plainly closer, a suggestion; the person's confirmed `merge` answer makes it a merge. */
const EXPENSE_GROUPS = ['operating_expenses', 'cost_of_sales'];
const SUGGEST_FLOOR = 0.5; /* a name this close (Dice on normalised bigrams) is suggested … */
const SUGGEST_MARGIN = 0.15; /* … only when it beats the next by this much; otherwise the list is shown with no pre-selection */
/** the ledger of this pack for a supply kind on the sales base, or null (taxable keeps the base: it has no ledger of its own) */
function kindLedger_(index, kind) {
  return kind && kind.id !== 'taxable' && kind.id !== 'standard' ? index.byRole.get('sales_' + kind.id) || null : null;
}
/** the pack's ledgers an account of this group could be: expense classes for an expense, the cash ledger for a bank account, export + GST-free for a GST-free export */
function accountCandidates_(ctx, group, row) {
  const { index, map, source } = ctx;
  let roles = [];
  if (EXPENSE_GROUPS.includes(group)) roles = (index.pack.expense_classes || []).map((item) => item.role);
  else if (group === 'bank_accounts') roles = ['cash'];
  else if (group === 'sales' && /EXPORT/.test(up(row.tax_code)) && map.supplyKindFor(source, row.tax_code)) roles = ['sales_export', 'sales_gst_free'];
  return roles.map((role) => index.byRole.get(role)).filter(Boolean);
}
/** the closest candidate by name when it is plainly the one (>= the floor AND the margin above the second), else null */
function suggestFrom_(name, candidates) {
  const mine = P.normalise(name),
    scored = candidates.map((item) => ({ item, score: P.similarity(mine, P.normalise(item.name)) })).sort((first, second) => second.score - first.score);
  const top = scored[0],
    next = scored[1];
  return top && top.score >= SUGGEST_FLOOR && (!next || top.score - next.score >= SUGGEST_MARGIN) ? top.item : null;
}
/** what an ADD row offers: { candidates, suggest, said } — a pre-selection is never applied */
function accountOffer_(ctx, row, name, type) {
  const group = ctx.map.groupFor(ctx.source, type),
    list = accountCandidates_(ctx, group, row);
  const pick = EXPENSE_GROUPS.includes(group) ? suggestFrom_(name, list) : null;
  return {
    candidates: list.map((item) => ({ code: item.code, name: item.name })),
    suggest: pick ? pick.code : null,
    said: pick ? ' Looks like your ' + pick.code + ' ' + pick.name + ' — confirm to use it, or it is added as its own ledger.' : ''
  };
}
/** the merge row for a ledger, said: keeps their code when the ledger has none; a second row onto one ledger is refused in words */
function mergeRow_(ctx, row, facts, target, reason) {
  const { srcWord, claimed } = ctx;
  claimed.set(target.account_id, row.line);
  const keeps = facts.code && !target.source_code ? facts.code : null;
  return row_(row.line, facts.what, 'merge', reason + (keeps ? ' — keeps ' + srcWord + ' code ' + keeps : '') + '.', {
    account_id: target.account_id,
    code: target.code,
    source_code: keeps,
    note: facts.taxNote
  });
}
/** the person's confirmed `merge` for this row: the ledger must be one of the offered candidates and no other row may have taken it */
function confirmedTarget_(ctx, row, facts) {
  const answer = row.answer;
  if (!answer || answer.action !== 'merge') return null;
  if (answer.ref !== (facts.code || facts.name)) throw bad('Line ' + row.line + ' is ' + (facts.code || facts.name) + ', not ' + answer.ref + ' — the file changed. Nothing was imported.');
  const offered = accountCandidates_(ctx, ctx.map.groupFor(ctx.source, facts.type), row),
    target = offered.find((item) => String(item.code) === String(answer.code));
  if (!target) throw bad('Line ' + row.line + ': ' + answer.code + ' is not one of the ledgers offered for ' + facts.what + '. Nothing was imported.');
  if (ctx.claimed.has(target.account_id)) throw bad(target.code + ' ' + target.name + ' was already taken by line ' + ctx.claimed.get(target.account_id) + ' — one ledger takes one of their accounts. Nothing was imported.');
  answer.used = true;
  return target;
}
/** the row an account becomes when it lands on a ledger the pack already has (a merge or the clash skip), or null (it is ADDED as its own ledger) */
function accountTarget_(ctx, row, facts) {
  return sameLedger_(ctx, row, facts) || confirmedRow_(ctx, row, facts) || kindRow_(ctx, row, facts);
}
/** a control account or an exact same name: a merge the person reads, or the code-clash skip */
function sameLedger_(ctx, row, facts) {
  const { map, source, index, srcWord } = ctx;
  /* a control account: Xero's CSV carries no SystemAccount column (IM0 §1.2), so its NAME says it — shown as a merge the person reads, never silent */
  const role = map.roleFor(source, row.system) || map.roleFor(source, facts.type) || NAME_ROLES[low(facts.name)] || null;
  const target = (role && index.byRole.get(role)) || index.byName.get(low(facts.name)) || null;
  if (!target) return null;
  if (facts.code && target.source_code && up(target.source_code) !== up(facts.code))
    return row_(row.line, facts.what, 'skip', target.code + ' ' + target.name + ' already carries ' + srcWord + ' code ' + target.source_code + ' — a code clash.');
  const reason = role ? 'Is your ' + target.name + ' ledger (' + target.code + ')' : 'A ledger named "' + target.name + '" exists (' + target.code + ')';
  return mergeRow_(ctx, row, facts, target, reason);
}
/** the person's confirmed merge as a row, or null when this row has no answer */
function confirmedRow_(ctx, row, facts) {
  const target = confirmedTarget_(ctx, row, facts);
  return target ? mergeRow_(ctx, row, facts, target, 'You confirmed it is your ' + target.name + ' ledger (' + target.code + ')') : null;
}
/** a revenue account whose default tax code is a supply kind with its own sales ledger: the posting engine's rule, never for an export code */
function kindRow_(ctx, row, facts) {
  const { map, source, index, srcWord, claimed } = ctx;
  const kind = map.supplyKindFor(source, row.tax_code);
  const target = map.groupFor(source, facts.type) === 'sales' && !/EXPORT/.test(up(row.tax_code)) ? kindLedger_(index, kind) : null;
  if (!target || claimed.has(target.account_id) || (facts.code && target.source_code)) return null;
  return mergeRow_(ctx, row, facts, target, 'Default tax ' + txt(row.tax_code) + ' = ' + kind.name + ', counted as BAS ' + kind.bas + ' — your ' + target.code + ' ' + target.name + ' ledger');
}
/** an answer the planner did not use is REFUSED (a silently ignored answer is the bug): it named a row that was skipped, or one that offered nothing to confirm */
function unusedAnswers_(rows) {
  const lost = rows.find((x) => x.answer && !x.answer.used);
  if (lost) throw bad('The answer for line ' + lost.line + ' was not used — that row has nothing to confirm. Nothing was imported.');
}

const PLANNERS = {
  accounts(inp) {
    const { map, source } = inp,
      X = chartIndex(inp.world),
      rows = [],
      seenCode = new Map(),
      seenName = new Map(),
      srcWord = SOURCE_WORD[source],
      ctx = { map, source, index: X, srcWord, claimed: new Map() };
    const groupName = (key) => {
      const g = (X.pack.groups || []).find((x) => x.code === key);
      return g ? g.name : key;
    };
    for (const r of inp.rows) {
      const name = txt(r.name, 120),
        code = txt(r.code, 20),
        type = txt(r.type),
        what = name || code;
      const kind = map.supplyKindFor(source, r.tax_code);
      const taxNote = txt(r.tax_code)
        ? kind
          ? 'default tax ' + txt(r.tax_code) + ' = ' + kind.name + ' ' + kind.rate + '% — not kept (no slot for a per-account default)'
          : kind === null
            ? 'default tax ' + txt(r.tax_code) + ' = no GST — not kept'
            : 'default tax "' + txt(r.tax_code) + '" is not a code this import knows — not kept'
        : null;
      if (!name) {
        rows.push(row_(r.line, what, 'skip', 'No account name.'));
        continue;
      }
      if (code && seenCode.has(up(code))) {
        rows.push(row_(r.line, what, 'skip', 'Code ' + code + ' is already on line ' + seenCode.get(up(code)) + ' of this file.'));
        continue;
      }
      if (seenName.has(low(name))) {
        rows.push(row_(r.line, what, 'skip', '"' + name + '" is already on line ' + seenName.get(low(name)) + ' of this file.'));
        continue;
      }
      seenName.set(low(name), r.line);
      if (code) seenCode.set(up(code), r.line);
      const held = code ? X.bySource.get(up(code)) : null;
      if (held) {
        rows.push(
          row_(
            r.line,
            what,
            'skip',
            low(held.name) === low(name)
              ? 'Already moved in as ' + held.code + ' ' + held.name + '.'
              : 'Code ' + code + ' is already on ledger ' + held.code + ' ' + held.name + ' — a code clash.'
          )
        );
        continue;
      }
      const landed = accountTarget_(ctx, r, { name, code, type, what, taxNote });
      if (landed) {
        rows.push(landed);
        continue;
      }
      const offer = accountOffer_(ctx, r, name, type);
      const key = map.groupFor(source, type);
      if (!key) {
        rows.push(row_(r.line, what, 'skip', 'No home for ' + srcWord + ' type "' + (type || '(blank)') + '" — add it under Shop ledgers and pick its group.'));
        continue;
      }
      const g = X.groupRows.get(key);
      if (!g) {
        rows.push(
          row_(r.line, what, 'skip', 'Your chart has no group "' + groupName(key) + '" for ' + srcWord + ' type ' + type + ' — add it under Shop ledgers.')
        );
        continue;
      }
      rows.push(
        row_(r.line, what, 'add', 'Under ' + g.name + (code ? ', keeping ' + srcWord + ' code ' + code : '') + '.' + offer.said, {
          name,
          group_code: g.code,
          group_id: g.account_id,
          group_name: g.name,
          source_code: code || null,
          note: taxNote,
          candidates: offer.candidates,
          suggest: offer.suggest
        })
      );
    }
    unusedAnswers_(inp.rows);
    return {
      rows,
      tax_codes: taxCodesSeen(
        map,
        source,
        inp.rows.map((x) => x.tax_code)
      )
    };
  },

  contacts(inp) {
    const { source } = inp,
      side = inp.side === 'supplier' ? 'supplier' : 'customer',
      rows = [];
    const index = contactIndex_(inp.world || {}, side, source, taxIdOf_(inp.pack).word);
    const seen = { name: new Map(), tax: new Map(), phone: new Map() };
    for (const r of inp.rows) {
      const contact = contactRow_(r, inp.pack);
      if (contact.why) {
        rows.push(row_(r.line, contact.name, 'skip', contact.why));
        continue;
      }
      const repeated = seenAlready_(seen, contact);
      if (repeated) {
        rows.push(row_(r.line, contact.name, 'skip', repeated));
        continue;
      }
      seen.name.set(low(contact.name), r.line); /* a name twice in one file is one contact, whatever became of the first row */
      const remember = () => {
        if (contact.taxId) seen.tax.set(contact.taxId, r.line);
        if (contact.phone) seen.phone.set(contact.phone, r.line);
      };
      const found = whoIs_(index, contact);
      if (found.why) {
        rows.push(row_(r.line, contact.name, 'skip', found.why));
        continue;
      }
      if (found.hit) {
        const party = found.hit,
          label = (party.party_no ? party.party_no + ' ' : '') + party.name,
          merge = mergeWords_(index, party, side, Object.assign({ source }, contact));
        if (!merge.words.length) {
          rows.push(row_(r.line, contact.name, 'skip', 'Already here as ' + label + ' — nothing new in this row.'));
          continue;
        }
        remember();
        rows.push(
          row_(r.line, contact.name, 'merge', 'Is ' + label + ': ' + merge.words.join(', ') + '.', {
            party_id: party.party_id,
            side,
            sets: merge.sets,
            notes: contact.notes
          })
        );
        continue;
      }
      remember();
      rows.push(
        row_(
          r.line,
          contact.name,
          'add',
          'New ' + side + (contact.taxId ? ', ' + contact.word + ' ' + contact.taxId : '') + (contact.phone ? ', phone ' + contact.phone : '') + '.',
          {
            name: contact.name,
            side,
            phone: contact.phone,
            email: contact.email,
            abn: contact.taxId,
            tax_scheme: contact.taxId ? contact.word : null,
            gstin: contact.gstin,
            legal_name: contact.legal,
            source_system: contact.ref ? source : null,
            source_ref: contact.ref,
            notes: contact.notes
          }
        )
      );
    }
    return { rows };
  },

  items(inp) {
    const { map, source, pack } = inp,
      shopWorld = inp.world || {},
      rows = [],
      currency = inp.currency || pack.currency,
      word = taxWord_(pack);
    const byCode = new Map();
    (shopWorld.products || []).forEach((item) => {
      if (item.code) byCode.set(low(item.code), item);
    });
    const seen = new Map();
    for (const r of inp.rows) {
      const name = txt(r.name, 120),
        code = txt(r.code, 60),
        what = name || code;
      const refused = itemRefusal_(r, name);
      if (refused) {
        rows.push(row_(r.line, what, 'skip', refused));
        continue;
      }
      if (code && seen.has(low(code))) {
        rows.push(row_(r.line, what, 'skip', 'Code ' + code + ' is already on line ' + seen.get(low(code)) + ' of this file.'));
        continue;
      }
      if (code) seen.set(low(code), r.line);
      const have = code ? byCode.get(low(code)) : null;
      if (have) {
        rows.push(
          row_(r.line, what, 'skip', 'Already in the catalogue as ' + (have.name || code) + ' (' + code + ') — prices are not overwritten by a move-in.')
        );
        continue;
      }
      const checked = itemHolds_(r, what, inp, word);
      if (checked.hold) {
        rows.push(checked.hold);
        continue;
      }
      const { tax, unit } = checked;
      const notes = [].concat(tax ? [tax.note] : [], unit.note ? [unit.note] : []);
      if (txt(r.purchase_tax)) notes.push('purchase tax ' + itemTax_(map, source, r.purchase_tax, word).note + ' — a product carries one rate, the sales one');
      if (!code) notes.push('no code: a second import of this file would add it again');
      const price = txt(r.sales_price) ? P.looseNumber(r.sales_price).value : null,
        cost = txt(r.purchase_price) ? P.looseNumber(r.purchase_price).value : null;
      const rec = {
        name,
        code: code || null,
        unit: unit.unit,
        price: price == null ? 0 : price,
        gst_rate: tax ? tax.rate : null,
        cost,
        source_system: source,
        source_ref: code || null,
        description: txt(r.description, 500) || null
      };
      rows.push(
        row_(
          r.line,
          what,
          'add',
          (price != null ? moneyWords(toMinor(String(price), currency), currency) : 'no price') + (tax ? ' · ' + word + ' ' + tax.rate + '%' : '') + '.',
          { rec, notes }
        )
      );
    }
    return { rows, tax_codes: itemCodes_(inp) };
  },

  trial_balance(inp) {
    const X = chartIndex(inp.world),
      cur = inp.currency || inp.pack.currency,
      rows = [],
      srcWord = SOURCE_WORD[inp.source];
    let count = 0,
      cr = 0;
    const parsed = inp.rows.map((item) => {
      const { account, code } = accountCode(item.account, item.code);
      const total = /^(total|totals|grand total)$/i.test(account) || (!account && !code);
      const d = txt(item.debit) ? toMinor(item.debit, cur) : 0,
        c = txt(item.credit) ? toMinor(item.credit, cur) : 0;
      return { line: item.line, account, code, total, dr: d, cr: c, badDr: txt(item.debit) && d === null, badCr: txt(item.credit) && c === null };
    });
    for (const p of parsed)
      if (!p.total && !p.badDr && !p.badCr) {
        count += p.dr || 0;
        cr += p.cr || 0;
      }
    const refusal =
      count !== cr
        ? 'The trial balance does not balance: debits ' +
          moneyWords(count, cur) +
          ', credits ' +
          moneyWords(cr, cur) +
          ' — the difference is ' +
          moneyWords(Math.abs(count - cr), cur) +
          '. Export it again as at the move date, with every account.'
        : null;
    const control = { debtors_minor: 0, creditors_minor: 0 };
    for (const p of parsed) {
      const what = p.account || p.code;
      if (p.total) {
        rows.push(row_(p.line, what || 'Total', 'skip', 'A total row.'));
        continue;
      }
      if (p.badDr || p.badCr) {
        rows.push(
          row_(
            p.line,
            what,
            'skip',
            '"' +
              (p.badDr ? txt(inp.rows.find((item) => item.line === p.line).debit) : txt(inp.rows.find((item) => item.line === p.line).credit)) +
              '" is not an amount.'
          )
        );
        continue;
      }
      /* THEIR code (kept on the ledger by the chart import), else the NAME, else a control account by the name their system gives it (before b302 keeps the codes) */
      const a =
        (p.code && X.bySource.get(up(p.code))) ||
        X.byName.get(low(p.account)) ||
        (NAME_ROLES[low(p.account)] ? X.byRole.get(NAME_ROLES[low(p.account)]) : null) ||
        null;
      if (!a) {
        rows.push(
          row_(
            p.line,
            what,
            'skip',
            'No ledger named "' +
              p.account +
              '"' +
              (p.code ? ' (' + srcWord + ' code ' + p.code + ')' : '') +
              ' — move the chart of accounts in first, or add it under Shop ledgers.'
          )
        );
        continue;
      }
      if (a.is_group) {
        rows.push(row_(p.line, what, 'skip', a.name + ' is a group, not a ledger.'));
        continue;
      }
      if (a.role === 'debtors' || a.role === 'creditors') {
        control[a.role + '_minor'] += (p.dr || 0) - (p.cr || 0);
        rows.push(
          row_(
            p.line,
            what,
            'skip',
            (a.role === 'debtors' ? 'Customers' : 'Suppliers') +
              ' balance ' +
              moneyWords(Math.abs((p.dr || 0) - (p.cr || 0)), cur) +
              ' arrives bill-wise from the open ' +
              (a.role === 'debtors' ? 'invoices' : 'bills') +
              ' file — Suspense holds it until then.'
          )
        );
        continue;
      }
      if (!p.dr && !p.cr) {
        rows.push(row_(p.line, what, 'skip', 'Nil.'));
        continue;
      }
      const net = (p.dr || 0) - (p.cr || 0);
      rows.push(
        row_(p.line, what, 'add', (net >= 0 ? 'Debit ' : 'Credit ') + moneyWords(Math.abs(net), cur) + ' on ' + a.code + ' ' + a.name + '.', {
          code: a.code,
          name: a.name,
          dr_minor: net > 0 ? net : 0,
          cr_minor: net < 0 ? -net : 0
        })
      );
    }
    const notes = [];
    if (control.debtors_minor || control.creditors_minor)
      notes.push(
        'Suspense will hold ' + moneyWords(Math.abs(control.debtors_minor - control.creditors_minor), cur) + ' until the open invoices and bills are moved in.'
      );
    return { rows, refusal, notes, totals: { dr_minor: count, cr_minor: cr }, control };
  },

  open_bills(list) {
    const X = chartIndex(list.world),
      shopWorld = list.world || {},
      cur = list.currency || list.pack.currency,
      rows = [];
    const side = list.side === 'payable' || list.side === 'supplier' ? 'payable' : 'receivable';
    const role = side === 'payable' ? 'creditors' : 'debtors',
      flag = side === 'payable' ? 'supplier' : 'customer';
    const control = X.byRole.get(role),
      parties = billParties_(shopWorld, flag, list.source);
    const read = billReads_(list, { control, side, flag, cur, parties });
    const shared = sharedRefs_(read),
      owners = new Map((shopWorld.billOwners || []).map((owner) => [String(owner.ref), String(owner.party_id)]));
    const seen = new Map(),
      codes = [];
    for (const b of read) {
      if (b.skip) {
        rows.push(skipRow_(b));
        continue;
      }
      String(b.r.tax_codes || '')
        .split(';')
        .forEach((code) => codes.push(code));
      const ref = billRef_(b, shared, owners);
      const key = String(b.p.party_id) + '|' + up(ref);
      if (seen.has(key)) {
        rows.push(row_(b.r.line, b.what, 'skip', ref + ' for ' + b.p.name + ' is already on line ' + seen.get(key) + ' of this file.'));
        continue;
      }
      seen.set(key, b.r.line);
      if (owners.get(ref) === String(b.p.party_id)) {
        rows.push(hold_(b.r.line, b.what, 'bill_key', ref + ' for ' + b.p.name + ' is already open in your books — it is not added twice.'));
        continue;
      }
      const unknown = billUnknownCode_(b.r, list.map, list.source);
      if (unknown) {
        rows.push(
          hold_(
            b.r.line,
            b.what,
            'tax_code',
            'Tax code "' + unknown + '" on it is not one of ' + countryName_(list.pack) + "'s codes here — pick one of your own codes, then load it again."
          )
        );
        continue;
      }
      const debit = side === 'receivable' ? b.amt > 0 : b.amt < 0,
        notes = b.notes.concat(ref !== b.no ? ['kept as ' + ref + (b.no ? ' (' + b.no + ' is used by another party too)' : ' (no number in their file)')] : []);
      rows.push(
        row_(
          b.r.line,
          b.what,
          'add',
          (b.amt < 0 ? 'A credit of ' : '') +
            moneyWords(Math.abs(b.amt), cur) +
            (b.amt < 0 ? ' in ' : ' owed ') +
            (side === 'receivable' ? 'by ' : 'to ') +
            b.p.name +
            (b.due ? ', due ' + b.due : '') +
            '.',
          {
            code: control.code,
            party_id: b.p.party_id,
            party_no: b.p.party_no || null,
            name: b.p.name,
            bill_ref: ref,
            ref_given: b.no || null,
            due_date: b.due,
            dr_minor: debit ? Math.abs(b.amt) : 0,
            cr_minor: debit ? 0 : Math.abs(b.amt),
            theirs: txt(b.r.amount_due),
            notes
          }
        )
      );
    }
    return { rows, side, tax_codes: taxCodesSeen(list.map, list.source, codes), notes: billNotes_(list.rows, rows, cur) };
  }
};

/* ── the OPEN INVOICES AND BILLS planner's steps (W1.5 the bill key is party + reference · W1.8 their contact id first · W1.2 a line's code) ── */
/** the parties on this side, by name · party number · THEIR id */
function billParties_(shopWorld, flag, source) {
  const byName = new Map(),
    byNo = new Map(),
    bySrc = new Map();
  (shopWorld.parties || []).forEach((item) => {
    if (item[flag]) {
      byName.set(low(item.name), item);
      if (item.party_no) byNo.set(up(item.party_no), item);
    }
  });
  const pById = new Map((shopWorld.parties || []).map((item) => [String(item.party_id), item]));
  (shopWorld.sourceRefs || []).forEach((x) => {
    const p = pById.get(String(x.party_id));
    if (p && p[flag] && x.source_system === source && x.source_ref) bySrc.set(String(x.source_ref), p);
  });
  return { byName, byNo, bySrc };
}
/** one row read: who, which document, how much → { r, what, who, no, amt, p, due, notes } or { skip } with its sentence */
function billRead_(row, opts) {
  const who = txt(row.contact, 150),
    no = txt(row.invoice_no, 60),
    what = (who ? who + ' · ' : '') + no,
    theirId = txt(row.contact_ref, 80);
  const skip = (sentence, code) => ({ r: row, what, skip: sentence, code });
  if (!who && !theirId) return skip('No contact name.');
  if (!opts.control) return skip('Your chart has no ' + (opts.side === 'payable' ? 'Suppliers' : 'Customers') + ' ledger.');
  const owed = billOwed_(row, opts.cur, opts.mixed);
  if (owed.skip) return skip(owed.skip, owed.code);
  const signed = billSigned_(row, owed, opts.side);
  if (signed.skip) return skip(signed.skip, signed.code);
  const party = (theirId && opts.parties.bySrc.get(theirId)) || opts.parties.byName.get(low(who)) || opts.parties.byNo.get(up(who)) || null;
  if (!party) return skip('No ' + opts.flag + ' named "' + who + '" — move the contacts in first.');
  const due = isoDate(row.due_date),
    notes = signed.notes.slice();
  if (txt(row.due_date) && !due) notes.push('due date "' + txt(row.due_date) + '" could not be read — left blank');
  return { r: row, what, who, no, amt: signed.amt, p: party, due, notes };
}
/** a row the planner leaves out: a HELD row when its reader gave a code (nothing written, said), else a skipped one */
function skipRow_(bill) {
  return bill.code ? hold_(bill.r.line, bill.what, bill.code, bill.skip) : row_(bill.r.line, bill.what, 'skip', bill.skip);
}
/* the currency a figure's own text names (ACC-241): "US$500" "USD 500.00" "€50" → what it says. looseNumber strips all of these, so a USD figure was read as the shop's currency in silence */
const CELL_MARKS = { 'a$': 'AUD', 'au$': 'AUD', 'nz$': 'NZD', 'us$': 'USD', 'ca$': 'CAD', 'sg$': 'SGD', 'hk$': 'HKD' };
/** every currency a figure's text names: a code ("USD"), a country dollar ("US$" gives USD) or a bare symbol (kept as the symbol) */
function cellCurrencies_(text) {
  const found = String(text == null ? '' : text).match(/\b(?:a|au|nz|us|ca|sg|hk)\$|[€£¥]|\b[a-z]{3}\b/gi) || [];
  return found.map((mark) => CELL_MARKS[mark.toLowerCase()] || mark.toUpperCase());
}
/** the shop currency's own symbol as the runtime writes it, so a bare symbol that IS the shop's is not foreign */
function ownSymbol_(currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(0).replace(/[0-9.,\s]/g, '');
}
/** the first currency on a row that is not the shop's — from its currency column or the amount's own text — or null */
function foreignCurrency_(row, currency) {
  const symbol = ownSymbol_(currency);
  return cellCurrencies_(row.currency).concat(cellCurrencies_(row.amount_due)).find((code) => code !== currency && code !== symbol) || null;
}
/** the dry run says when no currency column was picked: every row is then read as the shop's currency (ACC-241) */
function currencyNotes_(rows, currency) {
  return rows.length && !rows.some((x) => own(x, 'currency')) ? ['No currency column was picked: every row is read as ' + currency + '.'] : [];
}
/** the amount still owed on a document, in minor units → { amt, notes? } or { skip } or { skip, code } (a HELD row) with its sentence.
 *  mixed = some row of the file names a foreign currency (a blank currency cell on such a file is held: a ragged file is the ambiguity). */
function billOwed_(row, currency, mixed) {
  const given = txt(row.amount_due);
  if (!given) return { skip: 'No amount still owed.' };
  const foreign = foreignCurrency_(row, currency);
  if (foreign) return foreignOwed_(row, currency, foreign);
  if (row.answer) throw bad('Line ' + row.line + ' (' + txt(row.invoice_no) + ') is not held for its currency, so there is nothing to answer there. Nothing was imported.');
  const blank = own(row, 'currency') && !txt(row.currency);
  if (blank && mixed) return { skip: txt(row.invoice_no) + ' has no currency in a file that also names a foreign one. Fill its currency and load it again.', code: 'currency' };
  const amt = toMinor(row.amount_due, currency);
  if (amt === null) return { skip: '"' + given + '" is not an amount.' };
  const notes = blank ? ['no currency on this row — read as ' + currency] : [];
  return amt ? { amt, notes } : { skip: 'Nothing owed on it.' };
}
/** a foreign row: released only by the person's typed home amount or a confirmed rate WITH its direction (ACC-241, Athi 5 Nov: hold, never convert unasked) */
function foreignOwed_(row, currency, foreign) {
  const given = txt(row.amount_due),
    no = txt(row.invoice_no),
    sign = /^\s*(-|\()/.test(given) ? -1 : 1,
    major = Math.abs(P.looseNumber(given).value || 0),
    rate = scaleRate_(row.currency_rate);
  const answer = row.answer;
  if (answer) {
    if (answer.ref !== no) throw bad('Line ' + row.line + ' is ' + no + ', not ' + answer.ref + ' — the file changed. Nothing was imported; check the answer.');
    return releasedOwed_(row, currency, foreign, { sign, major, given });
  }
  const gapSentence =
    ' A rate gives the invoice-date amount, not what your books hold at the move date (IAS 21 para 23(a), 28): the exchange difference is yours to book, so Suspense keeps a gap until you do.';
  const both = rate
    ? ' Their rate ' + txt(row.currency_rate) + ' read as ' + foreign + ' per ' + currency + ' gives ' + moneyWords(homeFrom_(major, foreign, currency, rate, 'foreign_per_home'), currency) +
      '; read as ' + currency + ' per ' + foreign + ' gives ' + moneyWords(homeFrom_(major, foreign, currency, rate, 'home_per_foreign'), currency) + '.' + gapSentence
    : '';
  return {
    skip: no + ' is in ' + foreign + ' (' + given + '), and this shop keeps its books in ' + currency + '.' + both + ' Type its ' + currency + ' amount (the figure Xero shows at the move date) to release it.',
    code: 'currency'
  };
}
/** the answer applied: { amt, notes } in the shop's minor units; the sign is the amount's own (an answer never carries one) */
function releasedOwed_(row, currency, foreign, figures) {
  return row.answer.action === 'home_amount' ? typedHome_(row, currency, foreign, figures) : confirmedRate_(row, currency, foreign, figures);
}
/** the person typed the shop-currency amount: a plain positive number in the currency's own decimals, nothing else */
function typedHome_(row, currency, foreign, figures) {
  const text = String(row.answer.value == null ? '' : row.answer.value).trim(),
    places = Math.max(M.decimals ? M.decimals(currency) : 2, 1);
  if (!new RegExp('^\\d+(\\.\\d{1,' + places + '})?$').test(text) || !Number(text))
    throw bad('Line ' + row.line + ': the ' + currency + ' amount must be a plain positive number, with no sign or currency. Nothing was imported.');
  const home = toMinor(text, currency);
  return { amt: figures.sign * home, notes: [foreign + ' ' + figures.given + ' moved in as ' + moneyWords(home, currency) + ', the figure you typed'] };
}
/** the person confirmed the file's rate AND which way it runs: integer math, one rounding; the result is the invoice-date amount, said so */
function confirmedRate_(row, currency, foreign, figures) {
  const answer = row.answer,
    rate = scaleRate_(answer.value),
    direction = answer.per;
  if (!rate) throw bad('Line ' + row.line + ': the rate must be a number above 0 with at most 6 decimals. Nothing was imported.');
  if (direction !== 'foreign_per_home' && direction !== 'home_per_foreign')
    throw bad('Line ' + row.line + ': say which way the rate runs — ' + foreign + ' per ' + currency + ' or ' + currency + ' per ' + foreign + '. Nothing was imported.');
  const home = homeFrom_(figures.major, foreign, currency, rate, direction),
    words = direction === 'foreign_per_home' ? foreign + ' per ' + currency : currency + ' per ' + foreign;
  return {
    amt: figures.sign * home,
    notes: [foreign + ' ' + figures.given + ' at ' + answer.value + ' (' + words + ') = ' + moneyWords(home, currency) + ' — the invoice-date amount; the exchange difference to your books at the move date is yours to book (IAS 21 para 28)']
  };
}
/** a rate text → the rate as an integer in millionths (a decimal string, never a float), or null: not a number, 0, or more than 6 decimals */
function scaleRate_(text) {
  const parts = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(text == null ? '' : text).trim());
  if (!parts) return null;
  const scaled = BigInt(parts[1]) * 1000000n + BigInt((parts[2] || '').padEnd(6, '0') || '0');
  return scaled > 0n ? scaled : null;
}
/** a foreign figure (major units, as read) at a scaled rate → the shop currency's minor units, in integers with ONE half-up rounding at the end */
function homeFrom_(major, foreign, home, rate, direction) {
  const foreignPlaces = BigInt(M.decimals ? M.decimals(foreign) : 2),
    homePlaces = BigInt(M.decimals ? M.decimals(home) : 2);
  const foreignMinor = BigInt(toMinor(String(major), foreign) || 0);
  const numerator = direction === 'foreign_per_home' ? foreignMinor * 1000000n * 10n ** homePlaces : foreignMinor * rate * 10n ** homePlaces;
  const divisor = direction === 'foreign_per_home' ? rate * 10n ** foreignPlaces : 1000000n * 10n ** foreignPlaces;
  return Number((2n * numerator + divisor) / (2n * divisor));
}
/* ── ACC-244 · the document's Type: a credit note is a credit whatever sign the file prints (Xero API Type ACCRECCREDIT / ACCPAYCREDIT; the CSV wording is GUESSED, an unknown word is HELD) ── */
const DOC_TYPES = {
  ACCREC: { side: 'receivable', credit: false },
  ACCPAY: { side: 'payable', credit: false },
  ACCRECCREDIT: { side: 'receivable', credit: true },
  ACCPAYCREDIT: { side: 'payable', credit: true },
  CREDITNOTE: { side: null, credit: true },
  INVOICE: { side: null, credit: false },
  BILL: { side: null, credit: false }
};
/** the row's Type read for its file's side → { credit, note? } or { skip, code: 'doc_type' } (held); no Type column or a blank cell = the amount's own sign, as before */
function docKind_(row, side) {
  const word = txt(row.doc_type);
  if (!word) return { credit: false };
  const kind = DOC_TYPES[up(word).replace(/[^A-Z]/g, '')];
  if (/prepay|overpay/i.test(word))
    return { skip: txt(row.invoice_no) + ' is a ' + word + ', not an open invoice or credit note: prepayments and overpayments are moved in by hand.', code: 'doc_type' };
  if (!kind) return { skip: 'Type "' + word + '" on ' + txt(row.invoice_no) + ' is not one this import reads (ACCREC, ACCPAY, ACCRECCREDIT, ACCPAYCREDIT, Invoice, Bill, Credit Note).', code: 'doc_type' };
  if (kind.side && kind.side !== side)
    return { skip: txt(row.invoice_no) + ' is a ' + (kind.side === 'receivable' ? 'sales' : 'purchases') + ' document (' + word + ') in a ' + (side === 'payable' ? 'purchases' : 'sales') + ' file.', code: 'doc_type' };
  return { credit: kind.credit };
}
/** the amount with its direction: a credit note is always a credit (one flip, whatever the file's sign) → { amt, notes } or a held { skip, code } */
function billSigned_(row, owed, side) {
  const kind = docKind_(row, side);
  if (kind.skip) return kind;
  if (kind.credit) return { amt: -Math.abs(owed.amt), notes: owed.notes };
  const warning = txt(row.doc_type) && owed.amt < 0 ? ['a ' + (side === 'payable' ? 'bill' : 'sales invoice') + ' with a negative amount is read as a credit — check the amount column'] : [];
  return { amt: owed.amt, notes: owed.notes.concat(warning) };
}
/** the rows read, once, with the file-level facts the rows need: does ANY row name a foreign currency; and every typed answer must have found its row (a silent answer is the bug) */
function billReads_(list, opts) {
  const mixed = list.rows.some((x) => foreignCurrency_(x, opts.cur));
  const read = list.rows.map((x) => billRead_(x, Object.assign({ mixed }, opts)));
  const lost = read.find((bill) => bill.r.answer && bill.skip);
  if (lost) throw bad('The answer for line ' + lost.r.line + ' (' + txt(lost.r.invoice_no) + ') was not used — that row is not moved in: ' + lost.skip + ' Nothing was imported.');
  return read;
}
/** what the preview says about the file as a whole: no currency column; the rows held for currency or Type, in words (Suspense keeps the gap) */
function billNotes_(rows, planned, currency) {
  const held = planned.filter((x) => x.action === 'hold' && (x.code === 'currency' || x.code === 'doc_type'));
  const said = held.length ? [held.length + (held.length === 1 ? ' row is' : ' rows are') + ' held and NOT moved in (' + held.map((x) => x.what).join('; ') + '): Suspense keeps the gap until they are.'] : [];
  return currencyNotes_(rows, currency).concat(said);
}
/** the references more than one party uses in this file (Xero's "AP" on two suppliers' bills) */
function sharedRefs_(read) {
  const parties = new Map();
  read
    .filter((bill) => !bill.skip && bill.no)
    .forEach((bill) => {
      const refKey = up(bill.no);
      const users = parties.get(refKey) || new Set();
      users.add(String(bill.p.party_id));
      parties.set(refKey, users);
    });
  return new Set(
    Array.from(parties)
      .filter(([, users]) => users.size > 1)
      .map(([refKey]) => refKey)
  );
}
/** ⭐ X-1: the bill's key is (party, reference) — a reference another party shares (in this file or already in the books) is kept with the party's
 *  number beside it; a document with no number gets one from its line. Shown in the row and the proof (ref_given beside bill_ref). */
function billRef_(bill, shared, owners) {
  const label = bill.p.party_no || bill.p.name;
  if (!bill.no) return 'MI-' + bill.r.line + ' · ' + label;
  const other = owners.has(bill.no) && owners.get(bill.no) !== String(bill.p.party_id);
  return shared.has(up(bill.no)) || other ? bill.no + ' · ' + label : bill.no;
}
/** the first tax code on a document's lines that the shop's pack does not know, or null */
function billUnknownCode_(row, map, source) {
  const list = String(row.tax_codes || '')
    .split(';')
    .map((code) => txt(code))
    .filter(Boolean);
  return list.find((code) => map.supplyKindFor(source, code) === undefined) || null;
}

/* ═══ the world — what the shop already has, read ONCE per import (no per-row queries); each read in its own savepoint so a table that is not there yet reads as empty ═══ */
/**
 * world(h, entity, kind, setting, opts?) — opts { source, side, rows } (optional): their company ids already moved in (W1.4), their contact ids on our
 * parties (W1.8, b766), and which of the file's bill references the shop already holds, and for whom (W1.5). Without opts those read as empty.
 */
async function world(h, entity, kind, setting, opts) {
  const S = require('./books-store'),
    books = require('./books'),
    E = require('./books-engines');
  const tsp = (fn, fb) => require('../db').trySavepoint(h, fn, fb);
  const kindKey = kindOf(kind),
    options = opts || {};
  const out = { pack: books.packOf(setting), setting };
  if (kindKey === 'accounts' || kindKey === 'trial_balance' || kindKey === 'open_bills') out.chart = await S.accounts(h, entity);
  if (kindKey === 'contacts' || kindKey === 'open_bills') {
    out.parties = await tsp(() => S.parties(h, entity), []);
    const ids = out.parties.map((item) => item.party_id);
    out.taxIds = ids.length
      ? await tsp(async () => (await h.query(`SELECT party_id, scheme, value FROM party_tax_id WHERE owner_entity_id = $1`, [entity])).rows, [])
      : [];
    out.phones = ids.length
      ? await tsp(
          async () =>
            (
              await h.query(
                `SELECT identity_id AS party_id, COALESCE(NULLIF(phone, ''), otp_contact) AS phone FROM identities WHERE identity_id = ANY($1::uuid[])`,
                [ids]
              )
            ).rows.filter((x) => x.phone),
          []
        )
      : [];
    out.listIds = ids.length
      ? await tsp(
          async () =>
            (
              await h.query(
                `SELECT 'customer' AS side, customer_list_id AS id, customer_identity_id AS party_id FROM customer_list WHERE owner_entity_id = $1
                                                                          UNION ALL SELECT 'supplier', supplier_list_id, supplier_entity_id FROM supplier_list WHERE owner_entity_id = $1`,
                [entity]
              )
            ).rows,
          []
        )
      : [];
    out.sourceRefs =
      ids.length && (await sourcePairReady())
        ? await tsp(
            async () =>
              (
                await h.query(
                  `SELECT 'customer' AS side, customer_identity_id AS party_id, source_system, source_ref FROM customer_list WHERE owner_entity_id = $1 AND source_ref IS NOT NULL
                                                                          UNION ALL SELECT 'supplier', supplier_entity_id, source_system, source_ref FROM supplier_list WHERE owner_entity_id = $1 AND source_ref IS NOT NULL`,
                  [entity]
                )
              ).rows,
            []
          )
        : [];
  }
  if (kindKey === 'open_bills') out.billOwners = await billOwners_(h, entity, out.chart, options);
  if (kindKey === 'items')
    out.products = await tsp(
      async () =>
        (
          await h.query(
            `SELECT item_id, COALESCE(item_data->>'code', item_data->>'sku') AS code, item_data->>'name' AS name FROM catalogue_items WHERE entity_id = $1 AND is_active = true`,
            [entity]
          )
        ).rows,
      []
    );
  out.companies = options.source ? await require('./move-in-proof').companies(h, entity, options.source) : [];
  E.packs(); /* the engines must be there before anything is planned against the chart */
  return out;
}
/** b766: does customer_list / supplier_list carry their contact id yet? */
async function sourcePairReady() {
  const schema = require('./schema');
  return (await schema.hasColumn('customer_list', 'source_ref')) && (await schema.hasColumn('supplier_list', 'source_ref'));
}
/** which of the file's references the control account already holds, and for whom — ONE read (books-store itemOwners) */
async function billOwners_(conn, entity, chart, options) {
  const role = options.side === 'payable' || options.side === 'supplier' ? 'creditors' : 'debtors';
  const control = (chart || []).find((x) => x.role === role),
    refs = Array.from(new Set((options.rows || []).map((x) => txt(x.invoice_no, 60)).filter(Boolean)));
  if (!control || !refs.length) return [];
  return require('../db').trySavepoint(conn, () => require('./books-store').itemOwners(conn, entity, control.account_id, refs), []);
}

/* ═══ 4 · THE WRITE — one transaction (the caller's withEntity), the plan as planned, through the doors that exist ═══ */
/** a NEW contact on the shop's connection (split out of apply for the fn-size ratchet, INT6a) → { id } (the list row) or { why } (skipped).
 *  `bare` = no legal name / tax ids follow, so the party number is given here (PF.patch numbers it otherwise). */
async function addNew_(h, entity, d, bare, ins) {
  const L = require('./local-identity'),
    PF = require('./party-fields');
  if (d.side === 'customer') {
    /* ⭐ CRM-MINT1: the one add-customer (mint · list row · contact · number) on this transaction; PF.patch numbers when it runs */
    const a = await L.addCustomer(h, entity, { name: d.name, phone: d.phone, gstin: d.gstin, email: d.email, via: ADDED_VIA, number: bare });
    if (a.refused) return { why: (a.refused.error && a.refused.error.message) || 'Could not add them.' };
    if (a.exists) return { why: d.name + ' is already on your ' + d.side + ' list.' };
    return { id: a.customer_list_id, email_held: a.email_held };
  }
  const local = await L.mint(entity, d.name, { query: h.query.bind(h), kind: 'sup' });
  if (local.error) return { why: (local.error && local.error.message) || 'Could not add them.' };
  if (d.phone || d.gstin)
    await h.query(`UPDATE identities SET otp_contact = COALESCE(otp_contact, $2), gstn = COALESCE(gstn, $3) WHERE identity_id = $1 AND parent_entity_id = $4`, [
      local.identity_id,
      d.phone || null,
      d.gstin || null,
      entity
    ]);
  const email_held = await L.keepEmail(h, entity, local.identity_id, d.email);
  const id = await ins(d.side, local.identity_id);
  if (!id) return { why: d.name + ' is already on your ' + d.side + ' list.' };
  if (bare) await require('../db').trySavepoint(h, () => PF.ensureNo(h, entity, local.identity_id), null);
  return { id, email_held };
}
const PG_CHECK = '23514'; /* Postgres check_violation */
/** a database CHECK refusal inside the move-in's ONE transaction: the transaction is already aborted, so no later row can land — the whole
 *  file is refused in words (422, a code) and the constraint is logged; never an uncaught 500 (QM-1: silence is the bug) */
function checkRefusal_(e) {
  log.warn('move-in.check-refused', { constraint: e.constraint || null, table: e.table || null, error: String(e.message || '').slice(0, 160) });
  return refuse(
    'Nothing was imported — the database refused a row (' +
      (e.constraint || 'a check') +
      '), so nothing from this file was saved. Send this message to support.',
    'MOVE_IN_DB_REFUSED',
    422
  );
}
/* ── the CONTACTS step of apply(), as named steps (fn-size ratchet, QM-1 17 Oct) ── */
/** the list-row insert on the shop's own connection (conn = the withEntity handle) — the same inserts POST /relationships/customers and /suppliers make → (side, party_id) → list id | null */
function listInsert_(conn, entity) {
  return async (side, party_id) => {
    const r =
      side === 'customer'
        ? await conn.query(
            `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at) VALUES ($1, $2, 'entity', $3, 0, NULL)
                       ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING RETURNING customer_list_id AS id`,
            [entity, party_id, ADDED_VIA]
          )
        : await conn.query(
            `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via) VALUES ($1, $2, 'resale', $3)
                       ON CONFLICT DO NOTHING RETURNING supplier_list_id AS id`,
            [entity, party_id, ADDED_VIA]
          );
    return r.rows[0] ? r.rows[0].id : null;
  };
}
/** the party fields a contact row carries (legal name · the pack's tax ID · GSTIN) in party-fields.patch's shape */
function contactFields_(sets) {
  const fields = {};
  if (sets.legal_name) fields.legal_name = sets.legal_name;
  const taxIds = [];
  if (sets.abn) taxIds.push({ scheme: up(sets.tax_scheme || 'ABN'), value: sets.abn });
  if (sets.gstin) taxIds.push({ scheme: 'GSTIN', value: sets.gstin });
  if (taxIds.length) fields.tax_ids = taxIds;
  return fields;
}
/** W1.8 (b766): their contact id on the list row, in a savepoint — a pair another party already holds stays off this one, said in the log */
async function keepSourcePair_(conn, entity, side, listId, pair, contactRun) {
  if (!contactRun.pair || !listId || !pair.source_ref) return;
  const target = side === 'customer' ? { table: 'customer_list', id: 'customer_list_id' } : { table: 'supplier_list', id: 'supplier_list_id' };
  const ok = await require('../db').trySavepoint(
    conn,
    () =>
      conn
        .query(`UPDATE ${target.table} SET source_system = $3, source_ref = $4 WHERE ${target.id} = $1 AND owner_entity_id = $2 AND source_ref IS NULL`, [
          listId,
          entity,
          pair.source_system,
          pair.source_ref
        ])
        .then(() => true),
    false
  );
  if (!ok) log.warn('move-in.source-pair-not-kept', { side, source_system: pair.source_system, source_ref: String(pair.source_ref).slice(0, 40) });
}
/** a MERGE row: the list row if it was missing, the phone/GSTIN into empty slots, their id, the party fields */
async function mergeContact_(conn, entity, d, contactRun) {
  const PF = require('./party-fields'),
    key = d.side + '|' + String(d.party_id);
  let id = contactRun.listId.get(key);
  if (d.sets.list) {
    id = (await contactRun.ins(d.side, d.party_id)) || id;
    if (id) contactRun.listId.set(key, id);
  }
  if (d.sets.phone || d.sets.gstin)
    await conn.query(
      `UPDATE identities SET otp_contact = COALESCE(otp_contact, $2), gstn = COALESCE(gstn, $3) WHERE identity_id = $1 AND parent_entity_id = $4`,
      [d.party_id, d.sets.phone || null, d.sets.gstin || null, entity]
    );
  await keepSourcePair_(conn, entity, d.side, id, d.sets, contactRun);
  const fields = contactFields_(d.sets);
  if (id && Object.keys(fields).length) await PF.patch(conn, entity, d.side, id, fields, contactRun.by);
}
/** an ADD row → null (added) or the sentence it was skipped with */
async function addContact_(conn, entity, d, contactRun) {
  const fields = contactFields_({ legal_name: d.legal_name, abn: d.abn, tax_scheme: d.tax_scheme, gstin: d.gstin });
  const got = await addNew_(conn, entity, d, !Object.keys(fields).length, contactRun.ins);
  if (got.why) return got.why;
  if (got.email_held) contactRun.emailsHeld = (contactRun.emailsHeld || 0) + 1;
  await keepSourcePair_(conn, entity, d.side, got.id, d, contactRun);
  if (Object.keys(fields).length) await require('./party-fields').patch(conn, entity, d.side, got.id, fields, contactRun.by);
  return null;
}
/** a contact row that failed: a refusal skips the row with its sentence; a CHECK refusal stops the file (checkRefusal_); anything else is thrown */
function contactFailed_(e) {
  if (e && (e.status === 409 || e.status === 400 || e.status === 422 || e.refused)) return e.message;
  if (e && e.code === PG_CHECK) throw checkRefusal_(e);
  throw e;
}
/** CONTACTS: every row added, merged or skipped with its sentence, on the caller's transaction */
async function applyContacts_(conn, entity, planned, ctx, out, skipped) {
  const contactRun = { by: ctx.by || null, ins: listInsert_(conn, entity), listId: new Map(), pair: await sourcePairReady() };
  (ctx.world.listIds || []).forEach((x) => contactRun.listId.set(x.side + '|' + String(x.party_id), x.id));
  for (const r of planned.rows) {
    if (r.action === 'skip') {
      skipped(r);
      continue;
    }
    try {
      if (r.action === 'merge') {
        await mergeContact_(conn, entity, r.data, contactRun);
        out.merged++;
        continue;
      }
      const skipWhy = await addContact_(conn, entity, r.data, contactRun);
      if (skipWhy) skipped(r, skipWhy);
      else out.added++;
    } catch (e) {
      skipped(r, contactFailed_(e));
    }
  }
  if (contactRun.emailsHeld)
    out.notes = out.notes.concat([contactRun.emailsHeld + ' contact(s) were added without their e-mail: another account already uses that address. Add it by hand if you need it.']);
  if (!contactRun.pair && planned.rows.some((x) => x.data && (x.data.source_ref || (x.data.sets || {}).source_ref)))
    out.notes = out.notes.concat([waiting('The saved contact ids', true, 'Their contact ids are kept in the proof only, and bills match by name until then.')]);
  return out;
}
/** ACCOUNTS: ledgers added (their code kept, b302) or merged */
async function applyAccounts_(conn, entity, planned, ctx, out, skipped) {
  const S = require('./books-store'),
    schema = require('./schema'),
    pre = { chart: ctx.world.chart, setting: ctx.setting };
  out.source_code_written = await schema.hasColumn('ledger_account', 'source_code');
  for (const r of planned.rows) {
    if (r.action === 'skip') {
      skipped(r);
      continue;
    }
    if (r.action === 'merge') {
      if (r.data.source_code && out.source_code_written) await S.setSourceCode(conn, entity, r.data.account_id, r.data.source_code);
      out.merged++;
      continue;
    }
    const refusedWhy = await addAccount_(conn, entity, r.data, ctx, pre);
    if (refusedWhy) skipped(r, refusedWhy);
    else out.added++;
  }
  if (!out.source_code_written && planned.rows.some((x) => x.action !== 'skip' && x.data && x.data.source_code))
    out.notes = out.notes.concat([
      waiting('The saved account codes', true, 'A trial balance will match on names until then.')
    ]);
  return out;
}
/** one ledger added through books.addAccount → null, or the sentence it was refused with (a CHECK refusal stops the file) */
async function addAccount_(conn, entity, data, ctx, known) {
  try {
    await require('./books').addAccount(conn, entity, { name: data.name, parent_id: data.group_id, source_code: data.source_code, by: ctx.by || null }, known);
    return null;
  } catch (e) {
    if (e && (e.refused || e.status === 409 || e.status === 422)) return e.message;
    if (e && e.code === PG_CHECK) throw checkRefusal_(e);
    throw e;
  }
}
/** ITEMS (W1.6): written on the move-in's OWN transaction (catalogue-write.writeItems { db }) — rolled back with the rest, counted */
async function applyItems_(conn, entity, planned, out, skipped) {
  const adds = planned.rows.filter((x) => x.action === 'add');
  planned.rows.filter((x) => x.action === 'skip').forEach((x) => skipped(x));
  if (!adds.length) return out;
  const items = adds.map((x) => catalogueItem_(x.data.rec, planned.source));
  const written = await require('./catalogue-write').writeItems({ entity_id: entity, items, db: conn });
  if (!written.ok)
    throw refuse(
      'Nothing was imported — ' +
        (written.message || written.error || 'the catalogue refused the file') +
        (written.invalid ? ' (' + JSON.stringify(written.invalid).slice(0, 200) + ')' : '')
    );
  out.added = (written.rows || []).length;
  out.item_ids = (written.rows || []).map((x) => x.item_id); /* metered by afterCommit, once the move-in's transaction has committed */
  return out;
}
/** afterCommit(entity, applied) — what waits for the move-in's COMMIT: the catalogue.item meter for the items it wrote (catalogue-write meterItems).
 *  The route calls it after withEntity resolves; a refused or rolled-back move-in never reaches it, so it meters nothing. */
function afterCommit(entity, applied) {
  const ids = (applied && applied.item_ids) || [];
  if (ids.length)
    require('./catalogue-write').meterItems(
      entity,
      ids.map((id) => ({ item_id: id }))
    );
}
/** a planned item in catalogue-write's shape (their code kept as the source pair, the cost through item-cost) */
function catalogueItem_(rec, source) {
  const item = { name: rec.name, unit: rec.unit, price: rec.price, source_system: rec.source_system };
  if (rec.code) Object.assign(item, { code: rec.code, source_ref: rec.source_ref });
  if (rec.gst_rate != null) item.gst_rate = rec.gst_rate;
  if (rec.description) item.desc = rec.description;
  if (rec.cost != null) Object.assign(item, require('./item-cost').setCost(rec.cost, source, 'moved in from ' + SOURCE_WORD[source]));
  return item;
}
/** the TRIAL BALANCE and the OPEN BILLS: ONE opening entry each, through the same door POST /opening uses */
async function applyOpening_(conn, entity, planned, ctx, out, skipped) {
  const adds = planned.rows.filter((x) => x.action === 'add');
  planned.rows.filter((x) => x.action === 'skip').forEach((x) => skipped(x));
  if (!adds.length) {
    if (out.held) return out;
    throw refuse('Nothing to post: every row was skipped — read the reasons beside them.');
  }
  const posted = await require('./books').postOpening(conn, entity, openingEntry_(planned, adds, ctx), { parties: ctx.world.parties, chart: ctx.world.chart });
  out.added = posted.duplicate ? 0 : adds.length;
  out.entry = {
    entry_no: posted.entry_no || null,
    entry_id: posted.entry_id || null,
    posting_date: posted.posting_date || null,
    suspense_minor: posted.suspense_minor == null ? null : posted.suspense_minor,
    duplicate: !!posted.duplicate
  };
  if (posted.duplicate)
    out.notes = out.notes.concat(['This file was already moved in as ' + (posted.entry_no || 'an earlier entry') + ' — nothing was posted twice.']);
  return out;
}
/** the ONE opening entry a trial balance or an open-bills file posts: its lines, date, currency, idempotency key and narration */
function openingEntry_(planned, adds, ctx) {
  const isTb = planned.kind === 'trial_balance',
    tag = isTb ? 'tb' : planned.side || 'receivable';
  const rows = adds.map((x) =>
    isTb
      ? { code: x.data.code, dr_minor: x.data.dr_minor, cr_minor: x.data.cr_minor }
      : {
          code: x.data.code,
          party_id: x.data.party_id,
          bill_ref: x.data.bill_ref,
          due_date: x.data.due_date,
          dr_minor: x.data.dr_minor,
          cr_minor: x.data.cr_minor
        }
  );
  const what = isTb ? ' (trial balance as at ' + ctx.as_at + ')' : ' (open ' + (tag === 'payable' ? 'bills' : 'invoices') + ' as at ' + ctx.as_at + ')';
  return {
    rows,
    date: ctx.as_at,
    currency: ctx.currency,
    client_ref: ctx.client_ref || 'movein:' + tag + ':' + ctx.as_at,
    by: ctx.by || null,
    narration: 'Opening balances moved in from ' + SOURCE_WORD[planned.source] + what
  };
}
/**
 * apply(h, entity, pl, ctx) — the plan written on the caller's ONE transaction, then its MATCH PROOF built and kept with it (W1.10, b765).
 * HELD rows are written nowhere: each is counted and listed with its code and sentence. → { kind, source, added, merged, skipped, held, rows, notes,
 * entry?, source_code_written?, proof, proof_stored, import_id }
 */
async function apply(h, entity, pl, ctx) {
  const k = pl.kind,
    out = { kind: k, source: pl.source, added: 0, merged: 0, skipped: 0, held: 0, rows: [], notes: pl.notes || [] };
  const skipped = (row, sentence) => {
    out.skipped++;
    out.rows.push({ line: row.line, what: row.what, why: sentence || row.why });
  };
  if (pl.refusal) throw refuse(pl.refusal);
  pl.rows
    .filter((x) => x.action === 'hold')
    .forEach((x) => {
      out.held++;
      out.rows.push({ line: x.line, what: x.what, why: x.why, code: x.code });
    });
  const live = Object.assign({}, pl, { rows: pl.rows.filter((x) => x.action !== 'hold') });
  if (k === 'accounts') await applyAccounts_(h, entity, live, ctx, out, skipped);
  else if (k === 'contacts') await applyContacts_(h, entity, live, ctx, out, skipped);
  else if (k === 'items') await applyItems_(h, entity, live, out, skipped);
  else await applyOpening_(h, entity, live, ctx, out, skipped);
  const proofs = require('./move-in-proof');
  out.proof = proofs.build(pl, out, ctx);
  const kept = await proofs.store(h, entity, { proof: out.proof, by: ctx.by || null });
  out.proof_stored = kept.stored;
  out.import_id = kept.import_id;
  if (!kept.stored) out.notes = out.notes.concat([kept.why]);
  return out;
}

/** the skipped rows as a .csv a person downloads (line · what · why) */
function skippedCsv(rows) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return ['line,what,why'].concat((rows || []).map((item) => [item.line, item.what, item.why].map(q).join(','))).join('\n') + '\n';
}

module.exports = {
  KINDS,
  KIND_KEYS,
  SOURCES,
  MAX_ROWS,
  ADDED_VIA,
  NAME_ROLES,
  readFile,
  guess,
  cells,
  plan,
  world,
  apply,
  afterCommit,
  skippedCsv,
  toMinor,
  isoDate,
  moneyWords,
  kindOf,
  sourceOf,
  chartIndex,
  accountCode,
  taxCodesSeen
};
