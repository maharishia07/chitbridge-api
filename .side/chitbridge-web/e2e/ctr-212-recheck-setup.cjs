#!/usr/bin/env node
/**
 * e2e/ctr-212-recheck-setup.cjs — CTR-212 S0 (web): the "Check prices again before each bill" question is ASKED, never pre-answered.
 * OWNS      a source-level proof (no browser) that (1) Catalogue setup › Pricing carries the question with Yes and No and NO pre-selected answer while the server says
 *           nobody answered, (2) it writes through the one settings door (policySet, flag recheck_prices), (3) Settings › Policy reads the server's `asked` and shows
 *           "Not answered yet" with an empty first option, never the default "Off". The browser walk runs on the SIT box (e2e/walk-setup).
 * CALLED BY by hand and the web checks; exit 1 on a miss.
 * FLOW      read public/app/cap-catsetup.js + cap-settings.js → assert the markers.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
const setup = read('cap-catsetup.js'), settings = read('cap-settings.js');
let failed = 0;
const ok = (name, fn) => { try { fn(); console.log('   ok   ' + name); } catch (e) { failed++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
ok('the question card has Yes and No, with ids, and the state starts as "Not answered yet" (nothing pre-selected)', () => {
  assert.match(setup, /data-ui-id="catset-recheck-' \+ \(value === 'on' \? 'yes' : 'no'\)/);
  assert.match(setup, /: tx\('Not answered yet'\)/); assert.match(setup, /aria-pressed="' \+ \(CATSET_RECHECK === value\)/);
  assert.match(setup, /Do your prices change often\? Check them again before each bill\./);
});
ok('it reads asked from GET /entities/policy and writes only through policySet recheck_prices', () => {
  assert.match(setup, /\(reply && reply\.asked\) \|\| \{\}\)\.recheck_prices === true/); assert.match(setup, /api\('policySet', \{ body: \{ recheck_prices: value \} \}\)/);
});
ok('Settings › Policy carries asked on each row and paints "Not answered yet" with an empty disabled first option', () => {
  assert.match(settings, /asked: \(r\.asked \|\| \{\}\)\[item\.key\]/); assert.match(settings, /if \(x\.asked === false\) return T\('Not answered yet'\)/);
  assert.match(settings, /<option value="" disabled selected>/);
});
process.exit(failed ? 1 : 0);
