/**
 * ctr-187-return-on-credit.test.cjs — CTR-187: A RETURN ON AN ON-CREDIT BILL OFFERS "Reduce what they owe" FIRST.
 *
 * The business run (BUSINESS-READY-O2C 2026-11-01, S5): 2 boxes back from a customer who owed 6,800 paid 2,360 out of the drawer and the
 * receivable stayed at 6,800 (expected 4,440). The return sheet now takes the whole note off what they owe when it fits, and sends
 * refund.parts [] with the customer on it; lib/books-hooks.js (untouched) classifies that as a `return` against the party with no refund.
 *
 * The page functions are cut out of tools/tally-connector/till.html and run here against stand-ins for the few page globals they read.
 * Expectations are hand-computed: input -> expected -> actual (the asserts print both).
 * Run: node tests/ctr-187-return-on-credit.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
function grab(name) {
  let i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = SRC.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not on the page');
  const j = SRC.indexOf('\n}\n', i + 1);
  const one = SRC.indexOf('\n', i + 1);
  /* a one-line function ends on its own line */
  return /\}\s*$/.test(SRC.slice(i + 1, one)) && !/\{\s*$/.test(SRC.slice(i + 1, one)) ? SRC.slice(i + 1, one) : SRC.slice(i + 1, j + 2);
}
const BODY = ['retPriorOf', 'retReducedBefore', 'retCustomerOwes', 'retOwedRefusal', 'retOwedFor', 'retHowOptions', 'retPlan', 'retConfirm', 'retCustomerName', 'retPaidBy', 'billHow']
  .map(grab).join('\n') + '\nreturn { retOwedFor, retHowOptions, retPlan, retConfirm, billHow, setPrior: function(p){ RET_PRIOR = p; }, setHow: function(h){ RET_HOW = h; }, said: said };';

/** one counter: the customers the snapshot holds, whether the Ledger is on, what the cashier is told and answers */
function page(opts) {
  const said = [];
  const make = new Function('S', 'booksOn', 'booksMajor', 'CREDIT_SINCE', 'r2', 'money', 'esc', 'toastLine', 'sure', 'said',
    'var RET_OWED = "owed"; var RET_PRIOR = null; var RET_HOW = "";\n' + BODY);
  const api = make({ customers: opts.customers || [] }, () => opts.ledger !== false, (minor) => Number(minor) / 100, opts.since || {},
    (v) => Math.round(v * 100) / 100, (v) => '₹' + v.toFixed(2), (v) => String(v), (m) => said.push(m), async () => opts.confirm !== false, said);
  return api;
}

const KUMAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/* a bill of 6,800 left On credit by Kumar, who owes 6,800 */
const bill = (extra) => Object.assign({ no: 'C1/26-27/0001', at: '2026-11-01T10:00:00Z', total: 6800, kind: 'sale',
  customer: { name: 'Kumar', identity_id: KUMAR }, payments: [{ how: 'On credit', amount: 6800 }] }, extra || {});
const customers = [{ identity_id: KUMAR, balance_minor: 680000 }];

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').slice(0, 3).join('\n      ')); fail++; }
};

