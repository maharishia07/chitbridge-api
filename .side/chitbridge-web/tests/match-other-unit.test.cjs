/**
 * tests/match-other-unit.test.cjs - CTR-248 (web twin of api #1194, OPS-87): the three-way match screen, public/app/cap-match.js, with no browser.
 *
 * OWNS      the proof that a line the api marks counted_in_another_unit (ordered 10 box, received 0, 2 dozen counted) reads
 *           "counted in another unit: dozen mine 2 / theirs 0" in the Difference cell AND in the dispute draft, after any shortfall or excess in the ordered unit ("short 6 · counted ..."), and a line with difference 0 is still warned and in the draft,
 *           with one segment per other_units entry joined " · ", and that an ordinary short / excess line still reads short / excess.
 *           A figure the api did not send (the screen could not read it) is said as a dash in words, never "undefined"; the other-unit words go through the string layer (a locale catalogue translates them).
 * CALLED BY package.json check script · .github/workflows/ci.yml (web job). The real cap-match.js in node, stubs for the page helpers.
 * FLOW      GET /api/till/match line -> matchDetail (table row) / matchDispute (draft in the modal)
 * CARD      03-disputes-service-and-register/three-way-match
 * UNIT      03/Three-way match (other-unit line)
 * MUTATION  checked: in cap-match.js make matchOtherUnits() return '' -> every other-unit check below goes red.
 * Run: node tests/match-other-unit.test.cjs        (CAPM_FILE=<path> aims it at another copy of cap-match.js: the mutation check)
 */
'use strict';
const path = require('path'),
  fs = require('fs'),
  assert = require('assert');
const FILE = process.env.CAPM_FILE || path.join(__dirname, '..', 'public', 'app', 'cap-match.js');

globalThis.window = globalThis;
const helpers = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8');
const m = helpers.match(/function esc\([\s\S]*?\n\}\n/);
assert(m, 'helpers.js has esc');
(0, eval)(m[0] + ';globalThis.esc = esc;');
globalThis.tx = (s) => s;
globalThis.txf = (s, v) => globalThis.tx(s).replace(/\{(\w+)\}/g, (w, k) => (v && k in v ? String(v[k]) : w));
globalThis.inr = (n) => String(n);
globalThis.fmtMoney = (n) => String(n);
globalThis.myCur = () => 'INR';
let modalHtml = '';
globalThis.modal = (h) => {
  modalHtml = h;
};
(0, eval)(fs.readFileSync(FILE, 'utf8'));

const other = {
  line_id: 'a',
  name: 'Eggs',
  unit: 'box',
  ordered: 10,
  received: 0,
  difference: -10,
  reason: null,
  state: 'other_unit',
  counted_in_another_unit: true,
  other_units: [
    { unit: 'dozen', mine: 2, theirs: 0 },
    { unit: 'piece', mine: 5, theirs: 3 }
  ]
};
const plain = { line_id: 'b', name: 'Oil', unit: 'L', ordered: 10, received: 7, difference: -3, reason: 'broken', state: 'short' };
const mixed = {
  line_id: 'm',
  name: 'Milk',
  unit: 'box',
  ordered: 10,
  received: 4,
  difference: -6,
  reason: null,
  state: 'short',
  counted_in_another_unit: true,
  other_units: [{ unit: 'dozen', mine: 2, theirs: 2 }]
};
const same = {
  line_id: 's',
  name: 'Rice',
  unit: 'bag',
  ordered: 5,
  received: 5,
  difference: 0,
  reason: null,
  state: 'agreed',
  counted_in_another_unit: true,
  other_units: [{ unit: 'kg', mine: 3, theirs: 4 }]
};
const bare = {
  line_id: 'u',
  name: 'Tea',
  unit: 'box',
  ordered: 1,
  received: 1,
  difference: 0,
  reason: null,
  state: 'agreed',
  counted_in_another_unit: true,
  other_units: [{ unit: 'tin' }]
};
const order = { chit_id: 'c1', party: 'Acme', verdict: 'differs', lines: [other, plain, mixed, same, bare], receipts: [], ordered_total: 1, invoiced_total: 1 };

const html = matchDetail(order, null);
const rows = html.split('data-testid="match-line"').slice(1);
assert.strictEqual(rows.length, 5, 'five lines drawn');
const seg = 'counted in another unit: dozen mine 2 / theirs 0 · counted in another unit: piece mine 5 / theirs 3';
assert(rows[0].includes(seg), 'other-unit line: one segment per unit, joined');
assert(rows[0].includes('short 10 · ' + seg.slice(0, 20)), 'received 0 in the ordered unit: the shortfall is still told, then the other-unit words');
assert(
  rows[1].includes('short 3') && rows[1].includes('broken') && !rows[1].includes('another unit'),
  'a plain short line still reads short 3 with its reason'
);
assert(rows[2].includes('short 6 · counted in another unit: dozen mine 2 / theirs 2'), 'hidden shortfall: short 6 AND the other-unit words');
assert(
  rows[3].includes('counted in another unit: kg mine 3 / theirs 4') && !rows[3].includes('agrees') && rows[3].includes('var(--warn)'),
  'difference 0 but another unit: warned, not "agrees"'
);
assert(rows[4].includes('mine — / theirs —') && !/undefined|NaN/.test(rows[4]), 'missing mine/theirs: dashes, never undefined');

MATCH.rows = [order];
matchDispute('c1');
const draft = modalHtml.replace(/&amp;/g, '&');
assert(draft.includes('Eggs: ordered 10 box, received 0 (short 10 · ' + seg.slice(0, 20)), 'dispute draft carries the other-unit words');
assert(
  draft.includes('Milk: ordered 10 box, received 4 (short 6 · counted in another unit: dozen mine 2 / theirs 2)'),
  'dispute draft: hidden shortfall and other unit'
);
assert(
  draft.includes('Rice: ordered 5 bag, received 5 (counted in another unit: kg mine 3 / theirs 4)'),
  'dispute draft keeps an other-unit line whose ordered-unit difference is 0'
);
assert(draft.includes('Oil: ordered 10 L, received 7 (short 3) — broken'), 'dispute draft: plain line unchanged');
/* the string layer: the words go through tx, so another locale's catalogue translates them (no English baked into the cell or the draft) */
const KEY = 'counted in another unit: {unit} mine {mine} / theirs {theirs}';
const keep = globalThis.tx;
globalThis.tx = (e) => (e === KEY ? 'in anderer Einheit gezaehlt: {unit} meine {mine} / ihre {theirs}' : e);
const german = matchDetail(order, null);
globalThis.tx = keep;
assert(
  german.includes('in anderer Einheit gezaehlt: kg meine 3 / ihre 4') && !german.includes('counted in another unit'),
  'the locale catalogue translates the other-unit words'
);
console.log('ok match-other-unit: 11 checks');
