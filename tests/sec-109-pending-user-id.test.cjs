/**
 * tests/sec-109-pending-user-id.test.cjs — SEC-109: registering AGAIN with a changed User ID before the first code was used.
 * Before: the pending account kept the first User ID and the tester name rule refused the new one with no word why.
 * Decided (critic 12 Nov): the typed User ID is only STAGED at the register door (policy_flags.pending_user_id, the one policy writer) and APPLIED at verify, after the
 * code has proved the mailbox (markVerified). So a stranger who types a pending account's e-mail cannot rename it: nothing changes until the mailbox owner verifies.
 * Run: node tests/sec-109-pending-user-id.test.cjs · no network, no DB (db stubbed).
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = 'test-only-secret-sec-109';
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

let SQL = [], BOOM = null, HELD_ROWS = [], STAGED = null; // STAGED = what the email_verified UPDATE ... RETURNING answers (the staged id on the row, if any)
const q = async (sql, args) => {
  const text = String((sql && sql.text) || sql);
  SQL.push({ sql: text, args });
  if (BOOM) throw BOOM;
  if (/ops.signin_candidates/.test(text)) return { rows: HELD_ROWS, rowCount: HELD_ROWS.length };
  if (/UPDATE identities SET email_verified = TRUE/.test(text) && /RETURNING policy_flags->>'pending_user_id'/.test(text)) return { rows: [{ pending_user_id: STAGED }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
};
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('db', { query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (d, fn) => fn() });
stub('lib/schema', { hasColumn: async () => true, has: async () => true, columns: async () => [], table: async () => ({}) });
const { stagePendingUserId, markVerified } = require(path.join(API, 'routes', 'signin'));

const renames = () => SQL.filter((x) => /UPDATE identities SET user_id/.test(x.sql));
const stagings = () => SQL.filter((x) => /policy_flags/.test(x.sql) && JSON.stringify(x.args).includes('pending_user_id') && JSON.stringify(x.args).includes('second-id'));

(async () => {
  const pending = { identity_id: 'p1', user_id: 'first-id', status: 'pending', email_verified: false };
  const stage = async (row, typed) => { SQL = []; BOOM = null; await stagePendingUserId(row, typed); return SQL.length; };

  console.log('— at the register door: STAGED, never applied —');
  t('a pending, never-verified account stages the User ID typed last (lower-cased) through the policy writer', (await stage(pending, 'Second-Id')) === 1 && stagings().length === 1, JSON.stringify(SQL));
  t('…and NOTHING renames the account at the door (no UPDATE ... SET user_id): a stranger typing the e-mail changes nothing yet', renames().length === 0);
  t('an ACTIVE account stages nothing', (await stage(Object.assign({}, pending, { status: 'active' }), 'second-id')) === 0);
  t('a verified account stages nothing', (await stage(Object.assign({}, pending, { email_verified: true }), 'second-id')) === 0);
  t('the same id typed again, nothing typed, a refused id and a NUL byte stage nothing',
    (await stage(pending, 'FIRST-ID')) === 0 && (await stage(pending, '')) === 0 && (await stage(pending, 'a b')) === 0 && (await stage(pending, 'ab\u0000cd')) === 0);
  SQL = []; BOOM = Object.assign(new Error('boom'), { code: '08006' });
  let threw = false;
  try { await stagePendingUserId(pending, 'second-id'); } catch (_) { threw = true; }
  t('a failed staging is logged and never thrown (the code is still sent)', !threw);

  console.log('— at verify: APPLIED only after the code proved the mailbox —');
  SQL = []; BOOM = null;
  STAGED = 'second-id';
  await markVerified({ identity_id: 'p1' }, { user_id: 'Second-Id' });
  t('a staged User ID is applied when the verify request REPEATS it (the owner consents to the value), in one guarded UPDATE after email_verified', renames().length === 1 && renames()[0].args[1] === 'second-id' && /NOT EXISTS/.test(renames()[0].sql) && /email_verified = TRUE/.test(SQL[0].sql), JSON.stringify(SQL.map((x) => x.sql.slice(0, 70))));
  t('…and the staging is cleared (a third statement on policy_flags)', SQL.length === 3 && /policy_flags/.test(SQL[2].sql), JSON.stringify(SQL.map((x) => x.sql.slice(0, 70))));
  for (const typed of [undefined, '', 'another-id']) {
    const body = typed === undefined ? {} : { user_id: typed };
    SQL = []; STAGED = 'second-id';
    await markVerified({ identity_id: 'p1' }, body);
    t('verify that does NOT repeat the staged id (' + JSON.stringify(typed) + ') succeeds WITHOUT renaming and clears the staging', renames().length === 0 && SQL.length === 2 && /email_verified = TRUE/.test(SQL[0].sql) && /policy_flags/.test(SQL[1].sql), JSON.stringify(SQL.map((x) => x.sql.slice(0, 60))));
  }
  SQL = [];
  STAGED = null;
  await markVerified({ identity_id: 'p1' }, { user_id: 'second-id' });
  t('nothing staged → only the email_verified statement, as before', SQL.length === 1 && /email_verified = TRUE/.test(SQL[0].sql));

  console.log('— the real register door —');
  const HELD = [{ identity_id: 'p1', bridge_id: 'B-P1', user_id: 'first-id', status: 'pending', email_verified: false, email: 'new@shop.test', identity_type: 'entity' }];
  const door = async (heldRows, body) => {
    SQL = []; BOOM = null; HELD_ROWS = heldRows;
    const app = express(); app.use(express.json()); app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
    const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await new Promise((resolve) => {
      const data = JSON.stringify(body);
      const rq = http.request('http://127.0.0.1:' + server.address().port + '/api/entities/register', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', resolve); });
      rq.on('error', resolve); rq.write(data); rq.end();
    });
    await new Promise((r) => server.close(r));
    HELD_ROWS = [];
  };
  await door(HELD, { email: 'new@shop.test', user_id: 'Second-Id', display_name: 'New Shop' });
  t('WIRING: registering again with a changed User ID stages it on the pending account and renames nothing', stagings().length === 1 && renames().length === 0, JSON.stringify(SQL.map((x) => x.sql.slice(0, 60))));
  await door(HELD, { email: 'new@shop.test', mode: 'login', user_id: 'Second-Id', display_name: 'New Shop' });
  t('WIRING: the login mode stages nothing', stagings().length === 0 && renames().length === 0);
  await door([Object.assign({}, HELD[0], { status: 'active', email_verified: true })], { email: 'new@shop.test', user_id: 'Second-Id', display_name: 'New Shop' });
  t('WIRING: an active account at the same door stages and renames nothing', stagings().length === 0 && renames().length === 0);

  console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
