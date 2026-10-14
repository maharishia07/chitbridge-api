'use strict';
/**
 * tests/counters-owner-gate.test.cjs — ⭐ ONE OWNER GATE ON EVERY COUNTERS ROUTE (T3-SETTINGS, 2026-10-14).
 *
 * Until today only POST /:id/assign asked lib/owner; a co-assist could add, rename, open and release the shop's counters. Which series a
 * shop bills under is the owner's call on all six, so routes/counters.js now has ONE `gate` (auth · sessionOnly · ownerOnly) and the refusal
 * carries the code CB Settings › Counters & keys greys on: 403 { code: 'OWNER_ONLY', message }. Offline: the real router over a stand-in db.
 *
 * Run: node tests/counters-owner-gate.test.cjs   · no DB, no network.
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

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Fixture Shop' };
const ASSIST = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1', display_name: 'Ravi' };
let WHO = OWNER, KEY = false;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = { scopes: ['till'] }; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  forgetKey: () => {},
}));

/* the stand-in database: one shop with one closed counter C1 and no keys */
let PF = { counters: { C1: { id: 'C1', name: 'Front desk', created_at: '2026-10-01T00:00:00Z', held_by: null } }, api_keys: [] };
const writes = [];
function answer(text, params) {
  const sql = String(text);
  if (/SELECT policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: PF }] };
  if (/FROM chit_header/.test(sql)) return { rows: [] };
  if (/^\s*UPDATE identities/.test(sql)) { writes.push(sql.replace(/\s+/g, ' ').slice(0, 60)); return { rows: [] }; }
  return { rows: [] };
}
const db = { query: async (s, p) => answer(s, p), withTransaction: async (fn) => fn({ query: async (s, p) => answer(s, p) }) };
mock('/db', db);

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
  app.use('/api/counters', require(API + '/routes/counters'));
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- T3-SETTINGS: one owner gate on every counters route --\n');
  const ROUTES = [['GET', '/api/counters'], ['POST', '/api/counters', { name: 'Billing 2' }], ['PATCH', '/api/counters/C1', { name: 'Desk' }],
                  ['POST', '/api/counters/C1/open'], ['POST', '/api/counters/C1/release'], ['POST', '/api/counters/C1/assign', { phone: '' }]];

  WHO = ASSIST;
  for (const [m, p, b] of ROUTES) {
    writes.length = 0;
    const r = await call(port, m, p, b);
    t('a co-assist: ' + m + ' ' + p + ' -> 403 OWNER_ONLY with the sentence, nothing written', [r.status, r.json && r.json.code, r.json && r.json.message, writes.length],
      [403, 'OWNER_ONLY', 'Only the owner manages the counters.', 0]);
  }
  KEY = true; WHO = OWNER;
  let r = await call(port, 'GET', '/api/counters');
  t('a key: GET /api/counters -> 403 (a key is not a person; the sessionOnly sentence stands)', [r.status, /signed-in person/.test(r.json && r.json.message)], [403, true]);
  KEY = false;

  WHO = OWNER;
  r = await call(port, 'GET', '/api/counters');
  t('the owner: GET /api/counters -> 200, the register', [r.status, r.json.counters.map((c) => [c.id, c.name, c.state]), r.json.free], [200, [['C1', 'Front desk', 'closed']], 1]);
  writes.length = 0;
  r = await call(port, 'PATCH', '/api/counters/C1', { name: 'Desk' });
  t('the owner: PATCH /api/counters/C1 -> 200 and one write', [r.status, r.json.name, writes.length], [200, 'Desk', 1]);
  writes.length = 0;
  r = await call(port, 'POST', '/api/counters/C1/release');
  t('the owner: POST /api/counters/C1/release -> 200 (a free counter releases to free)', [r.status, r.json.ok, r.json.id], [200, true, 'C1']);
  r = await call(port, 'POST', '/api/counters/C1/assign', { phone: 'abc' });
  t('the owner: a bad phone is the validation sentence, not the gate', [r.status, r.json.code], [400, 'BAD_PHONE']);

  /* the gate is ONE: no route in the file carries its own isOwner any more */
  const src = require('fs').readFileSync(path.join(API, 'routes', 'counters.js'), 'utf8');
  t('routes/counters.js asks lib/owner exactly once (the gate), and every route wears the gate', [(src.match(/isOwner\(/g) || []).length, (src.match(/, gate, async/g) || []).length, (src.match(/auth, sessionOnly, async/g) || []).length], [1, 6, 0]);

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
