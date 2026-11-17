/* cb-accounts.cjs — CB ACCOUNTS, THE LEDGER AS ITS OWN PAGE, PROVED (docs/design/cb-accounts/CLOUD-TASK.md · docs/design/SYSTEM.md §4).
 * Pattern: books-web.cjs + index-page.cjs — Playwright, a stand-in API answering INSIDE the page; the static server takes a
 * free port from the OS. Nothing here reaches localhost:3000, port 7351 or the live site: every /api/** call is fulfilled by
 * ctx.route before it can leave the browser (and the page is made to refuse any other host).
 *
 *  1  the page loads signed in; the sidebar lists every view (the designer's twelve, Bills after Dues) and each opens its screen
 *  2  Ledgers: the three sections, their groups (decided by CODE), search with highlight, class chips with counts, Expand /
 *     Collapse all, a Dr/Cr balance from ONE trial-balance read (never one read per row), a click opens that ledger
 *  3  Bills: the two system folders as two tabs, the server's step chip on each bill, a bill opens the chit sheet in place
 *  4  the avatar menu: Profile → the app's profile · Sign out ends the session; ⌂ Home → /
 *  5  Ledger off: one card; the owner's Switch on → confirm → POST enable ONCE → the page fills; a co-assist is told to ask the owner
 *  6  the one-shop gate: another shop's fingerprint stops the page before any read; a session replaced by another shop signs it out
 *  7  phone: 390 px is an icon rail and document.scrollWidth === 390 on every view; a table is one card per row
 *  +  the page's own source: no alert(), no "accounting" / "books of account"; no page error; the designer's pairs read at AA
 *  8  THE LISTS ROUND (Athi 2026-10-09): ZEBRA on the ledger / statement tables and on the list rows (one token shade, hover distinct) · NO LAYOUT JUMP: the whole frame (menu, title, the rows' room, the kural's
 *     room) is in the first paint and only the rows change · the ledger entries keep their stripe on a phone card
 * Screenshots: e2e/shots/cb-accounts-{laptop,phone,ledgers,off}.png · e2e/shots/lists/accounts-{ledger-zebra}-{1366,390}.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.CBA_PUB || path.join(ROOT, 'public');        /* CBA_PUB=<dir> runs against another copy (cb-accounts-breaks.cjs) */
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const TODAY = new Date().toISOString().slice(0, 10);
const FYNOW = (() => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); })();
/* the menu's views in the menu's order (A1), plus Bank and the Month & year end pages — [tab id, label, a test id that only that screen paints] */
const VIEWS = [
  ['todo', 'To do', '[data-testid="todo-list"]'], ['daybook', 'Day book', '[data-testid^="db-entry-"]'], ['ledgers', 'Ledgers', '[data-testid="lt-band-people"]'],
  ['tb', 'Trial balance', '[data-testid="tb-balanced"]'], ['pl', 'P&L', '[data-testid="pl-profit"]'],
  ['bs', 'Balance sheet', '[data-testid="bs-balanced"]'], ['compare', 'Parallel run', '[data-testid="cmp"]'],   /* PR1 (e2e/walk-compare.cjs walks it) */
  ['bank', 'Bank', '[data-testid="bank-form"], [data-testid="bank-none"]'],
  /* A1 (Athi, 2026-10-03 · T20/T21): Outstandings > Receivables · Payables · Bills · Cheques; Waiting is not a menu item (a failed posting is a To do item) */
  /* ACC-175: Dues (both sides together) has its own button, first in Outstandings; the bills item is named "Unpaid bills" */
  ['dues', 'Dues', '[data-testid="dues-list"]'], ['receivables', 'Receivables', '[data-testid="dues-side-rcv"]'], ['payables', 'Payables', '[data-testid="dues-side-pay"]'],
  ['bills', 'Unpaid bills', '[data-testid="bills-list"]'], ['cheques', 'Cheques', '[data-testid="chq-chq9"]'],
  ['lock', 'Month lock', '[data-testid="lk_fy"]'],
  ['closingstock', 'Closing stock', '[data-testid="ps-form"]'], ['assets', 'Assets & depreciation', '[data-testid="assets-list"]'], ['accruals', 'Accruals & recurring', '[data-testid="recurring-list"]'],
  ['gstclose', 'GST close & pay', '[data-testid="pg-form"]'], ['yearclose', 'Year close', '[data-testid="py-res"]'],
  ['packs', 'Packs', '[data-testid="pk_fy"]'], ['opening', 'Opening balances', '[data-testid="ob-root"]'],
  ['accounts', 'Shop ledgers', '[data-testid="ac_name"]'],
  ['movein', 'Move in', '[data-testid="mi-steps"]'],   /* IM1: move in from Xero / QuickBooks (e2e/walk-move-in.cjs walks it) */
  ['rates', 'Rates', '[data-testid="fx"]'],   /* FX1: exchange rates, the last Setup item (e2e/walk-fx.cjs walks it) */
];
/* the control accounts' own statements: every line carries its party_id; the cashier (`by`) is the owner, never the party */
const LINE = (id, date, no, party, dr, cr, run, kind, by) => ({ date, what: kind === 'purchase' ? 'Purchase' : 'Sale', ref: null, party_id: party, source_chit_id: id, dr_minor: dr, cr_minor: cr, running_minor: run,
  entry_id: 'e-' + date, entry_no: null, event_type: null, reverses_entry_id: null, reversed_by: null,   /* PERF1 / M29: a ledger line names its entry and its reversal pair (the contract's keys; the journal's entry_id is the same 'e-' + date) */
  source: books.source({ kind: kind || 'bill', ref: no, chit_id: id, how: kind === 'purchase' ? null : 'On credit', counter: kind === 'purchase' ? null : 'C2', by }) });
const L1 = LINE('k1', '2026-09-05', 'C2/26-27/0016', 'c1', 300000, 0, 300000, 'bill', 'Mayur Bhavan');
const L2 = LINE('k2', '2026-09-06', 'C2/26-27/0017', 'c2', 300000, 0, 600000, 'bill', 'Mayur Bhavan');
const P1 = LINE('k3', '2026-09-03', 'AM-81', 's1', 0, 150000, -150000, 'purchase', 'Ravi');
const P2 = LINE('k4', '2026-09-04', 'KV-12', 's2', 0, 100000, -250000, 'purchase', 'Ravi');
const CONTROL = {
  '1300': books.ledger('1300', 'Customers (Sundry Debtors)', [L1, L2], { closing_minor: 600000 }),
  '2100': books.ledger('2100', 'Suppliers (Sundry Creditors)', [P1, P2], { closing_minor: -250000 }),
};
/* the journal behind a sale: its Dr/Cr lines, each tax and sales line carrying its rate the way the frozen invoice holds it.
   PERF1: an opened ledger line reads its own entry by id (GET /daybook?entries=<entry_id>), so the entry's id must be the one the statement line names ('e-' + date, lib/books-api.cjs) */
const JOURNAL = [['k1', '2026-09-05', 'C2/26-27/0016', 'c1', 'Ravi Stores', 11], ['k2', '2026-09-06', 'C2/26-27/0017', 'c2', 'Chola Auto Care', 12]].map(([id, d, no, pid, pname, n]) => ({ entry_id: 'e-' + d, entry_no: 'JV/2026-27/0000' + n, posting_date: d, doc_date: d, event_type: 'sale_bill', source_chit_id: id, reverses_entry_id: null, narration: 'Sale',
  source: books.source({ kind: 'bill', ref: no, chit_id: id, how: 'On credit', counter: 'C2', by: 'Mayur Bhavan' }),
  lines: [{ code: '1300', name: 'Customers (Sundry Debtors)', party_id: pid, party_name: pname, dr_minor: 300000, cr_minor: 0, counter: 'C2', rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, rate: 12, dr_minor: 0, cr_minor: 267857, counter: 'C2' },
    { code: '2200', name: 'Output CGST', party_id: null, party_name: null, rate: 6, dr_minor: 0, cr_minor: 16072, counter: 'C2' }, { code: '2201', name: 'Output SGST', party_id: null, party_name: null, rate: 6, dr_minor: 0, cr_minor: 16071, counter: 'C2' }] }));
const PARTY_LINES = { c1: [Object.assign({}, L1, { running_minor: 300000 })], c2: [Object.assign({}, L2, { running_minor: 300000 })], s1: [P1], s2: [Object.assign({}, P2, { running_minor: -100000 })] };

