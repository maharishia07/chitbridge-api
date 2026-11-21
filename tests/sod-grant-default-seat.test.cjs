#!/usr/bin/env node
// @type: unit
/**
 * tests/sod-grant-default-seat.test.cjs — SEC-117 segregation of duties on the books grant (Fable 1117B, Employee seat; ISO 27001 A.5.3, ASA 220).
 *
 * OWNS      the proof that a request with NO X-Books-Role takes the role of the client's LIVE grant to the firm (GRANT-SEAT, Athi 20 Nov: the grant is the ceiling, the seat narrows within it): a person's seat never needs a header on a client
 *           that holds the other role; a person naming a role is looked at under THAT role; the seat (accountant, reviewer) never refuses the door, the look and the narrowed identity decide; the firm owner is unchanged.
 * CALLED BY CI (unit). No database; the grant store is stubbed. CARD 04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sod_test_secret_at_least_32_chars_padding_x';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
const storePath = require.resolve(path.join(API, 'lib', 'books-grant.js'));
const real = require(storePath);
const looks = [];
let liveRole = 'adviser'; /* what the client's live grants say (the real liveRoleOf reads them): set per case */
const stub = Object.assign({}, real, { liveRoleOf: async () => liveRole, look: async (entity, member, request) => { looks.push(request.role); return { allowed: false, grant: null, outcome: 'no_grant', status: 403, code: 'BOOKS_GRANT_NONE', words: 'No access has been given for these books.' }; } });
require.cache[storePath].exports = stub;
const A = require(path.join(API, 'middleware', 'books-grant.js'));

const firm = '11111111-1111-4111-8111-111111111111';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const base = { parent_entity_id: firm, identity_type: 'actor', whole_entity: true };
const accountant = Object.assign({ identity_id: '2a', access_level: 'editor', can_see_costs: false }, base);
const auditorHat = Object.assign({ identity_id: '2b', access_level: 'commenter', can_see_costs: true }, base);
const bothSeats = Object.assign({ identity_id: '2c', access_level: 'editor', can_see_costs: true }, base); /* RC-8: the Bookkeeper shape holds both skills */
const firmOwner = { identity_id: firm, identity_type: 'entity', parent_entity_id: null };

function drive(identity, headers) {
  const gate = A.frontOf(Object.assign((req, res, next) => { req.identity = Object.assign({}, identity); next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  const req = { headers: Object.assign({ 'x-books-for': MEMBER }, headers || {}), method: 'GET', path: '/daybook', query: {}, id: 'r1' };
  const out = {};
  const res = { status(c) { out.status = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; }, end() { return this; }, locals: {} };
  res.req = req;
  return new Promise((resolve) => { gate(req, res, () => { out.nexted = true; resolve(out); }); setTimeout(() => resolve(out), 150); });
}
let pass = 0; let fail = 0;
const t = async (name, fn) => { try { looks.length = 0; await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

(async () => {
  console.log('\nSEC-117 · the books role default (offline)');
  await t('accountant, no X-Books-Role: the look asks for the role of the client live grant (adviser here, auditor on an auditor-grant client)', async () => {
    await drive(accountant, {});
    assert.deepStrictEqual(looks, ['adviser']);
    looks.length = 0; liveRole = 'auditor';
    await drive(accountant, {});
    assert.deepStrictEqual(looks, ['auditor']);
    liveRole = 'adviser';
  });
  await t('accountant naming the auditor role: the look is made under the auditor grant (read only); the seat does not refuse', async () => {
    await drive(accountant, { 'x-books-role': 'auditor' });
    assert.deepStrictEqual(looks, ['auditor']);
  });
  await t('accountant naming the adviser role: unchanged, the adviser grant', async () => {
    await drive(accountant, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  await t('the reviewer seat, no header: the role of the live grant; naming the adviser role: looked at under it (the identity is then narrowed to a commenter)', async () => {
    await drive(auditorHat, {});
    assert.deepStrictEqual(looks, ['adviser']);
    looks.length = 0;
    await drive(auditorHat, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  await t('the firm owner (both seats), no header: unchanged, the auditor grant; naming adviser: the adviser grant', async () => {
    await drive(firmOwner, {});
    assert.deepStrictEqual(looks, [undefined]);
    looks.length = 0;
    await drive(firmOwner, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  await t('RC-8: one person holding both skills (editor, whole entity, sees costs) opens the auditor grant AND the adviser grant; independence is held at the sign-off, not by the seat', async () => {
    await drive(bothSeats, { 'x-books-role': 'auditor' });
    assert.deepStrictEqual(looks, ['auditor']); /* the look was made: the seat did not refuse (the stub look then says no grant) */
    looks.length = 0;
    await drive(bothSeats, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  console.log(`\n${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
