#!/usr/bin/env node
// @type: unit
/**
 * tests/firm-answer.test.cjs — FIRMVERT: "is this entity an accounting firm" has ONE answer, the entity's trade (constitution `accounting-firm`, chosen at sign-up).
 * OWNS      the offline checks of govresolve.isFirm and of `firm` in the practice answer (lib/books-practice.js), over the REAL resolver with a stubbed database.
 * HAND-COMPUTED  a new firm = constitution accounting-firm, 0 clients → firm true; a new shop = no constitution, 0 clients → false; a shop on another trade (service-desk) → false;
 *   an unreadable trade → false (answered as not stated, never guessed); a firm's declared sector 'paint' does not move it (the constitution wins over a sector).
 * CALLED BY scripts/guards.cjs.   CARD  vertical/README
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

let ROWS = { identity: null, sectors: [], constitution: null, broken: false };
function answer(sql) {
  const text = String(sql);
  if (ROWS.broken) throw new Error('db down');
  if (/FROM identities WHERE/.test(text)) return { rows: ROWS.identity ? [{ vertical: ROWS.identity }] : [] };
  if (/FROM entity_profile/.test(text)) return { rows: [{ sectors: ROWS.sectors }] };
  if (/JOIN constitution/.test(text)) return { rows: ROWS.constitution ? [{ vertical: ROWS.constitution }] : [] };
  return { rows: [] };
}
const dbPath = require.resolve(path.join(API, 'db'));
const stub = { query: Object.assign(async (sql) => answer(sql), { asEach: async () => ({ rows: [] }) }), withEntity: async (e, fn) => fn({ query: async (s) => answer(s) }), onEntity: async (e, fn) => fn({ query: async (s) => answer(s) }), readBatch: async (e, actor, statements) => statements.map((st) => answer(st.text)) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };
const G = require(path.join(API, 'lib', 'govresolve'));
const grants = require(path.join(API, 'lib', 'books-grant'));
require(path.join(API, 'lib', 'schema')).hasTables = async () => ({});
grants.asEntity = async (entity, fn) => fn({ query: async () => ({ rows: [] }) }); /* a firm with no grant row: 0 clients */
const P = require(path.join(API, 'lib', 'books-practice.js'));
const FIRM = '11111111-1111-4111-8111-111111111111';
const entity = (rows) => { ROWS = Object.assign({ identity: null, sectors: [], constitution: null, broken: false }, rows); };

(async () => {
  await t('a new firm (accounting-firm constitution, 0 clients) answers firm:true', async () => {
    entity({ constitution: 'accounting-firm' });
    const a = await P.practice(FIRM, { roles: ['auditor'] });
    assert.strictEqual(a.total, 0); assert.strictEqual(a.firm, true);
  });
  await t('a new shop (no constitution, 0 clients) answers firm:false', async () => {
    entity({});
    assert.strictEqual((await P.practice(FIRM, { roles: ['auditor'] })).firm, false);
  });
  await t('a shop on another trade constitution answers firm:false', async () => {
    entity({ constitution: 'service-desk' });
    assert.strictEqual((await P.practice(FIRM, { roles: ['auditor'] })).firm, false);
  });
  await t('the constitution wins over a declared sector: a firm that declared paint is still a firm', async () => {
    entity({ constitution: 'accounting-firm', sectors: ['paint'] });
    assert.strictEqual((await P.practice(FIRM, { roles: ['auditor'] })).firm, true);
  });
  await t('an unreadable trade answers false (not stated, never guessed)', async () => {
    entity({ constitution: 'accounting-firm', broken: true });
    assert.strictEqual((await P.practice(FIRM, { roles: ['auditor'] })).firm, false);
  });
  await t('isFirm is pure over the resolved trade', () => {
    assert.strictEqual(G.isFirm({ key: 'accounting-firm' }), true);
    assert.strictEqual(G.isFirm({ key: 'pharma' }), false);
    assert.strictEqual(G.isFirm(null), false);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
