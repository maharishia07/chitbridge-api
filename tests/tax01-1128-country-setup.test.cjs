/**
 * tests/tax01-1128-country-setup.test.cjs — VERIFY-TAX-01 rows 3 and 7 (batch 1128).
 * OWNS      row 3: a registration scheme the shop's PACK does not offer is refused (AU and AE have no composition; India does); a HELD scheme the corrected country lacks drops to regular, never a refusal.
 *           row 7: re-saving Country setup keeps a registration flag the form did not send (a shop flagged 'sez' stays 'sez').
 * CALLED BY CI / node --test tests/tax01-1128-country-setup.test.cjs · no DB, no network (the in-memory handle of set86-country-setup-merge).
 * HAND FIGURES (minor units): AU shop, one item 10000 (A$100.00) at 10% GST → 1000 tax, 11000 total when registered regular; flagged composition the invoice would carry 0 tax and total 10000,
 *           a loss of 1000 per invoice. The refusal is what keeps the 1000.
 * CARD      15-tax-and-country-packs/country-setup
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../lib/country-setup');
const db = require('../db');
const schema = require('../lib/schema');

const GSTIN = '33AAAAA0000A1Z9';
const ABN = '51824753556';
let ID, GOV, SQLS;
const h = {
  query: async (sql, params) => {
    const t = String(sql).trim();
    SQLS.push(t);
    if (/^SELECT \/\* country-setup \*\/ country, currency_code/.test(t)) return { rows: [ID], rowCount: 1 };
    if (/^SELECT \/\* country-setup \*\/ fy_start_month/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
    if (/country-setup constituted/.test(t)) return { rows: [{ products: false, chits: false, entries: false }], rowCount: 1 };
    if (/^UPDATE identities/.test(t)) {
      ID.country = params[1];
      ID.currency_code = params[2];
      const f = /policy_flags,'\{\}'::jsonb\) \|\| \$(\d+)::jsonb/.exec(t);
      if (f) ID.policy_flags = Object.assign({}, ID.policy_flags, JSON.parse(params[Number(f[1]) - 1]));
      const g = /gstn = \$(\d+)/.exec(t);
      if (g) ID.gstn = params[Number(g[1]) - 1];
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE entity_governance/.test(t)) {
      GOV.fy_start_month = params[1];
      GOV.setup_source = JSON.parse(params[2]);
      if (/tax_registration = /.test(t)) GOV.tax_registration = params[3] == null ? null : JSON.parse(params[3]);
      return { rows: [], rowCount: 1 };
    }
    if (/books_change_log|INSERT INTO/.test(t)) return { rows: [], rowCount: 1 };
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(t)) return { rows: [], rowCount: 0 };
    throw new Error('tax01 test ran unexpected SQL: ' + t.slice(0, 90));
  }
};
const hadColumn = schema.hasColumn;
const hadSavepoint = db.trySavepoint;
test.beforeEach(() => {
  SQLS = [];
  ID = { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} };
  GOV = { fy_start_month: 7, tax_registration: null, setup_source: {}, country_setup_at: null };
  schema.hasColumn = async () => true;
  db.trySavepoint = async (_h, fn) => { await fn(); return true; };
  CS._reset();
});
test.afterEach(() => { schema.hasColumn = hadColumn; db.trySavepoint = hadSavepoint; CS._reset(); });
const save = (body) => CS.save(h, 'E1', body, 'owner-1');
const refused = async (body) => { try { await save(body); } catch (e) { return e; } return null; };

test('3a · an AU shop cannot be saved as composition: refused in words, nothing written (it would bill 10000 not 11000)', async () => {
  const e = await refused({ country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: true, number: ABN, scheme: 'composition' } });
  assert.ok(e, 'refused');
  assert.equal(e.status, 400);
  assert.equal(e.code, 'COUNTRY_SETUP_BAD');
  assert.ok(!SQLS.some((s) => /^UPDATE/.test(s)), 'no row written');
  const ok = await refused({ country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: true, number: ABN, scheme: 'regular' } });
  assert.equal(ok, null, ok && ok.message);
  assert.equal(ID.policy_flags.gst_registration, 'regular');
});

test('3b · the schemes come from the pack: India regular or composition, AU and AE regular only', () => {
  const { schemesOf } = require('../lib/tax-facts');
  assert.deepEqual(schemesOf('IN'), ['regular', 'composition']);
  assert.deepEqual(schemesOf('AU'), ['regular']);
  assert.deepEqual(schemesOf('AE'), ['regular']);
  assert.deepEqual(schemesOf('ZZ'), ['regular', 'composition'], 'no pack: the old list stands, nothing refused on a rule nobody wrote');
});

test('3c · an Indian composition shop still saves as composition (the pack offers it)', async () => {
  ID = { country: 'IN', currency_code: 'INR', gstn: GSTIN, timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } };
  GOV = { fy_start_month: 4, tax_registration: { registered: true, number: GSTIN, scheme: 'regular' }, setup_source: {}, country_setup_at: new Date() };
  const e = await refused({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: GSTIN, scheme: 'composition' } });
  assert.equal(e, null, e && e.message);
  assert.equal(ID.policy_flags.gst_registration, 'composition');
});

test('3d · a HELD composition scheme, the country corrected to AU before any sale: dropped to regular, not refused', async () => {
  const books = require('../lib/books');
  const had = books.reseedUnposted;
  books.reseedUnposted = async () => null; /* the chart re-seed is books' own test; this one is about the scheme */
  try {
  ID = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'composition' } };
  GOV = { fy_start_month: 4, tax_registration: { registered: true, number: null, scheme: 'composition' }, setup_source: {}, country_setup_at: new Date() };
  const e = await refused({ country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: ABN } });
  assert.equal(e, null, e && e.message);
  assert.equal(GOV.tax_registration.scheme, 'regular');
  assert.equal(ID.policy_flags.gst_registration, 'regular');
  } finally { books.reseedUnposted = had; }
});

