/**
 * tests/signin-provider-connect.test.cjs — routes/signin-provider-connect.js: connect, list and unlink a provider sign-in (SEC-112 P1a), at the handler, with no database and no network.
 * OWNS      the proof of the CONTRACT of GET /provider/links (exactly reproof, links, providers; each link exactly six named fields; no issuer, no subject, no hash), that a fault of ours
 *           answers 503 SIGNIN_UNAVAILABLE and its text (a db password, a statement) never reaches the answer or the log, that a wrong PIN is one blind 401 and writes no start row,
 *           that a made-up or spent confirm code is one blind 403 and writes no link, that an unlink is refused for a foreign id, for the last way in, and a second time (replay: 404).
 * CALLED BY scripts/guards.cjs · CI. The pending store, the link store, the credential engine and the shop policy are stood in; the response is a recorder.
 * FLOW      (req, res) → handler → re-proof → pending / links → { json } | problem
 * CARD      18-identity-sign-in-and-access/sign-in
 * MIN contract · MIN error-never-leaks · MIN auth-refused · MIN bad-input-4xx · MIN idempotent-replay
 */
'use strict';
const assert = require('assert');
const pending = require('../lib/signin-pending');
const links = require('../lib/signin-provider-link');
const identityAuth = require('../lib/identity-auth');
const events = require('../lib/signin-events');
const policy = require('../lib/policy');
const provider = require('../lib/signin-provider');
const log = require('../lib/logger');
const route = require('../routes/signin-provider-connect');

const SHOP = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const LINK = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const SECRET = 'secret-db-password-xyz';
const PERSON = { identity_id: SHOP, display_name: 'Meena', email: 'meena@shop.test', identity_type: 'entity', status: 'active', pin_hash: 'x' };
const ROW = { key: 'google', label: 'Google' };
const logged = [];
log.error = (name, fields) => logged.push(JSON.stringify([name, fields]));
log.warn = () => {};
events.record = () => Promise.resolve({ written: true });
policy.get = async () => ({ signin_providers: ['google'], signin_required: 'none' });
provider.registry = () => [ROW];
provider.rowOf = (key) => (key === 'google' ? ROW : null);
provider.configured = () => true;
provider.startUrl = (key, params) => 'https://api.test/provider/' + key + '/start?lt=' + params.lt;
provider._connectBuilt(true);
identityAuth.rowsOfCandidates = async () => [PERSON];
identityAuth.verifyCredential = async (q, person, creds) => (creds && creds.pin === '4827' ? { ok: true } : { ok: false });

const put = [];
const held = new Map();
pending.put = async (kind, code, row) => { put.push([kind, code]); held.set(code, row); };
pending.take = async (kind, code) => { const row = held.get(code) || null; held.delete(code); return row; }; /* single use: taking spends it */
let stored = [{ link_id: LINK, provider: 'google', email: 'meena@gmail.test', email_verified: true, linked_at: '2026-11-20T10:00:00Z', last_used_at: null, issuer: 'https://accounts.test', subject: 'sub-123', subject_hash: 'h' }];
links.listOf = async () => stored;
links.remove = async (shop, identity, id) => { const link = stored.find((row) => row.link_id === id); stored = stored.filter((row) => row.link_id !== id); return link ? { removed: true, link } : { removed: false }; };
links.add = async () => ({ added: true, link_id: LINK });

