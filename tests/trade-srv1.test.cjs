#!/usr/bin/env node
'use strict';
/**
 * tests/trade-srv1.test.cjs — TRADE-SRV1 (2026-10-14): trade lanes for every country and honest defaults. One block per gap:
 *   G1  AU and AE lanes (b538) — the migration's own applicability, run through the real readiness.standardApplies
 *   G2  no India origin, no 'paint' sector: the shop's STATED country and sector, else ASKED with a code (readiness.laneOf); siblings —
 *       the form's Country of origin, the tax-id word, profile / kyb lanes
 *   G3  ?abroad=1 on the chit lists — ONE fragment (country-setup.abroadSql) in the shared chitFilters
 *   G4  the packing list form · G5 papers by deal (context_ref) · G7 the day's rate from the owner's rates (fx-rates.rateOn)
 *   G8  may/why on trade writes — lib/access.mayWrite / writeGate: a viewer is refused WITH the rail's sentence and a code
 * Run: node tests/trade-srv1.test.cjs · no DB (db/index.js is stubbed), no network.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/x';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fail++; console.log('  ✗ ' + what + (info ? '\n      ' + String(info).slice(0, 400) : '')); } };

/* ── the world the stubs answer from ── */
const SHOP = '11111111-1111-4111-8111-111111111111';
let ID = null, GOV = null, SECTORS = [], SQL = [], FORM_ROWS = [];
const STANDARDS = [
  { standard_key: 'iso-9001', title: 'ISO 9001', applicability: {}, guidance: 'g' },
  { standard_key: 'exim-policy', title: 'EXIM', applicability: { origin: ['IN'], cross_border: true }, guidance: 'g' },
  { standard_key: 'au-export-declaration', title: 'AU export', applicability: { origin: ['AU'], cross_border: true }, guidance: 'g' },
  { standard_key: 'aicis', title: 'AICIS', applicability: { destination: ['AU'], categories: ['chemical'] }, guidance: 'g' },
];
const DOCS = STANDARDS.map((s, i) => ({ standard_key: s.standard_key, doc_key: 'd' + i, title: s.title, scope: 'entity', frequency: 'once', display_order: 1 }));
const LANES = [{ dest_key: 'EU', name: 'European Union', domestic: false }, { dest_key: 'IN', name: 'Domestic (India)', domestic: true }, { dest_key: 'AU', name: 'Australia', domestic: false }, { dest_key: 'GULF', name: 'Gulf (GCC)', domestic: false }];
function answer(sql, params) {
  const t = String(sql); SQL.push({ t, params });
  if (/information_schema/.test(t)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
  if (/country-setup \*\/ country, currency_code/.test(t)) return { rows: ID ? [ID] : [], rowCount: ID ? 1 : 0 };
  if (/FROM entity_governance/.test(t)) return { rows: GOV ? [GOV] : [], rowCount: GOV ? 1 : 0 };
  if (/FROM jurisdiction/.test(t)) return { rows: LANES.map((x) => ({ ...x })), rowCount: LANES.length };
  if (/FROM vertical_category/.test(t)) return { rows: params[0] === 'paint' ? [{ category: 'chemical' }] : [], rowCount: 1 };
  if (/FROM standard_source/.test(t)) return { rows: STANDARDS, rowCount: STANDARDS.length };
  if (/FROM standard_document/.test(t)) { const k = params[0] || []; const r = DOCS.filter((d) => k.indexOf(d.standard_key) >= 0); return { rows: r, rowCount: r.length }; }
  if (/FROM entity_profile/.test(t)) return { rows: [{ trade_mode: 'export', markets: [], sectors: SECTORS, adopted: [] }], rowCount: 1 };
  if (/FROM form_instance/.test(t)) return { rows: FORM_ROWS, rowCount: FORM_ROWS.length };
  return { rows: [], rowCount: 0 };
}
const H = { query: async (sql, params) => answer(sql, params || []) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => answer(sql, params || []), withEntity: async (e, fn) => fn(H), onEntity: async (e, fn) => fn(H), withTransaction: async (fn) => fn(H),
  readBatch: async (e, x, qs) => qs.map((q) => answer(q.text, q.params)), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
let WHO = { identity_id: SHOP, identity_type: 'entity' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true });
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };

