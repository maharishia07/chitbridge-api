/**
 * REP-50 (SIT run 2026-10-25): GET /chits/rollup summed total_value across currencies, so an IN chit's rupees were added to an
 * AU shop's dollars at face value. rollupGroups() turns the (key, currency) rows into groups that never add across currencies.
 */
const assert = require('assert');
const { rollupGroups } = require('../routes/chits');

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};

console.log('\n══ ROLL-UP PER CURRENCY (REP-50) ══\n');
const g = rollupGroups([
  { key: 'delivered', currency_code: 'AUD', chits: 2, total_value: '300' },
  { key: 'delivered', currency_code: 'INR', chits: 1, total_value: '45000' },
  { key: 'accepted', currency_code: 'AUD', chits: 4, total_value: '80' },
  { key: 'draft', currency_code: null, chits: 1, total_value: '0' }
]);
const by = (k) => g.find((x) => x.key === k);

ok('a group that mixes currencies has no single total (never 45,300)', () => {
  assert.strictEqual(by('delivered').total_value, null);
  assert.deepStrictEqual(by('delivered').by_currency.map((x) => [x.currency_code, x.total_value]), [['AUD', '300'], ['INR', '45000']]);
  assert.strictEqual(by('delivered').chits, 3);
});
ok('a group in one currency keeps its total, as the old readers expect', () => {
  assert.strictEqual(by('accepted').total_value, '80');
});
ok('a chit with no currency is counted and says so (null), never given the shop\'s', () => {
  assert.strictEqual(by('draft').by_currency[0].currency_code, null);
});
ok('busiest group first, as before', () => {
  assert.deepStrictEqual(g.map((x) => x.key), ['accepted', 'delivered', 'draft']);
});
/* S34 (cb-api, 31 Oct): the route's closed output shape once pruned by_currency under OUTPUT_ALLOWLIST=enforce, so the fix above never reached a reader */
ok('the output allow-list keeps by_currency (nothing of a group is dropped)', () => {
  const allowlist = require('../lib/output-allowlist');
  const shape = allowlist.shapeOf('GET /api/chits/rollup');
  const answer = { group_by: 'state', direction: null, groups: g.concat([Object.assign({}, g[0], { cost_hidden: true })]), dispute_open: 0 };
  assert.deepStrictEqual(allowlist.prune(shape.schema || shape, answer).dropped, []);
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
