/**
 * tests/sec-125b-db-boot-wait.test.cjs — SEC-125b (C12, 2026-11-12): db/index.js read DB_BOOT_WAIT_MS with Number(env || 15000), the fail-open class of SEC-125: a typo ("15s")
 * became NaN (a timer that fires at once, so the first request after a cold start fails), a negative number or "0x10" was taken as typed. It now goes through
 * lib/limits.intFromEnv (min 0: 0 is the documented "do not wait"): a typo, a blank or a negative is the 15 s default, a whole number is taken.
 * Run: node tests/sec-125b-db-boot-wait.test.cjs · no DB (the pool is never built here).
 */
'use strict';
const path = require('path');
process.env.DATABASE_URL = 'postgres://cb@127.0.0.1:5432/cb_test';
const db = require(path.join(__dirname, '..', 'db'));
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const waitFor = (value) => { if (value === undefined) delete process.env.DB_BOOT_WAIT_MS; else process.env.DB_BOOT_WAIT_MS = value; return db.bootWaitMs(); };

t('unset → 15000', waitFor(undefined) === 15000);
t('a valid whole number is taken ("2500" → 2500)', waitFor('2500') === 2500);
t('0 is taken: the documented "do not wait"', waitFor('0') === 0);
t('a typo ("15s") is the default, not NaN', waitFor('15s') === 15000);
t('a blank is the default', waitFor('') === 15000 && waitFor('   ') === 15000);
t('a negative is the default', waitFor('-5') === 15000);
t('a decimal / exponent is the default ("1e3", "2.5")', waitFor('1e3') === 15000 && waitFor('2.5') === 15000);
console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
