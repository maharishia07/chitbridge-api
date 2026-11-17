/* tests/lock-words-shop-day.test.cjs — E14 + E13 (Fable multi-role walk 17 Nov): a lock stamp reads the SHOP's day, and one month state has one word.
 * HAND-COMPUTED  A lock recorded at 2026-11-16T19:30:00Z is 17 Nov 2026 05:30 in Australia/Sydney (UTC+11 in November): the line must read "Locked by Pat Lee · 17 Nov 2026".
 *   The old reader cut the moment to its UTC date (16 Nov) and read "16 Nov 2026". States: open → Open, soft_locked → Locked (never Closed), hard_locked → Closed for good.
 * OWNS the offline guard of E13/E14 for public/app/lock-words.js.   CARD 14-accounting */
'use strict';
const assert = require('assert');
const fmt = (ts, tz) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date(ts));
/* the page's helpers: shopDay (the shop's zone) and the locale's own date for a bare day (UTC), as helpers.js and engine/locale.js do */
globalThis.shopDay = (value) => fmt(value, 'Australia/Sydney');
globalThis.CBLocale = { date: (day) => fmt(day, 'UTC') };
require('../public/app/lock-words.js');
const W = globalThis.CBLockWords;
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ok   ' + name); };

ok('E14: a lock at 05:30 shop time on 17 Nov reads 17 Nov 2026, not the UTC day', () => {
  const said = W.whoOf({ lock_trail: [{ action: 'locked', to: 'soft_locked', at: '2026-11-16T19:30:00Z', by_name: 'Pat Lee' }] }, 'soft_locked');
  assert.strictEqual(said.line, 'Locked by Pat Lee · 17 Nov 2026');
});
ok('E14: a month locked before the trail existed (locked_at only) reads the shop day too', () => {
  assert.strictEqual(W.whoOf({ lock_trail: [], locked_at: '2026-11-16T19:30:00Z' }, 'soft_locked').line, 'Locked · 17 Nov 2026');
});
ok('E13: one word per state, from the server state names', () => {
  assert.deepStrictEqual(['open', 'soft_locked', 'hard_locked'].map(W.stateWord), ['Open', 'Locked', 'Closed for good']);
});
console.log('\n' + pass + ' passed');
