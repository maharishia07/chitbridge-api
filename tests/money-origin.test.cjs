/* ⚠️ CRLF-tolerant: a Windows checkout hands back \r\n */
/**
 * ACC-192 — MONEY IS COMPUTED ONCE, WHERE IT ORIGINATES (Athi, 2026-10-02 and 2026-10-25: "the computation happens in only one place where it
 * originates, rest of the places it just displays it as a record … if any computation happens other than the origin it is the blunder").
 * ONE path for every chit, the counter bill's: the invoice travels in business_json.invoice, the header's money is mapped off it, and every
 * copy (local, books, the far installation over CTP) reads that record. SIT 2026-10-25 found ordinary chits recomputed by each copy's books.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const chits = require('../tools/chits-files.cjs').read(path.join(__dirname, '..')); /* the ONE list of chits files */
const copy = read('lib/tax-copy.js');
const fnBody = (src, sig) => { const d = src.slice(src.indexOf(sig)); return d.slice(0, d.indexOf('\n}\n') + 1); };

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};

console.log('\n══ MONEY AT THE ORIGIN (ACC-192) ══\n');
const money = fnBody(chits, 'async function sendMoney(');
const sendMoneyLib = read('lib/send-money.js');
const proposal = read('lib/chit-proposal.js');
const issued = fnBody(chits, 'async function sendIssued(');

ok('the sender\'s invoice travels with the chit (business_json.invoice), unless one is already carried or it is a draft', () => {
  assert.ok(/originInvoice: invoice/.test(money) && /await sendMoneyScope\.invoiceAtSend\(/.test(money), 'sendMoney must hand over the invoice the engine answered at send (lib/send-money)');
  assert.ok(/business_json\.invoice = sendState\.originInvoice/.test(issued), 'sendIssued must carry it with the chit');
  assert.ok(/!business_json\.invoice && sendState\.originInvoice && !is_draft/.test(issued), 'never over a carried invoice, never on a draft');
});
ok('ONE calculation on every path: a send and a change order (RAIL-106) both ask lib/send-money invoiceOfLines; no route keeps a second one', () => {
  assert.ok(/return invoiceOfLines\(/.test(fnBody(sendMoneyLib, 'async function invoiceAtSend(')), 'invoiceAtSend must be the send door of invoiceOfLines');
  assert.ok(/require\('\.\/send-money'\)\.invoiceOfLines\(/.test(fnBody(proposal, 'async function priceMoney(')), 'a change order must price by the same call');
  assert.ok(!/function moneyOfLines\(|function keepOffer\(/.test(chits), 'no second calculation left in the chits route');
  assert.ok(/total_value: priced2\.block\.total/.test(proposal), 'a change order\'s total_value is the engine total, never the net');
});
ok('ONE rule on every path (Athi 2026-11-02, "refuse both"): a change order the engine cannot price is refused like a send, 503 MONEY_NOT_COMPUTED, never "Tax not decided"', () => {
  const price = fnBody(proposal, 'async function priceMoney(');
  assert.ok(/throw refused\(503, 'MONEY_NOT_COMPUTED', 'The money could not be worked out: '/.test(price), 'priceMoney must refuse in the send words');
  assert.ok(/'MONEY_NOT_COMPUTED', error: 'The money could not be worked out', message: 'The money could not be worked out: '/.test(money), 'the send refuses the same way');
  assert.ok(!/not_decided|Tax not decided/.test(proposal), 'no "Tax not decided" round is left in the change order');
});
ok('ACC-191: the header copies the engine tax whole - an undecided tax stays null, no || 0, no Number(), no sum', () => {
  const header = fnBody(chits, 'function moneyOfInvoice(');
  assert.ok(header.includes('tax: money.tax,'), 'moneyOfInvoice must pick money.tax as it is');
  assert.ok(!header.includes('money.tax ||') && !header.includes('money.tax ??') && !header.includes('Number(money.tax') && !header.includes('+ money.cgst'), 'no default 0 over a null tax');
});
ok('EVERY carried invoice is mapped the same way (not only a counter bill\'s)', () => {
  const cond = issued.slice(issued.indexOf('if ('), issued.indexOf('moneyOfInvoice('));
  assert.ok(!/counterBill/.test(cond), 'the mapping must not depend on counterBill');
  assert.ok(/moneyOfInvoice\(carried/.test(issued));
});
ok('only the counter\'s invoice is checked against the server (only it was computed elsewhere)', () => {
  assert.ok(/if \(counterBill && mapped\)/.test(issued));
});
ok('the books read a carried invoice as it is and never recompute it', () => {
  const entry = fnBody(copy, 'async function entryFor(');
  assert.ok(/const frozen = bj\.invoice/.test(entry) && /frozen\s*\n?\s*\? \{ invoice: frozen/.test(entry), 'entryFor must post the carried invoice');
  const freeze = fnBody(copy, 'async function freezeOnComplete(');
  assert.ok(/if \(hdr\.business_json && hdr\.business_json\.invoice\) return hdr\.business_json\.invoice/.test(freeze), 'a carried invoice is never re-stamped');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
