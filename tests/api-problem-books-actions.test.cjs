#!/usr/bin/env node
// @type: contract
/**
 * api-problem-books-actions.test.cjs — API-4 sweep for the adviser maker-checker routes of ACC-176b: every answer of routes/books-actions.js (6 routes).
 *
 * OWNS      the proof that each refusal of the action routes is a Problem body AND keeps the keys it answered in (docs/contracts/api-legacy.json, frozen at this sweep's first run), that no answer says
 *           a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each route is tested for, which the register's error_tests column reads), that each route's success
 *           answers hold only the keys its closed schema lists (docs/contracts/api-hardening-evidence-areas.json, output_allowlist), and that no answer is outside the statuses lib/books-actions-contract.js declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/books-actions.js (its gates, its contract check, its answer mapper) over a stand-in db and auth; the grant front is a stand-in
 *           that reads a header, and the store (lib/books-action) answers from a stand-in per scene (the maker-checker rules themselves are tests/acc-176b-*).
 * FLOW      route list (read from the router) x world (signed out, a key, staff, a bad id, a failing db, nothing found) + the named extras (adviser or owner, ledger on or off) → real route → body →
 *           Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest · success answers → allow-list evidence
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 *   node tests/api-problem-books-actions.test.cjs                    check
 *   node tests/api-problem-books-actions.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 *   node tests/api-problem-books-actions.test.cjs --capture F        record each answer to file F
 *   node tests/api-problem-books-actions.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, sameValue, answering, SECRET_SQL } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/books-actions';
const FILE = 'routes/books-actions.js';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const ACTION_ID = '66666666-6666-4666-8666-666666666666';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_STORE = '99999999-9999-4999-8999-999999999999';
const HASH = 'abc123hash';
const ADVISER = Object.assign({}, OWNER, { acting_preset: 'adviser', display_name: 'Firm person' });
const AS_FIRM = { 'x-test-acting': 'adviser' };

/* the grant front is a stand-in: a header says the request acts for the store under a live adviser grant (the real front is tests/acc-176b-*); it is put in the require cache before the route loads */
const standIn = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
standIn('middleware/books-grant', (req, res, next) => {
  if (req.headers['x-test-acting'] === 'adviser') Object.assign(req, { acting_for_grant: GRANT_ID, acting_firm_name: 'Test firm', realIdentity: { identity_id: STAFF.identity_id, identity_type: 'actor', parent_entity_id: SHOP } });
  next();
});
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
});
const { check } = lab;
/* S36: the accept requires an Idempotency-Key, so every generic world sends one (a world that sent none would only see the 422 that asks for it) */
const KEYED = { 'idempotency-key': 'world-attempt' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true }, headers: KEYED },
  { id: 'a-key-asks', setup: { asKey: true }, headers: KEYED },
  { id: 'staff-asks', setup: { who: STAFF }, headers: KEYED },
  { id: 'bad-id', setup: {}, badId: true, headers: KEYED },
  { id: 'db-fails', setup: { db: 'fail' }, headers: KEYED },
  { id: 'nothing-found', setup: {}, headers: KEYED }
];
const refusal = (code, status, words) => Object.assign(new Error(words), { code, status, words });
const stub = (value) => async () => value;
const stubFails = (code, status, words) => async () => { throw refusal(code, status, words); };
const STAMP = { identity_id: STAFF.identity_id, name: 'Firm person', firm: 'Test firm', role: 'maker', at: '2026-11-15T10:00:00.000Z', reason: null };
/** one action as the store reads it (lib/books-action viewOf): the keys of the closed answer; the prepare adds warnings and entry, the accept adds entry */
const VIEW = (more) => Object.assign({ action_id: ACTION_ID, store: SHOP, kind: 'journal', state: 'waiting_review', client_ref: 'ref-1', body_hash: HASH, total_minor: 1000, currency: 'INR', body: { narration: 'rent' }, prepared: STAMP, reviewed: null, closed: null, grant_id: GRANT_ID, entry_id: null, access_ended: false }, more);
const POSTED = { entry_id: ENTRY_ID, entry_no: 'JV-1' };
const ON = { country: { gate: stub(undefined) }, ledger: { settingOf: stub({ enabled: true, currency: 'INR' }) } };
const OFF = { country: ON.country, ledger: { settingOf: stub({ enabled: false }) } };
const WITH = (actions) => Object.assign({}, ON, { actions });
const ADV = (patch, more) => Object.assign({ setup: { who: ADVISER }, headers: AS_FIRM, patch }, more);
let attempts = 0;
/** S36: every call of the owner is its own attempt (a fresh Idempotency-Key: the accept requires one); a scene may pass headers: {} to leave it off */
const OWN = (patch, more) => Object.assign({ setup: {}, patch, headers: { 'idempotency-key': 'attempt-' + ++attempts } }, more);
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status }, extra);
const URL_OF = (tail) => MOUNT + '/' + ACTION_ID + (tail || '');
const PREPARE = { store_id: SHOP, kind: 'journal', body: { narration: 'rent', date: '2026-11-15', lines: [] }, client_ref: 'ref-1' };
const SEEN = { store_id: SHOP, body_hash: HASH };
const WHY = Object.assign({ reason: 'wrong month' }, SEEN);
/** the store fails with the database's own words: the answer is a 500 that says nothing of its cause */
const BROKEN = async () => { throw new Error(SECRET_SQL); };
const NOT_FOUND = stubFails('NOT_FOUND', 404, 'There is no such action.');
const NOT_ON = stubFails('BOOKS_ACTION_NOT_SWITCHED_ON', 503, 'Adviser actions are not switched on yet.');
const CLOSED = stubFails('ACTION_CLOSED', 409, 'This action is already returned.');
const PAGE = stub({ actions: [VIEW()], total: 1, page: 1, limit: 25 });
const RETURNED = stub(VIEW({ state: 'returned' }));
const WARNED = [{ code: 'OUTSIDE_MONTH_BEING_WORKED', words: 'This entry is dated 2026-10-31, outside 2026-11.' }];
const R = (name) => 'POST ' + MOUNT + name;
const EXTRAS = [
  X('queue-read-by-the-firm', 'GET ' + MOUNT, 200, ADV(WITH({ listActions: PAGE }), { url: MOUNT + '?state=open&mine=true&delegated=true&since=2026-11-01' })),
  X('queue-read-by-the-owner', 'GET ' + MOUNT, 200, OWN(WITH({ listActions: PAGE }))),
  X('queue-ledger-off', 'GET ' + MOUNT, 404, OWN(OFF)),
  X('queue-not-switched-on', 'GET ' + MOUNT, 503, OWN(WITH({ listActions: NOT_ON }))),
  X('queue-state-asked-twice', 'GET ' + MOUNT, 422, OWN(ON, { url: MOUNT + '?state=open&state=returned' })),
  X('action-read', 'GET ' + MOUNT + '/:id', 200, OWN(WITH({ getAction: stub(VIEW({ steps: [{ step: 'prepared', role: 'maker', identity_id: STAFF.identity_id, name: 'Firm person', firm: 'Test firm', reason: null, at: '2026-11-15T10:00:00.000Z' }] })) }), { url: URL_OF() })),
  X('action-db-fails', 'GET ' + MOUNT + '/:id', 500, OWN(WITH({ getAction: BROKEN }), { url: URL_OF() })),
  X('prepare-db-fails', R(''), 500, ADV(WITH({ prepareAction: BROKEN }), { body: PREPARE })),
  X('review-db-fails', R('/:id/review'), 500, ADV(WITH({ reviewAction: BROKEN }), { url: URL_OF('/review'), body: SEEN })),
  X('return-db-fails', R('/:id/return'), 500, OWN(WITH({ returnAction: BROKEN }), { url: URL_OF('/return'), body: WHY })),
  X('accept-db-fails', R('/:id/accept'), 500, OWN(WITH({ acceptAction: BROKEN }), { url: URL_OF('/accept'), body: SEEN })),
  X('action-unknown', 'GET ' + MOUNT + '/:id', 404, OWN(WITH({ getAction: NOT_FOUND }), { url: URL_OF() })),
  X('action-not-switched-on', 'GET ' + MOUNT + '/:id', 503, OWN(WITH({ getAction: NOT_ON }), { url: URL_OF() })),
  X('prepare-made', R(''), 201, ADV(WITH({ prepareAction: stub(Object.assign(VIEW(), { warnings: WARNED })) }), { body: PREPARE })),
  X('prepare-posted-at-once', R(''), 201, ADV(WITH({ prepareAction: stub(Object.assign(VIEW({ state: 'accepted', entry_id: ENTRY_ID }), { entry: POSTED, warnings: [] })) }), { body: PREPARE })),
  X('prepare-by-the-owner', R(''), 403, OWN(ON, { body: PREPARE })),
  X('prepare-other-store', R(''), 409, ADV(ON, { body: Object.assign({}, PREPARE, { store_id: OTHER_STORE }) })),
  X('prepare-ledger-off', R(''), 404, ADV(OFF, { body: PREPARE })),
  X('prepare-no-reference', R(''), 422, ADV(ON, { body: { store_id: SHOP, kind: 'journal', body: {} } })),
  X('prepare-unknown-kind', R(''), 422, ADV(ON, { body: Object.assign({}, PREPARE, { kind: 'delete' }) })),
  X('prepare-unknown-key', R(''), 422, ADV(ON, { body: Object.assign({}, PREPARE, { surprise: 1 }) })),
  X('prepare-repeated-reference', R(''), 409, ADV(WITH({ prepareAction: stubFails('ACTION_REF_OPEN', 409, 'An action with this reference or this content is already waiting. Open it from the queue.') }), { body: PREPARE })),
  X('prepare-refused-in-words', R(''), 422, ADV(WITH({ prepareAction: stubFails('ACTION_KIND_INVALID', 422, 'Say what is to be done: a journal, a reversal, a lock, an unlock or a year close.') }), { body: PREPARE })),
  X('prepare-not-switched-on', R(''), 503, ADV(WITH({ prepareAction: NOT_ON }), { body: PREPARE })),
  X('prepare-unknown-entry', R(''), 404, ADV(WITH({ prepareAction: NOT_FOUND }), { body: PREPARE })),
  X('review-made', R('/:id/review'), 200, ADV(WITH({ reviewAction: stub(VIEW({ state: 'waiting_accept' })) }), { url: URL_OF('/review'), body: SEEN })),
  X('review-by-the-owner', R('/:id/review'), 403, OWN(ON, { url: URL_OF('/review'), body: SEEN })),
  X('review-other-store', R('/:id/review'), 409, ADV(ON, { url: URL_OF('/review'), body: { store_id: OTHER_STORE, body_hash: HASH } })),
  X('review-unknown-action', R('/:id/review'), 404, ADV(WITH({ reviewAction: NOT_FOUND }), { url: URL_OF('/review'), body: SEEN })),
  X('review-already-closed', R('/:id/review'), 409, ADV(WITH({ reviewAction: CLOSED }), { url: URL_OF('/review'), body: SEEN })),
  X('review-not-switched-on', R('/:id/review'), 503, ADV(WITH({ reviewAction: NOT_ON }), { url: URL_OF('/review'), body: SEEN })),
  X('review-no-hash', R('/:id/review'), 422, ADV(ON, { url: URL_OF('/review'), body: { store_id: SHOP } })),
  X('return-by-the-firm', R('/:id/return'), 200, ADV(WITH({ returnAction: RETURNED }), { url: URL_OF('/return'), body: WHY })),
  X('return-by-the-owner', R('/:id/return'), 200, OWN(WITH({ returnAction: RETURNED }), { url: URL_OF('/return'), body: WHY })),
  X('return-other-store', R('/:id/return'), 409, OWN(ON, { url: URL_OF('/return'), body: { store_id: OTHER_STORE, body_hash: HASH, reason: 'wrong month' } })),
  X('return-no-reason', R('/:id/return'), 422, OWN(ON, { url: URL_OF('/return'), body: SEEN })),
  X('return-unknown-action', R('/:id/return'), 404, OWN(WITH({ returnAction: NOT_FOUND }), { url: URL_OF('/return'), body: WHY })),
  X('return-already-closed', R('/:id/return'), 409, OWN(WITH({ returnAction: CLOSED }), { url: URL_OF('/return'), body: WHY })),
  X('return-not-switched-on', R('/:id/return'), 503, OWN(WITH({ returnAction: NOT_ON }), { url: URL_OF('/return'), body: WHY })),
  X('accept-made', R('/:id/accept'), 200, OWN(WITH({ acceptAction: stub({ action: VIEW({ state: 'accepted', entry_id: ENTRY_ID }), entry: POSTED }) }), { url: URL_OF('/accept'), body: Object.assign({ total_minor: 1000, currency: 'INR' }, SEEN) })),
  X('accept-by-the-firm', R('/:id/accept'), 403, ADV(ON, { url: URL_OF('/accept'), body: SEEN })),
  X('accept-other-store', R('/:id/accept'), 409, OWN(ON, { url: URL_OF('/accept'), body: { store_id: OTHER_STORE, body_hash: HASH } })),
  X('accept-ledger-off', R('/:id/accept'), 404, OWN(OFF, { url: URL_OF('/accept'), body: SEEN })),
  X('accept-unknown-action', R('/:id/accept'), 404, OWN(WITH({ acceptAction: NOT_FOUND }), { url: URL_OF('/accept'), body: SEEN })),
  X('accept-total-differs', R('/:id/accept'), 409, OWN(WITH({ acceptAction: stubFails('PREVIEW_TOTAL_DIFFERS', 409, 'The total changed since it was prepared. Nothing was posted.') }), { url: URL_OF('/accept'), body: SEEN })),
  X('accept-total-not-confirmed', R('/:id/accept'), 422, OWN(WITH({ acceptAction: stubFails('ACTION_TOTAL_NEEDED', 422, 'Confirm the total and its currency as shown on the screen.') }), { url: URL_OF('/accept'), body: SEEN })),
  X('accept-not-switched-on', R('/:id/accept'), 503, OWN(WITH({ acceptAction: NOT_ON }), { url: URL_OF('/accept'), body: SEEN })),
  X('accept-key-required', R('/:id/accept'), 422, OWN(ON, { url: URL_OF('/accept'), body: SEEN, headers: {} })),
  X('accept-unknown-key', R('/:id/accept'), 422, OWN(ON, { url: URL_OF('/accept'), body: Object.assign({ surprise: 1 }, SEEN) }))
];

