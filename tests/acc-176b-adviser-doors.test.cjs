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
    for (const door of A.ADVISER_DOORS) assert.ok(routes.includes(door) || door === 'POST /api/books/preview', door + ' is not a real route');
  });
  await t('the adviser has no direct write on the books: only the server\'s own preview, and never the owner\'s accept', () => {
    const writes = [...A.ADVISER_DOORS].filter((door) => door.startsWith('POST ') && door.indexOf('/api/books/') === 5);
    assert.deepStrictEqual(writes, ['POST /api/books/preview']);
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
  await t('who may use which grant: the firm\'s owner or a whole-entity editor the adviser; the auditor-preset person the auditor', () => {
    const may = (who, role) => A.mayUseGrant({ identity: who }, role);
    assert.ok(may(firmOwner, 'adviser') && may(maker, 'adviser'));
    assert.ok(!may(auditorPerson, 'adviser') && !may(oneNode, 'adviser'));
    assert.ok(may(auditorPerson, 'auditor') && !may(maker, 'auditor'));
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
  console.log(fail ? '\n' + fail + ' failed' : '\nall ok');
  process.exit(fail ? 1 : 0);
})();
