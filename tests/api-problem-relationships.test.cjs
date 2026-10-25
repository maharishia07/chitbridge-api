#!/usr/bin/env node
// @type: contract
/**
 * api-problem-relationships.test.cjs — API-4 sweep, the supplier doors: every answer of the six /api/relationships/suppliers routes (list · add · availability · patch · remove · a supplier's catalogue),
 * the doors the cross-installation work drives (NET-39 search and remote catalogue, RAIL-101 add by address).
 *
 * OWNS      the proof that each refusal of the six doors is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before the sweep),
 *           that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which
 *           the register's error_tests column reads), and the "signed in as another shop" world: a list row addressed by an id in the path answers another shop's id exactly as an unknown id
 *           (API-STANDARD S35, tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json; the catalogue door, which answers 200 for an id nobody holds, is
 *           printed as a FINDING for its owner, never faked. Also: no answer outside the statuses the contract declares (lib/relationships-contract.js), its words as units, every code a refusal
 *           carries a register row with its sentence, and the add answers supplier_entity_id on every path (API-6, 25 Oct).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs, scenes in tests/lib/relationships-scenes.cjs).
 * FLOW      the six routes (read from the router itself) x world (signed out, staff, a bad id, a failing db, an empty db) + the named extras → real route → body → Problem fields present ·
 *           frozen legacy keys equal · a 4xx says its own sentence · no leak on a 5xx · statuses tested → manifest; then the foreign-id world
 * CARD      11-crm-and-marketing/relationships
 *
 *   node tests/api-problem-relationships.test.cjs                    check
 *   node tests/api-problem-relationships.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-relationships.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-relationships.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 *   node tests/api-problem-relationships.test.cjs --compare F        the answers now against a capture F: byte for byte for a success, the old keys in order for a refusal
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, answering, raising, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/relationships-scenes.cjs');
const foreign = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/relationships';
const ROUTE_FILE = 'routes/relationships.js';
const DOORS = ['GET /api/relationships/suppliers', 'POST /api/relationships/suppliers', 'GET /api/relationships/suppliers/availability', 'PATCH /api/relationships/suppliers/:id', 'DELETE /api/relationships/suppliers/:id', 'GET /api/relationships/suppliers/:supplier_entity_id/catalogue'];
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' };
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const tools = { OWNER, STAFF, SECRET_SQL, answering, raising, firstOf };
const ADDED = new Set(scenes.extras(tools).filter((one) => one.after).map((one) => one.id));
const BY_ID = new RegExp('^(DELETE /api/relationships/suppliers/:id|GET /api/relationships/suppliers/:supplier_entity_id/catalogue)' + String.fromCharCode(36)); /* the doors whose path id is a uuid by schema (PATCH keeps a bare id: its 400 is reachable through the body) */
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  owns: (route) => DOORS.includes(route),
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  /* a non-uuid id in the path is now refused by the schema (422, or the chain's old 400 naming id) where Postgres answered a 500 live (22P02) and the stand-in a 404: an added refusal, nothing old frozen */
  added: (route, scenario) => scenario === 'bad-id' && BY_ID.test(route),
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || ADDED.has(scenario) || (scenario === 'bad-id' && BY_ID.test(one.route))
});
const { check } = lab;
const sources = () => ({
  'local-identity': require(path.join(HERE, 'lib', 'local-identity')),
  'remote-party': require(path.join(HERE, 'lib', 'remote-party')),
  istest: require(path.join(HERE, 'lib', 'istest')),
  'party-fields': require(path.join(HERE, 'lib', 'party-fields')),
  crm: require(path.join(HERE, 'lib', 'crm')),
  'catalogue-view': require(path.join(HERE, 'lib', 'catalogue-view')),
  'remote-catalogue': require(path.join(HERE, 'lib', 'remote-catalogue'))
});
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} },
  { id: 'bad-id', setup: {}, badId: true }
];
/** the contract (absent on the base of the sweep, where only a capture runs) */
const contractModule = () => require(path.join(HERE, 'lib', 'relationships-contract.js'));

