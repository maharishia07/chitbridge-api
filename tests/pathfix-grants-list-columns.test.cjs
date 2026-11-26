#!/usr/bin/env node
// @type: unit
/**
 * pathfix-grants-list-columns.test.cjs — GET /api/books-grants must never read a whole identities row.
 *
 * OWNS      the proof that list() names only the identities columns it needs. Since SEC-186 the credential columns of identities are revoked from the app role,
 *           so `to_jsonb(i)` (every column) answered 42501 "permission denied for table identities" -> 500 -> a firm's client list never opened (wave 7b, 26 Nov).
 * CALLED BY CI. No database, no network (bound-read and the schema probe are stood in).
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const path = require('path');
let seen = '';
const stub = (file, exp) => { const p = require.resolve(path.join('..', file)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
stub('lib/bound-read', { boundRead: async (_q, _e, sql) => { seen = sql; return { rows: [] }; } });
const schema = require('../lib/schema');
const real = schema.hasColumn;
(async () => {
  for (const hasTest of [true, false]) {
    schema.hasColumn = async (t, c) => (t === 'identities' && c === 'is_test' ? hasTest : real(t, c));
    seen = '';
    await require('../lib/books-grant').list('00000000-0000-0000-0000-000000000001');
    assert.ok(seen.includes('grantor_is_test'), 'the list still carries grantor_is_test (is_test column ' + hasTest + ')');
    assert.ok(!/to_jsonb\(\s*i\s*\)/.test(seen), 'no whole-row read of identities (to_jsonb(i)): the credential columns are revoked (SEC-186)');
  }
  console.log('pathfix-grants-list-columns: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
