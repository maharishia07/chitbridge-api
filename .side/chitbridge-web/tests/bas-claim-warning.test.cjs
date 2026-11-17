/**
 * bas-claim-warning.test.cjs — W15-91: the BAS page warns when part of 1B is claimed with no tax invoice. The server carries { count, tax_minor, box } (the Day book's own flag); the page words it.
 * Proves: the sentence carries the server's figure and count (never added up here) · one / many · the box named by the server, else the plain "the tax you claim" · nothing claimed, nothing said (zero count, zero tax, absent) ·
 * the amount is the page's own formatter's (so the currency rides with it). Run: node tests/bas-claim-warning.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let pass = 0, fail = 0;
const ok = (n, c, w) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (w ? '\n          ' + w : '')); } };
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-evidence.js'), 'utf8'), sandbox);
const W = sandbox.CBEvidence.claimWarning;
const money = (m) => 'A$' + (m / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 });

const two = W({ count: 2, tax_minor: 242520, box: '1B', currency: 'AUD' }, money);
ok('2 purchases: the walk\'s sentence, word for word', two && two.text === 'A$2,425.20 of 1B is from 2 purchases with no tax invoice. You need the tax invoice to claim it.', two && two.text);
ok('the link says See them', two && two.see === 'See them');
const one = W({ count: 1, tax_minor: 5000, box: '1B' }, money);
ok('1 purchase: singular', one && one.text === 'A$50.00 of 1B is from 1 purchase with no tax invoice. You need the tax invoice to claim it.', one && one.text);
const nobox = W({ count: 3, tax_minor: 900, box: null }, money);
ok('a return whose box the pack does not name: "the tax you claim", no invented box', nobox && /^A\$9\.00 of the tax you claim is from 3 purchases/.test(nobox.text), nobox && nobox.text);
ok('nothing without its invoice: no warning (count 0)', W({ count: 0, tax_minor: 0, box: '1B' }, money) === null);
ok('a count with no tax claimed: no warning', W({ count: 2, tax_minor: 0, box: '1B' }, money) === null);
ok('an older server (no field): no warning, no error', W(undefined, money) === null && W(null, money) === null);
ok('the amount is exactly what the formatter gave for the server\'s minor (carried, not recomputed)', two.text.indexOf(money(242520)) === 0);
/* ACC-357 / W15-103: the money at risk on the To pay line - both figures the server's; the page words them */
const R = sandbox.CBEvidence.claimRisk;
const risk = R({ count: 2, tax_minor: 242520, net_if_unclaimed_minor: 600000 }, 357480, money);
ok('To pay A$3,574.80 -> "A$6,000.00 if the 2 purchases without a tax invoice are not claimed" (the walk sentence)', risk === 'A$6,000.00 if the 2 purchases without a tax invoice are not claimed', risk);
ok('one purchase: singular', R({ count: 1, tax_minor: 5000, net_if_unclaimed_minor: 9000 }, 4000, money) === 'A$90.00 if the 1 purchase without a tax invoice is not claimed');
ok('a refund that turns into a payment says so', R({ count: 1, tax_minor: 5000, net_if_unclaimed_minor: 3000 }, -2000, money) === 'A$30.00 to pay if the 1 purchase without a tax invoice is not claimed');
ok('a payment that turns into a refund says so', /^A\$10\.00 refund if/.test(R({ count: 1, tax_minor: 5000, net_if_unclaimed_minor: -1000 }, 4000, money)));
ok('nothing without an invoice, or an older server: nothing said', R({ count: 0, net_if_unclaimed_minor: null }, 100, money) === null && R(null, 1, money) === null && R({ count: 2 }, 1, money) === null);
console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
