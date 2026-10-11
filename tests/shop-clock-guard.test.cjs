/**
 * shop-clock-guard.test.cjs — NO RAW CLOCK READ IN POSTING CODE (round Y1). Every posting path reads lib/shop-clock.js, so a
 * test (or tools/simulate-years.cjs) can set and advance the shop's time. A new `new Date()` / `Date.now()` in the ledger files
 * fails here; a deliberate one (a cache TTL) carries `clock-ok` on its line. Also proves the clock itself: set, advance, reset,
 * the production refusal, and that books dayOf follows it.
 * Run: node tests/shop-clock-guard.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (why ? '\n          ' + why : '')); } };

const POSTING = ['lib/books.js', 'lib/books-hooks.js', 'lib/books-period.js', 'lib/books-todo.js', 'lib/books-pack.js', 'lib/books-nightly.js',
  'lib/books-recurring.js', 'lib/books-store.js', 'lib/books-engines.js', 'lib/books-manual.js', 'lib/books-tally.js', 'routes/books.js'];
for (const f of POSTING) {
  const bad = [];
  fs.readFileSync(path.join(API, f), 'utf8').split('\n').forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l) || /clock-ok/.test(l)) return;
    if (/\bnew Date\(\s*\)|\bDate\.now\(\)/.test(l)) bad.push(i + 1);
  });
  ok(f + ': no raw new Date() / Date.now() — use lib/shop-clock', !bad.length, 'line ' + bad.join(', '));
}

const C = require('../lib/shop-clock');
const real = Date.now();
ok('running: the system clock', Math.abs(C.nowMs() - real) < 2000 && !C.isSimulated());
C.set('2026-04-01T00:05:00+05:30');
ok('set: freezes at that moment', C.now().toISOString() === '2026-03-31T18:35:00.000Z' && C.isSimulated());
ok('today follows the shop zone (IST, not UTC)', C.today('IN') === '2026-04-01');
C.advance(24 * 3600000);
ok('advance: one day on', C.today('IN') === '2026-04-02');
C.advanceDays(364);
ok('advanceDays: a year on', C.today('IN') === '2027-04-01');
ok('bizDay of a given moment', C.bizDay('2026-10-10T18:29:00Z', 'IN') === '2026-10-10' && C.bizDay('2026-10-10T18:31:00Z', 'IN') === '2026-10-11');
let threw = false; process.env.NODE_ENV = 'production'; try { C.set('2030-01-01'); } catch (_) { threw = true; } process.env.NODE_ENV = 'test';
ok('production refuses to move the clock', threw);
C.reset();
ok('reset: back to the system clock', !C.isSimulated() && Math.abs(C.nowMs() - Date.now()) < 2000);
console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
