/* chit-sheet.cjs — THE CHIT SHEET, DRIVEN THROUGH ITS CONTROLS (docs/design/chit-sheet/CLOUD-TASK.md).
 * Pattern: books-web.cjs — a stand-in API answers every /api/** call INSIDE the page; the static server takes a free
 * port from the OS. Nothing reaches localhost:3000, port 7351, or the live site.
 *
 *  1  from the Day book, a counter bill opens as a popup: header, lines + offer, GST rows as the chit holds them, total, tender
 *  2  its icon row is Print · Return · Open page — no Dispute, no Accept
 *  3  a received supplier bill: Accept · Dispute · Goods in · Open page; a task: Accept · Dispute · Open page (Done once in hand)
 *  4  Accept calls the status route once; the sheet repaints with the new step and the row changes
 *  5  Esc / Close returns to the Day book, scroll position kept; the page never navigated
 *  6  the to-do "supplier bill to accept": one bill → its sheet over the Day book (no navigation); several → Ledger › Waiting
 *  7  the title is the document (Bill · Supplier bill · Task), never "Chit"; tender parts add up to the total, change is apart
 *  8  scrollWidth === 390 at phone width; no "accounting"; "(owner)" when by == the shop's own name
 *  9  (2026-10-02, web-reads-invoice) a chit carrying a REAL business_json.invoice (CBTax.determine, the C2/26-27/0007 shape: inclusive
 *     prices · 12% + 18% · offers · intra · place of supply 33) → lines, GST rows, round-off and total EQUAL CBTax.moneyOf(invoice) to the paisa;
 *     summary_json.money alone → read from it; neither → "not recorded"
 * 10  Accept on a bill received asks what it is for FIRST (PUT /use, then PUT /status — once each); the step is read from the chit's
 *     state_log bill_step row (the shared status never moves), so the sheet, the to-do and Waiting stop saying "To accept"
 * 11  the popup names the counter as the Day book does (Counter C2); CB Accounts' Bills rows open the sheet and name who accepted
 * 12  #/app/ledger, a remembered cb_nav of 'ledger' and navTo('ledger') land on /accounts.html at the same view; the app's menu has a Bills door
 * ⚠️ "Open page" (test 3) pins TODAY's door: the chit page in CB CRM (crm.html#/chit/<id>, round CRM2) — it moves with the round that moves the page.
 *  Env CHS_ROOT = a COPY of public/ (used by chit-sheet-breaks.cjs); screenshots to e2e/shots/chit-sheet-*.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.CHS_ROOT || path.join(__dirname, '..', 'public');
const SHOTS = process.env.CHS_ROOT ? null : path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const B = require('./chit-sheet-blocks.cjs');   /* walk blocks kept in their own file (size ceiling) */
const SHOP = 'Books Shop', TODAY = new Date().toISOString().slice(0, 10);

/* the REAL engine, the real invoice: the adopted tax.js run in a sandbox, CBTax.determine() once, CBTax.moneyOf() to read it */
const vm = require('vm');
const eng = { }; eng.window = eng; eng.self = eng; vm.createContext(eng);
for (const f of ['engine/money.js', 'engine/tax.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), eng);
const LINES = [{ name: 'Rice 5kg', unit: 'piece', qty: 2, unit_price: 97.16, discount: 10, gst_rate: 12 }, { name: 'Soap', unit: 'piece', qty: 3, unit_price: 98.7, discount: 0, gst_rate: 18 },
               { name: 'Oil 1L', unit: 'piece', qty: 1, unit_price: 89.48, discount: 5.25, gst_rate: 12 }, { name: 'Tea', unit: 'piece', qty: 2, unit_price: 54.8, discount: 0, gst_rate: 18 }];
const INV = eng.CBTax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33', Country: 'IN', LglNm: SHOP }, buyer: { LglNm: 'Walk-in', State: '', Pos: '33', Country: 'IN' }, lines: LINES, priceIncludesTax: true });
const EXP = eng.CBTax.moneyOf(INV, 'INR');   /* what every screen must show, to the paisa */
/* RCM-POST: a GTA's freight bill from an UNREGISTERED transporter to the registered shop — the line names its category (rcm_category), the engine assesses it as the
   recipient's purchase (rcm: true, as api lib/tax-lines invoiceFor does): the tax sits in the RCM heads, the supplier charges none, the bill total is the freight */
const RCM_INV = eng.CBTax.determine({ rcm: true, seller: { LglNm: 'Sri Ram Transport', State: '33', Country: 'IN', RegType: 'unregistered' },
  buyer: { Gstin: '33AAAAA0000A1Z5', LglNm: SHOP, State: '33', Pos: '33', Country: 'IN' },
  lines: [{ name: 'Freight Salem to Chennai', unit: 'trip', hsn: '996511', qty: 1, unit_price: 10000, rate: 18, rcm_category: 'gta' }] });
const RCM_EXP = eng.CBTax.moneyOf(RCM_INV, 'INR');
const f2 = (n) => Number(n).toFixed(2);

/* ── the stand-in: three chits (a counter bill, a supplier bill, a task) and the Ledger's day book that points at them ── */
function standIn() {
  const me = { role: 'sender', display_name: SHOP, entity_id: 'ent-books' };
  const S = { statusCalls: [], useCalls: [], calls: [], disputes: 0, chitReads: 0, chits: {} };
  S.chits.ch1 = { header: { chit_id: 'ch1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C2/26-27/0002', created_at: TODAY + 'T05:10:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }],
    summary_json: { currency_code: 'INR', money: { total: 1, tax: 1 } },   /* a header that disagrees: the FROZEN INVOICE wins, so a reader that falls back to the header is caught */
    business_json: { bill_no: 'C2/26-27/0002', billed_at: TODAY + 'T05:10:00.000Z', till: { id: 't2', name: 'Counter 2', by: { name: SHOP } }, customer: { name: 'Walk-in' },
      payment: { mode: 'cash+upi', paid: EXP.total, change: 25.74, parts: [{ how: 'cash', amount: 500 }, { how: 'upi', amount: Math.round((EXP.total - 500) * 100) / 100 }] },
      invoice: INV } },
    detail: { line_items: LINES.map((l, i) => ({ particulars: l.name, quantity: l.qty, unit: l.unit, price: l.unit_price, total: Math.round(l.qty * l.unit_price * 100) / 100,   /* the chit's own line value — the invoice line's total (after offers, tax) is what the sheet must show */
       gst_rate: l.gst_rate, offer: l.discount ? { off: l.discount, label: 'Festival offer' } : undefined })) } };
  /* summary_json.money only (an older chit): the figures are what the header holds, never a sum of the lines */
  S.chits.ch2 = { header: { chit_id: 'ch2', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C1/26-27/0003', created_at: TODAY + 'T05:20:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }],
    summary_json: { currency_code: 'INR', money: { total: 1180, tax: 180, taxable: 1000, cgst: 90, sgst: 90, igst: 0, supply: 'intra', by_rate: { 18: { taxable: 1000, cgst: 90, sgst: 90, igst: 0, tax: 180 } } } },
    business_json: { bill_no: 'C1/26-27/0003', till: { id: 't1', name: 'Counter 1' }, customer: { name: 'Walk-in' } } },
    detail: { line_items: [{ particulars: 'Lamp', quantity: 1, unit: 'piece', price: 1180, total: 1180, gst_rate: 18 }] } };
  /* neither: nothing is invented */
  S.chits.nr1 = { header: { chit_id: 'nr1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C1/26-27/0004', created_at: TODAY + 'T23:30:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }], summary_json: { currency_code: 'INR' },
    business_json: { bill_no: 'C1/26-27/0004', till: { id: 't1', name: 'Counter 1' }, customer: { name: 'Walk-in' } } },
    detail: { line_items: [{ particulars: 'Pen', quantity: 1, unit: 'piece', price: 10, total: 10 }] } };
  /* an OLDER bill (before one computation went live, 2026-10-02 11:14 IST) with no stored figures: a KNOWN error, not the red one */
  S.chits.old1 = { header: { chit_id: 'old1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C1/26-27/0001', created_at: '2026-09-20T05:30:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }], summary_json: { currency_code: 'INR' },
    business_json: { bill_no: 'C1/26-27/0001', till: { id: 't1', name: 'Counter 1' }, customer: { name: 'Walk-in' } } },
    detail: { line_items: [{ particulars: 'Pen', quantity: 1, unit: 'piece', price: 10, total: 10 }] } };
  /* the stored total (999) is NOT the lines' sum (1180): a detail that recomputes would say 1,180 */
  S.chits.dt1 = { header: { chit_id: 'dt1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C1/26-27/0005', created_at: TODAY + 'T05:40:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }],
    summary_json: { currency_code: 'INR', money: { total: 999, tax: 99, savings: 12, taxable: 900, cgst: 49.5, sgst: 49.5, igst: 0, supply: 'intra', by_rate: { 12: { taxable: 900, cgst: 49.5, sgst: 49.5, igst: 0, tax: 99 } } } },
    business_json: { bill_no: 'C1/26-27/0005', till: { id: 't1', name: 'Counter 1' }, customer: { name: 'Walk-in' } } },
    detail: { line_items: [{ particulars: 'Lamp', quantity: 1, unit: 'piece', price: 1180, total: 1180, gst_rate: 18 }] } };
  S.chits.sb1 = { header: { chit_id: 'sb1', purpose: 'invoice', current_status: 'pending', manual_subject: 'AM-81', created_at: TODAY + 'T04:00:00.000Z',
    all_recipients: [{ role: 'sender', display_name: 'Agro Mills', entity_id: 'ent-agro' }, { role: 'receiver', display_name: SHOP, entity_id: 'ent-books' }],
    summary_json: { currency_code: 'INR', bill_received: { from: 'Agro Mills', total: 2500 }, money: { total: 2500, tax: 119.05, taxable: 2380.95, cgst: 59.52, sgst: 59.53, igst: 0, supply: 'intra', by_rate: { 5: { taxable: 2380.95, cgst: 59.52, sgst: 59.53, igst: 0, tax: 119.05 } } } },
    business_json: { bill_no: 'AM-81' } },
    state_log: [{ action: 'status', previous_status: null, new_status: 'pending', mine: false }], doc: 'bill_received',   /* STD1: the server says what it is (folder-inventory docOf) */
    detail: { line_items: [{ particulars: 'Basmati 25kg', quantity: 10, unit: 'bag', price: 238.095, total: 2380.95, gst_rate: 5 }] } };
  /* RCM-POST: a supplier bill under reverse charge — the frozen invoice says so (moneyOf(inv).rcm); the sheet must SAY who pays, never print GST 0.00 unexplained */
  S.chits.sb2 = { header: { chit_id: 'sb2', purpose: 'invoice', current_status: 'pending', manual_subject: 'SRT-7', created_at: TODAY + 'T04:30:00.000Z',
    all_recipients: [{ role: 'sender', display_name: 'Sri Ram Transport', entity_id: 'ent-srt' }, { role: 'receiver', display_name: SHOP, entity_id: 'ent-books' }],
    summary_json: { currency_code: 'INR', bill_received: { from: 'Sri Ram Transport', total: RCM_EXP.total }, money: { total: RCM_EXP.total, tax: 0 } },
    business_json: { bill_no: 'SRT-7', invoice: RCM_INV } },
    state_log: [{ action: 'status', previous_status: null, new_status: 'pending', mine: false }], doc: 'bill_received',
    detail: { line_items: [{ particulars: 'Freight Salem to Chennai', quantity: 1, unit: 'trip', price: 10000, total: 10000, gst_rate: 18, hsn: '996511', rcm_category: 'gta' }] } };
  S.chits.tk1 = { header: { chit_id: 'tk1', purpose: 'general', current_status: 'pending', manual_subject: 'Fix the shutter', created_at: TODAY + 'T03:00:00.000Z',
    all_recipients: [{ role: 'sender', display_name: 'Agro Mills', entity_id: 'ent-agro' }, { role: 'receiver', display_name: SHOP, entity_id: 'ent-books' }],
    summary_json: {}, business_json: {} }, detail: { line_items: [{ particulars: 'Shutter repair', quantity: 1, unit: 'job', price: 800, total: 800 }] } };
  const e = (n, id, ref, kind, by, extra) => Object.assign({ entry_id: 'e' + n, entry_no: 'JV/2026-27/00000' + n, posting_date: TODAY, doc_date: TODAY, event_type: 'sale_bill', source_chit_id: id, narration: 'Sale',
    source: { chit_id: id, ref, kind, counter: 'C2', by, count: null, how: 'UPI', how_ref: null, split: null, doc_at: TODAY + 'T05:10:00.000Z', recorded_at: TODAY + 'T05:10:03.000Z' },
    lines: [{ code: '1400', name: 'Cash', dr_minor: 68201, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 68201 }] }, extra || {});
  S.entries = [e(1, 'ch1', 'C2/26-27/0002', 'bill', SHOP), e(2, 'sb1', 'AM-81', 'purchase', 'Mani'), e(3, 'sb2', 'SRT-7', 'purchase', 'Mani')];
  for (let i = 4; i < 40; i++) S.entries.push(e(i, null, 'X' + i, 'bill', 'Mani', { source_chit_id: null, source: null }));   /* filler so the Day book scrolls */
  S.waiting = [{ id: 1, chit_id: 'sb1', ref: 'bill:sb1', todo: 'accept', reason: 'Waiting for you to confirm Agro Mills’ bill AM-81.', tries: 0, since: TODAY + 'T04:00:00Z', stuck: true }];
  /* F10: MY counter receipt carrying their bill (their_bill no + total) — the supplier bill to accept; sent by me, the header's status stays 'pending' */
  S.chits.rc1 = { header: { chit_id: 'rc1', purpose: 'receipt', current_status: 'pending', manual_subject: 'Receipt R/0007', created_at: TODAY + 'T04:20:00.000Z', sender_entity_id: 'ent-books',
    all_recipients: [me], summary_json: { currency_code: 'INR' },
    business_json: { doc: 'receipt', till: { id: 'C1' }, their_bill: { no: 'SG-103', total: 45 }, party: { name: 'Sri Ganesh Provisions', party_id: '33333333-3333-4333-8333-333333333333' } } },
    state_log: [], doc: 'bill_received', detail: { line_items: [{ particulars: 'Rice 1kg', quantity: 1, unit: 'bag', price: 45, total: 45, gst_rate: 0 }] } };
  S.chits.rc2 = JSON.parse(JSON.stringify(S.chits.rc1)); S.chits.rc2.header.chit_id = 'rc2'; S.chits.rc2.header.business_json.their_bill.no = 'SG-102'; S.chits.rc2.header.business_json.party = { name: 'Sri Ganesh' };
  S.parties = { 'P-00001': { party_id: '33333333-3333-4333-8333-333333333333', name: 'Sri Ganesh Provisions' } };
  return S;
}
/**
 * STD1 · the chit read as the server answers it: the stub, plus `books_wait` (this chit's open waiting row — books-store waitOfChitSql) and,
 * on a bill I received, `actions.accept` composed the way rail-actions.forBill does: refused WITH the books' sentence when the row asks
 * something other than acceptance, else ok. The sheet greys from THIS, never from a list the page holds.
 */
