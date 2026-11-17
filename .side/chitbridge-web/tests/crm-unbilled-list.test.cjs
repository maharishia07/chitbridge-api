/**
 * tests/crm-unbilled-list.test.cjs - CRM-32 (walk W41): the Parties list never says "Settled" for a party whose order is unpaid but not billed yet.
 * The server sends `unbilled { n, minor, currency }` on each party (api lib/crm withUnbilled, the Tasks Billed tag's own test); crmDueListCell paints it.
 * Run: node tests/crm-unbilled-list.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-crm.js'), 'utf8').replace(/\r\n/g, '\n');
/* just the named functions, cut out of the page's own file - no second copy of the wording lives in this test */
/* the function whose first line is `function name(`: a one-liner ends on its own line, else at the first line that is a lone closing brace */
const NL = String.fromCharCode(10);
const fn = (name) => {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name + ' not found');
  const first = src.slice(i, src.indexOf(NL, i));
  return first.split('{').length === first.split('}').length ? first : src.slice(i, src.indexOf(NL + '}' + NL, i) + 2);
};
globalThis.tx = (s) => s; globalThis.esc = (s) => String(s);
globalThis.bkMoney = (m, c) => (c === 'INR' ? '\u20b9' : c + ' ') + (m / 100).toLocaleString('en-IN');
globalThis.bkDate = (d) => d;
globalThis.CRM = { ledger: true, currency: 'INR' };
eval(['crmPlural', 'crmUnbilledMoney', 'crmUnbilledSaid', 'crmNothingDueCell', 'crmDueCell', 'crmDueListCell'].map(fn).join('\n') + '\nglobalThis.cell = crmDueListCell; globalThis.said = crmUnbilledSaid;');
const P = (o) => Object.assign({ party_id: 'pid-1', balance_minor: 0 }, o);

assert.strictEqual(said({ n: 1, minor: 42000, currency: 'INR' }, 'INR'), '1 order not billed yet \u20b9420', 'the record\'s own words');
assert.strictEqual(said({ n: 2, minor: null, currency: null }, 'INR'), '2 orders not billed yet', 'two currencies: the count, no made-up sum');
assert.strictEqual(said({ n: 0, minor: 0 }, 'INR') + said(null, 'INR'), '', 'nothing waiting says nothing');

let h = cell(P({ unbilled: { n: 1, minor: 42000, currency: 'INR' } }));
assert(/1 order not billed yet \u20b9420/.test(h) && !/Settled/.test(h), 'Priya: nothing owed + an unbilled order -> "not billed yet", never "Settled" (' + h + ')');
assert(/data-testid="party-due-pid-1"/.test(h), 'the row keeps its due test id');
assert(/Settled/.test(cell(P({ unbilled: { n: 0, minor: 0, currency: null } }))), 'nothing unbilled and nothing owed is still Settled');
assert(/Settled/.test(cell(P({}))), 'an older answer without the key still says Settled');
h = cell(P({ balance_minor: 100000, unbilled: { n: 1, minor: 42000, currency: 'INR' } }));
assert(/you'll get/.test(h) && /1 order not billed yet/.test(h), 'owed AND unbilled: both are said, side by side');
CRM.ledger = false;
assert(/not billed yet/.test(cell(P({ unbilled: { n: 1, minor: 42000, currency: 'INR' } }))), 'ledger off: the unbilled order is still said');
console.log('crm-unbilled-list: all ok');
