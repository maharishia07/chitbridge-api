/**
 * tests/trade-lanes.test.cjs — TRADE LANES FOR EVERY COUNTRY, HONEST DEFAULTS (TRADE-SRV1 G1 · G2 · G3 · G8, 2026-10-14). No database.
 *
 *   G1  b571 adds AU and AE lanes idempotently and renames "Domestic (India)" to "India"; `domestic` is DERIVED (dest == the shop's country).
 *   G2  the lane's origin is the SHOP's country (identities.country), never 'IN'; no country → refused 422 TRADE_ORIGIN_UNSTATED in words;
 *       the sector is the shop's stated one, never 'paint'; none → the lane still resolves and `asked` names the sector with its code.
 *       Siblings: the profile readiness/path carry no 'EU' / 'IN' / 'paint' stand-ins; the India-only GST header row is not pushed on an AU shop.
 *   G3  folder-inventory.abroadSql — the one abroad predicate the chit lists add: sender ∪ recipients, country differs from the shop's, unknown ≠ abroad.
 *   G8  trade-may: a key and a viewer are refused with a code and the sentence; an editor and the owner may.
 * Run: node tests/trade-lanes.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

/* ── a database that answers by statement ── */
const SHOP = '11111111-1111-4111-8111-111111111111';
let COUNTRY = 'AU', SECTORS = [];
const JURIS = [{ dest_key: 'EU', name: 'European Union', domestic: false }, { dest_key: 'US', name: 'United States', domestic: false }, { dest_key: 'GULF', name: 'Gulf (GCC)', domestic: false },
  { dest_key: 'IN', name: 'India', domestic: true }, { dest_key: 'AU', name: 'Australia', domestic: false }, { dest_key: 'AE', name: 'United Arab Emirates', domestic: false }];
const STDS = [
  { standard_key: 'iso-9001', title: 'ISO 9001', applicability: {}, guidance: 'universal' },
  { standard_key: 'exim-policy', title: 'Export policy', applicability: { cross_border: true }, guidance: 'export' },
  { standard_key: 'sds', title: 'SDS', applicability: { categories: ['chemical'] }, guidance: 'chemical' },
  { standard_key: 'bis', title: 'BIS', applicability: { destination: ['IN'] }, guidance: 'india import' },
];
const SQL = [];
async function answer(text, params) {
  SQL.push(String(text).replace(/\s+/g, ' ').trim());
  const t = String(text);
  if (/FROM identities WHERE identity_id/.test(t)) return { rows: [{ country: COUNTRY, currency_code: COUNTRY === 'AU' ? 'AUD' : null, display_name: 'Shop', gstn: null, address: null, phone: null, email: null, policy_flags: {} }] };
  if (/FROM jurisdiction/.test(t)) return { rows: JURIS };
  if (/FROM vertical_category/.test(t)) return { rows: params && params[0] === 'paint' ? [{ category: 'chemical' }] : [] };
  if (/FROM standard_source/.test(t)) return { rows: STDS };
  if (/FROM standard_document/.test(t)) return { rows: (params[0] || []).map((k) => ({ standard_key: k, doc_key: k + '_doc', title: k, scope: 'entity', frequency: 'once', display_order: 1 })) };
  if (/FROM entity_profile/.test(t)) return { rows: [{ trade_mode: 'export', markets: ['AE'], sectors: SECTORS, adopted: [] }] };
  if (/FROM entity_compliance/.test(t)) return { rows: [] };
  return { rows: [] };
}
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: answer, withEntity: async (_e, fn) => fn({ query: answer }), readBatch: async (_e, _a, stmts) => Promise.all(stmts.map((s) => answer(s.text, s.params))), withTransaction: async (fn) => fn({ query: answer }) } };

const R = require(path.join(API, 'lib', 'readiness'));
const P = require(path.join(API, 'lib', 'profile'));
const TM = require(path.join(API, 'lib', 'trade-may'));
const INV = require(path.join(API, 'lib', 'folder-inventory'));

const checks = [];
const it = (what, fn) => checks.push([what, fn]);

