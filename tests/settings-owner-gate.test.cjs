/**
 * settings-owner-gate.test.cjs — T3-SETTINGS (2026-10-14): ONE owner gate on every counters write, and the may/why CB Settings greys with.
 *
 * Offline: the real routes/counters.js and the real GET/PATCH /entities/policy over a stand-in db. Held here:
 *   · lib/owner.gate refuses a co-assist on add · rename · open · release · assign with 403 code OWNER_ONLY and one sentence; the db is never asked
 *   · the owner passes the gate (the handler runs)
 *   · GET /api/counters is read by any signed-in person and says may.manage — ok for the owner, OWNER_ONLY + the gate's own sentence for a co-assist
 *   · GET /entities/policy says may per flag: owner-only flags greyed for a co-assist with the PATCH's own sentence, the bound flag PLATFORM_BOUND
 *   · PATCH /entities/policy refuses an owner-only flag from a co-assist with code OWNER_ONLY and that same sentence
 *
 * Run: node tests/settings-owner-gate.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { const f = require.resolve(API + rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const OWNER = { identity_id: 'e1', identity_type: 'entity' };
const COASSIST = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' };
let WHO = OWNER, asked = 0;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(), forgetKey: () => {}, SCOPE_NAMES: ['till', 'services', 'offers', 'pricing', 'connector'],
}));
const answer = () => { asked++; return { rows: [{ policy_flags: { counters: { C1: { id: 'C1', name: 'Front desk' } } } }], rowCount: 1 }; };
const db = { query: async () => answer(), withTransaction: async (fn) => fn({ query: async () => answer() }), withEntity: async (e, fn) => fn({ query: async () => answer() }),
  readBatch: async () => [answer()] };
mock('/db', db);
mock('/db/index', db);

const owner = require(API + '/lib/owner');
const app = express(); app.use(express.json());
app.use('/api/counters', require(API + '/routes/counters'));
const policy = require(API + '/lib/policy');
policy.get = async () => policy.defaults();
policy.set = async (e, b) => Object.assign(policy.defaults(), b);
app.use('/api/entities', require(API + '/routes/entities'));

const call = (port, method, p, body) => new Promise((ok) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} ok({ status: res.statusCode, json: j }); });
  });
  if (data) req.write(data); req.end();
});

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- T3-SETTINGS: one owner gate, and the may/why --\n');

  t('lib/owner.may: the owner may', owner.may({ identity: OWNER }, 'x'), { ok: true, code: null, why: null });
  t('lib/owner.may: a co-assist may not, with the sentence given', owner.may({ identity: COASSIST }, 'Only the owner.'), { ok: false, code: 'OWNER_ONLY', why: 'Only the owner.' });
  t('lib/owner.may: a key is never the owner', owner.may({ identity: OWNER, api_key: { scopes: ['till'] } }).ok, false);

  WHO = COASSIST;
  const writes = [['POST', '/api/counters', { name: 'Back' }], ['PATCH', '/api/counters/C1', { name: 'Back' }], ['POST', '/api/counters/C1/open'],
    ['POST', '/api/counters/C1/release'], ['POST', '/api/counters/C1/assign', { phone: '' }]];
  for (const [m, p, b] of writes) {
    asked = 0; const r = await call(port, m, p, b);
    t('co-assist ' + m + ' ' + p + ' -> 403 OWNER_ONLY, the db never asked', [r.status, r.json && r.json.code, asked], [403, 'OWNER_ONLY', 0]);
  }
  let r = await call(port, 'POST', '/api/counters/C1/open');
  t('the refusal is one sentence in words', r.json.message, 'Only the owner can change the counters.');
  r = await call(port, 'GET', '/api/counters');
  t('co-assist GET /api/counters -> 200, the list, may.manage greyed with the gate\'s sentence', [r.status, r.json.counters.length, r.json.may.manage],
    [200, 1, { ok: false, code: 'OWNER_ONLY', why: 'Only the owner can change the counters.' }]);

  WHO = OWNER;
  r = await call(port, 'GET', '/api/counters');
  t('owner GET /api/counters -> may.manage ok', r.json.may.manage, { ok: true, code: null, why: null });
  r = await call(port, 'PATCH', '/api/counters/C1', { name: 'Back' });
  t('owner PATCH /api/counters/C1 passes the gate (renamed)', [r.status, r.json && r.json.name], [200, 'Back']);

  /* policy */
  WHO = COASSIST;
  r = await call(port, 'GET', '/api/entities/policy');
  t('GET /entities/policy: may for every flag in the schema', Object.keys(policy.FLAGS).every((k) => r.json.may[k] && typeof r.json.may[k].ok === 'boolean'), true);
  t('GET /entities/policy: a co-assist may set an entity flag (trade_side)', r.json.may.trade_side.ok, true);
  t('GET /entities/policy: a co-assist may not switch folders - OWNER_ONLY with the PATCH\'s sentence', r.json.may.system_folders, { ok: false, code: 'OWNER_ONLY', why: 'Only the owner may switch folders on or off.' });
  t('GET /entities/policy: the platform-bound flag says PLATFORM_BOUND', [r.json.may.dispute_scope.ok, r.json.may.dispute_scope.code], [false, 'PLATFORM_BOUND']);
  r = await call(port, 'PATCH', '/api/entities/policy', { books: { auto_post: true } });
  t('PATCH /entities/policy books from a co-assist -> 403 OWNER_ONLY, the same sentence the GET greys with', [r.status, r.json.code, r.json.message], [403, 'OWNER_ONLY', 'Only the owner may let the books post by themselves.']);
  WHO = OWNER;
  r = await call(port, 'GET', '/api/entities/policy');
  t('GET /entities/policy: the owner may switch folders', r.json.may.system_folders.ok, true);

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
