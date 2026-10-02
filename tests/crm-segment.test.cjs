/**
 * CB CRM — high_value lives in SEGMENT_SQL, the one expression (PLAN Q3, provisional: top 10 % by 12-month bill value,
 * at least 3 bills, the shop can change it, the owner's override wins). Offline: the SQL's shape, and the callers' fall-back
 * when party_item is not there yet (42P01) — offers and the customer list must never fail because the Ledger tables are absent.
 * Run: node tests/crm-segment.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const G = require(path.join(API, 'lib', 'customer-groups'));
const checks = [], it = (w, f) => checks.push([w, f]);
const flat = (s) => s.replace(/\s+/g, ' ');

it('the default rule is top 10 % and at least 3 bills, from party_item bills of the last 12 months', () => {
  const s = flat(G.SEGMENT_SQL);
  assert.ok(/rk <= CEIL\(r\.n \* 10 \/ 100\.0\)/.test(s) && /r\.bills >= 3/.test(s));
  assert.ok(/FROM party_item pi WHERE pi\.entity_id = \$1 AND pi\.side = 'receivable' AND pi\.ref_kind = 'bill'/.test(s), 'reads the Ledger rows for the shop in $1');
  assert.ok(/INTERVAL '12 months'/.test(s));
});
it('the override wins: COALESCE(segment_override, …) is the outermost clause', () => { assert.ok(/^COALESCE\(cl\.segment_override,/.test(flat(G.SEGMENT_SQL))); });
it('high_value is decided before inactive / regular / new', () => {
  const s = flat(G.SEGMENT_SQL); assert.ok(s.indexOf("'high_value'") < s.indexOf("'inactive'") && s.indexOf("'inactive'") < s.indexOf("'regular'") && s.indexOf("'regular'") < s.indexOf("'new'"));
});
it('the shop can change it: segmentSql({pct, minBills}); nonsense falls back to the defaults', () => {
  const s = flat(G.segmentSql({ pct: 25, minBills: 5 })); assert.ok(/\* 25 \/ 100\.0/.test(s) && /r\.bills >= 5/.test(s));
  const d = flat(G.segmentSql({ pct: 'x', minBills: -4 })); assert.ok(/\* 10 \/ 100\.0/.test(d));   /* -4 → max(1,-4)=1 */
  assert.ok(/\* 100 \/ 100\.0/.test(flat(G.segmentSql({ pct: 900 }))), 'capped at 100');
});
it('the base expression is the old one (no party_item) — the fall-back', () => {
  assert.ok(!/party_item/.test(G.SEGMENT_SQL_BASE)); assert.deepStrictEqual(G.SEGMENTS, ['high_value', 'regular', 'new', 'inactive']);
});
it('groupsOf falls back to the base segment on 42P01 (no party_item yet) and still answers', async () => {
  const seen = [];
  const withEntity = async (id, fn) => fn({ query: async (sql) => {
    seen.push(sql); if (/party_item/.test(sql)) { const e = new Error('relation "party_item" does not exist'); e.code = '42P01'; throw e; }
    return { rows: [{ segment: 'regular', groups: ['Wholesale'] }] }; } });
  const g = await G.groupsOf({ seller_id: 'S', viewer_id: 'V', withEntity });
  assert.deepStrictEqual(g, ['customer:V', 'regular', 'group:Wholesale']); assert.strictEqual(seen.length, 2);
});
it('groupsOf with the table present answers high_value', async () => {
  const withEntity = async (id, fn) => fn({ query: async () => ({ rows: [{ segment: 'high_value', groups: [] }] }) });
  assert.deepStrictEqual(await G.groupsOf({ seller_id: 'S', viewer_id: 'V', withEntity }), ['customer:V', 'high_value']);
});
(async () => { let ok = 0; for (const [w, f] of checks) { try { await f(); ok++; console.log('  ok  ' + w); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + w + '\n      ' + e.message); } } console.log('  ' + ok + ' checks'); })();
