/**
 * tests/set87-registered-on.test.cjs — SET-87: the day the shop's tax registration began (entity_governance.tax_registration.registered_on) is written through the ONE setup path
 * (PUT /governance/country-setup, mergeTax_) beside registered, number and scheme.
 * OWNS      the key's rules: 'YYYY-MM-DD', a real calendar day, not in the future in the shop's own zone, MAY be earlier than the shop's sign-up; a merge-patch like its neighbours
 *           (omitted keeps, null keeps, "not registered" clears it); only a registered shop has one; read back by profile().tax.registered_on; a shop that never said it has no key at all.
 * CALLED BY scripts/guards.cjs · CI. No DB, no network: the REAL country-setup.save over the in-memory handle of tests/set86-country-setup-merge.test.cjs (an Indian rig: the key is country-neutral).
 * CARD      20-settings-governance-and-plan/README
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('./support/tax-stub.cjs');
const CS = require('../lib/country-setup');
const db = require('../db');
const schema = require('../lib/schema');
test.before(X.start);
test.after(X.stop);

const GSTIN = '33AAAAA0000A1Z9'; /* the valid-checksum number country-setup.test.cjs uses */
const NEW_GSTIN = '27AAPFU0939F1ZV';
let ID, GOV, SQLS, LOGGED;
const parseSets = (sql, params) => {
  const at = (re) => { const m = re.exec(sql); return m ? params[Number(m[1]) - 1] : undefined; };
  return { gstn: /gstn = \$/.test(sql) ? at(/gstn = \$(\d+)/) : undefined, flag: /policy_flags/.test(sql) ? at(/policy_flags,'\{\}'::jsonb\) \|\| \$(\d+)::jsonb/) : undefined, tz: at(/COALESCE\(\$(\d+), timezone\)/) };
};
const h = {
  query: async (sql, params) => {
    const t = String(sql).trim();
    SQLS.push(t);
    if (/^SELECT \/\* country-setup \*\/ country, currency_code/.test(t)) return { rows: [ID], rowCount: 1 };
    if (/^SELECT \/\* country-setup \*\/ fy_start_month/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
    if (/country-setup constituted/.test(t)) return { rows: [{ products: false, chits: false, entries: false }], rowCount: 1 };
    if (/^UPDATE identities/.test(t)) {
      const s = parseSets(t, params);
      ID.country = params[1]; ID.currency_code = params[2];
      if (s.gstn !== undefined) ID.gstn = s.gstn;
      if (s.flag !== undefined) ID.policy_flags = Object.assign({}, ID.policy_flags, JSON.parse(s.flag));
      if (s.tz) ID.timezone = s.tz;
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE entity_governance/.test(t)) {
      GOV.fy_start_month = params[1]; GOV.setup_source = JSON.parse(params[2]);
      if (/tax_registration = /.test(t)) GOV.tax_registration = params[3] == null ? null : JSON.parse(params[3]);
      GOV.country_setup_at = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (/books_change_log|INSERT INTO/.test(t)) { LOGGED.push(params); return { rows: [], rowCount: 1 }; }
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(t)) return { rows: [], rowCount: 0 };
    throw new Error('set86 test ran unexpected SQL: ' + t.slice(0, 90));
  }
};
const hadColumn = schema.hasColumn;
const hadSavepoint = db.trySavepoint;
test.beforeEach(() => {
  SQLS = []; LOGGED = [];
  ID = { country: 'IN', currency_code: 'INR', gstn: GSTIN, timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } };
  GOV = { fy_start_month: 4, tax_registration: { registered: true, number: GSTIN, scheme: 'regular' }, setup_source: { tax: 'typed', country: 'confirmed by the owner' }, country_setup_at: new Date() };
  schema.hasColumn = async () => true;
  db.trySavepoint = async (_h, fn) => { await fn(); return true; };
  CS._reset();
});
test.afterEach(() => { schema.hasColumn = hadColumn; db.trySavepoint = hadSavepoint; CS._reset(); });

