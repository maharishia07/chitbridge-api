'use strict';
/**
 * tests/till-names.test.cjs - THREE COUNTER CONTROLS KEEP A REAL ACCESSIBLE NAME (axe select-name / label; Wave 1b on the customer pages).
 * A control named only by its title= is not named for axe: the mode select, the customer box and the quick-keys source select each carry
 * an aria-label as well (the title stays as the hover hint). Reads the master tools/tally-connector/till.html; no browser, no server.
 * Run: node tests/till-names.test.cjs     exit 1 on a failure
 */
const fs = require('fs'), path = require('path');
const till = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  x ' + m); } else console.log('  ok ' + m); };
const tag = (re) => (till.match(re) || [''])[0];
ok(/aria-label="[^"]+"/.test(tag(/<select class="modesel" id="modesel"[^>]*>/)), 'till: the mode select (#modesel) has an aria-label');
ok(/aria-label="[^"]+"/.test(tag(/<input id="cname"[^>]*>/)), 'till: the customer box (#cname) has an aria-label');
ok(/aria-label="[^"]+"/.test(tag(/<select class="qopt" data-testid="till-quick-src"[^>]*>/)), 'till: the quick-keys source select has an aria-label');
console.log(fails ? '\n' + fails + ' failure(s)' : '\nall passed');
process.exit(fails ? 1 : 0);
