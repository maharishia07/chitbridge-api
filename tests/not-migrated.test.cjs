#!/usr/bin/env node
// @type: unit
/**
 * OWNS      the proof that lib/not-migrated.js words a "waiting for the update" answer in plain words, and that no user-facing string in lib/ or routes/ names a migration id.
 * CALLED BY the guards (node tests/not-migrated.test.cjs)
 * FLOW      waiting() → sentence → no b<digits> in it · scan of lib/ and routes/ for message/error/detail strings with a migration id
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { waiting } = require('../lib/not-migrated');
let bad = 0;
const check = (name, ok) => { if (!ok) bad += 1; console.log((ok ? '  ok   ' : '  FAIL ') + name); };
const ID = /\bb[0-9]{2,3}\b/;
check('singular reads "X arrives after the next update."', waiting('The asset register') === 'The asset register arrives after the next update. Everything else works meanwhile.');
check('plural reads "X arrive"', /^Channels arrive after/.test(waiting('Channels', true)));
check('the meanwhile can be said exactly', waiting('Unit and source', true, 'Type, label and required still work.').endsWith('Type, label and required still work.'));
check('refusal path: a missing subject still reads as a sentence, never throws, never carries an id', (() => { try { return !ID.test(waiting(undefined)) && /after the next update/.test(waiting(undefined)); } catch (e) { return false; } })());
check('fail-closed: the sentence never promises a date or a number it cannot keep', !/[0-9]/.test(waiting('Stores', true)));
check('no sentence carries a migration id', !ID.test(waiting('Stores', true)));
/* the sites this change moved: none of these files may put a migration id in a string handed to a person */
const SITES = ['lib/books-contract.js', 'lib/books-assets.js', 'lib/books-recurring.js', 'lib/assist-contract.js', 'lib/channels.js', 'lib/stores.js', 'lib/profile.js', 'routes/identity-docs.js', 'lib/bell-contract.js', 'lib/crm-contract.js', 'lib/privacy.js', 'lib/fx-rates.js'];
for (const f of SITES) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const leaks = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/when:/.test(l) && /(message|detail|hint|error|Error\()[^\n]*['"`][^'"`\n]*\bb[0-9]{2,3}\b/.test(l));
  check(f + ' keeps migration ids out of the words', leaks.length === 0);
}
console.log('\n  ' + (bad ? bad + ' failed' : 'all passed'));
process.exit(bad ? 1 : 0);
