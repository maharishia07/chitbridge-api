/**
 * tests/cat211-rate-doors.test.cjs — CAT-211: a category's rate and the shop default are owner or manager only (the other two rate doors).
 *
 * Ruling 24 Oct 2026: a rate is a money promise, on EVERY door. CAT-210 gated the products doors; this gates PUT /definitions/:id
 * (rules.default_slab), POST /definitions (a category born with a rate), DELETE /definitions/:id?takeover= (re-points categories) and
 * PUT /catalogue-face (face.tax.default_slab). The rule, the code and the sentence are lib/rate-door.js's, once. The WHOLE request is refused
 * (nothing written); a value echoed back unchanged is not a change.
 * Also proves the writer list is complete: nothing else in routes/ or lib/ writes either field (the scan at the end).
 * Run: node tests/cat211-rate-doors.test.cjs   (no live database: stubbed auth and db)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(80) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const SENTENCE = 'Ask the owner or a manager to set the tax rate.';
const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const actor = (hat) => ({ identity_id: 'a-' + hat, identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat, display_name: hat });
const CAT = '22222222-2222-4222-8222-222222222222';
const SLAB = '33333333-3333-4333-8333-333333333333';
const STORED_RULES = { default_slab: 'slab-5', parent: null };
const STORED_FACE = { purpose: 'shop', tax: { default_slab: 'slab-5', registered: true } };

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n-- CAT-211 · a category rate and the shop default are owner or manager only --\n');
  let WHO = OWNER, writes = 0;
  const writeSql = /^\s*(INSERT|UPDATE)/i;
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => (req.identity.parent_entity_id || req.identity.identity_id) })
  };
  const stub = async (sql) => {
    if (writeSql.test(sql)) writes++;
    if (/SELECT face FROM catalogue_face/.test(sql)) return { rows: [{ face: STORED_FACE }] };
    if (/INSERT INTO catalogue_face/.test(sql)) return { rows: [{ updated_at: '2026-10-24T00:00:00Z' }] };
    if (/SELECT \* FROM definition WHERE/.test(sql)) return { rows: [{ definition_id: CAT, kind: 'category', sub_kind: null, status: 'live', current_version: 2, name: 'Veg' }] };
    if (/SELECT rules FROM definition_version/.test(sql)) return { rows: [{ rules: STORED_RULES }] };
    if (/SELECT kind, status FROM definition/.test(sql)) return { rows: [{ kind: 'tax', status: 'live' }] };
    if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return { rows: [{ n: 2 }] };
    if (/count\(\*\)::int AS n FROM definition/.test(sql)) return { rows: [{ n: 1 }] };
    if (/UPDATE definition SET status/.test(sql)) return { rows: [] };
    if (/UPDATE definition\b/.test(sql)) return { rows: [{ definition_id: CAT, current_version: 3 }] };
    if (/INSERT INTO definition /.test(sql)) return { rows: [{ definition_id: CAT }] };
    return { rows: [] };
  };
  require.cache[require.resolve(API + '/db')] = { exports: { query: stub, withEntity: async (_id, fn) => fn({ query: stub }), withTransaction: async (fn) => fn({ query: stub }), readBatch: async () => [{ rows: [] }] } };
  const app = express(); app.use(express.json());
  app.use('/api/definitions', require(API + '/routes/definitions'));
  app.use('/api/catalogue-face', require(API + '/routes/catalogue-face'));
  const server = app.listen(0); const port = server.address().port;
  const put = (id, body) => call(port, 'PUT', '/api/definitions/' + id, body);
  const face = (f) => call(port, 'PUT', '/api/catalogue-face', { face: f });
  const refused = (r) => [r.status, r.body.code, r.body.message, r.body.may, r.body.why];
  const REFUSED = [403, 'TILL_RATE_OWNER_ONLY', SENTENCE, false, SENTENCE];

  const door = require(API + '/lib/rate-door');
  t('default_slab compare: changed, dropped, blank = nobody said, unchanged',
    [door.defaultSlabChanged({ default_slab: 'b' }, { default_slab: 'a' }), door.defaultSlabChanged({}, { default_slab: 'a' }), door.defaultSlabChanged({ default_slab: '' }, {}), door.defaultSlabChanged({ default_slab: 'a', x: 1 }, { default_slab: 'a' })],
    [true, true, false, false]);
  t('the face compare reads only face.tax.default_slab',
    [door.faceRateChanged({ tax: { default_slab: 'b' } }, STORED_FACE), door.faceRateChanged({ purpose: 'x' }, STORED_FACE), door.faceRateChanged(STORED_FACE, STORED_FACE), door.faceRateChanged({ purpose: 'y' }, null)],
    [true, true, false, false]);

  console.log('\n   PUT /definitions/:id (a category rate)');
  for (const hat of ['editor', 'cashier']) {
    WHO = actor(hat); writes = 0;
    const r = await put(CAT, { rules: { default_slab: 'slab-18' } });
    t(hat + ' changes the category rate: 403, the one shape, nothing written', [refused(r), writes], [REFUSED, 0]);
    t('  ...and the answer never echoes the caller value (Q19)', /slab-18|18/.test(JSON.stringify(r.body)), false);
  }
  WHO = actor('editor'); writes = 0;
  const wipe = await put(CAT, { rules: { parent: null } });
  t('editor replaces rules WITHOUT the rate (would wipe it): 403, nothing written', [wipe.status, writes], [403, 0]);
  const mixed = await put(CAT, { name: 'Veg 2', rules: { default_slab: 'slab-18' } });
  t('editor renames AND changes the rate: the WHOLE request refused', [mixed.status, writes], [403, 0]);
  const same = await put(CAT, { rules: { default_slab: 'slab-5', parent: null, note: 'x' } });
  t('editor edit that keeps the rate unchanged still saves', [same.status, writes > 0], [200, true]);
  writes = 0;
  t('editor rename (no rules) still saves', [(await put(CAT, { name: 'Veg 2' })).status, writes > 0], [200, true]);
  for (const who of [actor('manager'), OWNER]) {
    WHO = who; writes = 0;
    t((who.hat || 'owner') + ' changes the category rate: 200 and written', [(await put(CAT, { rules: { default_slab: 'slab-18' } })).status, writes > 0], [200, true]);
  }

  console.log('\n   POST /definitions (a category born with a rate)');
  WHO = actor('editor'); writes = 0;
  const born = await call(port, 'POST', '/api/definitions', { kind: 'category', name: 'Veg', rules: { default_slab: 'slab-18' } });
  t('editor creates a category naming a rate: 403, nothing written', [refused(born), writes], [REFUSED, 0]);
  t('editor creates a category with no rate: 201', (await call(port, 'POST', '/api/definitions', { kind: 'category', name: 'Veg', rules: {} })).status, 201);
  WHO = actor('manager');
  t('manager creates a category naming a rate: 201', (await call(port, 'POST', '/api/definitions', { kind: 'category', name: 'Veg', rules: { default_slab: 'slab-18' } })).status, 201);

  console.log('\n   DELETE /definitions/:id?takeover= (re-points the categories)');
  WHO = actor('editor'); writes = 0;
  const del = await call(port, 'DELETE', '/api/definitions/' + SLAB + '?takeover=' + SLAB, {});
  t('editor retires a cited slab WITH a takeover (it would re-point rates): 403, nothing written', [refused(del), writes], [REFUSED, 0]);
  const plain = await call(port, 'DELETE', '/api/definitions/' + SLAB, {});
  t('editor retires a cited slab with no takeover: the old 409 cited, nothing re-pointed', [plain.status, plain.body.error, writes], [409, 'cited', 0]);

  console.log('\n   PUT /catalogue-face (the shop default)');
  for (const hat of ['editor', 'cashier']) {
    WHO = actor(hat); writes = 0;
    const r = await face({ purpose: 'shop', tax: { default_slab: 'slab-18' } });
    t(hat + ' changes the shop default: 403, the one shape, nothing written', [refused(r), writes], [REFUSED, 0]);
    t('  ...and the answer never echoes the caller value (Q19)', /slab-18|18/.test(JSON.stringify(r.body)), false);
  }
  WHO = actor('editor'); writes = 0;
  t('editor saves a face that DROPS the default (would wipe it): 403', [(await face({ purpose: 'shop' })).status, writes], [403, 0]);
  const ok = await face({ purpose: 'shop', tax: { default_slab: 'slab-5', registered: false } });
  t('editor saves a face with the default unchanged: 200 and written', [ok.status, writes], [200, 1]);
  WHO = actor('manager'); writes = 0;
  t('manager changes the shop default: 200 and written', [(await face({ tax: { default_slab: 'slab-18' } })).status, writes], [200, 1]);
  WHO = OWNER; writes = 0;
  t('owner changes the shop default: 200 and written', [(await face({ tax: { default_slab: 'slab-18' } })).status, writes], [200, 1]);

  console.log('\n   no other writer');
  const writers = [];
  const takeoverCallers = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!/\.js$/.test(e.name)) return;
    const s = fs.readFileSync(p, 'utf8');
    const rel = path.relative(API, p).replace(/\\/g, '/');
    if (/INSERT INTO catalogue_face|UPDATE catalogue_face|jsonb_build_object\('default_slab'/.test(s)) writers.push(rel);
    if (/slabCites\.guard\(|slabCites\.takeover\(|slab-cites'\)\.takeover/.test(s)) takeoverCallers.push(rel);
  });
  walk(API + '/routes'); walk(API + '/lib');
  t('only the face route and the slab hand-over write the two defaults', writers.sort(), ['lib/slab-cites.js', 'routes/catalogue-face.js']);
  t('the hand-over is reached only from routes/definitions.js (gated above)', takeoverCallers, ['routes/definitions.js']);
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
