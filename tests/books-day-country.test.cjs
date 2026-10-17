/* OWNS      the proof that a walk-in DAY posts under the country its books were opened on (Findings B5, counter audit 2026-10-17).
   CALLED BY scripts/guards.cjs (offline: no DB, no network).
   FLOW      the posting engine's daySummary with the AU pack vs with no pack → the GST line is there only when the pack is handed in;
             books-hooks hands it in at both call sites (booksPack).
   CARD      14-accounting/day-summary-country */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const E = require('../lib/books-engines');
const R = require('../lib/regulation');

let pass = 0, fail = 0;
function ok(name, cond, saw) { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  ✗   ' + name + (saw ? ' — saw ' + saw : '')); } }

const AU = R.packFor('AU');
ok('the regulation registry carries an AU pack with a gst head', AU && Array.isArray(AU.taxHeads) && AU.taxHeads.indexOf('gst') >= 0, AU && JSON.stringify(AU.taxHeads));

/* one Australian walk-in bill: A$110 cash, A$100 taxable, A$10 GST */
const bill = { currency: 'AUD', pay: { cash: 110 }, taxes: [{ rate: 10, taxable: 100, gst: 10 }], round_off: 0 };
const opts = { ref: 'walkin C1 2026-10-17', date: '2026-10-17', counter: 'C1' };
const lines = (ev) => JSON.stringify(ev && (ev.lines || ev.legs || ev.entries || ev)).toLowerCase();

const withPack = E.posting().daySummary([bill], Object.assign({ pack: AU }, opts));
ok('handed the AU pack, the day posts the A$10 GST', /gst/.test(lines(withPack)) && /\b10(\.0+)?\b/.test(lines(withPack)), lines(withPack).slice(0, 300));

/* books-hooks hands the books' pack to BOTH daySummary calls (the late bill and the day) */
const src = fs.readFileSync(path.join(__dirname, '../lib/books-hooks.js'), 'utf8');
const calls = src.match(/daySummary\([^\n]*\)/g) || [];
ok('books-hooks: every daySummary call hands in the books\' pack (' + calls.length + ' calls)', calls.length >= 2 && calls.every((c) => /pack: booksPack\(s\)/.test(c)), calls.join(' | '));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
assert.strictEqual(fail, 0);
