#!/usr/bin/env node
// @type: contract
/**
 * api-problem-relationships.test.cjs — API-4 sweep, the relationships: every answer of routes/relationships.js (14 routes, mounted at /api/relationships: the supplier list, the customer
 * list and its named groups, rewards, the counterparty scorecard).
 *
 * OWNS      the proof that each refusal of the relationship routes is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code
 *           before the sweep), that no success answer moved (--compare against a capture of the code before), this file's rows of docs/contracts/api-error-tests.json (the statuses each
 *           route is tested for, which the register's error_tests column reads), and the "signed in as another shop" world for the routes addressed by a list row in the path (API-STANDARD S35,
 *           tests/lib/foreign-id-world.cjs), recorded in docs/contracts/api-hardening-evidence-areas.json. Also: no answer outside the statuses the contract declares (lib/relationships-contract.js),
 *           its words as units, and a body scan over EVERY answer, 200 included, for the text of a thrown error (a 200 may not carry it any more than a 500).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in db and auth (tests/lib/problem-world.cjs), the rows of tests/lib/relationships-scenes.cjs.
 * FLOW      route list (read from the router) x world (signed out, staff, a bad id, a failing db, an empty db) + the named scenes → real route → body → Problem fields present · frozen legacy keys
 *           equal · no leak on a 5xx · statuses tested → manifest; then the frozen 5xx replay, the body scan and the foreign-id world
 * CARD      11-crm-and-marketing/relationships-routes
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
const { harness, OWNER, STAFF, SECRET_SQL, sameValue, raising, answering, firstOf } = require('./lib/problem-world.cjs');
const scenes = require('./lib/relationships-scenes.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/relationships';
const ROUTE_FILE = 'routes/relationships.js';
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: ROUTE_FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => (answer.status === 401 && scenario.id === 'signed-out') || (answer.json && answer.json.code === 'REL_NOT_ON_YOUR_LIST') /* SEC-91: a refusal added after the sweep, so nothing was frozen */,
  notFrozen: (one, scenario) => (one.status === 401 && scenario === 'signed-out') || AFTER.has(scenario)
});
const { check, world } = lab;
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const STRANGER = { identity_id: scenes.STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];
/** the libraries a scene may swap one function of (a call that fails like a database), put back after the answer */
const sources = () => ({
  partyFields: require(path.join(HERE, 'lib', 'party-fields')),
  catalogueView: require(path.join(HERE, 'lib', 'catalogue-view')),
  crm: require(path.join(HERE, 'lib', 'crm')),
  customerGroups: require(path.join(HERE, 'lib', 'customer-groups')),
  rewardStore: require(path.join(HERE, 'lib', 'reward-store')),
  select: require(path.join(HERE, 'lib', 'select')),
  policy: require(path.join(HERE, 'lib', 'policy'))
});
const contractModule = () => require(path.join(HERE, 'lib', 'relationships-contract.js'));
const extrasList = () => scenes.extras({ OWNER, STAFF, SECRET_SQL, raising, answering, firstOf });
const AFTER = new Set(extrasList().filter((one) => one.after).map((one) => one.id));
/** the words of a thrown error that no answer may carry */
const THROWN = /SELECT secret|vault|relation "/;