function chitRead(S, id) {
  const ch = S.chits[id], w = (S.waiting || []).filter((x) => x.chit_id === id).slice(-1)[0] || null;
  const wait = w ? { todo: w.todo || 'record', name: w.name || null, why: w.reason || w.why || null, candidates: w.candidates || [] } : null;
  const accept = ch.doc === 'bill_received' && wait && wait.todo !== 'accept' ? { ok: false, why: 'books_waiting', say: wait.why, todo: wait.todo } : { ok: true };
  /* FX-F10W2: and `actions.reject` — the level alone refuses it; it needs a reason (forBill + workflow needsOf) */
  const reject = ch.doc === 'bill_received' ? (S.rejectRefused ? { ok: false, why: 'read_only', say: 'You can only read this bill.' } : { ok: true, needs: ['reason'] }) : undefined;
  return Object.assign({}, ch, { books_wait: wait, actions: Object.assign({}, ch.actions || {}, { accept }, reject ? { reject } : {}) });
}
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
  if (p === '/api/books/status') return J(r, 200, { migrated: true, enabled: true, walkin_grain: 'day' });
  if (p === '/api/books/health') return J(r, 200, books.health({ last_check: { ok: true }, waiting: S.waiting.map((w) => books.waitingRow(w)) }));
  if (p === '/api/books/cheques') return J(r, 200, books.cheques());   /* the one cheques builder (e2e/lib/books-api.cjs) — asOf + remind as the master says since T3-P1 */
  if (p === '/api/books/dues') return J(r, 200, books.dues([], { asOf: TODAY }));
  if (p === '/api/books/daybook') return J(r, 200, books.daybook(S.entries.map(books.entry)));
  if (p === '/api/books/outbox/retry' && m === 'POST') { S.retries = (S.retries || 0) + 1; if (S.onRetry) S.onRetry(); return J(r, 200, { tried: 1, posted: 0, still: 1 }); }
  if (p.startsWith('/api/books')) return J(r, 200, {});
  let x;
  if ((x = p.match(/^\/api\/chits\/([^/]+)\/status$/)) && m === 'PUT') {
    /* FX-F10W2: the server refuses a bill's reject without a reason (routes/chits.js moveStatus: reason_required) */
    if (body.status === 'rejected' && !String(body.note || '').trim() && S.chits[x[1]].doc === 'bill_received') return J(r, 400, { error: 'Reason required', code: 'reason_required', message: 'Say why you are rejecting this bill — the reason goes on the bill.' });
    S.statusCalls.push({ id: x[1], body }); S.calls.push('status');
    /* a bill I received: since "bills-private" my step is a bill_step row in MY state_log — the shared status is the seller's and does not move */
    /* FX-F10W: a captured receipt IS a bill (folder-inventory bill_received) — its step is a bill_step too, the header's status never moves */
    if (/^(invoice|receipt)$/.test(S.chits[x[1]].header.purpose)) { if (!S.staleRead) (S.chits[x[1]].state_log = S.chits[x[1]].state_log || []).push({ action: 'bill_step', code: 'B-2100', step: body.status, mine: true, action_by_display_name: SHOP, created_at: new Date().toISOString() }); S.waiting = S.waiting.filter((w) => w.chit_id !== x[1]); }
    else S.chits[x[1]].header.current_status = body.status;
    /* the server's answer (routes/chits.js moveStatus): "pending → accepted", or the noop "Already accepted" */
    return J(r, 200, S.noop ? { message: 'Already ' + body.status, chit_id: x[1], status: body.status, noop: true } : { message: 'Chit ' + body.status, warning: null, chit_id: x[1], previous_status: 'pending', new_status: body.status });
  }
  if ((x = p.match(/^\/api\/chits\/([^/]+)\/use$/)) && m === 'PUT') { S.useCalls.push({ id: x[1], body }); S.calls.push('use');
    /* FX-F10W: { party: { party_no } } — the server resolves it in MY supplier list and writes party.party_id on my receipt */
    if (body.party && S.parties && S.parties[body.party.party_no]) { const pt = S.parties[body.party.party_no]; S.chits[x[1]].header.business_json.party = { name: pt.name, party_id: pt.party_id }; return J(r, 200, { ok: true, party: Object.assign({ party_no: body.party.party_no }, pt) }); }
    return J(r, 200, { ok: true }); }
  if ((x = p.match(/^\/api\/chits\/([^/]+)\/dispute/)) && m === 'POST') { S.disputes++; return J(r, 200, { ok: true }); }
  if ((x = p.match(/^\/api\/chits\/([^/]+)$/)) && m === 'GET') { S.chitReads++; return S.chits[x[1]] ? J(r, 200, chitRead(S, x[1])) : J(r, 404, { error: 'no chit' }); }
  if (p === '/api/folders' && m === 'GET') return J(r, 200, { folders: [
    { folder_id: 'a0000000-0000-5000-8000-000000002100', parent_id: null, name: 'Bills · Received', code: 'B-2100', kind: 'view', system: true, scope: null, side: 'received', count: 2, total: 3 },
    { folder_id: 'a0000000-0000-5000-8000-000000001300', parent_id: null, name: 'Bills · Issued', code: 'B-1300', kind: 'view', system: true, scope: null, side: 'issued', count: 0, total: 0 }] });
  if (p.match(/^\/api\/folders\/[^/]+\/chits$/)) return J(r, 200, { chits: [
    { chit_id: 'sb1', bill_no: 'AM-81', manual_subject: 'Bill AM-81 from Agro Mills', counterparty_name: 'Agro Mills', value: '2500', currency: 'INR', doc_kind: 'bill_received',
      all_recipients: [{ role: 'receiver', display_name: 'Books Shop', handle: 'books-shop' }],
      bill: { step: 'accepted', code: 'B-2100', label: 'Bill accepted', by: 'books-shop', at: TODAY + 'T06:00:00Z', open: true, paid: false } },
    { chit_id: 'sb2', bill_no: 'AM-82', manual_subject: 'Bill AM-82 from Agro Mills', counterparty_name: 'Agro Mills', value: '1200', currency: 'INR', doc_kind: 'bill_received',
      bill: { step: 'received', code: 'B-2100', label: 'Received', by: 'Mani', at: TODAY + 'T06:10:00Z', open: true, paid: false } }] });
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  const srv = http.createServer((q, r) => { const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];
  /* R102: a bill's Accept asks first (CBConfirm) — the Yes tap; a captured receipt with no use choice asks straight from the Accept tap */
  async function yesAccept(p) {
    await p.waitForSelector('#cb_confirm [data-testid="confirm-ok"]', { timeout: 5000 });
    await p.click('#cb_confirm [data-testid="confirm-ok"]');
  }
  async function open(S, width) {
    const ctx = await b.newContext({ viewport: { width: width || 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript(([shop]) => { try {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
      localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: shop })); } catch (_) {} }, [SHOP]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    /* the Ledger lives on /accounts.html (the in-app door redirects there) — the sheet is opened from CB Accounts' own Day book */
    await p.goto(base + '/accounts.html#daybook');
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 20000 });
    await p.click('[data-testid="acc-nav-daybook"]');
    await p.waitForSelector('[data-testid="db-entry-JV/2026-27/000001"]', { timeout: 15000 });
    return { ctx, p };
  }
  const acts = (p) => p.$$eval('#chitsheet [data-testid^="cs-act-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice(7)));
  const sheetOpen = (p) => p.evaluate(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open); });
  const waitSheet = (p, no) => p.waitForFunction((n) => { const d = document.getElementById('chitsheet'); return d && d.open && (d.querySelector('[data-testid="cs-no"]') || {}).textContent === n; }, no, { timeout: 8000 }).catch(() => {});
  const noAccounting = async (p, where) => { const t = await p.evaluate(() => document.body.innerText); ok(!/accounting|books of account/i.test(t), where + ': the word "accounting" is nowhere on screen'); };
  const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };

  const env = { ok, open, standIn, waitSheet, acts, sheetOpen, yesAccept, take, SHOP, TODAY };   /* what the blocks in chit-sheet-blocks.cjs need */

  /* ── 1 · the counter bill, from the Day book ─────────────────────────────────────────────────────── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    const head1 = await p.textContent('[data-testid="db-entry-JV/2026-27/000001"]');
    ok(/Books Shop \(owner\)/.test(head1), 'by == the shop\'s own name → "Books Shop (owner)" in the source line');
    ok(!/Mani \(owner\)/.test(await p.textContent('[data-testid="db-head-JV/2026-27/000002"]')), 'another person is not marked (owner)');
    await B.wideRung(env);
    /* scroll the page down to a row far from the top, remember where */
    const scroller = await p.evaluateHandle(() => { let e = document.querySelector('[data-testid="db-entry-JV/2026-27/000001"]'); while (e && e !== document.documentElement) { if (e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)) return e; e = e.parentElement; } return document.scrollingElement; });
    await scroller.evaluate((e) => { e.scrollTop = 120; });
    const before = await scroller.evaluate((e) => e.scrollTop);
    const hrefBefore = await p.evaluate(() => location.href);
    /* CBList: the list scrolls INSIDE the frozen head (.cbl-list), and the first entry sits at its very top - so a Playwright click would first scroll that row
       back into view and reset the scroll this test is measuring. The click is dispatched on the element instead (the scroll is left as the person left it). */
    await p.locator('[data-testid="db-src-JV/2026-27/000001"]').evaluate((e) => e.click());
    await waitSheet(p, 'C2/26-27/0002');
    ok(await sheetOpen(p), 'tapping the bill number opens the sheet (a <dialog>) over the Day book');
    const head = await p.textContent('[data-testid="cs-head"]');
    ok(/Counter bill/.test(head) && /C2\/26-27\/0002/.test(head) && /Counter C2/.test(head) && !/Counter 2/.test(head) && /Books Shop/.test(head), 'header: kind · number · date/time · counter (C2 — the way the Day book says it, not the till\'s "Counter 2") · person — ' + head.replace(/\s+/g, ' ').trim());
    ok(/Counter C2/.test(await p.textContent('[data-testid="db-entry-JV/2026-27/000001"]')), 'the Day book names the same counter: Counter C2');
    /* every figure is CBTax.moneyOf(invoice), to the paisa — read off the DOM cells, compared with the engine's own numbers */
    const nums = async (sel) => (await p.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/[₹,\s]/g, ''))));
    const lineTotals = await nums('#chitsheet tbody tr[data-testid^="cs-line-"] td:last-child');
    ok(lineTotals.length === 4 && lineTotals.every((t, i) => t === f2(EXP.lines[i].total)), 'the popup\'s line totals equal moneyOf(invoice).lines — ' + lineTotals.join(' · '));
    const off0 = (await p.textContent('[data-testid="cs-offer-0"]')).replace(/[₹,\s]/g, '');
    ok(await p.locator('[data-testid="cs-offer-1"]').count() === 0 && /Festivaloffer/.test(off0) && off0.endsWith('−' + f2(EXP.lines[0].discount)), 'line 1\'s offer is the invoice line\'s discount (' + f2(EXP.lines[0].discount) + '), labelled — ' + off0);
    for (const rt of Object.keys(EXP.by_rate)) {
      const c = await nums('[data-testid="cs-gst-' + rt + '"] td'), v = EXP.by_rate[rt];
      ok(c[0] === rt + '%' && c[1] === f2(v.taxable) && c[2] === f2(v.cgst) && c[3] === f2(v.sgst), 'GST ' + rt + '%: taxable ' + f2(v.taxable) + ' · CGST ' + f2(v.cgst) + ' · SGST ' + f2(v.sgst) + ' = moneyOf(invoice).by_rate — ' + c.join(' | '));
    }
    const foot = await nums('[data-testid="cs-gst"] tr.tot td');
    ok(foot[1] === f2(EXP.taxable) && foot[2] === f2(EXP.cgst) && foot[3] === f2(EXP.sgst), 'the GST footing is the invoice\'s own totals (' + foot.join(' | ') + ') — no hand halving, no column sum');
    ok(/GST summary/i.test(await p.textContent('#chitsheet')) && /CGST/.test(await p.textContent('[data-testid="cs-gst"]')) && /SGST/.test(await p.textContent('[data-testid="cs-gst"]')), 'the summary is headed GST summary with CGST / SGST columns');
    ok((await p.textContent('[data-testid="cs-total"]')).replace(/[₹,\s]/g, '') === f2(EXP.total), 'the total is moneyOf(invoice).total — ' + f2(EXP.total));
    ok(EXP.round_off === 0 ? await p.locator('[data-testid="cs-roundoff"]').count() === 0 : (await p.textContent('[data-testid="cs-roundoff"]')).replace(/[₹,\s]/g, '').endsWith(f2(EXP.round_off)), 'round-off ' + f2(EXP.round_off) + (EXP.round_off ? ' shown' : ' — none, no row'));
    const t0 = await p.textContent('[data-testid="cs-tender-0"]'), t1 = await p.textContent('[data-testid="cs-tender-1"]');
    ok(/Cash/.test(t0) && /500/.test(t0) && /UPI/.test(t1) && t1.replace(/[₹,\s]/g, '').endsWith(f2(EXP.total - 500)), 'tender: Cash 500.00 · UPI ' + f2(EXP.total - 500));
    /* as the counter's slip prints it: each tender, then Change when there is some; the tenders add up to the total */
    const tenders = await p.$$eval('#chitsheet [data-testid^="cs-tender-"] b', (els) => els.map((e) => e.textContent));
    const tsum = Math.round(tenders.reduce((a, x) => a + Number(x.replace(/[^0-9.]/g, '')), 0) * 100) / 100;
    ok(tenders.length === 2 && tsum === Number((await p.textContent('[data-testid="cs-total"]')).replace(/[^0-9.]/g, '')), 'tender parts add up to the total (' + tenders.join(' + ') + ' = ' + tsum + ')');
    ok(/25\.74/.test(await p.textContent('[data-testid="cs-change"]')) && (S.chits.ch1.header.business_json.payment.paid === tsum), 'Change 25.74 is its own line, and the chit\'s paid figure is the tenders\' sum');
    ok(await p.textContent('[data-testid="cs-title"]') === 'Bill' && !/\bChit\b/.test(await p.textContent('#chitsheet')), 'the title of a counter bill is "Bill" — "Chit" is nowhere on the sheet');
    ok(/Walk-in/.test(await p.textContent('[data-testid="cs-who"]')) && /Done/.test(await p.textContent('[data-testid="cs-step"]')), 'the customer and the step word (Done)');
    const a = await acts(p);
    ok(JSON.stringify(a) === JSON.stringify(['print', 'return', 'page']), 'cart bill icon row = Print · Return · Open page — got ' + a.join(' · '));
    ok(!a.includes('dispute') && !a.includes('accept'), 'a cart bill has no Dispute (and no Accept)');
    await shot(p, 'chit-sheet-cart'); await shot(p, 'chit-sheet-invoice-laptop');
    await noAccounting(p, 'sheet');
    /* Return is honest: no web return flow exists, so it says where returns are made */
    await p.click('[data-testid="cs-act-return"]');
    ok(/counter/i.test(await p.textContent('[data-testid="cs-note"]')), 'Return says where a return is made');
    ok(!/chit-detail|#\/chit/.test(await p.evaluate(() => location.href)) && await p.evaluate(() => location.href) === hrefBefore, 'opening the sheet did not navigate');
    /* Esc closes; the Day book is exactly where it was */
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    ok(!(await sheetOpen(p)), 'Esc closes the sheet');
    ok(await scroller.evaluate((e) => e.scrollTop) === before && before > 0, 'back on the Day book at the same scroll position (' + before + ')');
    await p.locator('[data-testid="db-src-JV/2026-27/000001"]').evaluate((e) => e.click()); await waitSheet(p, 'C2/26-27/0002');
    await p.click('[data-testid="cs-close"]'); await p.waitForTimeout(250);
    ok(!(await sheetOpen(p)) && await scroller.evaluate((e) => e.scrollTop) === before, 'Close does the same');
    await B.windowScrollSpy(env, p);
    await ctx.close();
  }

  /* ── 2 · a received supplier bill: Accept · Dispute · Goods in · Open page ─────────────────────── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.click('[data-testid="db-src-JV/2026-27/000002"]'); await waitSheet(p, 'AM-81');
    const a = await acts(p);
    ok(JSON.stringify(a) === JSON.stringify(['accept', 'reject', 'dispute', 'goodsin', 'page']), 'supplier bill icon row = Accept · Reject · Dispute · Goods in · Open page — got ' + a.join(' · '));
    ok(/Supplier bill/.test(await p.textContent('[data-testid="cs-head"]')) && /Agro Mills/.test(await p.textContent('[data-testid="cs-who"]')) && /To accept/.test(await p.textContent('[data-testid="cs-step"]')), 'a supplier bill: who is Agro Mills, step "To accept"');
    ok(/2,?380\.95/.test(await p.textContent('[data-testid="cs-gst-5"]')) && /59\.52/.test(await p.textContent('[data-testid="cs-gst-5"]')) && /59\.53/.test(await p.textContent('[data-testid="cs-gst-5"]')), 'its GST row is the chit\'s own (taxable 2,380.95 · CGST 59.52 · SGST 59.53)');
    ok(await p.textContent('[data-testid="cs-title"]') === 'Supplier bill', 'the title of a bill received is "Supplier bill"');
    await shot(p, 'chit-sheet-supplier-bill');
    /* Accept on a bill received ASKS what it is for first — nothing is sent until the choice is made */
    await p.click('[data-testid="cs-act-accept"]');
    await p.waitForSelector('[data-testid="bill-use-choice"]', { timeout: 5000 }).catch(() => {});
    ok(await p.locator('[data-testid="bill-use-choice"]').count() === 1 && await p.locator('[data-testid="bill-use-resale"]').count() === 1 && await p.locator('[data-testid="bill-use-use"]').count() === 1 && await p.locator('[data-testid="bill-use-asset"]').count() === 1, 'Accept shows the same choice Goods in shows (billUseChoiceHTML): For resale · For the shop · An asset');
    ok(S.statusCalls.length === 0 && S.useCalls.length === 0 && /To accept/.test(await p.textContent('[data-testid="cs-step"]')), 'nothing was sent by the Accept tap itself — the step is still "To accept"');
    await shot(p, 'chit-sheet-accept-use');
    /* R102 (walk 24 Oct): the choice made, the ACCEPT ASKS FIRST — a money promise names the supplier, the bill and the amount; Cancel sends nothing */
    await p.click('[data-testid="bill-use-resale"]');
    await p.waitForSelector('#cb_confirm [data-testid="confirm-ok"]', { timeout: 5000 }).catch(() => {});
    const askT = await p.textContent('#cb_confirm').catch(() => '');
    ok(/Accept bill AM-81 from Agro Mills for ₹\s?2,500\.00\?/.test(askT) && /You will owe them this amount\./.test(askT), 'R102 · Accept asks first: "Accept bill AM-81 from Agro Mills for ₹2,500.00? You will owe them this amount." — got ' + askT.replace(/\s+/g, ' ').slice(0, 120));
    await shot(p, 'chit-sheet-accept-ask');
    await p.click('#cb_confirm [data-testid="confirm-cancel"]'); await p.waitForTimeout(300);
    ok(S.statusCalls.length === 0 && S.useCalls.length === 0 && /To accept/.test(await p.textContent('[data-testid="cs-step"]')) && (await acts(p)).indexOf('accept') >= 0, 'R102 · Cancel: nothing written (no /use, no /status), the step is still "To accept", Accept still offered');
    await p.click('[data-testid="cs-act-accept"]'); await p.waitForSelector('[data-testid="bill-use-resale"]', { timeout: 5000 });
    await p.click('[data-testid="bill-use-resale"]'); await p.waitForSelector('#cb_confirm [data-testid="confirm-ok"]', { timeout: 5000 });
    await p.click('#cb_confirm [data-testid="confirm-ok"]');
    await p.waitForFunction(() => /Accepted/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.useCalls.length === 1 && S.useCalls[0].id === 'sb1' && S.useCalls[0].body.use === 'resale' && S.statusCalls.length === 1 && S.statusCalls[0].id === 'sb1' && S.statusCalls[0].body.status === 'accepted' && S.calls.join() === 'use,status', 'the choice → Yes → PUT /use {use:"resale"} then PUT /status {status:"accepted"}, once each, in that order');
    ok(S.chits.sb1.header.current_status === 'pending', 'the shared status did not move (the seller\'s) — only my state_log did');
    ok(/Accepted/.test(await p.textContent('[data-testid="cs-step"]')), 'the sheet repainted with the new step, read from the state_log bill_step row');
    const hist = (await p.locator('[data-testid^="cs-hist-"]').allTextContents()).join(' | ');
    ok(/Accepted by Books Shop/.test(hist) && !/\bStep\b/.test(hist), 'R102 · the history reads "Accepted by Books Shop", not "Step" — got ' + hist.slice(0, 120));
    const a2 = await acts(p);
    ok(JSON.stringify(a2) === JSON.stringify(['dispute', 'page']), 'once accepted the row is Dispute · Open page — got ' + a2.join(' · '));
    /* the Day book\'s to-do and Waiting stop saying "To accept" for it */
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(await p.locator('[data-testid="todo-accept"]').count() === 0, 'the Day book\'s "supplier bill to accept" to-do is gone');
    await ctx.close();
  }
  await B.billStepBlocks(env);
  await B.acceptUseBlocks(env);
  /* ── 3 · a task, from the Waiting list ──────────────────────────────────────────────────────────── */
  {
    const S = standIn(); S.waiting = [{ id: 9, chit_id: 'tk1', ref: 'chit:tk1', todo: 'accept', reason: 'Waiting for you to confirm a task.', tries: 0, since: TODAY + 'T04:00:00Z', stuck: true }];
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    await p.click('[data-testid="wait-0"]'); await waitSheet(p, 'Fix the shutter');
    ok(await p.textContent('[data-testid="cs-title"]') === 'Task' && !/\bChit\b/.test(await p.textContent('#chitsheet')), 'the title of a task is the purpose word, "Task" — never "Chit"');
    const a = await acts(p);
    ok(JSON.stringify(a) === JSON.stringify(['accept', 'dispute', 'page']), 'a task icon row = Accept · Dispute · Open page — got ' + a.join(' · '));
    await p.click('[data-testid="cs-act-accept"]');
    await p.waitForFunction(() => /In hand/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.statusCalls.length === 1 && S.statusCalls[0].body.status === 'in_progress', 'a task\'s Accept → in_progress');
    ok(JSON.stringify(await acts(p)) === JSON.stringify(['dispute', 'done', 'page']), 'in hand: Dispute · Done · Open page');
    await p.click('[data-testid="cs-act-done"]');
    await p.waitForFunction(() => /Done/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.statusCalls.length === 2 && S.statusCalls[1].body.status === 'completed', 'Done → completed');
    await ctx.close();
  }
  /* ── 3b · the to-do "supplier bill to accept": one → its sheet over the Day book; several → Waiting. Never Intake ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="todo-accept"]', { timeout: 8000 });
    const href = await p.evaluate(() => location.href), nav = await p.evaluate(() => UI.nav);
    ok(/^1 supplier bill to accept/.test(await p.textContent('[data-testid="todo-accept"]')), 'to-do: 1 supplier bill to accept');
    const reads0 = S.chitReads;
    await p.click('[data-testid="todo-accept"]'); await waitSheet(p, 'AM-81');
    ok(await sheetOpen(p) && await p.evaluate(() => document.getElementById('chitsheet').tagName) === 'DIALOG', 'the one-bill to-do opens the sheet (a <dialog>) for that chit');
    ok(S.chitReads === reads0 + 1 && /AM-81/.test(await p.textContent('[data-testid="cs-no"]')) && await p.evaluate(() => location.href) === href && await p.evaluate(() => UI.nav) === nav && nav !== 'intake', 'it read that chit once and never navigated (not Intake)');
    ok(await p.locator('[data-testid="db-entry-JV/2026-27/000001"]').isVisible(), 'the Day book is still there behind the sheet');
    await shot(p, 'chit-sheet-todo');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await ctx.close();
  }
  {
    const S = standIn(); S.waiting.push({ id: 2, chit_id: 'sb2', ref: 'bill:sb2', todo: 'accept', reason: 'Waiting for you to confirm Agro Mills’ bill AM-82.', tries: 0, since: TODAY + 'T04:30:00Z', stuck: true });
    const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="todo-accept"]', { timeout: 8000 });
    ok(/^2 supplier bills to accept/.test(await p.textContent('[data-testid="todo-accept"]')), 'to-do: 2 supplier bills to accept');
    await p.click('[data-testid="todo-accept"]');
    await p.waitForSelector('[data-testid="bills-tab-B-2100"]', { timeout: 8000 }).catch(() => {});
    ok(!(await sheetOpen(p)) && await p.evaluate(() => UI.nav) !== 'intake' && await p.locator('[data-testid="bills-tab-B-2100"]').count() === 1, 'the several-bills to-do opens the Received bills, not a sheet and not Intake');
    await ctx.close();
  }
  /* ── 3d · THE WAITING LIST IS THE TASK TABLE (docs/design/one-table): Supplier · Bill no · Amount · Date · Step; the bill opens in the popup ── */
  {
    const S = standIn();
    S.waiting.push({ id: 7, chit_id: 'ch1', ref: 'bill:ch1', reason: 'September is locked. Open it again to record this bill.', tries: 3, since: TODAY + 'T05:00:00Z' });
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    await p.waitForFunction(() => /Agro Mills/.test((document.querySelector('[data-testid="wait-0"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const heads = await p.$$eval('#bk_body .lhead .lhcell', (els) => els.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()));
    /* FX-F10W2: the four a person needs (defaultCols) — the top-three default left Bill no out */
    ok(JSON.stringify(heads) === JSON.stringify(['Party', 'Bill no', 'Amount', 'Step']), 'Waiting is the Task table, its columns Party · Bill no · Amount · Step: ' + heads.join(' · '));
    /* the rest are one tick away in the columns chooser (date) */
    await p.click('[data-testid="cols-btn-waiting"]'); await p.click('[data-testid="cols-waiting-date"]'); await p.click('[data-testid="cols-btn-waiting"]');
    const row0 = (await p.textContent('[data-testid="wait-0"]')).replace(/\s+/g, ' ');
    ok(/Agro Mills/.test(row0) && /AM-81/.test(row0) && /2,500\.00/.test(row0) && /To accept/.test(row0), 'a supplier bill row reads supplier · bill no · amount (summary_json.money.total) · step: "' + row0.trim() + '"');
    const body = await p.textContent('#bk_body');
    ok(!/sb1|bill:|\btries\b|\d tries/.test(body), 'no chit id and no "tries" on the list');
    ok(/September is locked/.test(await p.textContent('[data-testid="wait-1"]')) && await p.locator('[data-testid="wait-retry"]').count() === 1, 'a posting that genuinely failed shows its reason in the Step column, and Try again is offered');
    await p.click('[data-testid="wait-0"] [data-caret]');
    await p.waitForSelector('[data-testid="wait-lines-0"]', { timeout: 5000 }).catch(() => {});
    ok(/Basmati 25kg/.test(await p.textContent('[data-testid="wait-lines-0"]')) && !(await sheetOpen(p)), 'the caret opens the next level — the bill\'s lines — and does not open the sheet');
    await shot(p, 'one-table-waiting-laptop');
    await p.click('[data-testid="wait-0"] .lcell:nth-child(2)'); await waitSheet(p, 'AM-81');
    ok(await sheetOpen(p), 'a click on the row opens the bill in the popup');
    await p.click('[data-testid="cs-act-accept"]');
    await p.waitForSelector('[data-testid="cs-use"]', { timeout: 5000 }).catch(() => {});
    ok(/resale|Resale/i.test(await p.textContent('[data-testid="cs-use"]')) && /asset/i.test(await p.textContent('[data-testid="cs-use"]')), 'Accept asks what the goods are for — resale · own use · asset');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(await p.locator('.bkdv-row, .bktab').count() === 0, 'the Waiting screen draws no row or table of its own');
    await ctx.close();
    const S2 = standIn(); const { ctx: c2, p: p2 } = await open(S2, 390);
    await p2.evaluate(() => bkTab('waiting')); await p2.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    await p2.waitForFunction(() => /Agro Mills/.test((document.querySelector('[data-testid="wait-0"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(await p2.evaluate(() => document.documentElement.scrollWidth) === 390 && await p2.evaluate(() => getComputedStyle(document.querySelector('[data-testid="wait-0"]')).display) === 'flex', 'phone: Waiting is one card per row and scrollWidth === 390');
    await shot(p2, 'one-table-waiting-phone');
    await c2.close();
  }
  /* ── 3c · the other two readings: summary_json.money alone · neither (opened from the page, as a link would) ── */
  /* ── 3e · FX-F10W: a captured receipt — Accept repaints the sheet from the server's answer, and its Waiting row leaves without a reload ── */
  {
    const S = standIn();
    S.waiting = [{ id: 11, chit_id: 'rc1', ref: 'chit:rc1', todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-103 from Sri Ganesh Provisions)', tries: 0, since: TODAY + 'T04:20:00Z' },
      { id: 7, chit_id: 'ch1', ref: 'bill:ch1', reason: 'September is locked. Open it again to record this bill.', tries: 3, since: TODAY + 'T05:00:00Z' }];   /* a second row keeps the list on screen */
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    await p.waitForFunction(() => /Sri Ganesh Provisions/.test((document.querySelector('[data-testid="wait-0"]') || {}).textContent || ''), null, { timeout: 8000 });
    await p.evaluate(() => { document.querySelector('[data-testid="waiting-list"]').__kept = true; });
    await p.getByText('Sri Ganesh Provisions').first().click(); await waitSheet(p, 'SG-103');
    ok(await sheetOpen(p) && /To accept/.test(await p.textContent('[data-testid="cs-step"]')), 'F10W · the NAME on the Waiting row opens the receipt\'s sheet, "To accept"');
    await p.click('[data-testid="cs-act-accept"]'); await yesAccept(p);
    await p.waitForFunction(() => /Accepted/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/Accepted/.test(await p.textContent('[data-testid="cs-step"]')) && await p.locator('[data-testid="cs-act-accept"]').count() === 0 && S.statusCalls.length === 1,
      'F10W · "pending → accepted": the sheet repaints its step (Accepted) and drops Accept — one status call — got ' + (await p.textContent('[data-testid="cs-step"]')));
    await p.waitForFunction(() => !/Sri Ganesh/.test((document.querySelector('[data-testid="waiting-list"]') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);   /* the /health read behind it lands: the list must still be the same one */
    ok(!/Sri Ganesh/.test(await p.textContent('[data-testid="waiting-list"]')) && await p.evaluate(() => document.querySelector('[data-testid="waiting-list"]').__kept === true),
      'F10W · the Waiting row left the list at once — the list was flipped, never reloaded');
    ok(await p.evaluate(() => BK.waitN.accept === 0 && BK.waitN.record === 1 && BK.waitN.total === 1),
      'F10W · STD1 · …and the one count follows the flip (0 to accept · 1 to record · 1 in all)');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  {
    /* the server already moved it (a second door) — the answer is the noop "Already accepted", and a read that has not caught up still says pending */
    const S = standIn(); S.noop = true; S.staleRead = true;
    S.waiting = [{ id: 11, chit_id: 'rc1', ref: 'chit:rc1', todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-103 from Sri Ganesh Provisions)', tries: 0, since: TODAY + 'T04:20:00Z' }];
    const { ctx, p } = await open(S);
    await p.evaluate(() => openChitSheet('rc1')); await waitSheet(p, 'SG-103');
    await p.click('[data-testid="cs-act-accept"]'); await yesAccept(p);
    await p.waitForFunction(() => /Accepted/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/Accepted/.test(await p.textContent('[data-testid="cs-step"]')) && await p.locator('[data-testid="cs-act-accept"]').count() === 0,
      'F10W · "Already accepted" (noop) is painted as Accepted even when the read lags — a second Accept is never offered');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  /* ── 3e2 · FX-F10W2: REJECT, with its reason — the existing status step (PUT /status rejected + note); the row leaves Waiting; the popup reads the receipt's own money ── */
  {
    const S = standIn();
    S.chits.rc1.header.business_json.their_bill.total = 441;
    S.chits.rc1.header.business_json.input_tax = { taxable: 420, tax: 21, supply: 'intra', heads: [{ name: 'CGST', rate: 2.5, amount: 10.5 }, { name: 'SGST', rate: 2.5, amount: 10.5 }], inclusive: false, vendor_state: '33' };
    S.chits.rc1.detail.line_items = [{ particulars: 'Toor dal', quantity: 4, unit: 'kg', price: 105, value: 420, gst_rate: 5 }];   /* the receipt line's own value, no `total` */
    S.waiting = [{ id: 21, chit_id: 'rc1', ref: 'chit:rc1', todo: 'record', reason: 'Their bill SG-103 says ₹441.00, goods ₹400.00 + tax ₹20.00 come to ₹420.00 — ₹21.00 apart. Ask Sri Ganesh Provisions to correct it, or reject it and record their bill by hand.', tries: 0, since: TODAY + 'T04:20:00Z' },
      { id: 7, chit_id: 'ch1', ref: 'bill:ch1', reason: 'September is locked. Open it again to record this bill.', tries: 3, since: TODAY + 'T05:00:00Z' }];
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    const hd = await p.$$eval('[data-testid="waiting-list"] .cbl-head [data-col], [data-testid="waiting-list"] [role="columnheader"]', (els) => els.map((e) => e.textContent.trim())).catch(() => []);
    const wtext = await p.textContent('[data-testid="waiting-list"]');
    ok(/Bill no/.test(wtext) && /SG-103/.test(wtext) && /Party/.test(wtext) && /Amount/.test(wtext) && /Step/.test(wtext), 'FX-F10W2 · Waiting at 1360 shows Party · Bill no · Amount · Step (Bill no was left out) — ' + JSON.stringify(hd));
    await p.evaluate(() => openChitSheet('rc1')); await waitSheet(p, 'SG-103');
    ok(/420/.test(await p.textContent('[data-testid="cs-line-0"]')) && !/—/.test((await p.$$eval('[data-testid="cs-line-0"] td', (t) => t.map((x) => x.textContent))).pop()),
      'FX-F10W2 · the receipt line shows its own value (₹420), never "—"');
    ok(await p.locator('[data-testid="cs-gst-none"]').count() === 0 && /21/.test(await p.textContent('[data-testid="cs-gst-total"]')), 'FX-F10W2 · the GST the counter recorded (input_tax ₹21) is shown — never "not recorded" when it is');
    const a = await p.$$eval('[data-testid="cs-acts"] .cs-act', (els) => els.map((e) => e.getAttribute('data-testid').replace('cs-act-', '')));
    ok(JSON.stringify(a) === JSON.stringify(['accept', 'reject', 'page']) && await p.locator('[data-testid="cs-act-reject"]:not([disabled])').count() === 1,
      'FX-F10W2 · a captured receipt offers Accept · Reject · Open page; Reject is live while the books wait on a gap (rejecting is the fix they name) — got ' + a.join(' · '));
    await p.click('[data-testid="cs-act-reject"]');
    ok(await p.locator('[data-testid="cs-reason"]').count() === 1 && S.statusCalls.length === 0, 'FX-F10W2 · Reject asks why first — nothing sent by the tap');
    await p.click('[data-testid="cs-reject-go"]'); await p.waitForTimeout(150);
    ok(S.statusCalls.length === 0 && /reason/i.test(await p.textContent('[data-testid="cs-note"]')), 'FX-F10W2 · …no reason → nothing sent, said');
    await p.fill('[data-testid="cs-reason"]', 'Their bill is ₹21 more than the goods and tax');
    await p.click('[data-testid="cs-reject-go"]');
    await p.waitForFunction(() => /Rejected/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.statusCalls.length === 1 && S.statusCalls[0].body.status === 'rejected' && S.statusCalls[0].body.note === 'Their bill is ₹21 more than the goods and tax',
      'FX-F10W2 · → PUT /status { status: rejected, note: <the reason> } once — the reason goes on the bill — ' + JSON.stringify(S.statusCalls));
    ok(/Rejected/.test(await p.textContent('[data-testid="cs-step"]')) && await p.locator('[data-testid="cs-act-accept"]').count() === 0 && await p.locator('[data-testid="cs-act-reject"]').count() === 0,
      'FX-F10W2 · the sheet says Rejected and offers neither Accept nor Reject again (the bill_step "rejected" is read as rejected)');
    await p.waitForFunction(() => !/SG-103/.test((document.querySelector('[data-testid="waiting-list"]') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    ok(!/SG-103/.test(await p.textContent('[data-testid="waiting-list"]')), 'FX-F10W2 · its Waiting row left the list (the server closed it: "Rejected — not posted")');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  {
    const S = standIn(); S.rejectRefused = true;
    const { ctx, p } = await open(S);
    await p.evaluate(() => openChitSheet('rc1')); await waitSheet(p, 'SG-103');
    const rj = p.locator('#chitsheet [data-testid="cs-act-reject"]');
    ok(await rj.count() === 1 && await rj.isDisabled() && /only read/.test(await rj.getAttribute('title') || ''), 'FX-F10W2 · a refused Reject (actions.reject) is shown greyed WITH the server\'s sentence');
    ok(/only read/.test(await p.textContent('#chitsheet [data-testid="cs-why"]') || ''), 'UX-116 R60 · the greyed action also says why in a line on the sheet, not only in its tooltip');
    ok(await p.locator('#chitsheet [data-testid="msg-channel-internal"].on').count() === 1, 'UX-116 R60 · the message box starts as a team note (Internal); the other side is a deliberate switch');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  /* ── 3f · FX-F10W: "Who is Sri Ganesh?" carries the shop's near match — "Is this Sri Ganesh Provisions (P-00001)?" links, never a second party ── */
  {
    const S = standIn();
    const toAccept = { id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-102 from Sri Ganesh Provisions)', tries: 1, since: TODAY + 'T04:10:00Z' };
    S.waiting = [{ id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'add_supplier', name: 'Sri Ganesh', reason: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-102 waits for you to accept it.', tries: 0, since: TODAY + 'T04:10:00Z',
      candidates: [{ name: 'Sri Ganesh Provisions', party_no: 'P-00001' }] }];
    S.onRetry = () => { if (S.chits.rc2.header.business_json.party.party_id) S.waiting = [toAccept]; };
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-link-0-0"]', { timeout: 8000 });
    ok(/^Is this Sri Ganesh Provisions \(P-00001\)\?$/.test((await p.textContent('[data-testid="wait-link-0-0"]')).trim()) && await p.locator('[data-testid="wait-addsup-0"]').count() === 1,
      'F10W · the row asks "Is this Sri Ganesh Provisions (P-00001)?" first; Add supplier stays the second choice');
    ok(await p.evaluate(() => BK.waitN.add_supplier === 1 && BK.waitN.accept === 0 && bkTodoCounts(null, null, { waiting: BK.waiting, total: 1, todo: { accept: 0, add_supplier: 1, record: 0 } }).supplier === 1),
      'F10W · STD1 · the To do counts it as a supplier to add (the server\'s one count, /health todo), not a bill to accept');
    await p.click('[data-testid="wait-link-0-0"]');
    await p.waitForFunction(() => /To accept/.test((document.querySelector('[data-testid="wait-0"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.useCalls.length === 1 && JSON.stringify(S.useCalls[0].body) === JSON.stringify({ party: { party_no: 'P-00001' } }) && S.retries === 1,
      'F10W · the pick writes the party through PUT /use { party: { party_no } } (the server resolves it), then the books try again — ' + JSON.stringify(S.useCalls));
    ok(/To accept/.test(await p.textContent('[data-testid="wait-0"]')) && await p.locator('[data-testid^="wait-addsup-"]').count() === 0, 'F10W · …and the bill moved to "To accept" — no second supplier was added');
    await ctx.close();
  }
  {
    const S = standIn();
    S.waiting = [{ id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'add_supplier', name: 'Sri Ganesh', reason: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-102 waits for you to accept it.', tries: 0, since: TODAY + 'T04:10:00Z',
      candidates: [{ name: 'Sri Ganesh Provisions', party_no: 'P-00001' }] }];
    S.onRetry = () => { S.waiting = [{ id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-102 from Sri Ganesh Provisions)', tries: 1, since: TODAY + 'T04:10:00Z' }]; };
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-0"]', { timeout: 8000 });
    await p.evaluate(() => openChitSheet('rc2')); await waitSheet(p, 'SG-102');
    ok(/Is this Sri Ganesh Provisions \(P-00001\)\?/.test(await p.textContent('[data-testid="cs-pick"]')) && await p.locator('[data-testid="cs-act-supplier"]').count() === 1, 'F10W · the popup shows the same near match, with Add supplier beside it');
    await p.click('[data-testid="cs-link-0"]');
    await p.waitForFunction(() => !document.querySelector('[data-testid="cs-pick"]') && /Sri Ganesh Provisions/.test((document.querySelector('[data-testid="cs-who"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.useCalls.length === 1 && S.useCalls[0].body.party.party_no === 'P-00001' && await p.locator('[data-testid="cs-pick"]').count() === 0 && /Sri Ganesh Provisions/.test(await p.textContent('[data-testid="cs-who"]'))
      && await p.locator('[data-testid="cs-act-accept"]:not([disabled])').count() === 1, 'F10W · picking it in the popup links the receipt; the sheet reads again: Sri Ganesh Provisions, Accept offered');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  /* ── 3g · STD1: the popup greys Accept from the SERVER's may/why on the chit read — off the Books page too (app.html: no BK, no Waiting list) ── */
  {
    const S = standIn();
    S.waiting = [{ id: 13, chit_id: 'rc1', ref: 'chit:rc1', todo: 'record', reason: 'Their bill SG-103 says ₹50, the lines counted come to ₹45 — ₹5 apart. Ask Sri Ganesh Provisions to correct it.', tries: 0, since: TODAY + 'T04:20:00Z' },
      { id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'add_supplier', name: 'Sri Ganesh', reason: 'A sentence the server reworded — nothing reads it but people.', tries: 0, since: TODAY + 'T04:10:00Z',
        candidates: [{ name: 'Sri Ganesh Provisions', party_no: 'P-00001' }] }];
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript(([shop]) => { try {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
      localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: shop })); } catch (_) {} }, [SHOP]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    ok(await p.evaluate(() => typeof BK === 'undefined' || !(BK.waiting || []).length), 'STD1 · off the Books page: no Waiting list in hand (app.html)');
    await p.evaluate(() => openChitSheet('rc1')); await waitSheet(p, 'SG-103');
    const acc = p.locator('#chitsheet [data-testid="cs-act-accept"]');
    ok(await acc.count() === 1 && await acc.isDisabled() && /₹5 apart/.test(await acc.getAttribute('title') || '') && /₹5 apart/.test(await p.textContent('[data-testid="cs-why"]')),
      'STD1 · a gap: Accept is SHOWN, greyed WITH the server\'s sentence (actions.accept may/why on the read) — not from a list the page holds');
    await p.click('[data-testid="cs-act-accept"]', { force: true }).catch(() => {});
    await p.waitForTimeout(200);
    ok(S.statusCalls.length === 0, 'STD1 · …a tap on the greyed Accept sends nothing');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.evaluate(() => openChitSheet('rc2')); await waitSheet(p, 'SG-102');
    ok(await p.locator('#chitsheet [data-testid="cs-act-accept"]').isDisabled() && await p.locator('[data-testid="cs-act-supplier"]').count() === 1
      && /^Is this Sri Ganesh Provisions \(P-00001\)\?$/.test((await p.textContent('[data-testid="cs-link-0"]')).trim()),
      'STD1 · a supplier to add — the row\'s todo and name are DATA: a reworded sentence still greys Accept, offers "Is this …?" and Add supplier');
    await p.keyboard.press('Escape'); await ctx.close();
  }
  {
    const S = standIn();
    S.waiting = [{ id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'add_supplier', name: 'Sri Ganesh', reason: 'A sentence the server reworded — nothing reads it but people.', tries: 0, since: TODAY + 'T04:10:00Z' },
      { id: 7, chit_id: 'ch1', ref: 'bill:ch1', reason: 'September is locked. Open it again to record this bill.', tries: 3, since: TODAY + 'T05:00:00Z' }];
    S.onRetry = () => { S.waiting = [{ id: 12, chit_id: 'rc2', ref: 'chit:rc2', todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-102 from Sri Ganesh)', tries: 1, since: TODAY + 'T04:10:00Z' }, S.waiting[1]]; };
    const { ctx, p } = await open(S);
    await p.evaluate(() => bkTab('waiting')); await p.waitForSelector('[data-testid="wait-addsup-0"]', { timeout: 8000 });
    await p.evaluate(() => { document.querySelector('[data-testid="waiting-list"]').__kept = true; });
    await p.evaluate(() => { window.__adds = []; const was = window.api; window.api = function (k, o) { if (k === 'supAdd') window.__adds.push(o && o.body); return was.apply(this, arguments); }; });
    await p.click('[data-testid="wait-addsup-0"]');
    await p.waitForFunction(() => /To accept/.test((document.querySelector('[data-testid="wait-0"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => JSON.stringify(window.__adds)) === JSON.stringify([{ name: 'Sri Ganesh', supply_kind: 'resale' }]), 'STD1 · Add supplier adds the row\'s `name` (data) — never a name parsed from the sentence');
    ok(/To accept/.test(await p.textContent('[data-testid="wait-0"]')) && await p.evaluate(() => document.querySelector('[data-testid="waiting-list"]').__kept === true),
      'STD1 · …and the ROW flips to "To accept" — the list is the same one (no view reload)');
    await ctx.close();
  }
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.evaluate(() => openChitSheet('ch2')); await waitSheet(p, 'C1/26-27/0003');
    const c = await p.$$eval('[data-testid="cs-gst-18"] td', (els) => els.map((e) => e.textContent.replace(/[₹,\s]/g, '')));
    ok(c.join('|') === '18%|1000.00|90.00|90.00' && (await p.textContent('[data-testid="cs-total"]')).replace(/[₹,\s]/g, '') === '1180.00', 'only summary_json.money: GST 18% row and total are the header\'s own (' + c.join(' | ') + ' · 1180.00)');
    ok(/Counter C1/.test(await p.textContent('[data-testid="cs-head"]')), 'the counter reads "Counter C1" here too');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.evaluate(() => openChitSheet('nr1')); await waitSheet(p, 'C1/26-27/0004');
    ok(/not recorded/i.test(await p.textContent('[data-testid="cs-total"]')) && /not recorded/i.test(await p.textContent('[data-testid="cs-gst-none"]')), 'neither invoice nor money: "not recorded" on the total and on the GST — nothing invented');
    await ctx.close();
  }
  /* ── 3d · CB Accounts: a Bills row opens the sheet (no new tab) and names who accepted by name, not by handle ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.click('[data-testid="acc-nav-bills"]'); await p.waitForSelector('[data-testid="bills-list"]', { timeout: 8000 });
    await p.click('[data-testid="bill-sb1"] [role="button"]');   /* who took it is the row's next level */
    await p.waitForSelector('[data-testid="bill-next-sb1"]', { timeout: 5000 }).catch(() => {});
    const sub = await p.textContent('[data-testid="bill-next-sb1"]').catch(() => '');
    ok(/Books Shop/.test(sub) && !/books-shop/.test(sub), 'Bills: who accepted is the display name ("Books Shop"), not the handle — ' + sub.replace(/\s+/g, ' ').trim());
    const pages0 = ctx.pages().length;
    await p.click('[data-testid="bill-sb1"]'); await waitSheet(p, 'AM-81');
    ok(await sheetOpen(p) && ctx.pages().length === pages0, 'a Bills row opens the chit sheet in Accounts (openChitSheet is defined there), not a new tab');
    ok(/To accept/.test(await p.textContent('[data-testid="cs-step"]')), 'the sheet says the step from the chit\'s own state_log (no bill_step yet → To accept)');
    await ctx.close();
  }
  /* ── 3e · the old Ledger door is closed: it lands on /accounts.html at the same view; the app's menu has a Bills door ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.goto(base + '/app.html#/app');
    await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    ok(await p.locator('[data-testid="nav-bills"]').count() === 0, 'P0: the app menu has no Bills door any more (Accounts › Bills is the home); the redirects below still hold');
    await p.goto(base + '/app.html#/app/ledger'); await p.waitForURL(/\/accounts\.html/, { timeout: 15000 }).catch(() => {});
    ok(/\/accounts\.html(#|$)/.test(p.url()), '#/app/ledger → /accounts.html (' + p.url().replace(base, '') + ')');
    await p.goto(base + '/app.html#/app/ledger/dues'); await p.waitForURL(/accounts\.html#dues/, { timeout: 15000 }).catch(() => {});
    ok(/\/accounts\.html#dues$/.test(p.url()), '#/app/ledger/dues → /accounts.html#dues, the same view (' + p.url().replace(base, '') + ')');
    await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    await p.evaluate(() => { localStorage.setItem(uk('cb_nav'), 'ledger'); });
    await p.reload(); await p.waitForURL(/\/accounts\.html/, { timeout: 15000 }).catch(() => {});
    ok(/\/accounts\.html/.test(p.url()), 'a remembered cb_nav of "ledger" → /accounts.html (' + p.url().replace(base, '') + ')');
    await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    ok(await p.evaluate(() => localStorage.getItem(uk('cb_nav'))) !== 'ledger', 'the remembered "ledger" was forgotten, so Back does not loop');
    await p.evaluate(() => navTo('ledger')); await p.waitForURL(/\/accounts\.html/, { timeout: 15000 }).catch(() => {});
    ok(/\/accounts\.html/.test(p.url()), 'navTo("ledger") → /accounts.html');
    await ctx.close();
  }
  /* ── 3f · THE TASK DETAIL READS THE FROZEN BILL, NEVER RECOMPUTES (Athi, 2026-10-02: "never ever recompute") ─────────────── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    const tab = async (id, t) => { await p.evaluate(([i, tt]) => { UI.dtab = tt; return openChit(i); }, [id, t]); await p.waitForFunction(() => !(UI.detail && UI.detail._loading), null, { timeout: 15000 }); await p.waitForTimeout(300); };
    const txt = (sel) => p.locator(sel).first().textContent().then((t) => t.replace(/[₹,\s]/g, ''), () => null);
    /* the frozen invoice: the detail's total, GST rows and round-off equal CBTax.moneyOf(invoice) to the paisa */
    await tab('ch1', 'content');
    ok(await txt('[data-testid="chit-total"]') === f2(EXP.total), 'Task detail › Content: the total is the frozen invoice\'s ' + f2(EXP.total) + ' (the header said 1)');
    for (const rt of Object.keys(EXP.by_rate)) { const c = await p.$$eval('[data-testid="chit-money"] [data-testid="cs-gst-' + rt + '"] td', (els) => els.map((e) => e.textContent.replace(/[₹,\s]/g, ''))); ok(c[1] === f2(EXP.by_rate[rt].taxable) && c[2] === f2(EXP.by_rate[rt].cgst), 'Task detail › Content: GST ' + rt + '% rate-wise equals the invoice'); }
    ok(EXP.round_off ? /roundoff|Round/i.test(await p.locator('[data-testid="chit-money"]').first().textContent()) : true, 'Task detail › Content: the round-off is the invoice\'s');
    await tab('ch1', 'summary');
    ok(await txt('[data-testid="chit-summary-grand"]') === f2(EXP.total) && await txt('[data-testid="chit-summary-total"]') === f2(EXP.total), 'Task detail › Summary: the tile and the block both say the frozen total');
    ok(await txt('[data-testid="chit-summary-taxtotal"]') === f2(EXP.tax) && await txt('[data-testid="chit-summary-savings"]') === f2(EXP.savings), 'Task detail › Summary: tax and savings are the invoice\'s own');
    /* a stored total that differs from the lines\' sum: the STORED one is shown */
    await tab('dt1', 'content');
    ok(await txt('[data-testid="chit-total"]') === '999.00' && !/1,?180/.test(await p.locator('[data-testid="chit-money"]').first().textContent()), 'stored total 999.00 shown, not the lines\' 1,180 (Content)');
    await tab('dt1', 'summary');
    ok(await txt('[data-testid="chit-summary-grand"]') === '999.00' && await txt('[data-testid="chit-summary-total"]') === '999.00', 'stored total 999.00 shown, not the lines\' 1,180 (Summary)');
    /* no stored figures: an error line, no number */
    for (const t of ['content', 'summary']) {
      await tab('nr1', t);
      const e = p.locator('[data-testid="chit-money-error"]');
      ok(await e.count() === 1 && /No issued figures for this bill/.test(await e.textContent()) && await p.locator('[data-testid="chit-total"], [data-testid="chit-summary-total"], [data-testid="chit-summary-grand"]').count() === 0, 'no stored figures (' + t + '): "No issued figures for this bill", and no total anywhere');
    }
    for (const t of ['content', 'summary']) {
      await tab('old1', t);
      ok(await p.locator('[data-testid="chit-money-known"]').count() === 1 && /Known error/.test(await p.locator('[data-testid="chit-money-known"]').textContent()) && await p.locator('[data-testid="chit-money-error"], [data-testid="chit-total"], [data-testid="chit-summary-total"]').count() === 0, 'an older bill with no stored figures (' + t + '): a KNOWN error, no number, not the red error');
    }
    await p.evaluate(() => { UI.folder = 'drafts'; }); await tab('nr1', 'content');
    ok(await p.locator('[data-testid="chit-money-none"]').count() === 1 && /Not issued yet/.test(await p.locator('[data-testid="chit-money-none"]').textContent()) && await p.locator('[data-testid="chit-money-error"]').count() === 0, 'a draft says "Not issued yet", not an error');
    await ctx.close();
  }
  /* ── 4 · phone width ────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn(); const { ctx, p } = await open(S, 390);
    await p.click('[data-testid="db-src-JV/2026-27/000001"]'); await waitSheet(p, 'C2/26-27/0002');
    ok(await p.evaluate(() => document.documentElement.scrollWidth) === 390, 'phone: scrollWidth === 390 with the sheet open');
    ok(await p.evaluate(() => { const d = document.getElementById('chitsheet'), r = d.getBoundingClientRect(); return d.scrollWidth <= d.clientWidth + 1 && r.left >= 0 && r.right <= 390; }), 'phone: the sheet fits the 390 screen and nothing in it runs sideways');
    await shot(p, 'chit-sheet-phone'); await shot(p, 'chit-sheet-invoice-phone');
    await ctx.close();
  }

  /* ── 13 · RCM-POST: a bill under reverse charge SAYS who pays the tax, from the frozen invoice's own code (moneyOf(inv).rcm) ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.click('[data-testid="db-src-JV/2026-27/000003"]'); await waitSheet(p, 'SRT-7');
    const sheet = await p.textContent('#chitsheet');
    ok(RCM_EXP.rcm && RCM_EXP.rcm.tax === 1800 && RCM_EXP.tax === 0 && RCM_EXP.total === 10000, 'the engine: tax 1,800 in the RCM heads, 0 charged, total 10,000 (the fixture is a real reverse-charge invoice)');
    ok(await p.locator('[data-testid="cs-rcm"]').count() === 1 && /Reverse charge — you pay the tax/.test(sheet), 'the buyer\'s sheet says "Reverse charge — you pay the tax"');
    ok((await p.textContent('[data-testid="cs-rcm-tax"]')).replace(/[₹,\s]/g, '') === f2(RCM_EXP.rcm.tax), 'the figure beside it is moneyOf(invoice).rcm.tax — ' + f2(RCM_EXP.rcm.tax));
    ok(await p.getAttribute('[data-testid="cs-rcm"]', 'data-side') === 'buyer', 'the side is the buyer\'s (a bill received)');
    ok((await p.textContent('[data-testid="cs-total"]')).replace(/[₹,\s]/g, '') === f2(RCM_EXP.total), 'the total stays the supplier\'s bill (10,000 — no tax added by the screen)');
    await shot(p, 'chit-sheet-rcm');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    /* a bill with NO reverse charge carries no such row — the code is absent, so is the sentence */
    await p.click('[data-testid="db-src-JV/2026-27/000002"]'); await waitSheet(p, 'AM-81');
    ok(await p.locator('[data-testid="cs-rcm"]').count() === 0, 'a plain supplier bill has no reverse-charge row');
    await ctx.close();
  }

  ok(...C.finish());
  ok(threw.length === 0, 'no page errors' + (threw.length ? ': ' + threw[0] : ''));
  await b.close(); srv.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