const snap = () => JSON.stringify({ ID, GOV: Object.assign({}, GOV, { country_setup_at: null }) });
const base = (extra) => Object.assign({ country: 'IN', currency: 'INR', fy_start_month: 4 }, extra);
const save = (body) => CS.save(h, 'E1', body, 'owner-1');
const refused = async (body) => { try { await save(body); } catch (e) { return e; } return null; };
const DAY = '2024-07-01';
const SOON = () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

test('1 · a day sent with the registration is written beside registered, number and scheme, and read back by profile()', async () => {
  await save(base({ tax: { registered: true, number: GSTIN, scheme: 'regular', registered_on: DAY } }));
  assert.equal(GOV.tax_registration.registered_on, DAY);
  assert.equal(GOV.tax_registration.number, GSTIN);
  const p = await CS.profile(h, 'E1');
  assert.equal(p.tax.registered_on, DAY);
});

test('2 · a day earlier than the shop\'s sign-up is fine (created later than registered)', async () => {
  await save(base({ tax: { registered_on: '1999-04-01' } }));
  assert.equal(GOV.tax_registration.registered_on, '1999-04-01');
});

test('3 · merge-patch: omitted and null keep the held day; a new day replaces it', async () => {
  GOV.tax_registration.registered_on = DAY;
  await save(base({ tax: { registered: true } }));
  assert.equal(GOV.tax_registration.registered_on, DAY, 'omitted keeps');
  await save(base({ tax: { registered_on: null } }));
  assert.equal(GOV.tax_registration.registered_on, DAY, 'null keeps (never clears)');
  await save(base({ tax: { registered_on: '2025-01-15' } }));
  assert.equal(GOV.tax_registration.registered_on, '2025-01-15');
  await save(base());
  assert.equal(GOV.tax_registration.registered_on, '2025-01-15', 'no tax block at all: untouched');
});

test('4 · refused in words, nothing written: not a real day, wrong shape, the future', async () => {
  for (const [bad, words] of [['2025-02-30', /real date/], ['01/07/2024', /real date/], ['2024-7-1', /real date/], ['yesterday', /real date/], [20240701, /real date/], ['1850-01-01', /real date/], [SOON(), /future/]]) {
    const before = snap();
    const e = await refused(base({ tax: { registered_on: bad } }));
    assert.ok(e && e.status === 400 && words.test(e.message), JSON.stringify(bad) + ' → ' + (e && e.status + ' ' + e.message));
    assert.equal(snap(), before, 'nothing written for ' + JSON.stringify(bad));
  }
});

test('5 · today in the shop\'s zone is allowed (not the future)', async () => {
  await save(base({ tax: { registered_on: require('../lib/shop-clock').today('Asia/Kolkata') } }));
  assert.ok(GOV.tax_registration.registered_on);
});

test('6 · "not registered" (confirmed) clears the day with the number and scheme', async () => {
  GOV.tax_registration.registered_on = DAY;
  await save(base({ tax: { registered: false, number: null, scheme: null }, confirm_deregister: true }));
  assert.equal(GOV.tax_registration.registered, false);
  assert.equal(GOV.tax_registration.registered_on, undefined);
});

test('7 · only a registered shop has a day: a day beside "not registered" or an unknown answer is refused', async () => {
  GOV.tax_registration = null; ID.gstn = null; ID.policy_flags = {};
  const e = await refused(base({ tax: { registered_on: DAY } }));
  assert.ok(e && e.status === 400 && /registered/.test(e.message), e && e.message);
  assert.equal(GOV.tax_registration, null);
});

test('8 · a shop that never said it has no key: the stored answer is byte for byte as before', async () => {
  await save(base({ tax: { registered: true, number: GSTIN, scheme: 'regular' } }));
  assert.ok(!('registered_on' in GOV.tax_registration));
  const p = await CS.profile(h, 'E1');
  assert.ok(!('registered_on' in p.tax));
});
