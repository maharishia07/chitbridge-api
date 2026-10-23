#!/usr/bin/env node
// @type: contract
/**
 * api-problem-definitions.test.cjs — API-4 sweep, the definitions shelf: every answer of routes/definitions.js (6 routes, mounted at /api/definitions).
 *
 * OWNS      the proof that each refusal of these 6 routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), that no answer of any status carries the text of a thrown error (a db
 *           that THROWS a string with SQL in it, and a library that does), this file's rows of docs/contracts/api-error-tests.json, and the "signed in as another shop" world
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs) for the three routes addressed by an id, recorded in docs/contracts/api-hardening-evidence.json.
 *           Also: no answer outside the statuses the contract declares (lib/definitions-contract.js), its words as units, and the old express-validator chains run beside the
 *           schemas that replaced them.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs).
 * FLOW      the six routes x world (signed out, a failing db, an empty db, a bad id) + the named extras (tests/lib/definitions-scenes.cjs) → real route → body → Problem fields
 *           present · frozen legacy keys equal · no leak on any status · statuses tested → manifest; then the foreign-id world → evidence
 * CARD      07-catalogue-and-pricing/definitions
 *
 *   node tests/api-problem-definitions.test.cjs                    check
 *   node tests/api-problem-definitions.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence.json
 *   node tests/api-problem-definitions.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-definitions.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-definitions.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SHOP, STAFF, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const S = require('./lib/definitions-scenes.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/definitions';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: 'routes/definitions.js' },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401,
  notFrozen: (one) => one.status === 401
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
const sources = () => ({});

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) {
    lab.freeze(lab.flagValue('--freeze'));
    process.exit(0);
  }
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'definitions.js'));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : (route) => require(path.join(HERE, 'lib', 'definitions-contract.js')).allowedStatuses()(route) || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, S.extras({ answering, raising, firstOf }), {});
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