const R = require(path.join(API, 'lib', 'readiness'));
const CS = require(path.join(API, 'lib', 'country-setup'));
const F = require(path.join(API, 'lib', 'forms'));
const A = require(path.join(API, 'lib', 'access'));
const FXR = require(path.join(API, 'lib', 'fx-rates'));
const shop = (country, done) => { ID = { country, currency_code: country === 'AU' ? 'AUD' : country === 'IN' ? 'INR' : null, gstn: null, timezone: null, policy_flags: {} };
  GOV = { fy_start_month: null, tax_registration: null, setup_source: null, country_setup_at: done ? new Date() : null }; CS._reset(); };

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ G1 · AU and AE lanes (b538) ══');
  const MIG = fs.readFileSync(path.join(API, 'migrations', 'archive', 'b538_trade_lanes_au_ae.sql'), 'utf8');
  ok('b538 adds the AU and AE destinations, idempotent (ON CONFLICT), with its RLS line and the proof block', /\('AU', 'Australia'/.test(MIG) && /\('AE', 'United Arab Emirates'/.test(MIG) && /ON CONFLICT \(dest_key\) DO NOTHING/.test(MIG) && /^-- RLS: WITHOUT/m.test(MIG) && /DO \$\$/.test(MIG));
  const app = {}; MIG.replace(/SET applicability = '([^']+)'::jsonb[\s\S]*?WHERE standard_key = '([a-z0-9-]+)'/g, (m, j, k) => { app[k] = { standard_key: k, applicability: JSON.parse(j) }; });
  ok('b538 states applicability for exim-policy and the five AU/AE standards', ['exim-policy', 'au-export-declaration', 'ae-export-declaration', 'aicis', 'rcm', 'ecas'].every((k) => app[k]), Object.keys(app).join());
  ok('…exim-policy (India\'s IEC) applies to an export FROM India, no longer to an Australian one', R.standardApplies(app['exim-policy'], 'IN', 'EU', []) && !R.standardApplies(app['exim-policy'], 'AU', 'EU', []));
  ok('…an AU exporter to the EU needs the AU export declaration; the UAE\'s does not apply to them', R.standardApplies(app['au-export-declaration'], 'AU', 'EU', []) && !R.standardApplies(app['ae-export-declaration'], 'AU', 'EU', []));
  ok('…AICIS applies to a chemical going INTO Australia, not to textiles, not to the EU', R.standardApplies(app.aicis, 'IN', 'AU', ['chemical']) && !R.standardApplies(app.aicis, 'IN', 'AU', ['textile']) && !R.standardApplies(app.aicis, 'IN', 'EU', ['chemical']));
  ok('…ECAS applies to an electronic product going into the UAE', R.standardApplies(app.ecas, 'AU', 'AE', ['electronic']) && !R.standardApplies(app.ecas, 'AU', 'AE', ['food-safety']));
  ok('no AU/AE standard carries facet \'trade\' (workpattern stamps every trade facet onto every chit)', !/'trade',\s*'\{/.test(MIG.split('-- 2 ·')[1].split('-- 3 ·')[0]));

  console.log('\n══ G2 · the shop\'s stated country and sector — asked, never India / paint ══');
  ok('statedOrigin: a confirmed country is the origin; one still to confirm (the column\'s IN default) is not', R.statedOrigin({ country: { code: 'au' }, required: false }) === 'AU' && R.statedOrigin({ country: { code: 'IN' }, required: true }) === null && R.statedOrigin(null) === null);
  const a0 = R.asks(null, null), a1 = R.asks('AU', null), a2 = R.asks('AU', 'paint');
  ok('asks: no origin → code ORIGIN_UNSTATED (both asked); no sector → SECTOR_UNSTATED; both → no code', a0.code === 'ORIGIN_UNSTATED' && a0.asked.join() === 'origin,sector' && a1.code === 'SECTOR_UNSTATED' && a2.code === null && a2.asked.length === 0);
  SQL = []; ok('verticalCategories(no sector) → [] with no query (was \'paint\')', (await R.verticalCategories(null)).length === 0 && SQL.length === 0);

  shop('IN', false); SECTORS = [];
  let m = await R.resolveLaneMatrix(SHOP, undefined, undefined);
  ok('a shop whose country is still the IN default (setup not done) gets NO lanes and code ORIGIN_UNSTATED — never India', m.origin === null && m.lanes.length === 0 && m.code === 'ORIGIN_UNSTATED' && m.why === R.ORIGIN_UNSTATED, JSON.stringify(m));
  shop('AU', true); SECTORS = [];
  m = await R.resolveLaneMatrix(SHOP, undefined, undefined);
  ok('an Australian shop: origin AU from Country setup, sector asked (SECTOR_UNSTATED), vertical null — not paint', m.origin === 'AU' && m.vertical === null && m.code === 'SECTOR_UNSTATED', JSON.stringify(m).slice(0, 300));
  const au = m.lanes.find((l) => l.dest_key === 'AU'), inl = m.lanes.find((l) => l.dest_key === 'IN');
  ok('…its domestic lane is AU (computed), and the IN row reads "India", not "Domestic (India)"', au && au.domestic === true && inl && inl.domestic === false && inl.dest_name === 'India', JSON.stringify(m.lanes));
  ok('…its EU lane carries the AU export declaration, not India\'s EXIM policy', (m.lanes.find((l) => l.dest_key === 'EU').gaps.join() === 'AU export,ISO 9001' || m.lanes.find((l) => l.dest_key === 'EU').gaps.sort().join() === 'AU export,ISO 9001'), JSON.stringify(m.lanes.find((l) => l.dest_key === 'EU')));
  ok('…the GULF grouping keeps the table\'s name', m.lanes.find((l) => l.dest_key === 'GULF').dest_name === 'Gulf (GCC)');
  SECTORS = ['paint']; m = await R.resolveLaneMatrix(SHOP, undefined, undefined);
  ok('the sector stated in the governance profile is read (paint → chemical → AICIS into Australia)', m.vertical === 'paint' && m.code === null && m.lanes.find((l) => l.dest_key === 'AU').total >= 1, JSON.stringify(m).slice(0, 300));
  SQL = []; await R.resolveLaneMatrix(SHOP, 'paint', 'IN');
  ok('the lane matrix reads the documents ONCE for every lane (was once per lane), 5 statements in all when the screen names origin and sector',
    SQL.filter((x) => /FROM standard_document/.test(x.t)).length === 1 && SQL.length === 5, SQL.map((x) => x.t.slice(0, 40)).join(' | '));
  SQL = []; CS._reset(); await R.resolveLaneMatrix(SHOP, undefined, undefined);
  console.log('      (trips: stated origin and sector read too → ' + SQL.length + ' statements)');
  const d = await R.resolveForDestination(SHOP, 'EU', 'food', 'IN');
  ok('a query value still wins (the screen\'s picker): origin IN asked for → EXIM applies, domestic false', d.origin === 'IN' && d.standards.indexOf('exim-policy') >= 0 && d.domestic === false && d.vertical === 'food');
  shop('IN', false);
  const d0 = await R.resolveForDestination(SHOP, 'EU', 'food', undefined);
  ok('resolveForDestination with no stated origin → no clearances, code ORIGIN_UNSTATED', d0.origin === null && d0.clearances.length === 0 && d0.code === 'ORIGIN_UNSTATED');
  const P = require(path.join(API, 'lib', 'profile'));
  const pr = await P.resolveProfileReadiness(SHOP);
  ok('profile readiness with no stated origin is ASKED (was origin \'IN\', markets EU/IN, sector paint)', pr.code === 'ORIGIN_UNSTATED' && pr.clearances.length === 0, JSON.stringify(pr).slice(0, 200));
  const src = ['lib/readiness.js', 'lib/profile.js', 'lib/kyb.js', 'lib/forms.js'].map((f) => fs.readFileSync(path.join(API, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).join('\n');
  ok('no code fallback to \'paint\', \'IN\' or a derived \'India\' remains in the trade libraries (comments aside)', !/\|\|\s*'paint'|\|\|\s*'IN'\b|'india'|\['paint'\]|\['IN'\]|\['EU'\]/.test(src), (src.match(/\|\|\s*'paint'|\|\|\s*'IN'\b|'india'|\['paint'\]|\['IN'\]|\['EU'\]/) || [])[0]);
  ok('forms: Country of origin derives from the shop\'s stated country; {tax_id} is the pack\'s word (ABN for AU, "tax number" when unstated)',
    F.deriveValue('shop_country', { shop: { country_name: 'Australia' } }) === 'Australia' && F.deriveValue('shop_country', { shop: {} }) === null
    && F.labelOf('Seller {tax_id}', { shop: { tax_id_word: 'ABN' } }) === 'Seller ABN' && F.labelOf('Seller {tax_id}', {}) === 'Seller tax number');

  console.log('\n══ G3 · ?abroad=1 on the chit lists ══');
  const frag = CS.abroadSql('ch', 7);
  ok('abroadSql: the copy\'s currency vs the shop\'s, OR a party\'s country vs the shop\'s — the shop read by ONE placeholder, shopCountrySql reused',
    /ch\.summary_json->>'currency_code'/.test(frag) && /ch\.all_recipients/.test(frag) && frag.indexOf(CS.shopCountrySql(7)) > 0 && !/\$[0-689]/.test(frag));
  ok('…a malformed entity_id is never cast (guarded by the uuid pattern); a non-array all_recipients reads as none', /CASE WHEN r->>'entity_id' ~\*/.test(frag) && /jsonb_typeof\(ch\.all_recipients\) = 'array'/.test(frag));
  ok('…the alias is sanitised', CS.abroadSql('ch; drop', 1).indexOf('chdrop.') >= 0);
  const chits = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
  const cf = chits.slice(chits.indexOf('function chitFilters('), chits.indexOf("router.get('/sent'"));
  ok('chitFilters (inbox · sent · folder share it) adds the fragment only for abroad=1|true', /req\.query\.abroad === '1' \|\| req\.query\.abroad === 'true'/.test(cf) && /abroadSql\('ch', params\.length\)/.test(cf));
  ok('…and the three list routes call chitFilters', (chits.match(/= chitFilters\(req, /g) || []).length >= 3);

  console.log('\n══ G4 · packing list · G5 papers by deal · G7 the day\'s rate ══');
  const pl = F.registry()['packing-list'];
  ok('G4: the packing list is a registry form: exporter · consignee · invoice no · goods · packages required, drawn from the order', pl && ['exporter', 'consignee', 'invoice_no', 'goods', 'packages'].every((k) => pl.fields.find((f) => f.id === k && f.required)) && F.listForms().some((f) => f.key === 'packing-list'));
  const pf = F.resolveField(pl.fields.find((f) => f.id === 'packages'), { vault: {}, order: { packages: '12 cartons' }, manual: {}, shop: {} });
  ok('…a packages value on the order fills it, documented', pf.value === '12 cartons' && pf.rung === 'documented');
  let bad = null; try { await F.listInstances(SHOP, { context_ref: 'x; drop' }); } catch (e) { bad = e; }
  ok('G5: listInstances with a context_ref that is not a chit id → 400 FORMS_BAD_CONTEXT in words', bad && bad.status === 400 && bad.code === 'FORMS_BAD_CONTEXT');
  const CTX = '33333333-3333-4333-8333-333333333333'; FORM_ROWS = [{ form_id: 'f1', context_ref: CTX }]; SQL = [];
  const li = await F.listInstances(SHOP, { context_ref: CTX });
  const q = SQL.find((x) => /FROM form_instance/.test(x.t));
  ok('…a deal\'s id narrows the read in SQL (one statement, the b108 index columns) and each row says its deal', li.context_ref === CTX && q && /context_ref = \$2::uuid/.test(q.t) && q.params[1] === CTX && li.instances[0].context_ref === CTX);
  SQL = []; await F.listInstances(SHOP, {}); ok('…no context_ref → every paper (null param)', SQL.find((x) => /FROM form_instance/.test(x.t)).params[1] === null);

  shop('IN', true);
  const realRateOn = FXR.rateOn; let asked = null;
  FXR.rateOn = async (h, e, from, to, date) => { asked = { from, to, date }; return from === 'USD' ? { rate: 83.25, source: 'manual', date, source_ref: null } : null; };
  let s = await F.shopOf(SHOP, { invoice_party: { currency: 'INR' } }, { currency_code: 'usd', invoice_date: '2026-10-14' });
  ok('G7: a USD deal for an INR shop reads ITS day\'s rate from the owner\'s rates (fx-rates.rateOn, the invoice\'s day)', asked && asked.from === 'USD' && asked.to === 'INR' && asked.date === '2026-10-14' && s.rate.rate === 83.25);
  ok('…the rate field is filled, derived, and says which rate it is with code FX_RATE_OF_DAY', (() => { const f = F.resolveField(F.registry()['commercial-invoice'].fields.find((x) => x.id === 'fx_rate'), { vault: {}, order: {}, manual: {}, shop: s }); return f.value === '83.25' && f.rung === 'derived' && f.code === 'FX_RATE_OF_DAY' && /1 USD = 83.25 INR · 14 Oct · manual/.test(f.note); })());
  s = await F.shopOf(SHOP, { invoice_party: { currency: 'INR' } }, { currency_code: 'EUR', invoice_date: '2026-10-14' });
  ok('…no EUR rate for the day → no value, code FX_RATE_MISSING and fx-rates\' own sentence', s.rate === null && s.rate_say.code === 'FX_RATE_MISSING' && s.rate_say.note === FXR.missingWords('EUR', '2026-10-14'));
  asked = null; s = await F.shopOf(SHOP, { invoice_party: { currency: 'INR' } }, { currency_code: 'INR' });
  ok('…a deal in the shop\'s own money asks for no rate', asked === null && s.rate_say === null);
  FXR.rateOn = realRateOn;
  const ci = F.registry()['commercial-invoice'];
  ok('…the commercial invoice names its currency (the order\'s, else the shop\'s) beside the value', ci.fields.find((f) => f.id === 'currency' && f.required) && ci.fields.findIndex((f) => f.id === 'currency') === ci.fields.findIndex((f) => f.id === 'total_value') + 1);

  console.log('\n══ G8 · may/why on trade writes ══');
  const OWNER = { identity_id: SHOP, identity_type: 'entity' };
  const VIEWER = { identity_id: 'a', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'viewer' };
  const COMMENTER = { identity_id: 'b', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'commenter' };
  const EDITOR = { identity_id: 'c', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
  const mw = (identity) => A.mayWrite({ identity });
  ok('mayWrite: owner and editor may; a viewer gets read_only, a commenter comment_only, each with the rail\'s sentence', mw(OWNER).may && mw(EDITOR).may && !mw(VIEWER).may && mw(VIEWER).code === 'read_only' && mw(COMMENTER).code === 'comment_only' && mw(VIEWER).why === require(path.join(API, 'lib', 'rail')).WHY.read_only);
  const express = require('express');
  const gapp = express(); gapp.use(express.json()); gapp.use('/api/governance', require(path.join(API, 'routes', 'governance'))); gapp.use('/api/forms', require(path.join(API, 'routes', 'forms')));
  const srv = gapp.listen(0); const port = srv.address().port;
  try {
    WHO = VIEWER;
    for (const [mth, p] of [['POST', '/api/governance/compliance'], ['POST', '/api/governance/verify'], ['POST', '/api/governance/supplier-acceptance'], ['POST', '/api/forms/packing-list/issue'], ['POST', '/api/forms/instances/' + CTX + '/sign'], ['POST', '/api/forms/instances/' + CTX + '/attach']]) {
      const r = await call(port, mth, p, { standard_key: 'x', doc_key: 'y' });
      ok('a viewer: ' + mth + ' ' + p + ' → 403 read_only with the sentence', r.status === 403 && r.body.code === 'read_only' && r.body.message === mw(VIEWER).why, JSON.stringify(r));
    }
    let r = await call(port, 'GET', '/api/governance/lanes');
    ok('GET /lanes tells the viewer may.gather { may:false, why } — the screen greys the button WITH the sentence', r.status === 200 && r.body.may && r.body.may.gather.may === false && r.body.may.gather.code === 'read_only' && !!r.body.may.gather.why, JSON.stringify(r.body).slice(0, 300));
    r = await call(port, 'GET', '/api/forms');
    ok('GET /forms tells the viewer may.issue/sign/attach = false', r.body.may && r.body.may.issue.may === false && r.body.may.sign.may === false && r.body.may.attach.may === false);
    WHO = OWNER; shop('AU', true);
    r = await call(port, 'GET', '/api/governance/lanes');
    ok('the owner: GET /lanes may.gather true, origin AU from Country setup', r.status === 200 && r.body.may.gather.may === true && r.body.origin === 'AU', JSON.stringify(r.body).slice(0, 300));
    r = await call(port, 'GET', '/api/forms/instances/all?context_ref=' + CTX);
    ok('the owner: GET /forms/instances/all?context_ref → the deal\'s papers + may', r.status === 200 && r.body.context_ref === CTX && r.body.may.issue.may === true, JSON.stringify(r.body));
    r = await call(port, 'GET', '/api/forms/instances/all?context_ref=nope');
    ok('…a bad context_ref → 400 FORMS_BAD_CONTEXT', r.status === 400 && r.body.code === 'FORMS_BAD_CONTEXT', JSON.stringify(r.body));
  } finally { srv.close(); }
  const rs = fs.readFileSync(path.join(API, 'routes', 'repeat-supply.js'), 'utf8');
  ok('repeat-supply\'s editorMay answers from the same helper (one place, lifted)', /access\.mayWrite\(req\)/.test(rs));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
