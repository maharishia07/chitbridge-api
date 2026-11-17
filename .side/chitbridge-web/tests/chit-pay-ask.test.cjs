/**
 * tests/chit-pay-ask.test.cjs — FIN-53 (Athi, 2026-10-29, option c): the Mark-paid popup turns the books' one question (409 ALREADY_PAID with
 * warnings: "More than is owed" · "Already paid?") into a deliberate confirm that names the amount over, and Yes re-sends the SAME press with
 * every warning's code acknowledged. Never a toast that asks a question. Any other failure is still a toast.
 * Run: node tests/chit-pay-ask.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
/** one top-level function of app.html by name (its text up to the next top-level function or doc comment) */
function fnSource(name) {
  const at = src.indexOf('\n' + (name === 'chitPaySubmit' ? 'async ' : '') + 'function ' + name + '(');
  assert(at > 0, name + ' is in app.html');
  const rest = src.slice(at + 1);
  const end = rest.search(/\n(?:\/\*\*|async function |function )/);
  return rest.slice(0, end);
}
const calls = { api: [], toasts: [], confirms: [], closed: 0 };
globalThis.PAY_PRESS_REF = 'press-1';
globalThis.tx = (s) => s;
globalThis.esc = (s) => String(s).replace(/</g, '&lt;');
globalThis.toast = (m, bad) => calls.toasts.push([m, !!bad]);
globalThis.closeModal = () => calls.closed++;
globalThis.confirmAsk = (title, body, okLabel, onOk) => calls.confirms.push({ title, body, okLabel, onOk });
globalThis.keepPaymentOnRow = () => undefined;
globalThis.readPayForm = () => ({ method: 'upi', ref: 'U1', amount: 1300 });
let answers = [];
globalThis.api = async (key, req) => { calls.api.push({ key, req }); const a = answers.shift(); if (a instanceof Error) throw a; return a; };
eval(fnSource('chitPayBody') + '\n' + fnSource('chitPaySubmit') + '\n' + fnSource('chitPayAsk') + '\nglobalThis.chitPaySubmit = chitPaySubmit; globalThis.chitPayAsk = chitPayAsk;');

const over = Object.assign(new Error('More than is owed by ₹120. ₹1,300 is more than the ₹1,180 open — ₹120 would be kept as an advance from Mala. Keep ₹120 as an advance?'), {
  status: 409,
  data: { code: 'ALREADY_PAID', error: 'More than is owed', warnings: [{ code: 'excess', over_minor: 12000, over_words: '₹120', words: '₹1,300 is more than the ₹1,180 open — ₹120 would be kept as an advance from Mala.' }] }
});
(async () => {
  answers = [over, { message: 'Payment recorded', payment: { amount: 1300 } }];
  await chitPaySubmit('c1');
  assert.strictEqual(calls.toasts.length, 0, 'the question is never a toast');
  assert.strictEqual(calls.confirms.length, 1, 'one confirm was asked');
  const ask = calls.confirms[0];
  assert.strictEqual(ask.title, 'More than is owed', 'the title is the books\' own (not "Already paid?")');
  assert(/₹120 would be kept as an advance from Mala/.test(ask.body), 'the body is the books\' words');
  assert.strictEqual(ask.okLabel, 'Keep ₹120 as an advance', 'the Yes names the amount over, from the server\'s over_words');
  assert.deepStrictEqual(calls.api[0].req.body, { method: 'upi', ref: 'U1', amount: 1300, client_ref: 'press-1' }, 'the first press carries no acknowledgement');
  await ask.onOk();
  assert.strictEqual(calls.api.length, 2, 'Yes re-sends once');
  assert.deepStrictEqual(calls.api[1].req.body, { method: 'upi', ref: 'U1', amount: 1300, client_ref: 'press-1', acknowledge: [{ code: 'excess', over_minor: 12000 }] }, 'the SAME press (same client_ref, same amount) with the code AND the figure shown acknowledged');
  assert.deepStrictEqual(calls.toasts, [['Payment recorded ✓', false]], 'then the plain outcome');

  /* the same money twice keeps its own title and a Yes that does not name an advance */
  calls.api.length = 0; calls.confirms.length = 0; calls.toasts.length = 0;
  answers = [Object.assign(new Error('Already paid? The same ₹500 was received from Mala today (RV-1).'), { status: 409, data: { error: 'Already paid?', warnings: [{ code: 'same_again', words: 'The same ₹500 was received from Mala today (RV-1).' }] } })];
  await chitPaySubmit('c1');
  assert.strictEqual(calls.confirms[0].title, 'Already paid?');
  assert.strictEqual(calls.confirms[0].okLabel, 'Record it again');
  assert.strictEqual(calls.toasts.length, 0);

  /* any other refusal is still a toast, and no confirm */
  calls.confirms.length = 0;
  answers = [Object.assign(new Error('The tender is on the bill'), { status: 422, data: { code: 'PAYMENT_TENDER_ON_BILL' } })];
  await chitPaySubmit('c1');
  assert.strictEqual(calls.confirms.length, 0, 'a 422 asks nothing');
  assert.deepStrictEqual(calls.toasts, [['The tender is on the bill', true]]);
  /* the Ledger's Receive/Pay sheet (cap-books.js payAckList) sends the same shape: the figure the band showed, else the bare code */
  const books = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-books.js'), 'utf8');
  const at = books.indexOf('\nfunction payAckList(');
  assert(at > 0, 'payAckList is in cap-books.js');
  const body = books.slice(at + 1, at + 1 + books.slice(at + 1).search(/\n(?:\/\*\*|function )/));
  const payAckList = new Function(body + '\nreturn payAckList;')();
  assert.deepStrictEqual(payAckList(['excess', 'same_again'], [{ code: 'excess', over_minor: 382000 }, { code: 'same_again', words: 'x' }]), [{ code: 'excess', over_minor: 382000 }, 'same_again'], 'the sheet acknowledges with the figure it showed');
  assert(/payAckList\(acknowledged, PAY\.preview && PAY\.preview\.warnings\)/.test(books), 'payWrite sends through payAckList');
  console.log('chit-pay-ask: 14 checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
