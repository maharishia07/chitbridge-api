/**
 * account-sessions.test.cjs — T3-P4-ACCOUNT (2026-10-14): CB Settings › Account reads the server's may/why, and Home's two new cards.
 *
 * Offline: the real routes/signin.js (sessions · devices · revoke) and routes/facts.js over a stand-in db. Held here:
 *   · GET /api/signin/sessions lists MY live sessions, marks the current one, and says may.devices — ok for the owner, OWNER_ONLY + the gate's
 *     sentence for a co-assist (the same sentence the gate refuses with)
 *   · GET /api/signin/devices: a co-assist is refused 403 with code OWNER_ONLY (lib/owner.gate); the owner reads every device with its live count
 *   · POST /api/signin/sessions/revoke { device_id } from a co-assist: 403 OWNER_ONLY, the db never written
 *   · GET /api/facts/account: devices holding a live session now (a revoked device and an expired session do not count) + keys for other systems
 *   · GET /api/facts/reports: open · stuck from lib/measure over the rail's read; omitted when the read is truncated
 *
 * Run: node tests/account-sessions.test.cjs
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
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(88) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { const f = require.resolve(API + rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const OWNER = { identity_id: 'e1', identity_type: 'entity' };
const COASSIST = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' };
let WHO = OWNER, SESSION = null, writes = 0;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; req.session = SESSION; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(), forgetKey: () => {},
}));

const now = Math.floor(Date.now() / 1000);
const DEVICES = {
  'dev-laptop': { label: null, kind: 'web', by: 'e1', first_seen: '2026-10-01T09:00:00Z', seen: '2026-10-14T09:00:00Z', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    sessions: [{ jti: 'j-cur', iat: now - 100, exp: now + 3600, surface: 'index', by: 'e1' }, { jti: 'j-old', iat: now - 9000, exp: now - 10, surface: 'index', by: 'e1' }] },
  'dev-phone': { label: null, kind: 'till', by: 'e1', first_seen: '2026-10-02T09:00:00Z', seen: '2026-10-13T09:00:00Z', ua: 'Mozilla/5.0 (Android) Chrome/120',
    sessions: [{ jti: 'j-phone', iat: now - 500, exp: now + 3600, surface: 'till', by: 'e1' }, { jti: 'j-clerk', iat: now - 500, exp: now + 3600, surface: 'till', by: 'a1' }] },
  'dev-gone': { label: null, kind: 'web', by: 'e1', first_seen: '2026-09-02T09:00:00Z', seen: '2026-09-13T09:00:00Z', revoked_at: '2026-09-14T09:00:00Z',
    sessions: [{ jti: 'j-gone', iat: now - 500, exp: now + 3600, surface: 'index', by: 'e1' }] },
};
let CHITS = [];
const DAY = 86400000;
const d = (n) => new Date(Date.now() - n * DAY);
const rowsFew = () => [
  { chit_id: 'c1', direction: 'received', sender_entity_id: 'e9', current_status: 'pending', created_at: d(10), open_disputes: 0 },
  { chit_id: 'c2', direction: 'sent', sender_entity_id: 'e1', current_status: 'accepted', created_at: d(1), open_disputes: 0 },
  { chit_id: 'c3', direction: 'received', sender_entity_id: 'e9', current_status: 'completed', created_at: d(30), open_disputes: 0 },
  { chit_id: 'n1', direction: 'received', sender_entity_id: 'e1', current_status: 'pending', created_at: d(20), open_disputes: 0 },   /* the shop's own note: open, never stuck */
];
const register = () => ({ rows: [{ country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', counters: {}, devices: DEVICES,
  keys: [{ jti: 'k1', scopes: ['services'], till: {} }, { jti: 'k2', scopes: ['till'], till: { id: 'C1' } }] }], rowCount: 1 });