/** lib/relationships-contract.js as a unit: the words as the doors always said them, the schema refusal in the chain's old body */
function checkWords() {
  console.log('\n-- lib/relationships-contract.js: the words as units --');
  const words = contractModule();
  check('invalid(): the old two keys and the code SUPPLIER_INVALID', sameValue(words.invalid('Cannot add yourself').legacy, { error: 'Invalid', message: 'Cannot add yourself' }) && words.invalid('x').code === 'SUPPLIER_INVALID');
  check('notFound(): one sentence for a business that is not there to add, whatever was typed', words.notFound().legacy.message === words.NO_SUCH_BUSINESS && words.notFound().code === 'NOT_FOUND');
  check('exists(): the old two keys and the code SUPPLIER_EXISTS', sameValue(words.exists('Already in your supplier list').legacy, { error: 'Exists', message: 'Already in your supplier list' }));
  const busy = words.mintRefused({ status: 409, error: { error: 'Busy', message: 'Could not allocate an ID for X. Try once more.' } });
  check('mintRefused(): the library body as it was, SUPPLIER_ID_BUSY for a 409 and SUPPLIER_INVALID for a 400', busy.code === 'SUPPLIER_ID_BUSY' && busy.legacy.error === 'Busy' && words.mintRefused({ status: 400, error: { error: 'Invalid', message: 'x' } }).code === 'SUPPLIER_INVALID');
  const failed = words.failed(new Error(SECRET_SQL), { id: 'r1' }, 'Get suppliers failed');
  check("failed(): a 500 INTERNAL that says nothing of its cause, the screen's label kept", failed.status === 500 && failed.code === 'INTERNAL' && failed.legacy.error === 'Get suppliers failed' && !JSON.stringify(failed).includes('vault'), failed);
  const chain = words.validationFailed([{ field: 'supply_kind', detail: 'x' }, { field: 'name', detail: 'y' }, { field: 'name', detail: 'z' }]);
  check("validationFailed(): the chain's old body, one detail per field, its own sentence for supply_kind and 'Invalid value' for the rest", sameValue(chain, { error: 'Validation failed', details: [{ field: 'supply_kind', message: 'supply_kind must be resale or own_use' }, { field: 'name', message: 'Invalid value' }] }), chain);
  const dup = words.partyRefused(Object.assign(new Error('Another party already has this tax id.'), { code: 'DUPLICATE_PARTY', holder: 'Rice man', scheme: 'gstin' }));
  check('partyRefused(): a duplicate tax id keeps code, error, message, holder and scheme in that order', sameValue(Object.keys(dup.legacy), ['code', 'error', 'message', 'holder', 'scheme']) && dup.code === 'DUPLICATE_PARTY', dup);
  const gate = words.removeRefused(Object.assign(new Error('There are open dues on this party.'), { status: 409, code: 'HAS_DUES' }));
  check('removeRefused(): the library code and sentence, the old three keys', gate.code === 'HAS_DUES' && sameValue(gate.legacy, { code: 'HAS_DUES', error: 'There are open dues on this party.', message: 'There are open dues on this party.' }));
}

/** the contract in front of the router: the six doors have an operation, the write bodies are closed, the gate publishes its statuses */
function checkContractShape() {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  check('the six supplier doors have an operation each, and no other', sameValue(Object.keys(contract.OPERATIONS).sort(), DOORS.slice().sort()), Object.keys(contract.OPERATIONS));
  const bodies = ['POST /api/relationships/suppliers', 'PATCH /api/relationships/suppliers/:id'].map((key) => contract.OPERATIONS[key].requestBody.content['application/json'].schema);
  check('the two write bodies are allow-lists (additionalProperties false, S33) and require nothing (the handlers answer a missing field in their own words)', bodies.every((schema) => schema.additionalProperties === false && !(schema.required || []).length));
  check('the add door declares the remote-address gate statuses (400 · 404 · 409 · 502)', ['400', '404', '409', '502'].every((status) => status in contract.OPERATIONS['POST /api/relationships/suppliers'].responses));
}

