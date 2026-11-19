'use strict';
/**
 * acc355-buyer-credit.test.cjs — ACC-355: a bill I received posts input tax unless MY shop said it may not claim it.
 * An unregistered or composition buyer's purchase events carry input_credit:false (the engine then puts the tax in the cost);
 * a regular buyer's and an unknown buyer's events are untouched (unknown is not false, SET-49); a queued verdict is untouched.
 */
const assert = require('assert');
const setup = require('../lib/country-setup'), H = require('../lib/books-hooks');
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const asShop = (word) => { setup.registrationOfShop = async () => word; };
const bill = () => { const event = { type: 'purchase_bill', by_rate: [] }; return { kind: 'post', event, events: [event, { type: 'payment_made' }] }; };
(async () => {
  for (const word of ['unregistered', 'composition'])
    await it(word + ' buyer: every purchase event carries input_credit:false, a payment does not', async () => {
      asShop(word);
      const v = await H.withBuyerCredit('e1', bill());
      assert.strictEqual(v.event.input_credit, false);
      assert.strictEqual(v.events[0], v.event);
      assert.ok(!('input_credit' in v.events[1]));
    });
  for (const word of ['regular', 'unknown', null])
    await it(String(word) + ' buyer: nothing added', async () => {
      asShop(word);
      assert.ok(!('input_credit' in (await H.withBuyerCredit('e1', bill())).event));
    });
  await it('a queued verdict passes through', async () => {
    asShop('unregistered');
    const q = { kind: 'queue', why: 'x' };
    assert.strictEqual(await H.withBuyerCredit('e1', q), q);
  });
  console.log(pass + ' checks');
})();