(async () => {
  console.log('\nctr-187 · a return on an On-credit bill reduces what they owe');

  await t('input: 2,360 back from an On-credit bill, Kumar owes 6,800 -> offered, fits, refunds [] (expected: no cash leaves the drawer)', async () => {
    const p = page({ customers });
    const owed = p.retOwedFor(bill(), 2360);
    assert.deepStrictEqual([owed.offered, owed.fits, owed.max], [true, true, 6800]);
    const plan = p.retPlan(bill(), 2360, 'owed');
    assert.deepStrictEqual(plan.refunds, []);
    assert.strictEqual(plan.refusal, '');
    assert.ok(/Take ₹2360.00 off what Kumar owes, against C1\/26-27\/0001\?/.test(plan.ask), plan.ask);
  });

  await t('the option comes FIRST in "Back as", selected by default state, and a cash bill never shows it', async () => {
    const p = page({ customers });
    p.setHow('owed');
    const html = p.retHowOptions({ Cash: true }, p.retOwedFor(bill(), 0));
    assert.ok(html.indexOf('Reduce what they owe') < html.indexOf('>Cash<'), html);
    assert.ok(/value="owed" selected/.test(html), html);
    const cashBill = bill({ payments: [{ how: 'Cash', amount: 6800 }] });
    assert.strictEqual(p.retOwedFor(cashBill, 100).offered, false);
    assert.ok(!/owed/.test(p.retHowOptions({ Cash: true }, p.retOwedFor(cashBill, 100))));
  });

  await t('a return bigger than what is owing is NOT split: greyed with its sentence, the cash way stays (whole note or nothing)', async () => {
    const p = page({ customers: [{ identity_id: KUMAR, balance_minor: 100000 }] });         /* they owe only 1,000 now */
    const owed = p.retOwedFor(bill(), 2360);
    assert.deepStrictEqual([owed.offered, owed.fits, owed.max], [true, false, 1000]);
    assert.ok(/They owe ₹1000.00 on this bill, less than this return/.test(owed.sentence), owed.sentence);
    assert.ok(/ disabled>Reduce what they owe/.test(p.retHowOptions({ Cash: true }, owed)));
    const plan = p.retPlan(bill(), 2360, 'owed');
    assert.ok(plan.refusal, 'the till refuses the half-and-half');
    assert.strictEqual(await p.retConfirm(plan), false);
    assert.ok(p.said.some((m) => /less than this return/.test(m)));
  });

  await t('earlier notes count: 2,000 already taken off a 6,800 bill leaves 4,800', async () => {
    const p = page({ customers });
    p.setPrior({ 'C1/26-27/0001': [{ total: -2000, refunds: [] }, { total: -500, refunds: [{ how: 'Cash', amount: 500 }] }] });
    assert.strictEqual(p.retOwedFor(bill(), 100).max, 4800);       /* the cash note took nothing off the debt */
    assert.strictEqual(p.retOwedFor(bill(), 4800).fits, true);
    assert.strictEqual(p.retOwedFor(bill(), 4800.5).fits, false);
  });

  await t('no customer on the bill, or the Ledger off: offered but greyed, with the sentence', async () => {
    const p = page({ customers });
    const anon = p.retOwedFor(bill({ customer: { name: 'Walk-in' } }), 100);
    assert.deepStrictEqual([anon.offered, anon.fits], [true, false]);
    assert.ok(/no customer the shop knows/.test(anon.sentence), anon.sentence);
    const off = page({ customers, ledger: false }).retOwedFor(bill(), 100);
    assert.ok(!off.fits && /Ledger is off/.test(off.sentence), off.sentence);
  });

  await t('a snapshot with no balance leaves the cap at what the bill itself says, and the words stay hedged', async () => {
    const p = page({ customers: [{ identity_id: KUMAR }] });
    const owed = p.retOwedFor(bill(), 2360);
    assert.ok(owed.fits && owed.max === 6800);
    assert.ok(/as far as this counter knows/.test(owed.sentence), owed.sentence);
  });

  await t('the cash way is unchanged: refunds [{how, amount}] and the same words', async () => {
    const plan = page({ customers }).retPlan(bill({ payments: [{ how: 'Cash', amount: 6800 }] }), 100, 'Cash');
    assert.deepStrictEqual(plan.refunds, [{ how: 'Cash', amount: 100 }]);
    assert.ok(/^Give back ₹100.00 in Cash against/.test(plan.ask));
  });

  await t('the bills list names a note that paid nothing back, and the paper does not say "in Cash"', async () => {
    const p = page({ customers });
    assert.deepStrictEqual(p.billHow({ kind: 'credit_note', total: -2360, refunds: [] }), [{ how: 'Off what they owe', amount: 2360 }]);
    assert.deepStrictEqual(p.billHow({ kind: 'credit_note', total: -100, refunds: [{ how: 'Cash', amount: 100 }] }), [{ how: 'Cash', amount: 100 }]);
    assert.ok(/'Taken off what you owe'/.test(SRC));
  });

  /* ⭐ the books side, untouched: the body the sheet now sends, through the real classify() */
  await t('books-hooks classifies refund.parts [] + the customer as a return against the party, no cash', async () => {
    const H = require('./support/books-harness.cjs'); H.load();
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
    const inv = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 2000, CgstAmt: 180, SgstAmt: 180, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 2360 } };
    const note = (parts) => K.classify({ chit: { chit_id: 'c9', created_at: '2026-11-01T05:00:00Z', purpose: 'credit_note',
      business_json: { till: { id: 'C1' }, bill_no: 'C/C1/26-27/0001', against: { bill_no: 'C1/26-27/0001' }, customer: { name: 'Kumar', identity_id: KUMAR },
        refund: { parts, total: 2360 } } }, entry: { sells: true, invoice: inv }, setting: S });
    const reduced = note([]);
    assert.strictEqual(reduced.kind, 'post', reduced.why);
    assert.deepStrictEqual([reduced.event.type, reduced.event.party, reduced.event.refund], ['return', KUMAR, undefined]);
    const cash = note([{ how: 'Cash', amount: 2360 }]);
    assert.deepStrictEqual([cash.event.type, cash.event.refund], ['return', { cash: 2360 }]);
  });

  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