/* ── the foreign-id world (API-STANDARD S35): shop B asks for shop A's action by its id; the real lib/books-action reads, the stand-in db answers a step only to the store that owns it (as RLS and WHERE store = $1 do) ── */
const STRANGER_ID = '12121212-1212-4212-8212-121212121212';
const STRANGER = Object.assign({}, OWNER, { identity_id: STRANGER_ID, display_name: 'Shop B' });
const STEP = { step_id: 1, action_id: ACTION_ID, store: SHOP, step: 'prepared', kind: 'lock', body: { fy: '2026-27', period: 8, reason: 'month done' }, body_hash: HASH, total_minor: null, currency: null, action_ref: 'ref-1', actor_identity_id: STAFF.identity_id, actor_name: 'Firm person', firm_name: 'Test firm', role: 'maker', reason: null, grant_id: GRANT_ID, entry_id: null, at: '2026-11-15T10:00:00.000Z' };
const TABLE_THERE = answering(/information_schema\.tables/, [{ '?column?': 1 }]);
/** the rows of the stand-in db: the table is there; the action's steps only for the store that owns them, and only when the scene has planted them */
const rowsOf = (planted) => (sql, params) => TABLE_THERE(sql) || (planted && /FROM books_action_step WHERE store = \$1 AND action_id/.test(sql) && String(params[0]) === SHOP ? { rows: [STEP], rowCount: 1 } : null);
const FOREIGN_ROUTES = [
  { route: 'GET ' + MOUNT + '/:id', method: 'GET', url: URL_OF(), firm: false },
  { route: 'POST ' + MOUNT + '/:id/review', method: 'POST', url: URL_OF('/review'), firm: true, body: { body_hash: HASH } },
  { route: 'POST ' + MOUNT + '/:id/return', method: 'POST', url: URL_OF('/return'), firm: false, body: { body_hash: HASH, reason: 'wrong month' } },
  { route: 'POST ' + MOUNT + '/:id/accept', method: 'POST', url: URL_OF('/accept'), firm: false, body: { body_hash: HASH } }
];
/** one play(who, planted): shop B (the stranger) or shop A (the owner) asks; the action is planted for the asking only when `planted` */
const playFor = (port, item, modules) => async (who, planted) => {
  const store = who === 'owner' ? SHOP : STRANGER_ID;
  const identity = who === 'owner' ? OWNER : STRANGER;
  Object.assign(lab.world, { realAuth: false, who: item.firm ? Object.assign({}, identity, { acting_preset: 'adviser' }) : identity, asKey: false, db: 'ok', sqlRows: rowsOf(planted), jsonThrows: false, noCustomer: false });
  const undo = Object.keys(ON).map((name) => Object.keys(ON[name]).map((fn) => { const held = [modules()[name], fn, modules()[name][fn]]; modules()[name][fn] = ON[name][fn]; return held; })).flat();
  const answer = await lab.send(port, item.method, item.url, item.body && Object.assign({ store_id: store }, item.body), undefined, item.firm ? AS_FIRM : item.route.endsWith('/accept') ? { 'idempotency-key': 'foreign-' + ++attempts } : undefined);
  undo.forEach(([owner, fn, original]) => (owner[fn] = original));
  return answer;
};
async function checkForeignIds(port, modules) {
  console.log('\n-- signed in as another shop: a foreign action id answers exactly as an unknown one (S35) --');
  const recording = FOREIGN.recorder();
  const failures = await FOREIGN.runCases(FOREIGN_ROUTES.map((item) => ({ route: item.route, play: playFor(port, item, modules) })), recording.record);
  check('another shop\'s action id is answered exactly as an unknown one, a 404, on the ' + FOREIGN_ROUTES.length + ' routes that name an action (' + (FOREIGN_ROUTES.length - failures.length) + ' held)', failures.length === 0, failures);
  return recording.proved();
}

