#!/usr/bin/env node
// @type: unit
/**
 * tests/w4bank-1130.test.cjs — walk 4 bank rows (W4-03): an auditor's read of the October statement into the Bank page's reader (use=read) is on the grant's list; the DOWNLOAD stays held (MONEY-01 A6);
 * a refused route is worded "not part of this access", never "ended". HAND-COMPUTED: 3 requests asked (read, download, no use) → exactly 1 listed.
 * OWNS the offline checks of the auditor's statement read in middleware/books-grant.js.   CALLED BY scripts/guards.cjs.   CARD  16-finance/bank-reconciliation-and-bank-recon
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'w4bank_test_secret_at_least_32_chars_long';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
const A = require(path.join(API, 'middleware', 'books-grant.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 400)); } };
const FILE = '/bank/statement-files/3f2c9e1a-1111-4222-8333-444455556666/file';
const ask = (query) => ({ method: 'GET', path: FILE, baseUrl: '/api/books', query });
t('W4-03 the auditor reads the kept statement into the reader (use=read)', () => assert.strictEqual(A.listedFor('auditor', ask({ use: 'read' })), true));
t('W4-03 the auditor still has no download (use=download, and no use)', () => {
  assert.strictEqual(A.listedFor('auditor', ask({ use: 'download' })), false);
  assert.strictEqual(A.listedFor('auditor', ask({})), false);
});
t('W4-03 a write on that path is never listed for the auditor', () => assert.strictEqual(A.listedFor('auditor', { method: 'POST', path: FILE, baseUrl: '/api/books', query: { use: 'read' } }), false));
t('W4-03 the verdict for a live auditor grant on the read is allowed', () => assert.strictEqual(grants.verdictOf({ preset: 'auditor', revoked_at: null, unexpired: true, edge_live: true }, { method: 'GET', listed: A.listedFor('auditor', ask({ use: 'read' })) }), 'allowed'));
t('W4-03 a refused route says what it is: not part of this access, and never "ended"', () => {
  const a = grants.answerOf('not_listed', { preset: 'auditor' }); const words = [a.code, a.status, a.words];
  assert.ok(words, 'wordsFor exported');
  assert.strictEqual(words[0], 'GRANT_ROUTE_NOT_LISTED');
  assert.match(words[2], /not part of this access/);
  assert.doesNotMatch(words[2], /ended/);
});
/* W4-02: the practice row's bank state reads what the Bank page reads. Moonee: October alone signed (no unbroken run from the first entry), difference 35432 minor = A$354.32 carried */
const practice = require(path.join(API, 'lib', 'books-practice.js'));
const bankLog = require(path.join(API, 'lib', 'bank-rec-log.js'));
const OCT = { account_id: 'a1', period_to: '2026-10-31', difference_minor: -35432, currency: 'AUD' };
t('W4-02 signed with no unbroken run and a remainder: unexplained, A$354.32 (35432 minor), the run words said', () => {
  const b = practice.bankOf({ accounts: 0, rows: [], any: [OCT] });
  assert.strictEqual(b.state, 'unexplained');
  assert.strictEqual(b.unexplained_minor, 35432);
  assert.strictEqual(b.currency, 'AUD');
  assert.strictEqual(b.reconciled_to, null, 'never "reconciled to" a date over a hole');
  assert.strictEqual(b.in_run, false);
  assert.strictEqual(b.words, bankLog.NO_RUN_WORDS);
});
t('W4-02 signed with no run and nothing unexplained: no_run, never "No statement"', () => {
  const b = practice.bankOf({ accounts: 0, rows: [], any: [Object.assign({}, OCT, { difference_minor: 0 })] });
  assert.strictEqual(b.state, 'no_run');
  assert.strictEqual(b.words, bankLog.NO_RUN_WORDS);
});
t('W4-02 nothing signed at all stays none; a run stays as before', () => {
  assert.strictEqual(practice.bankOf({ accounts: 0, rows: [], any: [] }).state, 'none');
  assert.strictEqual(practice.bankOf(null).state, 'none');
  const r = practice.bankOf({ accounts: 1, rows: [Object.assign({}, OCT, { difference_minor: 0 })], any: [OCT] });
  assert.strictEqual(r.state, 'reconciled');
  assert.strictEqual(r.reconciled_to, '2026-10-31');
});
/* W4-12: the Bank page's own read carries the ONE no-run sentence when a month is signed and none is in an unbroken run (the run rule gives nothing, the newest sign-off exists) */
const schema = require(path.join(API, 'lib', 'schema.js'));
schema.hasTable = async () => true;
const scripted = (run, any) => ({ async query(sql) { return { rows: /first_gap/.test(sql) ? run : any }; } });
(async () => {
  const E = '11111111-1111-4111-8111-111111111111';
  let out = await bankLog.unexplained(scripted([], [OCT]), E);
  t('W4-12 a signed month with no run: no_run true and the one sentence', () => { assert.strictEqual(out.no_run, true); assert.strictEqual(out.words, bankLog.NO_RUN_WORDS); assert.strictEqual(out.count, 0); });
  out = await bankLog.unexplained(scripted([OCT], [OCT]), E);
  t('W4-12 a run: no sentence', () => { assert.strictEqual(out.no_run, false); assert.strictEqual(out.words, null); assert.strictEqual(out.unexplained_minor, 35432); });
  out = await bankLog.unexplained(scripted([], []), E);
  t('W4-12 nothing signed: no sentence', () => { assert.strictEqual(out.no_run, false); });
  process.exit(fail ? 1 : 0);
})();
