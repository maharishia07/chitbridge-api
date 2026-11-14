'use strict';
// @type: unit
/**
 * tests/con98-voucher-total-unknown.test.cjs — CON-98: a registered buyer's voucher never takes the order's net as its total.
 *
 * OWNS      the proof that tools/tally-connector/core.js, when the invoice carries no total, (a) b2bOf says the total is UNKNOWN (null)
 *           and names the currency, (b) pushOrder refuses the voucher with a reason — the adapter is never called, no receipt is
 *           written (the next catch-up asks again), the books are told once — and (c) an invoice WITH a total still pushes as before.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: a stub CB and a fake adapter.
 * CARD      23-connectors-and-integrations/tally-connector
 *
 * Run: node tests/con98-voucher-total-unknown.test.cjs
 */
const assert = require('assert'), path = require('path');
const core = require(path.join(__dirname, '..', 'tools', 'tally-connector', 'core.js'));

const CHIT = '44444444-4444-4444-8444-444444444441';
const invoiceWith = (heads) => ({
  invoice: { BuyerDtls: { Gstin: '29ABCDE1234F1Z5', LglNm: 'Kumar Stores', State: '29' }, ItemList: [{ PrdDesc: 'Rice 25 kg', HsnCd: '1006', GstRt: 5, AssAmt: 1000, CgstAmt: 25, SgstAmt: 25 }] },
  heads
});
const chit = { header: { chit_id: CHIT, purpose: 'order', current_status: 'accepted', business_json: {}, summary_json: { total_value: 1000 } },
  detail: { currency_code: 'AUD', line_items: [{ name: 'Rice 25 kg', quantity: 2, unit: 'bag', price: 500, total: 1000 }] } };

function world(inv) {
  const said = [], logged = [], pushed = [], receipts = [];
  const cb = { policy: { books_at: 'accepted' }, chit: async () => chit, invoice: async () => inv, call: async (method, p, body) => { said.push({ method, p, body }); return {}; }, log: () => {} };
  const adapter = { name: 'fake-books', pushOrder: async (order) => { pushed.push(order); return { ref: 'V-1' }; } };
  const store = { last: () => null, add: (row) => receipts.push(row) };
  return { cb, adapter, said, logged, pushed, receipts, run: () => core.pushOrder({ cb, adapter, receipts: store, log: (line) => logged.push(line), chit_id: CHIT }) };
}
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

(async () => {
  console.log('— CON-98: the voucher total is the invoice\'s, or unknown —');
  await it('b2bOf: no invoice total → total is null (unknown) and the currency is carried, never the order total', () => {
    const b2b = core.b2bOf(invoiceWith({ taxable: 1000, cgst: 25, sgst: 25 }), { buyer: 'Kumar Stores', total: 1000, currency: 'AUD' });
    assert.strictEqual(b2b.total, null);
    assert.strictEqual(b2b.currency, 'AUD');
  });
  await it('b2bOf: an invoice total is kept, with its currency', () => {
    const b2b = core.b2bOf(invoiceWith({ taxable: 1000, cgst: 25, sgst: 25, total: 1050 }), { buyer: 'Kumar Stores', total: 1000, currency: 'AUD' });
    assert.strictEqual(b2b.total, 1050);
    assert.strictEqual(b2b.currency, 'AUD');
  });
  await it('pushOrder: no invoice total → refused with a reason, adapter never called, no receipt, books told once', async () => {
    const w = world(invoiceWith({ taxable: 1000, cgst: 25, sgst: 25 }));
    const first = await w.run(), second = await w.run();
    assert.strictEqual(first.outcome, 'waiting');
    assert.ok(/no total \(AUD\)/.test(first.why), first.why);
    assert.strictEqual(second.outcome, 'waiting');
    assert.strictEqual(w.pushed.length, 0, 'a voucher was pushed with a guessed total');
    assert.strictEqual(w.receipts.length, 0, 'a refused voucher must leave no receipt (the next catch-up asks again)');
    assert.strictEqual(w.said.filter((s) => s.p === '/api/integrations/books').length, 1, 'the books are told once, not at every catch-up');
    assert.strictEqual(w.logged.filter((l) => /no total/.test(l)).length, 1);
  });
  await it('pushOrder: an invoice with a total still pushes, carrying that total and its currency', async () => {
    const w = world(invoiceWith({ taxable: 1000, cgst: 25, sgst: 25, total: 1050 }));
    const r = await w.run();
    assert.strictEqual(r.outcome, 'ok', JSON.stringify(r));
    assert.strictEqual(w.pushed.length, 1);
    assert.strictEqual(w.pushed[0].b2b.total, 1050);
    assert.strictEqual(w.pushed[0].b2b.currency, 'AUD');
  });
  console.log('\n' + pass + ' passed' + (process.exitCode ? ' — with failures' : ''));
})();
