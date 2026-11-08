#!/usr/bin/env node
// @type: contract
/**
 * api-problem-network-offers.test.cjs — API-4 sweep for routes/network-offers.js (8 routes), its own sweep since the marketing sweep let it go (Lane B2, 4 Nov 2026).
 *
 * OWNS      the proof that each refusal of the network-offers doors is a Problem body AND keeps the keys it answered before (docs/contracts/api-legacy.json, frozen at this
 *           sweep's first run), that no answer says a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the
 *           register's error_tests column reads), and that no answer is outside the statuses lib/network-offers-contract.js declares. The refusals the generic worlds cannot
 *           reach (an offer not live, an end before the start, a read that breaks) are the named extras below.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      route list (read from the router) x world (signed out, a key, staff, a bad id, a failing db, nothing found) + the named extras → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 * CARD      network-and-trade/network-offers
 *
 *   node tests/api-problem-network-offers.test.cjs                    check
 *   node tests/api-problem-network-offers.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-network-offers.test.cjs --capture F        record each answer to file F
 *   node tests/api-problem-network-offers.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, STAFF, SECRET_SQL, sameValue } = require('./lib/problem-world.cjs');
const ALLOW = require('./lib/allowlist-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNTS = [{ mount: '/api/network-offers', file: 'routes/network-offers.js', contract: 'lib/network-offers-contract.js' }];
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const OFFER = '33333333-3333-4333-8333-333333333333';
const lab = harness({
  here: HERE,
  mounts: MOUNTS.map((one) => one.mount),
  routeFiles: Object.fromEntries(MOUNTS.map((one) => [one.mount, one.file])),
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const THROWS = () => {
  throw new Error(SECRET_SQL);
};
const throwsLater = async () => THROWS();
const NOT_READ = async () => {
  throw require(path.join(HERE, 'lib', 'network-membership')).readFailed(new Error(SECRET_SQL), 'test');
};
const OFFER_ROW = (status) => (sql) =>
  /FROM definition WHERE entity_id = \$1 AND definition_id/.test(sql)
    ? { rows: [{ definition_id: OFFER, name: 'Spring offer', status, current_version: 1 }], rowCount: 1 }
    : undefined;
/** the extras: a refusal inside a handler the generic worlds cannot reach (they send an empty body, which is itself the handler's own 400/404) */
/* NET-91: a staff login (an editor of the brand) is refused 403 OWNER_ONLY on the three writes that push to every store, and NOTHING is written or pushed: each stand-in records a call */
const STAFF_WROTE = [];
const RECORDS = (name, value) => async () => {
  STAFF_WROTE.push(name);
  return value;
};
const NETWORK_WRITES = { mergeFlag: RECORDS('mergeFlag', {}), setReleased: RECORDS('setReleased', {}), pushToNetwork: RECORDS('pushToNetwork', { stores: 0, clients: 0 }) };
const STAFF_REFUSED = [
  X('staff-policy', 'PUT /api/network-offers/policy', 403, { after: true, setup: { who: STAFF }, body: { policy: 'opt_out' }, patch: { net: NETWORK_WRITES } }),
  X('staff-release', 'POST /api/network-offers/:id/release', 403, { after: true, setup: { who: STAFF, sqlRows: OFFER_ROW('live') }, patch: { net: NETWORK_WRITES } }),
  X('staff-withdraw', 'POST /api/network-offers/:id/withdraw', 403, { after: true, setup: { who: STAFF, sqlRows: OFFER_ROW('live') }, patch: { net: NETWORK_WRITES } })
];
const EXTRAS = [
  X('network-read-breaks', 'GET /api/network-offers', 500, { patch: { net: { brandView: throwsLater } } }),
  X('members-not-read', 'GET /api/network-offers', 503, { patch: { net: { brandView: NOT_READ } } }),
  X('policy-write-breaks', 'PUT /api/network-offers/policy', 500, { body: { policy: 'opt_in' }, patch: { net: { mergeFlag: throwsLater } } }),
  X('price-answer-breaks', 'POST /api/network-offers/catalogue/price', 500, { body: { source_key: 's', name: 'n', choice: 'use' }, patch: { ncat: { answer: throwsLater } } }),
  X('offer-not-live', 'POST /api/network-offers/:id/release', 409, { setup: { sqlRows: OFFER_ROW('draft') } }),
  X('ends-before-start', 'POST /api/network-offers/:id/release', 400, { setup: { sqlRows: OFFER_ROW('live') }, body: { at: 'now', until: '2000-01-01T00:00:00Z' } }),
  X('release-breaks', 'POST /api/network-offers/:id/release', 500, { setup: { sqlRows: OFFER_ROW('live') }, patch: { net: { flagsOf: throwsLater } } }),
  X('never-released', 'POST /api/network-offers/:id/withdraw', 409, { setup: { sqlRows: OFFER_ROW('live') }, patch: { net: { flagsOf: async () => ({ flags: {} }) } } }),
  X('withdraw-breaks', 'POST /api/network-offers/:id/withdraw', 500, { setup: { sqlRows: OFFER_ROW('live') }, patch: { net: { flagsOf: throwsLater } } }),
  X('choice-write-breaks', 'POST /api/network-offers/:id/choice', 500, { body: { choice: 'in' }, patch: { net: { setIn: throwsLater } } })
];
/** API-7: the success answer of each write the generic worlds cannot reach (the stand-in database has no brand): the recorded 2xx is what the allow-list shape and the output_allowlist evidence are made from */
const PUSHED = async () => ({ stores: 2, clients: 3 });
const WINDOW = { version: 1, at: '2026-11-09T04:00:00.000Z', until: null, released_at: '2026-11-08T00:00:00.000Z', released_by: 'Owner', prev: null };
const SUCCESS = [
  X('policy-saved', 'PUT /api/network-offers/policy', 200, { body: { policy: 'opt_in' }, patch: { net: { mergeFlag: async () => ({}), pushToNetwork: PUSHED } } }),
  X('catalogue-published', 'POST /api/network-offers/catalogue/publish', 200, { body: { source_key: 's' }, patch: { ncat: { publish: async () => ({ rec: { id: 'p1', source_key: 's', at: WINDOW.at, published_at: WINDOW.released_at, published_by: 'Owner', changes: [] }, applied: false, followed: 2 }) } } }),
  X('catalogue-cancelled', 'POST /api/network-offers/catalogue/cancel', 200, { body: { source_key: 's' }, patch: { ncat: { cancel: async () => ({ ok: true, id: 'p1' }) } } }),
  X('price-answered', 'POST /api/network-offers/catalogue/price', 200, { body: { source_key: 's', name: 'n', choice: 'use' }, patch: { ncat: { answer: async () => ({ ok: true, choice: 'use' }) } } }),
  X('offer-released', 'POST /api/network-offers/:id/release', 200, { setup: { sqlRows: OFFER_ROW('live') }, patch: { net: { flagsOf: async () => ({ flags: {} }), nextOpeningFor: async () => WINDOW.at, setReleased: async () => ({}), pushToNetwork: PUSHED } } }),
  X('offer-withdrawn', 'POST /api/network-offers/:id/withdraw', 200, { setup: { sqlRows: OFFER_ROW('live') }, patch: { net: { flagsOf: async () => ({ flags: { network_offers: { released: { [OFFER]: WINDOW } } } }), nextOpeningFor: async () => WINDOW.at, setReleased: async () => ({}), pushToNetwork: PUSHED } } })
];
const contractOf = (one) => require(path.join(HERE, one.contract)).contract;

