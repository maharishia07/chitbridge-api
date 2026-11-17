'use strict';
/**
 * tests/rank10-baseline-commenter.test.cjs - AUDITOR RANK 10, found by the real-browser e2e (web e2e/books-since-checked.cjs, 17 Nov 2026):
 * POST /api/books-grants/practice/baseline (Mark as checked) answered 403 "Comment-only" to a real auditor seat, because the hat gate lists writes by exact path and this one was missing.
 * OWNS      the REAL hat gate driven with a commenter (the auditor seat) and a viewer on the baseline door (open: the route then asks for a live grant) and on neighbours that must stay shut
 *           (a client write, the grant door, a lookalike path), so the exact door opens nothing else. The owner is never gated.
 * CALLED BY node tests/rank10-baseline-commenter.test.cjs (no DB, no server); tests/write-route-gate.test.cjs sweeps the same list
 * CARD      18-identity-sign-in-and-access/access-levels-and-roles
 */
const assert = require('assert');
const gate = require('../middleware/hat-gate');
let pass = 0;
const it = (w, fn) => { try { fn(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } };
function run(level, url, type) {
  let passed = false, status = null;
  gate({ method: 'POST', originalUrl: url, identity: { identity_type: type || 'actor', access_level: level } }, { status(s) { status = s; return this; }, json() { return this; } }, () => { passed = true; });
  return { passed, status };
}
it('the auditor seat (commenter) passes the gate on Mark as checked', () => assert.ok(run('commenter', '/api/books-grants/practice/baseline').passed));
it('with a trailing slash and a query string too', () => assert.ok(run('commenter', '/api/books-grants/practice/baseline/?x=1').passed));
it('a viewer reaches the route as well (the route decides by grant and practice role, not the hat)', () => assert.ok(run('viewer', '/api/books-grants/practice/baseline').passed));
it('NEGATIVE: the grant door stays shut to a commenter (403 Comment-only)', () => { const r = run('commenter', '/api/books-grants'); assert.ok(!r.passed && r.status === 403); });
it('NEGATIVE: a lookalike path stays shut', () => {
  for (const u of ['/api/books-grants/practice/baseline/x', '/api/books-grants/practice/baselines', '/api/books-grants/practice', '/api/books/events']) assert.ok(!run('commenter', u).passed, u);
});
it('the owner is never gated', () => assert.ok(run(undefined, '/api/books/events', 'entity').passed));
console.log(pass + ' passed');
