#!/usr/bin/env node
// @type: unit
/**
 * net-94-release-time.test.cjs — NET-94 / NET-87 (owner cb-network): a release time that is GIVEN and is not a date is a 400 DATE_INVALID, never a silent default.
 *
 * RULE      lib/network-offers.whenOf is the one reader of `at` / `until` (release, withdraw, catalogue publish). Absent → the fallback (next opening); "now" → now;
 *           a real ISO date or date-time → that instant; anything else GIVEN (0 · 1e308 · "abc" · "2026-13-45" · "1" · an object) → throws status 400, code DATE_INVALID, field named.
 *           Before the fix a bad `until` was dropped (200, the offer ran for ever) and a bad `at` released at the next opening.
 * HAND-COMPUTED  whenOf(undefined,'F')='F' · whenOf('2026-12-01T00:00:00Z') = '2026-12-01T00:00:00.000Z' · whenOf('2026-12-01') = '2026-12-01T00:00:00.000Z'
 *           · each junk value throws with field 'until'. The route half (bad until/at answers 400 as a problem body) is in tests/api-problem-network-offers.test.cjs.
 *           NET-95: a key PRESENT but empty ("") is malformed, so 400 like "abc"; the web sends {at:'now'} or no key, never "".
 * RUN       node tests/net-94-release-time.test.cjs
 * CARD      04-network/network-offers
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const net = require('../lib/network-offers');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + info : '')); } };
const attempt = (v, field) => { try { return { got: net.whenOf(v, 'FALLBACK', field) }; } catch (e) { return { err: e }; } };

for (const absent of [undefined, null]) ok('absent ' + JSON.stringify(absent) + ' → the fallback', attempt(absent).got === 'FALLBACK');
ok('"now" → an instant', /^\d{4}-\d\d-\d\dT/.test(attempt('now').got));
ok('an ISO date-time → that instant', attempt('2026-12-01T00:00:00Z').got === '2026-12-01T00:00:00.000Z');
ok('an ISO date → midnight UTC', attempt('2026-12-01').got === '2026-12-01T00:00:00.000Z');
for (const junk of ['', 0, 1e308, 'abc', '2026-13-45', '2026-02-30T00:00:00Z', '1', 'March', {}, [], true, -1, NaN]) {
  const r = attempt(junk, 'until');
  ok('given ' + (typeof junk === 'number' ? String(junk) : JSON.stringify(junk)) + ' → 400 DATE_INVALID naming until', !!r.err && r.err.status === 400 && r.err.code === 'DATE_INVALID' && r.err.field === 'until', JSON.stringify(r));
}
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