const res = () => { const r = { headers: {}, code: 200, body: null, headersSent: false, locals: {} }; r.set = (a, b) => { if (typeof a === 'object') Object.assign(r.headers, a); else r.headers[a] = b; return r; }; r.status = (n) => { r.code = n; return r; }; r.json = (b) => { r.body = b; r.headersSent = true; return r; }; r.type = () => r; r.send = (b) => { r.body = b; r.headersSent = true; return r; }; r.getHeader = (k) => r.headers[k]; return r; };
const req = (body, params) => ({ identity: PERSON, session: { jti: 'jti-1' }, headers: { 'x-device-id': 'dev-0000000000000001' }, body: body || {}, params: params || {}, ip: '127.0.0.1', get: () => '' });
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
(async () => {
  let r = res();
  await route.list(req(), r);
  ok('contract: the list answers exactly reproof, links and providers, with no-store', [Object.keys(r.body).sort(), r.headers['Cache-Control']], [['links', 'providers', 'reproof'], 'no-store']);
  ok('contract: each link carries exactly its six named fields, and no issuer, subject or hash', [Object.keys(r.body.links[0]).sort(), /sub-123|accounts\.test|"subject/.test(JSON.stringify(r.body))], [['email', 'email_verified', 'last_used_at', 'link_id', 'linked_at', 'provider'], false]);
  ok('contract: a provider offers key, label, live and accepted; the person with a PIN re-proves with the pin', [Object.keys(r.body.providers[0]).sort(), r.body.reproof], [['accepted', 'key', 'label', 'live'], 'pin']);

  const realList = links.listOf;
  links.listOf = async () => { throw Object.assign(new Error('connect ECONNREFUSED ' + SECRET), { code: 'ECONNREFUSED' }); };
  r = res();
  await route.list(req(), r);
  ok('error never leaks: a fault of ours is a 503 SIGNIN_UNAVAILABLE and its text is in neither the answer nor the log', [r.code, r.body.code, JSON.stringify(r.body).includes(SECRET), logged.join('').includes(SECRET)], [503, 'SIGNIN_UNAVAILABLE', false, false]);
  links.listOf = realList;

  r = res();
  await route.startLink(req({ provider: 'google', pin: '0000' }), r);
  ok('a wrong PIN is one blind 401 REAUTH_FAILED and no start row is written', [r.code, r.body.code, put.length], [401, 'REAUTH_FAILED', 0]);
  r = res();
  await route.startLink(req({ provider: 'nobody', pin: '4827' }), r);
  ok('a provider that is not offered is refused 404 PROVIDER_OFF, before any proof is asked', [r.code, r.body.code, put.length], [404, 'PROVIDER_OFF', 0]);
  r = res();
  await route.startLink(req({ provider: 'google', pin: '4827' }), r);
  ok('a right PIN answers the start address and writes exactly one linkstart row', [r.code, /\/provider\/google\/start\?lt=/.test(r.body.url), put.map((p) => p[0])], [200, true, ['linkstart']]);

  r = res();
  await route.confirmLink(req({ code: 'made-up-code' }), r);
  ok('a made-up confirm code is one blind 403 LINK_CONFIRM_FAILED and writes no link', [r.code, r.body.code], [403, 'LINK_CONFIRM_FAILED']);
  const lt = put[0][1];
  r = res();
  await route.confirmLink(req({ code: lt }), r);
  ok('replay: the start code is not a confirm code, and it was spent by that try, so a second try is the same blind 403', [r.code, held.has(lt)], [403, false]);

  r = res();
  await route.unlink(req({ pin: '4827' }, { link_id: 'cccccccc-0000-4000-8000-0000000000c1' }), r);
  ok('an unlink of a foreign or made-up id is 404 LINK_NOT_FOUND', [r.code, r.body.code], [404, 'LINK_NOT_FOUND']);
  r = res();
  await route.unlink(req({ pin: '0000' }, { link_id: LINK }), r);
  ok('an unlink with a wrong PIN is the blind 401 and removes nothing', [r.code, r.body.code, stored.length], [401, 'REAUTH_FAILED', 1]);
  r = res();
  await route.unlink(req({ pin: '4827' }, { link_id: LINK }), r);
  ok('an unlink with the right PIN removes the link', [r.code, r.body.removed, stored.length], [200, true, 0]);
  r = res();
  await route.unlink(req({ pin: '4827' }, { link_id: LINK }), r);
  ok('replay: the same unlink a second time is 404 LINK_NOT_FOUND, never a second removal', [r.code, r.body.code], [404, 'LINK_NOT_FOUND']);
  console.log('\n' + checks + ' checks');
  process.exit(0);
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
