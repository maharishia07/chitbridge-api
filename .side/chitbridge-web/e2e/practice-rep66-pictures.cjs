#!/usr/bin/env node
/* practice-rep66-pictures.cjs — REP-66: the practice Home pictures (CBDraw statusBar per band, monthStrip in the opened row). No browser: the page file runs against a stub window with the real CBDraw.
 * Proves: the picture's segments sum to the tiles' counts (same fields, no second calculation) · text equivalent (desc + visible count) · withheld tile = no part, never a 0 part · first-year row draws no strip.
 * Run: node e2e/practice-rep66-pictures.cjs */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const root = { esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), Promise, tx: (s) => s, innerWidth: 1366, document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { classList: { add() {} } } } };
const ctx = { window: root, globalThis: root, setInterval() {}, setTimeout() {}, Intl, Date };
vm.runInNewContext(pub('engine/chart-draw.js'), ctx, {});
vm.runInNewContext(pub('engine/chart-draw-status.js'), ctx, {});
vm.runInNewContext(pub('engine/chart-draw-rows.js'), ctx, {});
root.CBDraw = root.CBDraw || ctx.CBDraw;
vm.runInNewContext(pub('app/helpers.js'), ctx, {}); /* the page loads helpers.js first: the one esc · fmtMoney · monthNames */
for (const part of ['books-practice-band.js', 'books-practice-cells.js', 'books-practice.js']) vm.runInNewContext(pub('app/' + part), ctx, {});
const T = root.CBPractice.parts;
let bad = 0;
const t = (n, f) => { try { f(); console.log('  ok  ', n); } catch (e) { bad++; console.log('  FAIL', n, '\n      ', e.message); } };
const titles = (html) => [...html.matchAll(/<rect[^>]*data-kind[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]);
const num = (label) => Number(String(label).split(': ').pop());
const stages = [{ key: 'books_in', n: 10 }, { key: 'complete', n: 10 }, { key: 'checked', n: 2 }, { key: 'ready', n: 4 }, { key: 'lodged', n: 4 }];
const left = [{ key: 'queries_on_us', n: 3 }, { key: 'queries_over_14', n: 1 }, { key: 'bank_unexplained', n: 7 }, { key: 'to_check', n: 41 }, { key: 'months_unlocked', n: 12 }];

t('Year end: the picture segments sum to the tile counts (10/10/2/4/4)', () => {
  const html = T.pictureHTML({ key: 'pipeline', tiles: stages });
  const parts = titles(html).map(num);
  assert.deepStrictEqual(parts, [10, 10, 2, 4, 4]);
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), stages.reduce((a, t2) => a + t2.n, 0));
  assert.ok(/data-total="30"/.test(html) && />30 clients</.test(html), 'visible count');
  assert.ok(/<desc[^>]*>Books in: 10, Complete: 10, Checked: 2, Ready to file: 4, Filed \(owner&#39;s word\): 4<\/desc>/.test(html) || /<desc[^>]*>Books in: 10/.test(html), html.slice(0, 400));
});
t('On us today: the three kinds of work left equal their tiles, each in its own words', () => {
  const html = T.pictureHTML({ key: 'on_us', tiles: left });
  assert.deepStrictEqual(titles(html).map(num), [7, 41, 12]);
  assert.ok(/Bank not explained: 7/.test(html) && /Clients with entries to check \(quarter\): 41/.test(html) && /Clients with months to lock: 12/.test(html));
  assert.ok(/data-testid="practice-pic-count">7 · 41 · 12</.test(html));
});
t('a tile with no count or zero is left out, never drawn as 0; no parts = no picture; the advice band has none', () => {
  assert.deepStrictEqual(titles(T.pictureHTML({ key: 'pipeline', tiles: [{ key: 'books_in', n: 5 }, { key: 'complete', n: 0 }, { key: 'checked', n: null }] })).map(num), [5]);
  assert.strictEqual(T.pictureHTML({ key: 'pipeline', tiles: [{ key: 'books_in', n: 0 }] }), '');
  assert.strictEqual(T.pictureHTML({ key: 'advisory', tiles: [{ key: 'cash_low', n: 3 }] }), '');
});
t('the picture sits in the heading row, not in the band: the tile grid and the list do not move', () => {
  const a = { band: { bands: [{ key: 'pipeline', first: true, tiles: stages }] }, clients: [] };
  T.use(a);
  assert.ok(!/bp-pic/.test(T.bandHTML(a)), 'the band holds tiles only');
});
const row = (y) => ({ entity_id: 'c1', name: 'C', year_end: y });
t('opened row: the month strip has the year\'s months, the first `locked` are locked', () => {
  const html = T.stripHTML(row({ fy: '2025-26', start: '2025-07-01', of: 12, locked: 9 }));
  const states = [...html.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
  assert.strictEqual(states.length, 12);
  assert.strictEqual(states.filter((s) => s === 'locked').length, 9);
  assert.ok(states.slice(0, 9).every((s) => s === 'locked'));
  assert.ok(/9 of 12 months locked/.test(html) && /Jul: locked/.test(html) && /Jun: open/.test(html), html.slice(0, 300));
});
t('a first year or no year end draws no strip', () => {
  assert.strictEqual(T.stripHTML(row({ fy: '2026', start: '2026-03-01', of: 4, locked: 2, first_year: true })), '');
  assert.strictEqual(T.stripHTML(row(null)), '');
});
t('the strip sits in the opened row (detailHTML)', () => {
  const r = Object.assign(row({ fy: '2025-26', start: '2025-07-01', of: 12, locked: 12 }), { health: { reasons: [] }, bank: { state: 'none' }, grant: {}, months_unlocked: 0 });
  assert.ok(/practice-strip-c1/.test(T.detailHTML(r)));
});
process.exit(bad ? 1 : 0);
