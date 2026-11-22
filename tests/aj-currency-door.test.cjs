/**
 * aj-currency-door.test.cjs - AJ-F-02 (walk AJ, 21 Nov 2026): an invoice from an AED shop in USD, EUR or "XXX" was answered 200 and booked as AED at face value, because the send door read the stated money
 * from business_json.currency ONLY and dropped a body's own `currency_code` / `currency`. ONE reader now (routes/chits sendBody): the code stated anywhere on the body is carried onto the chit as business_json.currency
 * (carry, never relabel: DEC-073/074, ACC-377), an unknown code ("XXX") is refused in words (422 MONEY_CURRENCY_UNKNOWN), two different codes are refused (422 MONEY_CURRENCY_MISMATCH).
 * Hand: USD 100.00 at the walk's rate 3.6725 -> 367.25 AED (the books' ONE fx engine, tests/ai-usd-order-fx.test.cjs); EUR the same door, any ISO code the same.
 * Run: node tests/aj-currency-door.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const chits = require(path.join(__dirname, '..', 'routes', 'chits'));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e)); } };
const answer = () => ({ locals: {}, statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } });
async function door(body) {
  const st = {}, res = answer();
  const out = await chits.sendBody(st, { body: Object.assign({ purpose: 'invoice', line_items: [{ particulars: 'Dates', quantity: 10, price: 10 }] }, body), id: 'req-1' }, res);
  return { st, res, refused: !!out };
}
(async () => {
  for (const code of ['USD', 'EUR', 'GBP', 'JPY']) {
    await t(code + ' stated on the body (currency_code) is CARRIED onto the chit, not dropped', async () => {
      const o = await door({ currency_code: code.toLowerCase() });
      assert.strictEqual(o.refused, false);
      assert.strictEqual(o.st.currency_code, code);
      assert.strictEqual(o.st.business_json.currency, code);
    });
  }
  await t('`currency` on the body reads the same; business_json.currency alone still works; the same code twice is one statement', async () => {
    assert.strictEqual((await door({ currency: 'EUR' })).st.currency_code, 'EUR');
    assert.strictEqual((await door({ business_json: { currency: 'EUR' } })).st.currency_code, 'EUR');
    assert.strictEqual((await door({ currency_code: 'eur', business_json: { currency: 'EUR', bill_no: 'X1' } })).st.business_json.bill_no, 'X1');
  });
  await t('an unknown code "XXX" (and a 3-letter fake) is refused in words, from either slot', async () => {
    for (const body of [{ currency_code: 'XXX' }, { currency: 'ZZZ' }, { business_json: { currency: 'XXX' } }]) {
      let err = null;
      try { await door(body); } catch (e) { err = e; }
      assert.ok(err && err.code === 'MONEY_CURRENCY_UNKNOWN' && err.status === 422, JSON.stringify(body) + ' -> ' + (err && err.code));
    }
  });
  await t('two different codes (body USD, business_json EUR) are refused, never one picked', async () => {
    const o = await door({ currency_code: 'USD', business_json: { currency: 'EUR' } });
    assert.strictEqual(o.refused, true);
    assert.strictEqual(o.res.statusCode, 422);
    assert.strictEqual(o.res.body.code, 'MONEY_CURRENCY_MISMATCH');
  });
  await t('no money stated: nothing is invented here (the sender\'s own money is read later by sendPrefs)', async () => {
    const o = await door({});
    assert.strictEqual(o.st.currency_code, null);
  });
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
