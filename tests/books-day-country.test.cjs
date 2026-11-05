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
/* ⚠️ ACC-201 (lifecycle B3 S9-10/11): the engine reads the pack from its THIRD argument — daySummary(bills, head, { pack }) — and a pack
   handed inside the head resolves India in silence (by_rate then carries cgst/sgst/igst and the one GST head is dropped, so the day parks
   "debits 13.32 ≠ credits 12.11"). The old assertion here matched /gst/ on the event JSON, which "sgst" satisfies: it passed on the bug. */
const row = (ev) => (ev && ev.by_rate && ev.by_rate[0]) || {};
const withPack = E.posting().daySummary([bill], opts, { pack: AU });
ok('handed the AU pack (third argument), the day posts the A$10 GST on its ONE head', row(withPack).gst === 10 && row(withPack).taxable === 100, JSON.stringify(withPack.by_rate));
ok('…and no India head rides an AU day', !('cgst' in row(withPack)) && !('sgst' in row(withPack)) && !('igst' in row(withPack)), JSON.stringify(withPack.by_rate));
const inHead = E.posting().daySummary([bill], Object.assign({ pack: AU }, opts));
ok('the pack inside the HEAD is the bug: the GST is gone (the proof that the call shape matters)', row(inHead).gst === undefined, JSON.stringify(inHead.by_rate));

/* the AE twin (S9-11): AED 21.01 cash, 20.00 taxable, 1.01 VAT — one head, `vat` */
const AE = R.packFor('AE');
const aeDay = E.posting().daySummary([{ currency: 'AED', pay: { cash: 21.01 }, taxes: [{ rate: 5, taxable: 20, vat: 1.01 }], round_off: 0 }], opts, { pack: AE });
ok('handed the AE pack, the day posts AED 1.01 VAT on its one head', AE && row(aeDay).vat === 1.01 && row(aeDay).taxable === 20 && !('cgst' in row(aeDay)), JSON.stringify(aeDay.by_rate));

/* books-hooks hands the books' pack to BOTH daySummary calls (the late bill and the day) — as the third argument */
const src = fs.readFileSync(path.join(__dirname, '../lib/books-hooks.js'), 'utf8');
const calls = src.match(/daySummary\([^\n]*\)/g) || [];
ok('books-hooks: every daySummary call hands in the books\' pack as the third argument (' + calls.length + ' calls)', calls.length >= 2 && calls.every((c) => /\}, \{ pack: booksPack\(\w+\) \}\)/.test(c)), calls.join(' | '));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
assert.strictEqual(fail, 0);
