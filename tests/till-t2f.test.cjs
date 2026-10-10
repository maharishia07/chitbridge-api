/**
 * till-t2f.test.cjs - ROUND T2f (M169 the bill's kind default, M183 Kitchen button), no DB, no network, no browser.
 */
'use strict';
const assert = require('assert'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (label, fn) => { try { fn(); n++; console.log('  ok    ' + label); } catch (e) { bad++; console.log('  FAIL  ' + label + '\n        ' + (e && e.message)); } };
const PAGE = require('fs').readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (name) => { const m = PAGE.match(new RegExp('^function ' + name + '\\([^\\n]*\\n', 'm')); assert(m, name + ' is in the page'); return m[0]; };

console.log('\n-- M169 an order\'s kind is for ITS bill only --');
const mk = () => {
  const store = { cb_till_otype: 'take' };
  const ctx = { BILL_ORDER: null, ls: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } }, shopLs: (k) => k, paintOrderBar() {} };
  vm.createContext(ctx);
  vm.runInContext(grab('orderKind') + grab('setOrderKind'), ctx);
  return { ctx, store };
};
ok('a new bill shows the counter\'s own default (Takeaway)', () => { assert.strictEqual(mk().ctx.orderKind(), 'take'); });
ok('an order bill (Delivery) shows Delivery but never writes the saved default', () => {
  const { ctx, store } = mk();
  ctx.BILL_ORDER = { kind: 'deliver' };
  assert.strictEqual(ctx.orderKind(), 'deliver');
  ctx.setOrderKind('deliver');
  assert.strictEqual(store.cb_till_otype, 'take');
});
ok('bill the order, then the next empty bill is Takeaway again - even without any give-back, even after a reload', () => {
  const { ctx, store } = mk();
  ctx.BILL_ORDER = { kind: 'deliver' }; ctx.setOrderKind('deliver');
  ctx.BILL_ORDER = null;
  assert.strictEqual(ctx.orderKind(), 'take');
  assert.strictEqual(store.cb_till_otype, 'take');
});
ok('the counter\'s own choice on a plain bill is still saved', () => {
  const { ctx, store } = mk(); ctx.setOrderKind('dine'); assert.strictEqual(store.cb_till_otype, 'dine');
});

console.log('\n-- M183 Kitchen reads as a word --');
ok('the Kitchen button carries the word, not the 🍳 circle', () => {
  const seg = PAGE.slice(PAGE.indexOf('data-testid="till-kot"'), PAGE.indexOf('data-testid="till-kot"') + 900);
  assert(seg.includes("'Kitchen'") && !seg.includes('🍳'));
});

console.log('\n  ' + n + ' passed' + (bad ? ', ' + bad + ' FAILED' : '') + '\n');
process.exit(bad ? 1 : 0);
