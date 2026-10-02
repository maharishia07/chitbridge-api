/**
 * CB CRM — mayTrade: lib/local-identity.mayTrade is the ONE "may this party trade with me?" (onRail + population),
 * with the verdict as a word (local · inactive · shopper · other_population) and the sentence beside it. Offline: the
 * database is a stand-in that answers the one question from ROW. Also the mint of kind 'cus' (~owner.cus-NNNN).
 * Run: node tests/crm-maytrade.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let ROW = null;
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: ROW ? [ROW] : [] }) } };
const L = require(path.join(API, 'lib', 'local-identity')), istest = require(path.join(API, 'lib', 'istest'));
const good = { display_name: 'Chola Auto Care', status: 'active', user_id: 'chola', on_rail: true, same_world: true };
const checks = [], it = (w, f) => checks.push([w, f]);

it('an active business in the same sandbox may trade', async () => { ROW = good; assert.deepStrictEqual(await L.mayTrade('ME', 'P'), { ok: true }); });
it('a minted (~) party → why "local"', async () => {
  ROW = Object.assign({}, good, { on_rail: false, user_id: '~shop.cus-0001' });
  const v = await L.mayTrade('ME', 'P'); assert.strictEqual(v.ok, false); assert.strictEqual(v.why, 'local'); assert.ok(/not on ChitBridge/.test(v.say));
});
it('no longer active → why "inactive"', async () => { ROW = Object.assign({}, good, { on_rail: false, status: 'suspended' }); assert.strictEqual((await L.mayTrade('ME', 'P')).why, 'inactive'); });
it('a storefront shopper → why "shopper"', async () => { ROW = Object.assign({}, good, { on_rail: false, kind: 'shopper' }); assert.strictEqual((await L.mayTrade('ME', 'P')).why, 'shopper'); });
it('another population → why "other_population", both sandboxes named', async () => {
  ROW = Object.assign({}, good, { same_world: false, theirs: 'test', mine: 'live' });
  const v = await L.mayTrade('ME', 'P'); assert.strictEqual(v.why, 'other_population'); assert.ok(/test sandbox/.test(v.say) && /live/.test(v.say));
});
it('nobody by that id → never a throw, why "unknown"', async () => { ROW = null; const v = await L.mayTrade('ME', 'P'); assert.strictEqual(v.ok, false); assert.strictEqual(v.why, 'unknown'); });
it('the SQL is istest\'s, not a copy (one rule)', () => { assert.strictEqual(L.mayTradeSql('i', '$1'), istest.mayTradeSql('i', '$1')); });
it('tillMaySend and the till snapshot ask local-identity, not a second rule', () => {
  const chits = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8'), till = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(/localIdentity\.mayTradeSql\('i', '\$1'\)/.test(chits) && /localIdentity\.mayTrade\(sender_id, eid\)/.test(chits), 'chits.js tillMaySend');
  assert.ok(/local-identity'\)\.mayTradeSql\('i', '\$1'\)/.test(till), 'till.js snapshot');
});
it('mint kind "cus" hands out ~owner.cus-NNNN (the same mint as a supplier, a different series)', async () => {
  const ids = [{ identity_id: 'O', user_id: 'acme', bridge_id: 'B' }];
  const q = async (sql, p) => {
    sql = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT user_id, bridge_id FROM identities/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
    if (/WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && i.display_name.toLowerCase() === p[2]) };
    if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(-1) };
    if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: 'N' + ids.length, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
    throw new Error('unexpected SQL ' + sql.slice(0, 60));
  };
  const a = await L.mint('O', 'Ravi Kumar', { query: q, kind: 'cus' }); assert.strictEqual(a.user_id, '~acme.cus-0001'); assert.strictEqual(a.created, true);
  const b = await L.mint('O', 'ravi  kumar', { query: q, kind: 'cus' }); assert.strictEqual(b.created, false); assert.strictEqual(b.identity_id, a.identity_id);
  const s = await L.mint('O', 'Ravi Kumar', { query: q, kind: 'sup' }); assert.strictEqual(s.user_id, '~acme.sup-0001'); assert.notStrictEqual(s.identity_id, a.identity_id);
});
(async () => { let ok = 0; for (const [w, f] of checks) { try { await f(); ok++; console.log('  ok  ' + w); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + w + '\n      ' + e.message); } } console.log(ok + '/' + checks.length + ' passed'); })();
