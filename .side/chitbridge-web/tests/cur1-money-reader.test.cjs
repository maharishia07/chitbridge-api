/**
 * tests/cur1-money-reader.test.cjs - CUR-1 slice 5: the web tolerant reader (app/helpers.js moneyRead, and the three painters that use it).
 * The old shapes and the new shape both render; a currency is never guessed; an unreadable amount is a dash, never a false 0.00.
 * Every expected value below is written by hand from the shape (minor / 10^exponent), not computed by the code under test.
 * MIN unit-test
 * Run: node tests/cur1-money-reader.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const PUB = path.join(__dirname, '..', 'public');
const cx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: { setAttribute() {}, style: {} }, addEventListener() {} }, navigator: { language: 'en-IN' } });
cx.window = cx; cx.self = cx;
for (const f of ['engine/money.js', 'engine/locale.js', 'app/helpers.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), cx);
const R = (v, o) => JSON.parse(JSON.stringify(cx.moneyRead(v, o)));
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; console.log('  ok  ' + m); };

/* the new wire shape: 329000 minor INR = 3290.00 (exponent 2); 5000 minor JPY = 5000 (exponent 0); 1234567 minor OMR = 1234.567 (exponent 3) */
eq(R({ amount_minor: 329000, currency: 'INR' }), { amount: 3290, amount_minor: 329000, currency: 'INR' }, 'pair: 329000 minor INR is 3290');
eq(R({ amount_minor: 5000, currency: 'JPY' }), { amount: 5000, amount_minor: 5000, currency: 'JPY' }, 'pair: JPY has no minor digits');
eq(R({ amount_minor: '1234567', currency: 'OMR' }), { amount: 1234.567, amount_minor: 1234567, currency: 'OMR' }, 'pair: a bigint string, OMR three digits');
eq(R({ amount_minor: -250, currency: 'AUD' }), { amount: -2.5, amount_minor: -250, currency: 'AUD' }, 'pair: a credit keeps its sign');
/* the old shapes */
eq(R({ amount: 12.5, currency: 'USD' }), { amount: 12.5, currency: 'USD' }, 'old pair: read as stated, not flagged');
eq(R(3290, { assume: 'inr' }), { amount: 3290, currency: 'INR', assumed: true }, 'bare number + header currency: flagged assumed');
eq(R('12.50', { assume: 'AUD' }), { amount: 12.5, currency: 'AUD', assumed: true }, 'numeric string + header currency: assumed');
eq(R({ amount: 7 }, { assume: 'AUD' }), { amount: 7, currency: 'AUD', assumed: true }, 'object without currency: assumed from the header');
/* never guess */
eq(R(3290), { amount: 3290, currency: null }, 'bare number, no header: currency stays null (never INR, never the shop)');
eq(R(3290, { assume: 'RUPEES' }), { amount: 3290, currency: null }, 'a header that is not a code is not used');
eq(R({ amount_minor: 100 }, { assume: 'INR' }), { amount: null, currency: null, unreadable: 'currency' }, 'minor amount with no own currency: refused, never assumed (no exponent to trust)');
eq(R({ amount: 5, currency: 'USD' }, { assume: 'INR' }), { amount: 5, currency: 'USD' }, 'own currency outranks the header');
/* absent and unreadable */
ok(R(null) === null && R('') === null && R(undefined) === null, 'absent is null, not zero');
eq(R({ amount_minor: 12.5, currency: 'INR' }).unreadable, 'amount', 'a fractional minor amount is unreadable');
eq(R({ amount_minor: '9007199254740993', currency: 'INR' }).unreadable, 'amount', 'an unsafe integer is unreadable');
eq(R({ amount: 'abc', currency: 'INR' }).unreadable, 'amount', 'text is unreadable');
eq(R([1, 2]).unreadable, 'amount', 'an array is unreadable');

/* painters: 329000 minor INR = Rs 3,290.00 ; 250 minor USD = $2.50 */
const loc = cx.CBLocale.money;
ok(cx.fmtMoney({ amount_minor: 329000, currency: 'INR' }) === loc(3290, 'INR'), 'fmtMoney: the pair paints as 3,290.00 INR (was 0.00)');
ok(cx.fmtMoney({ amount_minor: 250, currency: 'USD' }, 'INR') === loc(2.5, 'USD'), 'fmtMoney: the value\'s own currency outranks the code the caller passed');
ok(cx.fmtMoney({ amount: 4, currency: 'USD' }, 'INR') === loc(4, 'USD'), 'fmtMoney: same for the old pair');
ok(cx.fmtMoney({ amount: 4 }, 'AUD') === loc(4, 'AUD'), 'fmtMoney: an object without currency uses the caller\'s code, as before');
ok(cx.fmtMoney({ amount_minor: 1.5, currency: 'INR' }) === '—', 'fmtMoney: an unreadable pair is a dash, not 0.00');
ok(cx.fmtMoney({ amount_minor: 1.5, currency: 'INR' }, undefined, 'n/a') === 'n/a', 'fmtMoney: or the caller\'s empty word');
ok(cx.fmtMoney(3290, 'INR') === loc(3290, 'INR'), 'fmtMoney: a bare number is unchanged');
ok(cx.fmtMoneyWhole({ amount_minor: 4000, currency: 'INR' }) === loc(40, 'INR').replace(/[.,]00(?=\D*$)/, ''), 'fmtMoneyWhole: a whole pair drops its .00');
ok(cx.bareAmount({ amount_minor: 12345, currency: 'USD' }) === '123.45', 'bareAmount: a pair paints 12345 minor as 123.45');
ok(cx.bareAmount({ amount: 1234.5 }) === '1,234.50', 'bareAmount: an object amount keeps its two decimals');

/* totals: 100.00 INR + 250 minor USD(2.50) + 50.00 INR = INR 150.00 and USD 2.50, two lines, never one sum */
const rows = [{ amt: { amount_minor: 10000, currency: 'INR' } }, { amt: { amount_minor: 250, currency: 'USD' } }, { amt: { amount: 50, currency: 'INR' } }, { amt: { amount_minor: 0, currency: 'INR' } }];
eq(JSON.parse(JSON.stringify(cx.cbSumByCurrency(rows, 'amt'))), [{ currency: 'INR', total: 150 }, { currency: 'USD', total: 2.5 }], 'cbSumByCurrency: pairs add under their own currencies, INR 150 and USD 2.5, zero skipped');
eq(JSON.parse(JSON.stringify(cx.cbSumByCurrency([{ amt: 200, currency: 'AUD' }, { amt: { amount_minor: 100, currency: 'AUD' } }], 'amt'))), [{ currency: 'AUD', total: 201 }], 'cbSumByCurrency: old row and new pair of one currency add: 200 + 1.00 = 201');
/* the harness that lifts fmtMoney out of helpers.js (scripts/check-adoption.js) must lift every function fmtMoney now calls, or its 11 cases fail on "is not defined" */
const lifter = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-adoption.js'), 'utf8');
for (const fn of ['moneyValueFor', 'moneyRead', 'moneyReadMajor', 'moneyReadMinor', 'isoCodeOf', 'bareAmount']) ok(lifter.includes("'" + fn + "'"), 'scripts/check-adoption.js lifts ' + fn + ' beside fmtMoney');
console.log(n + ' checks passed');
