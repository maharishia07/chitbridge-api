/**
 * tests/pay-fix-renumber.test.cjs — PAY-FIX H9: a page reload in the middle of renumberBill must not give one sale two numbers.
 * The new number is stamped on the old rows (`renumber_to`) before the four writes; a retry reuses it. No browser, no network:
 * renumberBill and rememberRenumber are lifted from till.html into a vm with an in-memory DB that can "reload" after N writes.
 * Run: node tests/pay-fix-renumber.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path'), vm = require('vm'), fs = require('fs');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (name) => { const m = PAGE.match(new RegExp('^async function ' + name + '\\([^]*?\\n}\\n', 'm')); assert(m, name + ' is in the page'); return m[0]; };

function counter(crashAfterWrites) {
  const stores = { bills: {}, queue: {} }; let writes = 0, issued = 0;
  const DB = {
    put: async (st, row) => { if (crashAfterWrites != null && writes >= crashAfterWrites) throw new Error('reload'); writes++; stores[st][row.no] = JSON.parse(JSON.stringify(row)); },
    del: async (st, key) => { delete stores[st][key]; },
  };
  const ctx = { DB, LAST_SERIES: null, tillId: () => 'T1', nextNumber: async () => 'B' + (++issued), cbQuiet() {}, Object, Number, Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(grab('renumberBill') + grab('rememberRenumber'), ctx);
  return { ctx, stores, issued: () => issued };
}
(async () => {
  const bill = { no: 'X1', lines: [{}], at: '2026-10-15T10:00:00Z' };
  /* a first attempt that dies after 3 writes (stamp queue, stamp bill, put new bill) … */
  const first = counter(3); first.stores.bills.X1 = bill; first.stores.queue.X1 = bill;
  await assert.rejects(first.ctx.renumberBill(bill, 'taken'), /reload/);
  const left = first.stores.queue.X1; assert.strictEqual(left.renumber_to, 'B1', 'the old queue row remembers the new number');
  /* … then the page reloads: a fresh run over what IndexedDB kept. */
  const second = counter(); second.stores.bills = first.stores.bills; second.stores.queue = first.stores.queue;
  const moved = await second.ctx.renumberBill(left, 'taken again');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(moved)), { from: 'X1', to: 'B1' }, 'the SAME number, not a second draw');
  assert.strictEqual(second.issued(), 0, 'no new number was drawn after the reload');
  assert.deepStrictEqual(Object.keys(second.stores.queue), ['B1']); assert.deepStrictEqual(Object.keys(second.stores.bills), ['B1']);
  assert.ok(!('renumber_to' in second.stores.queue.B1), 'the new row carries no pending stamp');
  console.log('pay-fix-renumber: 6 checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
