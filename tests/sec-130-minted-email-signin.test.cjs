/**
 * tests/sec-130-minted-email-signin.test.cjs — SEC-130 (P0, proven on SIT 2026-11-01): A PARTY A SHOP MINTED IS NOT AN ACCOUNT.
 * mint() (lib/local-identity.js) makes every local supplier/customer an identity_type 'entity' with a `~` handle and the rule
 * "no account to sign in to"; a shop can still write a contact e-mail onto that row. Before this fix the sign-in lookups by
 * e-mail, handle and name matched it, so the owner of that mailbox signed in AS the shop's record (token identity = the party).
 * Now each lookup asks the one question handle.isMinted() (the one onRail/mayTrade ask) and finds accounts only.
 * Proves: by e-mail (new door id, old door email, register mode:'login', a verified EMAIL document), by the ~ handle and by its
 * display name, the minted party is refused at ask AND at verify (no token, no code written); a real account still signs in.
 *
 * Run: node tests/sec-130-minted-email-signin.test.cjs · no network beyond 127.0.0.1, no DB (an in-memory identities table).
 */
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const API = path.join(__dirname, '..');
const express = require('express');
const jwt = require('jsonwebtoken');

Object.assign(process.env, { JWT_SECRET: 'test-only-secret-sec-130', NODE_ENV: 'development', DEV_OTP: '123456', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' /* SEC1: the fixed codes work on a LOCAL stack only */ });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL', 'PLATFORM_ROOT_ENTITY', 'DEV_OTP_IN_RESPONSE', 'DEV_OTP_CUSTOMER', 'SMS_PROVIDER'].forEach((k) => { delete process.env[k]; });

const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

/* ── the database: shop X (an account) and the customer it minted, carrying an outsider's e-mail ─────────────────────── */
const docHash = (scheme, raw) => crypto.createHash('sha256').update(String(scheme) + ':' + String(raw)).digest('hex');
const FUT = (min) => new Date(Date.now() + min * 60000);
const E = 'victim@mail.test';
let DB = {}, DOCS = [];
const reset = (withCode) => {
  DB = {
    shopx: { identity_type: 'entity', display_name: 'Shop X', user_id: 'shopx', email: 'owner@shopx.test', bridge_id: 'B-SHOPX', status: 'active', otp_attempts: 0 },
    /* exactly what mint() + addCustomer leave: entity, active, a ~ handle, parent = the shop, and a contact e-mail. withCode plants a
       live code so verify is tested on its own (as the proof's tester code did), not only through ask. */
    party: { identity_type: 'entity', display_name: 'Victim Traders', user_id: '~shopx.cus-0001', parent_entity_id: 'shopx', email: E,
             bridge_id: 'B-PARTY', status: 'active', otp_code: withCode ? '123456' : null, otp_expires_at: withCode ? FUT(60) : null, otp_attempts: 0 }
  };
  Object.keys(DB).forEach((k) => { DB[k].identity_id = k; });
  DOCS = [{ identity_id: 'party', scheme: 'EMAIL', value_hash: docHash('EMAIL', E), status: 'verified', verified_at: 'NOW' }];
};
const lc = (v) => (v == null ? v : String(v).toLowerCase());
const P = (params, n) => params[Number(n) - 1];
const splitTop = (s, sep) => { const out = []; let d = 0, cur = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(') d++; else if (c === ')') d--;
  if (d === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; } cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
function cond(c, params, r) {
  let m; c = c.trim();
  if (c.startsWith('(') && c.endsWith(')')) return splitTop(c.slice(1, -1), ' OR ').some((x) => cond(x, params, r));
  if ((m = c.match(/^LOWER\((\w+)\) = LOWER\(\$(\d+)\)$/))) return lc(r[m[1]]) === lc(P(params, m[2]));
  if ((m = c.match(/^LOWER\((\w+)\) = \$(\d+)$/))) return lc(r[m[1]]) === P(params, m[2]);
  if ((m = c.match(/^(\w+) = \$(\d+)$/))) return r[m[1]] === P(params, m[2]);
  if ((m = c.match(/^(\w+) = '([^']*)'$/))) return r[m[1]] === m[2];
  if ((m = c.match(/^(\w+) IS NOT NULL$/))) return r[m[1]] != null;
  if ((m = c.match(/^(\w+) = ANY\(\$(\d+)::text\[\]\)$/))) return (P(params, m[2]) || []).indexOf(r[m[1]]) >= 0;
  throw new Error('stub db: unknown condition ' + c);
}
const where = (rows, clause, params) => rows.filter((r) => splitTop(clause, ' AND ').every((c) => cond(c, params, r)));
function value(expr, params, row) { let m;
  if ((m = expr.match(/^\$(\d+)$/))) return P(params, m[1]);
  if (/^NOW\(\)$/i.test(expr)) return 'NOW'; if (/^NULL$/i.test(expr)) return null; if (/^TRUE$/i.test(expr)) return true;
  if (/^-?\d+$/.test(expr)) return Number(expr); if ((m = expr.match(/^'([^']*)'$/))) return m[1];
  if ((m = expr.match(/^COALESCE\((\w+), 0\) \+ 1$/i))) return (row[m[1]] || 0) + 1;
  if ((m = expr.match(/^COALESCE\((\w+), \$(\d+)\)$/i))) return row[m[1]] != null ? row[m[1]] : P(params, m[2]);
  throw new Error('stub db: unknown value ' + expr); }
async function q(sql, params) { params = params || []; const s = String(sql).replace(/\s+/g, ' ').trim(); let m;
  if (/^INSERT INTO (signin_events|identities)/i.test(s)) return { rows: [], rowCount: 1 };
  if (/FROM (constitution|installation)\b/i.test(s) || /policy_flags/.test(s)) return { rows: [] };
  if ((m = s.match(/^SELECT DISTINCT identity_id FROM identity_documents WHERE (.+)$/i))) {
    const seen = new Set(); return { rows: where(DOCS, m[1], params).filter((d) => !seen.has(d.identity_id) && seen.add(d.identity_id)).map((d) => ({ identity_id: d.identity_id })) };
  }
  if (/identity_documents/i.test(s)) throw new Error('stub db: a second reader of identity_documents: ' + s.slice(0, 100));
  if ((m = s.match(/^SELECT (.+?) FROM identities WHERE (.+)$/i))) { const cols = m[1].split(',').map((x) => x.trim());
    const rows = where(Object.values(DB), m[2], params).map((r) => { const o = {}; cols.forEach((c) => { o[c] = c === '1' ? 1 : (r[c] === undefined ? null : r[c]); }); return o; });
    return { rows, rowCount: rows.length }; }
  if ((m = s.match(/^UPDATE identities SET (.+?) WHERE (.+)$/i))) { const hit = where(Object.values(DB), m[2], params);
    hit.forEach((r) => splitTop(m[1], ',').forEach((a) => { const k = a.match(/^(\w+) = (.+)$/); if (!k) throw new Error('stub db: unknown SET ' + a); r[k[1]] = value(k[2].trim(), params, r); }));
    return { rows: [], rowCount: hit.length }; }
  throw new Error('stub db: unknown statement ' + s.slice(0, 120)); }
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => ({ query: q, release() {} }) }, withEntity: async (id, fn) => fn({ query: q }),
  withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
stub('lib/schema', { hasColumn: async () => true, hasColumns: async () => true, hasTable: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
stub('lib/schema-bootstrap', { ensureDefaultSchema: async () => {} });
stub('lib/rootlink', { connect: async () => null });
stub('lib/istest', { atRegistration: () => ({ population: null, entity_kind: 'customer' }), ready: async () => true });

const app = express(); app.use(express.json());
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
app.use('/api/signin', require(path.join(API, 'routes', 'signin')));
let base;
const call = (url, body) => new Promise((resolve, reject) => { const data = JSON.stringify(body || {});
  const h = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
  const r = http.request(base + url, { method: 'POST', headers: h }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j || {} }); }); });
  r.on('error', reject); r.write(data); r.end(); });
