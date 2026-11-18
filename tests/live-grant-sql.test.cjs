#!/usr/bin/env node
// @type: unit
/**
 * live-grant-sql.test.cjs — "a live grant" is ONE fragment (Fable review R1, 18 Nov): liveGrantSql in lib/books-grant.js.
 *
 * OWNS      the proof that the fragment means live / expired / revoked (its two clauses read against rows, hand-computed), that the alias lands on both columns,
 *           and that no api file spells the test inline any more.
 * CALLED BY CI. No database, no network.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { liveGrantSql } = require('../lib/books-grant');

assert.strictEqual(liveGrantSql(), 'revoked_at IS NULL AND expires_at > now()', 'no alias');
assert.strictEqual(liveGrantSql('g'), 'g.revoked_at IS NULL AND g.expires_at > now()', 'alias on both columns');

/* read the fragment's two clauses against a row: the database clock is `now` */
const now = Date.parse('2026-11-18T00:00:00Z');
const isLive = (row) => {
  const js = liveGrantSql('r').replace('r.revoked_at IS NULL', '(r.revoked_at == null)').replace('r.expires_at > now()', '(r.expires_at > now)');
  return new Function('r', 'now', 'return ' + js.replace(' AND ', ' && '))(row, now);
};
assert.strictEqual(isLive({ revoked_at: null, expires_at: now + 1000 }), true, 'open and not past its end: live');
assert.strictEqual(isLive({ revoked_at: null, expires_at: now - 1000 }), false, 'past its end: expired');
assert.strictEqual(isLive({ revoked_at: null, expires_at: now }), false, 'ending this instant: expired (strictly after now)');
assert.strictEqual(isLive({ revoked_at: now - 5000, expires_at: now + 1000 }), false, 'revoked before its end: revoked');

for (const file of ['lib/books-action.js', 'lib/jobs-open.js', 'lib/network-accept-assign.js', 'lib/books-grant.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(!/revoked_at IS NULL AND (g\.)?expires_at > now\(\)/.test(source.replace(/\/\*\*[\s\S]*?\*\//g, '')), file + ' spells the live test inline');
}
console.log('live-grant-sql: all ok');
