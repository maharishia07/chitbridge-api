'use strict';
/* l16-scale (5-year growth, 16 Nov 2026): the Day book and the Ledgers read ONE PAGE at a time from the server, never the whole range.
   - the Day book asks limit + order=desc (newest first) and "Older" asks the next page by the server's cursor;
   - a Ledger asks limit (oldest first: its running balance runs from the opening) and "Next" the following page;
   - the period stepper moves a day / a month / a financial year / a custom span back and forward, never past today;
   - a ledger line no longer reads the whole span's Day book a second time (the one-entry read by id stays).
   Run: node tests/books-paging.test.cjs */
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../public/app/cap-books.js', 'utf8');
const slice = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  assert(a > 0 && b > a, 'found ' + from);
  return src.slice(a, b);
};
const html = { node: null };
const ctx = {
  bkToday: () => '2026-11-16', esc: (v) => String(v), tx: (v) => v, bkMountAttribute: () => '', BK_PAGE: 100,
  document: { getElementById: () => ({ set innerHTML(v) { html.node = v; }, get innerHTML() { return html.node; }, querySelector: () => null }) }
};
vm.createContext(ctx);
vm.runInContext('var BK_PAGE = 100;\n' + slice('function bkDvOpenDay', '/** the next page joined') + slice('function bkPagerPaint', '/**\n * ══ THE LEDGERS ARE A FOLDER TREE') +slice('function bkDbStep', 'function bkDbPeriodLabel'), ctx);

const eq = (a, b, why) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), why); /* the context's objects are another realm's */
const step = (preset, from, to, dir) => ctx.bkDbStep({ preset, from, to }, dir);
eq(step('month', '2026-11-01', '2026-11-16', -1), { preset: 'month', from: '2026-10-01', to: '2026-10-31' }, 'a month back is the whole of the month before');
eq(step('month', '2026-10-01', '2026-10-31', 1), { preset: 'month', from: '2026-11-01', to: '2026-11-16' }, 'a month forward stops at today');
assert.strictEqual(step('month', '2026-11-01', '2026-11-16', 1), null, 'nothing after this month');
eq(step('fy', '2026-04-01', '2026-11-16', -1), { preset: 'fy', from: '2025-04-01', to: '2026-03-31' }, 'a year back is the whole financial year before');
assert.strictEqual(step('fy', '2026-04-01', '2026-11-16', 1), null, 'nothing after this year');
eq(step('today', '2026-11-16', '2026-11-16', -1), { preset: 'today', from: '2026-11-15', to: '2026-11-15' }, 'a day back');
eq(step('custom', '2026-10-10', '2026-10-19', -1), { preset: 'custom', from: '2026-09-30', to: '2026-10-09' }, 'a custom span moves by its own length');
eq(step('month', '2020-04-01', '2020-04-30', -1), { preset: 'month', from: '2020-03-01', to: '2020-03-31' }, 'back across years, 5 and 8 years down');
console.log('  ok  period stepper: day · month · financial year · custom, never past today');

assert.strictEqual(ctx.bkDvOpenDay({ next: 'a', entries: [{ posting_date: '2026-11-16' }] }, { to: '2026-11-16' }), true, 'a page still inside the last day, more behind it: read the next');
assert.strictEqual(ctx.bkDvOpenDay({ next: 'a', entries: [{ posting_date: '2026-11-15' }] }, { to: '2026-11-16' }), false, 'a page that reached an earlier day: the strip is whole');
assert.strictEqual(ctx.bkDvOpenDay({ next: null, entries: [{ posting_date: '2026-11-16' }] }, { to: '2026-11-16' }), false, 'nothing behind it: whole');
console.log('  ok  the last day is whole before the strip adds it up');

const hundred = Array.from({ length: 100 }, (_, n) => ({ n }));
ctx.bkPagerPaint('p', 'db', { entries: hundred, total: 7701, next: 'c' }, 'Older', 'newest first', () => {});
assert(/Older 100/.test(html.node) && /100 of 7701/.test(html.node) && /newest first/.test(html.node) && /data-cbsid="CMP037-B05"/.test(html.node), 'Older 100 · 100 of 7701 · newest first: ' + html.node);
ctx.bkPagerPaint('p', 'lg', { lines: hundred, total: 250, next: 'c' }, 'Next', 'oldest first', () => {});
assert(/Next 100/.test(html.node) && /oldest first/.test(html.node), 'a ledger says oldest first');
ctx.bkPagerPaint('p', 'db', { entries: hundred, total: 100, next: null }, 'Older', 'newest first', () => {});
assert.strictEqual(html.node, '', 'the whole range held: no pager line');
console.log('  ok  the pager says how many of how many, and which way');

/* the source: every Day book read is a page (or one entry by id), every Ledger read a page, and the span prefetch is gone */
const daybookReads = src.match(/api\('booksDaybook', \{ query: [^)]*\)/g) || [];
assert(daybookReads.length >= 3, 'the Day book reads are present');
daybookReads.forEach((read) => assert(/limit: BK_PAGE|entries: id/.test(read), 'a Day book read that is neither a page nor one entry: ' + read));
assert(/api\('booksLedger', \{ params: \{ account: sel\.code \}, query: Object\.assign\(\{ limit: BK_PAGE/.test(src), 'a Ledger read is a page');
assert(!/ds\[0\] \|\| bkRange\('lg'\)\.from/.test(src), 'the whole-span Day book read behind a ledger line is gone');
console.log('  ok  no whole-range read is left in the Day book or the Ledgers');