/** the contract as a unit: every route has an operation and every operation a route; every refusal an operation declares is a Problem */
function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'books-actions-contract.js'));
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  const refusalsAreProblems = Object.values(contract.OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('problem')));
  check('every refusal an operation declares is a Problem', refusalsAreProblems);
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
  const router = require(path.join(HERE, FILE));
  const modules = () => ({ actions: require(path.join(HERE, 'lib', 'books-action.js')), country: require(path.join(HERE, 'lib', 'country-setup.js')), ledger: require(path.join(HERE, 'lib', 'books.js')) });
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const capturing = lab.flagValue('--capture');
  const contract = require(path.join(HERE, 'lib', 'books-actions-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const allowed = capturing ? () => [] : (route) => allowedBy[route] || [];
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { id: ACTION_ID });
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, allowed, modules);
  if (capturing) server.close();
  if (capturing) {
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  const foreign = await checkForeignIds(server.address().port, modules);
  checkContract(routes);
  checkCodesRegistered(recording);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a key is refused with 403 SIGN_IN_FOR_LEDGER on every route', Object.keys(recording).filter((key) => key.endsWith('|a-key-asks')).every((key) => recording[key].status === 403 && recording[key].body && recording[key].body.code === 'SIGN_IN_FOR_LEDGER'));
  check('a co-assist is refused with 403 on every route (only the owner and the firm work on these actions)', Object.keys(recording).filter((key) => key.endsWith('|staff-asks')).every((key) => recording[key].status === 403));
  /* S34: the success answers hold only the keys their closed schema lists */
  const proved = allowlistWorld.checkAllowList(recording, contract.OPERATIONS, check);
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    allowlistWorld.writeEvidence(EVIDENCE_FILE, lab.mine, proved);
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the action routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign), { held: Object.keys(foreign) });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/books-actions.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the action routes whose success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
