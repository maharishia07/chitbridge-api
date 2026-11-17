#!/usr/bin/env node
// @type: contract
/**
 * api-problem-flags.test.cjs — API-4 sweep for PRIVATE BOOKMARKS AND NOTES: every answer of routes/flags.js (11 routes).
 *
 * OWNS      the proof that each refusal of the flags routes is a Problem body, that no answer says a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each route is
 *           tested for, which the register's error_tests column reads), that every success answer holds only the keys its closed schema lists (S34, docs/contracts/api-hardening-evidence-areas.json),
 *           that another shop's flag id answers exactly as an unknown one on the six routes that name a flag (S35), and that no answer is outside the statuses lib/flags-contract.js declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/flags.js AND the real lib/private-flag over a stand-in db and auth. The success answers are therefore what the code really sends,
 *           not a fixture's idea of it; the stand-in db answers a flag row only to the organisation that owns it (as RLS and `WHERE entity_id = $2` do), so a foreign id reads nothing.
 * FLOW      route list x world (signed out, a key, staff, a bad id, a failing db, nothing found) + the named extras → real route → real core → body → Problem fields present · no leak on a 5xx · statuses tested → manifest
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
 *
 *   node tests/api-problem-flags.test.cjs            check
 *   node tests/api-problem-flags.test.cjs --write    rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, sameValue, answering, firstOf } = require('./lib/problem-world.cjs');
const allowlistWorld = require('./lib/allowlist-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/flags';
const FILE = 'routes/flags.js';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const ENTRY = '77777777-7777-4777-8777-777777777777';
const THREAD = '66666666-6666-4666-8666-666666666666';
const OTHER_CLIENT = '99999999-9999-4999-8999-999999999999';
const FLAG_ID = '7';

const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  added: () => true, /* a new route: no refusal was ever frozen, there is no older shape to keep */
  notFrozen: () => true
});
const { check } = lab;
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'a-key-asks', setup: { asKey: true } },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } },
  { id: 'nothing-found', setup: {} }
];

/** a flag row as the table returns it (lib/private-flag COLUMNS and the thread id): the owner's own note on its own books */
const ROW = (more) => Object.assign({
  flag_id: FLAG_ID, kind: 'note', visibility: 'org', subject_kind: 'posting', subject_entity: SHOP, subject_id: ENTRY, label: 'MJ/1', note: 'Why?', state: 'open', seat: 'business',
  author_name: 'Test shop', author_id: SHOP, created_at: new Date('2026-11-17T10:00:00Z'), resolved_name: null, resolved_at: null, removed_name: null, removed_at: null, thread_id: THREAD
}, more);
const MESSAGE_ROW = { message_id: '88888888-8888-4888-8888-888888888888', sender_display_name: 'Test shop', message_text: 'hi', created_at: new Date('2026-11-17T10:05:00Z'), mine: true };

/**
 * the stand-in table: `mode` = which flag row the organisation holds ('none' | the row); a statement answers only when the organisation id it names is the row's owner (RLS and the WHERE entity_id of the code).
 * Statements are told apart by their text, the way tests/api-problem-marks.test.cjs does.
 */
