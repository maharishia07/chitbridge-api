/**
 * party-statement-one-assembler.test.cjs — RC12 (figure census 28 Nov 2026): a party statement's closing is assembled in ONE place (lib/books.partyStatement);
 * GET /party/:id/statement no longer builds its own engine input. Golden: a customer billed 118.00 → closing 11800 whether the role is named or left to the engine.
 * Run: node tests/party-statement-one-assembler.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const same = JSON.stringify(got) === JSON.stringify(want); same ? pass++ : fail++; console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + name + (same ? '' : '\n     got ' + JSON.stringify(got) + '\n     want ' + JSON.stringify(want))); };
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load(), { B, T, db } = X;
  T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi', customer: true, credit_days: 15 });
  await B.enable(db, SHOP, { by: SHOP, today: '2026-09-29' });
  await B.postEntry(db, SHOP, { type: 'sale_bill', date: '2026-09-10', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-0000000000a1', source_ref: 'chit:s1', by_rate: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], paid: {}, round_off: 0 });
  const named = await B.partyStatement(db, SHOP, CUST, 'debtors', '2026-04-01', '2026-10-31');
  const dflt = await B.partyStatement(db, SHOP, CUST, null, '2026-04-01', '2026-10-31');
  eq('golden: closing 118.00 with the role named', named.closing_minor, 11800);
  eq('the route\'s call (role left to the engine) gives the SAME statement', [dflt.closing_minor, dflt.opening_minor, dflt.rows.length, dflt.code], [named.closing_minor, named.opening_minor, named.rows.length, named.code]);
  eq('a role the chart lacks is still null', await B.partyStatement(db, SHOP, CUST, 'no_such_role', '2026-04-01', '2026-10-31'), null);
  const route = fs.readFileSync(path.join(H.API, 'routes', 'books.js'), 'utf8');
  eq('guard: the route has no second assembler (statementInput) and never calls the engine statement itself', [/statementInput/.test(route), /\.partyStatement\(\{/.test(route), /B\.partyStatement\(/.test(route)], [false, false, true]);
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('threw', e); process.exit(1); });
