/**
 * tests/tender-sum-1129.test.cjs — P-F-01 (walk P): THE TENDERS OF A BILL ADD UP TO ITS TOTAL, at the api door.
 *
 * OWNS      lib/tender-sum.js verdicts and the step's place in routes/chits.js SEND_STEPS (after sendSupplyKind, before sendBridge) + the code's register row.
 * CALLED BY scripts/guards.cjs · by hand: node tests/tender-sum-1129.test.cjs
 * FLOW      business_json { invoice.ValDtls.TotInvVal, payment { parts, cash_round } } ──▶ tender-sum.verdictOf ──▶ null | refusal | replay-accepted
 * CARD      counter/bill-slip
 * Hand figures in cents (AUD, 2 places): 22.00 = 2200; cash 10.00 = 1000 + card 12.00 = 1200.
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const T = require('../lib/tender-sum');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const NOW = Date.parse('2026-11-21T10:00:00Z');
const bill = (total, parts, round, billedAt) => ({ billed_at: billedAt || new Date(NOW).toISOString(), invoice: { ValDtls: { TotInvVal: total } }, payment: { parts, cash_round: round } });
const run = (b) => T.verdictOf({ business_json: b, currency: 'AUD' }, NOW);

console.log('\n== P-F-01 · tenders add up to the total ==\n');
ok('A$22.00 = cash 10.00 + card 12.00 (2200 = 1000 + 1200) is accepted', () => assert.strictEqual(run(bill(22, [{ how: 'Cash', amount: 10 }, { how: 'Card', amount: 12 }])), null));
ok('A$22.00 with Cash 10.00 only (the walk) is refused: 1200 short, in words', () => {
  const r = run(bill(22, [{ how: 'Cash', amount: 10 }]));
  assert.strictEqual(r.code, 'TENDER_SUM_MISMATCH'); assert.strictEqual(r.expected_minor, 2200); assert.strictEqual(r.tendered_minor, 1000);
  assert.ok(/AUD 12\.00 short/.test(r.why), r.why);
});
ok('over-tendered (cash 10.00 + card 13.00 on 22.00) is refused', () => assert.strictEqual(run(bill(22, [{ how: 'Cash', amount: 10 }, { how: 'Card', amount: 13 }])).code, 'TENDER_SUM_MISMATCH'));
ok('cash rounding: 0.37 kg apples bill 5.99 paid cash 6.00 with cash_round +0.01 (599 + 1 = 600) is accepted', () => assert.strictEqual(run(bill(5.99, [{ how: 'Cash', amount: 6 }], 0.01)), null));
ok('the same cash 6.00 on 5.99 WITHOUT the recorded rounding is refused (600 vs 599)', () => assert.strictEqual(run(bill(5.99, [{ how: 'Cash', amount: 6 }])).code, 'TENDER_SUM_MISMATCH'));
ok('cash 10.00 on 10.02 with cash_round -0.02 (1002 - 2 = 1000) is accepted', () => assert.strictEqual(run(bill(10.02, [{ how: 'Cash', amount: 10 }], -0.02)), null));
ok('On credit is a tender: 22.00 = cash 10.00 + On credit 12.00 is accepted', () => assert.strictEqual(run(bill(22, [{ how: 'Cash', amount: 10 }, { how: 'On credit', amount: 12 }])), null));
ok('float noise: 0.1 + 0.2 on a 0.30 bill is accepted (30 = 10 + 20 in cents)', () => assert.strictEqual(run(bill(0.3, [{ how: 'Cash', amount: 0.1 }, { how: 'Card', amount: 0.2 }])), null));
ok('a part with no amount is refused in words', () => assert.ok(/no amount/.test(run(bill(22, [{ how: 'Cash' }])).why)));
ok('refund of a split bill: a credit note has no payment.parts and is not read', () => assert.strictEqual(run({ invoice: { ValDtls: { TotInvVal: 22 } }, payment: {}, refunds: [{ how: 'Cash', amount: 10 }, { how: 'Card', amount: 12 }] }), null));
ok('no parts / no invoice total: not read here', () => { assert.strictEqual(run({ payment: { parts: [] } }), null); assert.strictEqual(run({ payment: { parts: [{ how: 'Cash', amount: 1 }] } }), null); });
ok('an offline replay (struck 1 hour before) is accepted and said, never wedged', () => {
  const r = run(bill(22, [{ how: 'Cash', amount: 10 }], undefined, new Date(NOW - 3600e3).toISOString()));
  assert.strictEqual(r.accepted, 'replay'); assert.strictEqual(r.code, 'TENDER_SUM_MISMATCH');
});
const src = require('../tools/chits-files.cjs').read(path.join(__dirname, '..')); /* the ONE list of chits files */
ok('SEND_STEPS runs sendTenderSum right after sendSupplyKind, no try around it', () => {
  assert.ok(/sendSupplyKind,\s*sendTenderSum,\s*sendBridge,/.test(src));
  const fn = src.slice(src.indexOf('async function sendTenderSum('), src.indexOf('async function sendReceiptLines('));
  assert.ok(fn.includes("status: 422") && !/\btry\s*\{/.test(fn));
});
ok('the code has its register row', () => assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/error-codes.json'), 'utf8')).codes
  ? JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/error-codes.json'), 'utf8')).codes.some((c) => c.code === 'TENDER_SUM_MISMATCH')
  : fs.readFileSync(path.join(__dirname, '../docs/error-codes.json'), 'utf8').includes('"TENDER_SUM_MISMATCH"')));
console.log(String(pass) + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
