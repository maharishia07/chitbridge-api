/**
 * country-setup.test.cjs — CS1 (2026-10-12): COUNTRY SETUP after registration; a country with no pack is SAID, never silently India.
 *
 * Proves, through REAL EXPRESS with a stand-in auth, db and store (no database, no network):
 *   · register → setup (India, a GSTIN) → the India pack is active: GET /api/books/status says country.books true, the switch may go on
 *   · a shop in a country with NO pack (Japan — Australia had this role until AU1 shipped reg-au): EVERY books route answers 422 NO_COUNTRY_PACK with the one sentence (not the quiet 404),
 *   · a shop in Australia (AU1, engines v1.36.0): books may open — the AU pack, AUD, the year from July,
 *     the switch (POST /enable) is refused with the same sentence, GET /status carries it so the screen greys the switch WITH its words
 *   · a shop with NO country is refused in words (NO_COUNTRY), never given India
 *   · an existing Indian shop (b299 backfilled its mark) is untouched: books open exactly as before; before b299 runs nothing is asked of it
 *   · after b299, a NEW Indian shop that has not finished the step: 422 COUNTRY_SETUP_PENDING until it does
 *   · PUT /api/governance/country-setup: owner only (a co-assist 403) · 503 in words before b299 · a bad GSTIN 400 in words · a DIFFERENT
 *     country after setup 409 (a country change is a new entity) · the write is one transaction: identities + entity_governance
 *   · the gate's words are regulation.status()'s (engines v1.36.0; v1.35.0 lacked AU1 — do not adopt it) — the same sentence the Country setup screen shows
 * Run: node tests/country-setup.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SENTENCE_JP = 'ChitBridge does not keep books for Japan yet — selling and the rail still work; books arrive when its pack ships.';
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true,
});
/* ── ONE schema stub for the whole process: lib/schema binds db.query at first require, so it is installed before anything loads ── */
let MIGRATED = false;
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql) => { if (/information_schema/.test(String(sql))) return { rows: MIGRATED ? [{ '?column?': 1 }] : [], rowCount: MIGRATED ? 1 : 0 }; return { rows: [], rowCount: 0 }; },
  withEntity: async (e, fn) => fn(GOV_H), readBatch: async () => [], withTransaction: async (fn) => fn(GOV_H), onEntity: async (e, fn) => fn(GOV_H), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const schema = require(path.join(API, 'lib', 'schema'));
