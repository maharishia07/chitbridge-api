#!/usr/bin/env node
// @type: unit
/**
 * acc-176b-books-for-elsewhere.test.cjs — X-Books-For is refused (403 BOOKS_FOR_NOT_HERE) on every path but the three books mounts; no header passes untouched.
 * OWNS the proof of middleware/books-grant.js refuseElsewhere and its place in server.js. CALLED BY CI. No database, no network. CARD 04-network/ACC-176B-ADVISER-REQUIREMENT
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { refuseElsewhere } = require('../middleware/books-grant');
function run(p, headers) {
  const out = { next: false, status: null, body: null };
  const res = { statusCode: 200, status(c) { out.status = c; return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; }, end() { return this; }, locals: {} };
  refuseElsewhere({ path: p, headers, id: 'r1', method: 'GET', originalUrl: p, get() { return undefined; } }, res, () => { out.next = true; });
  return out;
}
for (const p of ['/api/books/accounts', '/api/books', '/api/books-actions', '/api/books-actions/abc/review', '/api/books-grants', '/api/books-grants/x']) assert.strictEqual(run(p, { 'x-books-for': 'S' }).next, true, p + ' passes');
for (const p of ['/api/chits', '/api/bookshop', '/api/books-other', '/api/entities/me', '/api/till/x']) { const o = run(p, { 'x-books-for': 'S' }); assert.strictEqual(o.next, false, p + ' refused'); assert.strictEqual(o.status, 403, p); }
assert.strictEqual(run('/api/chits', {}).next, true, 'no header passes');
const o = run('/api/chits', { 'x-books-for': 'S' });
assert.ok(JSON.stringify(o.body).includes('BOOKS_FOR_NOT_HERE'), 'literal code in the body: ' + JSON.stringify(o.body));
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.ok(server.indexOf('refuseElsewhere') > 0 && server.indexOf('refuseElsewhere') < server.indexOf("app.use('/api/entities'"), 'mounted before the routers');
/* the mount must be CODE, not text after a // on the same line (it was, once: the guard passed and nothing was refused) */
assert.ok(server.split(String.fromCharCode(10)).some((line) => line.split('//')[0].includes("app.use(require('./middleware/books-grant').refuseElsewhere)")), 'the mount is on a code part of a line');
console.log('acc-176b-books-for-elsewhere: ok');