test('7 · re-saving with no scheme keeps a flag the form never sent (sez stays sez); a scheme sent still writes', async () => {
  ID = { country: 'IN', currency_code: 'INR', gstn: GSTIN, timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'sez' } };
  GOV = { fy_start_month: 4, tax_registration: { registered: true, number: GSTIN, scheme: 'regular' }, setup_source: {}, country_setup_at: new Date() };
  await save({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: GSTIN } });
  assert.equal(ID.policy_flags.gst_registration, 'sez', 'not flattened to regular');
  await save({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: GSTIN, scheme: 'regular' } });
  assert.equal(ID.policy_flags.gst_registration, 'regular', 'an explicit scheme is written');
  await save({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false }, confirm_deregister: true });
  assert.equal(ID.policy_flags.gst_registration, 'unregistered', 'an explicit no still writes its flag');
});

test('11 · a number sent with no answer to "registered?" is refused in words, never dropped to null with a 200', async () => {
  ID = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} };
  GOV = { fy_start_month: 4, tax_registration: null, setup_source: {}, country_setup_at: new Date() };
  const e = await refused({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { number: '27AAPFU0939F1ZV' } });
  assert.ok(e && e.status === 400 && e.code === 'COUNTRY_SETUP_BAD', e && e.message);
  assert.match(e.message, /registered/);
  assert.ok(!SQLS.some((s) => /^UPDATE/.test(s)), 'nothing written');
  assert.equal(ID.gstn, null);
});

test('14 · the flag "unregistered" with no tax_registration row reads registered false, as registrationOf reads it; no flags object does not throw', () => {
  const { taxFactsOf } = require('../lib/tax-facts');
  assert.deepEqual(taxFactsOf(null, null, { gst_registration: 'unregistered' }, true), { registered: false, number: null, scheme: null });
  assert.equal(CS.registrationOf({ number: null, scheme: 'unregistered', tax_registration: null }), 'unregistered');
  assert.deepEqual(taxFactsOf(null, null, undefined, true), { registered: null, number: null, scheme: null });
  assert.deepEqual(taxFactsOf({ registered: true, scheme: 'regular' }, '33AAAAA0000A1Z9', { gst_registration: 'regular' }, true), { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' });
});
