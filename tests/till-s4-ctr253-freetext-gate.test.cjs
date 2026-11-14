/* CTR-253 — a queued bill with no item_id line has nothing to re-check: it passes the price gate and never reads as a price door down.
   The page's staleCandidate / staleGate are lifted out and run. CTR253_MUTATE=1 takes the item test out of staleCandidate and must fail. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
let page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
if (process.env.CTR253_MUTATE === '1') page = page.replace('basis && staleHasItem(row) && basis.checked', 'basis && basis.checked');
const grab = (n) => new RegExp('(?:async )?function ' + n + '\\([\\s\\S]*?\\n}\\n').exec(page)[0];
let doorDown = 0;
const ctx = { qDue: () => true, staleRead: async () => null, toastLine() {}, console };
ctx.staleDoorDown = async () => { doorDown++; return 'wait'; };
ctx.staleSettle = async (row, answers, tally) => (answers ? 'send' : ctx.staleDoorDown(row, tally));
vm.createContext(ctx);
vm.runInContext(['staleCandidate', 'staleHasItem', 'staleSaleRow', 'staleGate'].map(grab).join('\n'), ctx);
const free = { no: 'A1', lines: [{ particulars: 'Tea (typed)', price: 10 }], price_basis: { checked: false } };
const item = { no: 'A2', lines: [{ item_id: 'i1', price: 10 }], price_basis: { checked: false } };
assert.strictEqual(ctx.staleCandidate(free), false, 'a free-text-only bill is not a price-check candidate');
assert.strictEqual(ctx.staleCandidate(item), true, 'a bill with an item line still is');
assert.strictEqual(ctx.staleCandidate({ no: 'A3', lines: [{ item_id: 'i1' }, { particulars: 'x' }], price_basis: { checked: false } }), true, 'a mixed bill still is');
(async () => {
  const out = await ctx.staleGate([free], false);
  assert.strictEqual(out.rows.length, 1, 'the free-text bill must pass the gate');
  assert.strictEqual(out.why, null);
  assert.strictEqual(doorDown, 0, 'a free-text bill must never reach the door-down state');
  console.log('till-s4-ctr253-freetext-gate ok · 5 checks');
})().catch((e) => { console.error(e.message); process.exit(1); });
