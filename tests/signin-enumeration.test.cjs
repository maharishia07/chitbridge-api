/**
 * tests/signin-enumeration.test.cjs — SEC-139 (API-STANDARD S6): BEFORE A SECRET IS PROVEN, THE DOOR TELLS NOBODY WHO EXISTS.
 * POST /api/actors/login, POST /api/entities/verify (and /api/signin/verify, the same handler) answer an unknown account, a known
 * account sent NO secret and a known account sent a WRONG secret with ONE answer: status, code, body and headers equal, and
 * about the same time (a missing secret spends the hash a wrong PIN spends). GET /api/actors/check-login is one constant answer.
 * A contact on several accounts lists no choice at verify; the choice lives at ask. A right secret still signs in.
 *
 * Harness: the in-memory identities table of tests/signin-routes.test.cjs (read from that file between its H1234 line and its
 * lib/istest stub, so there is one copy of the SQL reader).
 * Run: node tests/signin-enumeration.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');
const express = require('express');
const bcrypt = require('bcryptjs');
Object.assign(process.env, { JWT_SECRET: 'test-only-secret-signin-enumeration', NODE_ENV: 'development', DEV_OTP: '123456', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' });
['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'PLATFORM_ROOT_ENTITY', 'DEV_OTP_CUSTOMER', 'DEV_OTP_IN_RESPONSE'].forEach((k) => { delete process.env[k]; });
const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const src = fs.readFileSync(path.join(__dirname, 'signin-routes.test.cjs'), 'utf8').split('\n');
const from = src.findIndex((l) => l.startsWith('const H1234'));
const to = src.findIndex((l) => l.startsWith("stub('lib/istest'"));
if (from < 0 || to < from) throw new Error('signin-routes.test.cjs no longer has the harness this test reads');
const world = {};
new Function('require', 'path', 'API', 'bcrypt', 'world', src.slice(from, to + 1).join('\n') + '\nworld.reset = reset; world.DB = () => DB;')(require, path, API, bcrypt, world);
require(path.join(API, 'lib/schema')).has = async (tbl) => tbl !== 'identity_documents'; /* no documents table: a shared e-mail on two entities is the "several accounts" case */

