/**
 * tests/ae-f03-setup-asks.test.cjs — AE-F-03 (Walk AE 21 Nov): the UAE pack's setup questions (Emirate · VAT period · designated zone) are asked once, at Country setup,
 * kept in entity_governance.tax_registration.asked, and the VAT return reads them instead of asking again.
 * Hand: Dubai + stagger 4 (every month) saved → GET profile answers asked {region:'Dubai', period:'4', zone:'no'}; the return's query becomes { emirate:'Dubai', stagger:'4' };
 * a value the pack does not offer ('Mars') is a 400 in words; the tax answer (registered, TRN) is not touched by a save that sends only particulars.
 * Run: node --test tests/ae-f03-setup-asks.test.cjs · no DB, no network.
 * CARD      15-tax-and-country-packs/country-setup-and-country-lab
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../lib/country-setup');
const A = require('../lib/country-asks');
const db = require('../db');
const schema = require('../lib/schema');

const TRN = '100234567800003';
let ID, GOV;
const h = {
  query: async (sql, params) => {
    const t = String(sql).trim();
    if (/^SELECT \/\* country-setup \*\/ country, currency_code/.test(t)) return { rows: [ID], rowCount: 1 };
    if (/^SELECT \/\* country-setup \*\/ fy_start_month/.test(t)) return { rows: [GOV], rowCount: 1 };
    if (/country-setup constituted/.test(t)) return { rows: [{ products: false, chits: false, entries: false }], rowCount: 1 };
    if (/^UPDATE identities/.test(t)) { ID.country = params[1]; ID.currency_code = params[2]; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE entity_governance/.test(t)) {
      GOV.fy_start_month = params[1]; GOV.setup_source = JSON.parse(params[2]);
      if (/tax_registration = /.test(t)) GOV.tax_registration = params[3] == null ? null : JSON.parse(params[3]);
      return { rows: [], rowCount: 1 };
    }
    if (/books_change_log|INSERT INTO/.test(t)) return { rows: [], rowCount: 1 };
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /.test(t)) return { rows: [], rowCount: 0 };
    throw new Error('ae-f03 test ran unexpected SQL: ' + t.slice(0, 90));
  }
};
const hadColumn = schema.hasColumn, hadSavepoint = db.trySavepoint;
test.beforeEach(() => {
  ID = { country: 'AE', currency_code: 'AED', gstn: TRN, timezone: 'Asia/Dubai', policy_flags: { gst_registration: 'regular' } };
  GOV = { fy_start_month: 1, tax_registration: { registered: true, number: TRN, scheme: 'regular' }, setup_source: {}, country_setup_at: new Date() };
  schema.hasColumn = async () => true;
  db.trySavepoint = async (_h, fn) => { await fn(); return true; };
  CS._reset();
});
test.afterEach(() => { schema.hasColumn = hadColumn; db.trySavepoint = hadSavepoint; CS._reset(); });
const base = (extra) => Object.assign({ country: 'AE', currency: 'AED', fy_start_month: 1 }, extra);
const save = (body) => CS.save(h, 'E1', body, 'owner-1');

test('the UAE pack asks its Emirate, its VAT period and its zone, in its own words; India asks none of them', () => {
  const regulation = require('../lib/regulation');
  const keys = A.asksOf(regulation.packFor('AE')).map((a) => a.key);
  assert.ok(keys.includes('region') && keys.includes('period') && keys.includes('zone'), keys.join());
  assert.equal(A.asksOf(regulation.packFor('AE')).find((a) => a.key === 'region').label, 'Emirate');
  assert.equal(A.asksOf(regulation.packFor('AE')).find((a) => a.key === 'region').options.length, 7);
  assert.deepEqual(A.asksOf(regulation.packFor('IN')), []);
});
test('saved once at setup, read back by the profile, the tax answer untouched', async () => {
  const out = await save(base({ particulars: { region: 'Dubai', period: '4', zone: 'no' } }));
  assert.deepEqual(out.asked, { region: 'Dubai', period: '4', zone: 'no' });
  assert.deepEqual(GOV.tax_registration, { registered: true, number: TRN, scheme: 'regular', asked: { region: 'Dubai', period: '4', zone: 'no' } });
  const again = await save(base({ particulars: { zone: 'yes' } }));
  assert.deepEqual(again.asked, { region: 'Dubai', period: '4', zone: 'yes' }, 'a merge-patch: an omitted key stays');
  await save(base());
  assert.equal(GOV.tax_registration.asked.region, 'Dubai', 'no particulars key: nothing moves');
});
test('a tax save keeps the answers; a clear removes one', async () => {
  await save(base({ particulars: { region: 'Sharjah' } }));
  await save(base({ tax: { registered: true, number: '100-2345-6780-0003', scheme: 'regular' } }));
  assert.equal(GOV.tax_registration.asked.region, 'Sharjah');
  assert.equal(GOV.tax_registration.number, TRN);
  await save(base({ particulars: { region: null } }));
  assert.equal(GOV.tax_registration.asked, undefined);
});
test('a value the pack does not offer, or a key it does not ask, is a 400 in words', async () => {
  for (const particulars of [{ region: 'Mars' }, { colour: 'red' }, { period: '9' }]) {
    await assert.rejects(save(base({ particulars })), (e) => e.status === 400 && /one of|take region/.test(e.message));
  }
});
test('the return reads the held answers; a value the screen sends wins', () => {
  assert.deepEqual(A.returnQueryOf({ region: 'Dubai', period: '4' }, {}), { emirate: 'Dubai', stagger: '4' });
  assert.deepEqual(A.returnQueryOf({ region: 'Dubai', period: '4' }, { emirate: 'Ajman' }), { emirate: 'Ajman', stagger: '4' });
  assert.deepEqual(A.returnQueryOf({}, { period: 'x' }), { period: 'x' });
});