/** lib/relationships-contract.js as a unit: the words of a refusal and of a fault, as these routes always said them */
function checkWords() {
  console.log('\n-- lib/relationships-contract.js: the refusals as a unit --');
  const words = contractModule();
  const req = { id: 'r1' };
  const fault = words.failed(new Error(SECRET_SQL), req, 'Get suppliers failed');
  check('failed: the screen\'s own label and the safe sentence, never the cause', fault.status === 500 && fault.code === 'INTERNAL' && sameValue(fault.legacy, { error: 'Get suppliers failed', message: 'Something went wrong — please try again.' }) && !JSON.stringify(fault).includes('vault'), fault);
  const dup = words.partyRefusal(Object.assign(new Error('Another party already has this tax id.'), { code: 'DUPLICATE_PARTY', status: 409, holder: 'Shop B', scheme: 'PAN' }));
  check('partyRefusal: a held tax id keeps code, sentences, holder and scheme in the old order', dup.status === 409 && sameValue(dup.legacy, { code: 'DUPLICATE_PARTY', error: 'Another party already has this tax id.', message: 'Another party already has this tax id.', holder: 'Shop B', scheme: 'PAN' }), dup);
  const bare = words.partyRefusal(Object.assign(new Error('Another party already has this tax id.'), { code: 'DUPLICATE_PARTY', status: 409 }));
  check('partyRefusal: holder and scheme ride as null when the library gave none', bare.legacy.holder === null && bare.legacy.scheme === null, bare);
  const missing = words.partyRefusal(Object.assign(new Error('Not found'), { status: 404 }));
  check('partyRefusal: a 404 is Not found with the library\'s sentence as the message', missing.status === 404 && missing.code === 'NOT_FOUND' && sameValue(missing.legacy, { error: 'Not found', message: 'Not found' }), missing);
  const conflict = words.partyRefusal(Object.assign(new Error('The party fields need migration b274'), { status: 409 }));
  check('partyRefusal: a 409 is Conflict', conflict.status === 409 && conflict.legacy.error === 'Conflict', conflict);
  const invalid = words.partyRefusal(Object.assign(new Error('State code looks wrong.'), { status: 400 }));
  check('partyRefusal: any other status is validation', invalid.status === 400 && invalid.legacy.error === 'validation' && invalid.legacy.message === 'State code looks wrong.', invalid);
  const race = words.partyRefusal(Object.assign(new Error(SECRET_SQL), { code: '23505' }));
  check('partyRefusal: a unique violation is the duplicate sentence, never the database text', race.status === 409 && race.code === 'DUPLICATE_PARTY' && !JSON.stringify(race).includes('vault'), race);
  check('partyRefusal: anything else is not a refusal (the route answers its own 500)', words.partyRefusal(new Error(SECRET_SQL)) === null);
  const removed = words.removeFault(Object.assign(new Error('There are open dues on this party.'), { status: 409, code: 'HAS_DUES' }), req);
  check('removeFault: a library refusal keeps its status, code and sentence in code · error · message', removed.status === 409 && sameValue(removed.legacy, { code: 'HAS_DUES', error: 'There are open dues on this party.', message: 'There are open dues on this party.' }), removed);
  const uncoded = words.removeFault(Object.assign(new Error('Nope.'), { status: 400 }), req);
  check('removeFault: a refusal with no code is REFUSED', uncoded.code === 'REFUSED' && uncoded.legacy.code === 'REFUSED', uncoded);
  const down = words.removeFault(Object.assign(new Error(SECRET_SQL), { status: 503, code: 'CRM_NOT_MIGRATED' }), req);
  check('removeFault: a 503 is still the 500 it always was, in the label of this route', down.status === 500 && sameValue(down.legacy, { error: 'Remove supplier failed', message: 'Something went wrong — please try again.' }), down);
  const mint = words.mintRefusal({ status: 409, error: { error: 'Busy', message: 'Could not allocate an ID for X. Try once more.' } });
  check('mintRefusal: the library\'s body is kept whole, 409 Busy', mint.status === 409 && mint.code === 'REL_ID_BUSY' && sameValue(mint.legacy, { error: 'Busy', message: 'Could not allocate an ID for X. Try once more.' }), mint);
  const name = words.mintRefusal({ status: 400, error: { error: 'Invalid', message: 'That name is too long' } });
  check('mintRefusal: a refused name is a 400', name.status === 400 && name.code === 'REL_NAME_REFUSED', name);
  const owner = words.ownerOnly();
  check('ownerOnly: code, error, message in the old order', sameValue(owner.legacy, { code: 'OWNER_ONLY', error: 'Owner only', message: 'Only the owner can remove a supplier.' }) && owner.code === 'OWNER_ONLY', owner);
  const schema = words.schemaOptions.legacy([{ field: 'page', detail: 'page must be a string.' }]);
  check('schemaOptions: a request the schema refuses is answered 400 in the keys the chains always used', words.schemaOptions.status === 400 && sameValue(schema, { error: 'Validation failed', details: [{ field: 'page', message: 'page must be a string.' }] }), schema);
}

