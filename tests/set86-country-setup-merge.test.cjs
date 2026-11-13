/**
 * tests/set86-country-setup-merge.test.cjs — SET-86 (P1, money): PUT /governance/country-setup is a MERGE-PATCH. An omitted key is unchanged; a null never
 * clears a known answer; "not registered" is only the owner's explicit, confirmed answer (never a default for an unasked fact).
 *
 * The REAL country-setup.save runs over an in-memory handle that holds the shop's identities row and entity_governance row. The money is read through the
 * REAL /api/tax/compute route (tests/support/tax-stub.cjs) over the SAME state, never a second formula:
 *   100.00 at 5% PRICE-INCLUSIVE → tax = 10000 × 5 / 105 = 476.19 → 476 minor = 4.76 · taxable 95.24 · total 100.00 (hand-computed; exclusive: 5.00 / 105.00)
 *   1  omitted tax block → registration, number, flag and source unchanged → the invoice still carries 4.76 (on main: 0.00 and a 409)
 *   2  tax {} / registered null / null number+scheme over a known answer → unchanged · a first setup with nothing said stays NULL (unknown)
 *   3  gstn present, answer NULL, send false → 409 TAX_DEREGISTER_UNCONFIRMED (the number counts as a registration) · nothing written
 *   4  explicit false + confirm_deregister → cleared (number, scheme, flag 'unregistered'), logged, and the invoice carries 0.00 tax (the owner's answer)
 *   5  the web's body (registered false, number null, scheme null) clears with the confirm · a re-save of an unregistered shop needs none
 *   6  an unknown key inside the tax answer is refused by name, nothing written · partial tax merges (number only) · source merges key by key through confirmedSource
 *   7  every path ends with forget(entity) and reads the governance row FOR UPDATE (two saves merge over each other, never over a stale read)
 * Run: node --test tests/set86-country-setup-merge.test.cjs · no DB, no network. The real-Postgres twin: tests/set86-country-setup-merge.realstack.cjs (cb_app).
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
/** the invoice of 100.00 at 5% price-inclusive for the shop as the state now holds it, through the real compute route */
async function invoice() {
  X.SHOP.row = X.shopRow({ gstin: ID.gstn, name: 'Ponni', country: ID.country, policy: ID.policy_flags });
  X.SHOP.items = [];
  const asked = db.query, askedWith = db.withEntity;
  db.query = async (sql, params) => (/FROM entity_governance/.test(sql) ? { rows: [GOV] } : asked(sql, params));
  db.withEntity = async (_id, fn) => fn({ query: db.query });
  try {
    const r = await X.call('POST', '/api/tax/compute', { lines: [{ key: 'a', name: 'Tea', qty: 1, price: 100, gst_rate: 5 }], priceIncludesTax: true });
    return r;
  } finally { db.query = asked; db.withEntity = askedWith; }
}

test('1 · the tax block omitted: registration, number, flag and source unchanged; 100.00 at 5% inclusive carries 4.76', async () => {
  const before = snap();
  await save(base());
  assert.equal(snap(), before, 'nothing of the tax answer moved');
  assert.ok(!SQLS.some((s) => /^UPDATE identities/.test(s) && /gstn/.test(s)), 'the number is not in the UPDATE at all');
  assert.ok(!SQLS.some((s) => /^UPDATE entity_governance/.test(s) && /tax_registration/.test(s)), 'tax_registration is not in the UPDATE at all');
  assert.equal(CS.registrationOf({ number: ID.gstn, tax_registration: GOV.tax_registration }), 'regular');
  const r = await invoice();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.money.tax, 4.76);
  assert.equal(r.body.money.taxable, 95.24);
  assert.equal(r.body.money.total, 100);
});

test('2 · tax {} / registered null / null number and scheme keep a known answer; a first setup with nothing said stays unknown', async () => {
  const before = snap();
  for (const tax of [{}, { registered: null }, { registered: null, number: null, scheme: null }]) {
    await save(base({ tax }));
    assert.equal(GOV.tax_registration.registered, true);
    assert.equal(ID.gstn, GSTIN);
    assert.equal(GOV.tax_registration.number, GSTIN);
  }
  assert.equal(JSON.parse(JSON.stringify(ID)).policy_flags.gst_registration, 'regular');
  assert.equal(JSON.stringify(Object.assign({}, GOV, { country_setup_at: null })), JSON.stringify(Object.assign({}, JSON.parse(before).GOV, { country_setup_at: null })));
  ID.gstn = null; GOV.tax_registration = null; ID.policy_flags = {};
  await save(base({ tax: { registered: null, number: null, scheme: null } }));
  assert.equal(GOV.tax_registration, null, 'unknown stays SQL NULL, never { registered: false }');
});

