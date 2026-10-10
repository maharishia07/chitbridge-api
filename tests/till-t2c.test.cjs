'use strict';
/**
 * till-t2c.test.cjs - ROUND T2c (M162 M129b M160 M163 M164 M158), no DB, no network, no browser: the route and page are read, the pure rules are run.
 * Run: node tests/till-t2c.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
/* the open-orders read moved to lib/open-orders.js (M168: one helper for the till and Home) — read both */
const ROUTE = ['routes/till.js', 'lib/open-orders.js'].map((p) => fs.readFileSync(path.join(API, p), 'utf8')).join('\n').replace(/\r\n/g, '\n');
const { lineIdOf } = require('../lib/deliverline');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

ok('M162: lineIdOf is b142\'s cb_line_id - md5(chit:line:pos) as a uuid, position 1-based; a line that carries an id keeps it', () => {
  const chit = '11111111-1111-4111-8111-111111111111', h = crypto.createHash('md5').update(chit + ':line:2').digest('hex');
  assert.strictEqual(lineIdOf(chit, {}, 2), [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'));
  assert.notStrictEqual(lineIdOf(chit, {}, 1), lineIdOf(chit, {}, 2));
  assert.strictEqual(lineIdOf(chit, { line_id: 'abc' }, 1), 'abc');
  assert(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(lineIdOf(chit, null, 3)));
});
ok('M162: /api/till/tasks hands the till the line_id the line has in chit_line (never null for a storefront order)', () => {
  assert(ROUTE.includes('deliverline.lineIdOf(h.chit_id, l, i + 1)') && ROUTE.includes('return { line_id,'));
  assert(!ROUTE.includes('line_id: l.line_id || null'));
});
ok('M129b: an order with a despatch note against it and no movement written is not open - one read for all orders', () => {
  assert(ROUTE.includes("business_json->>'doc' = 'despatch'") && ROUTE.includes('despatched.has(String(h.chit_id))'));
  assert.strictEqual((ROUTE.match(/business_json->'against'->>'chit_id' = ANY/g) || []).length, 1);
});
ok('M160: billing an order sets the Dine-in / Takeaway / Delivery chip to the order\'s', () => {
  assert(PAGE.includes('setOrderKind(BILL_ORDER.kind)'));
});
ok('M163: the keys badge is a picture and the count, named by aria-label and title - never "QK"', () => {
  assert(PAGE.includes("(QK_FULL ? '⌑' : '⊞')") && PAGE.includes('aria-label="\' + (QK_FULL ? \'All products\' : \'Quick keys\')'));
  assert(!PAGE.includes("'⊞ Quick keys')\n    + (baseTotal"));
  assert(!/>\s*QK\s*</.test(PAGE));
});
ok('M164: Pictures / Names are two icons on the keys box AND the bill side, each with aria-label and title', () => {
  assert(PAGE.includes("[[true, '🖼', 'Pictures'], [false, '≡', 'Names']]") && PAGE.includes("[['pics', '🖼', 'Pictures'], ['names', '≡', 'Names']]"));
  assert((PAGE.match(/aria-label="' \+ x\[2\] \+ '" title="' \+ x\[2\] \+ '"/g) || []).length === 2);
});
console.log('\n  ' + n + ' passed\n');
{
  const B = require('../lib/books');
  const rows = [1, 2, 3, 4].map((p) => ({ fiscal_year: '2026-27', period: p, status: p === 1 ? 'hard_locked' : (p === 2 ? 'soft_locked' : 'open'), end_date: ['2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31'][p - 1] }));
  const out = B.periodAdvice(rows, [{ fiscal_year: '2026-27', period: 3, entries: 12, sales_minor: 345000 }], '2026-07-15');
  console.log('- M157: what a month may do');
  ok('Lock only for a finished month, oldest first; entries and sales ride on each month', () => {
    assert.deepStrictEqual(out.map((r) => r.lock.may), [false, false, true, false]);
    assert.strictEqual(out[3].lock.why, 'This month is not over yet.');
    assert.strictEqual(out[2].entries, 12); assert.strictEqual(out[2].sales_minor, 345000); assert.strictEqual(out[0].entries, 0);
    const skip = B.periodAdvice(rows.map((r) => Object.assign({}, r, { status: r.period === 3 ? 'open' : r.status === 'hard_locked' ? 'open' : r.status })), [], '2026-09-01');
    assert.strictEqual(skip[0].lock.may, true); assert.strictEqual(skip[2].lock.why, 'Lock the earlier months first.');
  });
  ok('Reopen: a soft lock says it needs a reason; a hard lock says never', () => {
    assert.strictEqual(out[1].reopen.may, true); assert(/reason/.test(out[1].reopen.why));
    assert.strictEqual(out[0].reopen.may, false); assert(/never/.test(out[0].reopen.why));
  });
  console.log('\n  ' + n + ' passed\n');
}