/** every code the words answer under is a row of docs/ERROR-CODES.md with its sentence written */
function checkCodesRegistered(contract) {
  console.log('\n-- the codes the relationship routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const missing = contract.CODES.filter((code) => !known.has(code));
  check('every code the relationship words (' + contract.CODES.length + ') answer under is a register row with its sentence written', missing.length === 0, missing);
}

/** the contract in front of the router: every route has a row, and a row has a route; a body keeps its named fields */
function checkContractShape(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = contractModule();
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('the contract holds 14 operations: the 14 routes of the file', operations.length === 14 && Object.keys(routes).length === 14, [operations.length, Object.keys(routes).length]);
  const bodies = operations.filter((key) => contract.OPERATIONS[key].requestBody);
  check('every write declares a body that is an object (a list is the schema\'s 400) and requires none (the handlers answer a missing field in their own words)', bodies.every((key) => { const schema = contract.OPERATIONS[key].requestBody.content['application/json'].schema; return schema.type === 'object' && !(schema.required || []).length; }), bodies);
  check('every refusal an operation declares is a Problem', operations.every((key) => Object.keys(contract.OPERATIONS[key].responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(contract.OPERATIONS[key].responses[status]).includes('Problem'))));
  check('a path argument is plain text: the handlers\' own 404 and 200 answer an odd id', operations.filter((key) => key.includes(':')).every((key) => contract.OPERATIONS[key].parameters.filter((one) => one.in === 'path').every((one) => one.schema.type === 'string' && !one.schema.pattern)));
  const party = ['legal_name', 'nickname', 'credit_days', 'credit_limit', 'credit_limit_minor', 'state_code', 'merged_into', 'tax_ids'];
  const patchSupplier = Object.keys(contract.OPERATIONS['PATCH /api/relationships/suppliers/:id'].requestBody.content['application/json'].schema.properties);
  const patchCustomer = Object.keys(contract.OPERATIONS['PATCH /api/relationships/customers/:id'].requestBody.content['application/json'].schema.properties);
  check('the PATCH bodies name every party field the handler reads (PARTY_KEYS, one list)', party.filter((name) => name !== 'nickname').every((name) => patchSupplier.includes(name)) && party.every((name) => patchCustomer.includes(name)), [patchSupplier, patchCustomer]);
}

/**
 * the harness judges a 5xx as "says nothing of its cause" and replays no frozen body for it; every frozen 500 of these routes is replayed here: the same status and every old key,
 * byte for byte and in order (the label of the screen and the one safe sentence)
 */
function checkFrozen5xx(recording) {
  console.log('\n-- the frozen 5xx answers are replayed --');
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  let replayed = 0;
  Object.keys(legacy).filter(lab.mine).forEach((route) => legacy[route].answers.filter((frozen) => frozen.status >= 500).forEach((frozen) => {
    const now = recording[route + '|' + frozen.scenario];
    const order = Object.keys(frozen.fixture);
    replayed++;
    check(route + ' · ' + frozen.scenario + ': the frozen ' + frozen.status + ' body is kept, key by key and in order', !!now && now.status === frozen.status && sameValue(order.map((name) => now.body[name]), order.map((name) => frozen.fixture[name])) && sameValue(Object.keys(now.body).slice(0, order.length), order), now && now.body);
  }));
  check('at least twenty 5xx answers were frozen and replayed (' + replayed + ')', replayed >= 20, replayed);
}

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's list row by its id ── */
const OWN_ROW_ROUTES = () => [
  { route: 'PATCH ' + MOUNT + '/suppliers/:id', method: 'PATCH', url: MOUNT + '/suppliers/' + scenes.LIST_S, body: { nickname: 'Tea man' }, id: scenes.LIST_S },
  { route: 'PATCH ' + MOUNT + '/suppliers/:id (rename)', method: 'PATCH', url: MOUNT + '/suppliers/' + scenes.LIST_S, body: { display_name: 'Corner Hardware & Sons' }, id: scenes.LIST_S, evidence: 'PATCH ' + MOUNT + '/suppliers/:id' },
  { route: 'DELETE ' + MOUNT + '/suppliers/:id', method: 'DELETE', url: MOUNT + '/suppliers/' + scenes.LIST_S, id: scenes.LIST_S, removes: true },
  { route: 'PATCH ' + MOUNT + '/customers/:id', method: 'PATCH', url: MOUNT + '/customers/' + scenes.LIST_C, body: { segment_override: 'regular' }, id: scenes.LIST_C },
  { route: 'PATCH ' + MOUNT + '/customers/:id (party)', method: 'PATCH', url: MOUNT + '/customers/' + scenes.LIST_C, body: { legal_name: 'Chola Auto Care Pvt' }, id: scenes.LIST_C, evidence: 'PATCH ' + MOUNT + '/customers/:id' },
  { route: 'POST ' + MOUNT + '/customers/:id/groups', method: 'POST', url: MOUNT + '/customers/' + scenes.LIST_C + '/groups', body: { groups: ['dealers'] }, id: scenes.LIST_C }
];
/** the routes addressed by an id that look it up by what they hold and answer 200 for an unknown one (the register keeps them partial on error_tests): foreign must equal unknown */
const READ_ROUTES = () => [
  { route: 'GET ' + MOUNT + '/customers/:id/rewards', method: 'GET', url: MOUNT + '/customers/' + scenes.CUSTP + '/rewards' },
  { route: 'GET ' + MOUNT + '/scorecard/:entity_id', method: 'GET', url: MOUNT + '/scorecard/' + scenes.SUPP }
];

/** one play(who, planted) of a foreign-id route: shop A holds the list row (planted) or nobody does (unknown); shop B (the stranger) or shop A (the owner) asks */
function playFor(port, item) {
  return async (who, planted) => {
    const held = planted ? scenes.ownedRow(scenes.SHOP, item.id, { supplier_list_id: scenes.LIST_S, customer_list_id: scenes.LIST_C, supplier_entity_id: scenes.SUPP, customer_identity_id: scenes.CUSTP, owner_entity_id: scenes.SHOP, identity_id: scenes.SUPP, user_id: '~shop-a.sup-0001', groups: [], legal_name: null, nickname: null, credit_days: null, credit_limit: null, credit_limit_minor: null, state_code: null, merged_into: null }) : null;
    Object.assign(world, { realAuth: false, who: who === 'owner' ? OWNER : STRANGER, asKey: false, db: 'ok', sqlRows: held, jsonThrows: false, noCustomer: false });
    const crm = require(path.join(HERE, 'lib', 'crm'));
    const kept = crm.removeParty;
    if (item.removes) crm.removeParty = async () => ({ party_id: scenes.SUPP }); /* the removal itself is the CRM's: the door in front of it is what is asked here */
    try {
      return await lab.send(port, item.method, item.url, item.body);
    } finally {
      crm.removeParty = kept;
    }
  };
}

async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign id answers exactly as an unknown id (S35) --');
  const recording = FOREIGN.recorder();
  const items = OWN_ROW_ROUTES();
  const failures = await FOREIGN.runCases(items.map((item) => ({ route: item.route, play: playFor(port, item) })), (route, held) => recording.record((items.find((item) => item.route === route) || {}).evidence || route, held));
  console.log('  foreign id: ' + (items.length - failures.length) + ' of ' + items.length + ' asks held');
  failures.forEach((sentence) => console.log('  FINDING ' + sentence));
  return { proved: recording.proved(), failures, asked: items.length };
}

