#!/usr/bin/env node
/* practice-checked-cell.cjs — REP-73 W3 (Athi, 16 Nov): the Checked FY cell says the share WITH the counts, rounds DOWN, never shows 100% unless all are checked, and sorts by entries still to check.
 * Run: node e2e/practice-checked-cell.cjs   (no browser: the page file is loaded against a stub window) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = { Promise, tx: (s) => s, document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, querySelector: () => null, getElementById: () => null }, location: { hostname: 'x' } };
for (const part of ['books-practice-band.js', 'books-practice-cells.js', 'books-practice.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', part), 'utf8'), { window: root, globalThis: root, setInterval() {}, setTimeout() {} }, {});
const P = root.CBPractice;
let bad = 0;
const t = (n, f) => { try { f(); console.log('  ok  ', n); } catch (e) { bad++; console.log('  FAIL', n, '\n      ', e.message); } };
t('98% with its counts', () => assert.strictEqual(P.checkedWords({ checked: 465, of: 473 }), '98% · 465 of 473'));
t('all checked says so', () => assert.strictEqual(P.checkedWords({ checked: 477, of: 477 }), 'All 477 checked'));
t('rounds down, never 100% short of all: 999 of 1000 is 99%, 472 of 473 is 99%', () => {
  assert.strictEqual(P.checkedWords({ checked: 999, of: 1000 }), '99% · 999 of 1000');
  assert.strictEqual(P.checkedWords({ checked: 472, of: 473 }), '99% · 472 of 473');
});
t('none checked is 0%; no entries and no figure are words, not 0/0', () => {
  assert.strictEqual(P.checkedWords({ checked: 0, of: 12 }), '0% · 0 of 12');
  assert.strictEqual(P.checkedWords({ checked: 0, of: 0 }), 'No entries');
  assert.strictEqual(P.checkedWords(null), '—');
});
t('sorts by entries still to check: 5% of a big book (950 left) is above 50% of a small one (5 left)', () => {
  const r = (c, o) => ({ year_end: { entries: { checked: c, of: o } } });
  assert.ok(P.checkedLeft(r(50, 1000)) > P.checkedLeft(r(5, 10)));
  assert.strictEqual(P.checkedLeft({ year_end: null }), -1);
});
process.exit(bad ? 1 : 0);
