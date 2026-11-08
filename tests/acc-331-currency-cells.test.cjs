'use strict';
/**
 * acc-331-currency-cells.test.cjs — CUR-1 (ACC-331, ACC-332): the one check that a money cell names the document's currency or none (lib/currency-cells), offline.
 * Unit per rule: payment / refund / part / line cells are found; a cell naming nothing is the document's own; case and spaces do not matter.
 * Refusal path: another currency throws 409 CURRENCY_MISMATCH naming the FIRST wrong field, both codes read; the journal reader givenLines refuses the same way.
 * Fail closed: a malformed code ('US', 'U$D') is a mismatch, never a pass; no document currency (a draft before Country setup) claims nothing.
 * Wiring: POST /chits/send runs sendPartCurrency right after sendMoney, and the ledger maps the code to 409 (lib/books-contract refusalOf).
 * Hand figures: shop INR, a part 'USD' → words "payment.parts[1].currency says USD, but this shop's money is INR."
 * Run: node tests/acc-331-currency-cells.test.cjs
 */
const assert = require('assert');
const path = require('path');
const cells = require('../lib/currency-cells');
const manual = require('../lib/books-manual');
const { refusalOf } = require('../lib/books-contract');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('   ok   ' + name); };
const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };

t('the bill cells: payment, its parts, refund parts and lines that name a currency are found with their path', () => {
  const found = cells.billCellsOf({ payment: { currency: 'USD', parts: [{ how: 'cash', amount: 1 }, { how: 'upi', currency: 'usd' }] }, refund: { parts: [{ currency: 'EUR' }] } }, [{ price: 1 }, { currency: 'GBP' }]);
  assert.deepStrictEqual(found.map((c) => c.field + '=' + c.currency), ['payment.currency=USD', 'payment.parts[1].currency=USD', 'refund.parts[0].currency=EUR', 'line_items[1].currency=GBP']);
});
t('a cell that names no currency is the document\'s own: nothing found, nothing refused', () => {
  assert.deepStrictEqual(cells.billCellsOf({ payment: { mode: 'cash', parts: [{ how: 'cash', amount: 1, currency: '' }, { how: 'upi', currency: null }] } }, [{ price: 1 }]), []);
  assert.strictEqual(cells.assertSame([], 'INR'), true);
});
t('a money value in price carries its code', () => {
  assert.deepStrictEqual(cells.billCellsOf({}, [{ price: { amount: 5, currency: 'USD' } }]).map((c) => c.field), ['line_items[0].currency']);
});
t('the same currency passes, whatever the case or spaces', () => {
  assert.strictEqual(cells.assertSame(cells.billCellsOf({ payment: { currency: ' inr ', parts: [{ currency: 'INR' }] } }, []), 'inr'), true);
});
t('another currency is refused: 409 CURRENCY_MISMATCH, the FIRST wrong field named, both codes read', () => {
  const e = refused(() => cells.assertSame(cells.billCellsOf({ payment: { parts: [{ currency: 'INR' }, { currency: 'USD' }] } }, [{ currency: 'EUR' }]), 'INR'));
  assert.ok(e, 'must refuse');
  assert.strictEqual(e.status, 409); assert.strictEqual(e.code, 'CURRENCY_MISMATCH'); assert.strictEqual(e.field, 'payment.parts[1].currency');
  assert.strictEqual(e.claimed, 'USD'); assert.strictEqual(e.governed, 'INR');
  assert.ok(e.message.startsWith('payment.parts[1].currency says USD, but this shop'), e.message);
});
t('fail closed: a malformed code is a mismatch, and no document currency claims nothing', () => {
  assert.ok(refused(() => cells.assertSame([{ field: 'payment.currency', currency: 'US' }], 'INR')));
  assert.ok(refused(() => cells.assertSame([{ field: 'payment.currency', currency: 'U$D' }], 'INR')));
  assert.strictEqual(cells.assertSame([{ field: 'payment.currency', currency: 'USD' }], null), true);
});
t('the journal reader refuses a line in another currency (ACC-332) and keeps the minor figures of a clean one', () => {
  const e = refused(() => manual.givenLines([{ code: '1000', dr_minor: 100, currency: 'USD' }, { code: '4000', cr_minor: 100, currency: 'USD' }], 'INR'));
  assert.ok(e && e.code === 'CURRENCY_MISMATCH' && e.field === 'lines[0].currency', 'refused on lines[0]');
  const rows = manual.givenLines([{ code: '1000', dr_minor: 100, currency: 'INR' }, { code: '4000', cr_minor: 100 }], 'INR');
  assert.deepStrictEqual(rows.map((r) => [r.dr, r.cr]), [[1, 0], [0, 1]]);
});
t('the ledger answers the refusal 409 with its code and the field (one problem shape), not a 500', () => {
  const e = refused(() => manual.givenLines([{ code: '1000', dr_minor: 100, currency: 'USD' }], 'INR'));
  const answer = refusalOf(e, { id: 'x' });
  assert.strictEqual(answer.status, 409); assert.strictEqual(answer.code, 'CURRENCY_MISMATCH'); assert.strictEqual(answer.legacy.field, 'lines[0].currency');
});
t('POST /chits/send runs the check after the money is settled and before the invoice is issued', () => {
  const source = require('../tools/chits-files.cjs').read(path.join(__dirname, '..'));
  const steps = source.slice(source.indexOf('const SEND_STEPS = ['), source.indexOf('];', source.indexOf('const SEND_STEPS = [')));
  assert.ok(steps.indexOf('sendMoney,') > 0 && steps.indexOf('sendMoney,') < steps.indexOf('sendPartCurrency,') && steps.indexOf('sendPartCurrency,') < steps.indexOf('sendIssued,'));
});

console.log('\n' + pass + ' checks passed');