/** the contracts as units: every route has an operation and every operation a route; every refusal an operation declares is a Problem; the words never carry a cause */
function checkContracts(routes) {
  console.log('\n-- the contracts and the routers agree --');
  const operations = MOUNTS.flatMap((one) => Object.keys(contractOf(one).OPERATIONS));
  check('every route the routers hold has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const refusalsAreProblems = MOUNTS.every((one) => Object.values(contractOf(one).OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('Problem'))));
  check('every refusal an operation declares is a Problem', refusalsAreProblems);
  const { refusalOf, faultOf, SAID } = require(path.join(HERE, 'lib', 'network-offers-contract.js'));
  const lost = faultOf(new Error(SECRET_SQL), { id: 'r1' }, 'NETWORK_READ_FAILED');
  check('faultOf(): the old { error: "Failed" } and the safe sentence, never the cause', lost.status === 500 && lost.legacy.error === SAID.failed && !JSON.stringify(lost).includes('vault'), lost);
  const unread = faultOf(Object.assign(new Error('Try again.'), { code: 'NETWORK_READ_FAILED' }), { id: 'r1' }, 'NETWORK_READ_FAILED');
  check('faultOf(): a member read that failed keeps its 503 and its code', unread.status === 503 && unread.code === 'NETWORK_READ_FAILED' && unread.legacy.error === SAID.notRead, unread);
  const steps = { not_yours: 404, validation: 400, none: 409, nothing: 409, no_price: 409, not_adopted: 409, anything_else: 409 };
  check('refusalOf(): not_yours 404, validation 400, every other step 409, the old { error, message } kept', Object.keys(steps).every((word) => refusalOf({ error: word, message: 'm' }).status === steps[word] && refusalOf({ error: word, message: 'm' }).legacy.error === word));
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
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const mounted = MOUNTS.map((one) => ({ mount: one.mount, router: require(path.join(HERE, one.file)) }));
  const routes = Object.assign({}, ...mounted.map((one) => lab.routesOf(one.router, one.mount)));
  const server = lab.appOf(mounted).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const allowedBy = Object.assign({}, ...MOUNTS.map((one) => Object.fromEntries(Object.keys(contractOf(one).OPERATIONS).map((key) => [key, contractOf(one).allowedStatuses()(key)]))));
  const allowed = capturing ? () => [] : (route) => allowedBy[route] || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS.concat(SUCCESS, STAFF_REFUSED), { id: OFFER });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, () => ({ net: require(path.join(HERE, 'lib', 'network-offers')), ncat: require(path.join(HERE, 'lib', 'network-catalogue')) }));
  server.close();
  if (capturing) {
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  checkContracts(routes);
  const staffAnswers = ['PUT /api/network-offers/policy|staff-policy', 'POST /api/network-offers/:id/release|staff-release', 'POST /api/network-offers/:id/withdraw|staff-withdraw'].map((key) => recording[key]);
  check('a staff login is refused 403 OWNER_ONLY on policy, release and withdraw, and nothing was written or pushed', staffAnswers.every((one) => one && one.status === 403 && one.body.code === 'OWNER_ONLY' && one.body.may === false) && STAFF_WROTE.length === 0, { staffAnswers, STAFF_WROTE });
  checkCodesRegistered(recording);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const allowHeld = ALLOW.checkAllowList(recording, Object.assign({}, ...MOUNTS.map((one) => contractOf(one).OPERATIONS)), check);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    ALLOW.writeEvidence(EVIDENCE_FILE, lab.mine, allowHeld);
  } else check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the routes whose success answers held closed here', sameValue(ALLOW.evidenceOf(EVIDENCE_FILE, lab.mine), allowHeld), allowHeld);
  if (!lab.argv.includes('--write')) check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/network-offers.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