/** every code the doors answer under is a register row with its sentence written */
function checkCodesRegistered(recording) {
  console.log('\n-- the codes the supplier doors answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  const missing = seen.filter((code) => !known.has(code));
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && missing.length === 0, missing);
  check('every code the contract names (ALL_CODES) is a register row', contractModule().ALL_CODES.every((code) => known.has(code)), contractModule().ALL_CODES.filter((code) => !known.has(code)));
}

/** the answers themselves: a 2xx is never a Problem, nothing carries the database text, the add answers the id on every path */
function checkAnswers(recording) {
  console.log('\n-- the answers themselves --');
  const successes = Object.keys(recording).filter((key) => recording[key].status < 300);
  check('every success answer is plain JSON, never a Problem (' + successes.length + ' seen)', successes.length >= 10 && successes.every((key) => !/problem\+json/.test(recording[key].type)), successes.filter((key) => /problem/.test(recording[key].type)));
  check('no answer of any status carries the database text', Object.values(recording).every((one) => !/vault/.test(JSON.stringify(one.body || {})) && !/vault/.test(one.text || '')));
  ['add-local-name', 'add-business', 'add-business-one-sided', 'add-by-address'].forEach((scene) => {
    const one = recording['POST /api/relationships/suppliers|' + scene];
    check('POST /suppliers · ' + scene + ': answers supplier.supplier_entity_id (API-6: the id the list and the catalogue are addressed by)', !!one && one.status === 200 && !!(one.body && one.body.supplier && one.body.supplier.supplier_entity_id), one && one.body);
  });
  const far = recording['POST /api/relationships/suppliers|add-by-address'];
  check('POST /suppliers · add-by-address: the answer carries the address and the installation the party lives on', !!far && far.body.supplier.address === 'CBREMOTE01@far.example' && far.body.supplier.installation_key === 'far', far && far.body);
  const sellsOnlyThere = recording['POST /api/relationships/suppliers|add-by-address-sells-only-there'];
  check('POST /suppliers · a shop that sells only on its own installation is refused 409 SUPPLIER_SELLS_ONLY_HERE in words', !!sellsOnlyThere && sellsOnlyThere.status === 409 && sellsOnlyThere.body.code === 'SUPPLIER_SELLS_ONLY_HERE' && /sells only/.test(sellsOnlyThere.body.message), sellsOnlyThere && sellsOnlyThere.body);
  const unknownKey = recording['POST /api/relationships/suppliers|add-unknown-key'];
  check('POST /suppliers · a key the door never reads is refused by name in the old 400 body (S33)', !!unknownKey && unknownKey.status === 400 && unknownKey.body.error === 'Validation failed' && (unknownKey.body.errors || []).some((one) => one.field === 'colour'), unknownKey && unknownKey.body);
  const here = recording['GET /api/relationships/suppliers|suppliers-listed'];
  const there = recording['GET /api/relationships/suppliers|suppliers-listed-remote'];
  check('GET /suppliers · a supplier here carries installation_key null (the key is in the row, not dropped)', !!here && here.status === 200 && here.body.suppliers.length === 1 && 'installation_key' in here.body.suppliers[0] && here.body.suppliers[0].installation_key === null, here && here.body.suppliers);
  check('GET /suppliers · a supplier on another installation carries its installation_key and installation_label (the web decides "far" from it)', !!there && there.status === 200 && there.body.suppliers[0].installation_key === 'far' && there.body.suppliers[0].installation_label === 'Far side', there && there.body.suppliers);
  const sql = fs.readFileSync(path.join(HERE, ROUTE_FILE), 'utf8');
  check('GET /suppliers · the SQL names installation_key as the installation when it IS DISTINCT FROM this one (ops.f_installation_of), else null', /CASE WHEN ops\.f_installation_of\(i\.identity_id\) IS DISTINCT FROM ops\.f_installation_of\(\$1\) THEN ops\.f_installation_of\(i\.identity_id\) END AS installation_key/.test(sql));
  const remote = recording['GET /api/relationships/suppliers/:supplier_entity_id/catalogue|catalogue-remote-supplier'];
  check("GET …/catalogue · a remote supplier's view is answered as the seller states it (its money, its items), with remote.installation_key", !!remote && remote.body.supplier.currency_code === 'AUD' && remote.body.remote.installation_key === 'far' && remote.body.items.length === 1, remote && remote.body);
}

