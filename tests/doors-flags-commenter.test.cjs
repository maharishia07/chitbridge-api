'use strict';
/**
 * tests/doors-flags-commenter.test.cjs - DOORS SWEEP (17 Nov 2026): POST /api/flags/query answered 403 "Comment-only" to a real auditor seat, so the private bookmark chips never drew (found by a real login; the flag realstack faked auth and could not see it).
 * OWNS      the REAL hat gate driven with a commenter (auditor seat) and a viewer on every /api/flags write (add, query, clear, resolve, reopen, share, remove): open, because lib/private-flag decides each call; and on neighbours that must stay shut.
 * CALLED BY node tests/doors-flags-commenter.test.cjs (no DB, no server); tests/write-route-gate.test.cjs sweeps the same list
 * CARD      18-identity-sign-in-and-access/access-levels-and-roles
 */
const gate = require('../middleware/hat-gate');
let pass = 0;
const it = (w, fn) => { try { fn(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } };
const assert = require('assert');
function run(level, url, type, method) {
  let passed = false, status = null;
  gate({ method: method || 'POST', originalUrl: url, identity: { identity_type: type || 'actor', access_level: level } }, { status(s) { status = s; return this; }, json() { return this; } }, () => { passed = true; });
  return { passed, status };
}
const ID = '0b6f1c1e-3b7a-4f2e-9d5a-1c2d3e4f5a6b';
const DOORS = ['/api/flags', '/api/flags/', '/api/flags/query', '/api/flags/clear', ...['resolve', 'reopen', 'share', 'remove'].map((a) => '/api/flags/' + ID + '/' + a)];
for (const level of ['commenter', 'viewer']) it('a ' + level + ' passes the gate on all seven flag writes', () => { for (const u of DOORS) assert.ok(run(level, u).passed, u); });
it('with a query string too', () => assert.ok(run('commenter', '/api/flags/query?x=1').passed));
it('NEGATIVE: lookalikes and neighbours stay shut to a commenter (403)', () => {
  for (const u of ['/api/flags/' + ID, '/api/flags/' + ID + '/delete', '/api/flags/query/x', '/api/flags/a/b/resolve', '/api/flagsx', '/api/flags-admin', '/api/books/entries', '/api/books-grants', '/api/marks/' + ID]) { const r = run('commenter', u); assert.ok(!r.passed && r.status === 403, u); }
});
it('the owner is never gated', () => assert.ok(run(undefined, '/api/flags/clear', 'entity').passed));
console.log(pass + ' passed');