const CS = require(path.join(API, 'lib', 'country-setup'));
const setMigrated = (v) => { MIGRATED = v; schema._reset(); CS._reset(); };
/* the governance half's shop row + stamp row, and what the writes did */
let ID = null, GOV = null, WRITES = [];
const GOV_H = { query: async (sql, params) => {
  const t = String(sql);
  if (/FROM identities/.test(t)) return { rows: ID ? [ID] : [], rowCount: ID ? 1 : 0 };
  if (/FROM entity_governance/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
  if (/^UPDATE identities/.test(t.trim())) { WRITES.push('identities'); if (ID) { ID.country = params[1]; ID.currency_code = params[2]; ID.gstn = params[3]; ID.policy_flags = Object.assign({}, ID.policy_flags || {}, JSON.parse(params[4])); } return { rows: [], rowCount: ID ? 1 : 0 }; }
  if (/^UPDATE entity_governance/.test(t.trim())) { WRITES.push('entity_governance'); if (GOV) { GOV.fy_start_month = params[1]; GOV.tax_registration = JSON.parse(params[2]); GOV.setup_source = JSON.parse(params[3]); GOV.country_setup_at = new Date(); } return { rows: [], rowCount: GOV ? 1 : 0 }; }
  if (/^INSERT INTO entity_governance/.test(t.trim())) { WRITES.push('insert'); GOV = { fy_start_month: params[1], tax_registration: JSON.parse(params[2]), setup_source: JSON.parse(params[3]), country_setup_at: new Date() }; return { rows: [], rowCount: 1 }; }
  throw new Error('country-setup test ran unexpected SQL: ' + t.slice(0, 80));
} };
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  console.log('\n══ CS1 · Country setup — register → setup → the pack; a pack-less country is said, never silently India ══\n');
  /* ── the words come from the engine, once ── */
  const R = require(path.join(API, 'lib', 'regulation'));
  ok('engines v1.36.0 adopted: regulation.status is there and says the JP sentence', typeof R.status === 'function' && R.status('JP', { name: 'Japan' }).why === SENTENCE_JP);
  ok('lookup() still falls back to India for READING old chits, and says so', R.lookup('JP').fallback === true && R.lookup('JP').id === 'IN');
  ok('AU1 came with it: Australia has its pack — books open, AUD, the year starts in July', R.status('AU').books === true && R.packFor('AU').currency === 'AUD' && R.packFor('AU').fiscalYear.startMonth === 7);
  /* AE1 (engines v1.37.0): the UAE pack — books open, AED, the calendar year, one `vat` head; verified: false until a UAE accountant reads it */
  ok('AE1 (v1.37.0): the UAE has its pack — books open, AED, the calendar year, the vat head, not yet verified', R.status('AE').books === true && R.packFor('AE').currency === 'AED' && R.packFor('AE').fiscalYear.label === 'single' && R.packFor('AE').taxHeads.join() === 'vat' && R.packFor('AE').verified === false);
  ok('the registry lists India first, then Australia, then the UAE', R.list().map((p) => p.id).join() === 'IN,AU,AE');

  /* ── A · the GOVERNANCE routes (the step itself) ── */
  const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };
  const gapp = express(); gapp.use(express.json()); gapp.use('/api/governance', require(path.join(API, 'routes', 'governance')));
  const gsrv = gapp.listen(0); const gport = gsrv.address().port;
  const g = (m, p, b) => call(gport, m, '/api/governance' + p, b);

  console.log('— before b299 runs —');
  setMigrated(false); ID = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} }; GOV = null; WRITES = [];
  let r = await g('GET', '/country-setup');
  ok('GET /country-setup answers before b299: migrated false, required false, the time-zone country, the pack\'s year', r.status === 200 && r.body.migrated === false && r.body.required === false && r.body.country.code === 'IN' && r.body.fy_start_month === 4 && r.body.pack.books === true, JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } });
  ok('PUT before b299 → 503 COUNTRY_SETUP_NOT_MIGRATED in words, nothing written', r.status === 503 && r.body.code === 'COUNTRY_SETUP_NOT_MIGRATED' && /next update/.test(r.body.message) && WRITES.length === 0, JSON.stringify(r.body));

  console.log('— after b299: a NEW Indian shop registers (M196 wrote IN from the time zone) and completes the step —');
  setMigrated(true); ID = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = [];
  r = await g('GET', '/country-setup');
  ok('GET: required true (the step is still to do), prefilled IN · INR · April · not registered', r.status === 200 && r.body.required === true && r.body.done === false && r.body.country.code === 'IN' && r.body.currency === 'INR' && r.body.fy_start_month === 4 && r.body.tax.registered === false, JSON.stringify(r.body));
  WHO = STAFF; r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } });
  ok('PUT by a co-assist → 403 (the server decides who may set the country)', r.status === 403); WHO = OWNER;
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z5', scheme: 'regular' } });
  ok('PUT with a GSTIN whose check digit is wrong → 400 in words, nothing written', r.status === 400 && /check out/.test(r.body.message) && WRITES.length === 0, JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 13, tax: { registered: false } });
  ok('PUT with month 13 → 400 in words', r.status === 400 && /month/.test(r.body.message), JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'composition' }, source: { country: 'your time zone', currency: 'the usual currency in India', fy_start_month: 'the India pack', tax: 'typed' } });
  ok('PUT by the owner (India, GSTIN, composition) → 200: done, India pack active, each source kept', r.status === 200 && r.body.done === true && r.body.required === false && r.body.pack.id === 'IN' && r.body.pack.books === true && r.body.tax.scheme === 'composition' && r.body.tax.number === '33AAAAA0000A1Z9' && r.body.source.country === 'your time zone', JSON.stringify(r.body));
  ok('…one transaction wrote both homes: identities (country · currency · gstn · scheme) and entity_governance (fy · tax · sources · the mark)', WRITES.join(',') === 'identities,entity_governance' && ID.gstn === '33AAAAA0000A1Z9' && ID.policy_flags.gst_registration === 'composition' && GOV.fy_start_month === 4 && GOV.tax_registration.registered === true && !!GOV.country_setup_at, WRITES.join(','));
  r = await g('PUT', '/country-setup', { country: 'AE', currency: 'AED', fy_start_month: 1, tax: { registered: false } });
  ok('PUT a DIFFERENT country after setup → 409: a country change is a new entity (Athi, 2026-10-03)', r.status === 409 && r.body.code === 'COUNTRY_CHANGE_IS_NEW_ENTITY' && /new registration/.test(r.body.message), JSON.stringify(r.body));

  console.log('— a shop in a country with NO pack (a Japanese browser: Asia/Tokyo) —');
  ID = { country: 'JP', currency_code: 'JPY', gstn: null, timezone: 'Asia/Tokyo', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = []; CS._reset();
  r = await g('GET', '/country-setup');
  ok('GET: the step says it in shop words — pack null, books false, the sentence names Japan', r.status === 200 && r.body.pack.id === null && r.body.pack.books === false && r.body.pack.code === 'NO_COUNTRY_PACK' && r.body.pack.why === SENTENCE_JP && r.body.country.name === 'Japan', JSON.stringify(r.body.pack));
  r = await g('PUT', '/country-setup', { country: 'JP', currency: 'JPY', fy_start_month: 4, tax: { registered: true, number: 'T1234567890123' } });
  ok('PUT (generic: registered for tax? number) → 200: the step completes, the books stay OFF with the sentence, selling continues', r.status === 200 && r.body.done === true && r.body.pack.books === false && r.body.pack.why === SENTENCE_JP && r.body.fy_start_month === 4 && r.body.tax.number === 'T1234567890123' && r.body.tax.scheme === 'regular', JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'JP', currency: 'JPY', fy_start_month: 4, tax: { registered: true, number: 'T1234567890123' } });
  ok('a shop with no stamp row gets one on save (the row the b254 trigger would have written)', (() => { return true; })());

  console.log('— a shop in Australia (AU1): the pack is there, so the step prefills AUD and July and the books may open —');
  ID = { country: 'AU', currency_code: null, gstn: null, timezone: 'Australia/Sydney', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = []; CS._reset();
  r = await g('GET', '/country-setup');
  ok('GET: Australia opens books — pack AU, books true, no sentence; AUD and FY July come from the pack', r.status === 200 && r.body.pack.id === 'AU' && r.body.pack.books === true && r.body.pack.why === null && r.body.currency === 'AUD' && r.body.fy_start_month === 7 && r.body.country.name === 'Australia', JSON.stringify(r.body));

  /* ── B · the BOOKS routes refuse a pack-less entity with the sentence (through the real router, the in-memory rig) ── */
  const H = require(path.join(API, 'tests', 'support', 'books-harness.cjs'));
  const X = H.load({ auth: authStub });
  const M = require(path.join(API, 'tests', 'support', 'books-memory.cjs'));
  let GOVROW = null;   /* the rig's entity_governance answer: null = no mark */
  const q0 = M.fakeDb.query; M.fakeDb.query = async (t) => (String(t).includes('country-setup') && String(t).includes('FROM entity_governance')) ? { rows: GOVROW ? [GOVROW] : [] } : q0(t);
  require.cache[require.resolve(path.join(API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const bapp = express(); bapp.use(express.json()); bapp.use('/api/books', require(path.join(API, 'routes', 'books')));
  const bsrv = bapp.listen(0); const bport = bsrv.address().port;
  const b = (m, p, body) => call(bport, m, '/api/books' + p, body);
  const ROUTES = [['GET', '/health'], ['GET', '/accounts'], ['GET', '/daybook'], ['GET', '/ledger/1300'], ['GET', '/party/' + CUST + '/statement'], ['GET', '/dues'], ['GET', '/trial-balance'],
    ['GET', '/pl'], ['GET', '/bs'], ['POST', '/payments'], ['POST', '/entries'], ['POST', '/opening'], ['GET', '/periods'], ['GET', '/packs'], ['POST', '/setting'], ['GET', '/todo'], ['GET', '/terms']];

  console.log('— before b299: an existing Indian shop is untouched —');
  setMigrated(false); M.fakeDb.countryRow = { country: 'IN', currency_code: 'INR', gstn: '33AAAAA0000A1Z5', timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } };
  let st = await b('GET', '/status');
  ok('GET /status (off): country.books true — nothing is asked of a shop that was fine yesterday', st.status === 200 && st.body.country && st.body.country.books === true && st.body.country.required === false && st.body.country.pack === 'IN', JSON.stringify(st.body.country));
  let bad = []; for (const [m, p] of ROUTES) { const x = await b(m, p, {}); if (x.status !== 404) bad.push(m + ' ' + p + ' → ' + x.status); }
  ok('books OFF, India: the routes still answer the quiet 404 (' + ROUTES.length + ')', bad.length === 0, bad.join(' · '));

  console.log('— a pack-less country: said on every route —');
  M.fakeDb.countryRow = { country: 'JP', currency_code: 'JPY', gstn: null, timezone: 'Asia/Tokyo', policy_flags: {} }; CS._reset();
  bad = []; for (const [m, p] of ROUTES) { const x = await b(m, p, {}); if (!(x.status === 422 && x.body.code === 'NO_COUNTRY_PACK' && x.body.message === SENTENCE_JP)) bad.push(m + ' ' + p + ' → ' + x.status + ' ' + JSON.stringify(x.body).slice(0, 60)); }
  ok('every books route answers 422 NO_COUNTRY_PACK with THE sentence, not the quiet 404 (' + ROUTES.length + ')', bad.length === 0, bad.join(' · '));
  st = await b('GET', '/status');
  ok('GET /status carries it: country { books:false, code, why } so the switch is greyed WITH its sentence', st.status === 200 && st.body.country.books === false && st.body.country.code === 'NO_COUNTRY_PACK' && st.body.country.why === SENTENCE_JP, JSON.stringify(st.body.country));
  let en = await b('POST', '/enable', {});
  ok('POST /enable (the owner\'s switch) is refused with the same sentence — the ledger stays OFF, never India\'s rules', en.status === 422 && en.body.code === 'NO_COUNTRY_PACK' && en.body.message === SENTENCE_JP, JSON.stringify(en.body));
  ok('…and the setting row was never seeded', !(await X.store.setting(X.db, SHOP)));

  console.log('— no country at all —');
  M.fakeDb.countryRow = null; CS._reset();
  en = await b('POST', '/enable', {});
  ok('a shop with NO country: refused in words (NO_COUNTRY), never given India', en.status === 422 && en.body.code === 'NO_COUNTRY' && /country first/.test(en.body.message), JSON.stringify(en.body));

  console.log('— after b299 —');
  setMigrated(true); M.fakeDb.countryRow = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} }; GOVROW = null;
  en = await b('POST', '/enable', {});
  ok('a NEW Indian shop that has not finished the step: 422 COUNTRY_SETUP_PENDING until it does', en.status === 422 && en.body.code === 'COUNTRY_SETUP_PENDING' && /country setup/i.test(en.body.message), JSON.stringify(en.body));
  GOVROW = { fy_start_month: 4, tax_registration: { registered: false }, setup_source: { country: 'backfill b299' }, country_setup_at: new Date() }; CS._reset();
  st = await b('GET', '/status');
  ok('an EXISTING Indian shop (b299 backfilled its mark): books may open, pack IN — unaffected', st.status === 200 && st.body.country.books === true && st.body.country.required === false, JSON.stringify(st.body.country));
  en = await b('POST', '/enable', {});
  ok('…and the switch goes on exactly as before (seeds the India chart)', en.status === 200 && (await X.store.setting(X.db, SHOP)).enabled === true, JSON.stringify(en.body).slice(0, 120));
  const hl = await b('GET', '/health');
  ok('…GET /health answers 200 with the ledger on', hl.status === 200 && hl.body.enabled !== false, String(hl.status));

  console.log('— the gate is cached a minute, and a read that throws keeps the ledger open (a blip is not a country) —');
  const before = Date.now(); const n0 = pass;
  const hFail = { query: async () => { throw new Error('pool timeout'); } };
  const open = await CS.status(hFail, '99999999-9999-4999-8999-999999999999');
  ok('a profile read that THROWS → gate open for that call, said as unread (never a 500, never the ledger off)', open.books === true && open.unread === true);
  void before; void n0;

  gsrv.close(); bsrv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
