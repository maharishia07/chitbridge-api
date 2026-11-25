/**
 * tests/bb-thread-seat-words.test.cjs - BB-F-04 (walk BB, 21 Nov 2026): an ADVISER (grant preset adviser, X-Books-Role: adviser) who posts to the client's chit thread was refused "open to an AUDITOR to read, not to write in".
 * The seat matrix (docs/SEAT-MATRIX.md, RC-11) gives neither firm seat a write on the thread, so the refusal stays 403 BOOKS_FOR_READ_ONLY; the WORDS name the seat that asked (lib/books-grant.threadReadOnlyWords).
 * Run: node tests/bb-thread-seat-words.test.cjs
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test';
const gate = require('../middleware/books-grant');
const THREAD = '11111111-1111-4111-8111-111111111111';
const ask = (role) => {
  const out = { status: null, body: null, next: false };
  const req = { method: 'POST', baseUrl: '', path: '/api/chits/' + THREAD + '/messages', headers: Object.assign({ 'x-books-for': '22222222-2222-4222-8222-222222222222' }, role ? { 'x-books-role': role } : {}), query: {}, identity: { identity_id: 'u', identity_type: 'actor' } };
  const res = { statusCode: 200, locals: {}, status(c) { out.status = c; return this; }, set() { return this; }, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; } };
  gate.refuseElsewhere(req, res, () => { out.next = true; });
  return out;
};
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
t('an adviser posting to the thread: 403 BOOKS_FOR_READ_ONLY, the words say adviser, never auditor', () => {
  const o = ask('adviser');
  assert.ok(!o.next && o.status === 403, JSON.stringify(o));
  const text = JSON.stringify(o.body);
  assert.ok(/BOOKS_FOR_READ_ONLY/.test(text) && /open to an adviser to read, not to write in/.test(text) && !/auditor/.test(text), text);
});
t('an auditor keeps its own words; no role header is the auditor\'s (the default seat)', () => {
  for (const role of ['auditor', null]) assert.ok(/open to an auditor to read, not to write in/.test(JSON.stringify(ask(role).body)), String(role));
});
console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
