/**
 * tests/chit-sheet-captured.test.cjs — F10: MY counter receipt that carries their bill no. + total is read by the popup as a SUPPLIER BILL:
 * who and which bill (theirs), their total, its step is my own copy's, Accept without the use question (no Goods in, no Dispute — the goods
 * were counted at my door and nobody else holds it). What the server said about it on the Books Waiting list (a gap, an unknown supplier)
 * greys Accept with that sentence; "Who is …" adds the supplier door. A receipt without their bill stays a receipt.
 * Run: node tests/chit-sheet-captured.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
globalThis.counterWord = () => '';
globalThis.chitIsSelf = (en) => en === 'me';
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8')); /* esc · fmtMoney: the page loads it before the sheet */
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'chit-sheet.js'), 'utf8'));
const S = globalThis.CBSheet;
/* STD1: the SERVER names the document (the chit read's `doc`, api lib/folder-inventory docOf: a receipt whose their_bill holds a number AND a total is a bill_received) - the sheet no longer guesses it, so the fixture says it the way the server does */
const docOf = (bj) => { const tb = bj && bj.their_bill; return tb && String(tb.no == null ? '' : tb.no).trim() !== '' && String(tb.total == null ? '' : tb.total) !== '' ? 'bill_received' : 'receipt'; };
const rcpt = (bj, st) => ({ doc: docOf(Object.assign({ their_bill: { no: 'SG-101', total: 1180 } }, bj || {})), header: { chit_id: 'r1', purpose: 'receipt', current_status: st || 'pending', created_at: '2026-10-13T05:00:00Z',
  all_recipients: [{ role: 'sender', display_name: 'Mayur Stores', entity_id: 'me' }, { role: 'receiver', display_name: 'self', entity_id: 'me' }],
  summary_json: { total_value: 1000, currency_code: 'INR' },
  business_json: Object.assign({ doc: 'receipt', doc_no: 'G/C1/0001', till: { id: 'C1' }, party: { name: 'Sri Ganesh Provisions' }, their_bill: { no: 'SG-101', total: 1180 } }, bj || {}) },
  detail: { line_items: [{ particulars: 'Rice 25kg', quantity: 10, price: 100, total: 1000, gst_rate: 18 }] } });

const m = S.model(rcpt());
assert.strictEqual(m.captured, true, 'a receipt with their bill no. and total is captured');
assert.strictEqual(m.billRx, true, '…a bill I received');
assert.strictEqual(m.counterBill, false, '…never my counter sale (it has a till, but it is their bill)');
assert.strictEqual(m.no, 'SG-101', 'the number is THEIR bill number');
assert.strictEqual(m.who, 'Sri Ganesh Provisions', 'who is the supplier the door named');
assert.strictEqual(m.money.total, 1180, 'the money it carries is their total, read (the server taxes the lines when it posts)');
assert.strictEqual(S.titleFor(m), 'Supplier bill');
assert.strictEqual(m.status, 'pending', 'its step is my own copy\'s status');
assert.deepStrictEqual(S.actionsFor(m), ['accept', 'reject', 'page'], 'Accept · Reject (FX-F10W2: with a reason) · Open page — no Goods in, no Dispute');
assert.deepStrictEqual(S.actionsFor(S.model(rcpt({}, 'accepted'))), ['page'], 'accepted → nothing more to accept');

const plain = S.model(rcpt({ their_bill: { no: null, date: null, total: null } }));
assert.strictEqual(plain.captured, false, 'without their bill it stays a receipt');
assert.strictEqual(plain.billRx, false, '…not a bill to accept (its reading is unchanged)');

/* STD1 (61b60c26): what the books wait on rides the chit READ itself (books_wait: todo · why · name) and the verdict on Accept is the read's actions.accept {ok, say} - the sheet no longer looks the chit up on the Waiting list. The stand-in serves both the way the server does */
let served = { books_wait: { todo: 'gap', why: 'Their bill SG-101 says ₹1,300, the lines counted come to ₹1,180 — ₹120 apart. Ask Sri Ganesh Provisions to correct it, or reject it and record their bill by hand.' }, actions: { accept: { ok: false, say: 'Their bill SG-101 says ₹1,300, the lines counted come to ₹1,180 — ₹120 apart. Ask Sri Ganesh Provisions to correct it, or reject it and record their bill by hand.' } } };
let html = '';
/* the page seats a <dialog> (seat: open/close/parentNode/classList) before it paints: the stand-in keeps that much of a dialog's state */
const dlg = { open: false, parentNode: null, classList: { toggle() {}, add() {}, remove() {} }, close() { this.open = false; }, showModal() { this.open = true; }, show() { this.open = true; }, setAttribute() {}, removeAttribute() {}, addEventListener() {}, querySelector: (q) => (q === '.cs-acts' ? { set innerHTML(v) { html = v; } } : { set innerHTML(v) {}, appendChild() {}, textContent: '' }) };
globalThis.document = { getElementById: (id) => (id === 'chitsheet' ? dlg : null), body: { contains: () => true, classList: { toggle() {} }, appendChild(n) { n.parentNode = this; } }, documentElement: { style: {} } };
globalThis.api = async () => Object.assign(rcpt(), served);
S.open('r1').then(() => {
  assert(/data-testid="cs-act-accept"[^>]* disabled title="Their bill SG-101 says ₹1,300/.test(html), 'a gap: Accept is SHOWN, greyed, with the server\'s sentence (both figures)');
  served = { books_wait: { todo: 'add_supplier', name: 'Sri Ganesh', why: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-101 waits for you to accept it.', candidates: [] }, actions: { accept: { ok: false, say: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-101 waits for you to accept it.' } } };
  return S.open('r1');
}).then(() => {
  assert(/cs-act-supplier/.test(html) && /cs-act-accept"[^>]* disabled/.test(html), 'an unknown supplier: Add supplier is offered, Accept greyed with "Who is …"');
  served = { books_wait: { todo: 'accept', why: 'Waiting for you to confirm the goods were received (bill SG-101 from Sri Ganesh Provisions)' }, actions: { accept: { ok: true } } };
  return S.open('r1');
}).then(() => {
  assert(/cs-act-accept"(?![^>]*disabled)/.test(html) && !/cs-act-supplier/.test(html), 'waiting for acceptance: Accept is live');
  console.log('chit-sheet-captured: all ok');
}).catch((e) => { console.error(e); process.exit(1); });