const entities = require(path.join(API, 'routes', 'entities'));
const actors = require(path.join(API, 'routes', 'actors'));
const signin = require(path.join(API, 'routes', 'signin'));
const app = express();
app.use(express.json());
app.use('/api/entities', entities);
app.use('/api/signin', signin);
app.use('/api/actors', actors);
let base;
const call = (method, url, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const h = { 'content-type': 'application/json' };
  if (data) h['content-length'] = Buffer.byteLength(data);
  const t0 = process.hrtime.bigint();
  const r = http.request(base + url, { method, headers: h }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} resolve({ status: res.statusCode, body: j, raw: s, ms: Number(process.hrtime.bigint() - t0) / 1e6, headers: res.headers }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
/* what a caller can see of an answer, minus what differs per request (request id) */
const shape = (r) => JSON.stringify({ s: r.status, b: Object.assign({}, r.body, { request_id: null }), type: r.headers['content-type'], cc: r.headers['cache-control'], ra: r.headers['retry-after'] || null });
const same = (list) => list.every((r) => shape(r) === shape(list[0]));
const SORRY = "That sign-in didn't work. Check the details and try again.";
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/* the doors. `ravi` holds a PIN (1234), `mala` is a first-timer (code 654321), `owner@shop.test` is an owner with a stored code */
const DOORS = {
  'POST /api/actors/login': (user, sec) => call('POST', '/api/actors/login', Object.assign({ username: user }, sec)),
  'POST /api/entities/verify (actor, user_id)': (user, sec) => call('POST', '/api/entities/verify', Object.assign({ user_id: user }, sec)),
  'POST /api/signin/verify (actor, id)': (user, sec) => call('POST', '/api/signin/verify', Object.assign({ id: user }, sec)),
  'POST /api/entities/verify (owner, email)': (user, sec) => call('POST', '/api/entities/verify', Object.assign({ email: user }, sec))
};
const WHO = {
  'POST /api/actors/login': { pin: 'ravi@shop one', otp: 'mala@shop one', ghost: 'nobody@shop one', ghostShop: 'ravi@no such shop' },
  'POST /api/entities/verify (actor, user_id)': { pin: 'ravi@shopone.br', otp: 'mala@shopone.br', ghost: 'nobody@shopone.br' },
  'POST /api/signin/verify (actor, id)': { pin: 'ravi@shopone.br', otp: 'mala@shopone.br', ghost: 'nobody@shopone.br' },
  'POST /api/entities/verify (owner, email)': { otp: 'owner@shop.test', ghost: 'nobody@nowhere.test' }
};
const ACTOR_OF = { pin: 'ravi', otp: 'mala' };

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [door, go] of Object.entries(DOORS)) {
      say('\n── ' + door + ' ──');
      const who = WHO[door];
      for (const kind of ['pin', 'otp'].filter((k) => who[k])) {
        world.reset();
        const wrong = kind === 'pin' ? { pin: '9999' } : { otp: '000000' };
        const unknown = await go(who.ghost, wrong);
        const noSecret = await go(who[kind], {});
        const wrongSecret = await go(who[kind], wrong);
        const unknownNoSecret = await go(who.ghost, {});
        const list = [unknown, noSecret, wrongSecret, unknownNoSecret];
        t(kind + ': unknown, known-without-secret, wrong-secret and unknown-without-secret are ONE answer (status, code, body, headers)', same(list) && unknown.status === 400, list.map((r) => r.status + ' ' + r.raw.slice(0, 90)).join(' | '));
        t(kind + ': that answer is the one safe sentence, code SIGNIN_REFUSED, no "Enter your", no use_pin / use_otp', unknown.body.code === 'SIGNIN_REFUSED' && unknown.body.message === SORRY && !/enter your|use_pin|use_otp|required/i.test(noSecret.raw), noSecret.raw.slice(0, 200));
        if (who.ghostShop) {
          const g = await go(who.ghostShop, {});
          t(kind + ': an unknown business answers the same as well', shape(g) === shape(unknown), g.raw.slice(0, 120));
        }
        const row = Object.values(world.DB()).find((r) => r.actor_key === ACTOR_OF[kind]);
        if (row && kind === 'pin') t(kind + ': only the wrong PIN counted a miss (1), the missing one counted none', ((kind === 'pin' ? row.pin_attempts : row.otp_attempts) || 0) === 1, JSON.stringify([row.pin_attempts, row.otp_attempts]));
      }
      world.reset();
      const key = who.pin ? 'pin' : 'otp';
      const timeOf = async (user, sec) => { const ms = []; for (let i = 0; i < 9; i++) ms.push((await go(user, sec)).ms); return median(ms); };
      await go(who[key], {}); /* warm the decoy hash and the routes */
      const tMissing = await timeOf(who[key], {});
      const tUnknown = await timeOf(who.ghost, { pin: '9999' });
      t('time: known-without-secret takes about as long as unknown (' + tMissing.toFixed(1) + ' ms vs ' + tUnknown.toFixed(1) + ' ms): the hash is not skipped', tMissing > tUnknown * 0.5 && tMissing < tUnknown * 2 + 15 && tMissing > 5, tMissing + ' / ' + tUnknown);
    }

    say('\n── the right secret still signs in ──');
    world.reset();
    let r = await DOORS['POST /api/actors/login']('ravi@shop one', { pin: '1234' });
    t('actors/login: the PIN in `pin` signs a PIN holder in', r.status === 200 && !!r.body.token && r.body.requires_pin_setup === false, r.raw.slice(0, 120));
    world.reset();
    r = await DOORS['POST /api/actors/login']('ravi@shop one', { otp: '1234' });
    t('actors/login: the PIN typed in the one box (`otp`, as the page cannot tell) signs a PIN holder in', r.status === 200 && !!r.body.token, r.raw.slice(0, 120));
    world.reset();
    r = await DOORS['POST /api/actors/login']('mala@shop one', { otp: '654321' });
    t('actors/login: the first code in `otp` signs a first-timer in and asks for a PIN', r.status === 200 && r.body.requires_pin_setup === true, r.raw.slice(0, 120));
    world.reset();
    r = await DOORS['POST /api/entities/verify (actor, user_id)']('ravi@shopone.br', { pin: '1234' });
    t('entities/verify: the PIN signs a PIN holder in', r.status === 200 && !!r.body.token, r.raw.slice(0, 120));

    say('\n── a contact on several accounts: no choice before a secret ──');
    world.reset();
    ['twinA', 'twinB'].forEach((k) => { world.DB()[k].email = 'shared@twin.test'; });
    const A = await call('POST', '/api/signin/ask', { email: 'shared@twin.test' });
    t('ask still offers the choice (409 CHOOSE_IDENTITY): the page needs it to continue', A.status === 409 && A.body.code === 'CHOOSE_IDENTITY' && Array.isArray(A.body.choices) && A.body.choices.length === 2, A.status + ' ' + A.raw.slice(0, 100));
    const ghost = await call('POST', '/api/entities/verify', { email: 'nobody@nowhere.test', otp: '000000' });
    for (const [label, body] of [['no secret', {}], ['a wrong code', { otp: '000000' }], ['a code that is right for one of them', { otp: '123456' }]]) {
      const v = await call('POST', '/api/entities/verify', Object.assign({ email: 'shared@twin.test' }, body));
      t('entities/verify on the shared contact with ' + label + ': the same answer as an unknown contact, no choices', shape(v) === shape(ghost) && !('choices' in (v.body || {})) && v.status === 400, v.status + ' ' + v.raw.slice(0, 120));
    }
    const sv = await call('POST', '/api/signin/verify', { id: 'shared@twin.test' });
    t('signin/verify (id) on the shared contact: the same answer, no choices', shape(sv) === shape(ghost), sv.raw.slice(0, 120));

    say('\n── GET /api/actors/check-login: no signal about a person ──');
    world.reset();
    const asks = [];
    for (const u of ['ravi@shop one', 'mala@shop one', 'gone@shop one', 'lockd@shop one', 'nobody@shop one', 'ravi@no such shop', 'ravi', '']) asks.push(await call('GET', '/api/actors/check-login?username=' + encodeURIComponent(u)));
    t('check-login: PIN holder, first-timer, removed, locked, unknown person, unknown shop, no @, empty: all ONE answer', same(asks) && asks[0].status === 200, asks.map((a) => a.raw).join(' '));
    t('check-login: the answer is { valid: true, has_pin: false } for everyone', asks[0].body.valid === true && asks[0].body.has_pin === false && Object.keys(asks[0].body).length === 2, asks[0].raw);
  } finally {
    server.close();
  }
  say('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('FAIL crashed: ' + ((e && e.stack) || e)); process.exit(1); });