const tableOf = (held) => (sql, params) => {
  const mine = params.some((value) => String(value) === SHOP);
  if (!/private_flag|chit_messages/i.test(sql)) return null;
  if (/FROM chit_messages/.test(sql)) return mine && held.thread ? { rows: [MESSAGE_ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/count\(\*\)::int AS n FROM private_flag/.test(sql)) return { rows: [{ n: mine && held.row ? 1 : 0 }], rowCount: 1 };
  if (/SELECT kind, count/.test(sql)) return { rows: mine && held.row ? [{ kind: held.row.kind, n: 1 }] : [], rowCount: mine && held.row ? 1 : 0 };
  if (/^\s*INSERT INTO private_flag/i.test(sql)) return { rows: [ROW({ kind: params[1], visibility: params[2], note: params[5] })], rowCount: 1 };
  if (/^\s*UPDATE private_flag/i.test(sql) && /kind = 'bookmark'/.test(sql)) return { rows: [], rowCount: mine && held.row ? 1 : 0 };
  if (/^\s*UPDATE private_flag/i.test(sql)) return held.row ? { rows: [ROW(Object.assign({}, held.row, /state = 'resolved'/.test(sql) ? { state: 'resolved' } : /state = 'removed'/.test(sql) ? { state: 'removed', note: null } : /state = 'open'/.test(sql) ? { state: 'open' } : /visibility = 'org'/.test(sql) ? { visibility: 'org' } : {}))], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/FROM private_flag/.test(sql)) return mine && held.row ? { rows: [held.row], rowCount: 1 } : { rows: [], rowCount: 0 };
  return null;
};
const held = { row: ROW(), thread: true };
const FLAG_TABLE = (row, thread) => (sql, params) => {
  held.row = row === undefined ? ROW() : row;
  held.thread = thread !== false;
  return tableOf(held)(sql, params);
};
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status }, extra);
const R = (method, name) => method + ' ' + MOUNT + name;
const ON = (row, thread) => ({ sqlRows: FLAG_TABLE(row, thread) });
const NOT_ON = { patch: { schema: { hasTable: async () => false } }, setup: { sqlRows: FLAG_TABLE() } };
const NO_REPLIES = { patch: { schema: { checkAllows: async () => false } }, setup: { sqlRows: FLAG_TABLE() } };
const URL = (tail) => MOUNT + '/' + FLAG_ID + (tail || '');
const ADD = { kind: 'bookmark', subject_kind: 'posting', subject_entity: SHOP, items: [{ id: ENTRY, label: 'MJ/1' }] };
const NOTE = { kind: 'note', subject_kind: 'posting', subject_entity: SHOP, items: [{ id: ENTRY, label: 'MJ/1' }], note: 'Why?' };
const QUERY = { subject_kind: 'posting', subject_entity: SHOP, ids: [ENTRY] };
const OWN = (setup, more) => Object.assign({ setup }, more);
const EXTRAS = [
  X('query-db-fails', R('POST', '/query'), 500, OWN({ db: 'fail' }, { body: QUERY })),
  X('add-db-fails', R('POST', ''), 500, OWN({ db: 'fail' }, { body: ADD })),
  X('reply-db-fails', R('POST', '/:id/messages'), 500, OWN({ db: 'fail' }, { url: URL('/messages'), body: { message_text: 'hi' } })),
  X('clear-db-fails', R('POST', '/clear'), 500, OWN({ db: 'fail' }, { body: { subject_entity: SHOP } })),
  X('query-read', R('POST', '/query'), 200, OWN(ON(), { body: QUERY })),
  X('query-no-ids', R('POST', '/query'), 422, OWN(ON(), { body: Object.assign({}, QUERY, { ids: [] }) })),
  X('query-unknown-kind', R('POST', '/query'), 422, OWN(ON(), { body: Object.assign({}, QUERY, { subject_kind: 'no.such' }) })),
  X('query-unknown-key', R('POST', '/query'), 422, OWN(ON(), { body: Object.assign({}, QUERY, { surprise: 1 }) })),
  X('query-a-client-with-no-access', R('POST', '/query'), 404, OWN(ON(), { body: Object.assign({}, QUERY, { subject_kind: 'client', subject_entity: OTHER_CLIENT, ids: [OTHER_CLIENT] }) })),
  X('query-not-switched-on', R('POST', '/query'), 503, Object.assign({ body: QUERY }, NOT_ON)),
  X('list-read', R('GET', ''), 200, OWN(ON())),
  X('list-bad-kind', R('GET', ''), 422, OWN(ON(), { url: MOUNT + '?kind=nope' })),
  X('list-a-client-that-is-no-uuid', R('GET', ''), 404, OWN(ON(), { url: MOUNT + '?subject_entity=nope' })),
  X('list-not-switched-on', R('GET', ''), 503, NOT_ON),
  X('counts-read', R('GET', '/counts'), 200, OWN(ON())),
  X('counts-not-switched-on', R('GET', '/counts'), 503, NOT_ON),
  X('add-bookmark', R('POST', ''), 201, OWN(ON(), { body: ADD })),
  X('add-note', R('POST', ''), 201, OWN(ON(), { body: NOTE })),
  X('add-no-items', R('POST', ''), 422, OWN(ON(), { body: Object.assign({}, ADD, { items: [] }) })),
  X('add-a-note-without-words', R('POST', ''), 422, OWN(ON(), { body: Object.assign({}, NOTE, { note: ' ' }) })),
  X('add-unknown-key', R('POST', ''), 422, OWN(ON(), { body: Object.assign({}, ADD, { surprise: 1 }) })),
  X('add-for-a-client-with-no-access', R('POST', ''), 404, OWN(ON(), { body: Object.assign({}, ADD, { subject_kind: 'client', subject_entity: OTHER_CLIENT, items: [{ id: OTHER_CLIENT, label: 'Client' }] }) })),
  X('add-not-switched-on', R('POST', ''), 503, Object.assign({ body: ADD }, NOT_ON)),
  X('resolve-made', R('POST', '/:id/resolve'), 200, OWN(ON(), { url: URL('/resolve') })),
  X('resolve-already', R('POST', '/:id/resolve'), 200, OWN(ON(ROW({ state: 'resolved' })), { url: URL('/resolve') })),
  X('resolve-a-removed-note', R('POST', '/:id/resolve'), 409, OWN(ON(ROW({ state: 'removed' })), { url: URL('/resolve') })),
  X('resolve-a-bookmark', R('POST', '/:id/resolve'), 409, OWN(ON(ROW({ kind: 'bookmark' })), { url: URL('/resolve') })),
  X('resolve-with-a-body-it-does-not-read', R('POST', '/:id/resolve'), 422, OWN(ON(), { url: URL('/resolve'), body: { surprise: 1 } })),
  X('resolve-not-switched-on', R('POST', '/:id/resolve'), 503, Object.assign({ url: URL('/resolve') }, NOT_ON)),
  X('reopen-made', R('POST', '/:id/reopen'), 200, OWN(ON(ROW({ state: 'resolved' })), { url: URL('/reopen') })),
  X('reopen-already-open', R('POST', '/:id/reopen'), 200, OWN(ON(), { url: URL('/reopen') })),
  X('reopen-a-removed-note', R('POST', '/:id/reopen'), 409, OWN(ON(ROW({ state: 'removed' })), { url: URL('/reopen') })),
  X('reopen-with-a-body-it-does-not-read', R('POST', '/:id/reopen'), 422, OWN(ON(), { url: URL('/reopen'), body: { surprise: 1 } })),
  X('reopen-not-switched-on', R('POST', '/:id/reopen'), 503, Object.assign({ url: URL('/reopen') }, NOT_ON)),
  X('share-made', R('POST', '/:id/share'), 200, OWN(ON(ROW({ visibility: 'me' })), { url: URL('/share') })),
  X('share-already-shared', R('POST', '/:id/share'), 200, OWN(ON(), { url: URL('/share') })),
  X('share-a-removed-note', R('POST', '/:id/share'), 409, OWN(ON(ROW({ state: 'removed' })), { url: URL('/share') })),
  X('share-with-a-body-it-does-not-read', R('POST', '/:id/share'), 422, OWN(ON(), { url: URL('/share'), body: { surprise: 1 } })),
  X('share-not-switched-on', R('POST', '/:id/share'), 503, Object.assign({ url: URL('/share') }, NOT_ON)),
  X('remove-made', R('POST', '/:id/remove'), 200, OWN(ON(), { url: URL('/remove') })),
  X('remove-already-removed', R('POST', '/:id/remove'), 409, OWN(ON(ROW({ state: 'removed' })), { url: URL('/remove') })),
  X('remove-with-a-body-it-does-not-read', R('POST', '/:id/remove'), 422, OWN(ON(), { url: URL('/remove'), body: { surprise: 1 } })),
  X('remove-not-switched-on', R('POST', '/:id/remove'), 503, Object.assign({ url: URL('/remove') }, NOT_ON)),
  X('thread-read', R('GET', '/:id/messages'), 200, OWN(ON(), { url: URL('/messages') })),
  X('thread-of-a-removed-note', R('GET', '/:id/messages'), 200, OWN(ON(ROW({ state: 'removed' })), { url: URL('/messages') })),
  X('thread-not-switched-on', R('GET', '/:id/messages'), 503, Object.assign({ url: URL('/messages') }, NOT_ON)),
  X('reply-made', R('POST', '/:id/messages'), 201, OWN(ON(), { url: URL('/messages'), body: { message_text: 'hi' } })),
  X('reply-on-an-only-me-note', R('POST', '/:id/messages'), 409, OWN(ON(ROW({ visibility: 'me' })), { url: URL('/messages'), body: { message_text: 'hi' } })),
  X('reply-on-an-unknown-note', R('POST', '/:id/messages'), 404, OWN(ON(null), { url: URL('/messages'), body: { message_text: 'hi' } })),
  X('reply-no-words', R('POST', '/:id/messages'), 422, OWN(ON(), { url: URL('/messages'), body: { message_text: ' ' } })),
  X('reply-unknown-key', R('POST', '/:id/messages'), 422, OWN(ON(), { url: URL('/messages'), body: { message_text: 'hi', surprise: 1 } })),
  X('reply-not-switched-on', R('POST', '/:id/messages'), 503, Object.assign({ url: URL('/messages'), body: { message_text: 'hi' } }, NO_REPLIES)),
  X('clear-made', R('POST', '/clear'), 200, OWN(ON(ROW({ kind: 'bookmark' })), { body: { subject_entity: SHOP } })),
  X('clear-a-period', R('POST', '/clear'), 200, OWN(ON(ROW({ kind: 'bookmark' })), { body: { subject_entity: SHOP, from: '2026-11-01', to: '2026-11-17' } })),
  X('clear-bad-period', R('POST', '/clear'), 422, OWN(ON(), { body: { subject_entity: SHOP, from: 'yesterday' } })),
  X('clear-unknown-key', R('POST', '/clear'), 422, OWN(ON(), { body: { subject_entity: SHOP, surprise: 1 } })),
  X('clear-a-client-that-is-no-uuid', R('POST', '/clear'), 404, OWN(ON(), { body: { subject_entity: 'nope' } })),
  X('clear-not-switched-on', R('POST', '/clear'), 503, Object.assign({ body: { subject_entity: SHOP } }, NOT_ON))
];