const idOf = (r) => { try { return (jwt.decode(r.body.token) || {}).identity_id || null; } catch (_) { return null; } };
const refused = (r) => r.status >= 400 && !r.body.token;
const show = (r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 160);

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    say('SEC-130 — a party a shop minted is not an account: no sign-in door finds it');

    say('\n── ask: by the e-mail the shop wrote on the party, its ~ handle, its name ──');
    for (const [label, url, body] of [
      ['new door ask { id: E }', '/api/signin/ask', { id: E }],
      ['old door ask { email: E }', '/api/signin/ask', { email: E }],
      ['register door, mode login { email: E }', '/api/entities/register', { email: E, display_name: E, mode: 'login' }],
      ['ask by the ~ handle { id }', '/api/signin/ask', { id: '~shopx.cus-0001' }],
      ['old door ask { user_id: ~handle }', '/api/signin/ask', { user_id: '~shopx.cus-0001' }],
      ['ask by the party\'s display name', '/api/signin/ask', { id: 'Victim Traders' }]
    ]) {
      reset(false);
      const a = await call(url, body);
      t('⭐ ' + label + ': refused, no code written on the party', refused(a) && DB.party.otp_code === null, show(a) + ' otp=' + DB.party.otp_code);
    }

    say('\n── verify, with a live code on the party: never a token for it ──');
    for (const [label, url, body] of [
      ['verify { id: E }', '/api/signin/verify', { id: E, otp: '123456' }],
      ['verify { email: E }', '/api/signin/verify', { email: E, otp: '123456' }],
      ['old door verify { email: E }', '/api/entities/verify', { email: E, otp: '123456' }],
      ['verify { id: ~handle }', '/api/signin/verify', { id: '~shopx.cus-0001', otp: '123456' }],
      ['verify { user_id: ~handle }', '/api/signin/verify', { user_id: '~shopx.cus-0001', otp: '123456' }]
    ]) {
      reset(true);
      const v = await call(url, body);
      t('⭐⭐ ' + label + ': no token (the identity is never the party)', refused(v) && idOf(v) !== 'party', show(v));
    }

    say('\n── a real account still signs in ──');
    reset(false);
    let a = await call('/api/signin/ask', { id: 'owner@shopx.test' });
    t('the shop owner by e-mail: code sent, id = the shop', a.status === 200 && a.body.kind === 'entity' && a.body.id === 'shopx', show(a));
    let v = await call('/api/signin/verify', { id: 'owner@shopx.test', otp: '123456' });
    t('   …and the code signs the shop in', v.status === 200 && idOf(v) === 'shopx', show(v));
    reset(false);
    a = await call('/api/signin/ask', { email: 'owner@shopx.test' });
    v = await call('/api/signin/verify', { email: 'owner@shopx.test', otp: '123456' });
    t('old door { email }: ask 200, verify signs the shop in', a.status === 200 && v.status === 200 && idOf(v) === 'shopx', show(a) + ' | ' + show(v));
    reset(false);
    a = await call('/api/signin/ask', { id: 'shopx' });
    v = await call('/api/signin/verify', { user_id: 'shopx', otp: '123456' });
    t('the shop by its user id: ask 200, verify signs it in', a.status === 200 && v.status === 200 && idOf(v) === 'shopx', show(a) + ' | ' + show(v));
    reset(false);
    a = await call('/api/signin/ask', { id: 'Shop X' });
    t('the shop by its display name still answers', a.status === 200, show(a));
  } finally { server.close(); }
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('ERROR ' + (e && e.stack || e)); process.exit(1); });