/* ── the stand-in: one shop's chart, its trial balance, its two bills folders ───────────────────────────────── */
function standIn(over) {
  return Object.assign({
    calls: [], enabled: true, enables: 0, healthStatus: null,
    accounts: [
      { code: '1300', name: 'Customers (Sundry Debtors)', is_group: false }, { code: '1300-P00001', name: 'Ravi Stores', is_group: false },
      { code: '2100', name: 'Suppliers (Sundry Creditors)', is_group: false }, { code: '2100-P00003', name: 'Agro Mills', is_group: false },
      { code: '1400', name: 'Cash', is_group: false }, { code: '1500', name: 'Bank', is_group: false, role: 'bank' }, { code: '1510', name: 'UPI collections', is_group: false },
      { code: '1200', name: 'Stock-in-hand', is_group: false }, { code: '2200', name: 'Output CGST', is_group: false }, { code: '2210', name: 'Input CGST', is_group: false },
      { code: '2220', name: 'TDS payable', is_group: false }, { code: '2900', name: 'Suspense', is_group: false },
      { code: '3000', name: 'Capital', is_group: false }, { code: '3900', name: 'Profit and loss (retained)', is_group: false },
      { code: '4000', name: 'Sales', is_group: false }, { code: '4200', name: 'Interest received', is_group: false },
      { code: '5000', name: 'Purchases', is_group: false }, { code: '6000', name: 'Expenses', is_group: true }, { code: '6010', name: 'Rent', is_group: false },
      { code: '6090', name: 'Bank charges', is_group: false }, { code: '6900', name: 'Round off', is_group: false },
      { code: '7777', name: 'A code the design never named', is_group: false },
    ],
    tb: [
      { code: '1300', name: 'Customers (Sundry Debtors)', dr_minor: 600000, cr_minor: 0 }, { code: '2100', name: 'Suppliers (Sundry Creditors)', dr_minor: 0, cr_minor: 250000 },
      { code: '1400', name: 'Cash', dr_minor: 1240000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 1590000 },
      { code: '6010', name: 'Rent', dr_minor: 100000, cr_minor: 0 }, { code: '1510', name: 'UPI collections', dr_minor: 0, cr_minor: 0 },
    ],
    folders: [
      { folder_id: 'a0000000-0000-5000-8000-000000002100', parent_id: null, name: 'Bills · Received', code: 'B-2100', kind: 'view', system: true, scope: null, side: 'received', count: 2, total: 3 },
      { folder_id: 'a0000000-0000-5000-8000-000000001300', parent_id: null, name: 'Bills · Issued', code: 'B-1300', kind: 'view', system: true, scope: null, side: 'issued', count: 1, total: 2 },
      { folder_id: 'a0000000-0000-5000-8000-000000001400', parent_id: null, name: 'Receipts', code: 'R-1400', kind: 'view', system: true, scope: null, side: null, count: 1, total: 1 },
      { folder_id: 'c0000000-0000-4000-8000-00000000000b', parent_id: null, name: 'Urgent', scope: 'task', kind: 'filed', count: 1 },
    ],
    bills: {
      'a0000000-0000-5000-8000-000000002100': [
        { chit_id: 'rb1', bill_no: 'AM-81', manual_subject: 'Bill AM-81 from Agro Mills', counterparty_name: 'Agro Mills', value: '481.65', currency: 'INR', doc_kind: 'bill_received',
          bill: { step: 'goods_checked', code: 'B-2100', label: 'Goods checked', by: 'chola-ravi', at: '2026-10-01T08:50:00Z', open: true, paid: false } },
        { chit_id: 'rb2', bill_no: 'AM-82', manual_subject: 'Bill AM-82 from Agro Mills', counterparty_name: 'Agro Mills', value: '1200', currency: 'INR', doc_kind: 'bill_received',
          bill: { step: 'disputed', code: 'DSP', label: 'Bill refused', by: 'chola-ravi', at: '2026-10-02T04:30:00Z', open: true, paid: false } }],
      'a0000000-0000-5000-8000-000000001300': [
        { chit_id: 'ib1', bill_no: 'C1/26-27/0041', manual_subject: 'Bill C1/26-27/0041 to Ravi Stores', counterparty_name: 'Ravi Stores', value: '1880', currency: 'INR', doc_kind: 'bill_issued',
          bill: { step: 'issued', code: 'B-1300', label: 'Issued — waiting on payment', by: 'mani', at: '2026-10-01T05:10:00Z', open: true, paid: false } }],
    },
    waiting: [{ id: 1, chit_id: 'ch7', ref: 'bill:ch7', why: 'Paid by Points — there is no ledger for Points yet.', tries: 3, since: '2026-09-28T10:00:00Z' }],
    last: null,
  }, over || {});
}
const claims = (h) => { try { return JSON.parse(Buffer.from(String(h || '').replace(/^Bearer /, '').split('.')[1], 'base64').toString()); } catch (_) { return {}; } };
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  S.calls.push(m + ' ' + p + u.search);
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
  /* "Your work" on the shell's rail: the API's keys (truncated · counts · lines · figures), nothing waiting */
  if (p === '/api/work/facts') return J(r, 200, { truncated: false, counts: { orders_in: 0, orders_out: 0, tasks: 0, done: 0 }, lines: [], figures: { orders_new: 0, tasks_mine: 0, orders_in: 0, orders_out: 0, tasks: 0, done: 0 } });
  if (p === '/api/folders' && m === 'GET') return J(r, 200, { folders: S.folders });
  let x;
  if ((x = p.match(/^\/api\/folders\/([^/]+)\/chits$/))) return J(r, 200, { chits: S.bills[x[1]] || [] });
  if (p.startsWith('/api/books')) {
    if (p === '/api/books/enable' && m === 'POST') { S.enables++; S.enabled = true; return J(r, 200, books.enable()); }
    if (!S.enabled) return J(r, 404, { error: 'Not found' });
    if (p === '/api/books/health') { if (S.healthStatus) return J(r, S.healthStatus, { error: 'down' }); return J(r, 200, books.health({ waiting: S.waiting.map((w) => books.waitingRow({ id: w.id, chit_id: w.chit_id, ref: w.ref, reason: w.why, tries: w.tries, since: w.since, todo: w.todo || 'record', name: w.name || null })) })); }
    if (p === '/api/books/accounts' && m === 'GET') return J(r, 200, { accounts: S.accounts.map((a) => books.accountRow(Object.assign({ account_id: 'acc-' + a.code }, a))) });
    if (p === '/api/books/opening' && m === 'GET') return J(r, 200, { date: null, default_date: '2026-04-01', lines: [], pinned: [{ code: '1400' }, { code: '3000' }] }); /* the opening page (l16): nothing saved yet, the pack's pinned ledgers */
    if (p === '/api/books/opening/years' && m === 'GET') return J(r, 200, { years: [] });
    if (p === '/api/books/trial-balance') { S.last = u.searchParams.get('asOf'); return J(r, 200, books.trialBalance(S.tb, { total_dr_minor: 1940000, total_cr_minor: 1840000, balanced: false })); }
    if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) { const pl = PARTY_LINES[x[1]] || []; return J(r, 200, books.statement(x[1], { opening_minor: 0, closing_minor: pl.length ? pl[pl.length - 1].running_minor : 0, lines: pl.map((l) => ({ date: l.date, what: l.what, ref: l.ref, source_chit_id: l.source_chit_id, entry_id: l.entry_id, source: l.source, dr_minor: l.dr_minor, cr_minor: l.cr_minor, running_minor: l.running_minor })) })); }
    if (p === '/api/books/ledger/4000') return J(r, 200, books.ledger('4000', 'Sales', Array.from({ length: 80 }, (_, i) => ({ date: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), what: 'Sale', ref: 'SV/2026-27/' + String(i + 1).padStart(6, '0'), source_chit_id: null, source: null, dr_minor: 0, cr_minor: 10000 + i })), { closing_minor: -1000 * 80 }));
    if (p === '/api/books/ledger/1500') return J(r, 200, books.ledger('1500', 'Bank', [], { opening_minor: 500000, closing_minor: 500000 }));
    if (p === '/api/books/ledger/6010') return J(r, 200, books.ledger('6010', 'Rent', [{ date: '2026-09-03', what: 'Expense', ref: 'JV/2026-27/000005', source_chit_id: 'x1', source: { kind: 'expense', ref: 'C2/26-27/0003', chit_id: 'x1' }, dr_minor: 100000, cr_minor: 0, running_minor: 100000 }], { closing_minor: 100000 }));
    if ((x = p.match(/^\/api\/books\/ledger\/([^/]+)$/)) && CONTROL[x[1]]) return J(r, 200, Object.assign({}, CONTROL[x[1]], { lines: CONTROL[x[1]].lines.concat(((S.extra && S.extra[x[1]]) || []).map((l) => Object.assign({ doc_date: l.date }, l))) }, S.closing && S.closing[x[1]] != null ? { closing_minor: S.closing[x[1]] } : {}));
    if ((x = p.match(/^\/api\/books\/ledger\/([^/]+)$/))) return J(r, 200, books.ledger(x[1], 'Cash', [{ date: '2026-09-02', what: 'Sale', ref: 'JV/2026-27/000001', source_chit_id: null, source: null, dr_minor: 1240000, cr_minor: 0, running_minor: 1240000 }], { closing_minor: 1240000 }));
    if (p === '/api/books/daybook') return J(r, 200, books.daybook(JOURNAL.concat([{ entry_id: 'e1', entry_no: 'JV/2026-27/000001', posting_date: TODAY, doc_date: TODAY, event_type: 'walkin_day', source_chit_id: null, reverses_entry_id: null, narration: 'Walk-in sales',
      source: books.source({ kind: 'day', counter: 'C1', count: 11, how: 'Cash', split: [{ how: 'Cash', amount_minor: 124000 }] }), lines: [{ code: '1400', name: 'Cash', party_id: null, party_name: null, dr_minor: 124000, cr_minor: 0, counter: 'C1', rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, dr_minor: 0, cr_minor: 124000, counter: 'C1', rate: null }] }]).map((e) => Object.assign({ reversed_by: null, reversed_by_id: null }, e))));   /* the contract's reversal pair, null = not reversed */
    if (p === '/api/books/todo') return S.todoStatus ? J(r, S.todoStatus, { error: 'down' }) : J(r, 200, (S.todo || [
      { kind: 'bills_to_accept', count: 1, words: '1 supplier bill is waiting for you to confirm the goods. Confirm them and they post.', action: { label: 'Open the bills', screen: 'waiting', call: 'GET /api/books/health' } },
      { kind: 'months_not_locked', count: 2, words: '2 months are over but still open: August 2026, September 2026.', action: { label: 'Lock the months', screen: 'periods', call: 'POST /api/books/periods/:fy/:period/lock' } }]).map(books.todoRow));
    if (p === '/api/books/dues') return J(r, 200, books.dues([
      { party_id: 'c1', party_no: 'P-00001', name: 'Ravi Stores', side: 'customer', balance_minor: 300000, oldest_due: '2026-08-01', disputed_minor: 0, buckets: { not_due: 0, lt_6m: 300000 } },
      { party_id: 'c2', party_no: 'P-00002', name: 'Chola Auto Care', side: 'customer', balance_minor: 300000, oldest_due: '2026-09-06', disputed_minor: 0, buckets: { not_due: 0, lt_6m: 300000 } },
      { party_id: 's1', party_no: 'P-00003', name: 'Agro Mills', side: 'supplier', balance_minor: -150000, oldest_due: '2026-09-03', disputed_minor: 0, buckets: { not_due: -150000 } },
      { party_id: 's2', party_no: 'P-00004', name: 'Kavi Traders', side: 'supplier', balance_minor: -100000, oldest_due: '2026-09-04', disputed_minor: 0, buckets: { not_due: -100000 } }], { asOf: TODAY }));
    if (p === '/api/books/cheques') return J(r, 200, books.cheques({ cheques: [{ payment_id: 'chq9', party_id: 'c2', name: 'Meena Traders', amount_minor: 50000, cheque_no: '778899', cheque_bank: 'SBI', status: 'cheque_received', next: ['deposited'] }] }));   /* the contract's keys beside them: asOf · pdc_reminders · remind */
    if (p === '/api/books/pl') return J(r, 200, books.pl([{ code: '4000', name: 'Sales', amount_minor: 1590000 }], [{ code: '6010', name: 'Rent', amount_minor: 100000 }], { profit_minor: 1490000 }));
    if (p === '/api/books/bs') return J(r, 200, books.bs([{ code: '1300', name: 'Debtors', amount_minor: 600000 }], [], [], { total_assets_minor: 600000, total_liab_equity_minor: 600000, balanced: true }));
    if (p === '/api/books/packs') return J(r, 200, { packs: [] });
    if (p === '/api/books/periods') return J(r, 200, books.periods([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => books.periodRow(FYNOW, n, n === 5 ? 'soft_locked' : 'open'))));
    return J(r, 404, { error: 'no stand-in for ' + p });
  }
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];

  const tokFor = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
  const OWNER = { token: tokFor({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
  const RAVI = { token: tokFor({ identity_id: 'act-1', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Ravi' }), role: 'actor', name: 'Ravi', entity: 'Mayur Bhavan' };

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    /* Playwright runs the LAST-registered matching route first: the catch-all goes in first so the stand-in below wins for /api/**
       (the page resolves its API base to localhost:3000 on a 127.0.0.1 page — the stand-in answers it; nothing is ever sent) */
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    if (o.session !== null) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, o.session || OWNER);
    if (o.delay) await ctx.route('**/api/**', async (r) => { await new Promise((x) => setTimeout(x, o.delay)); r.fallback(); });   /* a slow line: the first paint must already be the whole frame */
    if (o.seed) await ctx.addInitScript(o.seed);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + (o.path || '/accounts.html'));
    if (process.env.CBA_DEBUG) { await p.waitForTimeout(1500); console.log('DEBUG', threw, (await p.evaluate(() => document.body.innerText)).slice(0, 300)); }
    return { ctx, p };
  }
  const bad = async (p, where) => {
    const t = await p.evaluate(() => document.body.innerText);
    ok(!/accounting|books of account/i.test(t), where + ': "accounting" / "books of account" appear nowhere');
  };
  const nav = (p, id) => p.click('[data-testid="acc-nav-' + id + '"]');
  /* Dues · Month lock · Packs, looked at on a laptop and at 390 px (PR: ledger panels): at most three columns, nothing cut off, no sideways scroll */
  async function panelShots(p, tag, w) {
    await nav(p, 'receivables'); await p.waitForSelector('[data-testid="dues-side-rcv"]'); await p.waitForTimeout(350);
    const d = await p.evaluate(() => { const h = document.querySelector('#bkl_dues .lhead') || document.querySelector('#bkt_dues .lhead'); const cells = h ? Array.from(h.children).filter((c) => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none' && c.textContent.trim() !== '') : [];   /* M28: the buttons column (no heading) is not a data column */ return { n: cells.length, txt: cells.map((c) => c.className + ':' + JSON.stringify(c.textContent.trim())), found: !!h, sw: document.documentElement.scrollWidth, over: Array.from(document.querySelectorAll('#bk_body *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }; });
    console.log('  dues header found=' + d.found + ' cells=' + d.n + ' ' + JSON.stringify(d.txt));
    ok(d.n <= 3 && d.over === 0 && d.sw <= w, 'Dues ' + tag + ': ' + d.n + ' columns by default (at most 3), nothing past the right edge (' + d.over + '), no sideways scroll (' + d.sw + ')');
    await p.screenshot({ path: path.join(SHOTS, 'dues-' + tag + '.png') });
    await nav(p, 'lock'); await p.waitForSelector('[data-testid="lk-row-12"]'); await p.waitForTimeout(250);
    const l = await p.evaluate(() => ({ rows: document.querySelectorAll('[data-testid^="lk-row-"]').length, aug: document.querySelector('[data-testid="lk-state-5"]').textContent, off: Array.from(document.querySelectorAll('#bk_body *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length, sw: document.documentElement.scrollWidth }));
    ok(l.rows === 12 && /Locked/.test(l.aug) && l.off === 0 && l.sw <= w, 'Month lock ' + tag + ': twelve rows, August says Locked, nothing cut off or sideways');
    await p.screenshot({ path: path.join(SHOTS, 'month-lock-' + tag + '.png') });
    await nav(p, 'packs'); await p.waitForSelector('[data-testid="pk_build"]'); await p.waitForTimeout(250);
    const k = await p.evaluate(() => { const f = document.querySelector('[data-testid="pk_fy"]'), m = document.querySelector('[data-testid="pk_p"]'); return { fy: f.clientWidth > 60, mo: m.clientWidth > 60, dis: document.querySelector('[data-testid="pk_build"]').disabled, off: Array.from(document.querySelectorAll('#bk_body *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length, sw: document.documentElement.scrollWidth }; });
    ok(k.fy && k.mo && k.dis && k.off === 0 && k.sw <= w, 'Packs ' + tag + ': year and month boxes are whole, nothing sideways');
    await p.screenshot({ path: path.join(SHOTS, 'packs-' + tag + '.png') });
  }
  /* the Ledgers head folds its tools into ONE View chip at every width (foldHead), so the Columns gear is one step inside it */
  const openCols = async (p, kind) => { const b = '[data-testid="cols-btn-' + kind + '"]'; if (!(await p.locator(b).isVisible())) await p.click('[data-testid="cbl-view-menu-' + kind + '"]'); await p.click(b); };
  /* two or more head notes (the figures + a notice, or an agreed-up-to date) fold into ONE chip at every width: its popover holds them, so a check that reads a note opens the chip first */
  const openNotes = async (p, kind, tid) => { await p.waitForSelector('[data-testid="' + tid + '"], [data-testid="cbl-notes-' + kind + '"]', { timeout: 8000 }); if (!(await p.locator('[data-testid="' + tid + '"]').isVisible())) await p.click('[data-testid="cbl-notes-' + kind + '"]'); await p.waitForSelector('[data-testid="' + tid + '"]', { timeout: 8000 }); };
  const width = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

  /* ── the page's own source ── */
  {
    const src = fs.readFileSync(path.join(PUB, 'accounts.html'), 'utf8');
    ok(!/\balert\s*\(/.test(src), 'no alert() anywhere in the page');
    ok(!/accounting|books of account/i.test(src), 'the source carries neither forbidden string');
    ok(/<title>Accounts<\/title>/.test(src), 'the page is named Accounts');
    ok(/CBOnePerson\.attach\(/.test(src), 'the one-shop gate is attached');
    ok(/CBLedger\.run\(/.test(src) && !/booksEnable/.test(src.replace(/CB_BOOKS_EP/g, '')), 'the Switch on goes through CBLedger — the page holds no copy of the enable call');
  }

  /* ── 1 · SIGNED IN, THE LEDGER ON (laptop) ─────────────────────────────────────────────────────────────── */
  {
    const S = standIn();
    const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 });
    await p.waitForTimeout(500);
    ok(/Accounts/.test(await p.textContent('.brand')), 'the brand says Accounts');
    ok(await p.locator('[data-testid="shop-name"]').textContent() === 'Mayur Bhavan', 'the pinned header names the shop');
    const labels = await p.$$eval('#nav .nav-btn', (b) => b.map((x) => x.getAttribute('aria-label')));
    ok(JSON.stringify(labels) === JSON.stringify(VIEWS.map((v) => v[1])), 'the sidebar lists every view, in the menu\'s order: ' + labels.join(' · '));
    ok(await p.evaluate(() => document.querySelector('.titlebar') && getComputedStyle(document.querySelector('.titlebar')).position === 'sticky' && getComputedStyle(document.querySelector('#shell')).position === 'sticky'), 'the frame and the title row are pinned');
    ok(await p.locator('[data-testid="shell-header"]').count() === 1 && await p.locator('[data-testid="shell-home"]').count() === 1 && await p.locator('.home,[data-testid="acc-home"]').count() === 0 && await p.locator('.cbav-btn').count() === 1, 'SHELL-ONE: the frame is the one header — one shell header, one ⌂ Home, no Home of the page\'s own, one avatar');
    /* the menu's groups (Athi, 2026-10-03): To do alone, then Books · Every day · Period end · Setup, each folds; the header's line is level with the brand's */
    const grps = await p.$$eval('#nav .nav-grp', (g) => g.map((x) => x.textContent.trim()));
    ok(JSON.stringify(grps) === JSON.stringify(['Books', 'Outstandings', 'Period end', 'Setup']), 'the menu is grouped: ' + grps.join(' · '));
    ok(await p.$$eval('#nav .nav-sec', (s) => s[1] && Array.from(s[1].querySelectorAll('.nav-btn')).map((b) => b.dataset.view).join(',')) === 'daybook,ledgers,tb,pl,bs,compare,bank', 'Books holds Day book → Balance sheet, Parallel run, Bank');
    ok(await p.$$eval('#nav .nav-sec', (s) => s[2] && Array.from(s[2].querySelectorAll('.nav-btn')).map((b) => b.dataset.view).join(',')) === 'dues,receivables,payables,bills,cheques', 'A1: Outstandings holds Dues · Receivables · Payables · Bills · Cheques');
    ok(await p.locator('[data-testid="acc-nav-waiting"]').count() === 0 && await p.locator('[data-testid="acc-nav-dues"]').count() === 1, 'A1: Waiting is no longer a menu item; Dues is one again, under Outstandings (ACC-175)');
    await p.click('[data-testid="acc-grp-setup"]');
    ok(await p.locator('[data-testid="acc-nav-packs"]').isHidden() && await p.getAttribute('[data-testid="acc-grp-setup"]', 'aria-expanded') === 'false', 'a group folds');
    await p.click('[data-testid="acc-grp-setup"]');
    ok(await p.locator('[data-testid="acc-nav-packs"]').isVisible(), 'and opens again');
    { const hb = await p.evaluate(() => [document.querySelector('.brand').getBoundingClientRect().bottom, document.querySelector('[data-testid="shell-header"]').getBoundingClientRect().bottom].map(Math.round));
      ok(hb[0] === hb[1], 'the header\'s line is level with the brand\'s (' + hb.join(' / ') + ')'); }

    /* ⭐ THE ⚙ COLUMNS CHOOSER IS STYLED ON THIS PAGE TOO (2026-10-02, Athi's live screenshot: on CB Accounts it opened as bare
       arrows and checkboxes strewn down the Day book, because its rules lived only in app.html). It must be a floating panel. */
    await nav(p, 'daybook'); await p.waitForSelector('[data-testid="cols-btn-daybook"]', { timeout: 8000 });
    await p.click('[data-testid="cols-btn-daybook"]'); await p.waitForSelector('[data-testid="cols-menu-daybook"]', { timeout: 5000 });
    const cm = await p.evaluate(() => { const m = document.querySelector('[data-testid="cols-menu-daybook"]'), cs = getComputedStyle(m), r = m.getBoundingClientRect(),
    /* UX-137 tap rule (10 Nov): a desktop arrow is 32 px (was 24; the limit was 26) */
      b = m.querySelector('.cbl-mv'); return { pos: cs.position, z: cs.zIndex, w: r.width, h: r.height, vh: innerHeight, mv: b ? b.getBoundingClientRect().width : 0 }; });
    ok(cm.pos === 'absolute' && cm.w > 150 && cm.w < 420 && cm.h <= cm.vh * 0.62 + 2 && cm.mv > 0 && cm.mv <= 34,
      'Accounts › Day book › ⚙ columns opens as a floating panel (position ' + cm.pos + ', ' + Math.round(cm.w) + '×' + Math.round(cm.h) + ', arrow ' + Math.round(cm.mv) + 'px)');
    await p.locator('[data-testid="cols-menu-daybook"]').screenshot({ path: path.join(__dirname, 'shots', 'cb-accounts-cols-open.png') }).catch(() => {});
    await p.click('[data-testid="cols-btn-daybook"]');

    for (const [id, label, sel] of VIEWS) {
      await nav(p, id);
      const seen = await p.waitForSelector(sel, { timeout: 8000 }).then(() => true, () => false);
      ok(seen, 'the sidebar opens ' + label + ' — its own screen paints (' + sel + ')');
      ok(await p.evaluate((l) => document.querySelector('.nav-btn.active').getAttribute('aria-label') === l, label), label + ' is the one lit in the sidebar');
      await bad(p, label);
      ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), label + ': no horizontal scroll at 1360');
    }
    ok(S.calls.filter((c) => /booksAccounts|\/api\/books\/accounts/.test(c)).length >= 1, 'the Ledgers view read the accounts');

    /* A1 — Receivables shows only the party-owes-you side, Payables only the you-owe side (the Dues list, one side each); the old #dues door still opens; the menu shot */
    {
      await nav(p, 'receivables'); await p.waitForSelector('[data-testid="dues-side-rcv"]'); await p.waitForTimeout(250);
      ok(await p.locator('[data-testid="dues-side-pay"]').count() === 0 && await p.locator('[data-testid="dues-side-rcv"]').count() === 1, 'A1: Receivables lists only what customers owe you');
      await nav(p, 'payables'); await p.waitForSelector('[data-testid="dues-side-pay"]'); await p.waitForTimeout(250);
      ok(await p.locator('[data-testid="dues-side-rcv"]').count() === 0 && await p.locator('[data-testid="dues-side-pay"]').count() === 1, 'A1: Payables lists only what you owe');
      ok(await p.evaluate(() => document.getElementById('title').textContent) === 'Payables', 'A1: the page title says Payables');
      await p.screenshot({ path: path.join(SHOTS, 'small-fixes', 'accounts-menu-1366.png') }).catch(() => {});
      /* ROW STRIPES (avatar menu) on the Day book: Off changes the stripe, and it is still off after a reload */
      await nav(p, 'daybook'); await p.waitForSelector('[data-testid^="db-entry-"]'); await p.waitForTimeout(250);
      const step = () => p.evaluate(() => { const c = document.querySelector('.cbl'); return c ? getComputedStyle(c).getPropertyValue('--cl-zebra').replace(/\s+/g, ' ').trim() : null; });
      const sv = await step();
      ok(!!sv && sv !== 'transparent' && /9%/.test(sv), 'zebra: the Day book stripe is Strong by default - the ink mixed 9% into the card (' + sv + ')');
      await p.click('[data-testid="avatar"]'); await p.waitForSelector('[data-testid="stripes-off"]'); await p.click('[data-testid="stripes-off"]'); await p.waitForTimeout(150);
      const so = await step();
      ok(so === 'transparent', 'zebra: Off removes the Day book stripe (the one token is transparent)');
      await p.reload(); await p.waitForSelector('[data-testid="acc-nav-daybook"]'); await p.waitForTimeout(500);
      ok(await p.evaluate(() => document.documentElement.getAttribute('data-stripes')) === 'off', 'zebra: the choice survives a reload');
      await p.click('[data-testid="avatar"]'); await p.waitForSelector('[data-testid="stripes-strong"]'); await p.click('[data-testid="stripes-strong"]'); await p.waitForTimeout(100);
      await p.keyboard.press('Escape');
    }

    /* ── 2 · LEDGERS — the two-pane page (docs/design/ledgers-page): the tree on the left, the chosen ledger's entries (a CBList) on the right ── */
    S.calls.length = 0;
    await nav(p, 'ledgers');
    await p.waitForSelector('[data-testid="lt-band-people"]');
    const bands = await p.$$eval('[data-testid^="lt-band-"]', (s) => s.map((x) => x.getAttribute('data-testid').replace('lt-band-', '')));
    ok(JSON.stringify(bands) === JSON.stringify(['people', 'things', 'income', 'capital']), 'four bands as the tree\'s top level: People · Things you hold · Income and expenses · Your capital');
    ok(await p.locator('#bk_lt').count() === 1 && await p.locator('.lt-tree').count() === 1 && await p.locator('.lt-pane').count() === 1 && await p.locator('[role="tree"] [role="treeitem"]').count() > 10, 'two panes — the tree (role=tree) and the list');
    ok(await p.locator('[data-testid="lt-band-people"]').getAttribute('aria-expanded') === 'true' && await p.locator('[data-testid="lg-acc-1300"]').count() === 1 && await p.locator('[data-testid^="lg-party-"]').count() === 0, 'the bands and groups are open (the tree is the way in); a control account is a closed ledger with its parties inside');
    const groups = await p.$$eval('[data-testid^="lt-group-"]', (s) => s.map((x) => x.getAttribute('data-testid').replace('lt-group-', '')));
    ok(JSON.stringify(groups) === JSON.stringify(['Cash & bank', 'Stock & advances', 'Duties & taxes', 'Taxes & suspense', 'Other', 'Income', 'Direct costs', 'Operating expenses', 'Adjustments', "Owner's equity"]), 'its groups, decided by code: ' + groups.join(' · '));
    ok(await p.locator('[data-testid="lg-acc-1400"]').count() === 1 && await p.locator('[data-testid="lg-acc-1500"]').count() === 1 && await p.locator('[data-testid="lg-acc-1200"]').count() === 1, 'each group shows its ledgers (Cash, Bank, UPI collections …) as leaves');
    ok(await p.locator('[data-testid="lg-acc-7777"]').count() === 1, 'a code the design never named still appears (Other), never nowhere');
    ok(await p.locator('[data-testid="lg-acc-6000"]').count() === 0 && await p.locator('[data-testid="lg-acc-1300-P00001"]').count() === 0, 'a ledger group (6000) and a per-party sub-account are not leaves');
    ok(await p.locator('[data-testid="lg-acc-3000"]').count() === 1, 'Your capital holds the 3xxx ledgers');
    await p.click('[data-testid="lt-band-income"]');
    ok(await p.locator('[data-testid="lt-band-income"]').getAttribute('aria-expanded') === 'false' && await p.locator('[data-testid="lg-acc-4000"]').count() === 0, 'a band folds: its groups and ledgers go');
    await p.click('[data-testid="lt-band-income"]');
    ok(await p.locator('[data-testid="lg-acc-4000"]').count() === 1, 'and opens again');
    /* the names are the shopkeeper's: the official name's bracket is dropped; the full name is the tooltip */
    ok((await p.textContent('[data-testid="lg-acc-1300"] .nm')).trim() === 'Customers' && (await p.getAttribute('[data-testid="lg-acc-1300"]', 'title')) === 'Customers (Sundry Debtors)', 'a ledger is called "Customers", its official name "Customers (Sundry Debtors)" is the tooltip (display only)');
    /* the balances: Dr / Cr, from ONE trial-balance read */
    ok(/Dr/.test(await p.textContent('[data-testid="bal-1400"]')) && /12,400/.test(await p.textContent('[data-testid="bal-1400"]')), 'Cash: ₹12,400.00 Dr on its leaf');
    ok(/Cr/.test(await p.textContent('[data-testid="bal-4000"]')), 'Sales: a Cr balance');
    ok((await p.textContent('[data-testid="bal-4200"]')).trim() === '—', 'a ledger the trial balance does not list says "—", not a made-up nil');
    const tbReads = S.calls.filter((c) => /\/api\/books\/trial-balance/.test(c)).length;
    ok(tbReads === 1, 'ONE trial-balance read for the whole tree (' + tbReads + ')');
    { const reads = S.calls.filter((c) => /\/api\/books\/ledger\//.test(c)); ok(reads.length === 1 && /\/ledger\/1500/.test(reads[0]), 'no per-leaf balance read; the one ledger opened on its own is the bank-role ledger (W15-90) (' + reads.join(' ') + ')'); }
    await p.screenshot({ path: path.join(SHOTS, 'cb-accounts-ledgers.png'), fullPage: true });
    await p.screenshot({ path: path.join(SHOTS, 'one-table-ledgers-laptop.png'), fullPage: false });

    /* ⭐ THE TREE ITSELF: one line per node, the figures in one aligned column, a light selection, nothing cut off */
    {
      const t = await p.evaluate(() => { const rows = Array.from(document.querySelectorAll('#lt_tree .tn')), tr = document.querySelector('#lt_tree').getBoundingClientRect();
        const am = rows.map((r) => r.querySelector('.am')).filter((a) => a && a.textContent.trim());
        return { h: rows.map((r) => ({ id: r.getAttribute('data-testid'), name: r.querySelector('.nm').textContent.trim(), h: Math.round(r.getBoundingClientRect().height) })), rights: Array.from(new Set(am.map((a) => { const r = document.createRange(); r.selectNodeContents(a); return Math.round(r.getBoundingClientRect().right); }))),   /* where the TEXT ends, not the box */
          cut: rows.filter((r) => r.lastElementChild.getBoundingClientRect().right > tr.right + 0.5 || r.querySelector('.nm').scrollWidth > r.querySelector('.nm').clientWidth + 1).length, sw: document.querySelector('#lt_tree').scrollWidth <= document.querySelector('#lt_tree').clientWidth + 1 }; });
      const long = t.h.filter((x) => x.name.length > 22), oneLine = t.h.filter((x) => x.name.length <= 22);
      ok(oneLine.length > 12 && oneLine.every((x) => x.h <= 40), 'the tree: one node on one line (heights ' + oneLine.map((x) => x.h).join(',') + ')');
      ok(long.length === 1 && long[0].h > 40, 'a long name WRAPS — it is never clipped ("' + (long[0] && long[0].name) + '", ' + (long[0] && long[0].h) + ' px)');
      ok(t.rights.length === 1 && t.cut === 0 && t.sw, 'every figure and count sits in ONE aligned column (' + t.rights.join(',') + '); nothing is cut short; no sideways scroll');
    }
    ok(await p.locator('#lt_tree .tn[tabindex="0"]').count() === 1, 'the tree has one tab stop');

    /* the find box filters as you type and marks the match; a code finds its ledger */
    const F1 = '[data-testid="lt-find"]';
    await p.fill(F1, '6010');
    ok(await p.locator('[data-testid^="lg-acc-"]').count() === 1 && await p.locator('[data-testid="lg-acc-6010"]').count() === 1, 'typing 6010 leaves that one ledger (Rent), its folders open');
    await p.fill(F1, 'bank');
    ok(await p.locator('[data-testid^="lg-acc-"]').count() === 2 && await p.locator('#lt_tree [data-testid^="lg-acc-"] mark').count() === 2 && /^bank$/i.test(await p.locator('#lt_tree [data-testid^="lg-acc-"] mark').first().textContent()), 'a name search matches Bank and Bank charges, and marks the match');
    await p.fill(F1, 'zzzz');
    ok(/No ledger or party called/.test(await p.textContent('[data-testid="lt-tree"]')) && await p.locator('[data-testid="lt-clear"]').count() === 1, 'no match → one line and a Clear');
    await p.click('[data-testid="lt-clear"]');
    ok((await p.inputValue(F1)) === '' && await p.locator('[data-testid="lg-acc-1400"]').count() === 1, 'Clear brings the tree back');
    await p.fill(F1, 'ravi');
    ok(await p.locator('[data-testid="lg-party-c1"]').count() === 1 && await p.locator('[data-testid="lg-party-c2"]').count() === 0 && await p.locator('[data-testid="lg-acc-1300"]').getAttribute('aria-expanded') === 'true', 'typing a party\'s name finds the party, under its open control account');
    await p.fill(F1, '');

    /* keyboard: ↑ ↓ move · → opens or steps in · ← closes or steps out · Home / End · Enter opens */
    {
      const focused = () => p.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) || '');
      await p.focus('[data-testid="lt-band-people"]');
      await p.keyboard.press('ArrowDown'); const k1 = await focused();
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80);
      const k2 = await p.locator('[data-testid="lg-acc-1300"]').getAttribute('aria-expanded');
      await p.keyboard.press('ArrowRight'); const k3 = await focused();
      await p.keyboard.press('ArrowLeft'); const k4 = await focused();
      await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(80);
      const k5 = await p.locator('[data-testid="lg-acc-1300"]').getAttribute('aria-expanded');
      await p.keyboard.press('End'); const k6 = await focused(); await p.keyboard.press('Home'); const k7 = await focused();
      ok(k1 === 'lg-acc-1300' && k2 === 'true' && k3 === 'lg-party-c1' && k4 === 'lg-acc-1300' && k5 === 'false' && k6 !== k7 && k7 === 'lt-band-people', 'keyboard: ↓ moves · → opens, then steps in · ← steps out, then closes · Home and End jump (' + [k1, k2, k3, k4, k5, k6, k7].join(' · ') + ')');
      await p.keyboard.press('ArrowDown'); S.calls.length = 0; await p.keyboard.press('Enter');
      await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
      ok(S.calls.some((c) => /\/api\/books\/ledger\/1300/.test(c)), 'keyboard: Enter opens the ledger (GET /api/books/ledger/1300)');
      await p.fill(F1, 'x'); await p.press(F1, 'Escape');
      ok((await p.inputValue(F1)) === '', 'Esc clears the find box');
    }

    /* the tree pane is resizable (drag, ← →), folds, and remembers both */
    {
      const w0 = await p.evaluate(() => document.querySelector('.lt-tree').getBoundingClientRect().width);
      const rz = await p.locator('#lt_rz').boundingBox();
      await p.mouse.move(rz.x + rz.width / 2, rz.y + 200); await p.mouse.down(); await p.mouse.move(rz.x + rz.width / 2 + 60, rz.y + 200, { steps: 4 }); await p.mouse.up();
      const w1 = await p.evaluate(() => document.querySelector('.lt-tree').getBoundingClientRect().width);
      await p.focus('#lt_rz'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
      const w2 = await p.evaluate(() => document.querySelector('.lt-tree').getBoundingClientRect().width);
      ok(w1 > w0 + 40 && w2 < w1 - 20, 'the tree pane resizes — dragged its edge ' + Math.round(w0) + ' → ' + Math.round(w1) + ' px, then ← ← → ' + Math.round(w2));
      await p.click('[data-testid="lt-fold"]');
      ok(await p.locator('.lt-tree').isHidden() && await p.locator('[data-testid="lt-unfold"]').count() === 1 && /Ledgers/.test(await p.textContent('[data-testid="lt-unfold"]')), 'the pane folds to a "☰ Ledgers" button in the title row');
      await p.click('[data-testid="lt-unfold"]');
      ok(await p.locator('.lt-tree').isVisible() && await p.locator('[data-testid="lt-unfold"]').count() === 0, 'one tap brings it back');
    }

    /* band → group → ledger → its entries → expand one → open its bill */
    await p.click('[data-testid="lg-acc-1400"]');
    await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    ok(S.calls.some((c) => /\/api\/books\/ledger\/1400/.test(c)) && (await p.textContent('.cbl-title h1')).trim() === 'Cash' && /Sale/.test(await p.textContent('[data-testid="stmt-row-0"]')), 'clicking Cash reads that ledger (GET /api/books/ledger/1400); its name is the title and its entry is a Task-table row');
    ok(await p.locator('#lg_out .lhead').count() === 1 && await p.locator('#lg_out .lrow').count() === 1 && await p.locator('#lg_out table').count() === 0, 'the entries are the Task table (.lhead / .lrow) — no table of its own');
    /* ZEBRA on the statement table (the party / control-account statement the ledger prints) and on the list rows */
    {
      const z = await p.evaluate(() => {
        const mk = (i) => ({ date: '2026-09-0' + (i + 1), what: 'Sale', ref: null, party_id: 'c1', source_chit_id: null, dr_minor: 1000 * (i + 1), cr_minor: 0, running_minor: 1000 * (i + 1) * (i + 2) / 2 });
        const host = document.createElement('div'); host.id = '__zebra'; host.innerHTML = statementHTML({ currency: 'INR', party_id: 'c1', opening_minor: 0, closing_minor: 10000, lines: [mk(0), mk(1), mk(2), mk(3)] }, 'c1'); document.getElementById('content').appendChild(host);
        const bg = (e) => getComputedStyle(e).backgroundColor, rs = Array.from(host.querySelectorAll('tbody tr')).map(bg); host.remove(); return rs;
      });
      ok(z.length >= 5 && z[0] === z[2] && z[1] === z[3] && z[0] !== z[1], 'ZEBRA: the ledger / statement table alternates its rows from one token shade (' + z.slice(0, 3).join(' / ') + ')');
      await p.screenshot({ path: path.join(SHOTS, 'lists', 'accounts-ledger-zebra-1366.png') }).catch(() => {});
    }
    ok(await p.locator('[data-testid="shell-header"]').count() === 1 && await p.locator('.cbl-title .who,#who').count() === 0 && await p.locator('.cbav-btn').count() === 1, 'the shop · Home · avatar are the frame\'s and stay above the open ledger (SHELL-ONE): one shell header, nothing moved into the title row, one avatar button');
    ok(await p.locator('[data-testid="lg-sum"]').count() === 1 && /^Opening ₹0\.00 · Closing ₹12,400\.00 Dr$/.test((await p.textContent('[data-testid="lg-sum"]')).trim()), 'ONE figures line: "Opening ₹0.00 · Closing ₹12,400.00 Dr"');
    await p.click('[data-testid="lg-acc-1500"]'); await p.waitForFunction(() => /Balance/.test((document.querySelector('[data-testid="lg-sum"]') || {}).textContent || ''), null, { timeout: 8000 });
    ok(await p.locator('[data-testid="lg-sum"]').count() === 1 && /^Balance ₹5,000\.00 Dr$/.test((await p.textContent('[data-testid="lg-sum"]')).trim()), 'opening = closing → ONE word "Balance ₹5,000.00 Dr", said once');
    await p.click('[data-testid="lg-acc-1400"]'); await p.waitForSelector('[data-testid="stmt-row-0"]');
    ok(await p.locator('.lt-tree [data-testid="lg-acc-1400"] .am').evaluate((e) => !e.textContent.trim()), 'the open ledger shows no figure in the tree — the title row beside it already does');
    await p.screenshot({ path: path.join(SHOTS, 'ledgers-plain.png') });

    /* ── 2a · THE LEDGERS QUICK FIXES (2026-10-03): nothing repeated, Dr/Cr, nothing cut off ── */
    const noMinus = async (sel) => !/[-−]\s?₹?\s?\d/.test((await p.$$eval(sel, (n) => n.map((x) => x.textContent).join(' | '))));
    ok(await p.locator('#lg_from, #lg_to').count() === 0 && await p.locator('[data-testid="cbl-period-ledger-plain"]').count() === 1, 'the head is the CBList period chip — no date boxes, no Show button');
    ok(await p.locator('#lg_out .cbl-list').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'the ledger list does not scroll sideways (columns fit; the gear keeps the rest)');
    {
      const fit = await p.evaluate(() => { const l = document.querySelector('#lg_out').getBoundingClientRect(), k = document.querySelector('[data-testid="kural-footer"]'), kr = k && !k.hidden ? k.getBoundingClientRect() : null; return { bottom: Math.round(l.bottom), limit: Math.round(kr ? kr.top : innerHeight), kural: !!kr, doc: document.documentElement.scrollHeight <= innerHeight + 1 }; });
      ok(fit.bottom <= fit.limit + 1 && fit.doc, 'only the rows scroll: the list ends where the kural footer begins (' + fit.bottom + ' ≤ ' + fit.limit + '), the page itself does not scroll');
    }
    { const h = await p.$$eval("#lg_out .cbl-hdr .cbl-hc", (n) => n.map((x) => x.textContent.trim())); ok(h.map((x) => x.replace(/[⇅▲▼]/g, "").trim()).join() === "Date,Details,Spent,Received,Balance" && /▲/.test(h[0]), "W15-87/88 · a cash ledger: Date (▲ = oldest first, the order the rows are in) · Details · Spent · Received · Balance (" + h.join(" | ") + ")"); }
    /* only the rows scroll: a LONG ledger (80 lines) scrolls inside the list; the page does not, and its last row is reachable above the kural footer */
    await p.click('[data-testid="lg-acc-4000"]'); await p.waitForSelector('#lg_out .lrow', { timeout: 8000 });
    { const h = await p.$$eval("#lg_out .cbl-hdr .cbl-hc", (n) => n.map((x) => x.textContent.replace(/[⇅▲▼]/g, "").trim())); ok(h.join() === "Date,Details,Amount,Balance", "a plain ledger's default columns: Date · Details · Amount (Dr/Cr) · Balance (W15-88) (" + h.join(" | ") + ")"); }
    {
      const fit = await p.evaluate(async () => { const out = document.querySelector('#lg_out'), l = out.querySelector('.cbl-list'), k = document.querySelector('[data-testid="kural-footer"]'), kr = k && !k.hidden ? k.getBoundingClientRect() : null, limit = kr ? kr.top : innerHeight;
        l.scrollTop = l.scrollHeight; await new Promise((r) => setTimeout(r, 400)); l.scrollTop = l.scrollHeight; await new Promise((r) => setTimeout(r, 300)); const rows = l.querySelectorAll('.lrow'), last = rows[rows.length - 1].getBoundingClientRect();
        return { bottom: Math.round(out.getBoundingClientRect().bottom), limit: Math.round(limit), scrolls: l.scrollHeight > l.clientHeight + 40, doc: document.documentElement.scrollHeight <= innerHeight + 1, lastOk: last.bottom <= limit + 1, kural: !!kr }; });
      ok(fit.scrolls && fit.bottom <= fit.limit + 1 && fit.doc && fit.lastOk, 'only the rows scroll: a long ledger scrolls inside its list, which ends where the kural footer begins (' + fit.bottom + ' ≤ ' + fit.limit + '), the page itself does not scroll, and the last row is reachable');
    }
    await p.click('[data-testid="lg-acc-1400"]'); await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    S.calls.length = 0;
    await p.click('[data-testid="cbl-period-ledger-plain"]'); await p.click('[data-period="month"]');
    await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    ok(S.calls.some((c) => /\/api\/books\/ledger\/1400\?.*from=\d{4}-\d\d-01/.test(c)), 'picking This month on the chip reads the ledger again for that month');
    await p.click('[data-testid="lg-acc-6010"]'); await p.waitForFunction(() => /Expense/.test((document.querySelector('[data-testid="stmt-what-0"]') || {}).textContent || ''), null, { timeout: 8000 });
    const rentWhat = (await p.textContent('[data-testid="stmt-what-0"]')).replace(/\s+/g, ' ').trim();
    ok(!/Expense · Expense/.test(rentWhat) && /^Expense C2\/26-27\/0003/.test(rentWhat) && rentWhat.split('Expense').length === 2, 'the kind word once: "' + rentWhat + '"');
    ok(await noMinus('#lt_tree') && await noMinus('[data-testid="lg-sum"]') && !/[-−]\s?₹/.test(await p.textContent('#lg_out .cbl-list')) && await p.locator('[data-testid^="stmt-amt-"]').count() >= 1 && await noMinus('[data-testid^="stmt-amt-"]'), 'no minus sign on the Ledgers view — the tree, the figures line, the balances and every amount are Dr / Cr');
    ok(/Dr$/.test((await p.textContent('[data-testid="stmt-amt-0"]')).trim()), 'a row\'s amount is one figure with its side: "' + (await p.textContent('[data-testid="stmt-amt-0"]')).trim() + '"');
    const selBg = await p.evaluate(() => { const e = document.querySelector('#lt_tree .tn.on'); return e ? getComputedStyle(e).backgroundColor : ''; });
    ok(/rgba?\(|color\(/.test(selBg) && !/^rgb\(/.test(selBg), 'the chosen ledger is a light tint (translucent), not a solid block (' + selBg + ')');
    ok(await p.evaluate(() => { const e = document.querySelector('#lt_tree .tn.on'); return getComputedStyle(e, '::before').width === '3px'; }), 'and a 3 px bar');
    await p.click('[data-testid="lg-acc-1400"]'); await p.waitForFunction(() => /Sale/.test((document.querySelector('[data-testid="stmt-what-0"]') || {}).textContent || ''), null, { timeout: 8000 });

    /* ── 2b · PARTY LEDGERS: 1300 and 2100 are LEDGERS whose children are the parties (docs/design/party-ledgers) ── */
    const dueReads = () => S.calls.filter((c) => /\/api\/books\/dues/.test(c)).length;
    const partyReads = () => S.calls.filter((c) => /\/api\/books\/party\//.test(c)).length;
    const rowsOf = async () => p.$$eval('[data-testid^="lg-party-c"], [data-testid^="lg-party-s"]', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const stmtText = async () => p.$$eval('[data-testid^="stmt-what-"]', (t) => t.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const partyCells = async () => p.$$eval('#lg_out .lg-party', (t) => t.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(await p.locator('[data-testid="lg-acc-1300"]').count() === 1 && await p.locator('[data-testid="lg-acc-2100"]').count() === 1 && await p.locator('[data-testid="lg-acc-1300-P00001"]').count() === 0 && await p.locator('[data-testid="lt-group-Other"]').count() === 1, 'People holds Customers and Suppliers as ledgers — and nothing else (no per-party sub-account group)');
    S.calls.length = 0;
    await p.click('[data-testid="lg-acc-1300"]');
    await p.waitForSelector('[data-testid="lg-party-c1"]');
    await p.waitForSelector('[data-testid="stmt-what-0"]');
    let pr = await rowsOf();
    ok(pr.length === 2 && /^Ravi Stores.*₹3,000\.00 Dr$/.test(pr[0]) && /^Chola Auto Care.*₹3,000\.00 Dr$/.test(pr[1]), 'Customers opens into one line per customer — name · balance, ordered by party no (' + pr.join(' | ') + ')');
    ok(await p.locator('[data-testid="lg-acc-1300"]').getAttribute('aria-expanded') === 'true', 'the Customers ledger is open (▾)');
    const sum1 = (await p.textContent('[data-testid="lg-sum"]')).replace(/\s+/g, ' ').trim();
    ok(await p.locator('[data-testid="lg-sum"]').count() === 1 && /^Opening ₹0\.00 · Closing ₹6,000\.00 Dr · ✓ parties agree$/.test(sum1), 'ONE line: opening · closing in Dr/Cr · "✓ parties agree" (' + sum1 + ')');
    ok(await p.locator('[data-testid="lg-parties-total"]').count() === 0 && await p.locator('[data-testid="lg-parties-closing"]').count() === 0 && sum1.split('6,000.00').length === 2 && !/Total of the parties|Ledger closing/.test(await p.textContent('.cbl-title')), 'the closing figure is said once in the head, not three times');
    ok(await p.locator('[data-testid="lg-parties-diff"]').count() === 0, 'no amber chip while they agree');
    ok(dueReads() === 1 && partyReads() === 0, 'one /api/books/dues read names every party; no statement per party (' + dueReads() + ' / ' + partyReads() + ')');
    ok(JSON.stringify(await p.$$eval('#lg_out .cbl-hdr .cbl-hc', (h) => h.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()))) === JSON.stringify(['Date', 'Party', 'Details', 'Amount']), 'a control account\'s default columns: Date · Party · Details, and the Amount (the Balance is kept in ⚙)');
    let rt = await stmtText(), pc = await partyCells();
    ok(rt.length === 2 && pc.length === 2 && /^P-00001 · Ravi Stores$/.test(pc[0]) && /^P-00002 · Chola Auto Care$/.test(pc[1]), 'every 1300 row leads with its party — oldest first (W15-87), "P-00001 · Ravi Stores" (' + pc.join(' | ') + ')');
    ok(pc.every((t) => t && !/Mayur|Counter/.test(t)), 'no row shows the owner or the counter as its party');
    ok(rt.every((t) => /^Sale · Bill C2\/26-27\/001[67]( recorded \d\d \w+)?$/.test(t)), 'Details is the kind and the bill, once (' + rt[0] + ')');
    await openCols(p, 'ledger-control'); await p.waitForSelector('[data-testid="cols-menu-ledger-control"]');
    const colsOff = await p.$$eval('[data-testid="cols-menu-ledger-control"] input[type=checkbox]', (c) => c.map((x) => x.getAttribute('data-testid').replace('cols-ledger-control-', '') + ':' + (x.checked ? 1 : 0)));
    ok(JSON.stringify(colsOff) === JSON.stringify(['date:1', 'party:1', 'what:1', 'amount:1', 'bal:0', 'entry:0', 'tender:0', 'counter:0', 'person:0']), 'the gear keeps Balance · Entry no. · Tender · Counter · Rung by (' + colsOff.join(' ') + ')');
    await p.keyboard.press('Escape');
    await p.screenshot({ path: path.join(SHOTS, 'party-ledgers-debtors.png'), fullPage: true });

    /* expand one → its journal's Dr/Cr lines (the ledger you are in is bold), then the facts no visible column shows; its bill number opens the sheet */
    await p.click('[data-testid="stmt-row-0"] [role="button"]');
    await p.waitForSelector('[data-testid="db-lines-JV/2026-27/000011"]', { timeout: 8000 });
    const next = (await p.textContent('[data-testid="db-lines-JV/2026-27/000011"]')).replace(/\s+/g, ' ');
    ok(/Customers \(Sundry Debtors\)/.test(next) && /Sales @12%/.test(next) && /Output CGST 6%/.test(next) && /Output SGST 6%/.test(next), 'the next level is the journal\'s lines, each with its rate as the line carries it ("Sales @12%", "Output CGST 6%")');
    ok(await p.locator('[data-testid="lg-reverse"]').count() === 1, 'the opened entry offers Reverse this entry (insert-only; the Day book\'s own action)');
    ok(await p.locator('[data-testid="db-lines-JV/2026-27/000011"] .lg-me').count() === 1 && /1300/.test(await p.textContent('[data-testid="db-lines-JV/2026-27/000011"] .lg-me')), 'the ledger you are in (1300) is the bold line');
    const facts = (await p.textContent('[data-testid="lg-facts-0"]')).replace(/\s+/g, ' ').trim();
    ok(/On credit/.test(facts) && /Counter C2/.test(facts) && /rung by Mayur Bhavan \(owner\)/.test(facts), 'one quiet facts line: tender · counter · rung by (and the entry no, when there is one) — what no visible column shows (' + facts + ')');
    const opened = await p.evaluate(() => { const was = window.openChitSheet, got = []; window.openChitSheet = function (id) { got.push(id); }; try { const a = document.querySelector('[data-testid="stmt-src-0"]'); if (!a) return 'no link'; a.click(); return got.join(','); } finally { window.openChitSheet = was; } });
    ok(opened === 'k1' && await p.locator('[data-testid="db-lines-JV/2026-27/000011"]').count() === 1, 'the bill number opens that chit\'s sheet (' + opened + ') and does not toggle the row');

    /* a party leaf opens ITS ledger only — without a Party column */
    S.calls.length = 0;
    await p.click('[data-testid="lg-party-c1"]');
    await p.waitForFunction(() => /Ravi/.test((document.querySelector('.cbl-title h1') || {}).textContent || ''));
    await p.waitForSelector('[data-testid="stmt-row-0"]');
    const one = await p.textContent('[data-testid="lg_out"]');
    ok(partyReads() === 1 && S.calls.some((c) => /\/party\/c1\/statement/.test(c)), 'clicking a party reads that one party\'s statement, once');
    ok(/C2\/26-27\/0016/.test(one) && !/0017/.test(one) && !/Chola/.test(one), 'only that party\'s bills');
    await openCols(p, 'ledger-party'); await p.waitForSelector('[data-testid="cols-menu-ledger-party"]');
    ok(await p.locator('[data-testid="cols-ledger-party-party"]').count() === 0 && await p.locator('[data-testid="cols-ledger-party-what"]').count() === 1, 'a party\'s ledger offers no Party column, not even in the gear');
    await p.keyboard.press('Escape');
    ok(await p.locator('#lg_out .lg-party').count() === 0 && ((await p.textContent('#lg_out .cbl-list')).match(/Ravi Stores/g) || []).length === 0 && JSON.stringify(await p.$$eval('#lg_out .cbl-hdr .cbl-hc', (h) => h.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()))) === JSON.stringify(['Date', 'Details', 'Amount', 'Balance']), 'on a party\'s own ledger there is NO Party column and the party is not repeated on any row (it is said once, in the title)');
    await p.click('[data-testid="stmt-row-0"] [role="button"]'); await p.waitForSelector('[data-testid="db-lines-JV/2026-27/000011"]', { timeout: 8000 });
    const own = await p.evaluate(() => { const n = document.querySelector('[data-testid="db-lines-JV/2026-27/000011"]'), l = document.querySelector('#lg_out .cbl-list'); return { t: n.textContent, nsw: n.scrollWidth, ncw: n.clientWidth, lsw: l.scrollWidth, lcw: l.clientWidth }; });
    ok(!/Ravi Stores/.test(own.t) && /Output CGST/.test(own.t), 'inside the opened entry the party is not repeated either');
    ok(own.nsw <= own.ncw + 1 && own.lsw <= own.lcw + 1, 'the opened detail and the list never scroll sideways (' + own.nsw + '/' + own.ncw + ', ' + own.lsw + '/' + own.lcw + ')');
    ok(await p.locator('[data-testid="cbl-period-ledger-party"]').count() === 0, 'a party\'s statement has no period chip (it has no range)');
    ok(/^Opening ₹0\.00 · Closing ₹3,000\.00 Dr$/.test((await p.textContent('[data-testid="lg-sum"]')).trim()), 'opening 0 and closing ₹3,000 Dr for the party, in the one line');
    ok((await p.textContent('.cbl-title h1')).trim() === 'Ravi Stores', 'the party is named once, in the title');
    ok(await p.locator('[data-testid="lg-parties"]').count() === 0 && dueReads() === 0, 'the party view shows no control figures and re-reads no dues');
    ok(await p.locator('[data-testid="lg-party-c1"]').count() === 1 && await p.locator('[data-testid="lg-party-c2"]').count() === 1, 'the other parties stay in the tree beside it');
    ok(await p.locator('[data-testid="lg-agreed"]').count() === 0 && await p.locator('#lt_tree .ck').count() === 0, 'no "✓ Agreed up to" and no ✓ in the tree while the API sends no agreement date');
    await p.screenshot({ path: path.join(SHOTS, 'party-ledgers-one-party.png'), fullPage: true });
    /* Statement (designer extra #5): no API route sends it yet, so the button opens the party's own statement view — CB CRM's party record */
    const opened2 = await p.evaluate(() => { const was = window.open, got = []; window.open = function (u) { got.push(u); return null; }; try { document.querySelector('[data-testid="lg-statement"]').click(); return got.join(','); } finally { window.open = was; } });
    ok(/^\/crm\.html#\/party\/P-00001$/.test(opened2), 'the Statement button on a party\'s ledger opens that party\'s statement view (' + opened2 + ')');
    S.calls.length = 0;
    await p.click('[data-testid="lg-acc-2100"]');
    await p.waitForSelector('[data-testid="lg-party-s1"]');
    await p.waitForSelector('[data-testid="stmt-what-0"]');
    pr = await rowsOf();
    ok(pr.length === 4 && /^Agro Mills.*₹1,500\.00 Cr$/.test(pr[2]) && /^Kavi Traders.*₹1,000\.00 Cr$/.test(pr[3]), 'Suppliers opens into one line per supplier (' + pr.slice(2).join(' | ') + ')');
    const sum2 = (await p.textContent('[data-testid="lg-sum"]')).replace(/\s+/g, ' ').trim();
    ok(/Closing ₹2,500\.00 Cr · ✓ parties agree$/.test(sum2) && !/[-−]/.test(sum2), 'the suppliers: closing ₹2,500.00 Cr, parties agree, no minus sign (' + sum2 + ')');
    ok(dueReads() === 1 && partyReads() === 0, 'one dues request, no per-row statement (' + dueReads() + ' / ' + partyReads() + ')');
    pc = await partyCells(); rt = await stmtText();
    ok(pc.length === 2 && pc.every((t) => /^P-0000[34] · (Agro Mills|Kavi Traders)$/.test(t)), '2100 rows lead with the supplier (' + pc.join(' | ') + ')');
    await p.screenshot({ path: path.join(SHOTS, 'party-ledgers-creditors.png'), fullPage: true });
    await p.click('[data-testid="lg-party-s2"]');
    await p.waitForFunction(() => /Kavi/.test((document.querySelector('.cbl-title h1') || {}).textContent || ''));
    await p.waitForSelector('[data-testid="stmt-row-0"]');
    ok(/KV-12/.test(await p.textContent('[data-testid="lg_out"]')) && !/AM-81/.test(await p.textContent('[data-testid="lg_out"]')) && /Closing ₹1,000\.00 Cr/.test(await p.textContent('[data-testid="lg-sum"]')), 'a supplier opens only its own bills, closing ₹1,000.00 Cr');
    /* a control account that does not equal its parties is said in words, never hidden: an amber chip with the amount, that shows the entry with no party */
    S.closing = { '1300': 650000 }; S.extra = { '1300': [LINE('k5', '2026-09-07', 'C2/26-27/0018', null, 50000, 0, 650000, 'bill', 'Mayur Bhavan')] };
    await p.click('[data-testid="lg-acc-1300"]');
    await openNotes(p, 'ledger-control', 'lg-parties-diff');
    ok(/^₹500\.00 Dr with no party$/.test((await p.textContent('[data-testid="lg-parties-diff"]')).replace(/\s+/g, ' ').trim()) && /Closing ₹6,500\.00 Dr/.test(await p.textContent('[data-testid="lg-sum"]')) && !/parties agree/.test(await p.textContent('.cbl-title')), 'when the parties and the ledger differ there is NO green text — an amber chip names the amount; the figures line stays');
    ok(await p.locator('[data-testid^="kural-footer"]:visible').count() === 0, 'and the kural is not drawn beside that warning');
    await p.click('[data-testid="lg-parties-diff"]'); await p.waitForTimeout(200); await openNotes(p, 'ledger-control', 'lg-parties-diff');
    ok(await p.locator('[data-testid^="stmt-row-"]').count() === 1 && /Showing the 1 entry with no party/.test(await p.textContent('[data-testid="lg-parties-diff"]')) && /No party/.test(await p.textContent('[data-testid="stmt-row-2"]')), 'the chip\'s fix shows the one entry that has no party (and reads "Show all" to undo it)');
    await p.click('[data-testid="lg-parties-diff"]'); await p.waitForTimeout(200);
    ok(await p.locator('[data-testid^="stmt-row-"]').count() === 3, 'and Show all brings the three entries back');
    S.closing = null; S.extra = null;

    /* ── 3 · BILLS ── */
    await nav(p, 'bills');
    await p.waitForSelector('[data-testid="bills-list"]');
    const tabs = await p.$$eval('.tab', (s) => s.map((x) => x.textContent));
    ok(JSON.stringify(tabs) === JSON.stringify(['Received2', 'Issued1']), 'two tabs from the system folders, with the open counts: ' + tabs.join(' · '));
    ok(await p.locator('[data-testid="bills-tab-B-2100"]').getAttribute('aria-pressed') === 'true', 'Received is the first tab');
    ok(await p.locator('#bkl_bills .lrow').count() === 2 && await p.locator('#bkl_bills .lhead').count() === 1 && await p.locator('.bill').count() === 0, 'the Received tab lists its two bills as Task-table rows (Supplier · Bill no · Amount · Date · Step)');
    ok(/Goods checked/.test(await p.textContent('[data-testid="bill-step-rb1"]')) && await p.getAttribute('[data-testid="bill-step-rb1"]', 'data-step') === 'goods_checked', 'a bill carries the server\'s step chip — "Goods checked"');
    ok(/Bill refused/.test(await p.textContent('[data-testid="bill-step-rb2"]')) && /red/.test(await p.getAttribute('[data-testid="bill-step-rb2"]', 'class')), 'a disputed bill\'s chip is red, in the server\'s words');
    ok(/481\.65/.test(await p.textContent('[data-testid="bill-rb1"]')), 'the amount is shown through the locale layer');
    ok(!/B-1300|Issued — waiting/.test(await p.textContent('[data-testid="bills-list"]')), 'the Issued bills are not on the Received tab');
    ok(S.calls.some((c) => /\/api\/folders\/a0000000-0000-5000-8000-000000002100\/chits/.test(c)), 'the Received folder\'s chits were read');
    await p.click('[data-testid="bills-tab-B-1300"]');
    await p.waitForSelector('[data-testid="bill-ib1"]');
    ok(/Issued — waiting on payment/.test(await p.textContent('[data-testid="bill-step-ib1"]')), 'the Issued tab shows its bill and its chip');
    /* 2026-10-02 (web-reads-invoice): CB Accounts loads the chit sheet, so a bill opens it in place — no new tab */
    const tabs0 = ctx.pages().length;
    await p.click('[data-testid="bill-ib1"]');
    await p.waitForFunction(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open); }, null, { timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => typeof openChitSheet === 'function' && !!document.getElementById('chitsheet') && document.getElementById('chitsheet').open) && ctx.pages().length === tabs0, 'a bill opens the chit sheet in Accounts (openChitSheet is defined here), not a new tab');
    await p.keyboard.press('Escape');

    /* ── 4 · THE AVATAR MENU, HOME ── */
    await p.click('[data-testid="avatar"]');
    ok(await p.locator('[data-testid="avatar-menu"]').isVisible(), 'the avatar opens the menu');
    ok(await p.getAttribute('[data-testid="nav-profile"]', 'href') === '/settings.html#/shop', 'Profile → Settings › Your business, never the workshop (UX-96)');
    ok(await p.locator('[data-testid="nav-signout"]').isVisible(), 'Sign out is in the menu');
    ok(await p.evaluate(() => { const m = document.querySelector('[data-testid="avatar-menu"]'), r = m.getBoundingClientRect(), miss = [];
      for (let y = r.top + 6; y < Math.min(r.bottom, innerHeight) - 6; y += 24) for (let x = r.left + 6; x < r.right - 6; x += 40) { const e = document.elementFromPoint(x, y); if (e && !m.contains(e)) miss.push(e.className); }
      return miss.length === 0; }), 'the menu is drawn over the page — no sticky list header shows through it');
    await p.keyboard.press('Escape');
    ok(!(await p.locator('[data-testid="avatar-menu"]').isVisible()), 'Escape closes the menu');
    await panelShots(p, 'laptop', 1360);
    await p.screenshot({ path: path.join(SHOTS, 'cb-accounts-laptop.png') });
    ok(await p.getAttribute('[data-testid="shell-home"]', 'href') === '/', '⌂ Home links to /');
    await Promise.all([p.waitForURL(base + '/'), p.click('[data-testid="shell-home"]')]);
    ok(new URL(p.url()).pathname === '/', 'Home goes to /');
    await p.goBack();
    await p.waitForSelector('[data-testid="acc-nav-daybook"]');
    await p.click('[data-testid="avatar"]');
    await Promise.all([p.waitForURL(base + '/'), p.click('[data-testid="nav-signout"]')]);
    ok(await p.evaluate(() => localStorage.getItem('cb_sess')) === null, 'Sign out removes the app\'s session (cb_sess)');
    ok(new URL(p.url()).pathname === '/', 'Sign out lands on the index, the one front door (never the workshop\'s login)');
    await ctx.close();
  }

  /* ── 5 · LEDGER OFF ──────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn({ enabled: false });
    const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="acc-off"]');
    ok(/Accounts is not switched on/.test(await p.textContent('[data-testid="acc-off"]')), 'off → one card: "Accounts is not switched on"');
    ok(await p.locator('[data-testid="acc-card"]').count() === 1 && await p.locator('#nav .nav-btn').count() === 0, 'one card, and no menu to wander into');
    ok(await p.locator('[data-testid="acc-switch-on"]').isVisible(), 'the owner sees Switch on');
    await bad(p, 'ledger off');
    await p.screenshot({ path: path.join(SHOTS, 'cb-accounts-off.png') });
    await p.click('[data-testid="acc-switch-on"]');
    await p.waitForSelector('[data-testid="confirm-ok"]');
    ok(/Switch the Ledger on\?/.test(await p.textContent('[data-testid="confirm"]')) && /From today every bill/.test(await p.textContent('[data-testid="confirm"]')), 'a confirm says what switching on means (the Settings card\'s words)');
    ok(S.enables === 0, 'nothing is sent before the owner confirms');
    await p.click('[data-testid="confirm-cancel"]');
    await p.waitForTimeout(200);
    ok(S.enables === 0 && await p.locator('[data-testid="acc-off"]').count() === 1, 'Cancel changes nothing');
    await p.click('[data-testid="acc-switch-on"]');
    await p.waitForSelector('[data-testid="confirm-ok"]');
    await Promise.all([p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 10000 }), p.click('[data-testid="confirm-ok"]')]);
    await p.waitForSelector('[data-testid="acc-nav-daybook"]');
    ok(S.enables === 1, 'confirming sent POST /api/books/enable exactly once (' + S.enables + ')');
    ok(await p.locator('#nav .nav-btn').count() === VIEWS.length, 'the page fills: the full menu is there (' + VIEWS.length + ' items)');
    await ctx.close();
  }
  {
    const S = standIn({ enabled: false });
    const { ctx, p } = await open(S, { session: RAVI });
    await p.waitForSelector('[data-testid="acc-off"]');
    ok(/Ask the owner to switch it on/.test(await p.textContent('[data-testid="acc-ask-owner"]')), 'a co-assist sees "Ask the owner to switch it on"');
    ok(await p.locator('[data-testid="acc-switch-on"]').count() === 0, 'a co-assist is not offered Switch on');
    ok(S.enables === 0, 'and nothing was sent');
    await ctx.close();
  }
  {
    const S = standIn({ healthStatus: 500 });
    const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="read-failed-retry"]');
    ok(!/error|500|down/i.test(await p.textContent('[data-testid="acc-card"]')), 'a failed read says what happened in its own words, never the server\'s');
    ok(await p.locator('[data-testid="acc-switch-on"]').count() === 0, 'a read that failed is not mistaken for a Ledger that is off');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(standIn(), { session: null });
    /* since M14 the signed-out card mounts CBSignin in place; app.html is no longer a sign-in surface (DECISIONS 2026-10-08) */
    await p.waitForSelector('#signin-host [data-testid="signin-id"]');
    ok(await p.locator('a[href*="app.html#/login"]').count() === 0, 'signed out → the one sign-in window (CBSignin) opens in place, never a link to app.html');
    await ctx.close();
  }

  /* ── 6 · THE ONE-SHOP GATE ───────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn();
    /* another shop's unsent work is still in this browser (cb_owner says whose; a draft is tagged by cb.draft.*) */
    const { ctx, p } = await open(S, { seed: () => { try { localStorage.setItem('cb_owner', JSON.stringify({ ent: 'ent-OTHER', name: 'Alpha Timers', ids: ['act-9'] })); localStorage.setItem('cb.draft.msg.c1', JSON.stringify({ at: Date.now(), data: 'half a message' })); } catch (_) {} } });
    await p.waitForSelector('[data-testid="close-first"]', { timeout: 10000 });
    ok(/Alpha Timers/.test(await p.textContent('[data-testid="close-first"]')), 'another shop\'s fingerprint → the page says whose, and stops');
    await p.waitForTimeout(600);
    ok(S.calls.filter((c) => /\/api\/books/.test(c)).length === 0, 'no Ledger read happens while another shop is here (' + S.calls.filter((c) => /\/api\/books/.test(c)).length + ')');
    ok(await p.locator('[data-testid="close-first-go"]').isVisible() && await p.locator('#nav .nav-btn').count() === 0, 'one button fixes it, and there is no menu behind it');
    await p.click('[data-testid="close-first-go"]');
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 });
    ok(await p.evaluate(() => localStorage.getItem('cb.draft.msg.c1')) === null, 'cleared → the other shop\'s draft is gone');
    for (let i = 0; i < 40 && !S.calls.some((c) => /\/api\/books\/health/.test(c)); i++) await p.waitForTimeout(150);   /* the menu is in the first paint now; the read follows */
    ok(S.calls.some((c) => /\/api\/books\/health/.test(c)), 'and then Accounts opens and reads');
    /* a second shop signs in elsewhere while this page is open → this page leaves */
    const other = await ctx.newPage();                       /* the `storage` event reaches OTHER documents: a second tab does the sign-in */
    await other.goto(base + '/no-such-page');
    await other.evaluate((t) => { localStorage.setItem('cb_sess', JSON.stringify({ token: t, role: 'entity', name: 'Tally', entity: 'Tally Test' })); }, tokFor({ identity_id: 'ent-T', identity_type: 'entity' }));
    await p.waitForSelector('#signin-host [data-testid="signin-id"]', { timeout: 8000 });   /* signed out = CBSignin in place (M14) */
    ok(/Tally Test opened in another tab/.test(await p.textContent('[data-testid="acc-card"]')), 'a second shop signing in elsewhere signs this page out, and says why');
    await ctx.close();
  }

  /* ── 6b · THE GATE IS ATTACHED: when another shop's clear-out tells this shop's tabs to leave, this page leaves — to the home page ── */
  {
    const S = standIn();
    const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 });
    const other = await ctx.newPage();
    await other.goto(base + '/no-such-page');
    await other.addScriptTag({ url: base + '/app/one-person.js' });
    await other.evaluate(() => CBOnePerson.clearOut({ ent: 'ent-M', name: 'Mayur Bhavan', tabs: 1, uids: [] }, 'Tally Test'));
    await p.waitForURL(/\/\?left=Tally/, { timeout: 8000 }).catch(() => {});
    ok(/\/\?left=Tally/.test(p.url()), 'a clear-out of this shop sends the page to the home page, naming who did it (' + p.url().replace(base, '') + ')');
    await ctx.close();
  }

  /* ── the designer's own pairs, read at WCAG AA (the page's tokens, the way lib/contrast.cjs measures them) ── */
  {
    const { ratio } = require('./lib/contrast.cjs');
    const PAIRS = [['#6f6450', '#fbf6ec', 'muted on the page'], ['#6f6450', '#fffdf8', 'muted on a card'], ['#5c5240', '#f4ecdc', 'the quiet nav text on the sidebar'], ['#3d3527', '#f4ecdc', 'nav text on the sidebar'],
      ['#1f5f5b', '#e6d9bd', 'the active menu item'], ['#1f5f5b', '#fffdf8', 'codes and links on a card'], ['#fbf6ec', '#1f5f5b', 'the primary button'], ['#fbf6ec', '#2a2418', 'a pressed chip'],
      ['#e9dfc8', '#2a2418', 'a pressed chip\'s count'], ['#6f6450', '#f3ead7', 'muted on hover'], ['#7A5205', '#FDF3DC', 'the Waiting count']];
    const low = PAIRS.filter(([f, b]) => (ratio(f, b) || 0) < 4.5);
    ok(low.length === 0, 'the designer\'s text pairs all read at AA 4.5:1' + (low.length ? ' — failing: ' + low.map((x) => x[2]).join(', ') : ''));
  }

  /* ── 7 · PHONE ───────────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn();
    const { ctx, p } = await open(S, { viewport: { width: 390, height: 844 } });
    await p.waitForSelector('[data-testid="acc-nav-daybook"]');
    await p.waitForTimeout(400);
    const side = await p.evaluate(() => ({ w: document.getElementById('side').getBoundingClientRect().width, labels: Array.from(document.querySelectorAll('.side .label')).filter((l) => getComputedStyle(l).display !== 'none').length }));
    ok(side.w === 64 && side.labels === 0, 'at 390 px the sidebar is an icon rail (' + side.w + ' px wide, ' + side.labels + ' labels)');
    /* A1 shot: the phone's menu opened - Outstandings with Receivables · Payables · Bills · Cheques */
    await p.screenshot({ path: path.join(SHOTS, 'small-fixes', 'accounts-menu-390.png') }).catch(() => {});
    ok(await p.locator('[data-testid="acc-nav-receivables"]').count() === 1 && await p.locator('[data-testid="acc-nav-waiting"]').count() === 0, 'A1 @390: the menu rail has Receivables and no Waiting');
    for (const [id, label] of VIEWS) {
      await nav(p, id);
      await p.waitForTimeout(350);
      const w = await width(p);
      ok(w.sw === 390 && w.iw === 390, label + ' at 390 px: document.scrollWidth === 390 (' + w.sw + ')');
      /* ⚠️ the app shell clips the document itself, so the page's own scroller is where a sideways overflow would live */
      const m = await p.evaluate(() => { const e = document.querySelector('.main'); return { sw: e.scrollWidth, cw: e.clientWidth }; });
      ok(m.sw <= m.cw, label + ' at 390 px: nothing scrolls sideways inside the page either (' + m.sw + ' ≤ ' + m.cw + ')');
    }
    await panelShots(p, 'phone', 390);
    await nav(p, 'ledgers');
    await p.waitForSelector('[data-testid="lt-band-people"]');
    const w2 = await width(p);
    ok(w2.sw === 390, 'Ledgers (the tree) at 390 px: scrollWidth === 390');
    /* the phone is TWO PAGES: page one is the tree (with its find box, the page's own "Ledgers" header and the avatar) — a ledger opens page two, ‹ comes back */
    const pg1 = await p.evaluate(() => { const tree = document.querySelector('.lt-tree'), top = document.querySelector('.titlebar'), l = document.querySelector('#lt_tree'); const r = l.getBoundingClientRect();
      return { tree: getComputedStyle(tree).display, pane: getComputedStyle(document.querySelector('.lt-pane')).display, top: top && getComputedStyle(top).display, h1: (document.querySelector('#title') || {}).textContent, av: !!document.querySelector('[data-testid="shell-header"] .cbav-btn'), head: Math.round(r.top / innerHeight * 100) }; });
    ok(pg1.tree !== 'none' && pg1.pane === 'none' && pg1.top !== 'none' && pg1.h1 === 'Ledgers' && pg1.av, 'phone page one: the tree, the title row "Ledgers" under the frame (with the avatar), and no squeezed side panel');
    ok(pg1.head <= 30, 'phone page one: the head is ' + pg1.head + '% of the window (limit 30%)');
    await p.screenshot({ path: path.join(SHOTS, 'cb-accounts-phone.png'), fullPage: false });
    await p.click('[data-testid="lg-acc-1300"]');
    await p.waitForSelector('[data-testid="stmt-row-0"]');
    await p.waitForTimeout(300);
    const ph = await p.evaluate(() => { const tr = document.querySelector('[data-testid="stmt-row-0"]'), t = document.querySelector('.lt-tree'), l = document.querySelector('#lg_out .cbl-list'), hdr = document.querySelector('#lg_out .cbl-hdr');
      return { tree: getComputedStyle(t).display, row: getComputedStyle(tr).display, rad: parseFloat(getComputedStyle(tr).borderTopLeftRadius), back: getComputedStyle(document.querySelector('[data-testid="lt-back"]')).display, sw: document.documentElement.scrollWidth, head: getComputedStyle(document.querySelector('#lg_out .lhead')).display,
        pct: Math.round((l.getBoundingClientRect().top + (hdr && hdr.offsetParent ? hdr.offsetHeight : 0)) / innerHeight * 100), top: getComputedStyle(document.querySelector('.titlebar')).display, who: !!document.querySelector('[data-testid="shell-header"] .cbav-btn') && !document.querySelector('.cbl-title .who'), h1: document.querySelector('.cbl-title h1').textContent }; });
    ok(ph.tree === 'none' && ph.back !== 'none' && ph.row === 'flex' && ph.rad > 0 && ph.head === 'none', 'at 390 px a chosen ledger is page two: the tree is gone, entries are one card per row, and ‹ is the way back');
    ok(ph.top === 'none' && ph.who && ph.h1 === 'Customers', 'page two: the list\'s title row is the heading (‹ Customers); the page\'s title row steps aside, the frame (home · avatar) stays (SHELL-ONE)');
    ok(ph.pct <= 30, 'phone page two: the head is ' + ph.pct + '% of the window (limit 30%)');
    ok(ph.sw === 390, 'the ledger\'s entries at 390 px: document.scrollWidth === 390 (' + ph.sw + ')');
    await p.screenshot({ path: path.join(SHOTS, 'party-ledgers-phone.png'), fullPage: false });
    await p.screenshot({ path: path.join(SHOTS, 'one-table-ledgers-phone.png'), fullPage: false });
    await p.click('[data-testid="stmt-row-0"] [role="button"]'); await p.waitForSelector('[data-testid="db-lines-JV/2026-27/000011"]', { timeout: 8000 });
    const jl = await p.evaluate(() => { const n = document.querySelector('[data-testid="db-lines-JV/2026-27/000011"]'), l = document.querySelector('#lg_out .cbl-list'); const first = n.querySelector('.cbl-nrow > span:first-child'); return { nsw: n.scrollWidth, ncw: n.clientWidth, lsw: l.scrollWidth, lcw: l.clientWidth, w: first.getBoundingClientRect().width }; });
    ok(jl.nsw <= jl.ncw + 1 && jl.lsw <= jl.lcw + 1 && jl.w >= 110, 'the opened entry on a phone: the journal does not scroll sideways, and its figures take only the room they need (ledger column ' + Math.round(jl.w) + ' px)');
    await p.click('[data-testid="lt-back"]');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.lt-tree')).display !== 'none' && getComputedStyle(document.querySelector('.titlebar')).display !== 'none'), 'ʻ‹ʼ returns to the tree (and the page header is back with the avatar)');
    ok(await p.locator('[data-testid="shell-home"]').count() === 1 && await p.locator('[data-testid="shell-header"] .cbav-btn').count() === 1, 'the shop · Home · avatar never left the frame (one node each, SHELL-ONE) — and the page header (one node, moved, never copied)');
    /* a table is one card per row below 620 px, each cell named by its column */
    await nav(p, 'tb');
    await p.waitForSelector('table.bktab');
    const card = await p.evaluate(() => { const tr = document.querySelector('table.bktab tbody tr'); const cs = getComputedStyle(tr); return { disp: cs.display, labelled: tr.querySelectorAll('td[data-l]').length, head: getComputedStyle(document.querySelector('table.bktab thead')).display }; });
    ok(card.disp === 'block' && card.labelled >= 3 && card.head === 'none', 'a table is one card per row at 390 px, each cell labelled (' + card.labelled + ' labelled cells)');
    await ctx.close();
  }

  /* ── THE LEDGERS, LOOKED AT (docs/design/ledgers-page): the nine states, laptop 1366×768 and phone 390×844, in Cream · Dark · Terminal.
     Every combination is MEASURED: the list and the opened entry fit with no sideways scroll, and the head (everything above the first row) stays
     within 20% of the window on a laptop — a wide one AND a narrow one (1080) — and within 30% on a phone. LEDGERS_SHOTS=<dir> also keeps a picture of each state
     (01 tree open · 02 tree folded · 03 control account with parties · 04 parties differ · 05 plain ledger · 06 party's ledger · 07 entry opened · 08 empty period · 09 long name). ── */
  const headPct = (p) => p.evaluate(() => { const l = document.querySelector('#lg_out .cbl-list'), hdr = document.querySelector('#lg_out .cbl-hdr'); if (!l) return null;
    return (l.getBoundingClientRect().top + (hdr && hdr.offsetParent ? hdr.offsetHeight : 0)) / innerHeight * 100; });
  /* the budget is judged on the ROUNDED percent (limits 20 / 30, unchanged); the spec also reports the unrounded one so the margin is visible */
  const rd = (v) => v == null ? null : Math.round(v), fx = (v) => v == null ? 'n/a' : v.toFixed(2);
  /* where the head's pixels go: the page above the pane, then each part of the pane's head (so a head that grows can be traced to its row) */
  const headParts = (p) => p.evaluate(() => { const o = document.querySelector('#lg_out'); if (!o) return ''; const t = o.getBoundingClientRect().top; return 'above ' + Math.round(t) + ' · ' + Array.from(o.children).filter((c) => c.offsetParent && !c.classList.contains('cbl-list')).map((c) => (c.className.split(' ')[0] || c.tagName) + ' ' + Math.round(c.offsetHeight)).join(' · ') + ' · col-header ' + Math.round((document.querySelector('#lg_out .cbl-hdr') || { offsetHeight: 0 }).offsetHeight) + ' · title parts ' + Array.from(document.querySelectorAll('#lg_out .cbl-title > *, #lg_out .cbl-title .cbl-slot > *')).filter((c) => c.offsetParent).map((c) => { const r = c.getBoundingClientRect(), tt = o.querySelector('.cbl-title').getBoundingClientRect(); return (c.getAttribute('data-testid') || c.getAttribute('data-lt') || c.tagName.toLowerCase() + '.' + c.className + '"' + c.textContent.slice(0, 22) + '"') + '@' + Math.round(r.top - tt.top) + '+' + Math.round(r.height) + 'x' + Math.round(r.width); }).join(' ');  });
  const LSHOTS = process.env.LEDGERS_SHOTS;
  if (LSHOTS) fs.mkdirSync(LSHOTS, { recursive: true });
  for (const theme of ['cream', 'dark', 'terminal']) {
    for (const [tag, vp] of [['laptop', { width: 1366, height: 768 }], ['phone', { width: 390, height: 844 }]]) {
      const S = standIn();
      const { ctx, p } = await open(S, { viewport: vp, seed: 'try { localStorage.setItem("cb_theme", ' + JSON.stringify(theme) + '); } catch (_) {}' });
      const phone = tag === 'phone', limit = phone ? 30 : 20;
      const snap = (n) => LSHOTS ? p.screenshot({ path: path.join(LSHOTS, n + '-' + tag + '-' + theme + '.png') }) : null;
      const pick = async (id) => { if (!(await p.locator('[data-testid="' + id + '"]').isVisible())) { if (await p.locator('[data-lt="back"]').isVisible()) await p.click('[data-lt="back"]'); else if (await p.locator('[data-lt="unfold"]').isVisible()) await p.click('[data-lt="unfold"]'); await p.waitForTimeout(200); }
        await p.click('[data-testid="' + id + '"]'); await p.waitForFunction(() => !document.querySelector('#lg_out .cbl-skel') && document.querySelector('#lg_out .cbl-list'), null, { timeout: 8000 }); await p.waitForTimeout(250); };
      await p.waitForSelector('[data-testid="acc-nav-ledgers"]'); await p.click('[data-testid="acc-nav-ledgers"]');
      await p.waitForSelector('[data-testid="lt-band-people"]'); await p.waitForTimeout(250);
      ok((await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === (theme === 'cream' ? 'cream' : theme) || theme === 'cream', 'Ledgers ' + tag + ' in ' + theme + ': the theme is applied');
      await snap('01-tree-open');
      const checks = {}; let parts = '';
      /* 03 · a control account with parties (Suppliers) */
      await pick('lg-acc-2100'); checks.control = await headPct(p); await snap('03-control-parties');
      /* 04 · the parties differ (Customers, one entry with no party) */
      S.closing = { '1300': 650000 }; S.extra = { '1300': [LINE('k5', '2026-09-07', 'C2/26-27/0018', null, 50000, 0, 650000, 'bill', 'Mayur Bhavan')] };
      await pick('lg-acc-1300'); await p.waitForSelector('[data-testid="lg-parties-diff"], [data-testid="cbl-notes-ledger-control"]'); checks.differ = await headPct(p);   /* on a phone CBList folds the chips and the notice into ONE chip */ await snap('04-parties-differ');
      S.closing = null; S.extra = null;
      /* 05 · a plain ledger (Rent) */
      await pick('lg-acc-6010'); checks.plain = await headPct(p); await snap('05-plain-ledger');
      /* 06 · a party's ledger, and 07 · its first entry opened */
      await pick('lg-acc-1300'); await pick('lg-party-c1'); checks.party = await headPct(p); parts = await headParts(p); await snap('06-party-ledger');
      await p.click('[data-testid="stmt-row-0"] [role="button"]'); await p.waitForSelector('[data-testid="db-lines-JV/2026-27/000011"]', { timeout: 8000 }); await p.waitForTimeout(250);
      const g = await p.evaluate(() => { const l = document.querySelector('#lg_out .cbl-list'), n = document.querySelector('[data-testid="db-lines-JV/2026-27/000011"]'); return { th: document.documentElement.getAttribute('data-theme'), lsw: l.scrollWidth, lcw: l.clientWidth, nsw: n.scrollWidth, ncw: n.clientWidth, dsw: document.documentElement.scrollWidth, iw: innerWidth }; });
      ok(g.lsw <= g.lcw + 1 && g.nsw <= g.ncw + 1 && g.dsw <= g.iw, 'Ledgers ' + tag + ' in ' + theme + ' (' + g.th + '): the list and the opened entry fit, nothing scrolls sideways (' + g.lsw + '/' + g.lcw + ', ' + g.nsw + '/' + g.ncw + ')');
      await snap('07-entry-opened');
      /* 08 · an empty period (Bank has no entries) */
      await pick('lg-acc-1500'); checks.empty = await headPct(p); await snap('08-empty-period');
      /* 09 · a long name wraps, never clipped */
      await pick('lg-acc-7777'); await snap('09-long-name');
      /* 02 · the tree folded (laptop) / page two (phone) */
      if (!phone) { await p.click('[data-testid="lt-fold"]').catch(() => {}); await p.waitForTimeout(200); await snap('02-tree-folded'); await p.click('[data-testid="lt-unfold"]').catch(() => {}); } else await snap('02-tree-folded');
      const worst = Math.max.apply(null, Object.values(checks).filter((v) => v != null).map(rd));
      ok(worst <= limit, 'Ledgers ' + tag + ' in ' + theme + ': the head stays within ' + limit + '% in every state (' + Object.keys(checks).map((k) => k + ' ' + rd(checks[k]) + '% (' + fx(checks[k]) + ')').join(' · ') + ') [party head: ' + parts + ']');
      if (theme === 'cream' && !phone) await p.screenshot({ path: path.join(SHOTS, 'ledgers-laptop-cream.png') });
      if (theme === 'dark' && !phone) await p.screenshot({ path: path.join(SHOTS, 'ledgers-laptop-dark.png') });
      if (theme === 'cream' && phone) await p.screenshot({ path: path.join(SHOTS, 'ledgers-phone-cream.png') });
      if (theme === 'dark' && phone) await p.screenshot({ path: path.join(SHOTS, 'ledgers-phone-dark.png') });
      await ctx.close();
    }
  }
  /* a narrow laptop (1080 × 768): the menu rests as its rail, the tree opens OVER the list for one pick, the tools row stays one row — the head within 20% */
  {
    const S = standIn(); S.closing = { '1300': 650000 }; S.extra = { '1300': [LINE('k5', '2026-09-07', 'C2/26-27/0018', null, 50000, 0, 650000, 'bill', 'Mayur Bhavan')] };
    const { ctx, p } = await open(S, { viewport: { width: 1080, height: 768 } });
    await p.waitForSelector('[data-testid="acc-nav-ledgers"]'); await p.click('[data-testid="acc-nav-ledgers"]');
    await p.waitForSelector('[data-testid="lt-band-people"]', { state: 'attached' }); await p.waitForTimeout(250);
    ok(await p.locator('.lt-tree').isHidden() && await p.locator('[data-testid="lt-unfold"]').count() === 1, 'narrow laptop: the bank ledger opens on its own (W15-90), so the tree is folded and "☰ Ledgers" is the way in');
    await p.click('[data-testid="lt-unfold"]'); await p.waitForTimeout(200); await p.click('[data-testid="lg-acc-1300"]'); await p.waitForSelector('[data-testid="lg-parties-diff"], [data-testid="cbl-notes-ledger-control"]'); await p.waitForTimeout(250);
    ok(await p.locator('.lt-tree').isHidden() && await p.locator('[data-testid="lt-unfold"]').count() === 1, 'narrow laptop (1080): once a ledger is open the tree folds, and "☰ Ledgers" is one tap away');
    const n1 = rd(await headPct(p)), n1x = await headPct(p);
    ok(n1 <= 20, 'narrow laptop (1080×768): the head is ' + n1 + '% (' + fx(n1x) + ') of the window with the notices chip showing (limit 20%)');
    await p.click('[data-testid="lt-unfold"]'); await p.waitForTimeout(200);
    const ov = await p.evaluate(() => { const t = document.querySelector('.lt-tree'), l = document.querySelector('#lg_out .cbl-list'); return { pos: getComputedStyle(t).position, lw: l.getBoundingClientRect().width }; });
    const n2 = rd(await headPct(p));
    ok(ov.pos === 'absolute' && n2 === n1, 'narrow laptop: "☰ Ledgers" brings the tree back OVER the list — the list keeps its width, the head stays ' + n2 + '%');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(await p.locator('.lt-tree').isHidden(), 'Esc puts the overlay away');
    await p.screenshot({ path: path.join(SHOTS, 'ledgers-narrow-1080.png') }).catch(() => {});
    await ctx.close();
  }
  /* what a person chose is remembered, per person: the last ledger comes back; the tree's width and what is folded too */
  {
    const S = standIn();
    const { ctx, p } = await open(S, { viewport: { width: 1366, height: 768 } });
    await p.waitForSelector('[data-testid="acc-nav-ledgers"]'); await p.click('[data-testid="acc-nav-ledgers"]');
    await p.waitForSelector('[data-testid="lt-band-people"]');
    await p.click('[data-testid="lg-acc-1300"]'); await p.click('[data-testid="lg-party-c2"]');
    await p.waitForFunction(() => /Chola/.test((document.querySelector('.cbl-title h1') || {}).textContent || ''));
    await p.click('[data-testid="lt-band-income"]');
    await p.reload();
    await p.waitForSelector('[data-testid="acc-nav-ledgers"]'); await p.click('[data-testid="acc-nav-ledgers"]');
    await p.waitForFunction(() => /Chola/.test((document.querySelector('.cbl-title h1') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/Chola Auto Care/.test(await p.textContent('.cbl-title h1')), 'the last ledger this person had open comes back (Chola Auto Care, a party\'s ledger)');
    ok(await p.locator('[data-testid="lt-band-income"]').getAttribute('aria-expanded') === 'false', 'a band they folded stays folded');
    ok(await p.evaluate(() => Object.keys(localStorage).filter((k) => /^cb_lt\./.test(k)).length === 1), 'remembered on this device under this person\'s own key (the API has no ledgers preference yet — listed in the PR)');
    /* the agreement date, when the API sends it (it does not yet — the contract lists no `agreed_to`): the page is handed it as the API would, and draws a green chip in the head and a ✓ beside the party in the tree */
    await p.click('[data-testid="lg-party-c1"]'); await p.waitForFunction(() => /Ravi/.test((document.querySelector('.cbl-title h1') || {}).textContent || ''));
    await p.waitForSelector('[data-testid="stmt-row-0"]', { timeout: 8000 });
    await p.evaluate(() => { BK.dues[Object.keys(BK.dues)[0]].agreed_to = '2026-08-31'; Object.keys(BK.dues).forEach((k) => { BK.dues[k].agreed_to = '2026-08-31'; }); BK.lt.r.agreed_to = '2026-08-31'; bkLtTreePaint(); BK.lt.api.refresh(); });
    await openNotes(p, 'ledger-party', 'lg-agreed').catch(() => {});
    ok(/Agreed up to 31 Aug 2026/.test((await p.textContent('[data-testid="lg-agreed"]').catch(() => '')) || '') && await p.locator('#lt_tree .ck').count() >= 1, 'when the API sends the agreement date the head says "✓ Agreed up to 31 Aug 2026" and the tree puts a ✓ beside the party');
    await ctx.close();
  }

  /* ── 8 · THE LISTS ROUND: no layout jump, and the ledger stripes ─────────────────────────────────────────────────────────────── */
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    /* SET-WALK1 W7: the Thirukkural band is the owner's choice and 'auto' draws it only where the shop reads Tamil, so with no pref there is no band and no room;
       this round measures the room the band keeps, so the owner has chosen it on (cb_kural) */
    const { ctx, p } = await open(standIn(), { viewport: { width: w, height: h }, delay: 1200, path: '/accounts.html#daybook', seed: 'try { localStorage.setItem("cb_kural", "on"); } catch (_) {}' });
    const box = () => p.evaluate(() => { const r = (s, n) => { const e = document.querySelectorAll(s)[n || 0]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { navN: document.querySelectorAll('#nav .nav-btn').length, nav0: r('#nav .nav-btn', 0), navLast: r('#nav .nav-btn', document.querySelectorAll('#nav .nav-btn').length - 1), title: r('#title'), brand: r('#side .brand'), skel: document.querySelectorAll('.bk-skel i').length, band: r('#cbkural,#cbkural-reserve'), content: r('#content'), collapse: r('#toggleNav'), titleText: (document.getElementById('title') || {}).textContent }; });
    await p.waitForSelector('.bk-skel', { timeout: 6000 }); await p.waitForTimeout(250);
    const a = await box(), tag = 'accounts @' + w;
    ok(a.navN === VIEWS.length && a.titleText === 'Day book' && a.skel >= 5 && !!a.band && a.band[3] >= 40, tag + ' FIRST PAINT, data still on its way: all ' + a.navN + ' menu items, the title "' + a.titleText + '", skeleton rows (' + a.skel + '), the kural\'s room (' + (a.band && a.band[3]) + ' px)');
    await p.waitForSelector('[data-testid^="db-entry-"]', { timeout: 15000 }); await p.waitForTimeout(700);
    const z = await box(), same = (u, v, tol) => !!u && !!v && u.every((x, i) => Math.abs(x - v[i]) <= (tol == null ? 1 : tol));
    ok(same(a.nav0, z.nav0) && same(a.navLast, z.navLast) && same(a.brand, z.brand) && same(a.title, z.title) && same(a.collapse, z.collapse), tag + ': when the rows arrive the menu, the title and the sidebar foot do not move (' + JSON.stringify([a.nav0, a.title, a.collapse]) + ' → ' + JSON.stringify([z.nav0, z.title, z.collapse]) + ')');
    ok(same(a.content.slice(0, 3), z.content.slice(0, 3), 2), tag + ': the content area keeps its place and width — only its height follows the rows (' + JSON.stringify(a.content) + ' → ' + JSON.stringify(z.content) + ')');
    await ctx.close();
  }
  {
    /* a ledger with enough lines to show the stripe, on a laptop and on a phone card */
    const extra = [LINE('k7', '2026-09-08', 'C2/26-27/0018', 'c1', 120000, 0, 720000, 'bill', 'Mayur Bhavan'), LINE('k8', '2026-09-09', 'C2/26-27/0019', 'c1', 0, 200000, 520000, 'bill', 'Mayur Bhavan'), LINE('k9', '2026-09-10', 'C2/26-27/0020', 'c1', 90000, 0, 610000, 'bill', 'Mayur Bhavan')];
    PARTY_LINES.c1.push(...extra);
    for (const [w, h] of [[1366, 768], [390, 844]]) {
      const { ctx, p } = await open(standIn(), { viewport: { width: w, height: h } });
      await p.waitForSelector('[data-testid="acc-nav-ledgers"]', { timeout: 15000 }); await p.click('[data-testid="acc-nav-ledgers"]');
      const pk = async (id) => { if (!(await p.locator('[data-testid="' + id + '"]').isVisible())) { if (await p.locator('[data-lt="back"]').isVisible()) await p.click('[data-lt="back"]'); else if (await p.locator('[data-lt="unfold"]').isVisible()) await p.click('[data-lt="unfold"]'); await p.waitForTimeout(200); } await p.click('[data-testid="' + id + '"]'); await p.waitForFunction(() => !document.querySelector('#lg_out .cbl-skel') && document.querySelector('#lg_out .cbl-list'), null, { timeout: 8000 }); await p.waitForTimeout(250); };
      await p.waitForSelector('[data-testid="lt-band-people"]', { timeout: 15000 }); await pk('lg-acc-1300'); await pk('lg-party-c1'); await p.waitForSelector('[data-testid="stmt-row-3"]', { timeout: 15000 }); await p.mouse.move(1, 1); await p.waitForTimeout(400); /* the pointer rests off the rows: a hover shade is not the zebra */
      const zb = await p.evaluate(() => { const bg = (e) => getComputedStyle(e).backgroundColor, rs = Array.from(document.querySelectorAll('[data-testid^="stmt-row-"]')); return { n: rs.length, a: bg(rs[0]), b: bg(rs[1]), c: bg(rs[2]), d: bg(rs[3]) }; });
      ok(zb.n >= 4 && zb.a === zb.c && zb.b === zb.d && zb.a !== zb.b, 'ledger @' + w + ': the entries alternate their shade (' + zb.a + ' / ' + zb.b + ')');
      await p.screenshot({ path: path.join(SHOTS, 'lists', 'accounts-ledger-zebra-' + w + '.png') }).catch(() => {});
      await ctx.close();
    }
    PARTY_LINES.c1.length -= extra.length;
  }

  /* ── no page error, nothing left the machine ── */
  ok(...C.finish());
  ok(threw.length === 0, 'no page error from Accounts' + (threw.length ? ': ' + threw.slice(0, 3).join(' | ') : ''));
  ok(offHost.filter((u) => !/fonts\.g|cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator/.test(u)).length === 0, 'nothing but the stand-in was reachable (the fonts and the QR script of the app page that Sign out opens, are refused)' + (offHost.length ? ' — refused: ' + offHost.join(' ') : ''));
  await b.close(); srv.close();
  console.log('\n  cb-accounts: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('  XX  the harness stopped: ' + e.message); console.log('\n  cb-accounts: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
