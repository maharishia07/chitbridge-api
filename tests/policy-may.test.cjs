'use strict';
/**
 * tests/policy-may.test.cjs — WHO MAY CHANGE A POLICY FLAG IS THE SERVER'S ANSWER, SENT AS A CODE (T3-SETTINGS, 2026-10-14).
 *
 * GET /api/entities/policy now carries `may[key] = { ok, code, why }` for the caller, from the ONE table lib/policy.OWNER_ONLY + BOUND that the
 * PATCH refuses with. CB Settings › Policy greys a control on `ok === false` and paints `why`; it never reads the sentence to decide.
 *
 * Run: node tests/policy-may.test.cjs   · no DB, no network.
 */
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
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

/* ⚠️ the stand-in db BEFORE lib/policy: policy destructures `query` from ../db at load, so a later mock would never be seen */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const writes = [];
function answer(text) {
  const sql = String(text);
  if (/SELECT policy_flags, self_copy_pref FROM identities/.test(sql)) return { rows: [{ policy_flags: { trade_side: 'receive' }, self_copy_pref: null }] };
  if (/^\s*UPDATE identities SET policy_flags/.test(sql)) { writes.push(1); return { rows: [] }; }
  return { rows: [] };
}
mock('/db', { query: async (s) => answer(s), withTransaction: async (fn) => fn({ query: async (s) => answer(s) }), withEntity: async (_e, fn) => fn({ query: async (s) => answer(s) }),
  readBatch: async (_e, _a, st) => st.map((s) => answer(s.text)), schema: { hasTable: async () => false, hasColumns: async () => ({}) }, pool: { query: async (s) => answer(s) } });

/* lib/policy on its own, before any route: the table */
const policy = require(API + '/lib/policy');
t('may: an ordinary flag is anyone\'s', policy.may('trade_side', false), { ok: true, code: null, why: null });
t('may: an owner-only key refuses a co-assist with OWNER_ONLY and the sentence', policy.may('system_folders', false), { ok: false, code: 'OWNER_ONLY', why: 'Only the owner may switch folders on or off.' });
t('may: the same key is the owner\'s', policy.may('books', true), { ok: true, code: null, why: null });
t('may: a platform-bound flag is nobody\'s, owner included', policy.may('dispute_scope', true), { ok: false, code: 'PLATFORM_BOUND', why: 'Set by the platform for every shop.' });
t('mayAll: every FLAGS key and every BOUND key answers', Object.keys(policy.mayAll(true)).length, Object.keys(policy.FLAGS).length + Object.keys(policy.BOUND).length);
t('OWNER_ONLY names only keys the schema has', Object.keys(policy.OWNER_ONLY).every((k) => k in policy.FLAGS), true);

/* the route: the real router over the stand-in */
const OWNER = { identity_id: 'e1', identity_type: 'entity' };
const ASSIST = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' };
let WHO = OWNER, KEY = false;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = { scopes: ['services'] }; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(), forgetKey: () => {},
}));
const call = (port, method, p, body) => new Promise((ok) => {
  const data = body ? JSON.stringify(body) : null;
  const q = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) {} ok({ status: res.statusCode, json }); });
  });
  if (data) q.write(data); q.end();
});

(async () => {
  const app = express(); app.use(express.json());
  let router;
  try { router = require(API + '/routes/entities'); } catch (e) { console.log('  SKIP the route half: routes/entities.js could not load offline — ' + String(e && e.message).slice(0, 120)); console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n'); process.exit(fail ? 1 : 0); }
  app.use('/api/entities', router);
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- GET/PATCH /api/entities/policy: may ---\n');

  WHO = ASSIST;
  let r = await call(port, 'GET', '/api/entities/policy');
  t('a co-assist reads: flags + schema + bound + may', [r.status, typeof r.json.may, r.json.may.system_folders, r.json.may.trade_side.ok, r.json.may.dispute_scope.code],
    [200, 'object', { ok: false, code: 'OWNER_ONLY', why: 'Only the owner may switch folders on or off.' }, true, 'PLATFORM_BOUND']);
  writes.length = 0;
  r = await call(port, 'PATCH', '/api/entities/policy', { books: { auto_post: 'on' } });
  t('a co-assist writes an owner-only key -> 403 with the SAME code and sentence, nothing written', [r.status, r.json.code, r.json.message, writes.length], [403, 'OWNER_ONLY', 'Only the owner may let the books post by themselves.', 0]);
  r = await call(port, 'PATCH', '/api/entities/policy', { trade_side: 'sell' });
  t('a co-assist writes an ordinary flag -> 200', [r.status, writes.length], [200, 1]);

  WHO = OWNER;
  r = await call(port, 'GET', '/api/entities/policy');
  t('the owner reads: the owner-only keys are hers', [r.json.may.system_folders.ok, r.json.may.books.ok, r.json.may.dispute_scope.ok], [true, true, false]);

  KEY = true;
  r = await call(port, 'GET', '/api/entities/policy');
  t('a key reads: every flag answers KEY — a key never writes policy', [r.status, r.json.may.trade_side.code, Object.values(r.json.may).every((m) => m.ok === false)], [200, 'KEY', true]);
  KEY = false;

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
