/**
 * tests/auth-first.test.cjs — M04 (IAM §35): POST /api/chits/send decides WHO before it reads WHAT.
 *
 * Two claims, both proved against the REAL middleware/auth.js, the REAL routes/chits.js and the REAL wiring module
 * server.js mounts (middleware/auth-first.js). Only the database is stubbed.
 *
 *   1. AUTH BEFORE BODY — an unauthenticated POST with a malformed or oversized body gets 401 (not 400/413), its body is
 *      never parsed (req.body stays undefined) and the route's validator chain never runs (no express-validator context).
 *   2. NO ALLOW/DENY OUTCOME CHANGES — every (caller × body) pair is sent to two apps built from the same code:
 *        BEFORE  = global express.json/urlencoded + the /send route with auth AFTER its validators (the old order, rebuilt
 *                  from today's routes/chits.js by moving `auth,` back — so the two differ ONLY in M04's reorder)
 *        AFTER   = server.js's M04 wiring (authFirst.parsers · authFirst.authThenParse) + today's route (auth first).
 *      Every pair answers the same status, except one family that the row asks for: a caller auth REFUSES that also sent a
 *      broken body (malformed / oversized) now gets auth's refusal instead of the parser's 400/413. The set of ALLOWED
 *      pairs (status not 401/403) is asserted identical.
 *
 * Run: node tests/auth-first.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-first';
const API = path.join(__dirname, '..');

/* ── the database, answered by question: a key listing, an actor's row, nothing else ─────────────────────────── */
const KEYS = [{ jti: 'k-till', scopes: ['till'], till: { id: 'C1' } }, { jti: 'k-offers', scopes: ['offers'] }];
const ACTORS = { 'a-view': { break_status: 'active', hat: 'view_only', access_level: 'viewer' },
                 'a-act': { break_status: 'active', hat: 'act', access_level: 'editor' } };
const answer = (sql, params) => {
  const s = String(sql);
  if (/policy_flags/.test(s) && /FROM identities/.test(s)) return [{ policy_flags: { api_keys: KEYS } }];
  if (/break_status/.test(s)) return ACTORS[params && params[0]] ? [ACTORS[params[0]]] : [];
  return [];
};
const q = async (sql, params) => { const rows = answer(sql, params); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true,
  exports: { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) } };

const authFirst = require(path.join(API, 'middleware', 'auth-first'));
const { contextsKey } = require('express-validator/lib/base');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the BEFORE route: today's file with `auth,` moved back behind the validators (the order main had) ───────── */
const SRC = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8');
const nl = SRC.includes('\r\n') ? '\r\n' : '\n';
const head = SRC.indexOf("router.post('/send'," + nl);
const firstAuth = SRC.indexOf(nl + '  auth,' + nl + '  [' + nl, head);
const tail = SRC.indexOf(nl + '  ],' + nl + '  validate,' + nl, head);
t('the /send route today puts auth FIRST — ahead of the validator chain', head > 0 && firstAuth > head && firstAuth < tail);
const OLD = SRC.slice(0, firstAuth) + nl + '  [' + nl + SRC.slice(firstAuth + (nl + '  auth,' + nl + '  [' + nl).length, tail)
  + nl + '  ],' + nl + '  auth,' + nl + '  validate,' + nl + SRC.slice(tail + (nl + '  ],' + nl + '  validate,' + nl).length);
const OLD_FILE = path.join(API, 'routes', '.m04-before-order.tmp.js');
fs.writeFileSync(OLD_FILE, OLD);
let oldRouter, newRouter;
try { oldRouter = require(OLD_FILE); } finally { try { fs.unlinkSync(OLD_FILE); } catch (_) {} }
newRouter = require(path.join(API, 'routes', 'chits'));

/* ── the two apps; `seen` keeps the last request so the test can look inside it ─────────────────────────────── */
let seen = null;
const grab = (req, res, next) => { seen = req; next(); };
const before = express();
before.use(grab);
before.use(express.json({ limit: '8mb' }));
before.use(express.urlencoded({ extended: true, limit: '8mb' }));
before.use('/api/chits', oldRouter);
before.use((err, req, res, next) => res.status(err.status || err.statusCode || 500).json({ error: String(err.type || err.message) }));
const after = express();
after.use(grab);
after.use(authFirst.parsers);
after.use(authFirst.authThenParse);
after.use('/api/chits', newRouter);
after.use((err, req, res, next) => res.status(err.status || err.statusCode || 500).json({ error: String(err.type || err.message) }));

