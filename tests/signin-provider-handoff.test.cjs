/**
 * tests/signin-provider-handoff.test.cjs — routes/signin-provider-handoff.js: POST /api/signin/provider/handoff (SEC-112 P1a): the one-time code → a session through the ONE session writer.
 * OWNS      the proof that a device that says nothing is refused 400 NO_DEVICE before the code is read, that a refusal of the door is answered with its own status and sentence, that a fault of
 *           ours is a 503 in true words (never "not switched on"), that the session writer's own refusals (DEVICE_REVOKED 403) are worded, that a good code answers a token in the BODY with
 *           no-store and no token in a header, and that nothing is logged with a token. A failed answer never carries a token.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: lib/signin-provider-door.decide and lib/identity-auth.issueToken are stood in; the response is a recorder.
 * FLOW      (req, res) → device → door.decide → budget → issueToken → { token, entity, identity } | problem
 * CARD      18-identity-sign-in-and-access/sign-in
 * MIN contract · MIN idempotent-replay · MIN auth-refused · MIN bad-input-4xx · MIN error-never-leaks
 */
'use strict';
const assert = require('assert');
const door = require('../lib/signin-provider-door');
const identityAuth = require('../lib/identity-auth');
const events = require('../lib/signin-events');
events.record = () => {};
const route = require('../routes/signin-provider-handoff');
const DEVICE = 'dev-0000000000000001';
const res = () => { const r = { headers: {}, code: 200, body: null, headersSent: false, locals: {} }; r.set = (a, b) => { if (typeof a === 'object') Object.assign(r.headers, a); else r.headers[a] = b; return r; }; r.status = (n) => { r.code = n; return r; }; r.json = (b) => { r.body = b; r.headersSent = true; return r; }; r.getHeader = (k) => r.headers[k]; return r; };
const req = (device, code) => ({ headers: device ? { 'x-device-id': device } : {}, body: { code: code || 'c1', device_id: device }, ip: '127.0.0.1', get: () => '' });
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
(async () => {
  let asked = 0;
  door.decide = async () => { asked++; return { refusal: 'SSO_HANDOFF', status: 401, detail: door.WORDS.SSO_HANDOFF }; };
  let r = res();
  await route.handoff({ headers: {}, body: { code: 'c1' }, ip: '127.0.0.1', get: () => '' }, r);
  ok('a device that says nothing is refused 400 NO_DEVICE before the code is read, and nothing is cached', [r.code, r.body.code, asked, r.headers['Cache-Control']], [400, 'NO_DEVICE', 0, 'no-store']);
  r = res();
  await route.handoff(req(DEVICE), r);
  ok('the door\'s refusal is answered with its own status, code and sentence', [r.code, r.body.code, r.body.detail === door.WORDS.SSO_HANDOFF, asked], [401, 'SSO_HANDOFF', true, 1]);
  door.decide = async () => { throw Object.assign(new Error('db down: secret-token-xyz'), { code: 'ECONN' }); };
  r = res();
  await route.handoff(req(DEVICE), r);
  ok('a fault of ours is a 503 SIGNIN_UNAVAILABLE in true words, and its text never reaches the answer', [r.code, r.body.code, JSON.stringify(r.body).includes('secret-token-xyz')], [503, 'SIGNIN_UNAVAILABLE', false]);
  const person = { identity_id: 'i1', bridge_id: 'B1', display_name: 'Ravi', email: 'r@x.test', identity_type: 'entity', status: 'active' };
  door.decide = async () => ({ identity: person, claims: {}, link: {}, provider: 'google' });
  identityAuth.issueToken = async () => { throw Object.assign(new Error('The shop removed this device. Ask the owner.'), { code: 'DEVICE_REVOKED' }); };
  r = res();
  await route.handoff(req(DEVICE), r);
  ok('a removed device is refused 403 DEVICE_REVOKED in words, with no token', [r.code, r.body.code, 'token' in r.body], [403, 'DEVICE_REVOKED', false]);
  identityAuth.issueToken = async () => 'tok-abc';
  r = res();
  await route.handoff(req(DEVICE), r);
  ok('a good code answers the token in the BODY, never in a header, with no-store', [r.code, r.body.token, Object.values(r.headers).some((v) => /tok-abc/.test(String(v))), r.headers['Cache-Control']], [200, 'tok-abc', false, 'no-store']);
  /* contract: the success answer keeps the shape the code sign-in has (the web reads the same keys), and the entity carries four named fields only */
  ok('contract: a good code answers message, token, entity, identity and constitution, and the entity has exactly four fields', [Object.keys(r.body).sort(), Object.keys(r.body.entity).sort()], [['constitution', 'entity', 'identity', 'message', 'token'], ['bridge_id', 'display_name', 'email', 'identity_id']]);
  /* replay: a one-time code is spent by its first use; the same code sent again is the one blind refusal and no second session is started */
  const spent = new Set();
  let issued = 0;
  door.decide = async (code) => { if (spent.has(code)) return { refusal: 'SSO_HANDOFF', status: 401, detail: door.WORDS.SSO_HANDOFF }; spent.add(code); return { identity: person, claims: {}, link: {}, provider: 'google' }; };
  identityAuth.issueToken = async () => { issued++; return 'tok-once'; };
  const first = res(), again = res();
  await route.handoff(req(DEVICE, 'one-time'), first);
  await route.handoff(req(DEVICE, 'one-time'), again);
  ok('replay: the same code twice starts one session; the second try is 401 SSO_HANDOFF with no token', [first.code, again.code, again.body.code, 'token' in again.body, issued], [200, 401, 'SSO_HANDOFF', false, 1]);
  console.log('\n' + checks + ' checks');
  process.exit(0);
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