/** the "signed in as another shop" world: the two doors that name a list row by its id (S35); the catalogue door is a finding, not evidence */
async function foreignWorld(port) {
  console.log('\n-- the 9th world: signed in as another shop --');
  const mineOnly = (rows) => (sql, params) => (params && params.some((value) => String(value) === OWNER.identity_id) ? rows(sql, params) : null);
  const patchedRow = answering(/UPDATE supplier_list SET [^;]*RETURNING supplier_list_id/, [{ supplier_list_id: scenes.LIST_ID }]);
  const heldRow = answering(/SELECT supplier_entity_id FROM supplier_list WHERE supplier_list_id = \$1 AND owner_entity_id = \$2/, [{ supplier_entity_id: scenes.OTHER }]);
  const removal = require(path.join(HERE, 'lib', 'crm'));
  const wasRemove = removal.removeParty;
  removal.removeParty = async () => undefined;
  const asks = [
    ['PATCH /api/relationships/suppliers/:id', 'PATCH', MOUNT + '/suppliers/' + scenes.LIST_ID, { nickname: 'Rice man' }, patchedRow],
    ['DELETE /api/relationships/suppliers/:id', 'DELETE', MOUNT + '/suppliers/' + scenes.LIST_ID, undefined, heldRow]
  ];
  const cases = asks.map(([route, method, url, body, rows]) => ({
    route,
    play: async (who, planted) => {
      Object.assign(lab.world, { realAuth: false, db: 'ok', who: who === 'owner' ? OWNER : STRANGER, sqlRows: planted ? mineOnly(rows) : null });
      return lab.send(port, method, url, body);
    }
  }));
  const seen = foreign.recorder();
  const failures = await foreign.runCases(cases, seen.record);
  removal.removeParty = wasRemove;
  failures.forEach((sentence) => check('foreign id: ' + sentence, false));
  asks.forEach(([route]) => check(route + ": another shop's id answers exactly as an unknown id (404, same body); the owner's own id is not a 404", !failures.some((one) => one.startsWith(route))));
  /* the catalogue door answers 200 { supplier: null } for an id nobody holds, and the public view for any business: a FINDING for its owner (cb-crm with cb-catalogue), never a faked 404 */
  Object.assign(lab.world, { realAuth: false, db: 'ok', who: STRANGER, sqlRows: null });
  const unknown = await lab.send(port, 'GET', MOUNT + '/suppliers/' + scenes.OTHER + '/catalogue');
  console.log('  FINDING GET /api/relationships/suppliers/:supplier_entity_id/catalogue: an id nobody holds answers ' + unknown.status + ' ' + JSON.stringify(unknown.json).slice(0, 80) + ' — foreign_id_404 waits on its owner (a public catalogue read by entity id: a public-id exemption needs cb-security, or a 404)');
  check('the catalogue door still answers 200 supplier null for an id nobody holds (pinned, so a change is seen)', unknown.status === 200 && unknown.json && unknown.json.supplier === null, unknown.json);
  return seen.proved();
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const every = lab.routesOf(router, MOUNT);
  const routes = Object.fromEntries(DOORS.filter((key) => every[key]).map((key) => [key, every[key]]));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, scenes.extras(tools), { id: scenes.LIST_ID, supplier_entity_id: scenes.OTHER });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    server.close();
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  check('the six supplier doors are all on the router', Object.keys(routes).length === 6, Object.keys(routes));
  checkWords();
  checkContractShape();
  checkCodesRegistered(recording);
  checkAnswers(recording);
  const proved = await foreignWorld(server.address().port);
  server.close();
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 40, frozen);
  check('a caller who is not signed in is refused with 401 on every door', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    foreign.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for the six supplier doors', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says exactly what the foreign-id world showed', sameValue(foreign.evidenceOf(EVIDENCE_FILE, lab.mine), proved), proved);
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
