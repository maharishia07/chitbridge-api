#!/usr/bin/env node
// @type: contract
/**
 * api-problem-signin-provider.test.cjs — API sweep for the three provider sign-in doors: every answer of routes/signin-provider.js
 * (GET /api/signin/providers, GET /api/signin/provider/:key/start, GET /api/signin/provider/:key/callback).
 *
 * OWNS      the proof that each refusal that is a status (an unknown or switched-off provider: 404) is a Problem body, that a fault the page must not see (a failing list, a failing start, a failing finish)
 *           is answered the way the route promises (200 empty list, 302 back with #e=<CODE>) and says nothing of its cause, these routes' rows of docs/contracts/api-error-tests.json (the statuses they are tested for,
 *           which the register's error_tests column reads) and the list's row of docs/contracts/api-hardening-evidence-areas.json (output_allowlist).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db; the provider library, the pending store and the link store are answered by stand-ins patched per scene
 *           (their own proof is tests/signin-provider.test.cjs).
 * FLOW      route x world (plain, a failing db) + the named extras → real route → status, Problem body or redirect text → no leak · statuses tested → manifest · the list's answers → allow-list evidence
 * CARD      18-identity-sign-in-and-access/sign-in
 *
 *   node tests/api-problem-signin-provider.test.cjs            check
 *   node tests/api-problem-signin-provider.test.cjs --write    rewrite these routes' rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const MOUNT = '/api/signin';
const FILE = 'routes/signin-provider.js';
const LIST = 'GET /api/signin/providers';
const START = 'GET /api/signin/provider/:key/start';
const CALLBACK = 'GET /api/signin/provider/:key/callback';
const HANDOFF = 'POST /api/signin/provider/handoff';
const LINKS = 'GET /api/signin/provider/links';
const LINKSTART = 'POST /api/signin/provider/link/start';
const LINKFINISH = 'POST /api/signin/provider/link/finish';
const SESSION = { jti: 'jti-1', device_id: 'device-1234567' }; /* the listed session the real auth hands on */
const UNLINK = 'DELETE /api/signin/provider/links/:link_id';
const OURS = [LIST, START, CALLBACK, HANDOFF, LINKS, LINKSTART, LINKFINISH, UNLINK];
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const PAGE = 'https://web.example.test/signin';
const DEVICE = 'device-1234567';
let router = null;
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  owns: (route) => OURS.includes(route),
  before: async () => { if (router) router._resetStoreCheck(); },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: () => false,
  notFrozen: () => true,
  added: () => true /* new doors: no old body was frozen */
});
const { check } = lab;
const WORLDS = [
  { id: 'plain', setup: {} },
  { id: 'db-fails', setup: { db: 'fail' } }
];
const fails = () => { throw new Error(SECRET_SQL); };
const claims = { issuer: 'https://idp.example.test', tenant: 't', subject: 's', subject_alt: null, email: 'a@example.test', email_verified: true, org: null, name: 'A' };
/** the provider library, the pending store and the link store as a scene wants them; each key of `over` replaces one function for that scene */
const scene = (over) => ({
  provider: Object.assign({ rowOf: () => ({ key: 'stand' }), configured: () => true, webSigninUrl: () => PAGE, nextOf: (next) => (next === undefined || next === '' || next === '/' ? '/' : null), providers: async () => ({ providers: [{ key: 'stand', label: 'Stand-in', live: true }], standin: true }), authRequest: async () => ({ state: 'S1', nonce: 'N1', verifier: 'V1', url: 'https://idp.example.test/authorize?x=1' }), finish: async () => claims, connectBuilt: () => true, registry: () => [{ key: 'stand', label: 'Stand-in' }], startUrl: () => 'https://idp.example.test/start?lt=L1' }, over.provider),
  pending: Object.assign({ available: async () => true, put: async () => undefined, take: async () => ({ provider: 'stand', state: 'S1', nonce: 'N1', verifier: 'V1', device_id: DEVICE, next: '/' }) }, over.pending),
  store: Object.assign({ linksFor: async () => [] }, over.store),
  identityAuth: Object.assign({}, over.identityAuth),
  policy: Object.assign({ get: async () => ({ signin_providers: ['stand'], signin_required: 'none' }) }, over.policy),
  links: Object.assign({ listOf: async () => [], add: async () => ({ added: true, link_id: 'l1' }), remove: async () => ({ removed: false }) }, over.links)
});
const X = (id, route, expect, url, over, headers) => ({ id, route, expect, url, patch: scene(over || {}), headers });
const startUrl = (query) => '/api/signin/provider/stand/start' + (query === undefined ? '?device_id=' + DEVICE : query);
const backUrl = (query) => '/api/signin/provider/stand/callback' + (query === undefined ? '?code=c1&state=S1' : query);
const cookie = { cookie: '__Host-cb_sso=ref1' };
const cancelled = () => { throw Object.assign(new Error('x'), { code: 'SSO_CANCELLED' }); };
const EXTRAS = [
  X('list-shows-the-providers', LIST, 200, '/api/signin/providers'),
  X('list-store-not-there', LIST, 200, '/api/signin/providers', { pending: { available: async () => false } }),
  X('list-fails-the-page-still-loads', LIST, 200, '/api/signin/providers', { provider: { providers: fails } }),
  X('start-unknown-provider', START, 404, '/api/signin/provider/nope/start?device_id=' + DEVICE, { provider: { rowOf: () => null } }),
  X('start-page-not-configured', START, 404, startUrl(), { provider: { configured: () => false, webSigninUrl: () => '' } }),
  X('start-provider-not-configured', START, 302, startUrl(), { provider: { configured: () => false } }),
  X('start-no-device', START, 302, startUrl('')),
  X('start-bad-next', START, 302, startUrl('?device_id=' + DEVICE + '&next=https%3A%2F%2Fevil.example')),
  X('start-goes-to-the-provider', START, 302, startUrl()),
  X('start-fails-the-page-says-off', START, 302, startUrl(), { provider: { authRequest: fails } }),
  X('callback-unknown-provider', CALLBACK, 404, '/api/signin/provider/nope/callback', { provider: { rowOf: () => null } }),
  X('callback-page-not-configured', CALLBACK, 404, backUrl(), { provider: { configured: () => false, webSigninUrl: () => '' } }),
  X('callback-no-cookie', CALLBACK, 302, backUrl(), { pending: { take: async () => null } }),
  X('callback-start-row-gone', CALLBACK, 302, backUrl(), { pending: { take: async () => null } }, cookie),
  X('callback-store-fails', CALLBACK, 302, backUrl(), { pending: { take: fails } }, cookie),
  X('callback-other-provider', CALLBACK, 302, backUrl(), { pending: { take: async () => ({ provider: 'other', state: 'S1' }) } }, cookie),
  X('callback-state-differs', CALLBACK, 302, backUrl('?code=c1&state=WRONG'), {}, cookie),
  X('callback-person-cancelled', CALLBACK, 302, backUrl('?error=access_denied'), { provider: { finish: cancelled } }, cookie),
  X('callback-finish-fails', CALLBACK, 302, backUrl(), { provider: { finish: fails } }, cookie),
  X('callback-hands-off', CALLBACK, 302, backUrl(), {}, cookie),
  X('callback-handoff-fails', CALLBACK, 302, backUrl(), { pending: { put: fails } }, cookie),
  /* P1a: the page swaps the one-time code for the session (the 200 is proved with the real session writer in tests/signin-provider.test.cjs F1) */
  Object.assign(X('handoff-code-spent', HANDOFF, 401, '/api/signin/provider/handoff', { pending: { take: async () => null } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { code: 'a-code-that-is-long-enough-1' } }),
  Object.assign(X('handoff-signs-in', HANDOFF, 200, '/api/signin/provider/handoff', { store: { linksFor: async () => [{ link_id: 'l1', identity_id: 'i1', entity_id: 'i1' }] }, pending: { take: async () => ({ provider: 'stand', device_id: DEVICE, claims, links: [{ link_id: 'l1', identity_id: 'i1', entity_id: 'i1' }] }) }, identityAuth: { rowsOfCandidates: async () => [{ identity_id: 'i1', bridge_id: 'B', display_name: 'A', email: 'a@example.test', user_id: 'ana', identity_type: 'entity', status: 'active', parent_entity_id: null }], issueToken: async () => 'session-token-stand-in', personShape: (identity) => ({ identity_id: identity.identity_id }) } }, { 'x-device-id': DEVICE }), { body: { code: 'a-code-that-is-long-enough-1' } }),
  Object.assign(X('handoff-not-linked', HANDOFF, 403, '/api/signin/provider/handoff', { pending: { take: async () => ({ provider: 'stand', device_id: DEVICE, claims, links: [] }) } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { code: 'a-code-that-is-long-enough-1' } })
  /* connect (critic 21 Nov): the 200s with the real routes and stood-in doors; the refusals are proved in tests/signin-provider.test.cjs section G */,
  Object.assign(X('links-list', LINKS, 200, '/api/signin/provider/links', { links: { listOf: async () => [{ link_id: 'l1', provider: 'stand', email: null, email_verified: false, linked_at: null, last_used_at: null }] } }), { method: 'GET' }),
  Object.assign(X('link-start-ok', LINKSTART, 200, '/api/signin/provider/link/start', { identityAuth: { rowsOfCandidates: async () => [{ identity_id: 'i1', bridge_id: 'B', display_name: 'A', email: 'a@example.test', user_id: 'ana', identity_type: 'entity', status: 'active', parent_entity_id: null, pin_hash: 'h' }], verifyCredential: async () => ({ ok: true }) } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { provider: 'stand', pin: '4827' }, setup: { session: SESSION } }),
  Object.assign(X('link-finish-ok', LINKFINISH, 200, '/api/signin/provider/link/finish', { pending: { take: async () => ({ confirm: true, provider: 'stand', identity_id: '11111111-1111-4111-8111-111111111111', entity_id: '11111111-1111-4111-8111-111111111111', device_id: DEVICE, jti: SESSION.jti, claims }) }, identityAuth: { rowsOfCandidates: async () => [{ identity_id: '11111111-1111-4111-8111-111111111111', bridge_id: 'B', display_name: 'A', email: 'a@example.test', user_id: 'ana', identity_type: 'entity', status: 'active', parent_entity_id: null, pin_hash: 'h' }] } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { code: 'a-code-that-is-long-enough-1' }, setup: { session: SESSION } }),
  Object.assign(X('link-finish-other-session', LINKFINISH, 403, '/api/signin/provider/link/finish', { pending: { take: async () => ({ confirm: true, provider: 'stand', identity_id: '11111111-1111-4111-8111-111111111111', entity_id: '11111111-1111-4111-8111-111111111111', device_id: DEVICE, jti: 'someone-elses', claims }) } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { code: 'a-code-that-is-long-enough-1' }, setup: { session: SESSION } }),
  Object.assign(X('link-start-wrong-proof', LINKSTART, 401, '/api/signin/provider/link/start', { identityAuth: { rowsOfCandidates: async () => [{ identity_id: 'i1', bridge_id: 'B', display_name: 'A', email: 'a@example.test', user_id: 'ana', identity_type: 'entity', status: 'active', parent_entity_id: null, pin_hash: 'h' }], verifyCredential: async () => ({ ok: false }) } }, { 'x-device-id': DEVICE }), { method: 'POST', body: { provider: 'stand', pin: '0000' } }),
  Object.assign(X('link-delete-ok', UNLINK, 200, '/api/signin/provider/links/11111111-1111-4111-8111-111111111111', { links: { listOf: async () => [{ link_id: '11111111-1111-4111-8111-111111111111', provider: 'stand' }], remove: async () => ({ removed: true, link: { provider: 'stand', issuer: 'i', tenant: '', subject: 's' } }) }, identityAuth: { rowsOfCandidates: async () => [{ identity_id: 'i1', bridge_id: 'B', display_name: 'A', email: 'a@example.test', user_id: 'ana', identity_type: 'entity', status: 'active', parent_entity_id: null, pin_hash: 'h' }], verifyCredential: async () => ({ ok: true }) } }), { method: 'DELETE', body: { pin: '4827' } }),
  Object.assign(X('link-delete-unknown', UNLINK, 404, '/api/signin/provider/links/22222222-2222-4222-8222-222222222222', {}), { method: 'DELETE', body: { pin: '4827' } })
];

/** the contract as a unit: each route has an operation, a redirect door declares its 302, every refusal it declares is a Problem */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const { contract } = require(path.join(HERE, 'lib', 'signin-provider-contract.js'));
  check('the four routes the router holds have an operation each, and the operations no more', sameValue(Object.keys(contract.OPERATIONS).sort(), Object.keys(routes).sort()), Object.keys(routes));
  Object.values(contract.OPERATIONS).forEach((operation) => check('every refusal an operation declares is a Problem', Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('problem'))));
  [START, CALLBACK].forEach((route) => check(route + ' declares its answer as a 302 with a media type (a visit cannot show JSON)', !!contract.OPERATIONS[route].responses['302'] && !!contract.OPERATIONS[route].responses['302'].content['text/plain']));
}

/** every code the answers carry is a register row with its sentence written */
function checkCodesRegistered(recording) {
  console.log('\n-- the codes these routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  const missing = seen.filter((code) => !known.has(code));
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && missing.length === 0, missing);
}

(async () => {
  lab.installStubs();
  router = require(path.join(HERE, FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const { contract } = require(path.join(HERE, 'lib', 'signin-provider-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { key: 'nope' });
  const modules = () => ({ provider: require(path.join(HERE, 'lib', 'signin-provider.js')), pending: require(path.join(HERE, 'lib', 'signin-pending.js')), store: require(path.join(HERE, 'lib', 'signin-provider-store.js')), identityAuth: require(path.join(HERE, 'lib', 'identity-auth.js')), policy: require(path.join(HERE, 'lib', 'policy.js')), links: require(path.join(HERE, 'lib', 'signin-provider-link.js')) });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, (route) => allowedBy[route] || [], modules);
  server.close();
  checkContract(routes);
  checkCodesRegistered(recording);
  const at = (id, route) => recording[route + '|' + id];
  const where = (one) => (one && one.text) || '';
  const refusedTo = (id, route, code) => !!at(id, route) && at(id, route).status === 302 && where(at(id, route)).includes('#e=' + code);
  check('an unknown provider is 404 PROVIDER_UNKNOWN on start and on callback', at('start-unknown-provider', START).body.code === 'PROVIDER_UNKNOWN' && at('callback-unknown-provider', CALLBACK).body.code === 'PROVIDER_UNKNOWN');
  check('a provider with no page to come back to is 404 PROVIDER_OFF on start and on callback', at('start-page-not-configured', START).body.code === 'PROVIDER_OFF' && at('callback-page-not-configured', CALLBACK).body.code === 'PROVIDER_OFF');
  check('a start with no device id goes back with #e=NO_DEVICE', refusedTo('start-no-device', START, 'NO_DEVICE'));
  check('a start with an outside next page goes back with #e=BAD_NEXT', refusedTo('start-bad-next', START, 'BAD_NEXT'));
  check('a good start is a 302 to the provider', at('start-goes-to-the-provider', START).status === 302 && where(at('start-goes-to-the-provider', START)).includes('idp.example.test/authorize'));
  check('a failing start goes back with #e=PROVIDER_OFF', refusedTo('start-fails-the-page-says-off', START, 'PROVIDER_OFF'));
  check('a callback with no start row goes back with #e=SSO_STATE', refusedTo('callback-no-cookie', CALLBACK, 'SSO_STATE') && refusedTo('callback-start-row-gone', CALLBACK, 'SSO_STATE') && refusedTo('callback-state-differs', CALLBACK, 'SSO_STATE'));
  check('a callback for another provider goes back with #e=SSO_MIXUP', refusedTo('callback-other-provider', CALLBACK, 'SSO_MIXUP'));
  check('a cancelled sign-in goes back with #e=SSO_CANCELLED', refusedTo('callback-person-cancelled', CALLBACK, 'SSO_CANCELLED'));
  check('a failing finish, store or handoff goes back with #e=PROVIDER_OFF', ['callback-finish-fails', 'callback-store-fails', 'callback-handoff-fails'].every((id) => refusedTo(id, CALLBACK, 'PROVIDER_OFF')));
  check('a good callback goes to the web page with a one-time #h=', at('callback-hands-off', CALLBACK).status === 302 && where(at('callback-hands-off', CALLBACK)).includes('#h='));
  check('a failing list still answers 200 with an empty list', at('list-fails-the-page-still-loads', LIST).status === 200 && sameValue(at('list-fails-the-page-still-loads', LIST).body, { providers: [], standin: false }));
  check('a missing store answers 200 with an empty list', at('list-store-not-there', LIST).status === 200 && at('list-store-not-there', LIST).body.providers.length === 0);
  check('no answer of the three routes says the cause of a failure', Object.values(recording).every((one) => !/SELECT|vault|relation "|pg /.test(JSON.stringify(one.body) + (one.text || ''))));
  check('no answer is a 5xx but the sign-in fault answer by design: 503 SIGNIN_UNAVAILABLE (a fault is otherwise a redirect back or an empty list)', Object.values(recording).every((one) => one.status < 500 || (one.status === 503 && one.body && one.body.code === 'SIGNIN_UNAVAILABLE')));
  const proved = allowlistWorld.checkAllowList(recording, contract.OPERATIONS, check);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    allowlistWorld.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the three routes', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the routes whose success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
