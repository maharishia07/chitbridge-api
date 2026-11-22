// tests/in-f03-party-state-follows-gstin.test.cjs — IN-F-03: a party's state follows its GSTIN; a clash is refused in words.  node tests/in-f03-party-state-follows-gstin.test.cjs
// Hand figures: 29AABCN4321M1ZB opens with 29 = Karnataka; 33AAHCW2468J1Z1 opens with 33 = Tamil Nadu; 99ABCPK1234L1ZH has a right check character but 99 is not a state.
const assert = require('node:assert/strict');
const pf = require('../lib/party-fields');
let n = 0;
const ok = (name, cond) => { n++; assert.ok(cond, name); };

/* IN-F-03: the party */
let threw = null;
try { pf.cleanTaxIds([{ scheme: 'GSTIN', value: '99ABCPK1234L1ZH' }]); } catch (e) { threw = e; }
ok('a party GSTIN with state 99 is refused, status 400, in words', threw && threw.status === 400 && /GSTIN: the first two digits/.test(threw.message));
const good = pf.cleanTaxIds([{ scheme: 'GSTIN', value: '29aabcn4321m1zb' }]);
ok('a good party GSTIN is kept upper-case', good[0].value === '29AABCN4321M1ZB');
ok('the state comes from the GSTIN: 29', pf.stateFromGstin(good, null) === '29');
ok('the stored GSTIN gives the state when none is sent', pf.stateFromGstin(null, '33AAHCW2468J1Z1') === '33');
ok('no GSTIN, no state', pf.stateFromGstin([{ scheme: 'PAN', value: 'AABCN4321M' }], null) === null);
ok('state 29 against GSTIN 29: agrees', pf.stateAgreesWithGstin('29', '29') === null);
ok('the state typed as a name agrees: Karnataka = 29', pf.stateAgreesWithGstin('Karnataka', '29') === null);
ok('nothing typed: agrees', pf.stateAgreesWithGstin(null, '29') === null);
const clash = pf.stateAgreesWithGstin('33', '29');
ok('state 33 against GSTIN 29 is refused in words naming both', /33/.test(clash) && /29/.test(clash) && /Karnataka/.test(clash));
ok('an unreadable state is refused too', /does not match/.test(pf.stateAgreesWithGstin('XX', '29')));

/* the write: a fake db, routed by the words of the statement */
const log = [];
const fakeDb = (stored) => ({
  query: async (sql, params) => {
    log.push(sql.replace(/\s+/g, ' ').slice(0, 60));
    if (/FROM party_tax_id t JOIN/.test(sql)) return { rows: stored ? [{ value: stored }] : [] };
    if (/^SELECT \* FROM customer_list/.test(sql)) return { rows: [{ customer_list_id: 'L1', customer_identity_id: 'P1', state_code: '33', legal_name: 'X' }] };
    if (/SELECT scheme, value FROM party_tax_id/.test(sql)) return { rows: [] };
    return { rows: [] };
  }
});
(async () => {
  let refused = null;
  try { await pf.patch(fakeDb(null), 'O', 'customer', 'L1', { state_code: '33', tax_ids: [{ scheme: 'GSTIN', value: '29AABCN4321M1ZB' }] }, 'u'); } catch (e) { refused = e; }
  ok('PATCH state 33 with GSTIN 29 in one body: refused 400 and nothing written', refused && refused.status === 400 && !log.some((s) => /^UPDATE/.test(s)));
  refused = null;
  try { await pf.patch(fakeDb('29AABCN4321M1ZB'), 'O', 'customer', 'L1', { state_code: '33' }, 'u'); } catch (e) { refused = e; }
  ok('PATCH state 33 alone against the stored GSTIN 29: refused 400', refused && refused.status === 400 && /29/.test(refused.message));
  log.length = 0;
  const done = await pf.patch(fakeDb(null), 'O', 'customer', 'L1', { tax_ids: [{ scheme: 'GSTIN', value: '29AABCN4321M1ZB' }] }, 'u');
  ok('PATCH a GSTIN alone sets the state to 29 (the UPDATE ran)', log.some((s) => /^UPDATE customer_list SET state_code/.test(s)) && done.changed.indexOf('state_code') >= 0);
  console.log(n + ' checks');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