/* ── the foreign-id world (S35): shop B asks for shop A's flag by its id; the REAL core reads, the stand-in db answers a flag only to the organisation that owns it ── */
const STRANGER_ID = '12121212-1212-4212-8212-121212121212';
const STRANGER = Object.assign({}, OWNER, { identity_id: STRANGER_ID, display_name: 'Shop B' });
const FOREIGN_ROUTES = [
  { route: R('POST', '/:id/resolve'), method: 'POST', url: URL('/resolve') },
  { route: R('POST', '/:id/reopen'), method: 'POST', url: URL('/reopen'), row: ROW({ state: 'resolved' }) },
  { route: R('POST', '/:id/share'), method: 'POST', url: URL('/share'), row: ROW({ visibility: 'me' }) },
  { route: R('POST', '/:id/remove'), method: 'POST', url: URL('/remove') },
  { route: R('GET', '/:id/messages'), method: 'GET', url: URL('/messages') },
  { route: R('POST', '/:id/messages'), method: 'POST', url: URL('/messages'), body: { message_text: 'hi' } }
];
const playFor = (port, item) => async (who, planted) => {
  const identity = who === 'owner' ? OWNER : STRANGER;
  Object.assign(lab.world, { realAuth: false, who: identity, asKey: false, db: 'ok', sqlRows: planted ? FLAG_TABLE(item.row || ROW()) : FLAG_TABLE(null), jsonThrows: false, noCustomer: false });
  return lab.send(port, item.method, item.url, item.body);
};
async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign flag id answers exactly as an unknown one (S35) --');
  const recording = FOREIGN.recorder();
  const failures = await FOREIGN.runCases(FOREIGN_ROUTES.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  check("another shop's flag id is answered exactly as an unknown one, a 404, on the " + FOREIGN_ROUTES.length + ' routes that name a flag (' + (FOREIGN_ROUTES.length - failures.length) + ' held)', failures.length === 0, failures);
  return recording.proved();
}

