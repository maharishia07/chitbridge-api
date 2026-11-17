'use strict';
/**
 * e2e/signin-code.test.cjs — SEC1b (TEMPORARY, testing phase only): the e2e types TODAY's tester code when E2E_TESTER_CODE carries
 * {yymmdd} / {yyyymmdd}, filled in Asia/Kolkata like the api. With the twin api beside it (../chitbridge-api or CB_API_REPO, with its
 * node_modules), the api's OWN testerCodeOk is asked whether what this types is accepted — the mirror cannot drift unseen.
 * Run: node e2e/signin-code.test.cjs · no network, no browser.
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const { fillDay } = require('./lib/signin-code.cjs');
const IST = (s) => Date.parse(s + '+05:30');

console.log('\nSEC1b · the e2e types today\'s tester code\n');
delete process.env.E2E_TESTER_CODE_TZ;
t('{yymmdd} → 261014 on 14 Oct IST', fillDay('qa-{yymmdd}-lamp', IST('2026-10-14T10:00:00')) === 'qa-261014-lamp');
t('{yyyymmdd} → 20261014', fillDay('Q{yyyymmdd}', IST('2026-10-14T10:00:00')) === 'Q20261014');
t('India\'s day, not the runner\'s UTC (00:30 IST = the 13th in UTC)', fillDay('qa-{yymmdd}-lamp', Date.parse('2026-10-13T19:00:00Z')) === 'qa-261014-lamp');
t('a static code is unchanged', fillDay('tq7-Lantern-42', IST('2026-10-14T10:00:00')) === 'tq7-Lantern-42');
t('twice in a row gives the same answer (no regex state)', fillDay('a{yymmdd}bc', 0) === fillDay('a{yymmdd}bc', 0));
process.env.E2E_TESTER_CODE_TZ = 'Australia/Sydney';
t('E2E_TESTER_CODE_TZ overrides the zone', fillDay('qa-{yymmdd}-lamp', Date.parse('2026-10-14T15:00:00Z')) === 'qa-261015-lamp');
delete process.env.E2E_TESTER_CODE_TZ;

const API = process.env.CB_API_REPO || path.join(__dirname, '..', '..', 'chitbridge-api');
let dev = null, clock = null;
try {
  if (fs.existsSync(path.join(API, 'node_modules'))) {
    process.env.SHOP_CLOCK_ALLOW = '1';
    clock = require(path.join(API, 'lib', 'shop-clock'));
    dev = require(path.join(API, 'lib', 'dev-otp'));
  }
} catch (e) { console.log('  ·  the twin api could not be loaded (' + e.message + ') — the cross-check is skipped, the fill above still holds'); dev = null; }
if (dev && dev.testerNotices) {
  process.env.TESTER_CODE = 'qa-{yymmdd}-lamp';
  for (const at of ['2026-10-14T10:00:00', '2026-10-14T00:30:00', '2026-12-31T23:59:00', '2027-01-01T05:00:00']) {
    clock.set(IST(at));
    t('the api accepts what the e2e types at ' + at + ' IST', dev.testerCodeOk(fillDay('qa-{yymmdd}-lamp', IST(at))) === true);
  }
  clock.reset();
  delete process.env.TESTER_CODE;
} else console.log('  ·  no twin api with node_modules beside this checkout — cross-check skipped (the CI api checkout has none)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