const sign = (c, o) => jwt.sign(c, process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256' }, o || {}));
const CALLERS = {
  'no token':          null,
  'forged token':      jwt.sign({ identity_id: 'E1', identity_type: 'entity' }, 'not-the-secret', { algorithm: 'HS256' }),
  'expired session':   sign({ identity_id: 'E1', identity_type: 'entity' }, { expiresIn: '-1h' }),
  'not an identity':   sign({ lead_id: 'L1', kind: 'sim_lead' }),
  'owner session':     sign({ identity_id: 'E1', identity_type: 'entity', display_name: 'Shop' }),
  'actor, editor':     sign({ identity_id: 'a-act', identity_type: 'actor', parent_entity_id: 'E1' }),
  'actor, viewer':     sign({ identity_id: 'a-view', identity_type: 'actor', parent_entity_id: 'E1' }),
  'actor, removed':    sign({ identity_id: 'a-gone', identity_type: 'actor', parent_entity_id: 'E1' }),
  'till key':          sign({ identity_id: 'E1', identity_type: 'entity', kind: 'api_key', jti: 'k-till', scopes: ['till'] }),
  'offers key':        sign({ identity_id: 'E1', identity_type: 'entity', kind: 'api_key', jti: 'k-offers', scopes: ['offers'] }),
  'revoked key':       sign({ identity_id: 'E1', identity_type: 'entity', kind: 'api_key', jti: 'k-gone', scopes: ['till'] }),
};
const BIG = '{"recipients":[{"self":true}],"pad":"' + 'x'.repeat(9 * 1024 * 1024) + '"}';
const BODIES = {
  'valid self bill':        { type: 'application/json', data: JSON.stringify({ recipients: [{ self: true, name: 'self' }], purpose: 'order',
                              manual_subject: 'M04', line_items: [{ description: 'tea', quantity: 1, unit_price: 10 }] }) },
  'invalid (no recipient)': { type: 'application/json', data: '{"purpose":"order"}' },
  'invalid purpose':        { type: 'application/json', data: '{"recipients":[{"self":true}],"purpose":"bogus"}' },
  'malformed JSON':         { type: 'application/json', data: '{"recipients": [' },
  'oversized (9 MB)':       { type: 'application/json', data: BIG },
  'form, invalid':          { type: 'application/x-www-form-urlencoded', data: 'purpose=bogus' },
};
const DOOR = new Set([400, 401, 403, 413]);
const BROKEN = new Set(['malformed JSON', 'oversized (9 MB)']);

function send(app, token, body, url) {
  return new Promise((ok) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const headers = { 'Content-Type': body.type, 'Content-Length': Buffer.byteLength(body.data) };
      if (token) headers.Authorization = 'Bearer ' + token;
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url || '/api/chits/send', method: 'POST', headers },
        (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { srv.close(); ok({ status: res.statusCode, body: b, req: seen }); }); });
      r.on('error', (e) => { srv.close(); ok({ status: 'ERR ' + e.code, req: seen }); });
      r.end(body.data);
    });
  });
}

