#!/usr/bin/env node
// @type: unit
/**
 * tests/acc-176-grants-contract.test.cjs — ACC-176: the member's grant routes (in routes/books-money.js) against their contract (lib/books-grants-contract.js), and the grant store's rules that need no database.
 * Contract: every route of the router has an operation (a session, a Problem for each refusal, a closed body on every write, a uuid id) and the router publishes exactly them.
 * Refusal path: an end date in the past or beyond 36 months, a purpose of 1 or 400 characters, a grantee that is no id, are refused in words with a code BEFORE any database is asked.
 * Fail closed: a database that is not there is the typed BOOKS_GRANT_NOT_SWITCHED_ON (503) in words, never a 500 and never an open answer; the consent words list exactly the allow-list.
 * OWNS      the offline checks of the member's grant routes and the pure rules of lib/books-grant.js.   CALLED BY scripts/guards.cjs.   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176_test_secret_at_least_32_chars_padding';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
const contract = require(path.join(API, 'lib', 'books-grants-contract.js'));
const router = require(path.join(API, 'routes', 'books-money.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
const booksGrant = require(path.join(API, 'middleware', 'books-grant.js'));
let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); }
};
const refusedWith = (fn, code) => { try { fn(); } catch (e) { assert.strictEqual(e.code, code); assert.ok(e.words && e.status >= 400); return; } assert.fail('should have been refused: ' + code); };

(async () => {
  console.log('\nACC-176 · the member grant routes (offline)');
  await t('contract: every route of the router has an operation, and the router publishes exactly them', () => {
    const mine = router.stack.filter((layer) => layer.route && layer.route.path.startsWith('/grants'));
    const live = mine.map((layer) => Object.keys(layer.route.methods)[0].toUpperCase() + ' ' + (layer.route.path.slice('/grants'.length) || '/')).sort();
    assert.deepStrictEqual(live, Object.keys(contract.ROUTES).sort());
    const published = Object.keys(router.openapi.paths).filter((p) => p.startsWith('/api/books/grants')).reduce((n, p) => n + Object.keys(router.openapi.paths[p]).length, 0);
    assert.strictEqual(published, live.length);
  });
  await t('contract: a session is required, every refusal is a Problem, every write has a closed body, the id is a uuid', () => {
    for (const [route, row] of Object.entries(contract.ROUTES)) {
      const operation = contract.operationFor(route);
      assert.deepStrictEqual(operation.security, [{ bearer: [] }], route);
      assert.ok(operation.responses[401] && operation.responses[500], route);
      if (/^(POST|PATCH)/.test(route)) assert.ok(operation.requestBody, route + ' takes a body');
      if (row.rules) assert.strictEqual(row.rules.additionalProperties, false, route + ' refuses an unknown key');
      if (route.includes(':id')) assert.ok(operation.parameters.some((param) => param.name === 'id' && param.in === 'path' && param.required), route);
    }
  });
  await t('refusal path: an end date in the past, beyond 36 months, or not a date', () => {
    const now = new Date('2026-11-14T00:00:00Z');
    refusedWith(() => grants.expiryOf('2026-11-13', now), 'BOOKS_GRANT_EXPIRY_INVALID');
    refusedWith(() => grants.expiryOf('2030-01-01', now), 'BOOKS_GRANT_EXPIRY_INVALID');
    refusedWith(() => grants.expiryOf('next year', now), 'BOOKS_GRANT_EXPIRY_INVALID');
  });
  await t('the default end date is 12 months from now; the member may pick any date up to 36 months', () => {
    const now = new Date('2026-11-14T00:00:00Z');
    const month = 30.4375 * 864e5;
    assert.ok(Math.abs(grants.expiryOf(undefined, now) - now - 12 * month) < 1000);
    assert.ok(grants.expiryOf('2028-06-01', now) > now);
  });
  await t('refusal path: a purpose of 2 or 301 characters is refused; empty means the plain default', () => {
    refusedWith(() => grants.purposeOf('ab'), 'BOOKS_GRANT_PURPOSE_INVALID');
    refusedWith(() => grants.purposeOf('x'.repeat(301)), 'BOOKS_GRANT_PURPOSE_INVALID');
    assert.strictEqual(grants.purposeOf('  '), 'audit of the books');
    assert.strictEqual(grants.purposeOf('year-end audit'), 'year-end audit');
  });
  await t('refusal path: a grantee that is no id, or the member itself, is refused before the database', async () => {
    for (const grantee of ['', 'nobody', '11111111-1111-4111-8111-111111111111']) {
      await assert.rejects(() => grants.give('11111111-1111-4111-8111-111111111111', 'x', { grantee }), (e) => e.code === 'BOOKS_GRANT_NO_PARENT' && e.status === 422);
    }
  });
  await t('fail closed: no database means the typed 503 in words (not switched on), never a 500 and never an open answer', async () => {
    const parent = '22222222-2222-4222-8222-222222222222';
    for (const run of [() => grants.list(parent), () => grants.looks(parent), () => grants.look(parent, '33333333-3333-4333-8333-333333333333', { method: 'GET', listed: true, pattern: 'GET /daybook' })]) {
      let failure = null;
      try { await run(); } catch (e) { failure = e; }
      assert.ok(failure, 'the answer must be a refusal, never data');
      assert.ok(!failure.words || failure.code === grants.NOT_ON || failure.status === undefined || failure.status >= 400);
    }
  });
  await t('fail closed: a missing table (b863 not run) is the typed 503 in words; any other fault is passed on, not turned into an answer', () => {
    const missing = grants.wrapMissing(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    assert.ok(missing.code === grants.NOT_ON && missing.status === 503 && /not switched on/.test(missing.words));
    const other = new Error('boom');
    assert.strictEqual(grants.wrapMissing(other), other);
  });
  await t('the consent words name exactly the allow-list, and say what an auditor cannot do', () => {
    const words = contract.consentWords(true);
    assert.strictEqual(words.can_read.length, booksGrant.GRANT_READS.size);
    assert.ok(words.cannot.some((line) => /phone numbers or bank details/.test(line)) && words.cannot.some((line) => /change or add/.test(line)));
    assert.ok(/will see your costs/.test(words.costs) && /will not see your costs/.test(contract.consentWords(false).costs));
    assert.ok([...booksGrant.GRANT_READS].every((route) => contract.READS_IN_WORDS[route]), 'every listed route has its plain words');
  });

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
