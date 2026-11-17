#!/usr/bin/env node
/* practice-rep73-fable.cjs — REP-73 Fable gate (16 Nov): B1 stage in the row · B2 columns follow the band · B6 one name per stage, from the server's words · B7 "costs not shared", never 0 · W9 firm Home keeps no shop cards.
 * Run: node e2e/practice-rep73-fable.cjs   (no browser: the page file is loaded against a stub window) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = { Promise, tx: (s) => s, document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { classList: { add() {}, remove() {}, toggle() {} } }, querySelector: () => null, getElementById: () => null }, location: { hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} } };
/* the page loads helpers.js first (the one esc · fmtMoney · monthNames); so does this sandbox */
const sandbox = vm.createContext({ module: { exports: {} }, window: root, globalThis: root, setInterval() {}, setTimeout() {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine', 'money.js'), 'utf8'), sandbox, { filename: 'money.js' });
sandbox.CBMoney = sandbox.module.exports;
for (const part of ['helpers.js', 'books-practice-band.js', 'books-practice-cells.js', 'books-practice.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', part), 'utf8'), sandbox, { filename: part });
const P = root.CBPractice, T = P.parts || {};
let bad = 0;
const t = (n, f) => { try { f(); console.log('  ok  ', n); } catch (e) { bad++; console.log('  FAIL', n, '\n      ', e.message); } };
const row = (o) => Object.assign({ entity_id: 'c1', currency: 'AUD', name: 'C', stage: 'lodged', stage_blocker: null, year_end: { fy: '2025-26', of: 12, locked: 12, bank_to_end: true, end: '2026-06-30' }, queries: { open: 0 }, bank: { state: 'reconciled' }, health: { status: 'good', words: 'Doing well', reasons: [], withheld: { costs: null, currencies: null }, gross_margin_pct: 40, profit_quarter_minor: 500, cash_minor: 900 }, checked: { n: 1, of: 1 }, months_unlocked: 0, grant: { can_see_costs: true } }, o || {});
const WORDS = { ready: 'Ready to lodge', done: "Lodged (owner's word)" };
const answer = (tiles, extra) => Object.assign({ band: { bands: [{ key: 'pipeline', first: true, tiles }] }, clients: [row()], words: WORDS }, extra || {});
const cols = () => { const o = {}; T.columns().forEach((c) => { o[c.key] = c; }); return o; };

t('B1 the Year end cell names the stage: Lodged and Ready rows differ', () => {
  T.use(answer([]));
  const a = T.yendCell(row({ stage: 'lodged' })), b = T.yendCell(row({ stage: 'ready' }));
  assert.ok(/Lodged/.test(a), a); assert.ok(/Ready to lodge/.test(b), b); assert.notStrictEqual(a, b);
});
t('B1 the blocker is in words from stage_blocker', () => {
  const y = { fy: '2025-26', of: 12, locked: 9, bank_to_end: true, end: '2026-06-30' };
  assert.ok(/3 months not locked/.test(T.yendCell(row({ stage: 'books_in', stage_blocker: 'months', year_end: y }))));
  assert.ok(/no bank statement signed/.test(T.yendCell(row({ stage: 'books_in', stage_blocker: 'bank', bank: { state: 'none' } }))));
  assert.ok(/not checked/.test(T.yendCell(row({ stage: 'complete', stage_blocker: 'checked' }))));
  assert.ok(/1 query open/.test(T.yendCell(row({ stage: 'checked', stage_blocker: 'queries', queries: { open: 1 } }))));
});
t('B2 each band opens with columns its tiles count, and every named column exists', () => {
  const c = T.BAND_COLS;
  ['bank', 'queries', 'tocheck', 'unlocked'].forEach((k) => assert.ok(c.on_us.indexOf(k) >= 0, 'on_us lacks ' + k));
  ['yend', 'checked'].forEach((k) => assert.ok(c.pipeline.indexOf(k) >= 0, 'pipeline lacks ' + k));
  const have = Object.keys(cols());
  Object.keys(c).forEach((b) => c[b].forEach((k) => assert.ok(have.indexOf(k) >= 0, b + ' names a column that does not exist: ' + k)));
});
t('B6 the AU words come from the server: tile, filter choice and row say the same, one name', () => {
  const a = answer([{ key: 'ready', n: 8 }, { key: 'lodged', n: 4 }]);
  T.use(a);
  const html = T.bandHTML(a);
  assert.ok(/Ready to lodge/.test(html) && !/Ready to file/.test(html), html);
  assert.ok(/Lodged \(owner(&#39;|')s word\)/.test(html), html);
  const opts = T.filters().filter((f) => f.key === 'stage')[0].options.map((o) => o.label);
  assert.ok(opts.indexOf('Ready to lodge') >= 0 && opts.indexOf("Lodged (owner's word)") >= 0 && opts.indexOf('Marked lodged') < 0, opts.join('|'));
});
t('B6 with no server words the neutral words stand (no country branch in the page)', () => {
  T.use({ band: { bands: [] }, clients: [row()] });
  assert.strictEqual(T.stageWord('ready'), 'Ready to file');
  assert.strictEqual(T.stageWord('lodged'), "Filed (owner's word)");
});
t('B7 a grant without costs says "costs not shared", never 0, in the row and the detail', () => {
  T.use(answer([]));
  const r = row({ grant: { can_see_costs: false }, health: { status: 'good', words: 'Doing well', reasons: [], withheld: { costs: 'costs', currencies: null }, gross_margin_pct: null, profit_quarter_minor: null, cash_minor: 900, bills_due_30_minor: null } });
  const c = cols();
  assert.strictEqual(c.margin.cell(r), 'costs not shared'); assert.strictEqual(c.profit.cell(r), 'costs not shared');
  assert.ok(/900|9\.00/.test(c.cash.cell(r)), 'cash is no cost figure: ' + c.cash.cell(r));
  const d = T.detailHTML(r);
  assert.ok((d.match(/costs not shared/g) || []).length >= 3, d); assert.ok(!/Not shown/.test(d));
});
t('B7 more than one currency is said so; no data with nothing withheld stays a dash', () => {
  const c = cols();
  const mix = row({ health: { status: 'good', words: 'x', reasons: [], withheld: { costs: null, currencies: 'currencies' }, gross_margin_pct: null, profit_quarter_minor: null, cash_minor: null } });
  assert.strictEqual(c.margin.cell(mix), 'more than one currency'); assert.strictEqual(c.cash.cell(mix), 'more than one currency');
  const none = row({ health: { status: 'none', words: 'x', reasons: [], withheld: { costs: null, currencies: null }, gross_margin_pct: null, profit_quarter_minor: null, cash_minor: 0 } });
  assert.strictEqual(c.margin.cell(none), '—');
});
t('W9 a firm hides every card it does not keep; its Setup cards stay on the keep-list', () => {
  T.use({ clients: [row()], own_trade: false });
  assert.strictEqual(P.isFirm(), true);
  assert.strictEqual(P.hidesShopCards('sales'), true); assert.strictEqual(P.hidesShopCards('shop'), false);
  T.use({ clients: [row()], own_trade: true });
  assert.strictEqual(P.hidesShopCards('sales'), false);
});
process.exit(bad ? 1 : 0);
