'use strict';
/**
 * acc-313-pack-shop-day.test.cjs — ACC-313: the exit pack ends on the SHOP's today, never the UTC date.
 * An AU shop at 00:31 on 9 Nov (13:31 UTC on 8 Nov) posts on 9 Nov; a pack ending 8 Nov cannot hold that entry (the 422 of DATA-H12).
 * Hand-computed (Australia/Sydney is UTC+10 standard, UTC+11 from 02:00 on 2026-10-04 and back to +10 at 03:00 on 2027-04-04; Asia/Kolkata UTC+5:30):
 *   2026-11-08T13:31Z = 2026-11-09 00:31 AEDT          2026-11-08T19:00Z = 2026-11-09 00:30 IST
 *   2026-10-03T15:59Z = 2026-10-04 01:59 AEST (before the jump)   2026-10-03T16:00Z = 2026-10-04 03:00 AEDT (02:00 never exists)
 *   2027-04-03T15:30Z = 2027-04-04 02:30 AEDT (first pass of the repeated hour)   2027-04-03T16:30Z = 2027-04-04 02:30 AEST (second pass)
 *   2026-11-08T09:00Z = 2026-11-08 20:00 AEDT (same day in both: control)
 * Run: node tests/acc-313-pack-shop-day.test.cjs   · no DB, no network.
 */
process.env.SHOP_CLOCK_ALLOW = '1';
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
const CLOCK = require(path.join(API, 'lib', 'shop-clock'));
const PACK = require(path.join(API, 'lib', 'books-pack'));
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '  got ' + got + '  want ' + want); } };
const dayAt = (moment, setting, opt) => { CLOCK.set(moment); return PACK.shopToday(opt || {}, setting); };

const SYD = { country: 'AU', timezone: 'Australia/Sydney' }, KOL = { country: 'IN', timezone: 'Asia/Kolkata' };
eq('AU 13:31 UTC on 8 Nov is 9 Nov in Sydney (the DATA-H12 case)', dayAt('2026-11-08T13:31:00Z', SYD), '2026-11-09');
eq('IN 19:00 UTC on 8 Nov is 9 Nov in Kolkata', dayAt('2026-11-08T19:00:00Z', KOL), '2026-11-09');
eq('IN 18:29 UTC is still 8 Nov in Kolkata (23:59)', dayAt('2026-11-08T18:29:00Z', KOL), '2026-11-08');
eq('AU 09:00 UTC: same day both sides (control)', dayAt('2026-11-08T09:00:00Z', SYD), '2026-11-08');
eq('DST start, 01:59 AEST on 4 Oct (15:59Z on 3 Oct)', dayAt('2026-10-03T15:59:00Z', SYD), '2026-10-04');
eq('DST start, 03:00 AEDT on 4 Oct (16:00Z on 3 Oct)', dayAt('2026-10-03T16:00:00Z', SYD), '2026-10-04');
eq('DST end, 02:30 AEDT on 4 Apr 2027 (15:30Z on 3 Apr)', dayAt('2027-04-03T15:30:00Z', SYD), '2027-04-04');
eq('DST end, repeated hour 02:30 AEST (16:30Z on 3 Apr)', dayAt('2027-04-03T16:30:00Z', SYD), '2027-04-04');
eq('a shop with only a country (AU) is cut at its pack zone, not UTC', dayAt('2026-11-08T13:31:00Z', { country: 'AU' }), '2026-11-09');
eq('a given day wins (a caller that names the day)', dayAt('2026-11-08T13:31:00Z', SYD, { today: '2026-11-01' }), '2026-11-01');
CLOCK.reset();

const src = fs.readFileSync(path.join(API, 'lib', 'books-pack.js'), 'utf8');
eq('build reads the day from the shop setting inside the ledger read, not a zone-less CLOCK.today()', /shopToday\(o, c\.s\)/.test(src) && !/CLOCK\.today\(\)/.test(src), true);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
