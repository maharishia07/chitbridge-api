/**
 * con-98-adapter-total.test.cjs — CON-98 (ACC-206): the GoFrugal and Tally adapters write the voucher at the ONE bill total the core hands them
 * (order.total), never at a sum of their own, and the core sends an order to the outside system once.
 * Proves: a GoFrugal sales order and a Tally sales voucher carry the same total for an IN bill (GST in the price) and an AU bill (GST on top) ·
 * a line sum that differs from the total never wins · the same order pushed twice (a sync retry after the till came back online) reaches the
 * adapter once · the kit's counter-bill.js is a byte copy of lib/counter-bill.js (vendored, never edited by hand).
 * Run: node tests/con-98-adapter-total.test.cjs
 * CARD      23-connectors-and-integrations/tally-connector
 * UNIT      tools/tally-connector/adapters/gofrugal.js, tools/tally-connector/adapters/tally.js, tools/tally-connector/counter-bill.js
 * MIN walk · offline-sync-once · country-bill · vendored-byte-equal
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../tools/tally-connector/core.js');
const gofrugal = require('../tools/tally-connector/adapters/gofrugal.js');
const tally = require('../tools/tally-connector/adapters/tally.js');

let pass = 0;
async function check(what, body) { try { await body(); pass++; console.log('  ok  ' + what); } catch (failure) { console.log('  FAIL ' + what + '\n      ' + failure.message); process.exitCode = 1; } }

/* the outside system is a stub: GET lists one item, POST records the sales order it was given */
const posted = [];
global.fetch = async (url, init) => {
  const isPost = init && init.method === 'POST';
  if (isPost) posted.push(JSON.parse(init.body));
  const reply = isPost ? { result: { status: 'Success', id: 'S1' } } : { items: [{ itemId: 7, itemName: 'Rice', itemReferenceCode: 'RICE', stock: [{ stock: 5, salePrice: 50 }] }] };
  return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
};

const billFor = (total, currency) => ({ chit_id: 'bbbbbbbb-2222', purpose: 'order', currency, buyer: 'Asha', total, lines: [{ name: 'Rice', code: 'RICE', qty: 2, price: 50, total: 100 }] });

(async () => {
  for (const [country, currency, total] of [['IN', 'INR', 118], ['AU', 'AUD', 110.55]]) {
    await check(country + ' bill: GoFrugal books the sales order at the bill total (' + total + '), not the line sum (100)', async () => {
      posted.length = 0;
      await gofrugal({ gofrugal: { url: 'http://till.local' } }).pushOrder(billFor(total, currency));
      assert.strictEqual(posted[0].salesOrder.totalAmount, total);
    });
    await check(country + ' bill: the Tally sales voucher carries the bill total (' + total + '), not the line sum (100)', async () => {
      const xml = tally.builders.voucherXML(billFor(total, currency), { partyLedger: 'Cash', salesLedger: 'Sales', voucherType: 'Sales' });
      assert.ok(xml.includes('<AMOUNT>-' + total + '</AMOUNT>'), 'the party is not debited the bill total ' + total);
    });
  }

  await check('offline then sync: the same order pushed twice reaches GoFrugal once', async () => {
    posted.length = 0;
    const rows = [];
    const receipts = { last: (kind, ref) => rows.filter((row) => row.kind === kind && row.ref === ref).pop() || null, add: (row) => rows.push(row) };
    const chit = { header: { chit_id: 'bbbbbbbb-2222', purpose: 'order', current_status: 'accepted', summary_json: { money: { total: 118 } }, business_json: { invoice: { ValDtls: { TotInvVal: 118 } } } },
      detail: { line_items: [{ name: 'Rice', quantity: 2, price: 50, total: 100, ref: { code: 'RICE' } }] } };
    const cb = { policy: { books_at: 'received' }, owns: () => true, chit: async () => chit, invoice: async () => ({}), call: async () => ({}), log: () => {} };
    const adapter = gofrugal({ gofrugal: { url: 'http://till.local' } });
    const args = { cb, adapter, receipts, log: () => {}, chit_id: 'bbbbbbbb-2222' };
    const first = await core.pushOrder(args);
    const again = await core.pushOrder(args);
    assert.strictEqual(first.outcome, 'ok', JSON.stringify(first));
    assert.strictEqual(again.outcome, 'duplicate');
    assert.strictEqual(posted.length, 1, 'the order was sent twice');
    assert.strictEqual(posted[0].salesOrder.totalAmount, 118);
  });

  await check('the kit copy of counter-bill.js is byte-identical to lib/counter-bill.js (vendored, never hand-edited)', async () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
    assert.strictEqual(read('tools/tally-connector/counter-bill.js'), read('lib/counter-bill.js'));
  });

  console.log(pass + ' passed' + (process.exitCode ? ' (with failures)' : ''));
})();