/* ── G1 · the migration ── */
const MIG = fs.readFileSync(path.join(API, 'migrations', 'b571_trade_lanes_au_ae.sql'), 'utf8');
it('b571 inserts AU and AE as lanes, idempotently (ON CONFLICT DO NOTHING), and renames India\'s lane', () => {
  assert.ok(/\('AU',\s*'Australia'/.test(MIG) && /\('AE',\s*'United Arab Emirates'/.test(MIG), 'AU and AE rows');
  assert.ok(/ON CONFLICT \(dest_key\) DO NOTHING/.test(MIG), 'idempotent');
  assert.ok(/UPDATE jurisdiction SET name = 'India'/.test(MIG), 'India, not Domestic (India)');
  assert.ok(!/DROP|DELETE/.test(MIG), 'nothing dropped');
  assert.ok(/RLS/.test(MIG), 'RLS stated');
});
it('b571 is the only migration this round writes, in its reserved number', () => {
  const mine = fs.readdirSync(path.join(API, 'migrations')).filter((f) => /^b57[123]_/.test(f));
  assert.deepStrictEqual(mine, ['b571_trade_lanes_au_ae.sql']);
});

/* ── G2 · origin and sector ── */
it('an AU shop\'s lanes come FROM AU: origin AU, the AU lane domestic, India\'s not; AU → AE carries the cross-border rule, AU → AU does not', async () => {
  COUNTRY = 'AU'; SECTORS = [];
  const m = await R.resolveLaneMatrix(SHOP, 'paint', undefined);
  assert.strictEqual(m.origin, 'AU');
  const au = m.lanes.find((l) => l.dest_key === 'AU'), ae = m.lanes.find((l) => l.dest_key === 'AE'), inL = m.lanes.find((l) => l.dest_key === 'IN');
  assert.ok(au && au.domestic === true, 'AU is the domestic lane');
  assert.ok(inL && inL.domestic === false, 'India is not domestic for an AU shop');
  assert.ok(ae && ae.domestic === false);
  const toAE = await R.resolveForDestination(SHOP, 'AE', 'paint', undefined), toAU = await R.resolveForDestination(SHOP, 'AU', 'paint', undefined);
  assert.ok(toAE.standards.indexOf('exim-policy') >= 0 && toAE.domestic === false, 'export rule applies abroad');
  assert.ok(toAU.standards.indexOf('exim-policy') < 0 && toAU.domestic === true, 'no export rule at home');
  assert.ok(toAE.standards.indexOf('bis') < 0, 'India\'s import rule does not follow an AU → AE lane');
});
it('no country → the lane is REFUSED in words with TRADE_ORIGIN_UNSTATED (422), never read as India', async () => {
  COUNTRY = null;
  let err = null; try { await R.resolveLaneMatrix(SHOP, 'paint', undefined); } catch (e) { err = e; }
  assert.ok(err && err.code === 'TRADE_ORIGIN_UNSTATED' && err.status === 422 && /Country setup/.test(err.say), JSON.stringify(err && { code: err.code, say: err.say }));
  COUNTRY = 'AU';
});
it('no sector stated → the lane still resolves (universal + cross-border) and `asked` names the sector with its code; a stated sector is used', async () => {
  COUNTRY = 'AU'; SECTORS = [];
  const m = await R.resolveLaneMatrix(SHOP, undefined, undefined);
  assert.strictEqual(m.vertical, null);
  assert.deepStrictEqual(m.asked.map((a) => a.code), ['TRADE_SECTOR_UNSTATED']);
  const ae = m.lanes.find((l) => l.dest_key === 'AE');
  assert.ok(ae.gaps.indexOf('SDS') < 0 && ae.gaps.indexOf('Export policy') >= 0, 'no chemical rule without a sector; the export rule stands');
  SECTORS = ['paint'];
  const m2 = await R.resolveLaneMatrix(SHOP, undefined, undefined);
  assert.strictEqual(m2.vertical, 'paint'); assert.deepStrictEqual(m2.asked, []);
  assert.ok(m2.lanes.find((l) => l.dest_key === 'AE').gaps.indexOf('SDS') >= 0, 'the stated sector\'s rule applies');
});
it('the source carries no India / paint / EU stand-in any more (readiness · profile · forms)', () => {
  const rd = fs.readFileSync(path.join(API, 'lib', 'readiness.js'), 'utf8'), pf = fs.readFileSync(path.join(API, 'lib', 'profile.js'), 'utf8'), fm = fs.readFileSync(path.join(API, 'lib', 'forms.js'), 'utf8');
  assert.ok(!/origin \|\| 'IN'/.test(rd) && !/vertical \|\| 'paint'/.test(rd), 'readiness');
  assert.ok(!/\['paint'\]|\['EU'\]|\['IN'\]|'IN'\)/.test(pf.slice(pf.indexOf('async function resolveProfileReadiness'), pf.indexOf('async function resolvePath') + 900)), 'profile');
  assert.ok(!/fn: 'india'/.test(fm) && !/=== 'india'\) return/.test(fm), 'forms');
});
it('the profile readiness / path read the shop\'s country as origin and its own country as the domestic market', async () => {
  COUNTRY = 'AU'; SECTORS = ['paint'];
  const p = await P.resolvePath(SHOP);
  assert.strictEqual(p.origin, 'AU'); assert.strictEqual(p.sector, 'paint');
  assert.ok(p.lanes.find((l) => l.dest_key === 'AE').in_profile === true, 'the stated market is marked');
  const r = await P.resolveProfileReadiness(SHOP);
  assert.strictEqual(r.origin, 'AU'); assert.ok(r.clearances.length > 0);
});
it('the GST Rule 46 header row is India\'s: an AU shop\'s own readiness does not carry it', async () => {
  COUNTRY = 'AU';
  const r = await R.resolveReadiness(SHOP);
  assert.ok(!r.clearances.some((c) => c.standard === 'IN-GST'), 'no IN-GST row for AU');
  COUNTRY = 'IN';
  const r2 = await R.resolveReadiness(SHOP);
  assert.ok(r2.clearances.some((c) => c.standard === 'IN-GST'), 'the row stays for an Indian shop');
  COUNTRY = 'AU';
});

