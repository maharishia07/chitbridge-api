#!/usr/bin/env node
// @type: contract
/**
 * api-problem-service.test.cjs — API-4 sweep for the service clock: every answer of routes/service.js (7 routes, mounted at /api/service).
 *
 * OWNS      the proof that no route of the file answers outside the statuses its contract declares (lib/service-contract.js: all seven read the chit id in the address),
 *           that no 5xx says a failure's cause, that a value no column can hold (a NUL byte in text, a time Postgres cannot read) is a 400 in words, never a 500, and that 2xx answers are held by their own scenes (--capture before / --compare after),
 *           this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads) and the contract's words as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/service.js over a stand-in db and auth (tests/lib/problem-world.cjs, tests/lib/service-scenes.cjs).
 * FLOW      route list (read from the router) x world (signed out, a failing db, nothing found, a bad id) + the named scenes → real route → body → status declared · no leak → manifest
 * CARD      03-disputes-service-and-register/service-request-sla-pause
 * The bodies are NOT judged as Problem bodies and not frozen here: the routes keep their old words byte for byte (tests/rail-158-service-errors.test.cjs and rail-161 hold the words that matter).
 * This test pins statuses, leaks and the junk-value rule.
 *
 *   node tests/api-problem-service.test.cjs            check
 *   node tests/api-problem-service.test.cjs --write    rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-service.test.cjs --capture F / --compare F   record every answer to F (run on the code BEFORE a change), then say what moved
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SECRET_SQL, sameValue, SHOP, OWNER, PARTY } = require('./lib/problem-world.cjs');
const S = require('./lib/service-scenes.cjs');
const allow = require('./lib/allowlist-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/service';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/service.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: () => true /* the bodies are the routes' own words, kept as they were: only the status is judged here */
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'bad-id', badId: true, setup: {} },
  { id: 'nothing-found', setup: {} }
];
const contractModule = () => require(path.join(HERE, 'lib', 'service-contract.js'));
const modules = () => ({});

/** the contract and the router agree: every route has an operation (all seven read the chit id in the address), and no operation is for a route the file does not hold */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const operations = Object.keys(contractModule().contract.OPERATIONS);
  check('every route has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), { operations, routes: Object.keys(routes) });
  const problems = operations.every((key) => Object.keys(contractModule().contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contractModule().contract.OPERATIONS[key].responses[status]).includes('Problem')));
  check('every refusal an operation declares is a Problem response', problems);
}

/** a value no column can hold (a NUL byte, a time Postgres cannot read) is a 400 in words and never a 5xx, and a not-a-time is answered as a NUL byte is: refused, the database never asked to keep it */
function checkJunkRefused(recording, scenes) {
  console.log('\n-- a value no column can hold is a 400, never a 500 --');
  scenes.filter((one) => /nul-byte|not-a-time/.test(one.id)).forEach((one) => {
    const answer = recording[one.route + '|' + one.id];
    check(one.id + ' is a 400 that says nothing of the database', !!answer && answer.status === 400 && !/invalid|byte sequence|pg 2/.test(JSON.stringify(answer.body)), answer && [answer.status, answer.body]);
  });
}

/* ── Slice 1b (critic 6 Nov, class C): the foreign-id world of the three service writes that open with mine() (a chit_header row of THIS shop): shop A holds the chit, shop B asks for it
   → exactly the unknown id's 404, byte for byte; the owner's own id is not a 404 ── */
const STRANGER = { identity_id: '33333333-3333-4333-8333-333333333333', identity_type: 'entity', display_name: 'Another shop' };
const FOREIGN_CASES = [
  ['POST ' + MOUNT + '/:chit_id/pause', '/pause', { reason: 'waiting_on_counterparty', from: '2026-11-04T06:00:00Z' }],
  ['POST ' + MOUNT + '/:chit_id/pause/:pause_id/answer', '/pause/' + PARTY + '/answer', { accepted: true }],
  ['POST ' + MOUNT + '/:chit_id/resolve', '/resolve', { resolution_code: 'fixed', note: 'done' }]
];
/** the stand-in db: the chit is answered only to a statement that names shop A (as RLS and WHERE entity_id = $2 would); every other statement of the clock works */
const heldByShopA = (planted) => (sql, params) => {
  const text = String(sql);
  if (/FROM chit_header/.test(text)) return planted && params.includes(SHOP) ? { rows: [{ role: 'buyer' }], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/paused_to IS NULL/.test(text)) return { rows: [], rowCount: 0 };
  if (/SET resolved_at/.test(text)) return { rows: [{ resolved_at: new Date(Date.UTC(2026, 10, 4, 6)), resolution_code: 'fixed' }], rowCount: 1 };
  if (/chit_sla_pause_(start|end|answer)/.test(text)) return { rows: [{ copies: 2 }], rowCount: 1 };
  return null;
};
async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign chit id answers exactly as an unknown one (S35) --');
  const recording = FOREIGN.recorder();
  const cases = FOREIGN_CASES.map(([route, tail, body]) => ({
    route,
    play: async (who, planted) => {
      Object.assign(lab.world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', jsonThrows: false, noCustomer: false, sqlRows: heldByShopA(planted) });
      return lab.send(port, 'POST', MOUNT + '/' + PARTY + tail, body);
    }
  }));
  const failures = await FOREIGN.runCases(cases, recording.record);
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  check('foreign id: ' + FOREIGN_CASES.length + ' service writes answer a foreign chit id exactly as an unknown one (404, same body) and the own chit is not a 404', failures.length === 0, failures);
  return recording.proved();
}

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'service.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const declared = contractModule().contract.allowedStatuses();
  const allowed = capturing ? () => [] : declared;
  const scenes = S.extras();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes, {});
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, modules);
  const foreignProved = await checkForeignIds(server.address().port);
  server.close();
  if (lab.flagValue('--capture')) {
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  checkContract(routes);
  const closedHeld = allow.checkAllowList(recording, contractModule().contract.OPERATIONS, check);
  checkJunkRefused(recording, scenes);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(routes).every((key) => recording[key + '|signed-out'].status === 401));
  check('a chit id that is not a uuid is a 404 on every route (the id is judged before sign-in, as it always was)', Object.keys(routes).every((key) => recording[key + '|bad-id'].status === 404));
  check('no 5xx of any scene carries a failure\'s cause', Object.values(recording).filter((one) => one.status >= 500).every((one) => !JSON.stringify(one.body).includes(SECRET_SQL) && !/SELECT|vault|relation "/.test(JSON.stringify(one.body))));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    allow.writeEvidence(EVIDENCE_FILE, lab.mine, closedHeld);
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreignProved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/service.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the service routes whose success answers held closed here', sameValue(allow.evidenceOf(EVIDENCE_FILE, lab.mine), closedHeld), closedHeld);
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the service writes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreignProved), foreignProved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