/** the owner-scoped reads that answer 200 for an unknown id: another shop's id must answer byte for byte as an unknown id does (nothing of another shop's is shown) */
async function checkReadsAreScoped(port) {
  console.log('\n-- the owner-scoped reads: a foreign id answers as an unknown id --');
  const sources2 = sources();
  const held = [];
  for (const item of READ_ROUTES()) {
    const kept = [sources2.rewardStore.balance, sources2.select.rows, sources2.policy.get];
    /* the stand-in stores keep their rows by the shop that asks: shop A has points and a trade; any other shop has nothing */
    const asked = { owner: null };
    sources2.rewardStore.balance = async (owner) => { asked.owner = owner; return owner === scenes.SHOP ? { programme: { name: 'Points', expires_months: 0 }, points: 50, worth: 50, negative: false, entries: [], expired: [] } : { programme: null, points: 0, worth: 0, entries: [], expired: [], negative: false }; };
    sources2.select.rows = async (owner) => (owner === scenes.SHOP ? [{ counterparty_name: 'Corner Hardware', status: 'paid', total: 100 }] : []);
    sources2.policy.get = async () => ({ overdue_days: 30 });
    try {
      Object.assign(world, { realAuth: false, who: STRANGER, asKey: false, db: 'ok', sqlRows: null, jsonThrows: false, noCustomer: false });
      const foreignAnswer = await lab.send(port, item.method, item.url);
      const unknown = await lab.send(port, item.method, item.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, 'ffffffff-0000-4000-8000-000000000000'));
      Object.assign(world, { who: OWNER });
      const own = await lab.send(port, item.method, item.url);
      const same = FOREIGN.comparable(foreignAnswer).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID') === FOREIGN.comparable(unknown).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID');
      held.push([item.route, foreignAnswer.status, unknown.status, own.status, same]);
      check(item.route + ': another shop\'s id answers as an unknown id (' + foreignAnswer.status + ', same body) and the owner\'s own id is not the same answer', same && foreignAnswer.status === 200 && own.status === 200 && FOREIGN.comparable(own) !== FOREIGN.comparable(foreignAnswer), [foreignAnswer.status, unknown.status, own.status]);
    } finally {
      [sources2.rewardStore.balance, sources2.select.rows, sources2.policy.get] = kept;
    }
  }
  console.log('  scoped reads: ' + held.filter((item) => item[4]).length + ' of ' + held.length + ' asks held');
  return held;
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const recording = {};
  const capturing = lab.flagValue('--capture') || lab.flagValue('--compare');
  const allowed = capturing ? () => [] : contractModule().allowedStatuses();
  const scenarios = lab.scenariosOf(routes, WORLDS, extrasList());
  const tested = await lab.checkRoutes(port, scenarios, recording, allowed, sources);
  if (lab.flagValue('--capture')) {
    server.close();
    fs.writeFileSync(lab.flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  if (lab.flagValue('--compare')) {
    lab.compare(lab.flagValue('--compare'), recording);
    process.exit(0);
  }
  const foreign = await checkForeignIds(port);
  await checkReadsAreScoped(port);
  server.close();
  checkWords();
  checkCodesRegistered(contractModule());
  checkContractShape(routes);
  checkFrozen5xx(recording);
  const legacy = JSON.parse(fs.readFileSync(lab.legacyFile, 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(lab.mine).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 100, frozen);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const leaks = Object.keys(recording).filter((key) => THROWN.test(JSON.stringify(recording[key].body || {})));
  check('a thrown error\'s text is in no answer of any status, 200 included (' + Object.keys(recording).length + ' answers scanned)', leaks.length === 0, leaks);
  const thrown = Object.keys(recording).filter((key) => /library-throws|one-unreadable|view-fails|rewards-fail|scorecard-list-fails|scorecard-one-fails|supplier-party-library-says-duplicate|customers-other-state/.test(key));
  check('the scenes that throw the database\'s sentence ran (' + thrown.length + ')', thrown.length >= 8, thrown);
  check('a 2xx is never a Problem: every success answer keeps its own shape', Object.keys(recording).filter((key) => recording[key].status < 400).every((key) => !/problem\+json/.test(recording[key].type)));
  const unreadable = recording['GET /api/relationships/suppliers/availability|availability-one-unreadable'];
  check('availability: a supplier whose catalogue cannot be read is a row with state err and the one safe sentence', !!unreadable && unreadable.status === 200 && unreadable.body.results[0].state === 'err' && unreadable.body.results[0].error === 'Something went wrong — please try again.', unreadable && unreadable.body);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign.proved);
  } else {
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/relationships.js', sameValue(mine, coverage), { onDisk: Object.keys(mine).length, covered: Object.keys(coverage).length });
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign.proved), { onDisk: Object.keys(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine)).length, held: Object.keys(foreign.proved).length });
  }
  check('the foreign-id world: no id of another shop answered a 403, the record or a different body (' + foreign.failures.length + ' failures)', foreign.failures.length === 0, foreign.failures);
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