/* ── G3 · the abroad predicate ── */
it('abroadSql: sender ∪ recipients, other than me, country KNOWN and different from the shop\'s (shopCountrySql) — one expression', () => {
  const s = INV.abroadSql('ch', 3).replace(/\s+/g, ' ');
  assert.ok(/ch\.sender_entity_id UNION/.test(s), 'the sender');
  assert.ok(/jsonb_array_elements\(COALESCE\(ch\.all_recipients/.test(s), 'the recipients');
  assert.ok(/z\.identity_id <> \$3::uuid/.test(s), 'not me');
  assert.ok(/z\.country IS NOT NULL/.test(s), 'unknown is not abroad');
  assert.ok(/UPPER\(z\.country\) <> UPPER\(\(SELECT country FROM identities WHERE identity_id = \$3\)\)/.test(s), 'the shop\'s country from the one fragment');
  const chits = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  assert.ok(/req\.query\.abroad === '1'/.test(chits) && /FOLDER_INV\.abroadSql\('ch', params\.length\)/.test(chits), 'chitFilters adds it from the one helper');
  assert.strictEqual((chits.match(/abroadSql/g) || []).length, 1, 'no second copy of the predicate in the router');
});

/* ── G8 · may/why ── */
it('trade-may: an API key and a viewer are refused with a code and the sentence; an editor and the entity itself may', () => {
  assert.deepStrictEqual(TM.mayWrite({ api_key: { jti: 'k' }, identity: { identity_type: 'entity' } }).code, 'TRADE_KEY_NOT_ALLOWED');
  assert.deepStrictEqual(TM.mayWrite({ identity: { identity_type: 'actor', access_level: 'viewer' } }).code, 'TRADE_READ_ONLY');
  assert.deepStrictEqual(TM.mayWrite({ identity: { identity_type: 'actor', access_level: 'commenter' } }).may, false);
  assert.deepStrictEqual(TM.mayWrite({ identity: { identity_type: 'actor', access_level: 'editor' } }), { may: true, why: null, code: null });
  assert.deepStrictEqual(TM.mayWrite({ identity: { identity_type: 'entity' } }).may, true);
  const m = TM.mayOf({ api_key: {} }, ['gather', 'verify']);
  assert.ok(m.gather.may === false && m.verify.why === TM.CODES.TRADE_KEY_NOT_ALLOWED);
  let sent = null; const res = { status(c) { this.c = c; return this; }, json(j) { sent = Object.assign({ status: this.c }, j); } };
  assert.strictEqual(TM.refuse({ api_key: {} }, res), true);
  assert.ok(sent.status === 403 && sent.code === 'TRADE_KEY_NOT_ALLOWED' && sent.message === sent.error, JSON.stringify(sent));
  assert.strictEqual(TM.refuse({ identity: { identity_type: 'entity' } }, res), false);
});
it('every trade write asserts it and the trade GETs say it (routes/governance.js · routes/forms.js)', () => {
  const g = fs.readFileSync(path.join(API, 'routes', 'governance.js'), 'utf8'), f = fs.readFileSync(path.join(API, 'routes', 'forms.js'), 'utf8');
  for (const door of ["router.post('/compliance'", "router.post('/verify'", "router.put('/profile'"]) {
    const i = g.indexOf(door); assert.ok(i > 0, door);
    assert.ok(/TM\.refuse\(req, res\)/.test(g.slice(i, i + 200)), door + ' refuses');
  }
  for (const door of ["router.post('/:key/issue'", "router.post('/instances/:id/sign'", "router.post('/instances/:id/attach'"]) {
    const i = f.indexOf(door); assert.ok(i > 0, door);
    assert.ok(/TM\.refuse\(req, res\)/.test(f.slice(i, i + 200)), door + ' refuses');
  }
  assert.ok(/TM\.mayOf\(req, \['gather', 'verify'\]\)/.test(g), 'readiness and lanes carry may');
  assert.ok(/TM\.mayOf\(req, \['issue', 'sign', 'attach'\]\)/.test(f), 'the forms list carries may');
  assert.ok(/err\.say \? res\.status\(err\.status \|\| 422\)\.json\(\{ code: err\.code/.test(g), 'a refused lane answers its code in words, not a 500');
});

(async () => {
  let pass = 0, fail = 0;
  for (const [what, fn] of checks) {
    try { await fn(); pass++; console.log('   ok   ' + what); } catch (e) { fail++; console.log('   FAIL ' + what + '\n          ' + (e && e.message)); }
  }
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