function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'flags-contract.js'));
  const operations = Object.keys(contract.OPERATIONS);
  check('every route the router holds has an operation, and every operation a route (' + operations.length + ')', sameValue(operations.slice().sort(), Object.keys(routes).sort()), operations.filter((key) => !routes[key]));
  check('every refusal an operation declares is a Problem', Object.values(contract.OPERATIONS).every((operation) => Object.keys(operation.responses).filter((status) => Number(status) >= 400).every((status) => JSON.stringify(operation.responses[status]).includes('problem'))));
}
function checkCodesRegistered(recording) {
  console.log('\n-- the codes these routes answer under are in the register --');
  const known = new Set(JSON.parse(fs.readFileSync(REGISTER_FILE, 'utf8')).codes.filter((row) => row.shopkeeper !== 'PENDING').map((row) => row.code));
  const seen = [...new Set(Object.values(recording).filter((one) => one.status >= 400 && one.body && one.body.code).map((one) => one.body.code))].sort();
  check('every code seen in a refusal (' + seen.length + ': ' + seen.join(' ') + ') is a register row with its sentence written', seen.length > 0 && seen.every((code) => known.has(code)), seen.filter((code) => !known.has(code)));
}

(async () => {
  if (lab.flagValue('--freeze')) return lab.freeze(lab.flagValue('--freeze'));
  lab.installStubs();
  const schema = require(path.join(HERE, 'lib', 'schema.js'));
  schema.hasTable = async () => true; /* the migration is run in this world; a scenario names the one where it is not */
  schema.checkAllows = async () => true;
  const router = require(path.join(HERE, FILE));
  const modules = () => ({ schema });
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const contract = require(path.join(HERE, 'lib', 'flags-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { id: FLAG_ID });
  const capturing = lab.flagValue('--capture');
  const tested = await lab.checkRoutes(server.address().port, scenarios, recording, capturing ? () => [] : (route) => allowedBy[route] || [], modules);
  if (capturing) {
    server.close();
    fs.writeFileSync(capturing, JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  const foreign = await checkForeignIds(server.address().port);
  checkContract(routes);
  checkCodesRegistered(recording);
  check('a caller who is not signed in is refused with 401 on every route', Object.keys(recording).filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  check('a key is refused with 403 SIGN_IN_FOR_FLAGS on every route', Object.keys(recording).filter((key) => key.endsWith('|a-key-asks')).every((key) => recording[key].status === 403 && recording[key].body && recording[key].body.code === 'SIGN_IN_FOR_FLAGS'));
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
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign), { held: Object.keys(foreign) });
    check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the routes whose success answers held here', sameValue(allowlistWorld.evidenceOf(EVIDENCE_FILE, lab.mine), proved), { proved: Object.keys(proved) });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/flags.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  server.close();
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
