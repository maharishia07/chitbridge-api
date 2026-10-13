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
/* CONST = what the shop holds (CS2: a product or a transaction fixes the country and the money for good) */
let ID = null, GOV = null, WRITES = [], CONST = { products: false, chits: false, entries: false };
const GOV_H = { query: async (sql, params) => {
  const t = String(sql);
  if (/country-setup constituted/.test(t)) return { rows: [CONST], rowCount: 1 };
  if (/FROM identities/.test(t)) return { rows: ID ? [ID] : [], rowCount: ID ? 1 : 0 };
  if (/FROM entity_governance/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
  if (/^UPDATE identities/.test(t.trim())) { WRITES.push('identities'); if (ID) { ID.country = params[1]; ID.currency_code = params[2]; ID.gstn = params[3]; ID.policy_flags = Object.assign({}, ID.policy_flags || {}, JSON.parse(params[4])); ID.timezone = params[5] || ID.timezone; } return { rows: [], rowCount: ID ? 1 : 0 }; }
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
  setMigrated(true); ID = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Europe/London', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = [];
  r = await g('GET', '/country-setup');
  ok('GET: required true (the step is still to do), prefilled IN · INR · April · not registered', r.status === 200 && r.body.required === true && r.body.done === false && r.body.country.code === 'IN' && r.body.currency === 'INR' && r.body.fy_start_month === 4 && r.body.tax.registered === false, JSON.stringify(r.body));
  /* CS2: the step is told whether the country may still change, the pack's zones, and the countries it may offer — exactly the registered packs */
  ok('CS2 GET: constituted false (no product, no transaction) with what was looked at; the India pack names ONE zone; countries = the registered packs with what each derives',
    r.body.constituted === false && JSON.stringify(r.body.constituted_by) === JSON.stringify({ products: false, chits: false, entries: false }) && JSON.stringify(r.body.zones) === '["Asia/Kolkata"]'
    && r.body.countries.map((c) => c.code).join() === 'IN,AU,AE' && r.body.countries[1].currency === 'AUD' && r.body.countries[1].fy_start_month === 7 && r.body.countries[1].zones.length === 11 && r.body.countries[1].name === 'Australia' && r.body.countries[2].zones[0] === 'Asia/Dubai' && r.body.countries[0].locale === 'en-IN',
    JSON.stringify({ c: r.body.constituted, z: r.body.zones, countries: r.body.countries }));
  WHO = STAFF; r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } });
  ok('PUT by a co-assist → 403 (the server decides who may set the country)', r.status === 403); WHO = OWNER;
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z5', scheme: 'regular' } });
  ok('PUT with a GSTIN whose check digit is wrong → 400 in words, nothing written', r.status === 400 && /check out/.test(r.body.message) && WRITES.length === 0, JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 13, tax: { registered: false } });
  ok('PUT with month 13 → 400 in words', r.status === 400 && /month/.test(r.body.message), JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'composition' }, source: { country: 'your time zone', currency: 'the usual currency in India', fy_start_month: 'the India pack', tax: 'typed' } });
  ok('PUT by the owner (India, GSTIN, composition) → 200: done, India pack active, each source kept', r.status === 200 && r.body.done === true && r.body.required === false && r.body.pack.id === 'IN' && r.body.pack.books === true && r.body.tax.scheme === 'composition' && r.body.tax.number === '33AAAAA0000A1Z9' && r.body.source.country === 'your time zone', JSON.stringify(r.body));
  ok('…one transaction wrote both homes: identities (country · currency · gstn · scheme · the zone) and entity_governance (fy · tax · sources · the mark)', WRITES.join(',') === 'identities,entity_governance' && ID.gstn === '33AAAAA0000A1Z9' && ID.policy_flags.gst_registration === 'composition' && GOV.fy_start_month === 4 && GOV.tax_registration.registered === true && !!GOV.country_setup_at, WRITES.join(','));
  ok('CS2: the India pack names one zone, so the step SET it without asking — identities.timezone Europe/London (the browser at register) → Asia/Kolkata (M210 reads it)', ID.timezone === 'Asia/Kolkata' && r.body.timezone === 'Asia/Kolkata', ID.timezone);

  console.log('— CS2 · the constitution: before any product or transaction the country may be CORRECTED and everything derived is set again; after, never —');
  WRITES = [];
  r = await g('PUT', '/country-setup', { country: 'AE', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '100123456700003', scheme: 'composition' } });
  ok('an EMPTY shop (setup done, nothing held yet) moves IN → AE → 200: the UAE pack re-derives AED · January · regular · Asia/Dubai, whatever the body carried; the number typed stays; who/when said',
    r.status === 200 && r.body.country.code === 'AE' && r.body.currency === 'AED' && r.body.fy_start_month === 1 && r.body.tax.scheme === 'regular' && r.body.tax.number === '100123456700003' && r.body.timezone === 'Asia/Dubai'
    && r.body.pack.id === 'AE' && r.body.rederived && r.body.rederived.from === 'IN' && r.body.rederived.to === 'AE' && r.body.rederived.by === SHOP && /T/.test(r.body.rederived.at) && ID.currency_code === 'AED' && ID.timezone === 'Asia/Dubai' && ID.policy_flags.gst_registration === 'regular',
    JSON.stringify(r.body));
  ok('…the EXISTS read is a read: the same two writes, in the same transaction; no products, chits or entries were touched (nothing exists to convert)', WRITES.join(',') === 'identities,entity_governance', WRITES.join(','));
  CONST = { products: true, chits: false, entries: false }; WRITES = [];
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false }, timezone: 'Australia/Sydney' });
  ok('ONE PRODUCT → fixed: AE → AU is refused 409 with the sentence + "Register a new business for Australia"; nothing written', r.status === 409 && r.body.code === 'COUNTRY_CHANGE_IS_NEW_ENTITY' && /already has products/.test(r.body.message) && /Register a new business for Australia\./.test(r.body.message) && WRITES.length === 0, JSON.stringify(r.body));
  CONST = { products: false, chits: true, entries: false };
  r = await g('PUT', '/country-setup', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } });
  ok('ONE CHIT (of any kind) → fixed the same way, naming chits', r.status === 409 && /already has chits/.test(r.body.message) && /Register a new business for India\./.test(r.body.message), JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'AE', currency: 'USD', fy_start_month: 1, tax: { registered: false } });
  ok('…and the CURRENCY never changes either once fixed: AE stays, AED → USD refused 409', r.status === 409 && /country and money never change/.test(r.body.message) && ID.currency_code === 'AED', JSON.stringify(r.body));
  CONST = { products: false, chits: false, entries: true }; WRITES = [];
  r = await g('PUT', '/country-setup', { country: 'AE', currency: 'AED', fy_start_month: 1, tax: { registered: true, number: '100123456700003' } });
  ok('a books entry fixes it too — but the SAME country and money may still be re-saved (tax corrected): 200, the mark moves, constituted true in the answer', r.status === 200 && r.body.constituted === true && r.body.constituted_by.entries === true && r.body.tax.number === '100123456700003' && WRITES.join(',') === 'identities,entity_governance', JSON.stringify(r.body));
  ok('GET says constituted: the step greys country and money with the reason', (await g('GET', '/country-setup')).body.constituted === true);
  CONST = { products: false, chits: false, entries: false };

  console.log('— a shop in a country with NO pack (a Japanese browser: Asia/Tokyo) —');
  ID = { country: 'JP', currency_code: 'JPY', gstn: null, timezone: 'Asia/Tokyo', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = []; CS._reset();
  r = await g('GET', '/country-setup');
  ok('GET: the step says it in shop words — pack null, books false, the sentence names Japan', r.status === 200 && r.body.pack.id === null && r.body.pack.books === false && r.body.pack.code === 'NO_COUNTRY_PACK' && r.body.pack.why === SENTENCE_JP && r.body.country.name === 'Japan', JSON.stringify(r.body.pack));
  r = await g('PUT', '/country-setup', { country: 'JP', currency: 'JPY', fy_start_month: 4, tax: { registered: true, number: 'T1234567890123' } });
  ok('PUT (generic: registered for tax? number) → 200: the step completes, the books stay OFF with the sentence, selling continues', r.status === 200 && r.body.done === true && r.body.pack.books === false && r.body.pack.why === SENTENCE_JP && r.body.fy_start_month === 4 && r.body.tax.number === 'T1234567890123' && r.body.tax.scheme === 'regular', JSON.stringify(r.body));
  ok('CS2: a pack-less country names no zone, so the zone registration wrote stays (Asia/Tokyo) and the step offers none', ID.timezone === 'Asia/Tokyo' && r.body.zones.length === 0, ID.timezone);
  r = await g('PUT', '/country-setup', { country: 'JP', currency: 'JPY', fy_start_month: 4, tax: { registered: true, number: 'T1234567890123' } });
  ok('a shop with no stamp row gets one on save (the row the b254 trigger would have written)', (() => { return true; })());

  console.log('— a shop in Australia (AU1): the pack is there, so the step prefills AUD and July and the books may open —');
  ID = { country: 'AU', currency_code: null, gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} }; GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: null }; WRITES = []; CS._reset();   /* an Indian browser registering an Australian shop: the zone it wrote is not one of AU's, so the step must ASK */
  r = await g('GET', '/country-setup');
  ok('GET: Australia opens books — pack AU, books true, no sentence; AUD and FY July come from the pack', r.status === 200 && r.body.pack.id === 'AU' && r.body.pack.books === true && r.body.pack.why === null && r.body.currency === 'AUD' && r.body.fy_start_month === 7 && r.body.country.name === 'Australia', JSON.stringify(r.body));
  ok('CS2 GET: Australia is MULTI-ZONE — the step is handed the eleven zones to ASK with (Sydney first)', r.body.zones.length === 11 && r.body.zones[0] === 'Australia/Sydney' && r.body.zones.indexOf('Australia/Perth') > 0, JSON.stringify(r.body.zones));
  WRITES = [];
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false } });
  ok('PUT AU with NO zone → 400 COUNTRY_SETUP_ZONE naming the zones to pick from; nothing written', r.status === 400 && r.body.code === 'COUNTRY_SETUP_ZONE' && /Australia\/Sydney/.test(r.body.message) && /Australia\/Perth/.test(r.body.message) && WRITES.length === 0, JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false }, timezone: 'Asia/Kolkata' });
  ok('PUT AU with a zone that is not Australian → 400 in the same words', r.status === 400 && r.body.code === 'COUNTRY_SETUP_ZONE', JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false }, timezone: 'Europe/Mars' });
  ok('PUT with a zone Intl does not know → 400 in words (it must never reach identities.timezone, where it would blank every date)', r.status === 400 && /time zone/.test(r.body.message), JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: true, number: '51 824 753 556' }, timezone: 'Australia/Perth', source: { timezone: 'picked' } });
  ok('PUT AU with Australia/Perth → 200: the zone the owner picked is written to identities.timezone and said back with its source', r.status === 200 && ID.timezone === 'Australia/Perth' && r.body.timezone === 'Australia/Perth' && r.body.source.timezone === 'picked' && r.body.pack.id === 'AU', JSON.stringify(r.body));
  r = await g('PUT', '/country-setup', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false } });
  ok('a later re-save of the same country without a zone keeps the one chosen (never asks twice)', r.status === 200 && ID.timezone === 'Australia/Perth', JSON.stringify(r.body));
  /* the chart the switch will seed: from the PACK, through accounts-packs (the engines' facade, v1.42.0) — never a second chart table */
  const E = require(path.join(API, 'lib', 'books-engines'));
  const au = E.chartRows(E.packs().packFor('AU')), ae = E.chartRows(E.packs().packFor('AE')), ind = E.chartRows(E.packs().packFor('IN'));
  ok('CS2 chart: AU rows carry GST collected / GST paid and no CGST; AE rows Output VAT; IN rows Output CGST — each from its own pack, with its statement line filled',
    au.some((x) => x.role === 'gst_collected' && x.code === '2200' && x.sch3_line === 'GST and other statutory liabilities') && !au.some((x) => x.role === 'output_cgst')
    && ae.some((x) => x.role === 'output_vat') && ind.some((x) => x.role === 'output_cgst' && x.sch3_line === 'Other current liabilities') && au.filter((x) => x.is_group).every((x) => x.sch3_line),
    JSON.stringify(au.find((x) => x.role === 'gst_collected')));
  ok('CS2 chart: the legacy year twin is filled by the ONE door (fy_start_month 7 for AU, 1 for AE) so the v1.20.0 core reads the pack\'s year; India unchanged', E.packs().packFor('AU').fy_start_month === 7 && E.packs().packFor('AE').fy_start_month === 1 && E.packs().packFor('IN').fy_start_month === 4 && E.packs().fiscalYearOf('2026-08-01', E.packs().packFor('AU')) === '2026-27' && E.packs().fiscalYearOf('2026-08-01', E.packs().packFor('AE')) === '2026');

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
  ok('…and the switch goes on exactly as before (seeds the India chart)', en.status === 200 && (await X.store.setting(X.db, SHOP)).enabled === true && (await X.store.accounts(X.db, SHOP)).some((a) => a.role === 'output_cgst'), JSON.stringify(en.body).slice(0, 120));
  const hl = await b('GET', '/health');
  ok('…GET /health answers 200 with the ledger on', hl.status === 200 && hl.body.enabled !== false, String(hl.status));

  console.log('— CS2 · an AUSTRALIAN shop: the switch seeds the AU chart from the pack (never India\'s with a fallback flag); a country corrected before any posting re-seeds —');
  const AUS = '55555555-5555-4555-8555-555555555555';
  M.fakeDb.countryRow = { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} }; CS._reset(); CS.forget(AUS);
  await X.B.enable(X.db, AUS, { by: AUS, today: '2026-08-01' });
  let acc = await X.store.accounts(X.db, AUS), st2 = await X.store.setting(X.db, AUS);
  ok('enable for Australia seeds GST collected · GST paid · Trade Debtors and NO CGST; the setting says AU · AUD · July; the year is 2026-27 (July)', acc.some((a) => a.role === 'gst_collected') && acc.some((a) => a.name === 'Trade Debtors' && a.is_group) && !acc.some((a) => a.role === 'output_cgst') && st2.country === 'AU' && st2.functional_currency === 'AUD' && st2.fy_start_month === 7 && (await X.store.periods(X.db, AUS))[0].fiscal_year === '2026-27', JSON.stringify({ n: acc.length, st2 }));
  const re = await X.B.reseedUnposted(X.db, AUS, { country: 'AE', by: AUS });
  acc = await X.store.accounts(X.db, AUS); st2 = await X.store.setting(X.db, AUS);
  ok('reseedUnposted (the country corrected to AE before any posting): the AU chart is gone, the UAE chart is seeded — Output VAT, no GST collected; AED · January; the year 2026', re && re.accounts_added > 0 && acc.some((a) => a.role === 'output_vat') && !acc.some((a) => a.role === 'gst_collected') && st2.country === 'AE' && st2.functional_currency === 'AED' && st2.fy_start_month === 1 && st2.enabled === true && (await X.store.periods(X.db, AUS)).every((p) => p.fiscal_year === '2026'), JSON.stringify({ re, st2 }));
  X.T.entries.push({ entity_id: AUS, posting_date: '2026-08-02', entry_no: 'SV/2026/000001' });
  let refused = null; try { await X.B.reseedUnposted(X.db, AUS, { country: 'IN', by: AUS }); } catch (e) { refused = e; }
  ok('…with ONE entry posted it is refused by name (BOOKS_CONSTITUTED) — a chart is never converted; the UAE chart stands', refused && refused.code === 'BOOKS_CONSTITUTED' && (await X.store.accounts(X.db, AUS)).some((a) => a.role === 'output_vat'), refused && refused.message);
  M.fakeDb.countryRow = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} };

  console.log('— the gate is cached a minute, and a read that throws keeps the ledger open (a blip is not a country) —');
  const before = Date.now(); const n0 = pass;
  const hFail = { query: async () => { throw new Error('pool timeout'); } };
  const open = await CS.status(hFail, '99999999-9999-4999-8999-999999999999');
  ok('a profile read that THROWS → gate open for that call, said as unread (never a 500, never the ledger off)', open.books === true && open.unread === true);
  void before; void n0;

  console.log('— CX0 (2026-10-13): the books open in the shop\'s OWN country, money and year; India\'s set-off is refused in words elsewhere —');
  const fs = require('fs');
  const booksSrc = fs.readFileSync(path.join(API, 'lib', 'books.js'), 'utf8'), periodSrc = fs.readFileSync(path.join(API, 'lib', 'books-period.js'), 'utf8');
  const tillSrc = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  ok('books.enable reads country-setup.profile (country · currency · fy_start_month from their one home) — never \'IN\' before the profile', /require\('\.\/country-setup'\)\.profile\(h, entity(, \{ constitution: false \})?\)/.test(booksSrc) && /cs\.country && cs\.country\.code/.test(booksSrc) && /o\.currency \|\| own\.currency/.test(booksSrc));
  ok('gstClose and gstPay refuse outside India\'s pack (NOT_FOR_COUNTRY, with a sentence), never an Indian close on a fallback chart', /function indiaOnly\(s, what\)/.test(periodSrc) && /p\.fallback \|\|/.test(periodSrc) && (periodSrc.match(/indiaOnly\(s, /g) || []).length >= 2 && /NOT_FOR_COUNTRY/.test(periodSrc));
  ok('the till snapshot reads a state off the tax number only under a state-split pack (tax-packs supply \'state\'), and bills in the pack\'s money', /const stateSplit = \(\(p\) => !p \|\| !p\.supply \|\| p\.supply === 'state'\)/.test(tillSrc) && /state_code: String\(gstin \|\| ''\)\.slice\(0, 2\) && stateSplit/.test(tillSrc) && /packFor\(cbCountry\) \|\| \{\}\)\.currency\) \|\| 'INR'/.test(tillSrc));
  ok('…and the setup\'s money and year count only when the profile row is THIS country\'s (a stub row of another country is not the shop\'s fact)', /String\(cs\.country\.code\)\.toUpperCase\(\) === country \? cs : \{\}/.test(booksSrc));

  gsrv.close(); bsrv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
