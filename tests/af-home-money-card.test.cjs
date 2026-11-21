/**
 * af-home-money-card.test.cjs — AF-F-03 (walk AF-C13, 1129): Home showed "To pay A$410.00" to the bookkeeper, cashier and viewer while the books refused them every figure. The Finance card now asks the books' own
 * gate (routes/books gates.mayReadMoney): a seat it refuses gets the card greyed (state not_started, may.ok false) with the books' sentence, and NO money, no figure; a seat it lets through reads as before.
 * Run: node tests/af-home-money-card.test.cjs
 */
'use strict';
const path = require('path');
const gate = require('../routes/books');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
(async () => {
  const real = gate.gates.mayReadMoney;
  const card = require('../lib/home-facts-finance');
  const helpers = { withEntity: async () => { throw new Error('the card must not read the books for a refused seat'); }, notProvisioned: () => false, notStarted: () => ({}), plural: String, toNumber: Number, neverUsed: () => undefined };
  gate.gates.mayReadMoney = async () => false;
  const refused = await card.financeCard({ entity: 'e', req: {} }, helpers);
  ok('a refused seat: the card is greyed (not_started) and says why', refused.state === 'not_started' && refused.may && refused.may.ok === false && /Only the owner/.test(refused.may.say), JSON.stringify(refused));
  ok('…no money, no figure on it', !refused.lines.some((line) => line.money) && Object.keys(refused.figures).length === 0 && !refused.lines.some((line) => /\d/.test(line.text)), JSON.stringify(refused));
  gate.gates.mayReadMoney = async () => true;
  let read = false;
  const allowed = await card.financeCard({ entity: 'e', req: {} }, Object.assign({}, helpers, { withEntity: async () => { read = true; }, notStarted: () => ({ state: 'not_started', lines: [] }) })).catch(() => ({}));
  ok('a seat the books let through reads the books as before', read === true);
  gate.gates.mayReadMoney = real;
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
