'use strict';
/**
 * acc355-buyer-credit.test.cjs — ACC-355: a bill I received posts input tax unless MY shop said it may not claim it.
 * An unregistered or composition buyer's purchase events carry input_credit:false (the engine then puts the tax in the cost);
 * a regular buyer's events are untouched; an UNKNOWN buyer (DEC-267, EL-TAX F1) claims nothing: a purchase with claimable tax waits with the registration question, a bill with no tax posts as before; a queued verdict is untouched.
 * Hand (AU): A$1,100.00 inc GST = A$1,000.00 + A$100.00 GST: before, an unknown buyer posted Dr input tax A$100 (1B A$100, BAS refund overstated by A$100); now it waits, posts nothing.
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
  for (const word of ['regular', null])
    await it(String(word) + ' buyer: nothing added', async () => {
      asShop(word);
      assert.ok(!('input_credit' in (await H.withBuyerCredit('e1', bill())).event));
    });
  const taxed = () => { const event = { type: 'purchase_bill', ref: 'B-1', by_rate: [{ rate: 10, taxable: 100000, gst: 10000 }] }; return { kind: 'post', event, events: [event] }; };
  await it('unknown buyer, AU bill A$1,100 with A$100 GST: waits with the registration question, claims nothing', async () => {
    asShop('unknown');
    const v = await H.withBuyerCredit('e1', taxed(), 'AU');
    assert.strictEqual(v.kind, 'queue');
    assert.ok(v.code && /registered for GST/.test(v.why), v.why);
  });
  await it('unknown buyer, a bill with no tax in it: posts as before', async () => {
    asShop('unknown');
    const v = await H.withBuyerCredit('e1', bill(), 'AU');
    assert.strictEqual(v.kind, 'post');
  });
  await it('a queued verdict passes through', async () => {
    asShop('unregistered');
    const q = { kind: 'queue', why: 'x' };
    assert.strictEqual(await H.withBuyerCredit('e1', q), q);
  });
  console.log(pass + ' checks');
})();
