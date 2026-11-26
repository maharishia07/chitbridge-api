'use strict';
/* rw127 (re-walk 1, RW1-27): a credit note can be raised from a sale. /till.html?return=<chit_id> opens the till's ONE return sheet at that bill (retOpen); the chit read says how much is credited */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const block = (name, async_) => { const head = (async_ ? 'async function ' : 'function ') + name + '('; const at = html.indexOf(head); assert.ok(at >= 0, name); const end = html.indexOf('\n}\n', at); return html.slice(at, end + 2); };
const FNS = [block('returnAskedId'), block('returnFindBill', true), block('returnFromAddress', true)].join('\n');
function ctx(opts) {
  const said = [], opened = [], puts = [], givens = [];
  const c = vm.createContext({
    location: { pathname: '/till.html', search: '?return=' + opts.id, hash: '' }, history: { replaceState() {} }, MODE: 'sell', setMode() {}, RET_DAYS: 30, RET_WHYNOT: 'no', retInWindow: (b) => !b.old,
    retCanIssue: () => opts.can !== false, retBills: async () => opts.local || [], retPriorFor: async () => ({}), retLeft: (b, n) => (opts.left || {})[n] != null ? opts.left[n] : (b.lines[n].qty),
    retOpen: async (no, given) => { opened.push(no); if (given) givens.push(given); }, toastLine: (t) => said.push(t), cbQuiet() {}, TODAY_BILLS: 1, RET_PRIOR: null,
    HOST: { history: async () => opts.history || { offline: true } }, serverBillCustomer: (b) => ({ name: b.customer }), DB: { put: async (k, row) => puts.push(row) },
  });
  vm.runInContext(FNS, c);
  return { c, said, opened, puts, givens };
}
const bill = { no: 'C1/0001', chit_id: 'a'.repeat(8) + '-1', customer: 'Walk-in', lines: [{ qty: 2 }, { qty: 1 }] };
test('the address names the bill: return= is read, anything else is not', () => {
  assert.strictEqual(ctx({ id: 'abcdef12-34' }).c.returnAskedId(), 'abcdef12-34');
  assert.strictEqual(ctx({ id: 'x y' }).c.returnAskedId(), '');
});
test('a bill held on this device opens the one return sheet (retOpen), nothing else', async () => {
  const r = ctx({ id: bill.chit_id, local: [Object.assign({ _sent: { chit_id: bill.chit_id } }, bill)] });
  await r.c.returnFromAddress();
  assert.deepStrictEqual(r.opened, ['C1/0001']); assert.deepStrictEqual(r.said, []);
});
test('a bill this device does not hold is read from the shop and kept as sent+verified, then opened', async () => {
  const r = ctx({ id: bill.chit_id, history: { bills: [bill] } });
  await r.c.returnFromAddress();
  assert.strictEqual(r.puts.length, 1); assert.strictEqual(r.puts[0]._from_server, true); assert.strictEqual(r.puts[0]._sent.chit_id, bill.chit_id); assert.ok(r.puts[0]._verified);
  assert.deepStrictEqual(r.opened, ['C1/0001']);
});
test('RW2-05: a bill older than the window is read by its id, opened from memory and NOT kept on the device', async () => {
  const old = Object.assign({}, bill, { old: true });
  const r = ctx({ id: bill.chit_id, history: { bills: [old] } });
  await r.c.returnFromAddress();
  assert.strictEqual(r.puts.length, 0); assert.deepStrictEqual(r.opened, ['C1/0001']); assert.strictEqual(r.givens[0].no, 'C1/0001');
});
test('every line already back: said, the sheet is not opened', async () => {
  const r = ctx({ id: bill.chit_id, local: [Object.assign({ _sent: { chit_id: bill.chit_id } }, bill)], left: { 0: 0, 1: 0 } });
  await r.c.returnFromAddress();
  assert.deepStrictEqual(r.opened, []); assert.ok(/already come back/.test(r.said[0]));
});
test('a line that is down, a bill not in the 30 days, a host that cannot issue: each said, never silent', async () => {
  let r = ctx({ id: bill.chit_id }); await r.c.returnFromAddress(); assert.ok(/line is down/.test(r.said[0]) && !r.opened.length);
  r = ctx({ id: bill.chit_id, history: { bills: [] } }); await r.c.returnFromAddress(); assert.ok(/holds no counter bill with that address/.test(r.said[0])); /* RW2-05: no window any more, only 'no such bill' */
  r = ctx({ id: bill.chit_id, can: false }); await r.c.returnFromAddress(); assert.deepStrictEqual(r.said, ['no']);
});
test('till.html is started from the address once, after the counter is up', () => {
  assert.ok(/TILL_BOOT\.then\(returnFromAddress\)/.test(html));
});
test('creditedOf: reads the credited total through the cap\'s own readers; full when the notes reach the bill', async () => {
  const cap = require('../lib/credit-cap');
  const rows = (billTotal, notes) => ({ query: async (sql) => /purpose = 'credit_note'/.test(sql) ? { rows: notes.map((n, i) => ({ chit_id: 'n' + i, invoice_total: n })) }
    : { rows: [{ chit_id: 'b', currency_code: 'INR', till_id: 'C1', withdrawn: false, invoice_total: billTotal, bill_no: 'C1/1' }] } });
  const half = await cap.creditedOf(rows(1180, [590]), 'e', 'b'); assert.strictEqual(half.full, false); assert.strictEqual(half.left_minor, 59000);
  const all = await cap.creditedOf(rows(1180, [590, 590]), 'e', 'b'); assert.strictEqual(all.full, true); assert.strictEqual(all.left_minor, 0);
  assert.strictEqual(await cap.creditedOf({ query: async () => ({ rows: [] }) }, 'e', 'b'), null);
});

/* w4ctr: the chit read stays inside its round-trip budget (round-trips-chit 15, round-trips-volume 6): the credited figure is read ONLY when the caller says ?with=credit (the chit sheet does) */
test('GET /chits/:id reads the credited figure only on ?with=credit', () => {
  const src = require('../tools/chits-files.cjs').read(path.join(__dirname, '..'));
  const at = src.indexOf('creditCap.creditedOf(db, entity_id, chit_id)');
  assert.ok(at > 0, 'the read is there');
  const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at));
  assert.ok(/req\.query\.with[^?]*includes\('credit'\)\s*\?/.test(line), 'gated on ?with=credit, a plain read costs no credit queries');
});
