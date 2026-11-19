#!/usr/bin/env node
// @type: unit
/**
 * tests/sod-grant-default-seat.test.cjs — SEC-117 segregation of duties on the books grant (Fable 1117B, Employee seat; ISO 27001 A.5.3, ASA 220).
 *
 * OWNS      the proof that a request with NO X-Books-Role takes the person's OWN least-privilege seat, never the firm's widest grant:
 *           the accountant (editor, whole entity) without the header looks for the ADVISER grant, never the auditor's (so no auditor read and no set.ok to check what they prepared);
 *           the accountant naming the auditor role is refused in words unless the partner gave them the auditor hat; the auditor seat and the firm owner are unchanged.
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
const stub = Object.assign({}, real, { look: async (entity, member, request) => { looks.push(request.role); return { allowed: false, grant: null, outcome: 'no_grant', status: 403, code: 'BOOKS_GRANT_NONE', words: 'No access has been given for these books.' }; } });
require.cache[storePath].exports = stub;
const A = require(path.join(API, 'middleware', 'books-grant.js'));

const firm = '11111111-1111-4111-8111-111111111111';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const base = { parent_entity_id: firm, identity_type: 'actor', whole_entity: true };
const accountant = Object.assign({ identity_id: '2a', access_level: 'editor', can_see_costs: false }, base);
const auditorHat = Object.assign({ identity_id: '2b', access_level: 'commenter', can_see_costs: true }, base);
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
  await t('accountant, no X-Books-Role: the look asks for the ADVISER grant, never the auditor one', async () => {
    await drive(accountant, {});
    assert.deepStrictEqual(looks, ['adviser']);
  });
  await t('accountant naming the auditor role: refused 403 BOOKS_GRANT_NOT_FOR_YOU in words, no look is made', async () => {
    const out = await drive(accountant, { 'x-books-role': 'auditor' });
    assert.strictEqual(out.status, 403); assert.strictEqual(out.body.code, 'BOOKS_GRANT_NOT_FOR_YOU');
    assert.ok(/accountant/.test(JSON.stringify(out.body)) && /auditor role/.test(JSON.stringify(out.body)));
    assert.deepStrictEqual(looks, []);
  });
  await t('accountant naming the adviser role: unchanged, the adviser grant', async () => {
    await drive(accountant, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  await t('the auditor seat (partner gave the hat), no header: still the auditor grant; naming the adviser role stays refused', async () => {
    await drive(auditorHat, {});
    assert.deepStrictEqual(looks, [undefined]);
    looks.length = 0;
    const out = await drive(auditorHat, { 'x-books-role': 'adviser' });
    assert.strictEqual(out.status, 403); assert.deepStrictEqual(looks, []);
  });
  await t('the firm owner (both seats), no header: unchanged, the auditor grant; naming adviser: the adviser grant', async () => {
    await drive(firmOwner, {});
    assert.deepStrictEqual(looks, [undefined]);
    looks.length = 0;
    await drive(firmOwner, { 'x-books-role': 'adviser' });
    assert.deepStrictEqual(looks, ['adviser']);
  });
  console.log(`\n${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