test('3 · a number held, the answer NULL: false without the confirm is 409 and nothing is written (the number is a registration)', async () => {
  GOV.tax_registration = null;
  assert.equal(CS.registrationOf({ number: ID.gstn, tax_registration: null }), 'regular');
  const before = snap();
  const e = await refused(base({ tax: { registered: false, number: null, scheme: null } }));
  assert.ok(e && e.status === 409 && e.code === 'TAX_DEREGISTER_UNCONFIRMED', e && e.code);
  assert.match(e.say, /GST/);
  assert.match(e.say, /till that is already open/);
  assert.equal(snap(), before);
  assert.ok(!SQLS.some((s) => /^UPDATE /.test(s)), 'no UPDATE was sent');
});

test('4 · the owner de-registers with the confirm: number, scheme and flag cleared, logged, and the invoice carries 0.00 tax', async () => {
  await save(base({ tax: { registered: false }, confirm_deregister: true }));
  assert.deepEqual(GOV.tax_registration, { registered: false, number: null, scheme: null });
  assert.equal(ID.gstn, null);
  assert.equal(ID.policy_flags.gst_registration, 'unregistered', 'a reader that takes the flag alone never sees a stale regular');
  assert.equal(CS.registrationOf({ number: ID.gstn, scheme: ID.policy_flags.gst_registration, tax_registration: GOV.tax_registration }), 'unregistered');
  assert.equal(LOGGED.length, 1, 'the change log carries who/when/from/to');
  const r = await invoice();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!r.body.money.tax, 'no tax: the owner said not registered (the engine answers null)');
  assert.equal(r.body.money.taxable, 100);
  assert.equal(r.body.money.total, 100);
});

test('5 · the web body (false, number null, scheme null) clears with the confirm; a re-save of an already unregistered shop needs none', async () => {
  await save(base({ tax: { registered: false, number: null, scheme: null }, confirm_deregister: true }));
  assert.deepEqual(GOV.tax_registration, { registered: false, number: null, scheme: null });
  const e = await refused(base({ tax: { registered: false, number: null, scheme: null } }));
  assert.equal(e, null, 'already unregistered: nothing to lose, no confirm asked');
  const first = await refused(base({ confirm_deregister: 'yes', tax: { registered: false } }));
  assert.equal(first, null);
});

test('6 · a stray tax key is refused by name; a partial tax merges; source merges key by key and the N0 confirm reaches the merged map', async () => {
  const before = snap();
  const e = await refused(base({ tax: { registerd: false } }));
  assert.ok(e && e.status === 400 && e.code === 'COUNTRY_SETUP_BAD' && /registerd/.test(e.say), e && e.say);
  const e2 = await refused(base({ tax: 'none' }));
  assert.ok(e2 && e2.status === 400 && e2.code === 'COUNTRY_SETUP_BAD');
  assert.equal(snap(), before, 'nothing written by a refusal');
  await save(base({ tax: { number: NEW_GSTIN } }));
  assert.equal(ID.gstn, NEW_GSTIN);
  assert.equal(GOV.tax_registration.registered, true);
  assert.equal(GOV.tax_registration.scheme, 'regular');
  GOV.setup_source = { tax: 'typed', country: 'backfill b299 (today\'s facts)' };
  await save(base({ source: { timezone: 'picked' } }));
  assert.deepEqual(GOV.setup_source, { tax: 'typed', country: 'confirmed by the owner', timezone: 'picked' });
});

test('7 · the governance row is read FOR UPDATE, and every path of save ends with forget(entity)', async () => {
  await save(base());
  assert.ok(SQLS.some((s) => /FROM entity_governance WHERE entity_id = \$1 FOR UPDATE/.test(s)), 'the row lock rides the one read save already makes (no extra trip)');
  const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'country-setup.js'), 'utf8');
  const body = /async function save\(h, entity, body, by\) \{[\s\S]*?\n\}\n/.exec(code)[0];
  const returns = body.match(/\n\s+return /g).length;
  const forgets = body.match(/forget\(entity\);\n\s+(?:const out = await profile|return profile)/g).length;
  assert.equal(forgets, returns, 'each of the ' + returns + ' returns is preceded by forget(entity)');
});

test('8 · one writer: nothing but country-setup.save writes entity_governance.tax_registration', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!/\.js$/.test(f)) continue;
      const code = fs.readFileSync(path.join(root, dir, f), 'utf8');
      if (/UPDATE entity_governance[^;`]*tax_registration\s*=|tax_registration = EXCLUDED/.test(code)) hits.push(dir + '/' + f);
    }
  }
  assert.deepEqual(hits, ['lib/country-setup.js']);
});
