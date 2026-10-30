/**
 * natdef-guard.test.cjs — NO INDIA FOR AN UNSTATED COUNTRY, ONE DATE READER (round T2-NATDEF, 14 Oct 2026). Offline; reads source only.
 *   1. zero `|| 'INR'` · `?? 'INR'` · `|| 'IN'` · `?? 'IN'` in lib/ · routes/ and the till master (tools/tally-connector/till.html) — the stated
 *      value (country-setup.currencyStated, the till's shopCur / docCountry) or the NO_MONEY / NO_COUNTRY words instead. Comment lines are history.
 *   2. no private date reader: `toISOString().slice(0, 10)` lives in lib/books-engines.js only (ymd · addDays) — a `date` column is read with
 *      books-engines ymd, a moment with books-hooks dayOf (shop-clock today), day arithmetic with books-engines addDays. ALLOW lists the lines
 *      that stamp a NOW instant into a LABEL (a file name, a key's name, a ticket subject), each with its reason; the count may only fall.
 *   3. no private ymd / addDays / dayKey definition outside books-engines unless it IS books-engines' (an alias line naming it).
 * Engine copies (a header "ADOPTED from chitbridge-engines") are not ours to edit (engines are serial) and are skipped.
 * Run: node tests/natdef-guard.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (why ? '\n          ' + why : '')); } };

const files = [];
for (const dir of ['lib', 'routes']) for (const f of fs.readdirSync(path.join(API, dir))) if (/\.(c?js)$/.test(f)) files.push(dir + '/' + f);
const src = (f) => fs.readFileSync(path.join(API, f), 'utf8').replace(/\r\n/g, '\n');
const adopted = (s) => /ADOPTED (BUNDLE )?from chitbridge-engines/.test(s.slice(0, 400));
const code = (l) => !/^\s*(\/\/|\*|\/\*)/.test(l);
const ours = files.filter((f) => !adopted(src(f)));

/* ── 1 · no national default ── */
const NATDEF = /(\|\||\?\?)\s*['"](INR|IN)['"]/;
const hits = [];
for (const f of ours.concat(['tools/tally-connector/till.html'])) src(f).split('\n').forEach((l, i) => { if (code(l) && NATDEF.test(l)) hits.push(f + ':' + (i + 1)); });
ok('zero `|| \'INR\'` / `|| \'IN\'` in lib, routes and the till master (' + hits.length + ')', hits.length === 0, hits.join(' · '));

/* ── 2 · one date reader ── */
const ALLOW = {
  'lib/raiseticket.js': [1, 'a support ticket\'s subject names the day it was raised — a label, the server\'s NOW'],
  'routes/connectors.js': [1, 'a signal chit\'s subject names the day it arrived — a label, the server\'s NOW'],
  'lib/forms.js': [1, 'a form field derived as "today" pre-fills an editable box — the person types over it'],
  'routes/integrations.js': [1, 'an API key\'s NAME carries the day it was minted — a label'],
  'routes/products.js': [2, 'the catalogue export\'s FILE NAME carries the day — a label'],
  'routes/counters.js': [1, 'a counter key\'s NAME carries the day it was paired — a label'],
  'lib/counters-store.js': [1, 'a counter key\'s NAME carries the day it was paired — a label (moved from routes/counters.js, S7)'],
  'routes/till.js': [1, 'a shop-screen key\'s NAME carries the day it was paired — a label'],
};
const SLICE = /toISOString\(\)\.slice\(0,\s*10\)/g;
const counts = {};
for (const f of ours) {
  if (f === 'lib/books-engines.js') continue;   /* THE reader */
  const n = src(f).split('\n').filter(code).reduce((t, l) => t + (l.match(SLICE) || []).length, 0);
  if (n) counts[f] = n;
}
const over = Object.keys(counts).filter((f) => !ALLOW[f] || counts[f] > ALLOW[f][0]);
ok('no private date reader outside books-engines — only the ' + Object.values(ALLOW).reduce((t, a) => t + a[0], 0) + ' allow-listed NOW labels',
  over.length === 0, over.map((f) => f + ' has ' + counts[f] + (ALLOW[f] ? ' (allowed ' + ALLOW[f][0] + ')' : ' (not allowed)')).join(' · '));
const stale = Object.keys(ALLOW).filter((f) => (counts[f] || 0) < ALLOW[f][0]);
ok('the allow-list is not looser than the code (ratchet: lower the number when a label goes)', stale.length === 0, stale.map((f) => f + ' has ' + (counts[f] || 0) + ', allowed ' + ALLOW[f][0]).join(' · '));

/* ── 3 · no private copy of the helpers ── */
const DEF = /(function\s+(ymd|addDays|dayKey)\w*\s*\(|(const|let|var)\s+(ymd|addDays|dayKey)\w*\s*=)/;
const copies = [];
for (const f of ours) {
  if (f === 'lib/books-engines.js') continue;
  src(f).split('\n').forEach((l, i) => { if (code(l) && DEF.test(l) && !/books-engines|\bE\.(ymd|addDays)\b/.test(l)) copies.push(f + ':' + (i + 1)); });
}
ok('no private ymd / addDays / dayKey — an alias names books-engines', copies.length === 0, copies.join(' · '));

/* ── the helpers themselves ── */
const E = require('../lib/books-engines');
ok('books-engines addDays: the calendar, across a month and a year', E.addDays('2026-10-31', 1) === '2026-11-01' && E.addDays('2026-12-31', 1) === '2027-01-01' && E.addDays('2026-03-01', -1) === '2026-02-28' && E.addDays(null, 1) === null);
const H = require('../lib/books-hooks');
ok('books-hooks zoneOf: nothing stated → UTC, never India', H.zoneOf('') === 'UTC' && H.zoneOf(null) === 'UTC' && H.zoneOf({}) === 'UTC' && H.zoneOf('IN') === 'Asia/Kolkata');
const CS = require('../lib/country-setup');
ok('country-setup currencyStated: the first stated, upper-cased; none → null', CS.currencyStated(null, ' aud ', 'INR') === 'AUD' && CS.currencyStated('', null, undefined) === null);
const B = require('../lib/bill-privacy');
ok('bill-privacy money: no currency → the amount alone, no ₹', B.money(123456, null) === '1,234.56' && B.money(123456, 'INR') === '₹1,234.56');

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
