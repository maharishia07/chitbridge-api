#!/usr/bin/env node
// @type: unit
/**
 * identity-secret.test.cjs: the sign-in code runs before AND after migration b874 (lib/identity-secret.js).
 *
 * OWNS      each rule of the module with a stub database: a database without the view gets the pre-b874 SQL (no secret skipped, nothing weaker) · a database with it keeps the view text ·
 *           a yes is kept, a no is asked again after its short wait · a failed or unclear answer is "present" (fail closed: the statement as written, never a guess) · text that does not name the view is untouched.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      stub db.query → viewReady / tolerate → the SQL text and the number of asks
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';
const dbPath = require.resolve(path.join(__dirname, '..', 'db'));
let answer = null, asks = 0;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { asks++; if (answer instanceof Error) throw answer; return answer; } } };
const secret = require('../lib/identity-secret');
let pass = 0, fail = 0;
const ok = async (name, fn) => { try { secret._reset(); asks = 0; await fn(); pass++; console.log('  ok  ' + name); } catch (error) { fail++; console.log('  FAIL ' + name + '\n        ' + error.message); } };
const rows = (hasView, hasFn) => ({ rows: [{ has_view: hasView, has_fn: hasFn }] });
const VIEW_SQL = 'SELECT s.pin_hash, s.otp_code, s.otp_code_hash, s.has_pin, s.has_code FROM identities LEFT JOIN ops.identity_secret s ON s.for_identity = identities.identity_id WHERE 1=1';

(async () => {
  console.log('\nidentity-secret: before and after b874');
  await ok('unit: legacySql turns each view column into the identities column and drops the join', () => {
    const legacy = secret.legacySql(VIEW_SQL);
    assert.ok(!/ops\.identity_secret|\bs\./.test(legacy), legacy);
    assert.ok(/identities\.pin_hash/.test(legacy) && /identities\.otp_code/.test(legacy) && /to_jsonb\(identities\)/.test(legacy));
  });
  await ok('unit: a database without the view gets the pre-b874 SQL', async () => { answer = rows(false, false); assert.strictEqual(await secret.tolerate(VIEW_SQL), secret.legacySql(VIEW_SQL)); });
  await ok('unit: a database with the view and the function keeps the view SQL as written', async () => { answer = rows(true, true); assert.strictEqual(await secret.tolerate(VIEW_SQL), VIEW_SQL); });
  await ok('unit: the view without the spend function counts as not run', async () => { answer = rows(true, false); assert.notStrictEqual(await secret.tolerate(VIEW_SQL), VIEW_SQL); });
  await ok('unit: a yes is kept, the database is asked once', async () => { answer = rows(true, true); await secret.viewReady(); await secret.viewReady(); assert.strictEqual(asks, 1); });
  await ok('unit: a no is kept for its short wait, not asked on every statement', async () => { answer = rows(false, false); await secret.viewReady(); await secret.viewReady(); assert.strictEqual(asks, 1); });
  await ok('fail closed: a failed ask (database down, unavailable) keeps the SQL as written, never the legacy guess', async () => { answer = new Error('connection refused 503'); assert.strictEqual(await secret.tolerate(VIEW_SQL), VIEW_SQL); });
  await ok('refusal path: an unclear answer (no boolean) is a failed ask, the view SQL stands', async () => { answer = { rows: [{}] }; assert.strictEqual(await secret.tolerate(VIEW_SQL), VIEW_SQL); });
  await ok('unit: text that does not name the view, and a non-string, are returned as they are', async () => { answer = rows(false, false); assert.strictEqual(await secret.tolerate('SELECT 1'), 'SELECT 1'); assert.strictEqual(await secret.tolerate(7), 7); assert.strictEqual(asks, 0); });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