const answer = (text) => {
  const s = String((text && text.text) || text || '');
  if (/AS counters/.test(s)) return register();
  if (/overdue_days/.test(s)) return { rows: [{ overdue_days: 7 }], rowCount: 1 };
  return { rows: [{ policy_flags: { devices: DEVICES } }], rowCount: 1 };
};
const h = { query: async (q) => { if (/UPDATE|FOR UPDATE/i.test(String((q && q.text) || q))) writes++; return answer(q); } };
const db = { query: async (q) => answer(q), withTransaction: async (fn) => { writes++; return fn(h); }, withEntity: async (e, fn) => fn(h),
  readBatch: async (e, a, stmts) => stmts.map((x) => answer(x)) };
mock('/db', db); mock('/db/index', db);
mock('/lib/select', { rows: async () => CHITS });

const app = express(); app.use(express.json());
app.use('/api/signin', require(API + '/routes/signin'));
app.use('/api/facts', require(API + '/routes/facts'));

const call = (port, method, p, body) => new Promise((ok) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} ok({ status: res.statusCode, json: j }); });
  });
  if (data) req.write(data); req.end();
});

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- T3-P4-ACCOUNT: sessions may/why, the one gate, two Home cards --\n');
  const WHY = 'Only the owner may see or remove every device.';

  SESSION = { jti: 'j-cur', device_id: 'dev-laptop' };
  let r = await call(port, 'GET', '/api/signin/sessions');
  t('owner GET /sessions -> my live sessions only (the expired one and the clerk\'s left out), the current marked', r.json.sessions.map((s) => s.jti + ':' + s.current), ['j-cur:true', 'j-phone:false']);
  t('owner GET /sessions -> may.devices ok', r.json.may, { devices: { ok: true, code: null, why: null } });
  t('a revoked device lists no session', r.json.sessions.some((s) => s.device_id === 'dev-gone'), false);

  r = await call(port, 'GET', '/api/signin/devices');
  t('owner GET /devices -> every device with its live count', r.json.devices.map((x) => x.device_id + ':' + x.sessions), ['dev-laptop:1', 'dev-phone:2', 'dev-gone:1']);

  WHO = COASSIST; SESSION = { jti: 'j-clerk', device_id: 'dev-phone' };
  r = await call(port, 'GET', '/api/signin/sessions');
  t('co-assist GET /sessions -> 200, own sessions, may.devices greyed with the gate\'s sentence', [r.status, r.json.sessions.map((s) => s.jti), r.json.may.devices],
    [200, ['j-clerk'], { ok: false, code: 'OWNER_ONLY', why: WHY }]);
  r = await call(port, 'GET', '/api/signin/devices');
  t('co-assist GET /devices -> 403 OWNER_ONLY, the same sentence', [r.status, r.json.code, r.json.message], [403, 'OWNER_ONLY', WHY]);
  writes = 0;
  r = await call(port, 'POST', '/api/signin/sessions/revoke', { device_id: 'dev-laptop' });
  t('co-assist revoke { device_id } -> 403 OWNER_ONLY, nothing written', [r.status, r.json.code, writes], [403, 'OWNER_ONLY', 0]);

  WHO = OWNER; SESSION = { jti: 'j-cur', device_id: 'dev-laptop' };
  r = await call(port, 'GET', '/api/facts/account');
  t('facts/account -> 2 devices hold a sign-in now (the revoked one does not), 1 key for other systems (the till key is a counter)',
    [r.status, r.json.lines.map((l) => l.text), r.json.figures], [200, ['Signed in on 2 devices', '1 key for other systems'], { devices: 2, keys: 1 }]);

  CHITS = rowsFew();
  r = await call(port, 'GET', '/api/facts/reports');
  t('facts/reports -> open (3: two chits + the own note) and stuck (1: the 10-day pending chit; the own note never)', [r.status, r.json.lines.map((l) => l.text), r.json.figures],
    [200, ['3 chits open', '1 chit stuck'], { open: 3, overdue: 1, overdue_days: 7 }]);
  CHITS = Array.from({ length: 5000 }, (_, i) => ({ chit_id: 'x' + i, direction: 'received', sender_entity_id: 'e9', current_status: 'completed', created_at: d(40), open_disputes: 0 }));
  r = await call(port, 'GET', '/api/facts/reports');
  t('facts/reports on a truncated read -> no figure, said why', [r.json.lines, typeof r.json.unavailable], [[], 'string']);

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
