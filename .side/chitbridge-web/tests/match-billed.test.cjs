/**
 * tests/match-billed.test.cjs - OPS-100/351 (web twin of api #1243): the three-way match screen paints the quantity the supplier BILLED, and a line billed more than received is bad.
 *
 * OWNS      the proof that, in public/app/cap-match.js, a line with billed_more and difference 0 (ordered 5, received 5, billed 6) is warned, not "agrees", and says "Billed more than received";
 *           that billed is painted beside received (billed 6 kg); that a null billed is never painted as 0 ("billed in <unit>" when only the unit is known, nothing when neither);
 *           that the dispute draft lists the billed_more line; that orders[].billed_unmatched shows as a small count only when > 0;
 *           and that an old answer without the new fields renders exactly as before.
 * CALLED BY package.json check script · .github/workflows/ci.yml (web job). The real cap-match.js in node, stubs for the page helpers.
 * FLOW      GET /api/till/match line -> matchDetail (table row) / matchDispute (draft in the modal)
 * CARD      03-disputes-service-and-register/three-way-match
 * UNIT      03/Three-way match (billed quantity)
 * MUTATION  checked: in matchDiffWords() drop the billed_more push -> bad-line and dispute checks go red; in matchBilledWords() return String(item.billed || 0) -> the null check goes red.
 * Run: node tests/match-billed.test.cjs        (CAPM_FILE=<path> aims it at another copy of cap-match.js: the mutation check)
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

const base = { unit: 'kg', reason: null, state: 'agreed', difference: 0 };
const more = { ...base, line_id: 'a', name: 'Rice', ordered: 5, received: 5, billed: 6, billed_unit: 'kg', billed_more: true };
const nullBilled = { ...base, line_id: 'b', name: 'Oil', ordered: 2, received: 2, billed: null, billed_unit: 'L', billed_more: false };
const noBill = { ...base, line_id: 'c', name: 'Tea', ordered: 1, received: 1, billed: null, billed_more: false };
const old = { ...base, line_id: 'd', name: 'Salt', ordered: 3, received: 3 };
const oldShort = { ...base, line_id: 'e', name: 'Sugar', ordered: 10, received: 7, difference: -3, state: 'short', reason: 'broken' };
const order = (lines, extra) => ({ chit_id: 'c1', party: 'Acme', verdict: 'differs', lines, receipts: [], ordered_total: 1, invoiced_total: 1, ...extra });
const rowsOf = (o) => matchDetail(o, null).split('data-testid="match-line"').slice(1);

const rows = rowsOf(order([more, nullBilled, noBill, old, oldShort]));
assert.strictEqual(rows.length, 5, 'five lines drawn');
assert(
  rows[0].includes('Billed more than received') && !rows[0].includes('agrees') && rows[0].includes('var(--warn)'),
  'billed_more with difference 0 is bad: warned, says why, not "agrees"'
);
assert(rows[0].includes('data-testid="match-billed">billed 6 kg<'), 'billed 6 kg is painted beside received');
assert(rows[1].includes('billed in L') && !/billed 0|>0</.test(rows[1]), 'null billed with a unit: "billed in L", never 0');
assert(!rows[2].includes('match-billed') && !/billed/.test(rows[2]), 'null billed, no unit: nothing painted');
assert(rows[2].includes('agrees'), 'unknown billed does not make a line bad');
assert(!rows[3].includes('match-billed') && rows[3].includes('agrees'), 'old answer (fields absent) renders as before: agrees, no billed');
assert(rows[4].includes('short 3') && rows[4].includes('broken') && !rows[4].includes('billed'), 'old short line unchanged');
assert(!/undefined|NaN/.test(rows.join('')), 'no undefined in any row');

const zero = rowsOf(order([{ ...more, billed: 0, billed_more: false }]))[0];
assert(zero.includes('billed 0 kg'), 'a real billed 0 is painted as 0 (known, not unknown)');

MATCH.rows = [order([more, nullBilled, old, oldShort])];
matchDispute('c1');
const draft = modalHtml.replace(/&amp;/g, '&');
assert(draft.includes('Rice: ordered 5 kg, received 5, billed 6 kg (Billed more than received)'), 'dispute draft lists the billed_more line with the billed figure');
assert(!draft.includes('Oil:') && !draft.includes('Salt:'), 'dispute draft leaves out lines that agree');
assert(draft.includes('Sugar: ordered 10 kg, received 7 (short 3) — broken'), 'dispute draft: old short line unchanged');

assert(matchDetail(order([old], { billed_unmatched: 2 }), null).includes('match-billed-unmatched">Billed lines not on your order: 2<'), 'billed_unmatched > 0 shows its count');
assert(!matchDetail(order([old], { billed_unmatched: 0 }), null).includes('match-billed-unmatched'), 'billed_unmatched 0: nothing');
assert(!matchDetail(order([old]), null).includes('match-billed-unmatched'), 'billed_unmatched absent: nothing');

const KEY = 'Billed more than received';
const keep = globalThis.tx;
globalThis.tx = (e) => (e === KEY ? 'Mehr berechnet als erhalten' : e);
assert(rowsOf(order([more]))[0].includes('Mehr berechnet als erhalten'), 'the reason goes through the string layer');
globalThis.tx = keep;
console.log('ok match-billed: 15 checks');
