/**
 * ⭐⭐⭐ MAY THESE TWO TRADE? — lib/istest mayTrade is the DATABASE's rule, asked at the door (Athi, 2026-10-02).
 *
 * The rule lives in b249's chit_populations_must_match trigger. lib/istest repeats it so Add customer, Add supplier, the
 * counter's offer and the counter's send all say no EARLY, in the same words. A repeated rule drifts, so this holds the
 * two together: the trigger's four clauses must still be there, and the helper's SQL must carry each of them.
 * And mayTrade() itself, against a stubbed database: the reasons a shopkeeper reads.
 * Run: node tests/may-trade.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

/* a database that answers mayTrade's one question from ROW */
let ROW = null;
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: ROW ? [ROW] : [] }) } };
const istest = require(path.join(API, 'lib', 'istest'));

const MIG = fs.readFileSync(path.join(API, 'migrations', 'b249_population_as_a_value.sql'), 'utf8');
const TRIG = MIG.slice(MIG.indexOf('FUNCTION chit_populations_must_match'), MIG.indexOf('$fn$;', MIG.indexOf('FUNCTION chit_populations_must_match')));

const checks = [];
const it = (what, fn) => checks.push([what, fn]);

it('the trigger still has its four clauses (if this fails, the rule changed — change lib/istest with it)', () => {
  assert.ok(TRIG.length > 100, 'chit_populations_must_match is gone from b249');
  assert.ok(/IF mine IS NULL OR theirs IS NULL THEN RETURN NEW/.test(TRIG), 'unknown population → allowed');
  assert.ok(/coalesce\(mine_all, false\) OR coalesce\(theirs_all, false\)/.test(TRIG), 'serves_all_populations → allowed');
  assert.ok(/IF mine IS DISTINCT FROM theirs THEN\s+RAISE EXCEPTION/.test(TRIG), 'different populations → refused');
});
it('sameWorldSql carries the same clauses: both known, both not serving all, and different → not the same world', () => {
  const s = istest.sameWorldSql('i', '$1');
  assert.ok(/NOT EXISTS/.test(s));
  assert.ok((s.match(/IS NOT NULL/g) || []).length === 2, 'both populations must be known before they can differ');
  assert.ok((s.match(/serves_all_populations/g) || []).length === 2, 'either side serving all populations must pass');
  assert.ok(/<>/.test(s), 'different populations must fail');
  assert.ok(/to_jsonb/.test(s), 'must read through to_jsonb, so it runs before b249 too');
});
it('mayTradeSql = on the rail (lib/local-identity) AND the same world', () => {
  const s = istest.mayTradeSql('i', '$1');
  assert.ok(s.indexOf(require(path.join(API, 'lib', 'local-identity')).onRailSql('i')) >= 0, 'not the on-rail rule');
  assert.ok(s.indexOf(istest.sameWorldSql('i', '$1')) >= 0, 'not the same-world rule');
});

const ME = '11111111-1111-4111-8111-111111111111', THEM = '22222222-2222-4222-8222-222222222222';
it('mayTrade: an active business in the same sandbox → ok', async () => {
  ROW = { display_name: 'Chola Auto Care', status: 'active', user_id: 'chola', on_rail: true, same_world: true };
  assert.deepStrictEqual(await istest.mayTrade(ME, THEM), { ok: true });
});
it('mayTrade: another sandbox → no, and it names both', async () => {
  ROW = { display_name: 'Mayuri Bhavan', status: 'active', user_id: 'mayuri123', on_rail: true, same_world: false, theirs: 'test', mine: 'live' };
  const v = await istest.mayTrade(ME, THEM);
  assert.strictEqual(v.ok, false); assert.strictEqual(v.why, 'Mayuri Bhavan is in the test sandbox and this shop is in live');
});
it('mayTrade: no longer active → no, "no longer active on ChitBridge"', async () => {
  ROW = { display_name: 'Village One', status: 'inactive', user_id: 'village1', on_rail: false, same_world: true };
  const v = await istest.mayTrade(ME, THEM);
  assert.strictEqual(v.ok, false); assert.ok(/no longer active on ChitBridge/.test(v.why), v.why);
});
it('mayTrade: a local (~) record → no, "not on ChitBridge"', async () => {
  ROW = { display_name: 'Corner Store', status: 'active', user_id: '~tallytest.cus-0001', on_rail: false, same_world: true };
  const v = await istest.mayTrade(ME, THEM);
  assert.strictEqual(v.ok, false); assert.ok(/is not on ChitBridge/.test(v.why), v.why);
});
it('mayTrade: nobody by that id → no, never a throw', async () => {
  ROW = null;
  const v = await istest.mayTrade(ME, THEM);
  assert.strictEqual(v.ok, false); assert.ok(/not found/.test(v.why), v.why);
});

(async () => {
  console.log('\n══ MAY THESE TWO TRADE? — the database rule, at the door ══\n');
  let pass = 0;
  for (const [what, fn] of checks) {
    try { await fn(); pass++; console.log('  ok   ' + what); }
    catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; }
  }
  console.log('\n  ' + (process.exitCode ? '✗' : '✓') + ' ' + pass + ' passed · ' + checks.length + ' checks\n');
})();
