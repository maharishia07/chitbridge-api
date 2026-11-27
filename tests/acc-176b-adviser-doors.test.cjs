#!/usr/bin/env node
// @type: unit
/**
 * tests/acc-176b-adviser-doors.test.cjs — ACC-176b (an adviser firm acting for a store's owner): the guard half that needs no database.
 *   · every route of routes/books-actions.js is either an adviser door (ADVISER_DOORS) or the owner's accept: a new route there is born refused for an adviser (an allow-list, like the auditor's GET list)
 *   · the adviser has NO direct write: no books POST but the server's own preview is an adviser door; the owner's accept is not one
 *   · the synthetic adviser is an editor of the store, never an owner (isOwner stays false: the books' owner gates are unchanged), and carries the preset from the grant row only
 *   · the roles: the firm's owner or an editor with whole-entity reach may use the adviser grant; an auditor-preset person may not; the auditor grant is for the auditor-preset person only
 *   · a role header names a ROW, it raises nothing: a value that is no role finds no grant
 * The database half (RLS, the steps, the accept, the revoke, the isolation) is tests/acc-176b-adviser.realstack.cjs, run by the CI integration job.
 * OWNS      the offline checks of the adviser doors of middleware/books-grant.js.   CALLED BY scripts/guards.cjs (CI guards job).   CARD  04-network/ACC-176B-ADVISER-REQUIREMENT
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176b_test_secret_at_least_32_chars_padding';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); }
};

const A = require(path.join(API, 'middleware', 'books-grant.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const actionsRouter = require(path.join(API, 'routes', 'books-actions.js'));
const action = require(path.join(API, 'lib', 'books-action.js'));
const actionContract = require(path.join(API, 'lib', 'books-actions-contract.js'));
const { isOwner } = require(path.join(API, 'lib', 'owner.js'));
const access = require(path.join(API, 'lib', 'access.js'));

const MOUNT = '/api/books-actions';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const firmOwner = { identity_id: '11111111-1111-4111-8111-111111111111', identity_type: 'entity', parent_entity_id: null };
const maker = { identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: firmOwner.identity_id, access_level: 'editor', whole_entity: true, can_see_costs: true, display_name: 'A' };
const auditorPerson = Object.assign({}, maker, { access_level: 'commenter' });
const oneNode = Object.assign({}, maker, { whole_entity: false });
const grantOf = (preset) => ({ grant_id: '44444444-4444-4444-8444-444444444444', grantor_entity: MEMBER, preset, can_see_costs: true });

(async () => {
  console.log('\nACC-176b · the adviser doors (offline)');
  await t('every route of books-actions is an adviser door or the owner\'s accept: a new route is born refused', () => {
    const routes = actionsRouter.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((method) => method.toUpperCase() + ' ' + MOUNT + (layer.route.path === '/' ? '' : layer.route.path)));
    const ownerOnly = new Set(['POST ' + MOUNT + '/:id/accept']);
    const open = routes.filter((route) => !A.ADVISER_DOORS.has(route) && !ownerOnly.has(route));
    assert.deepStrictEqual(open, [], 'not classified: ' + open.join(', '));
    assert.ok(routes.length >= 6, 'the six doors exist');
    for (const door of A.ADVISER_DOORS) assert.ok(routes.includes(door) || door === 'POST /api/books/preview' || door === 'POST /api/books/bank/statement-files' || door === 'POST /api/books/evidence', door + ' is not a real route'); /* the two doors outside books-actions: the server's own preview and the Statements box's add (a file kept, no book row) */
  });
  await t('the adviser has no direct write on the books: only the server\'s own preview, and never the owner\'s accept', () => {
    const writes = [...A.ADVISER_DOORS].filter((door) => door.startsWith('POST ') && door.indexOf('/api/books/') === 5);
    assert.deepStrictEqual(writes, ['POST /api/books/preview', 'POST /api/books/bank/statement-files', 'POST /api/books/evidence']); /* FW2-03: a receipt beside an entry is a file too, no book row; the box's add keeps a FILE against an account and period (l16 Statements box); it writes no entry, no period, no party */
    assert.strictEqual(A.adviserDoor('POST', MOUNT + '/3f2c9e1a-1111-4222-8333-444455556666/accept'), null);
    assert.strictEqual(A.adviserDoor('POST', '/api/books/entries'), null);
    assert.strictEqual(A.adviserDoor('POST', '/api/books/periods/2026-27/1/lock'), null);
    assert.strictEqual(A.adviserDoor('POST', MOUNT + '/3f2c9e1a-1111-4222-8333-444455556666/review'), 'POST /api/books-actions/:id/review');
    assert.strictEqual(A.adviserDoor('GET', MOUNT), 'GET /api/books-actions');
  });
  await t('the synthetic adviser is an editor of the store, not an owner; the preset comes from the grant row', () => {
    const synthetic = A.syntheticOf(maker, grantOf('adviser'));
    assert.strictEqual(synthetic.parent_entity_id, MEMBER);
    assert.strictEqual(synthetic.identity_id, maker.identity_id, 'the real person is kept');
    assert.strictEqual(synthetic.acting_preset, 'adviser');
    assert.strictEqual(isOwner({ identity: synthetic }), false, 'the books\' owner gates are unchanged');
    assert.strictEqual(access.levelOf(synthetic), 'editor');
    const auditor = A.syntheticOf(maker, grantOf('auditor'));
    assert.strictEqual(auditor.acting_preset, 'auditor');
    assert.strictEqual(access.levelOf(auditor), 'commenter');
  });
  const shopCounter = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: firmOwner.identity_id, access_level: 'commenter', whole_entity: false, can_see_costs: false };
  await t('who may use which grant: the firm\'s owner or a whole-entity editor the adviser; the auditor-preset person the auditor', () => {
    const may = (who, role) => A.mayUseGrant({ identity: who }, role);
    assert.ok(may(firmOwner, 'adviser') && may(maker, 'adviser'));
    assert.ok(may(auditorPerson, 'adviser') && !may(oneNode, 'adviser'), 'GRANT-SEAT (20 Nov): the reviewer opens an adviser grant too (read, review, never write: syntheticOf narrows it to a commenter)');
    assert.ok(may(auditorPerson, 'auditor'));
    assert.ok(may(maker, 'auditor'), 'RC-8 (19 Nov): an editor who reads every client with money holds both skills; independence is held at the sign-off');
    assert.ok(may(Object.assign({}, maker, { can_see_costs: false }), 'auditor'), 'GRANT-SEAT (20 Nov): the accountant seat opens an auditor-role grant too (read only)');
    assert.ok(A.holdsSeat({ identity: Object.assign({}, maker, { can_see_costs: false }) }, 'auditor') === false, 'the practice seat (the review seat) still needs cost sight');
    assert.ok(may(firmOwner, 'auditor') && may(firmOwner, 'adviser'), 'SEC-117: the firm owner holds both seats, unchanged');
    assert.ok(!may(shopCounter, 'auditor') && !may(shopCounter, 'adviser'), 'W12: a shop counter actor (commenter, one branch) opens nothing');
    assert.ok(A.holdsSeat({ identity: maker }, 'adviser') && A.holdsSeat({ identity: maker }, 'auditor'), 'RC-8: the editor who sees costs holds both seats (the practice seat is read from holdsSeat)');
    assert.ok(!A.mayUseGrant({ identity: maker, api_key: 'k' }, 'adviser'), 'a key is not a person');
  });
  await t('a role header names a row and raises nothing: only auditor or adviser (or none) find a grant', () => {
    assert.strictEqual(grants.roleOf(undefined), 'auditor');
    assert.strictEqual(grants.roleOf(''), 'auditor');
    assert.strictEqual(grants.roleOf('Adviser'), 'adviser');
    assert.strictEqual(grants.roleOf('owner'), null);
    assert.strictEqual(grants.roleOf('admin'), null);
  });
  await t('the grant\'s verdict: an adviser passes only its listed doors; an auditor never writes, listed or not', () => {
    const row = (preset) => ({ preset, revoked_at: null, unexpired: true, edge_live: true });
    assert.strictEqual(grants.verdictOf(row('adviser'), { method: 'POST', listed: true }), 'allowed');
    assert.strictEqual(grants.verdictOf(row('adviser'), { method: 'POST', listed: false }), 'not_listed');
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'POST', listed: true }), 'read_only');
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'POST', listed: false }), 'read_only');
    assert.strictEqual(grants.verdictOf(row('auditor'), { method: 'GET', listed: true }), 'allowed');
    assert.strictEqual(grants.verdictOf(Object.assign(row('adviser'), { revoked_at: new Date() }), { method: 'POST', listed: true }), 'revoked');
  });
  await t('W12: the accountant on an auditor-role grant: read only, and a revoked or lapsed grant still blocks', () => {
    const row = (extra) => Object.assign({ preset: 'auditor', revoked_at: null, unexpired: true, edge_live: true }, extra);
    assert.strictEqual(grants.verdictOf(row({}), { method: 'GET', listed: true }), 'allowed');
    assert.strictEqual(grants.verdictOf(row({}), { method: 'POST', listed: true }), 'read_only');
    assert.strictEqual(grants.verdictOf(row({ revoked_at: new Date() }), { method: 'GET', listed: true }), 'revoked');
    assert.notStrictEqual(grants.verdictOf(row({ unexpired: false }), { method: 'GET', listed: true }), 'allowed');
  });
  await t('lib/books-action: the body of each kind is read once; what an adviser may not do is refused in words (a party, a bill, too few lines, a bad id, no reason)', () => {
    const refusedAs = (kind, body, code) => assert.throws(() => action.bodyOf(kind, body), (err) => err.code === code && err.status === 422 && typeof err.words === 'string', kind + ' ' + code);
    refusedAs('journal', { lines: [{ code: '1000', dr_minor: 1 }, { code: '4000', cr_minor: 1 }], against_ref: 'B-1' }, 'ACTION_PARTY_NOT_IN_V1');
    refusedAs('journal', { lines: [{ code: '1000', dr_minor: 1, party: 'x' }, { code: '4000', cr_minor: 1 }] }, 'ACTION_PARTY_NOT_IN_V1');
    refusedAs('journal', { lines: [{ code: '1000', dr_minor: 1 }] }, 'ACTION_BODY_INVALID');
    refusedAs('reverse', { entry_id: 'not-a-uuid', reason: 'x' }, 'ACTION_BODY_INVALID');
    refusedAs('reverse', { entry_id: MEMBER, reason: '' }, 'ACTION_BODY_INVALID');
    refusedAs('unlock', { fy: '2026-27', period: 4 }, 'ACTION_BODY_INVALID');
    refusedAs('lock', { fy: 'next year', period: 4 }, 'ACTION_BODY_INVALID');
    refusedAs('year_close', {}, 'ACTION_BODY_INVALID');
    assert.deepStrictEqual(action.bodyOf('year_close', { fy: '2026-27', extra: 'dropped' }), { fy: '2026-27' }, 'a key the kind does not know is dropped, never carried');
    assert.deepStrictEqual(action.bodyOf('lock', { fy: '2026-27', period: '4', extra: 1 }), { fy: '2026-27', period: 4, reason: null }, 'a good lock body reads whole');
    assert.strictEqual(action.bodyOf('reverse', { entry_id: MEMBER.toUpperCase(), reason: ' typo ' }).entry_id, MEMBER, 'an id is kept lower case, a reason trimmed');
  });
  await t('lib/books-action: the hash binds the store, the kind and the body: the same words give the same hash, any change another', () => {
    const body = { fy: '2026-27', period: 4, reason: null };
    assert.strictEqual(action.hashOf(MEMBER, 'lock', body), action.hashOf(MEMBER, 'lock', Object.assign({}, body)));
    assert.notStrictEqual(action.hashOf(MEMBER, 'lock', body), action.hashOf(MEMBER, 'lock', Object.assign({}, body, { period: 5 })));
    assert.notStrictEqual(action.hashOf(MEMBER, 'lock', body), action.hashOf(MEMBER, 'unlock', body));
    assert.notStrictEqual(action.hashOf(MEMBER, 'lock', body), action.hashOf(firmOwner.identity_id, 'lock', body), 'the same body in another store is another action');
  });
  await t('lib/books-action: fail closed, no database (b867 not run) is the typed 503 in words, never a 500 and never a write', async () => {
    await assert.rejects(() => action.prepareAction(MEMBER, { identity_id: maker.identity_id }, { kind: 'lock', body: { fy: '2026-27', period: 4 } }, {}), (err) => err.code === 'BOOKS_ACTION_NOT_SWITCHED_ON' && err.status === 503 && /not switched on/.test(err.words));
    await assert.rejects(() => action.acceptAction(MEMBER, { identity_id: firmOwner.identity_id }, MEMBER, {}), (err) => err.status === 503);
    await assert.rejects(() => action.listActions(MEMBER, {}, maker), (err) => err.status === 503);
  });
  await t('the contract has an operation for each door and every action door is closed to an unknown key and carries the store', () => {
    for (const route of Object.keys(actionContract.ROUTES)) assert.ok(actionContract.operationFor(route), route + ' has an operation');
    for (const route of ['POST /', 'POST /:id/review', 'POST /:id/return', 'POST /:id/accept']) {
      assert.strictEqual(actionContract.ROUTES[route].rules.additionalProperties, false, route + ' refuses an unknown key');
      assert.ok(actionContract.ROUTES[route].required.includes('store_id'), route + ' carries the store');
    }
  });

  await t('a journal needs its date (an undated one would post on the day of the accept), and a reversal reads its entry id lower case', () => {
    assert.throws(() => action.bodyOf('journal', { lines: [{ code: '1000', dr_minor: 1 }, { code: '4000', cr_minor: 1 }] }), (err) => err.code === 'ACTION_BODY_INVALID' && /date/.test(err.words));
    assert.throws(() => action.bodyOf('journal', { date: '14 Nov', lines: [{ code: '1000', dr_minor: 1 }, { code: '4000', cr_minor: 1 }] }), (err) => err.code === 'ACTION_BODY_INVALID');
    const good = action.bodyOf('journal', { date: '2026-11-14', narration: ' n ', lines: [{ code: '1000', dr_minor: 1 }, { code: '4000', cr_minor: 1 }] });
    assert.strictEqual(good.date, '2026-11-14');
    assert.strictEqual(good.narration, 'n');
  });
  await t('CORS: every header the grant front reads is allowed to a browser (a preflight for X-Books-Role would otherwise fail every adviser call)', () => {
    const server = require('fs').readFileSync(path.join(API, 'server.js'), 'utf8');
    const allowed = /allowedHeaders:\s*\[([^\]]*)\]/.exec(server);
    assert.ok(allowed, 'server.js has an allowedHeaders list');
    const names = allowed[1].split(',').map((item) => item.replace(/['"\s]/g, '').toLowerCase());
    for (const header of [A.HEADER, A.ROLE_HEADER]) assert.ok(names.includes(String(header).toLowerCase()), header + ' is in allowedHeaders');
  });
  await t('a prepare needs a client_ref (the contract requires it) and every action door carries the store', () => {
    assert.ok(actionContract.ROUTES['POST /'].required.includes('client_ref'));
  });
  await t('the extra reads of the adviser are the owner reads the auditor list holds back; the auditor list is unchanged and nothing with party or bank details, files or stores is added', () => {
    for (const route of A.ADVISER_EXTRA_READS) { assert.ok(route in A.GRANT_HELD_BACK, route + ' is held back from the auditor'); assert.ok(!A.GRANT_READS.has(route), route + ' is not on the auditor list'); }
    for (const held of ['/bank/rail', '/party/:id/bills', '/payments/:id/advice', '/compare', '/compare/:id', '/compare/:id/csv', '/packs/:id/file', '/move-in/imports', '/fx-revalue']) assert.ok(!A.ADVISER_EXTRA_READS.has(held), held + ' stays held back from the adviser');
    assert.ok(A.ADVISER_EXTRA_READS.has('/events') && A.ADVISER_EXTRA_READS.has('/status'));
    /* l16 fable2 R2-3: the accountant seat's Day book reads the evidence counts (no 403); the auditor's list does not carry it; the FX preview stays closed to both (the page does not ask) */
    const door = (role, p) => A.listedFor(role, { method: 'GET', baseUrl: '/api/books', path: p });
    assert.ok(door('adviser', '/attention') && !door('auditor', '/attention') && !door('adviser', '/fx-revalue') && !door('auditor', '/fx-revalue'), '/attention: adviser reads, auditor not; /fx-revalue: neither');
  });
  await t('W15-85b: the accountant may send if_locked next_open on the bank page own event and payment bodies, and nothing else of it; Reopen (the period unlock) is no adviser door', () => {
    const bank = (door, body) => A.listedFor('adviser', { method: 'POST', baseUrl: '/api/books', path: door, body: Object.assign({ client_ref: 'bank:abc-1' }, body) });
    const fee = { kind: 'expense', class: 'bank_charges', amount: 15, paid_from: 'bank', date: '2026-10-06' }, pay = { party_id: MEMBER, direction: 'out', amount_minor: 5000, mode: 'bank', received_at: '2026-10-07', allocate: 'none' };
    assert.ok(bank('/events', fee) && bank('/payments', pay), 'the bank bodies are listed');
    assert.ok(bank('/events', Object.assign({ if_locked: 'next_open' }, fee)), 'an event with if_locked next_open is listed');
    assert.ok(bank('/payments', Object.assign({ if_locked: 'next_open' }, pay)), 'a payment with if_locked next_open is listed');
    for (const odd of ['always', '', 'open', true, ['next_open']]) assert.ok(!bank('/events', Object.assign({ if_locked: odd }, fee)) && !bank('/payments', Object.assign({ if_locked: odd }, pay)), 'if_locked ' + JSON.stringify(odd) + ' is not the bank page body');
    assert.ok(!A.listedFor('adviser', { method: 'POST', baseUrl: '/api/books', path: '/periods/2026-27/7/unlock', body: { reason: 'x', client_ref: 'bank:abc-1' } }), 'Reopen is not an adviser door');
    assert.ok(!A.listedFor('auditor', { method: 'POST', baseUrl: '/api/books', path: '/events', body: Object.assign({ if_locked: 'next_open', client_ref: 'bank:abc-1' }, fee) }), 'the auditor has no write door');
  });
  console.log(fail ? '\n' + fail + ' failed' : '\nall ok');
  process.exit(fail ? 1 : 0);
})();