(async () => {
  console.log('\n— 1 · an unidentified caller is refused before its body is read —');
  for (const [bname, body] of Object.entries({ 'malformed JSON': BODIES['malformed JSON'], 'oversized (9 MB)': BODIES['oversized (9 MB)'] })) {
    const r = await send(after, null, body);
    t('no token + ' + bname + ' → 401 (not 400/413)', r.status === 401, 'got ' + r.status + ' ' + String(r.body).slice(0, 120));
    t('  …the body was never parsed (req.body undefined)', r.req && r.req.body === undefined && !r.req._body);
    t('  …and the validator chain never ran', r.req && r.req[contextsKey] === undefined);
    const o = await send(before, null, body);
    t('  (before M04 the same request was answered ' + o.status + ' — the parser spoke first)', o.status === 400 || o.status === 413);
  }
  {
    const r = await send(after, CALLERS['actor, viewer'], BODIES['malformed JSON']);
    t('a viewer (refused by the hat gate) + malformed JSON → 403, body unread', r.status === 403 && r.req.body === undefined);
  }
  {
    const r = await send(after, CALLERS['owner session'], BODIES['invalid purpose']);
    t('an admitted caller still has its body parsed and validated (400 Invalid purpose)', r.status === 400 && /Invalid purpose/.test(r.body)
      && r.req.body && r.req.body.purpose === 'bogus' && Array.isArray(r.req[contextsKey]), 'got ' + r.status + ' ' + String(r.body).slice(0, 160));
    const tk = await send(after, CALLERS['till key'], BODIES['invalid purpose']);
    t('  …and the route saw the holder the auth built once: req.till.holder === "key:k-till"',
      tk.req.till && tk.req.till.holder === 'key:k-till' && tk.req.till.counter === 'C1');
  }
  {
    const other = await send(after, null, BODIES['malformed JSON'], '/api/chits/drafts');
    t('another route keeps the global parser (POST /api/chits/drafts + malformed JSON → 400, unchanged)', other.status === 400, 'got ' + other.status);
  }

  console.log('\n— 2 · no allow/deny outcome changes: ' + Object.keys(CALLERS).length + ' callers × ' + Object.keys(BODIES).length + ' bodies, before vs after —');
  const allowedBefore = [], allowedAfter = [];
  let same = 0, refusedSooner = 0; const diffs = [];
  for (const [cname, tok] of Object.entries(CALLERS)) {
    for (const [bname, body] of Object.entries(BODIES)) {
      const o = await send(before, tok, body), n = await send(after, tok, body);
      const key = cname + ' · ' + bname;
      /* ALLOWED = the request got past auth, parsing and validation into the route's own work (2xx, or the handler's own
         answer against the stub database) — anything else is a refusal at the door */
      if (!DOOR.has(o.status)) allowedBefore.push(key + ' ' + o.status);
      if (!DOOR.has(n.status)) allowedAfter.push(key + ' ' + n.status);
      if (o.status === n.status) { same++; continue; }
      /* the ONE permitted difference: auth refuses, and the old parser answered first about a broken body */
      if (BROKEN.has(bname) && (n.status === 401 || n.status === 403) && (o.status === 400 || o.status === 413)) { refusedSooner++; continue; }
      diffs.push(key + ': before ' + o.status + ' after ' + n.status);
    }
  }
  t(same + ' pairs answer the same status; ' + refusedSooner + ' refused pairs with a broken body are now refused by auth instead of the parser',
    diffs.length === 0, diffs.join('\n       '));
  t('the ALLOWED set is identical (' + allowedAfter.length + ' pairs admitted before and after: ' + allowedAfter.join(' · ') + ')',
    JSON.stringify(allowedBefore) === JSON.stringify(allowedAfter), 'before ' + allowedBefore.join(', ') + '\n       after  ' + allowedAfter.join(', '));
  t('…and the matrix did admit someone (it is not vacuous)', allowedAfter.length >= 3);

  console.log('\n— 3 · server.js mounts the wiring this test exercised —');
  const S = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  const iParse = S.indexOf('app.use(authFirst.parsers)'), iLimit = S.indexOf("app.use('/api/', limiter)"),
        iAuth = S.indexOf('app.use(authFirst.authThenParse)'), iIdem = S.indexOf("app.use('/api', require('./middleware/idempotency'))");
  t('server.js: no other global express.json / urlencoded', !/app\.use\(express\.(json|urlencoded)\(/.test(S));
  t('server.js: parsers where express.json was → rate limiters → auth-then-parse → idempotency → routers',
    iParse > 0 && iLimit > iParse && iAuth > iLimit && iIdem > iAuth, [iParse, iLimit, iAuth, iIdem].join(' '));
  t('one regex decides both sides (parsers skip exactly what authThenParse parses)',
    authFirst.isAuthFirst({ method: 'POST', path: '/api/chits/send' }) && authFirst.isAuthFirst({ method: 'POST', path: '/API/Chits/Send/' })
    && !authFirst.isAuthFirst({ method: 'GET', path: '/api/chits/send' }) && !authFirst.isAuthFirst({ method: 'POST', path: '/api/chits/send/x' }));

  console.log('\n  ' + pass + ' checks' + (fail ? ' · ' + fail + ' FAILED' : '') + '\n');
  process.exit(fail ? 1 : 0);
})();
