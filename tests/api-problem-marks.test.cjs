#!/usr/bin/env node
// @type: contract
/**
 * api-problem-marks.test.cjs — API-4 sweep for MARK & QUERY: every answer of routes/marks.js (5 routes).
 *
 * OWNS      the proof that each refusal of the marks routes is a Problem body, that no answer says a failure's cause, this file's rows of docs/contracts/api-error-tests.json (the statuses each route is
 *           tested for, which the register's error_tests column reads), that a foreign thread id answers exactly as an unknown one (S35, docs/contracts/api-hardening-evidence-areas.json), and that no
 *           answer is outside the statuses lib/marks-contract.js declares.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/marks.js (its gates, its contract check, its answer mapper) over a stand-in db and auth; the grant front is a pass-through
 *           (the real front and the DB are tests/review-mark.realstack.cjs), and the core (lib/review-mark) answers from a stand-in per scene except in the foreign-id world, where the real core reads a stand-in db.
 * FLOW      route list x world (signed out, a key, staff, a bad id, a failing db, nothing found) + the named extras → real route → body → Problem fields present · no leak on a 5xx · statuses tested → manifest
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 *
 *   node tests/api-problem-marks.test.cjs            check
 *   node tests/api-problem-marks.test.cjs --write    rewrite this file's rows of docs/contracts/api-error-tests.json and api-hardening-evidence-areas.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, OWNER, STAFF, SHOP, sameValue, answering, SECRET_SQL } = require('./lib/problem-world.cjs');
const FOREIGN = require('./lib/foreign-id-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const MOUNT = '/api/marks';
const FILE = 'routes/marks.js';
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json');
const REGISTER_FILE = path.join(HERE, 'docs', 'error-codes.json');
const THREAD = '66666666-6666-4666-8666-666666666666';
const ENTRY = '77777777-7777-4777-8777-777777777777';
const AD = 'acc.audit';

const standIn = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
/* the grant front is a pass-through here (the real one, and the write door, are tests/review-mark.realstack.cjs and tests/mark-offline.test.cjs) */
standIn('middleware/books-grant', Object.assign((req, res, next) => next(), { unclassifiedWrites: () => [], MARK_READ_DOORS: new Set(), MARK_WRITE_DOORS: new Set() }));
const lab = harness({
  here: HERE,
  mounts: [MOUNT],
  routeFiles: { [MOUNT]: FILE },
  legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'),
  inherited: (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out',
  notFrozen: (one, scenario) => one.status === 401 && scenario === 'signed-out'
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
const refusal = (code, status, words) => Object.assign(new Error(words), { code, status, words });
const stub = (value) => async () => value;
const stubFails = (code, status, words) => async () => { throw refusal(code, status, words); };
const BROKEN = async () => { throw new Error(SECRET_SQL); };
const ACTIONS = { set: { ok: true, why: null }, reply: { ok: true, why: null } };
const MARK = { mark_id: '1', adopter: AD, subject_id: ENTRY, thread_id: THREAD, kind: 'query', class: 'open', label: 'Query', note: 'Why?', at: '2026-11-15T10:00:00.000Z', by_name: 'A', by_firm: 'Firm', open: true, open_since: '2026-11-15T10:00:00.000Z', age_days: 0, altered: false, altered_by: null, recheck_needed: false, message_count: 0, actions: ACTIONS };
const MESSAGE = { message_id: '88888888-8888-4888-8888-888888888888', sender_display_name: 'A', message_text: 'hi', msg_type: 'info', created_at: '2026-11-15T10:00:00.000Z', mine: true };
const ON = { core: { marksFor: stub({ marks: { [ENTRY]: MARK }, not_found: [] }), openList: stub({ open: [Object.assign({ subject_label: 'MJ/1', posting_date: '2026-11-15' }, MARK)], total_open: 1, oldest_age_days: 0, checked: 1, of: 3 }), set: stub({ mark: MARK, unchanged: false }), threadOf: stub({ thread_id: THREAD, adopter: AD, subject_id: ENTRY, subject_label: 'MJ/1', mark: MARK, history: [{ mark_id: '1', kind: 'query', class: 'open', label: 'Query', note: 'Why?', at: '2026-11-15T10:00:00.000Z', by_name: 'A', by_firm: null, seal_changed_before: false }], messages: [MESSAGE], actions: ACTIONS }), reply: stub({ message: MESSAGE, mark: MARK }) } };
const WITH = (core) => ({ core: Object.assign({}, ON.core, core) });
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status }, extra);
const OWN = (patch, more) => Object.assign({ setup: {}, patch }, more);
const R = (method, name) => method + ' ' + MOUNT + name;
const THREAD_URL = (tail) => MOUNT + '/' + THREAD + '/messages' + (tail || '');
const NOT_ON = stubFails('MARK_NOT_SWITCHED_ON', 503, 'Marking and queries are not switched on yet.');
const NOT_FOUND = stubFails('MARK_THREAD_NOT_FOUND', 404, 'We could not find that question.');
const SET = { adopter: AD, subject_id: ENTRY, kind: 'query', note: 'Why?' };
const EXTRAS = [
  X('list-by-ids', R('GET', ''), 200, OWN(ON, { url: MOUNT + '?adopter=' + AD + '&ids=' + ENTRY })),
  X('list-open', R('GET', ''), 200, OWN(ON, { url: MOUNT + '?adopter=' + AD + '&open=1&from=2026-11-01&to=2026-11-15' })),
  X('list-unknown-adopter', R('GET', ''), 422, OWN(ON, { url: MOUNT + '?adopter=no.such&ids=' + ENTRY })),
  X('list-too-many', R('GET', ''), 422, OWN(WITH({ marksFor: stubFails('MARK_IDS_TOO_MANY', 422, 'Ask for 200 records at a time or fewer.') }), { url: MOUNT + '?adopter=' + AD + '&ids=' + Array(201).fill(ENTRY).join(',') })),
  X('list-bad-period', R('GET', ''), 422, OWN(ON, { url: MOUNT + '?adopter=' + AD + '&open=1&from=yesterday' })),
  X('list-not-switched-on', R('GET', ''), 503, OWN(WITH({ marksFor: NOT_ON }), { url: MOUNT + '?adopter=' + AD + '&ids=' + ENTRY })),
  X('list-db-fails', R('GET', ''), 500, OWN(WITH({ marksFor: BROKEN }), { url: MOUNT + '?adopter=' + AD + '&ids=' + ENTRY })),
  X('query-by-body', R('POST', '/query'), 200, OWN(ON, { body: { adopter: AD, ids: [ENTRY] } })),
  X('query-unknown-adopter', R('POST', '/query'), 422, OWN(ON, { body: { adopter: 'no.such', ids: [ENTRY] } })),
  X('query-unknown-key', R('POST', '/query'), 422, OWN(ON, { body: { adopter: AD, ids: [ENTRY], surprise: 1 } })),
  X('query-not-switched-on', R('POST', '/query'), 503, OWN(WITH({ marksFor: NOT_ON }), { body: { adopter: AD, ids: [ENTRY] } })),
  X('query-db-fails', R('POST', '/query'), 500, OWN(WITH({ marksFor: BROKEN }), { body: { adopter: AD, ids: [ENTRY] } })),
  X('set-made', R('POST', ''), 201, OWN(ON, { body: SET })),
  X('set-unchanged', R('POST', ''), 200, OWN(WITH({ set: stub({ mark: MARK, unchanged: true }) }), { body: SET })),
  X('set-by-the-owner', R('POST', ''), 403, OWN(WITH({ set: stubFails('MARK_NOT_ALLOWED', 403, 'Only the auditor can mark an entry. You can read the marks and answer a query.') }), { body: SET })),
  X('set-unknown-entry', R('POST', ''), 404, OWN(WITH({ set: stubFails('MARK_SUBJECT_NOT_FOUND', 404, 'We could not find that entry in these books.') }), { body: SET })),
  X('set-no-words', R('POST', ''), 422, OWN(WITH({ set: stubFails('MARK_WORDS_REQUIRED', 422, 'Write the question first. The owner will read it.') }), { body: Object.assign({}, SET, { note: '' }) })),
  X('set-unknown-adopter', R('POST', ''), 422, OWN(ON, { body: Object.assign({}, SET, { adopter: 'no.such' }) })),
  X('set-unknown-key', R('POST', ''), 422, OWN(ON, { body: Object.assign({}, SET, { surprise: 1 }) })),
  X('set-not-switched-on', R('POST', ''), 503, OWN(WITH({ set: NOT_ON }), { body: SET })),
  X('set-db-fails', R('POST', ''), 500, OWN(WITH({ set: BROKEN }), { body: SET })),
  X('thread-read', R('GET', '/:thread_id/messages'), 200, OWN(ON, { url: THREAD_URL() })),
  X('thread-unknown', R('GET', '/:thread_id/messages'), 404, OWN(WITH({ threadOf: NOT_FOUND }), { url: THREAD_URL() })),
  X('thread-not-switched-on', R('GET', '/:thread_id/messages'), 503, OWN(WITH({ threadOf: NOT_ON }), { url: THREAD_URL() })),
  X('thread-db-fails', R('GET', '/:thread_id/messages'), 500, OWN(WITH({ threadOf: BROKEN }), { url: THREAD_URL() })),
  X('reply-made', R('POST', '/:thread_id/messages'), 201, OWN(ON, { url: THREAD_URL(), body: { message_text: 'hi' } })),
  X('reply-not-allowed', R('POST', '/:thread_id/messages'), 403, OWN(WITH({ reply: stubFails('MARK_REPLY_NOT_ALLOWED', 403, 'Only the owner, the adviser and the auditor take part in a query.') }), { url: THREAD_URL(), body: { message_text: 'hi' } })),
  X('reply-unknown-thread', R('POST', '/:thread_id/messages'), 404, OWN(WITH({ reply: NOT_FOUND }), { url: THREAD_URL(), body: { message_text: 'hi' } })),
  X('reply-closed', R('POST', '/:thread_id/messages'), 409, OWN(WITH({ reply: stubFails('MARK_THREAD_CLOSED', 409, 'This query is closed.') }), { url: THREAD_URL(), body: { message_text: 'hi' } })),
  X('reply-no-words', R('POST', '/:thread_id/messages'), 422, OWN(ON, { url: THREAD_URL(), body: {} })),
  X('reply-unknown-key', R('POST', '/:thread_id/messages'), 422, OWN(ON, { url: THREAD_URL(), body: { message_text: 'hi', surprise: 1 } })),
  X('reply-not-switched-on', R('POST', '/:thread_id/messages'), 503, OWN(WITH({ reply: NOT_ON }), { url: THREAD_URL(), body: { message_text: 'hi' } })),
  X('reply-db-fails', R('POST', '/:thread_id/messages'), 500, OWN(WITH({ reply: BROKEN }), { url: THREAD_URL(), body: { message_text: 'hi' } }))
];

/* ── the foreign-id world (S35): shop B asks for shop A's thread by its id; the REAL core reads, the stand-in db answers a thread only to the entity that owns it (as RLS and WHERE entity_id = $2 do) ── */
const STRANGER_ID = '12121212-1212-4212-8212-121212121212';
const STRANGER = Object.assign({}, OWNER, { identity_id: STRANGER_ID, display_name: 'Shop B' });
const ROW = { mark_id: 1, entity_id: SHOP, adopter: AD, subject_id: ENTRY, thread_id: THREAD, kind: 'query', class: 'open', note: 'Why?', seal: { v: 1, fields: ['successor_id'], hash: 'x' }, seal_how: 'successor', at: new Date('2026-11-15T10:00:00Z'), by_name: 'A', by_entity_id: STRANGER_ID, by_entity_name: 'Firm', via_kind: 'grant', open_since: new Date('2026-11-15T10:00:00Z'), message_count: 0 };
const rowsOf = (planted) => (sql, params) => {
  const mine = planted && params.some((value) => String(value) === SHOP);
  if (/FROM review_mark WHERE thread_id/.test(sql)) return mine ? { rows: [ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/WITH latest AS/.test(sql)) return mine ? { rows: [ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/FROM journal_entry s/.test(sql)) return { rows: planted ? [{ id: ENTRY, label: 'MJ/1', date: '2026-11-15', succ_id: null }] : [], rowCount: planted ? 1 : 0 };
  if (/FROM chit_messages/.test(sql)) return { rows: [], rowCount: 0 };
  if (/review_mark_post/.test(sql)) return { rows: [{ message_id: MESSAGE.message_id, created_at: new Date() }], rowCount: 1 };
  return null;
};
const FOREIGN_ROUTES = [
  { route: R('GET', '/:thread_id/messages'), method: 'GET', url: THREAD_URL() },
  { route: R('POST', '/:thread_id/messages'), method: 'POST', url: THREAD_URL(), body: { message_text: 'hi' } }
];
const playFor = (port, item) => async (who, planted) => {
  const identity = who === 'owner' ? OWNER : STRANGER;
  Object.assign(lab.world, { realAuth: false, who: identity, asKey: false, db: 'ok', sqlRows: rowsOf(planted && who === 'owner' ? true : planted), jsonThrows: false, noCustomer: false });
  /* the owner's own thread: the entity the stand-in answers to is the owner's; the stranger asks under his own */
  return lab.send(port, item.method, item.url, item.body);
};
async function checkForeignIds(port) {
  console.log('\n-- signed in as another shop: a foreign thread id answers exactly as an unknown one (S35) --');
  const recording = FOREIGN.recorder();
  const failures = await FOREIGN.runCases(FOREIGN_ROUTES.map((item) => ({ route: item.route, play: playFor(port, item) })), recording.record);
  check('another shop\'s thread id is answered exactly as an unknown one, a 404, on the ' + FOREIGN_ROUTES.length + ' routes that name a thread (' + (FOREIGN_ROUTES.length - failures.length) + ' held)', failures.length === 0, failures);
  return recording.proved();
}

function checkContract(routes) {
  console.log('\n-- the contract and the router agree --');
  const contract = require(path.join(HERE, 'lib', 'marks-contract.js'));
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
  const router = require(path.join(HERE, FILE));
  const modules = () => ({ core: require(path.join(HERE, 'lib', 'review-mark.js')) });
  const routes = lab.routesOf(router, MOUNT);
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const recording = {};
  const contract = require(path.join(HERE, 'lib', 'marks-contract.js'));
  const allowedBy = Object.fromEntries(Object.keys(contract.OPERATIONS).map((key) => [key, contract.allowedStatuses()(key)]));
  const scenarios = lab.scenariosOf(routes, WORLDS, EXTRAS, { thread_id: THREAD });
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
  check('a key is refused with 403 SIGN_IN_FOR_MARKS on every route', Object.keys(recording).filter((key) => key.endsWith('|a-key-asks')).every((key) => recording[key].status === 403 && recording[key].body && recording[key].body.code === 'SIGN_IN_FOR_MARKS'));
  const coverage = lab.coverageOf(tested);
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(lab.mine).sort().map((route) => [route, onDisk[route]]));
  if (lab.argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !lab.mine(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
    FOREIGN.writeEvidence(EVIDENCE_FILE, lab.mine, foreign);
  } else {
    check('docs/contracts/api-hardening-evidence-areas.json says foreign_id_404 for exactly the routes that held here', sameValue(FOREIGN.evidenceOf(EVIDENCE_FILE, lab.mine), foreign), { held: Object.keys(foreign) });
    check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/marks.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  }
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  server.close();
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 3).join(' | ') : failure));
  process.exit(1);
});
