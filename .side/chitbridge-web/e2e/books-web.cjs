/* books-web.cjs — THE LEDGER, DRIVEN THROUGH ITS CONTROLS (SPEC-books-v2 §4). A stand-in API answers every /api/** call
 * inside the page; nothing reaches a server, live or local.
 *
 *  1  the door is hidden when the shop's Ledger is off (/api/books/health → 404), shown when on
 *  2  a customer row carries party no · balance · the chip; the record shows the statement (opening … closing)
 *  3  a credit sale posted by the counter appears on the statement
 *  4  editing a party: nickname + tax id; a tax id another party holds is WARNED before save; the server's 409 shows
 *  5  receive a payment: the oldest-due proposal, changed, confirmed; the disputed bill cannot take anything
 *  6  trial balance balances; month lock → a payment in that month is refused; opening again needs a reason
 *  7  a pack is built, downloads with its manifest, and is acknowledged
 *  8  opening balances: a bad line refused before sending; shop ledger added under a group
 *  9  the supplier record carries the block too (Pay)
 *  ⚠️ the word "accounting" never appears on any screen it opens
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.BOOKS_ROOT || path.join(__dirname, '..', 'public');   /* books-web-breaks.cjs points this at a COPY */
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

/* ── the stand-in: a shop's parties, open bills, and the books routes of §5 ── */
function standIn() {
  const S = {
    enabled: true, confirms: [], payments: {}, locked: {}, packs: [], opening: null, accounts: [
      { code: '1300', name: 'Debtors', is_group: false }, { code: '1400', name: 'Cash', is_group: false },
      { code: '6000', name: 'Expenses', is_group: true }, { code: '6010', name: 'Rent', is_group: false }],
    customers: [
      { customer_list_id: 'cl1', customer_identity_id: 'c1', display_name: 'Ravi Stores', otp_contact: '9800000001', txn_count: 3, party_no: 'P-00001', user_id: 'ravi.stores', nickname: 'Ravi', tax_ids: [{ scheme: 'GSTIN', value: '33AAAAA0000A1Z5' }], credit_days: 30 },
      { customer_list_id: 'cl2', customer_identity_id: 'c2', display_name: 'Meena Traders', otp_contact: '9800000002', txn_count: 1, party_no: 'P-00002', tax_ids: [] }],
    suppliers: [{ supplier_list_id: 'sl1', supplier_entity_id: 's1', display_name: 'Agro Mills', on_rail: false, party_no: 'P-00003', tax_ids: [], one_sided: { why: 'Agro Mills is not on the network, so their bills reach you only when you enter them' } }],
    items: {   /* open bills per party, minor units */
      c1: [{ against_ref: 'b1', bill_no: 'INV-1', due_date: '2026-08-01', open_minor: 300000, date: '2026-07-02', chit: 'ch1' },
           { against_ref: 'b2', bill_no: 'INV-2', due_date: '2026-09-01', open_minor: 200000, date: '2026-08-02', chit: 'ch2' },
           { against_ref: 'b9', bill_no: 'INV-9', due_date: '2026-07-15', open_minor: 100000, date: '2026-06-15', chit: 'ch9', disputed: true }],
      c2: [], s1: [{ against_ref: 'p1', bill_no: 'AM-77', due_date: '2026-09-10', open_minor: -250000, date: '2026-08-10', chit: 'pc1' }] },
    receipts: { c1: [], c2: [], s1: [] },
    /* ── the 2026-09-30 fix pass (review M10–M12, F11): what the stand-in now keeps, as the server does ── */
    payPosts: [], byRef: {}, openingPosts: [], openingByRef: {}, chequeSteps: [], retries: 0, fileGets: 0, acks: [],
    /* /health names what could not be recorded, each with its reason sentence (routes/books.js GET /health).
       The three "Waiting for you to confirm …" rows are received supplier bills — the Day book's to-do counts them
       as "supplier bills to accept" (they wait on a person, so retry keeps them: stuck) and the other two as
       "waiting to be recorded". */
    waiting: [{ id: 1, chit_id: 'ch7', ref: 'bill:ch7', why: 'Paid by Points — there is no ledger for Points yet.', tries: 3, since: '2026-09-28T10:00:00Z' },
              { id: 2, chit_id: 'ch8', ref: 'chit:ch8', why: 'September is locked. Open it again to record this bill.', tries: 1, since: '2026-09-29T09:00:00Z', stuck: true },
              { id: 3, chit_id: 'sb1', ref: 'bill:sb1', todo: 'accept', why: 'Waiting for you to confirm Agro Mills’ bill AM-81.', tries: 0, since: '2026-09-30T08:00:00Z', stuck: true },
              { id: 4, chit_id: 'sb2', ref: 'bill:sb2', todo: 'accept', why: 'Waiting for you to confirm Agro Mills’ bill AM-82.', tries: 0, since: '2026-09-30T09:00:00Z', stuck: true },
              { id: 5, chit_id: 'sb3', ref: 'bill:sb3', todo: 'accept', why: 'Waiting for you to confirm a counter bill from Meena Traders.', tries: 0, since: '2026-09-30T10:00:00Z', stuck: true }],
    /* a cheque the server itself lists as held (recorded at the counter, or in an earlier session) — and one already
       cleared (`next` empty), which the to-do must NOT count */
    chequeLists: 0, serverCheques: [{ payment_id: 'chq9', party_id: 'c2', name: 'Meena Traders', amount_minor: 50000, cheque_no: '778899', cheque_bank: 'SBI', status: 'cheque_received' },
      { payment_id: 'chq8', party_id: 'c1', name: 'Ravi Stores', amount_minor: 10000, cheque_no: '112233', cheque_bank: 'SBI', status: 'cleared', next: [] }],
  };
  S.balance = (id) => S.items[id].reduce((a, x) => a + x.open_minor, 0);
  S.statement = (id) => {
    let run = 0; const lines = [];
    const ev = S.items[id].map((x) => ({ date: x.date, what: x.open_minor > 0 ? 'Sale on credit' : 'Purchase', ref: x.bill_no, source_chit_id: x.chit, amt: x.orig || x.open_minor }))
      .concat(S.receipts[id].map((r) => ({ date: r.date, what: 'Payment received', ref: r.ref, amt: -r.amount })))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    ev.forEach((e) => { run += e.amt; lines.push({ date: e.date, what: e.what, ref: e.ref, source_chit_id: e.source_chit_id || null, dr_minor: e.amt > 0 ? e.amt : 0, cr_minor: e.amt < 0 ? -e.amt : 0, running_minor: run }); });
    return { party: { party_id: id }, currency: 'INR', opening_minor: 0, lines, closing_minor: run };
  };
  S.dues = () => ({ currency: 'INR', as_of: '2026-09-29', parties: Object.keys(S.items).map((id) => {
    const open = S.items[id].filter((x) => !x.disputed && x.open_minor);
    const who = S.customers.find((c) => c.customer_identity_id === id) || S.suppliers.find((s) => s.supplier_entity_id === id);
    /* ⚠️ as routes/books.js sends it: a supplier's buckets are the PAYABLE ones (not_due · lt_1y · y1_2 · y2_3 · gt_3y),
       signed minus (you owe them); a customer's are the six receivable ones. `side` says which. */
    const sup = !!who.supplier_entity_id, sum = open.reduce((a, x) => a + x.open_minor, 0);
    return { party_id: id, party_no: who.party_no, name: who.display_name, side: sup ? 'supplier' : 'customer', balance_minor: S.balance(id),
      oldest_due: open.map((x) => x.due_date).sort()[0] || null, disputed_minor: S.items[id].filter((x) => x.disputed).reduce((a, x) => a + x.open_minor, 0),
      buckets: sup ? { not_due: 0, lt_1y: sum } : { not_due: 0, lt_6m: sum }, /* the pack's months buckets stay on the wire; no screen reads them */
      follow_up: { not_due: 0, d0_30: 0, d31_60: Math.abs(sum), d61_90: 0, d90_plus: 0, worst: sum ? 'd31_60' : null, no_terms_minor: 0, terms: 'ok' } };
  }) });
  return S;
}
/* BOOKS_SHOTS=<dir> keeps a picture of each screen to LOOK at (not a golden file; nothing compares them) */
const FYNOW = (() => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); })();
const shot = async (p, name) => { if (process.env.BOOKS_SHOTS) await p.screenshot({ path: path.join(process.env.BOOKS_SHOTS, name + '.png') }).catch(() => {}); };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
/* the bytes of "the pack" — what Download must bring down (a zip's first four bytes, then a marker) */
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('stand-in ledger pack', 'utf8')]);
/* "today" the way the page computes it: bkToday reads the browser's LOCAL date, and the walk's browser runs in Asia/Kolkata (newContext below) —
   not the UTC date, which is a day behind from 18:30 to midnight UTC and left the strip with no entries for "today" (the strip reads the range's last day) */
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
  if (p.startsWith('/api/books')) {
    /* routes/books.js: only GET /status and POST /enable (the owner's switch) answer while off */
    if (p === '/api/books/status' && m === 'GET') return J(r, 200, { migrated: true, enabled: !!S.enabled, walkin_grain: S.enabled ? 'day' : null });
    if (p === '/api/books/enable' && m === 'POST') { S.enables = (S.enables || 0) + 1; S.enabled = true; return J(r, 200, books.enable({ parties_numbered: 3 })); }
    if (!S.enabled) return J(r, 404, { error: 'Not found' });
    let x;
    if (p === '/api/books/health') return J(r, 200, books.health({ last_check: { ok: true }, waiting: S.waiting.map((w) => books.waitingRow({ id: w.id, chit_id: w.chit_id, ref: w.ref, reason: w.why, tries: w.tries, since: w.since, todo: w.todo || 'record', name: w.name || null })) }));   /* routes/books.js GET /health: the sentence is `reason`; cheques are NOT here */
    if (p === '/api/books/cheques' && m === 'GET') { S.chequeLists++; /* 2026-10-02: a cheque recorded in the APP is held on the server too, and CB Accounts (a fresh page, no session memory) lists it from there */
    const held = Object.keys(S.payments).filter((k) => S.payments[k].mode === 'cheque' && !S.chequeSteps.some((x) => x.id === k && x.body.status === 'cleared')).map((k) => ({ payment_id: k, party_id: S.payments[k].party_id, name: 'Ravi Stores', amount_minor: Math.round(Number(S.payments[k].amount || 0) * 100), cheque_no: S.payments[k].cheque_no, cheque_bank: S.payments[k].cheque_bank, status: S.chequeSteps.some((x) => x.id === k && x.body.status === 'deposited') ? 'cheque_deposited' : 'cheque_received', next: S.chequeSteps.some((x) => x.id === k && x.body.status === 'deposited') ? ['cleared'] : ['deposited'] }));
      return J(r, 200, books.cheques({ cheques: held.concat(S.serverCheques.map((c) => Object.assign({ next: ['deposited'] }, c))) })); }   /* the contract's keys beside them: asOf · pdc_reminders · remind */   /* GET /cheques: the held ones, each with the steps the engine accepts now */
    if (p === '/api/books/outbox/retry' && m === 'POST') { S.retries++; const n = S.waiting.length; S.waiting = S.waiting.filter((w) => w.stuck); return J(r, 200, { ok: true, tried: n, posted: n - S.waiting.length }); }
    if ((x = p.match(/^\/api\/books\/cheques\/([^/]+)\/status$/)) && m === 'POST') {
      S.chequeSteps.push({ id: x[1], body });
      if (S.refuseCheque) return J(r, 422, { error: 'A cleared cheque cannot be bounced here.' });
      return J(r, 200, { ok: true });
    }
    if (p === '/api/books/dues') { const d = S.dues(); return J(r, 200, books.dues(d.parties, { asOf: d.as_of })); }
    if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) { const st = S.statement(x[1]); return J(r, 200, books.statement(x[1], { opening_minor: st.opening_minor, closing_minor: st.closing_minor, lines: st.lines })); }
    const billsOf = (id) => S.items[id].filter((i) => i.open_minor !== 0).map((i) => Object.assign({}, i, { open_minor: Math.abs(i.open_minor) }));
    const nameOf = (id) => ((S.customers.find((c) => c.customer_identity_id === id) || {}).display_name) || ((S.suppliers.find((s) => s.supplier_entity_id === id) || {}).display_name) || 'this party';
    if (p === '/api/books/payments/preview' && m === 'POST') return J(r, 200, books.payPreview(billsOf(body.party_id), body, nameOf(body.party_id)));
    if (p === '/api/books/payments' && m === 'POST') {
      S.payPosts.push(body);                                  /* every POST that ARRIVED, a repeat included */
      if (S.slowRecord) await new Promise((res) => setTimeout(res, S.slowRecord));
      const per = (new Date(body.received_at).getMonth() + 9) % 12 + 1;
      if (S.locked[per]) return J(r, 409, Object.assign(books.refusal('That month is locked. Open it again (with a reason) to record this.', 'PERIOD_LOCKED'), { type: 'about:blank', title: 'Conflict', status: 409, detail: 'That month is locked. Open it again (with a reason) to record this.', hint: 'Open the month again, then record this.', request_id: 'req-bw-0001' }));   /* RFC 9457 problem details, as the API's one error shape */
      /* the server keeps a client_ref ONCE (the unique index): a repeat is answered with the payment it already has */
      if (body.client_ref && S.byRef[body.client_ref]) { const was = S.byRef[body.client_ref]; return J(r, 200, { ok: true, payment: { payment_id: was, status: S.payments[was].mode === 'cheque' ? 'cheque_received' : 'recorded', duplicate: true }, posted: { ok: true, duplicate: true, entry_id: 'e-' + was, entry_no: 'PY/2026-27/000001', posting_date: '2026-09-29' } }); }
      const id = 'pay' + (Object.keys(S.payments).length + 1); S.payments[id] = body;
      if (body.client_ref) S.byRef[body.client_ref] = id;
      const sign = S.items[body.party_id].some((i) => i.open_minor < 0) ? -1 : 1;
      const out = books.payRecorded(billsOf(body.party_id), body, nameOf(body.party_id), { payment_id: id, balance_minor: 0 });
      for (const a of (out.allocation && out.allocation.settled) || []) { const it = S.items[body.party_id].find((i) => i.against_ref === a.against_ref); it.orig = it.orig || it.open_minor; it.open_minor -= sign * a.amount_minor; }
      if (body.mode !== 'cheque') S.receipts[body.party_id].push({ date: '2026-09-29', ref: body.reference || id, amount: body.amount_minor });
      return J(r, 200, out);
    }
    if (p === '/api/books/trial-balance' && S.tbOff) return J(r, 200, books.trialBalance([{ code: '1300', name: 'Debtors', dr_minor: 600000, cr_minor: 0 }], { total_dr_minor: 600000, total_cr_minor: 599999, balanced: false }));
    if (p === '/api/books/trial-balance') return J(r, 200, books.trialBalance([{ code: '1300', name: 'Debtors', dr_minor: 600000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 508475 }, { code: '2201', name: 'Output GST', dr_minor: 0, cr_minor: 91525 }]));
    /* ⭐ each entry carries `source` (routes/books.js sourceOf, 2026-10-01): a bill names its number, counter and seller; a
       walk-in day its count; an entry with no chit has source null */
    if (p === '/api/books/daybook') return J(r, 200, books.daybook([
      { entry_id: 'e1', entry_no: 'JV/2026-27/000001', posting_date: '2026-07-02', doc_date: '2026-07-02', event_type: 'sale_bill', source_chit_id: 'ch1', narration: 'Sale',
        source: { chit_id: 'ch1', ref: 'C2/26-27/0002', kind: 'bill', counter: 'C2', by: 'Athi', count: null, how: 'On credit', how_ref: null, split: null,
          doc_at: '2026-07-02T08:42:00.000Z', recorded_at: '2026-07-02T08:42:05.000Z' },
        lines: [{ code: '1300', name: 'Debtors', party_name: 'Ravi Stores', dr_minor: 300000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 254238 },
          { code: '2201', name: 'Output CGST 9%', dr_minor: 0, cr_minor: 22881 }, { code: '2202', name: 'Output SGST 9%', dr_minor: 0, cr_minor: 22881 }] },
      { entry_id: 'e2', entry_no: 'JV/2026-27/000002', posting_date: '2026-07-02', event_type: 'walkin_day', source_chit_id: null, narration: 'Walk-in sales, counter C2, 2026-07-02 (12 bills)',
        source: { chit_id: null, ref: null, kind: 'day', counter: 'C2', by: null, count: 12, how: 'Cash · UPI · Card', how_ref: null,
          split: [{ how: 'Cash', amount_minor: 124000 }, { how: 'UPI', amount_minor: 86000 }, { how: 'Card', amount_minor: 30000 }] },
        lines: [{ code: '1400', name: 'Cash', dr_minor: 141600, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 141600 }] },
      { entry_id: 'e3', entry_no: 'JV/2026-27/000003', posting_date: '2026-07-03', event_type: 'payment_received', source_chit_id: null, narration: 'Payment received', source: null,
        lines: [{ code: '1400', name: 'Cash', dr_minor: 50000, cr_minor: 0 }, { code: '1300', name: 'Debtors', party_name: 'Ravi Stores', dr_minor: 0, cr_minor: 50000 }] },
      /* a LATE one: received on 3 Jul, taken into the ledger on 1 Oct — the row says both */
      { entry_id: 'e4', entry_no: 'JV/2026-27/000004', posting_date: '2026-07-03', doc_date: '2026-07-03', event_type: 'payment_received', source_chit_id: 'ch4', narration: 'Payment received',
        source: { chit_id: 'ch4', ref: 'R/C2/0001', kind: 'receipt', counter: 'C2', by: 'Athi', count: null, how: 'UPI', how_ref: '4421000000009931', split: null,
          doc_at: '2026-07-03T06:00:00.000Z', recorded_at: '2026-10-01T05:00:00.000Z' },
        lines: [{ code: '1510', name: 'UPI collections', dr_minor: 20000, cr_minor: 0 }, { code: '1300', name: 'Debtors', party_name: 'Ravi Stores', dr_minor: 0, cr_minor: 20000 }] }].concat(S.noToday ? [] : [
      /* ⭐ TODAY's sales, for the strip: a closed walk-in day and a credit bill on C1, a UPI bill on C2.
         C1 = 1,240 + 860 + 300 (the day's split) + 1,880 (the bill) = ₹4,280.00 · 11 + 1 = 12 bills; C2 = ₹6,909.00 · 1 bill.
         Tenders: Cash 1,240 · UPI 860 + 6,909 = 7,769 · Card 300 · On credit 1,880. */
      { entry_id: 'e5', entry_no: 'JV/2026-27/000005', posting_date: TODAY, event_type: 'walkin_day', source_chit_id: null, narration: 'Walk-in sales, counter C1, ' + TODAY + ' (11 bills)',
        source: { chit_id: null, ref: null, kind: 'day', counter: 'C1', by: null, count: 11, how: 'Cash · UPI · Card', how_ref: null,
          split: [{ how: 'Cash', amount_minor: 124000 }, { how: 'UPI', amount_minor: 86000 }, { how: 'Card', amount_minor: 30000 }] },
        lines: [{ code: '1400', name: 'Cash', dr_minor: 240000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 240000 }] },
      { entry_id: 'e6', entry_no: 'JV/2026-27/000006', posting_date: TODAY, doc_date: TODAY, event_type: 'sale_bill', source_chit_id: 'ch6', narration: 'Sale',
        source: { chit_id: 'ch6', ref: 'C1/26-27/0031', kind: 'bill', counter: 'C1', by: 'Mani', count: null, how: 'On credit', how_ref: null, split: null,
          doc_at: TODAY + 'T05:10:00.000Z', recorded_at: TODAY + 'T05:10:04.000Z' },
        lines: [{ code: '1300', name: 'Debtors', party_name: 'Ravi Stores', dr_minor: 188000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 188000 }] },
      { entry_id: 'e7', entry_no: 'JV/2026-27/000007', posting_date: TODAY, doc_date: TODAY, event_type: 'sale_bill', source_chit_id: 'ch71', narration: 'Sale',
        source: { chit_id: 'ch71', ref: 'C2/26-27/0045', kind: 'bill', counter: 'C2', by: 'Athi', count: null, how: 'UPI', how_ref: '9988776655443322', split: null,
          doc_at: TODAY + 'T06:20:00.000Z', recorded_at: TODAY + 'T06:20:03.000Z' },
        lines: [{ code: '1510', name: 'UPI collections', dr_minor: 690900, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 690900 }] }]).map(books.entry)));
    if (p === '/api/books/ledger/1300') return J(r, 200, books.ledger('1300', 'Debtors', [
      { date: '2026-07-02', doc_date: '2026-07-02', what: 'Sale', ref: 'JV/2026-27/000001', source_chit_id: 'ch1', source: { chit_id: 'ch1', ref: 'C2/26-27/0002', kind: 'bill', counter: 'C2', by: 'Athi', count: null, how: 'On credit', how_ref: null, split: null,
        doc_at: '2026-07-02T08:42:00.000Z', recorded_at: '2026-10-01T05:00:00.000Z' }, dr_minor: 300000, cr_minor: 0, running_minor: 300000 },
      { date: '2026-07-03', what: 'Payment received', ref: 'JV/2026-27/000003', source_chit_id: null, source: null, dr_minor: 0, cr_minor: 50000, running_minor: 250000 }], { closing_minor: 250000 }));
    if (p === '/api/books/pl') return J(r, 200, books.pl([{ code: '4000', name: 'Sales', amount_minor: 508475 }], [{ code: '6010', name: 'Rent', amount_minor: 100000 }], { profit_minor: 408475 }));
    if (p === '/api/books/bs') return J(r, 200, books.bs([{ code: '1300', name: 'Debtors', amount_minor: 600000 }], [{ code: '2201', name: 'Output GST', amount_minor: 91525 }], [{ code: '3900', name: 'Profit', amount_minor: 508475 }], { total_assets_minor: 600000, total_liab_equity_minor: 600000, balanced: true }));
    if (p === '/api/books/accounts' && m === 'GET') return J(r, 200, { accounts: S.accounts.map((a) => books.accountRow(Object.assign({ account_id: 'acc-' + a.code }, a))) });
    if (p === '/api/books/accounts' && m === 'POST') { const a = { code: '6011', name: body.name, parent_code: body.parent_code, is_group: false }; S.accounts.push(a); S.addedAccount = body; return J(r, 200, { account: a }); }
    if ((x = p.match(/^\/api\/books\/ledger\/([^/]+)$/))) return J(r, 200, { account: x[1], currency: 'INR', opening_minor: 0, lines: [], closing_minor: 0 });
    if (p === '/api/books/periods' && m === 'GET') return J(r, 200, books.periods([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => {
      const row = books.periodRow(FYNOW, n, S.hard && S.hard[n] ? 'hard_locked' : S.locked[n] ? 'soft_locked' : 'open');
      /* M157: the server says which month may open again (a soft-locked one, with a reason); the Reason box is drawn only while one may — a closed-for-good month never */
      if (row.status === 'soft_locked') row.reopen = { may: true, why: null };
      return row;
    })));
    if ((x = p.match(/^\/api\/books\/periods\/([^/]+)\/(\d+)\/(lock|unlock)$/))) {
      if (x[3] === 'unlock' && !String(body.reason || '').trim()) return J(r, 422, { error: 'A reason is needed' });
      S.locked[+x[2]] = x[3] === 'lock'; S.hard = S.hard || {}; S.hard[+x[2]] = x[3] === 'lock' && !!body.hard; S.lastLock = { fy: x[1], p: +x[2], what: x[3], body };
      return J(r, 200, books.lockAnswer(x[1], +x[2], x[3] === 'lock' ? (body.hard ? 'hard_locked' : 'soft_locked') : 'open'));
    }
    /* ⚠️ a pack row says whether it HAS a file (has_file); `hide` = an older list that does not say, so GET /packs/:id is asked */
    if (p === '/api/books/packs' && m === 'GET') return J(r, 200, { packs: S.packs.map((k) => { const o = Object.assign({}, k); delete o.hide; if (k.hide) delete o.has_file; return o; }) });
    if (p === '/api/books/packs' && m === 'POST') { const k = { pack_id: 'pk' + (S.packs.length + 1), kind: body.kind, fiscal_year: body.fiscal_year, period: body.period, created_at: '2026-09-29', sha256: 'ab12cd34ef56ab12cd34ef56', has_file: !S.nextPackNoFile, hide: !!S.nextPackHide }; S.packs.push(k); return J(r, 200, { pack: k }); }
    if ((x = p.match(/^\/api\/books\/packs\/([^/]+)\/ack$/))) { const k = S.packs.find((z) => z.pack_id === x[1]); S.acks.push(x[1]); k.acknowledged_at = '2026-09-29'; return J(r, 200, { pack: k }); }
    /* the pack ITSELF: the zip, as bytes — 409 when it was made while storage was not connected (routes/books.js) */
    if ((x = p.match(/^\/api\/books\/packs\/([^/]+)\/file$/))) {
      const k = S.packs.find((z) => z.pack_id === x[1]); S.fileGets++;
      if (!k || !k.has_file) return J(r, 409, { error: 'This pack was built while storage was not connected — build it again to download it.' });
      return r.fulfill({ status: 200, contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="ledger-pack-' + k.kind + '-' + k.fiscal_year + '-' + k.period + '.zip"', 'access-control-expose-headers': 'Content-Disposition' }, body: ZIP });
    }
    if ((x = p.match(/^\/api\/books\/packs\/([^/]+)$/))) { const k = S.packs.find((z) => z.pack_id === x[1]); return J(r, 200, { pack: k, has_file: !!k.has_file, file: k.has_file ? '/api/books/packs/' + k.pack_id + '/file' : null, manifest: { files: [{ name: 'gl.json', sha256: 'aa11bb22cc33dd44', bytes: 1200 }, { name: 'tally.xml', sha256: 'ee55ff66', bytes: 900 }, { name: 'trial-balance.csv', sha256: '0099', bytes: 300 }], controls: { dr: 600000, cr: 600000 } } }); }
    if (p === '/api/books/opening') {
      S.openingPosts.push(body);
      if (S.failOpeningOnce) { S.failOpeningOnce = false; return J(r, 500, { error: 'Try again in a moment.' }); }
      if (body.client_ref && S.openingByRef[body.client_ref]) return J(r, 200, { entry_no: S.openingByRef[body.client_ref], suspense_minor: 0, duplicate: true });
      S.opening = body; const no = 'JV/2026-27/00000' + (1 + S.openingPosts.length);
      if (body.client_ref) S.openingByRef[body.client_ref] = no;
      return J(r, 200, { entry_no: no, suspense_minor: 0 });
    }
    return J(r, 404, { error: 'no stand-in for ' + p });
  }
  if (p === '/api/relationships/customers' && m === 'GET') return J(r, 200, { customers: S.customers });
  /* a customer added by NAME (API: POST /customers { name, phone }) — answers as the server does: minted, off-rail, one-sided */
  if (p === '/api/relationships/customers' && m === 'POST') {
    S.lastCustAdd = body;
    if (body.name) {
      const row = { customer_list_id: 'clN', customer_identity_id: 'cN', display_name: body.name, otp_contact: body.phone || null, txn_count: 0, party_no: 'P-00009', user_id: '~shop.cus-0001', on_rail: false, tax_ids: [], one_sided: { why: 'not on the network — bills stay with you' } };
      S.customers.push(row); S.items.cN = []; S.receipts.cN = [];
      return J(r, 200, { message: 'Customer added — not on the network — bills stay with you', customer: row });
    }
    return J(r, 404, { error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
  }
  if (p === '/api/relationships/suppliers' && m === 'GET') return J(r, 200, S.suppliers);
  let x;
  if ((x = p.match(/^\/api\/relationships\/(customers|suppliers)\/([^/]+)$/)) && m === 'PATCH') {
    S.lastPatch = { kind: x[1], id: x[2], body };
    const dup = (body.tax_ids || []).some((t) => S.customers.concat(S.suppliers).some((c) => (c.customer_list_id || c.supplier_list_id) !== x[2] && (c.tax_ids || []).some((u) => u.scheme === t.scheme && u.value === t.value)));
    if (dup && !body.confirm_duplicate) return J(r, 409, { code: 'DUPLICATE_PARTY', error: 'Another party already has this tax id.' });
    return J(r, 200, { ok: true });
  }
  /* the two system folders the Bills view reads (GET /api/folders → _foldersFrom → UI.sysFolders; each folder's chits): without them Bills says "No bills folders" and has no Received tab */
  if (p === '/api/folders' && m === 'GET') return J(r, 200, { folders: [
    { folder_id: 'f-b2100', parent_id: null, name: 'Bills · Received', code: 'B-2100', kind: 'view', system: true, scope: null, side: 'received', count: 0, total: 0 },
    { folder_id: 'f-b1300', parent_id: null, name: 'Bills · Issued', code: 'B-1300', kind: 'view', system: true, scope: null, side: 'issued', count: 0, total: 0 }] });
  if (/^\/api\/folders\/[^/]+\/chits$/.test(p) && m === 'GET') return J(r, 200, { chits: [] });
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

/* required by e2e/cblist-shots.cjs: the stand-in is shared, never copied (run directly, nothing changes) */
if (require.main !== module) { module.exports = { standIn, route }; return; }

(async () => {
  const srv = http.createServer((q, r) => { const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  /* ⭐ 2026-10-02 (web-reads-invoice): the app's own Ledger door is closed (navTo('ledger') → /accounts.html). The Ledger views are driven where they live:
     CB Accounts, signed in by the same session the stand-in gave the app. */
  const ledgerGo = async (pg) => { await pg.goto(base + '/accounts.html#daybook'); await pg.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 20000 }); await pg.waitForSelector('[data-testid="bk-body"]', { timeout: 20000 }); };
  const b = await chromium.launch();
  const threw = [];
  async function open(S, width) {
    const ctx = await b.newContext({ viewport: { width: width || 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', acceptDownloads: true, serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript(() => { try {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
      localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: 'Books Shop' })); } catch (_) {} });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/app.html#/app');
    await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    return { ctx, p };
  }
  const noAccounting = async (p, where) => { const t = await p.evaluate(() => document.body.innerText); ok(!/accounting|books of account/i.test(t), where + ': the word "accounting" is nowhere on screen'); };

  /* 1 · OFF: no door, no party block */
  {
    const S = standIn(); S.enabled = false;
    const { ctx, p } = await open(S);
    await p.waitForTimeout(1200);
    ok(await p.locator('[data-testid="nav-ledger"]').count() === 0, 'off: the Ledger door is not on the menu');
    await p.evaluate(() => navTo('customers'));
    await p.waitForSelector('[data-testid="cust-row-c1"]', { timeout: 15000 });
    await p.waitForTimeout(600);
    ok(await p.locator('[data-testid^="party-books-"]').count() === 0 && await p.locator('[data-testid^="party-due-"]').count() === 0, 'off: no party block and no due chip on Customers');
    /* the switch (Athi, 2026-10-01): Settings › Your business › Ledger — owner only, read from /status, one confirm */
    await p.evaluate(() => navTo('settings')); await p.waitForSelector('[data-testid="set-sec-business"]', { timeout: 15000 }); await p.click('[data-testid="set-sec-business"]');
    await p.waitForSelector('[data-testid="biz-ledger-on"]', { timeout: 10000 }).catch(() => {});
    ok(/Off/.test(await p.textContent('[data-testid="biz-ledger-state"]').catch(() => '')) && await p.locator('[data-testid="biz-ledger-on"]').count() === 1, 'Settings › Your business: the Ledger card says Off and offers Switch on');
    await p.click('[data-testid="biz-ledger-on"]');
    await p.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 4000 }).catch(() => {});
    await p.click('[data-testid="confirm-cancel"]', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300);
    ok(!S.enables && !S.enabled, 'Switch on asks first — Cancel sends nothing');
    await p.click('[data-testid="biz-ledger-on"]');
    await p.waitForSelector('[data-testid="confirm-ok"]', { timeout: 4000 }).catch(() => {});
    await p.click('[data-testid="confirm-ok"]', { timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(800);
    ok(S.enables === 1 && await p.locator('[data-testid="nav-ledger"]').count() === 0, 'confirmed → POST /api/books/enable once; the workshop menu carries no Ledger door (P0: Accounts has its own page)');
    await p.evaluate(() => navTo('settings')); await p.waitForSelector('[data-testid="set-sec-business"]', { timeout: 15000 }); await p.click('[data-testid="set-sec-business"]');
    await p.waitForFunction(() => /On/.test((document.querySelector('[data-testid="biz-ledger-state"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/On/.test(await p.textContent('[data-testid="biz-ledger-state"]').catch(() => '')) && await p.locator('[data-testid="biz-ledger-off"]').count() === 1, 'the card now says On (per day) and offers Switch off');
    /* ⚠️ the switch is the OWNER's. The break 'switch shown to an actor' (books-web-breaks.cjs) flips the role
       gate in businessSettingsHTML and, until 2026-10-01, NOTHING here looked — the harness only ever opens as
       the entity, so the broken gate sailed through green. This asks the painter itself, as an actor. */
    const actorCard = await p.evaluate(() => {
      var was = SESSION.role; SESSION.role = 'actor';
      var html = ''; try { html = businessSettingsHTML({}); } catch (e) { html = 'threw: ' + e.message; }
      SESSION.role = was;
      return /biz-ledger/.test(html) ? 'offered' : (/^threw/.test(html) ? html : 'not offered');
    });
    ok(actorCard === 'not offered', 'an actor is never offered the Ledger switch (' + actorCard + ')');
    await shot(p, '0-ledger-switch');
    await ctx.close();
  }

  const S = standIn();
  const { ctx, p } = await open(S);
  await p.waitForSelector('[data-testid="nav-task"]', { timeout: 15000 });
  ok(true, 'on: the menu loads once /api/books/health answers');

  let crmNo = '';
  /* 2 · customers: chip + party block + statement */
  await p.evaluate(() => navTo('customers'));
  await p.waitForSelector('[data-testid="party-due-c1"]', { timeout: 15000 });
  const chip = await p.textContent('[data-testid="party-due-c1"]');
  ok(/P-00001/.test(await p.textContent('[data-testid="party-no-c1"]')) && /6,000/.test(chip), 'the Customers table: the Party no column (P-00001) and the Balance column (' + chip.trim() + ')');
  const chipTitle = await p.getAttribute('[data-testid="party-due-c1"]', 'title');
  ok(/owe you/.test(chipTitle) && /oldest due/.test(chipTitle), 'row chip says who owes whom and the oldest due (' + chipTitle + ')');
  /* ⭐ THE CRM IS THE TASK TABLE (docs/design/one-table item 9): Party no · Name · ChitBridge ID · Balance · Oldest due · Credit terms · GSTIN */
  /* CBList puts its open/close caret (▸) in the FIRST cell, so the cell reads '▸P-00001': the party no is the P-nnnnn in it */
  crmNo = ((((await p.textContent('[data-testid="party-no-c1"]')) || '').match(/P-[0-9]+/) || [''])[0]).trim();
  ok(await p.locator('#tbl_customers .lhead').count() === 1 && await p.locator('[data-testid="cust-row-c1"].lrow').count() === 1 && await p.locator('.row[data-testid^="cust-row-"]').count() === 0, 'the Customers list is the Task table (.lhead / .lrow) — no row of its own');
  await p.evaluate(() => { UI[lwKey()] = 1100; document.getElementById('panel').style.setProperty('--lw', '1100px'); paintCustList(); });
  await p.waitForSelector('#tbl_customers .lhcell:nth-child(7)', { timeout: 5000 }).catch(() => {});
  /* ⭐ THE COLUMN CHOOSER (Athi, 2026-10-02, "Maximum three columns"): the list KEEPS every column, SHOWS its top three, and ⚙ columns shows / hides / orders the rest */
  const crmHeads0 = await p.$$eval('#tbl_customers .lhead .lhcell', (els) => els.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()));
  ok(JSON.stringify(crmHeads0) === JSON.stringify(['Party no', 'Name', 'Balance']), 'the CRM opens with its top three columns by priority: ' + crmHeads0.join(' · '));
  await p.screenshot({ path: path.join(__dirname, 'shots', 'one-table-crm-laptop.png') });
  await p.click('[data-testid="cols-btn-customers"]');
  ok(await p.locator('[data-testid="cols-menu-customers"] input[type=checkbox]').count() === 7 && await p.locator('[data-testid="cols-customers-name"]').isDisabled() && await p.locator('[data-testid="cols-customers-name"]').isChecked(), 'the chooser lists ALL seven columns; the top-priority one (Name) is ticked and cannot be unticked');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'one-table-crm-columns-open.png') });
  await p.click('[data-testid="cols-customers-gstin"]');
  ok(await p.locator('#tbl_customers .lhead .lhcell').count() === 4 && /Tax number/.test(await p.textContent('#tbl_customers .lhead')), 'ticking the tax-id column shows it at once (a 4th column; CX0: the pack\'s word, "Tax number" with no country pack loaded)');
  ok(/cblist\.customers/.test(await p.evaluate(() => Object.keys(localStorage).join())) && JSON.parse(await p.evaluate(() => localStorage.getItem('cblist.customers'))).cols.indexOf('gstin') >= 0, 'the choice is remembered for this list (cblist.customers)');
  await p.click('[data-testid="cols-customers-gstin"]');
  for (const k of ['cbid', 'oldest', 'credit', 'gstin']) await p.click('[data-testid="cols-customers-' + k + '"]');
  await p.click('[data-testid="cols-btn-customers"]');
  /* the rest of this section reads every column, so they are all ticked now */
  const crmHeads = await p.$$eval('#tbl_customers .lhead .lhcell', (els) => els.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()));
  ok(JSON.stringify(crmHeads) === JSON.stringify(['Party no', 'Name', 'Balance', 'Network ID', 'Oldest due', 'Credit terms', 'Tax number']), 'the CRM table\'s columns: ' + crmHeads.join(' · '));
  const crmRow = async (id) => (await p.$$eval('[data-testid="cust-row-' + id + '"] .lcell', (els) => els.map((x) => x.textContent.replace(/\s+/g, ' ').trim())));
  const r1 = await crmRow('c1'), r2 = await crmRow('c2');
  for (const r of [r1, r2]) r[0] = r[0].replace(/^▸\s*/, '');   /* the unit draws the row's caret in its first cell */
  ok(r1[0] === 'P-00001' && r2[0] === 'P-00002' && r1[3] === 'ravi.stores' && /off-rail/.test(r2[3]), 'every row shows its party no and its Network ID (user id, or "off-rail" for a local party): ' + r1.slice(0, 3).join(' | ') + ' // ' + r2.slice(0, 3).join(' | '));
  ok(/6,000/.test(r1[2]) && /Aug/.test(r1[4]) && /30 days/.test(r1[5]) && r1[6] === '33AAAAA0000A1Z5', 'Balance · Oldest due · Credit terms · GSTIN come from the row\'s own fields: ' + r1.slice(2).join(' | '));
  /* GRID or LINES: the same columns, drawn two ways (the toggle sits beside ⚙ columns) */
  await p.click('[data-testid="view-lines-customers"]');
  ok(await p.locator('#tbl_customers.tbllines').count() === 1 && await p.locator('#tbl_customers .lhead').count() === 0 && await p.locator('[data-testid="cust-row-c1"] .lcell').count() >= 5, 'CRM as lines: no header, every ticked field flows on the record\'s line');
  ok(await p.getAttribute('[data-testid="view-lines-customers"]', 'aria-pressed') === 'true' && JSON.parse(await p.evaluate(() => localStorage.getItem('cblist.customers'))).view === 'lines', 'the view is remembered for this list (cblist.customers)');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'one-table-crm-lines-laptop.png') });
  await p.click('[data-testid="view-grid-customers"]');
  ok(await p.locator('#tbl_customers .lhead').count() === 1, 'back to grid: the header returns');
  await p.fill('[data-testid="listctl-search-customers"]', 'P-00002'); await p.waitForTimeout(300);
  ok(await p.locator('[data-testid^="cust-row-"]').count() === 1 && await p.locator('[data-testid="cust-row-c2"]').count() === 1, 'the search finds a party by its number (P-00002)');
  await p.fill('[data-testid="listctl-search-customers"]', 'ravi.stores'); await p.waitForTimeout(300);
  ok(await p.locator('[data-testid^="cust-row-"]').count() === 1 && await p.locator('[data-testid="cust-row-c1"]').count() === 1, 'the search finds a party by its Network ID');
  await p.fill('[data-testid="listctl-search-customers"]', ''); await p.waitForTimeout(300);
  /* ⭐ ADD BY NAME: a name (with a space) goes as {name, phone}; the list then shows them off-rail; an id-shaped word still goes as {handle} */
  await p.fill('[data-testid="cust-add-input"]', 'Kumar Tea Stall'); await p.fill('[data-testid="cust-add-phone"]', '98400 12345'); await p.click('[data-testid="cust-add"]');
  await p.waitForSelector('[data-testid="cust-row-cN"]', { timeout: 8000 }).catch(() => {});
  ok(S.lastCustAdd && S.lastCustAdd.name === 'Kumar Tea Stall' && S.lastCustAdd.phone === '98400 12345' && !S.lastCustAdd.handle, 'a typed name is sent as {name, phone}, not as a User ID');
  ok(await p.locator('[data-testid="cust-row-cN"]').count() === 1 && /off-rail/.test(await p.textContent('[data-testid="cust-row-cN"]').catch(() => '')), 'the new local customer is listed, marked off-rail');
  ok(/not on the network — bills stay with you/.test(await p.textContent('body')), 'the toast shows the API message');
  await p.fill('[data-testid="cust-add-input"]', 'ravi.stores'); await p.click('[data-testid="cust-add"]'); await p.waitForTimeout(300);
  ok(S.lastCustAdd && S.lastCustAdd.handle === 'ravi.stores' && !S.lastCustAdd.name, 'a User ID is still sent as {handle}');
  S.customers = S.customers.filter((c) => c.customer_identity_id !== 'cN'); delete S.items.cN; delete S.receipts.cN; await p.evaluate(() => loadCustomers()); await p.waitForTimeout(300);
  await p.click('#tbl_customers .lhcell:has-text("Party no")'); await p.waitForTimeout(200);
  const order1 = await p.$$eval('[data-testid^="cust-row-"]', (els) => els.map((x) => x.getAttribute('data-testid')));
  await p.click('#tbl_customers .lhcell:has-text("Party no")'); await p.waitForTimeout(200);
  const order2 = await p.$$eval('[data-testid^="cust-row-"]', (els) => els.map((x) => x.getAttribute('data-testid')));
  ok(JSON.stringify(order1) === JSON.stringify(['cust-row-c1', 'cust-row-c2']) && JSON.stringify(order2) === JSON.stringify(['cust-row-c2', 'cust-row-c1']), 'a click on the Party no heading sorts by it, a second click reverses it');
  await p.click('[data-testid="cust-row-c1"] [role="button"]'); await p.waitForSelector('[data-testid="crm-next-c1"]', { timeout: 8000 }).catch(() => {});
  await p.waitForFunction(() => /INV-1/.test((document.querySelector('[data-testid="crm-next-c1"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/INV-1/.test(await p.textContent('[data-testid="crm-next-c1"]')) && /3 orders/.test(await p.textContent('[data-testid="crm-next-c1"]')), 'a customer\'s next level: its orders and its bills (read once, on the first open)');
  await p.click('[data-testid="cust-row-c1"] [role="button"]');
  await p.evaluate(() => { UI[lwKey()] = 340; document.getElementById('panel').style.setProperty('--lw', '340px'); paintCustList(); });
  await p.click('[data-testid="cust-row-c1"]');
  await p.waitForSelector('[data-testid="party-books-c1"] [data-testid="stmt-closing"]', { timeout: 15000 });
  const bal = await p.textContent('[data-testid="party-books-c1"] [data-testid="party-balance"]');
  ok(/6,000/.test(bal), 'record: balance ' + bal.trim());
  ok(/0\.00/.test(await p.textContent('[data-testid="stmt-opening"]')) && /6,000/.test(await p.textContent('[data-testid="stmt-closing"]')), 'statement: opening … closing 6,000');

  /* 3 · a credit sale posted by the counter appears on the statement */
  S.items.c1.push({ against_ref: 'b3', bill_no: 'INV-3', due_date: '2026-10-29', open_minor: 150000, date: '2026-09-29', chit: 'ch3' });
  await p.evaluate(() => { BK.stmt = {}; });
  await p.click('[data-testid="nav-suppliers"]'); await p.waitForTimeout(400);
  await p.evaluate(() => navTo('customers'));
  await p.waitForSelector('[data-testid="party-books-c1"] [data-testid="stmt-closing"]', { timeout: 15000 });
  await p.waitForFunction(() => /7,500/.test((document.querySelector('[data-testid="stmt-closing"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const stmtTxt = await p.textContent('[data-testid="party-statement"]');
  await shot(p, '1-customer-record');
  ok(/INV-3/.test(stmtTxt) && /7,500/.test(await p.textContent('[data-testid="stmt-closing"]')), 'credit sale INV-3 is on the statement; closing 7,500');

  /* 4 · edit the party: nickname + a tax id another party holds → warned, then the server's 409 is shown */
  await p.click('[data-testid="cust-row-c2"]');
  await p.waitForSelector('[data-testid="party-books-c2"] [data-testid="party-edit"]', { timeout: 15000 });
  await p.click('[data-testid="party-books-c2"] [data-testid="party-edit"]');
  await p.fill('[data-testid="pe_nick"]', 'Meena');
  await p.fill('[data-testid="pe_legal"]', 'Meena Traders Pvt Ltd');
  await p.fill('[data-testid="pe_days"]', '15');
  await p.fill('[data-testid="pe_taxid"]', '33aaaaa0000a1z5');
  const warn = await p.textContent('[data-testid="pe_dup"]');
  ok(/Ravi Stores/.test(warn) && /GSTIN/.test(warn), 'duplicate tax id warned before saving (' + warn.trim() + ')');
  await p.click('[data-testid="pe_save"]');
  await p.waitForFunction(() => /already has this tax id/.test((document.querySelector('[data-testid="pe_dup"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/already has this tax id/.test(await p.textContent('[data-testid="pe_dup"]')), 'server 409 DUPLICATE_PARTY shown in the form, not swallowed');
  ok(S.lastPatch && S.lastPatch.id === 'cl2' && S.lastPatch.body.nickname === 'Meena' && S.lastPatch.body.credit_days === 15 && S.lastPatch.body.tax_ids[0].value === '33AAAAA0000A1Z5', 'PATCH carries nickname, credit days, the tax id (upper-cased)');
  await p.fill('[data-testid="pe_taxid"]', '33BBBBB1111B1Z5');
  ok((await p.textContent('[data-testid="pe_dup"]')).trim() === '', 'a fresh tax id clears the warning');
  await p.click('[data-testid="pe_save"]');
  await p.waitForSelector('[data-testid="pe_save"]', { state: 'detached', timeout: 8000 }).catch(() => {});
  ok(await p.locator('[data-testid="pe_save"]').count() === 0, 'saved: the form closes');
  await noAccounting(p, 'customers');

  /* 5 · receive ₹4,000 from Ravi (M27, one unit): the bills table, oldest due first (disputed skipped), changed, Record — one call */
  await p.click('[data-testid="cust-row-c1"]');
  await p.waitForSelector('[data-testid="party-books-c1"] [data-testid="party-pay"]', { timeout: 15000 });
  ok(/Receive/.test(await p.textContent('[data-testid="party-books-c1"] [data-testid="party-pay"]')), 'a customer\'s action says Receive');
  await p.click('[data-testid="party-books-c1"] [data-testid="party-pay"]');
  await p.fill('[data-testid="pay_amt"]', '4000');
  await p.waitForSelector('[data-testid="alloc-0"]', { timeout: 8000 });
  ok(S.payPosts.length === 0 && /^Record$/.test((await p.textContent('[data-testid="pay_record"]')).trim()) && !/Later/.test(await p.evaluate(() => document.body.innerText)), 'the bills table appears from the preview with nothing recorded yet; the button says Record and there is no "Later"');
  const rows = await p.$$eval('[data-testid^="alloc-row-"]', (els) => els.map((e) => e.textContent));
  const vals = await p.$$eval('[data-testid^="alloc-"]:not([data-testid^="alloc-row"])', (els) => els.map((e) => ({ v: e.value, d: e.disabled })));
  await shot(p, '2-receive-proposal');
  ok(/INV-9/.test(rows[0]) && vals[0].d === true, 'the disputed bill (oldest) is shown and cannot take anything');
  ok(/INV-1/.test(rows[1]) && Number(vals[1].v) === 3000 && /INV-2/.test(rows[2]) && Number(vals[2].v) === 1000, 'proposal: oldest due first — INV-1 3,000 then INV-2 1,000');
  /* ⚠️ forcing the disputed box open still cannot send an amount against it */
  await p.evaluate(() => { const e = document.getElementById('alloc_0'); e.disabled = false; e.value = '500'; });
  await p.click('[data-testid="pay_record"]');
  ok(S.payPosts.length === 0 && /disputed/i.test(await p.textContent('[data-testid="pay_why"]')), 'a disputed bill is refused before anything is sent');
  await p.evaluate(() => { const e = document.getElementById('alloc_0'); e.value = ''; e.disabled = true; });
  await p.fill('[data-testid="alloc-1"]', '5000');
  await p.click('[data-testid="pay_record"]');
  ok(S.payPosts.length === 0 && /more than that bill/i.test(await p.textContent('[data-testid="pay_why"]')), 'more than a bill has open is refused');
  await p.fill('[data-testid="alloc-1"]', '2000'); await p.fill('[data-testid="alloc-2"]', '2000');
  const left = await p.textContent('[data-testid="pay_left"]');
  ok(/settles 2 bills/.test(left) && !/advance/.test(left), 'changed: 2,000 + 2,000 — the line says 2 bills and nothing is left over (' + left + ')');
  /* ⚠️⚠️ review M11 — ONE TAP, ONE PAYMENT: the button is dead while its call is out, and a second press records nothing */
  S.slowRecord = 900;
  await p.click('[data-testid="pay_record"]'); await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 }); /* R102b: Record asks first */
  await p.waitForTimeout(250);
  const deadNow = await p.evaluate(() => { const b = document.querySelector('[data-testid="pay_record"]'); return !!(b && b.disabled); });
  await p.evaluate(() => { payRecord(); });                  /* a second press, while that call is still out */
  ok(deadNow, 'the button is dead while its call is out');
  await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 8000 });
  S.slowRecord = 0;
  ok(S.payPosts.length === 1 && Object.keys(S.payments).length === 1, '⚠️⚠️ a second press did NOT record the payment again (' + S.payPosts.length + ' POST, ' + Object.keys(S.payments).length + ' payment)');
  ok(/^web-[a-z0-9]+-[0-9a-f]+$/.test(String(S.payPosts[0].client_ref || '')), 'the payment carries a client_ref made when the form opened (' + S.payPosts[0].client_ref + ')');
  const c0 = S.payPosts[0] || {};
  ok(JSON.stringify(c0.allocations) === JSON.stringify([{ against_ref: 'b1', amount_minor: 200000 }, { against_ref: 'b2', amount_minor: 200000 }]), 'recorded WITH the CHANGED allocation, in minor units, in the same call');
  ok(/Received ₹4,000 cash from Ravi Stores\. Settled 2 bills/.test(await p.textContent('[data-testid="pay_outcome"]')) && /INV-1, INV-2/.test(await p.textContent('[data-testid="pay_settled"]')), 'the outcome says what happened and names the bills settled');
  await p.click('[data-testid="pay_done"]');
  await p.waitForFunction(() => /3,500/.test((document.querySelector('[data-testid="party-books-c1"] [data-testid="party-balance"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/3,500/.test(await p.textContent('[data-testid="party-books-c1"] [data-testid="party-balance"]')), 'balance repainted after the payment: 3,500');


  /* 5b · ⚠️⚠️ review M12 — a cheque: held, and its steps are offered the moment it is recorded */
  await p.click('[data-testid="party-books-c1"] [data-testid="party-pay"]');
  await p.fill('[data-testid="pay_amt"]', '500');
  await p.selectOption('[data-testid="pay_mode"]', 'cheque');
  await p.fill('[data-testid="pay_chqno"]', '004512');
  await p.click('[data-testid="pay_record"]'); await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 });
  await p.waitForSelector('[data-testid="pay_chq_steps"]', { timeout: 8000 }).catch(() => {});
  const chqId = Object.keys(S.payments).find((k) => S.payments[k].mode === 'cheque');
  ok(!!chqId && S.payPosts[S.payPosts.length - 1].client_ref !== S.payPosts[0].client_ref, 'a new form has a NEW client_ref, so the cheque is its own payment');
  ok(await p.locator('[data-testid="chq-deposited-' + chqId + '"]').count() === 1 && await p.locator('[data-testid="chq-bounced-' + chqId + '"]').count() === 0
    && await p.locator('[data-testid="chq-cleared-' + chqId + '"]').count() === 0, 'a cheque just received offers Deposited only — it is deposited before it can clear or bounce (engines v1.8.1)');
  await p.click('[data-testid="chq-deposited-' + chqId + '"]');
  await p.waitForSelector('[data-testid="chq-cleared-' + chqId + '"]', { timeout: 8000 }).catch(() => {});
  const st0 = S.chequeSteps[0] || {};
  ok(S.chequeSteps.length === 1 && st0.id === chqId && JSON.stringify(st0.body) === JSON.stringify({ status: 'deposited' }), 'Deposited → POST /api/books/cheques/' + chqId + '/status {status:"deposited"}');
  ok(/Deposited/.test(await p.textContent('[data-testid="chq-status-' + chqId + '"]').catch(() => '')), 'and the form now says Deposited, with Cleared offered');
  await noAccounting(p, 'cheque form');
  await p.evaluate(() => { closeModal(); booksAfterPay(); });

  /* the rail's Ledger item is ONE link to its own page now (2026-10-01, CB Accounts); the in-app screen stays reachable by URL / navTo */
  ok(await p.locator('[data-testid="nav-ledger"]').count() === 0, 'P0: the workshop menu has no Ledger door any more (Accounts is its own app); navTo("ledger") still redirects, checked below');
  /* 6 · the Ledger screen */
  await ledgerGo(p);
  await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 });
  await p.waitForSelector('[data-testid="db-entry-JV/2026-27/000001"]', { timeout: 8000 });
  ok(true, 'day book lists the entry with its number');
  /* ⭐ WHERE IT CAME FROM (Athi, 2026-10-01: "how do I connect to the sale record, who has done it?") */
  /* the bidi marks CBLocale wraps dates and times in are not text a reader sees — dropped before comparing */
  const headOf = async (tid) => ((await p.textContent('[data-testid="' + tid + '"]').catch(() => '')) || '').replace(/[‎‏⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  /* the Day book is the Task table now: one fact a column (date · entry no · kind · party · bill · tender · counter · amount) */
  const dbCell = async (no, lab) => ((await p.textContent('[data-testid="db-entry-' + no + '"] .lcell[data-l="' + lab + '"]').catch(() => '')) || '').replace(/[‎‏⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  const E1 = 'JV/2026-27/000001', E2 = 'JV/2026-27/000002', E3 = 'JV/2026-27/000003', E4 = 'JV/2026-27/000004';
  const t1 = await headOf('db-src-JV/2026-27/000001-at');
  ok(await p.locator('#bk_dvlist.tbllines, #bk_dvlist .lhead').count() >= 1 && await p.locator('#bk_dvlist .lrow').count() > 0 && await p.locator('.bkdv-row').count() === 0, 'day book: drawn by the Task table (.lhead / .lrow), and no .bkdv-row of its own');
  ok(/\d{1,2}:\d{2}/.test(t1) && await dbCell(E1, 'Bill') === 'C2/26-27/0002 ' + t1 && await dbCell(E1, 'Kind') === 'Sales' && await dbCell(E1, 'Party') === 'Ravi Stores' && await dbCell(E1, 'Tender') === 'On credit' && await dbCell(E1, 'Counter') === 'Counter C2 · rung by Athi',
    'day book: a bill entry — its bill and time, kind, party, how it was paid, counter, and "rung by" in the secondary text, one fact a column ("' + await dbCell(E1, 'Bill') + '" · "' + await dbCell(E1, 'Counter') + '")');
  ok(await dbCell(E1, 'Party') !== 'Athi' && !/Athi/.test(await dbCell(E1, 'Party')) && !/Counter/.test(await dbCell(E1, 'Party')), 'day book: the person who rang the bill and the counter are never in the Party column');
  ok(!/recorded/.test(await dbCell(E1, 'Bill')) && await p.locator('[data-testid="db-src-JV/2026-27/000001-rec"]').count() === 0, 'day book: recorded the same day as the bill → no "recorded" note');
  ok(await dbCell(E2, 'Bill') === 'Walk-in day · 12 bills' && /^Cash \S*1,240\.00 · UPI \S*860\.00 · Card \S*300\.00$/.test(await dbCell(E2, 'Tender')) && await dbCell(E2, 'Counter') === 'Counter C2', 'day book: a walk-in day says how many bills, its cash / UPI / card split, which counter ("' + await dbCell(E2, 'Bill') + '" · "' + await dbCell(E2, 'Tender') + '")');
  ok(await dbCell(E3, 'Bill') === 'Payment received' && await dbCell(E3, 'Party') === 'Ravi Stores', 'day book: an entry with no chit shows its own word in the Bill column ("' + await dbCell(E3, 'Bill') + '")');
  const t4 = await headOf('db-src-JV/2026-27/000004-at');
  ok(/\d{1,2}:\d{2}/.test(t4) && await dbCell(E4, 'Bill') === 'R/C2/0001 ' + t4 + ' recorded 01 Oct' && await dbCell(E4, 'Kind') === 'Receipts' && await dbCell(E4, 'Tender') === 'UPI 4421…9931' && await dbCell(E4, 'Counter') === 'Counter C2 · rung by Athi',
    'day book: money received — its number and time, UPI and its reference, counter, who — and, taken in late, "recorded 01 Oct" ("' + await dbCell(E4, 'Bill') + '")');
  const opened = await p.evaluate(async () => {
    const was = window.openChitSheet, got = []; window.openChitSheet = function (id) { got.push(id); };
    try { const a = document.querySelector('[data-testid="db-src-JV/2026-27/000001"]'); if (!a) return 'no link'; a.click(); return got.join(','); } finally { window.openChitSheet = was; }
  });
  ok(opened === 'ch1', 'day book: the bill number opens that chit\'s sheet, once (' + opened + ')');
  ok(await p.getAttribute('[data-testid="db-entry-JV/2026-27/000001"]', 'aria-expanded') === 'false', 'day book: tapping the bill number opens the sheet and does NOT also expand the row');
  ok(await p.locator('[data-testid="db-src-JV/2026-27/000002"]').count() === 0, 'day book: a walk-in day has no single bill to link');

  /* ⭐ 6b · THE STRIP — today's sales per counter and by tender, both rows from ONE function (bkDaySales) */
  const stripC1 = await headOf('strip-counter-C1'), stripC2 = await headOf('strip-counter-C2');
  ok(/4,280\.00/.test(stripC1) && /12 bills/.test(stripC1), 'strip: C1 adds the walk-in day and the credit bill — 4,280.00 · 12 bills ("' + stripC1 + '")');
  ok(/6,909\.00/.test(stripC2) && /1 bill$/.test(stripC2), 'strip: C2 — 6,909.00 · 1 bill, singular ("' + stripC2 + '")');
  const tCash = await headOf('strip-tender-Cash'), tUpi = await headOf('strip-tender-UPI'), tCard = await headOf('strip-tender-Card'), tCred = await headOf('strip-tender-On credit');
  ok(/1,240\.00/.test(tCash) && /300\.00/.test(tCard), 'strip: the day\'s split — Cash 1,240.00 · Card 300.00 ("' + tCash + '" · "' + tCard + '")');
  ok(/7,769\.00/.test(tUpi), 'strip: UPI adds the day\'s split AND the per-bill sale — 7,769.00 ("' + tUpi + '")');
  ok(/1,880\.00/.test(tCred), 'strip: On credit carries the bill\'s total ("' + tCred + '")');
  ok(await p.locator('[data-testid="strip-noclose"]').count() === 0, 'a walk-in day entry for today → no "not closed yet" note');

  /* ⭐ 6c · THE TO-DO — a count and a verb each; each line counted from its own route */
  const todoAccept = await headOf('todo-accept'), todoOver = await headOf('todo-overdue'), todoChq = await headOf('todo-cheques'), todoWait = await headOf('todo-waiting');
  ok(/^3 supplier bills to accept/.test(todoAccept), 'to-do: 3 supplier bills to accept — the health rows "Waiting for you to confirm …" ("' + todoAccept + '")');
  ok(/^1 customer overdue/.test(todoOver), 'to-do: 1 customer overdue — a bucket past "Not due", customers only ("' + todoOver + '")');
  ok(/^2 cheques to deposit \/ clear/.test(todoChq), 'to-do: 2 cheques to deposit / clear — the one held at the server and the one deposited in the app (held on the server too, 2026-10-02: Accounts reads it from there), each with a step still open; the cleared one not counted ("' + todoChq + '")');
  ok(/^2 waiting to be recorded/.test(todoWait), 'to-do: 2 waiting to be recorded — the health rows that are not supplier bills ("' + todoWait + '")');
  ok(await p.locator('[data-testid="todo-none"]').count() === 0, 'something waits → no quiet line');
  await noAccounting(p, 'day book strip and to-do');
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  await p.screenshot({ path: path.join(__dirname, 'shots', 'daybook-todo-laptop.png') });
  /* ⭐ THE DAY BOOK READS AS LINES (Athi, 2026-10-02): the header details one after another on one line, the gist under it, the journal when opened */
  ok(await p.locator('#bk_dvlist.tbllines').count() === 1 && await p.locator('#bk_dvlist .lhead').count() === 0, 'day book: opens as LINES - a record a line, no column header');
  const lineTxt = await p.evaluate(() => { const r = document.querySelector('[data-testid="db-entry-JV/2026-27/000001"]'); return r ? r.querySelector('.cbl-lgist') && r.querySelector('.cbl-lgist').textContent : ''; });
  ok(/\S/.test(lineTxt || ''), 'day book: the gist line sits under the record before it is opened ("' + (lineTxt || '').slice(0, 60) + '")');
  ok(await p.locator('[data-testid="view-grid-daybook"]').count() === 1 && await p.locator('[data-testid="cols-btn-daybook"]').count() === 1, 'day book: the grid / lines toggle and the columns chooser are in its bar');
  await p.click('[data-testid="db-expand-all"]');
  await p.locator('#bk_dvlist').scrollIntoViewIfNeeded();
  await p.locator('#bk_dvlist').screenshot({ path: path.join(__dirname, 'shots', 'one-table-daybook-laptop.png') });
  await p.click('[data-testid="db-collapse-all"]');

  /* ⭐ 6d · each line is a TAP to the screen that does it */
  await p.click('[data-testid="todo-overdue"]');
  await p.waitForSelector('[data-testid="dues-side-pay"]', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('[data-testid="dues-side-pay"]').count() === 1, 'tap: customers overdue opens Ledger › Dues');
  await p.click('[data-testid="acc-nav-daybook"]'); await p.waitForSelector('[data-testid="todo-cheques"]', { timeout: 8000 });
  await p.click('[data-testid="todo-cheques"]');
  await p.waitForSelector('[data-testid="chq-chq9"]', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('[data-testid="chq-chq9"]').count() === 1, 'tap: cheques opens Ledger › Cheques');
  await p.click('[data-testid="acc-nav-daybook"]'); await p.waitForSelector('[data-testid="todo-waiting"]', { timeout: 8000 });
  await p.click('[data-testid="todo-waiting"]');
  await p.waitForSelector('[data-testid="wait-retry"]', { timeout: 8000 }).catch(() => {});
  ok(/Waiting to be recorded/.test(await p.textContent('[data-testid="bk-body"]')), 'tap: waiting opens Ledger › Waiting');
  await p.click('[data-testid="acc-nav-daybook"]'); await p.waitForSelector('[data-testid="todo-accept"]', { timeout: 8000 });
  await p.click('[data-testid="todo-accept"]');
  await p.waitForSelector('[data-testid="bills-tab-B-2100"]', { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => UI.nav) !== 'intake' && await p.locator('[data-testid="bills-tab-B-2100"]').count() === 1, 'tap: several supplier bills opens the Received bills (a single one opens its sheet — e2e/chit-sheet.cjs), not Intake');
  await ledgerGo(p);   /* the menu's Ledger item is now "CB Accounts ↗" (PR #7) — the in-app screen stays reachable by route */
  await p.click('[data-testid="acc-nav-daybook"]');
  await p.waitForSelector('[data-testid="strip-counter-C1"]', { timeout: 15000 });


  /* ⭐ 6e · THE DAY BOOK'S VIEWS — one row per entry, the gist, expand / collapse, search, chips, Day · Week · Month, keys, CSV.
     Every expectation is computed HERE, from the entries the stand-in sent, by a second hand — never from the page's own helpers. */
  {
    const NO = (e) => '[data-testid="db-entry-' + e.entry_no + '"]';
    const ents = await p.evaluate(() => BK.dv.r.entries);
    const cents = (t) => Math.round(parseFloat(String(t).replace(/[^0-9.]/g, '')) * 100);
    const sumOf = (e, f) => e.lines.reduce((a, l) => a + (l[f] || 0), 0);
    const gstRe = /^22(0\d|1[0-2])$/;
    const gistExpect = (e) => { const m = {}; e.lines.forEach((l) => { const k = gstRe.test(l.code) ? 'GST' : l.name; m[k] = (m[k] || 0) + (l.dr_minor || 0) + (l.cr_minor || 0); }); return m; };
    const gistShown = async (e) => { const t = (await headOf('db-gist-' + e.entry_no)); const m = {}; t.split(' · ').forEach((part) => { const i = part.lastIndexOf(' '); m[part.slice(0, i)] = cents(part.slice(i)); }); return m; };
    const isoMon = (d) => { const t = new Date(d + 'T00:00:00Z'); return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
    const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
    const shownNos = () => p.$$eval('#bk_dvlist .lrow[data-no]', (els) => els.map((x) => x.getAttribute('data-no')));
    const DBQ = '[data-testid="listctl-search-daybook"]', filt = async () => { if (!await p.locator('[data-testid="cbl-filters-pop-daybook"]').count()) await p.click('[data-testid="cbl-filters-daybook"]'); }, pick = async (dim, v) => { await filt(); await p.selectOption('[data-testid="listctl-filter-' + dim + '"]', v); }, unpick = async (dim) => { await filt(); await p.selectOption('[data-testid="listctl-filter-' + dim + '"]', ''); };
    const nLines = (e) => p.evaluate((no) => { const x = document.querySelector('[data-testid="db-lines-' + no + '"]'); return x ? x.children.length - 1 : -1; }, e.entry_no);   /* the next level: a head line, then each Dr/Cr line (the gist is the grey line under the record) */
    const settle = () => p.waitForTimeout(450);
    const clear = async () => { await p.fill(DBQ, ''); await settle(); };

    /* collapsed by default: one row per entry, no rate-wise lines on screen, a gist under each */
    await p.waitForSelector('[data-testid="cbl-filters-daybook"]', { timeout: 8000 });
    ok((await shownNos()).length === ents.length && await p.locator('[data-testid^="db-lines-"]').count() === 0, 'views: collapsed by default — ' + ents.length + ' rows for ' + ents.length + ' entries, no rate-wise lines');
    let allRows = true; for (const e of ents) if (await p.getAttribute(NO(e), 'aria-expanded') !== 'false') allRows = false;
    ok(allRows, 'views: every row starts collapsed');
    await p.screenshot({ path: path.join(__dirname, 'shots', 'daybook-collapsed.png') });
    /* the gist is the entry's own lines merged by ledger — each figure compared with a second sum (it sits in the row's next level, so the rows are opened first) */
    await p.click('[data-testid="db-expand-all"]');
    let gistsOk = true, why = '';
    for (const e of ents) {
      const want = gistExpect(e), got = await gistShown(e);
      if (JSON.stringify(Object.keys(want).sort()) !== JSON.stringify(Object.keys(got).sort()) || Object.keys(want).some((k) => want[k] !== got[k])) { gistsOk = false; why += ' ' + e.entry_no + ' want ' + JSON.stringify(want) + ' got ' + JSON.stringify(got); }
      const tot = cents((await p.textContent('[data-testid="db-total-' + e.entry_no + '"]')));
      if (tot !== sumOf(e, 'dr_minor')) { gistsOk = false; why += ' ' + e.entry_no + ' total ' + tot; }
    }
    await p.click('[data-testid="db-collapse-all"]');
    ok(gistsOk, 'views: each gist figure equals the sum of that entry\'s own lines, and the right-hand total is its debit sum' + why);
    await p.click(NO(ents[0]) + ' .bkdv-dt');
    const g1 = await headOf('db-gist-' + ents[0].entry_no);
    await p.click(NO(ents[0]) + ' .bkdv-dt');
    ok(/^Sales \S*2,542\.38 · GST \S*457\.62 · Debtors \S*3,000\.00$/.test(g1), 'views: the rate-wise GST lines read as ONE GST figure, credit side first ("' + g1 + '")');
    const e0 = ents[0];
    /* expand one → its lines; the others stay shut; tap again → shut */
    await p.click(NO(e0) + ' .bkdv-dt');
    ok(await p.getAttribute(NO(e0), 'aria-expanded') === 'true' && await nLines(e0) === e0.lines.length && await p.locator('[data-testid^="db-lines-"]').count() === 1, 'views: tap a row → its ' + e0.lines.length + ' rate-wise lines, and only that row');
    await p.screenshot({ path: path.join(__dirname, 'shots', 'daybook-expanded.png') });
    await p.click(NO(e0) + ' .bkdv-dt');
    ok(await p.getAttribute(NO(e0), 'aria-expanded') === 'false' && await p.locator('[data-testid^="db-lines-"]').count() === 0, 'views: tap again → collapsed');
    await p.click('[data-testid="db-expand-all"]');
    ok(await p.locator('[data-testid^="db-lines-"]').count() === ents.length && (await p.$$eval('[data-testid^="db-lines-"]', (els) => els.reduce((a, x) => a + x.children.length - 1, 0))) === ents.reduce((a, e) => a + e.lines.length, 0), 'views: Expand all → every entry\'s lines');
    await p.click('[data-testid="db-collapse-all"]');
    ok(await p.locator('[data-testid^="db-lines-"]').count() === 0 && await p.locator('#bk_dvlist .lrow[data-no][aria-expanded="true"]').count() === 0, 'views: Collapse all → none left open');

    /* search: by amount (whole and with paise), by party; the group heads follow */
    const byAmt = (q) => { const dec = q.indexOf('.') >= 0, n = parseFloat(q); return ents.filter((e) => [sumOf(e, 'dr_minor')].concat(Object.values(gistExpect(e)), e.lines.map((l) => (l.dr_minor || 0) + (l.cr_minor || 0))).some((a) => dec ? a === Math.round(n * 100) : Math.floor(a / 100) === n)).map((e) => e.entry_no); };
    await p.fill(DBQ, '1880'); await settle();
    const s1 = await shownNos();
    ok(JSON.stringify(s1) === JSON.stringify(byAmt('1880')) && s1.length >= 1, 'views: search 1880 (no paise) finds the bill with 1,880.00 — ' + s1.length + ' row');
    const headToday = await headOf('db-gsum-' + TODAY);
    ok(/^1 entry · /.test(headToday) && cents(headToday.match(/Dr (\S+)/)[1]) === 188000, 'views: the day head follows the search — "' + headToday + '"');
    await p.fill(DBQ, '3000.00'); await settle();
    ok(JSON.stringify(await shownNos()) === JSON.stringify(byAmt('3000.00')) && (await shownNos()).length === 1, 'views: search 3000.00 (with paise) finds exactly that entry');
    await p.fill(DBQ, '3000.50'); await settle();
    ok((await shownNos()).length === 0 && JSON.stringify(byAmt('3000.50')) === '[]', 'views: search 3000.50 finds nothing — paise are matched exactly, not rounded to the rupee');
    await p.fill(DBQ, 'ravi'); await settle();
    const wantRavi = ents.filter((e) => e.lines.some((l) => /ravi/i.test(l.party_name || ''))).map((e) => e.entry_no);
    ok(JSON.stringify(await shownNos()) === JSON.stringify(wantRavi) && wantRavi.length >= 2, 'views: search by party name — ' + wantRavi.length + ' of ' + ents.length + ' entries');
    await p.fill(DBQ, 'JV/2026-27/000002'); await settle();
    ok(JSON.stringify(await shownNos()) === JSON.stringify(['JV/2026-27/000002']), 'views: search by entry number');
    await p.fill(DBQ, 'C2/26-27/0002'); await settle();
    ok((await shownNos()).length === 1, 'views: search by bill number');
    await p.fill(DBQ, 'zzzz'); await settle();
    ok((await shownNos()).length === 0 && /Nothing matches/.test(await p.textContent('[data-testid="db-list"]')), 'views: a search that finds nothing says so');
    await clear();

    /* chips: only values in the range; several may be on; the group heads' subtotals change */
    const optsOf = async (dim) => { await filt(); return p.$$eval('[data-testid="listctl-filter-' + dim + '"] option', (os) => os.map((o) => o.value).filter(Boolean)); };
    ok((await optsOf('kind')).indexOf('Sales') >= 0 && (await optsOf('kind')).indexOf('Receipts') >= 0 && (await optsOf('kind')).indexOf('Purchases') < 0 && (await optsOf('counter')).indexOf('C1') >= 0 && (await optsOf('counter')).indexOf('C9') < 0, 'views: the filters (list-ctl selects) offer only values present — Sales, Receipts, counter C1; no Purchases, no C9');
    const dayRows = (nos) => ents.filter((e) => nos(e));
    const before = await headOf('db-gsum-' + TODAY);
    await pick('how', 'UPI'); await settle();
    const wantUpi = ents.filter((e) => { const s = e.source || {}; return s.kind === 'day' ? (s.split || []).some((x) => x.how === 'UPI') : s.how === 'UPI'; }).map((e) => e.entry_no);
    ok(JSON.stringify(await shownNos()) === JSON.stringify(wantUpi) && await (async () => { await filt(); return p.inputValue('[data-testid="listctl-filter-how"]'); })() === 'UPI', 'views: the Tender filter set to UPI keeps the ' + wantUpi.length + ' UPI entries');
    const after = await headOf('db-gsum-' + TODAY), todayUpi = ents.filter((e) => e.posting_date === TODAY && wantUpi.indexOf(e.entry_no) >= 0);
    ok(after !== before && new RegExp('^' + todayUpi.length + ' entr').test(after) && cents(after.match(/Dr (\S+)/)[1]) === todayUpi.reduce((a, e) => a + sumOf(e, 'dr_minor'), 0), 'views: the day head\'s subtotals change with the filter — "' + before.slice(0, 40) + '…" → "' + after.slice(0, 40) + '…"');
    await pick('kind', 'Sales'); await settle();
    const wantBoth = ents.filter((e) => wantUpi.indexOf(e.entry_no) >= 0 && (e.source.kind === 'day' || e.source.kind === 'bill')).map((e) => e.entry_no);
    ok(JSON.stringify(await shownNos()) === JSON.stringify(wantBoth), 'views: two filters together narrow further (Sales and UPI)');
    await unpick('kind'); await unpick('how');
    await pick('kind', 'Receipts'); await settle();
    ok(JSON.stringify(await shownNos()) === JSON.stringify(ents.filter((e) => e.source && e.source.kind === 'receipt' || /payment_received/.test(e.event_type)).map((e) => e.entry_no)), 'views: the Receipts filter keeps the receipts');
    await unpick('kind');
    await pick('counter', 'C1'); await settle();
    ok(JSON.stringify(await shownNos()) === JSON.stringify(ents.filter((e) => e.source && e.source.counter === 'C1').map((e) => e.entry_no)), 'views: a counter filter');
    await unpick('counter');
    await pick('by', 'Mani'); await settle();
    ok(JSON.stringify(await shownNos()) === JSON.stringify(ents.filter((e) => e.source && e.source.by === 'Mani').map((e) => e.entry_no)), 'views: a person filter');
    await unpick('by'); await settle();
    ok((await shownNos()).length === ents.length, 'views: every filter off → everything again');

    /* Day / Week / Month heads */
    const days = uniq(ents.map((e) => e.posting_date)), weeks = uniq(ents.map((e) => isoMon(e.posting_date))), months = uniq(ents.map((e) => e.posting_date.slice(0, 7)));
    ok(await p.locator('#bk_dvlist [data-g]').count() === days.length && await p.getAttribute('[data-testid="db-group-day"]', 'aria-pressed') === 'true', 'views: Day is the default — ' + days.length + ' day heads');
    const dh = await headOf('db-ghead-2026-07-02');
    ok(/^\S?\s?[A-Za-z]{3},? 02 Jul 2 entries · Dr \S+ · Cr \S+ · Sales \S+ · On credit \S+ · Cash \S+ · UPI \S+ · Card \S+$/.test(dh), 'views: a day head reads weekday, date, entries, Dr, Cr, Sales and each tender ("' + dh + '")');
    const j2 = ents.filter((e) => e.posting_date === '2026-07-02'), drJ2 = j2.reduce((a, e) => a + sumOf(e, 'dr_minor'), 0), crJ2 = j2.reduce((a, e) => a + sumOf(e, 'cr_minor'), 0);
    const sm = await headOf('db-gsum-2026-07-02');
    ok(cents(sm.match(/Dr (\S+)/)[1]) === drJ2 && cents(sm.match(/Cr (\S+)/)[1]) === crJ2 && drJ2 === crJ2, 'views: the day head\'s Dr and Cr are the entries\' own lines, and they match');
    await p.click('[data-testid="db-group-week"]');
    ok(await p.locator('#bk_dvlist [data-g]').count() === weeks.length && /Week 27/.test(await headOf('db-ghead-2026-06-29')), 'views: Week → ' + weeks.length + ' heads, Mon–Sun, with the ISO week number ("' + await headOf('db-ghead-2026-06-29') + '")');
    const wk = ents.filter((e) => isoMon(e.posting_date) === '2026-06-29');
    ok(new RegExp(' ' + wk.length + ' entries · Dr ').test(await headOf('db-ghead-2026-06-29')), 'views: the week head counts its ' + wk.length + ' entries');
    await p.screenshot({ path: path.join(__dirname, 'shots', 'daybook-week.png') });
    await p.click('[data-testid="db-group-month"]');
    ok(await p.locator('#bk_dvlist [data-g]').count() === months.length && /July 2026 4 entries/.test(await headOf('db-ghead-2026-07')), 'views: Month → ' + months.length + ' heads, named ("' + await headOf('db-ghead-2026-07') + '")');
    await p.click('[data-testid="db-ghead-2026-07"]');
    ok((await shownNos()).indexOf('JV/2026-27/000001') < 0, 'views: a group head collapses its rows');
    await p.click('[data-testid="db-ghead-2026-07"]');
    await p.click('[data-testid="db-group-day"]');

    /* keyboard: ↑ ↓ move the highlight, Enter opens / closes, Esc closes a sheet */
    const all = await shownNos();
    await p.click('[data-testid="db-entry-' + all[0] + '"] .bkdv-dt'); await p.click('[data-testid="db-entry-' + all[0] + '"] .bkdv-dt');   /* the highlight starts on the row last tapped */
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('ArrowDown');
    ok(await p.locator('#bk_dvlist .lrow.sel[data-no]').count() === 1 && await p.getAttribute('#bk_dvlist .lrow.sel[data-no]', 'data-no') === all[1], 'keys: ↓ moves the highlight to the next row');
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp');
    ok(await p.getAttribute('#bk_dvlist .lrow.sel[data-no]', 'data-no') === all[1], 'keys: ↓ then ↑ comes back');
    await p.keyboard.press('Enter');
    ok(await p.getAttribute('[data-testid="db-entry-' + all[1] + '"]', 'aria-expanded') === 'true', 'keys: Enter expands the highlighted row');
    await p.keyboard.press('Enter');
    ok(await p.getAttribute('[data-testid="db-entry-' + all[1] + '"]', 'aria-expanded') === 'false', 'keys: Enter again collapses it');
    await p.evaluate(() => openChitSheet('ch1'));
    await p.waitForFunction(() => { const d = document.getElementById('chitsheet'); return d && d.open; }, null, { timeout: 5000 }).catch(() => {});
    const sheetOpen = await p.evaluate(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open); });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(sheetOpen && await p.evaluate(() => { const d = document.getElementById('chitsheet'); return !d.open; }), 'keys: Esc closes the open sheet');

    /* CSV: the shown rows, one line each */
    await p.fill(DBQ, 'ravi'); await settle();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-testid="db-csv"]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);
    ok(csv[0] === 'date,no,kind,party,ref,how,counter,by,dr,cr,gist' && csv.length === 1 + wantRavi.length, 'views: Download CSV — a header and one line per shown row (' + (csv.length - 1) + ' of ' + wantRavi.length + ')');
    ok(csv[1].indexOf('2026-07-02,JV/2026-27/000001,Sales,Ravi Stores,C2/26-27/0002,On credit,C2,Athi,3000.00,3000.00,') === 0 && /GST 457\.62/.test(csv[1]), 'views: the CSV line carries date, number, kind, party, ref, how, counter, by, Dr, Cr and the gist');
    await clear();
    await noAccounting(p, 'day book views');
  }

  await p.click('[data-testid="acc-nav-ledgers"]');
  await p.waitForSelector('[data-testid="lt-band-people"]', { timeout: 8000 });
  await p.click('[data-testid="lg-acc-1300"]');   /* the bands open by themselves (the tree is the way in): People shows Customers at once */
  await p.waitForSelector('[data-testid="lg-party-c1"]', { timeout: 8000 });
  /* the party's number stays out of the tree line (one short line per node) but is its tooltip and what the find box takes: typing it finds the party */
  ok(crmNo && ((await p.getAttribute('[data-testid="lg-party-c1"]', 'title')) || '').indexOf(crmNo) >= 0, 'the ledger\'s party leaf carries the same party no as the CRM row, as its tooltip (' + crmNo + ')');
  await p.fill('[data-testid="lt-find"]', crmNo); await p.waitForTimeout(150);
  ok(await p.locator('[data-testid="lg-party-c1"]').count() === 1 && await p.locator('[data-testid^="lg-party-"]').count() === 1, 'typing the party no in the find box finds that one party (' + crmNo + ')');
  await p.fill('[data-testid="lt-find"]', ''); await p.waitForTimeout(100);
  await p.waitForSelector('[data-testid="stmt-what-0"]', { timeout: 8000 }).catch(() => {});
  const l0 = await headOf('stmt-what-0'), l1 = await headOf('stmt-what-1');
  const lt0 = await headOf('stmt-src-0-at');
  ok(/\d{1,2}:\d{2}/.test(lt0) && l0 === 'Sale · Bill C2/26-27/0002 ' + lt0 + ' recorded 01 Oct' && l1 === 'Payment received JV/2026-27/000003', 'ledger: Details says the kind and its bill once ("' + l0 + '" · "' + l1 + '"); tender, counter and who rang it are their own columns in ⚙');
  /* the Ledgers quick fixes (2026-10-03): the kind word once · one opening/closing line in Dr/Cr · no minus · nothing cut off */
  {
    /* the Ledgers head keeps the figures inline on a laptop and folds two or more notices into ONE chip (foldHead); on a phone the figures are in its popover */
    if (!(await p.locator('[data-testid="lg-sum"]').count())) await p.click('[data-testid^="cbl-notes-ledger-"]').catch(() => {});
    const lg = await p.evaluate(() => { const o = document.getElementById('lg_out'), l = o.querySelector('.cbl-list'), s = o.querySelectorAll('[data-testid="lg-sum"]');
      return { text: o.textContent, tree: document.getElementById('lt_tree').textContent, sums: s.length, sum: s[0] ? s[0].textContent.replace(/\s+/g, ' ').trim() : '', sw: l ? l.scrollWidth : 0, cw: l ? l.clientWidth : 0 }; });
    ok(!/Expense · Expense/.test(lg.text), 'ledger: the kind word is said once (Expense · Expense never appears)');
    ok(lg.sums === 1 && /^Opening ₹0\.00 · Closing ₹2,500\.00 Dr/.test(lg.sum), 'ledger: ONE opening · closing line, closing in Dr/Cr (' + lg.sum + ')');
    ok(!/(^|[\s(|])[-−]\s?₹?\s?\d/.test(lg.text + ' ' + lg.tree), 'ledger: no minus sign anywhere on the view — Dr / Cr');
    ok(lg.sw <= lg.cw + 1, 'ledger: the list does not scroll sideways (' + lg.sw + ' ≤ ' + lg.cw + ')');
  }
  const opened2 = await p.evaluate(async () => {
    const was = window.openChitSheet, got = []; window.openChitSheet = function (id) { got.push(id); };
    try { const a = document.querySelector('[data-testid="stmt-src-0"]'); if (!a) return 'no link'; a.click(); return got.join(','); } finally { window.openChitSheet = was; }
  });
  ok(opened2 === 'ch1', 'ledger: the bill number opens that chit (' + opened2 + ')');
  await noAccounting(p, 'day book and ledger sources');
  await p.click('[data-testid="acc-nav-tb"]');
  await p.waitForSelector('[data-testid="tb-balanced"]', { timeout: 8000 });
  ok(/balances/.test(await p.textContent('[data-testid="tb-balanced"]')) && (await p.textContent('[data-testid="tb-dr"]')) === (await p.textContent('[data-testid="tb-cr"]')), 'trial balance: debit total = credit total, and it says so');
  await shot(p, '3-trial-balance');
  S.tbOff = true; await p.click('[data-testid="acc-nav-tb"]');
  await p.waitForFunction(() => /does not/.test((document.querySelector('[data-testid="tb-balanced"]') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  ok(/does not balance/.test(await p.textContent('[data-testid="tb-balanced"]')), 'a trial balance off by one paisa says it does not balance');
  S.tbOff = false;
  await p.click('[data-testid="acc-nav-pl"]'); await p.waitForSelector('[data-testid="pl-profit"]', { timeout: 8000 });
  ok(/Profit/.test(await p.textContent('[data-testid="pl-profit"]')), 'P&L shows the profit line');
  await p.click('[data-testid="acc-nav-bs"]'); await p.waitForSelector('[data-testid="bs-balanced"]', { timeout: 8000 });
  ok(/balances/.test(await p.textContent('[data-testid="bs-balanced"]')), 'balance sheet balances');
  await p.evaluate(() => show('dues')); await p.waitForSelector('[data-testid="dues-c1"]', { timeout: 8000 });
  await shot(p, '4-dues');
  /* Dues is the Task table: a party · its total due · its oldest due; the age buckets and the disputed amount are the row's next level */
  ok(await p.locator('.lhead').count() >= 1 && await p.locator('[data-testid="dues-c1"].lrow').count() === 1, 'dues: drawn by the Task table — a party a row, not eight columns cut off at the right edge');
  await p.click('[data-testid="dues-c1"]'); await p.click('[data-testid="dues-s1"]');
  await p.waitForSelector('[data-testid="dues-next-c1"]', { timeout: 5000 }).catch(() => {});
  ok(/1,000/.test(await p.textContent('[data-testid="dues-next-c1"]')), 'dues: the disputed amount is on the party\'s next level');
  /* ⚠️ review F11 — a supplier's buckets are the payable ones; the amount must sit under ITS bucket, not only the total */
  const cellOf = (row, b) => p.evaluate(({ row, b }) => { const e = document.querySelector('[data-testid="dues-next-' + row + '"] [data-b="' + b + '"]'); return e ? e.closest('div').textContent.trim() : null; }, { row, b });
  ok(/2,500/.test(String(await cellOf('s1', 'd31_60'))) && await p.locator('[data-testid="dues-side-pay"]').count() === 1, 'dues: what you owe a supplier sits under "31–60 days" in its own group (' + await cellOf('s1', 'd31_60') + ')');
  ok(String(await cellOf('c1', 'd31_60') || '').length > 0 && await cellOf('c1', 'other') === null && await cellOf('s1', 'other') === null, 'dues: a customer and a supplier read the SAME five ages, and there is no "Other" (W15-94)');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'one-table-dues-laptop.png') });
  await noAccounting(p, 'ledger');

  /* ⚠️⚠️ review M12 — the cheques held, and their steps */
  ok(await p.locator('[data-testid="acc-nav-waiting"]').count() === 0 && await p.evaluate(() => (BK.waiting || []).length) === 5, 'Waiting is not a menu item (A1); the ledger still knows 5 posts are waiting - To do carries them');
  await p.click('[data-testid="acc-nav-cheques"]');
  await p.waitForSelector('[data-testid="chq-' + chqId + '"]', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('[data-testid="chq-' + chqId + '"]').count() === 1 && /Deposited/.test(await p.textContent('[data-testid="chq-status-' + chqId + '"]').catch(() => '')), 'Cheques: the one recorded here is listed, Deposited');
  ok(await p.locator('[data-testid="chq-chq9"]').count() === 1 && /Received/.test(await p.textContent('[data-testid="chq-status-chq9"]').catch(() => '')), 'Cheques: one the server lists as held is there too, Received');
  await p.click('[data-testid="chq-cleared-' + chqId + '"]').catch(() => {});
  await p.waitForFunction((id) => /Cleared/.test((document.querySelector('[data-testid="chq-status-' + id + '"]') || {}).textContent || ''), chqId, { timeout: 8000 }).catch(() => {});
  const st1 = S.chequeSteps[1] || {};
  ok(st1.id === chqId && JSON.stringify(st1.body) === JSON.stringify({ status: 'cleared' }) && /Cleared/.test(await p.textContent('[data-testid="chq-status-' + chqId + '"]').catch(() => '')), 'Cleared → POST …/cheques/' + chqId + '/status {status:"cleared"}; the row says Cleared');
  /* a cleared cheque offers no step at all — a later dishonour is an owner reversal, not a step (engines v1.8.1) */
  ok(await p.locator('[data-testid^="chq-"][data-testid$="-' + chqId + '"]:is(button)').count() === 0, 'a cleared cheque offers no further step');
  /* the server refuses a step: its words are shown, the row does not move (the button offered came from the server\'s `next`) */
  S.refuseCheque = true;
  await p.click('[data-testid="chq-deposited-chq9"]').catch(() => {});
  await p.waitForFunction(() => ((document.querySelector('[data-testid="chq_out"]') || {}).textContent || '').trim() !== '', null, { timeout: 8000 }).catch(() => {});
  ok(/cannot be/.test(await p.textContent('[data-testid="chq_out"]').catch(() => '')) && /Received/.test(await p.textContent('[data-testid="chq-status-chq9"]').catch(() => '')), 'a refused step shows the server\'s words and the row stays Received');
  S.refuseCheque = false;
  /* the held one from the server: only Deposited is offered (the server\'s `next`), then Cleared or Bounced */
  ok(await p.locator('[data-testid="chq-bounced-chq9"]').count() === 0 && await p.locator('[data-testid="chq-deposited-chq9"]').count() === 1, 'a received cheque offers Deposited only — the steps come from the server');
  await p.click('[data-testid="chq-deposited-chq9"]').catch(() => {});
  await p.waitForFunction(() => /Deposited/.test((document.querySelector('[data-testid="chq-status-chq9"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  /* Bounced asks first: Cancel sends nothing, Yes sends it */
  const nSteps = S.chequeSteps.length;
  await p.click('[data-testid="chq-bounced-chq9"]').catch(() => {});
  await p.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 4000 }).catch(() => {});
  await p.click('[data-testid="confirm-cancel"]', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300);
  ok(S.chequeSteps.length === nSteps, 'Bounced asks first — Cancel sends nothing');
  await p.click('[data-testid="chq-bounced-chq9"]').catch(() => {});
  await p.waitForSelector('[data-testid="confirm-ok"]', { timeout: 4000 }).catch(() => {});
  await p.click('[data-testid="confirm-ok"]', { timeout: 2000 }).catch(() => {});
  await p.waitForFunction(() => /Bounced/.test((document.querySelector('[data-testid="chq-status-chq9"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const st2 = S.chequeSteps[S.chequeSteps.length - 1] || {};
  ok(S.chequeSteps.length === nSteps + 1 && st2.id === 'chq9' && st2.body.status === 'bounced' && await p.locator('[data-testid^="chq-"][data-testid$="-chq9"]:is(button)').count() === 0, 'Bounced, confirmed → sent; a bounced cheque offers no further step');
  ok(S.chequeLists >= 1, 'the Cheques view reads GET /api/books/cheques (' + S.chequeLists + ' reads)');
  await shot(p, '4b-cheques');
  await noAccounting(p, 'cheques');

  /* ⚠️⚠️ review M12 — what could not be recorded is ON A SCREEN, in the server's words, with Try again */
  await p.evaluate(() => show('waiting'));   /* the list is opened from To do's "waiting to be recorded" notice (no menu item since A1) */
  await p.waitForSelector('[data-testid="wait-retry"]', { timeout: 8000 }).catch(() => {});
  const waitTxt = await p.textContent('[data-testid="bk-body"]');
  ok(/Waiting to be recorded/.test(waitTxt) && /Paid by Points — there is no ledger for Points yet\./.test(waitTxt) && /September is locked\. Open it again to record this bill\./.test(waitTxt), 'Waiting to be recorded: each one with the server\'s own sentence');
  await shot(p, '4c-waiting');
  await p.click('[data-testid="wait-retry"]').catch(() => {});
  await p.waitForFunction(() => /still waiting|All recorded/.test((document.querySelector('[data-testid="wait_out"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(S.retries === 1 && /1 recorded · 4 still waiting/.test(await p.textContent('[data-testid="wait_out"]').catch(() => '')) && await p.locator('[data-testid="wait-4"]').count() === 0 && await p.locator('[data-testid="wait-3"]').count() === 1,
    'Try again → POST /api/books/outbox/retry; the list is read again: 1 recorded, 4 still waiting (the supplier bills wait on a person, not a retry)');
  await noAccounting(p, 'waiting');

  /* month lock blocks a payment in that month; opening again needs a reason */
  await p.click('[data-testid="acc-nav-lock"]'); await p.waitForSelector('[data-testid="lk-row-12"]');
  const sep = String((new Date().getMonth() + 9) % 12 + 1);
  ok(await p.locator('[data-testid^="lk-row-"]').count() === 12 && await p.inputValue('[data-testid="lk_fy"]') === FYNOW, 'Month lock: the financial year is a picker on the current year, and the twelve months are rows');
  ok(await p.locator('[data-testid="lk-state-' + sep + '"][data-state="open"]').count() === 1 && await p.locator('[data-testid="lk-unlock-' + sep + '"]').count() === 0 && await p.locator('[data-testid="lk-lock-' + sep + '"]').count() === 1, 'an open month offers Lock, not Open again');
  ok(/Close for good/.test(await p.textContent('[data-testid="lk_note"]')) && /never opens again/.test(await p.textContent('[data-testid="lk_note"]')), 'Close for good is explained in one line');
  await p.click('[data-testid="lk-lock-' + sep + '"]');
  await p.waitForFunction((n) => /Locked/.test(document.querySelector('[data-testid="lk-state-' + n + '"]').textContent), sep, { timeout: 8000 }).catch(() => {});
  ok(S.locked[+sep] === true && await p.locator('[data-testid="lk-unlock-' + sep + '"]').count() === 1 && await p.locator('[data-testid="lk-hard-' + sep + '"]').count() === 1, 'this month locked: its row now says Locked and offers Open again and Close for good');
  await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });   /* back from CB Accounts to the app */
  await p.evaluate(() => navTo('customers'));
  await p.waitForSelector('[data-testid="party-books-c1"] [data-testid="party-pay"]', { timeout: 15000 });
  await p.click('[data-testid="party-books-c1"] [data-testid="party-pay"]');
  await p.fill('[data-testid="pay_amt"]', '100'); await p.click('[data-testid="pay_record"]'); await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 });
  await p.waitForFunction(() => /locked/.test((document.querySelector('[data-testid="pay_why"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok(/locked/.test(await p.textContent('[data-testid="pay_why"]')) && await p.locator('[data-testid="pay_outcome"]').count() === 0, 'a payment in a locked month is refused, and the form says why');
  /* M11: pressing Next again on the SAME form is a retry — it carries the same client_ref, so the server can answer with what it kept */
  const nPosts = S.payPosts.length;
  await p.click('[data-testid="pay_record"]'); await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 });
  for (let i = 0; i < 40 && S.payPosts.length === nPosts; i++) await p.waitForTimeout(100);
  ok(S.payPosts.length === nPosts + 1 && S.payPosts[nPosts].client_ref && S.payPosts[nPosts].client_ref === S.payPosts[nPosts - 1].client_ref, 'a retry from the same form sends the SAME client_ref');
  await p.evaluate(() => closeModal());
  await ledgerGo(p); await p.click('[data-testid="acc-nav-lock"]'); await p.waitForSelector('[data-testid="lk-unlock-' + sep + '"]');
  ok(/Locked/.test(await p.textContent('[data-testid="lk-state-' + sep + '"]')), 'a locked month\'s row says Locked after coming back to the screen (read from the server)');
  const before = S.lastLock;
  await p.click('[data-testid="lk-unlock-' + sep + '"]');
  await p.waitForSelector('[data-testid="lk_why"]', { timeout: 5000 }); /* W15-97: the reason is asked in the popup beside Open again */
  await p.click('[data-testid="lk-reopen-go"]');
  ok(S.lastLock === before && /Say why/.test(await p.textContent('[data-testid="lk-whyout"]')), 'opening a month again without a reason is refused before sending');
  await p.fill('[data-testid="lk_why"]', 'late bill from Agro Mills');
  await p.click('[data-testid="lk-reopen-go"]');
  await p.waitForFunction((n) => document.querySelector('[data-testid="lk-state-' + n + '"]').getAttribute('data-state') === 'open', sep, { timeout: 8000 }).catch(() => {});
  ok(S.locked[+sep] === false && S.lastLock.body.reason === 'late bill from Agro Mills', 'opened again, with the reason sent');

  /* close for good: asks first; Cancel sends nothing, Yes sends hard */
  await p.click('[data-testid="lk-lock-' + sep + '"]');
  await p.waitForSelector('[data-testid="lk-hard-' + sep + '"]', { timeout: 8000 });
  const b4 = S.lastLock;
  await p.click('[data-testid="lk-hard-' + sep + '"]'); await p.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 });
  await p.click('[data-testid="confirm-cancel"]'); await p.waitForTimeout(300);
  ok(S.lastLock === b4, 'close for good: Cancel sends nothing');
  await p.click('[data-testid="lk-hard-' + sep + '"]'); await p.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 });
  await p.click('[data-testid="confirm-ok"]');
  await p.waitForFunction((n) => /Closed for good/.test(document.querySelector('[data-testid="lk-state-' + n + '"]').textContent), sep, { timeout: 8000 }).catch(() => {});
  ok(S.lastLock !== b4 && S.lastLock.body.hard === true && await p.locator('[data-testid="lk-unlock-' + sep + '"]').count() === 0, 'close for good: asked, then sent as a hard lock; a closed month offers nothing more');
  S.locked[+sep] = false; S.hard[+sep] = false;

  /* 7 · packs */
  await p.click('[data-testid="acc-nav-packs"]'); await p.waitForSelector('[data-testid="pk_build"]');
  ok(await p.isDisabled('[data-testid="pk_build"]') && await p.locator('[data-testid="pk_lockfirst"]').count() === 1, 'Packs with no locked month: Make a pack is disabled and "Lock a month first" is a button');
  await p.click('[data-testid="pk_lockfirst"]'); await p.waitForSelector('[data-testid="lk-row-12"]', { timeout: 8000 });
  ok(await p.locator('[data-testid="lk_rows"]').count() === 1, 'the sentence-button opens Month lock');
  S.locked[5] = true; S.locked[6] = true; S.locked[7] = true;
  await p.click('[data-testid="acc-nav-packs"]'); await p.waitForSelector('[data-testid="pk_build"]');
  ok(await p.isDisabled('[data-testid="pk_build"]') && await p.locator('[data-testid="pk_lockfirst"]').count() === 0 && await p.locator('[data-testid="pk_p"] option').count() === 5, 'with locked months the month list holds a placeholder, Whole year and only the locked months; Make a pack stays off until one is chosen');
  await p.selectOption('[data-testid="pk_p"]', '5');
  ok(!(await p.isDisabled('[data-testid="pk_build"]')), 'choosing a locked month turns Make a pack on');
  await p.click('[data-testid="pk_build"]');
  await p.waitForSelector('[data-testid="pack-get-pk1"]', { timeout: 8000 });
  /* ⚠️⚠️ review M10 — "We have it" before anything came down in this session: the owner is asked; Cancel sends nothing */
  await p.click('[data-testid="pack-ack-pk1"]');
  await p.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 4000 }).catch(() => {});
  const asked = await p.locator('[data-testid="confirm-cancel"]').count() === 1;
  await p.click('[data-testid="confirm-cancel"]', { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300);
  ok(asked && S.acks.length === 0 && !S.packs[0].acknowledged_at, '"We have it" with nothing downloaded asks first — Cancel acknowledges nothing');
  let dl = null, dlBytes = Buffer.alloc(0);
  try { [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-testid="pack-get-pk1"]')]); dlBytes = fs.readFileSync(await dl.path()); } catch (_) {}
  /* MOVED (2026-09-30): this asserted that Download saved the MANIFEST as pack-pk1.json — the fault itself (M10).
     Download now brings the pack FILE from /api/books/packs/:id/file; the manifest is still shown on the screen (next line). */
  ok(!!dl && /\.zip$/.test(dl.suggestedFilename()) && dlBytes.equals(ZIP) && S.fileGets === 1, 'Download brings the pack FILE — the zip at /api/books/packs/pk1/file, byte for byte (' + (dl ? dl.suggestedFilename() : 'no download') + ')');
  ok(/gl\.json/.test(await p.textContent('[data-testid="pack-manifest"]').catch(() => '')), 'the manifest is shown: file names and fingerprints');
  await p.click('[data-testid="pack-ack-pk1"]');
  await p.waitForFunction(() => !document.querySelector('[data-testid="pack-ack-pk1"]'), null, { timeout: 8000 }).catch(() => {});
  ok(!!S.packs[0].acknowledged_at && await p.locator('[data-testid="pack-ack-pk1"]').count() === 0, 'acknowledged: the button becomes the date');
  ok(S.acks.length === 1 && await p.locator('[data-testid="confirm-ok"]').count() === 0, 'after the download in this session, "We have it" is a plain yes — no question');
  await p.evaluate(() => { try { closeModal(); } catch (_) {} });
  /* a pack made while storage was not connected has NO file: it says so, and offers neither Download nor We have it */
  S.nextPackNoFile = true;
  await p.selectOption('[data-testid="pk_p"]', '6'); await p.click('[data-testid="pk_build"]');
  await p.waitForSelector('[data-testid="pack-pk2"]', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('[data-testid="pack-nofile-pk2"]').count() === 1 && await p.locator('[data-testid="pack-get-pk2"]').count() === 0 && await p.locator('[data-testid="pack-ack-pk2"]').count() === 0,
    'a pack with no file says "' + (await p.textContent('[data-testid="pack-nofile-pk2"]').catch(() => '—')).trim() + '" and offers neither button');
  /* an older list that does not say: the question is asked of GET /packs/:id before anything is acknowledged */
  S.nextPackHide = true;
  await p.selectOption('[data-testid="pk_p"]', '7'); await p.click('[data-testid="pk_build"]');
  await p.waitForSelector('[data-testid="pack-ack-pk3"]', { timeout: 8000 }).catch(() => {});
  await p.click('[data-testid="pack-ack-pk3"]').catch(() => {});
  await p.waitForSelector('[data-testid="pack-nofile-pk3"]', { timeout: 8000 }).catch(() => {});
  ok(S.acks.indexOf('pk3') < 0 && await p.locator('[data-testid="pack-nofile-pk3"]').count() === 1 && await p.locator('[data-testid="pack-get-pk3"]').count() === 0 && await p.locator('[data-testid="confirm-ok"]').count() === 0,
    'a pack whose row does not say: GET /packs/:id answers has_file false → not acknowledged, the row says so');
  await p.evaluate(() => { try { closeModal(); } catch (_) {} });
  S.nextPackNoFile = false; S.nextPackHide = false;
  /* the Whole year option: the API needs no locked month for a year pack, so it is always on offer and sends kind year */
  const nP = S.packs.length;
  await p.selectOption('[data-testid="pk_p"]', 'year');
  ok(!(await p.isDisabled('[data-testid="pk_build"]')), 'Whole year turns Make a pack on');
  await p.click('[data-testid="pk_build"]');
  await p.waitForFunction((n) => true, nP).catch(() => {}); for (let i = 0; i < 40 && S.packs.length === nP; i++) await p.waitForTimeout(100);
  ok(S.packs.length === nP + 1 && S.packs[nP].kind === 'year' && !S.packs[nP].period, 'Whole year sends a year pack (kind year, no month)');
  await shot(p, '6-packs');
  await noAccounting(p, 'packs');

  /* 8 · opening balances + a shop ledger */
  /* the Opening balances page (cap-opening.js) is walked against the real api by e2e/opening-live.cjs; the mock here only proves the door opens it */
  await p.click('[data-testid="acc-nav-opening"]'); await p.waitForSelector('[data-testid="ob-root"], [data-testid="ob-err"]');
  await p.click('[data-testid="acc-nav-accounts"]'); await p.waitForSelector('[data-testid="ac_add"]');
  await p.fill('[data-testid="ac_name"]', 'Shop repairs'); await p.click('[data-testid="ac_add"]');
  await p.waitForTimeout(500);
  ok(S.addedAccount && S.addedAccount.name === 'Shop repairs' && S.addedAccount.parent_code === '6000', 'shop ledger added under its group');

  /* 9 · supplier record: the same block, with Pay */
  await p.goto(base + '/app.html#/app'); await p.waitForSelector('[data-testid="nav-suppliers"]', { timeout: 20000 });   /* back from CB Accounts to the app */
  await p.click('[data-testid="nav-suppliers"]');
  await p.waitForSelector('[data-testid="party-due-s1"]', { timeout: 15000 });
  ok(/2,500/.test(await p.textContent('[data-testid="party-due-s1"]')) && /You owe/.test(await p.getAttribute('[data-testid="party-due-s1"]', 'title')), 'supplier row: you owe 2,500');
  ok(await p.locator('#tbl_suppliers .lhead').count() === 1 && await p.locator('[data-testid="sup-row-sl1"].lrow').count() === 1 && /P-00003/.test(await p.textContent('[data-testid="party-no-s1"]')), 'the Suppliers list is the Task table too, with the Party no (P-00003)');
  ok(/Agro Mills is not on the network/.test(await p.getAttribute('[data-testid="sup-row-sl1"] [data-testid="party-onesided"]', 'title').catch(() => '')), 'a one-sided supplier shows it quietly, the reason on hover');
  await p.click('[data-testid="sup-details-sl1"]');
  await p.waitForSelector('[data-testid="party-books-s1"] [data-testid="party-pay"]', { timeout: 15000 });
  await p.waitForTimeout(700); await shot(p, '5-supplier-record');
  ok(/Pay/.test(await p.textContent('[data-testid="party-books-s1"] [data-testid="party-pay"]')), 'a supplier\'s action says Pay');

  /* 10 · phone first: the Day book at 390 — the tapped view replaces the rail, nothing scrolls sideways */
  {
    const S2 = standIn();
    const { ctx: c2, p: p2 } = await open(S2, 390);
    await ledgerGo(p2);
    await p2.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 });
    await p2.click('[data-testid="acc-nav-daybook"]');
    await p2.waitForSelector('[data-testid="cbl-notes-daybook"]', { timeout: 15000 }).catch(() => {});
    await p2.click('[data-testid="cbl-notes-daybook"]').catch(() => {});   /* the strip and the notices fold into one chip on a phone */
    ok(await p2.locator('[data-testid="strip-counter-C1"]').isVisible().catch(() => false) && await p2.locator('[data-testid="todo-accept"]').isVisible().catch(() => false), 'phone: tapping Day book shows the strip and the to-do (the detail replaces the rail)');
    ok(await p2.evaluate(() => document.documentElement.scrollWidth) === 390, 'document.scrollWidth === 390 at phone width');
    /* (the "way back to the list" was the in-app panel's; CB Accounts is an icon rail at 390 — e2e/cb-accounts.cjs proves it) */
    await p2.screenshot({ path: path.join(__dirname, 'shots', 'daybook-todo-phone.png') });
    /* the views on a phone: cards, one row of chips that scrolls on its own, the gist wrapping, nothing sideways */
    await p2.waitForSelector('#bk_dvlist .lrow[data-no]', { timeout: 8000 });
    const ph = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, head: document.querySelectorAll('#bk_dvlist .lhead').length, n: document.querySelectorAll('#bk_dvlist .lrow[data-no]').length, gist: document.querySelectorAll('#bk_dvlist .cbl-lgist').length }));
    ok(ph.sw === 390 && ph.head === 0 && ph.n > 0 && ph.gist > 0, 'phone: the Day book reads as lines — a record, its fields flowing, the gist under it, no header, scrollWidth === ' + ph.sw);
    await p2.screenshot({ path: path.join(__dirname, 'shots', 'daybook-phone.png') });
    await p2.screenshot({ path: path.join(__dirname, 'shots', 'one-table-daybook-phone.png') });
    await p2.evaluate(() => bkTab('dues')); await p2.waitForSelector('[data-testid="dues-c1"]', { timeout: 8000 });
    await p2.click('[data-testid="dues-c1"]'); await p2.waitForSelector('[data-testid="dues-next-c1"]', { timeout: 5000 }).catch(() => {});
    const pd = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, row: getComputedStyle(document.querySelector('[data-testid="dues-c1"]')).display, head: getComputedStyle(document.querySelector('#bkl_dues .lhead')).display }));
    ok(pd.sw === 390 && pd.row === 'flex' && pd.head === 'none', 'phone: Dues is one card per party, its next level under it, scrollWidth === ' + pd.sw);
    await p2.screenshot({ path: path.join(__dirname, 'shots', 'one-table-dues-phone.png') });
    /* the CRM on a phone: the same three columns, drawn as a card (label : value lines); lines are forced, grid is off */
    /* p2 is on CB Accounts here, and there navTo('customers') leaves for crm.html (IX0: CB_HOMES — a utility page never opens the workshop); the list this
       step measures is the workshop's Customers list, so open the workshop for it */
    await p2.goto(new URL('/app.html#/app', p2.url()).href); await p2.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    await p2.evaluate(() => navTo('customers')); await p2.waitForSelector('[data-testid="cust-row-c1"]', { timeout: 8000 });
    /* a phone's list bar keeps ONE View button; Grid / Lines live inside its popover (list-ctl viewMenuHTML), so open it to read them, then close it */
    await p2.click('[data-testid="cbl-view-menu-customers"]'); await p2.waitForSelector('[data-testid="view-grid-customers"]', { timeout: 5000 });
    const pc = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, row: getComputedStyle(document.querySelector('[data-testid="cust-row-c1"]')).display, labelled: document.querySelectorAll('[data-testid="cust-row-c1"] .lcell[data-l]').length, gridOff: document.querySelector('[data-testid="view-grid-customers"]').disabled, linesOn: document.querySelector('[data-testid="view-lines-customers"]').getAttribute('aria-pressed') }));
    ok(pc.sw === 390 && pc.row === 'flex' && pc.labelled === 3, 'phone: the CRM shows its three columns as label : value lines in a card (a container query, not the page width), scrollWidth === ' + pc.sw + ', ' + pc.labelled + ' labelled');
    await p2.click('[data-testid="cbl-view-menu-customers"]');
    await p2.screenshot({ path: path.join(__dirname, 'shots', 'one-table-crm-phone.png') });
    await c2.close();
  }

  /* 11 · the zero day: no sales today, nothing waiting — one quiet line, and the walk-in note */
  {
    const S0 = standIn();
    S0.noToday = true; S0.waiting = []; S0.serverCheques = []; S0.items.c1 = [];
    const { ctx: c0, p: p0 } = await open(S0);
    await p0.waitForSelector('[data-testid="nav-task"]', { timeout: 15000 });
    await ledgerGo(p0);
    await p0.waitForSelector('[data-testid="db-entry-JV/2026-27/000001"]', { timeout: 15000 });
    await p0.waitForSelector('[data-testid="todo-none"]', { timeout: 8000 }).catch(() => {});
    ok(/Nothing waiting on you/.test(await p0.textContent('[data-testid="todo-none"]').catch(() => '')), 'all zero → one quiet line: Nothing waiting on you');
    ok(await p0.locator('[data-testid="todo-accept"]').count() === 0 && await p0.locator('[data-testid="todo-overdue"]').count() === 0
      && await p0.locator('[data-testid="todo-cheques"]').count() === 0 && await p0.locator('[data-testid="todo-waiting"]').count() === 0, 'a count at zero earns no row');
    ok(await p0.locator('[data-testid^="strip-counter-"]').count() === 0, 'no sales today → no counter chips');
    ok(await p0.locator('[data-testid="strip-noclose"]').count() === 1 && /close the day on the counter/.test(await p0.textContent('[data-testid="strip-noclose"]').catch(() => '')),
      'no walk-in day entry for today → the muted sentence: Walk-ins not closed yet');
    await p0.screenshot({ path: path.join(__dirname, 'shots', 'daybook-todo-empty.png') });
    await noAccounting(p0, 'day book, zero day');
    await c0.close();
  }

  const mine = threw.filter((m) => /bk|party|pay|books|ledger/i.test(m));
  ok(...C.finish());
  ok(mine.length === 0, 'no page error from the Ledger code' + (mine.length ? ' — ' + mine.join(' | ') : ''));
  if (threw.length) console.log('  (other page errors, not the Ledger: ' + threw.length + ' — ' + threw.slice(0, 3).join(' | ').slice(0, 300) + ')');
  await ctx.close(); await b.close(); srv.close();
  console.log('\n  books-web: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); console.log('  XX  the harness stopped: ' + String(e.message).split('\n')[0]); console.log('\n  books-web: ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
