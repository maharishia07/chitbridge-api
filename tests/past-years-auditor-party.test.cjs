/**
 * past-years-auditor-party.test.cjs — PAST-YEARS item 3 (Athi 16 Nov 2026; the auditor's debtor and creditor confirmations): the READ-ONLY auditor seat may read a customer's or a supplier's ledger
 * (GET /api/books/party/:id/statement) through the ONE grant check (middleware/books-grant.js GRANT_READS + lib/books-grant.verdictOf), and nothing else about parties opens.
 *   · the statement door is listed for the auditor and for the adviser (the adviser reads what the auditor reads) · the party's own bills stay held back from both
 *   · every write is refused for the auditor whatever the path: verdictOf answers read_only for POST, PUT, PATCH and DELETE, even on the listed path
 *   · the adviser has no direct write on a party path (not listed): writes go only through the maker-checker doors
 * Run: node tests/past-years-auditor-party.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const A = require(path.join(API, 'middleware', 'books-grant'));
const G = require(path.join(API, 'lib', 'books-grant'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const door = (role, method, p) => A.listedFor(role, { method, baseUrl: '/api/books', path: p });
const live = { revoked_at: null, unexpired: true, edge_live: true, preset: 'auditor' };
const verdict = (row, method, p) => G.verdictOf(row, { method, listed: door(row ? row.preset : 'auditor', method, p) });
const ID = '3f2c9e1a-1111-4222-8333-444455556666';

console.log('\nPAST-YEARS · the auditor reads a party ledger, read only (offline)');
t('the party statement is on the auditor list and no longer held back', () => {
  assert.ok(A.GRANT_READS.has('/party/:id/statement'));
  assert.ok(!('/party/:id/statement' in A.GRANT_HELD_BACK));
});
t('the auditor GET of a customer or supplier ledger is allowed (one door, either side)', () => {
  assert.strictEqual(verdict(live, 'GET', '/party/' + ID + '/statement'), 'allowed');
  assert.strictEqual(A.routeForLog('GET', '/party/' + ID + '/statement'), 'GET /party/:id/statement');
});
t('every write on that path is read_only for the auditor, and so is every other method', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.strictEqual(verdict(live, method, '/party/' + ID + '/statement'), 'read_only', method);
});
t('the party own bills, the payment advice and the bank rail stay held back from the auditor', () => {
  for (const held of ['/party/' + ID + '/bills', '/payments/' + ID + '/advice', '/bank/rail']) assert.strictEqual(verdict(live, 'GET', held), 'not_listed', held);
});
t('the adviser reads the same statement; its direct write on the party path is not listed', () => {
  const adviser = Object.assign({}, live, { preset: 'adviser' });
  assert.strictEqual(verdict(adviser, 'GET', '/party/' + ID + '/statement'), 'allowed');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.strictEqual(verdict(adviser, method, '/party/' + ID + '/statement'), 'not_listed', method);
});
t('no grant, a revoked, an expired and a disconnected grant still read nothing', () => {
  assert.strictEqual(verdict(null, 'GET', '/party/' + ID + '/statement'), 'no_grant');
  assert.strictEqual(verdict(Object.assign({}, live, { revoked_at: 'x' }), 'GET', '/party/' + ID + '/statement'), 'revoked');
  assert.strictEqual(verdict(Object.assign({}, live, { unexpired: false }), 'GET', '/party/' + ID + '/statement'), 'expired');
  assert.strictEqual(verdict(Object.assign({}, live, { edge_live: false }), 'GET', '/party/' + ID + '/statement'), 'edge_off');
});
console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
