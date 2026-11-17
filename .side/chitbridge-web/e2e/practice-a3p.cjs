#!/usr/bin/env node
/* practice-a3p.cjs — A3P (17 Nov, auditor 3x paper): rank 1 work order on Year end · rank 2 the opened row is the year-end sheet · rank 5 the blocker's view · rank 6 the entries tile.
 * Run: node e2e/practice-a3p.cjs   (no browser: the page files are loaded against a stub window; figures are hand-computed in each test) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = { Promise, tx: (s) => s, URLSearchParams, encodeURIComponent, document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { classList: { add() {}, remove() {}, toggle() {} } } }, localStorage: { getItem() { return null; } }, location: { hostname: 'x', search: '' } };
/* the page loads helpers.js first (the one esc · fmtMoney · monthNames); each file here runs in that same sandbox */
const sandbox = vm.createContext({ module: { exports: {} }, window: root, globalThis: root, setInterval() {}, setTimeout() {}, URLSearchParams, encodeURIComponent });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine', 'money.js'), 'utf8'), sandbox, { filename: 'money.js' });
sandbox.CBMoney = sandbox.module.exports;
for (const f of ['helpers.js', 'books-acting.js', 'books-practice-band.js', 'books-practice-cells.js', 'books-practice.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8'), sandbox, { filename: f });
const T = root.CBPractice.parts;
let bad = 0;
const t = (n, f) => { try { f(); console.log('  ok  ', n); } catch (e) { bad++; console.log('  FAIL', n, '\n      ', e.message); } };
const YE = { fy: '2025-26', of: 12, locked: 12, bank_to_end: true, end: '2026-06-30', start: '2025-07-01', entries: { checked: 0, of: 477 } };
const row = (o) => Object.assign({ entity_id: 'c1', name: 'C', role: 'auditor', stage: 'lodged', stage_blocker: null, year_end: YE, queries: { open: 0, on_us: 0, on_client: 0 }, bas: { due_date: null }, bank: { state: 'reconciled' }, checked: { n: 0, of: 0 }, months_unlocked: 0, health: { status: 'good', words: 'Doing well', reasons: [] }, grant: {} }, o || {});
const PIPE = ['books_in', 'complete', 'checked', 'ready', 'lodged'].map((key) => ({ key, n: 1 }));
const use = (clients) => T.use({ band: { bands: [{ key: 'pipeline', first: true, tiles: [] }], pipeline: PIPE }, clients, words: {} });

t('rank 1 work order: stage (Books in first, Lodged last), then blocker, then due date; unknown stage last, no throw', () => {
  const rs = [row({ entity_id: 'L', stage: 'lodged', bas: { due_date: '2026-07-01' } }), row({ entity_id: 'C', stage: 'complete', stage_blocker: 'checked' }),
    row({ entity_id: 'B1', stage: 'books_in', stage_blocker: 'months', bas: { due_date: '2026-08-01' } }), row({ entity_id: 'B2', stage: 'books_in', stage_blocker: 'bank' }),
    row({ entity_id: 'B3', stage: 'books_in', stage_blocker: 'months', bas: { due_date: '2026-07-01' } }), row({ entity_id: 'X', stage: 'weird' })];
  use(rs); rs.forEach((r, n) => { r._n = n; });
  assert.deepStrictEqual(rs.slice().sort(T.workOrder).map((r) => r.entity_id), ['B3', 'B1', 'B2', 'C', 'L', 'X']);
});
t('rank 1 only the Year end band gets the work order first; On us today and Advice keep urgency', () => {
  assert.strictEqual(T.sorts('pipeline')[0].key, 'pipeline');
  assert.strictEqual(T.sorts('on_us')[0].key, 'urgency'); assert.strictEqual(T.sorts('advisory')[0].key, 'urgency');
});
t('rank 1 Status is a chip only on Year end (the reason moves to the opened row)', () => {
  use([row({ health: { status: 'help', words: 'Needs help', reasons: ['cash low'] } })]);
  assert.ok(!/cash low/.test(T.statusCell(row({ health: { status: 'help', words: 'Needs help', reasons: ['cash low'] } }))));
  assert.ok(/cash low/.test(T.detailHTML(row({ health: { status: 'help', words: 'Needs help', reasons: ['cash low'] } }), 'pipeline')));
});
t('rank 2 the sheet holds five links, each address carries fy=2025-26', () => {
  use([row()]);
  const html = T.sheetHTML(row());
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.strictEqual(hrefs.length, 5, html);
  hrefs.forEach((h) => assert.ok(/fy=2025-26/.test(h), h));
  assert.deepStrictEqual(hrefs.slice(0, 3), ['/network.html?open=c1&view=periods&fy=2025-26', '/accounts.html?acting=c1&role=auditor&fy=2025-26#/bank', '/network.html?open=c1&view=daybook&fy=2025-26']);
});
t('rank 2 the sheet numbers are the row\'s own: 12 of 12 locked, 0 of 477 checked, bank to 30 Jun', () => {
  use([row()]);
  const html = T.sheetHTML(row()).replace(/<[^>]+>/g, ' ');
  assert.ok(/12 of 12/.test(html) && /0 of 477/.test(html) && /Yes, to/.test(html), html);
});
t('rank 2 no year_end: one sentence, no link, no throw', () => {
  const html = T.sheetHTML(row({ year_end: null, stage: null }));
  assert.ok(!/href/.test(html) && /not on/.test(html), html);
});
t('rank 2 On us today and Advice keep their figures; Cash in bank is now Cash and bank', () => {
  use([row()]);
  const h = T.detailHTML(row({ health: { status: 'good', words: 'Doing well', reasons: [], cash_minor: 100 }, currency: 'AUD', grant: { expires_at: null }, bank: { state: 'none' } }), 'on_us');
  assert.ok(/Cash and bank/.test(h) && !/Cash in bank/.test(h) && !/practice-sheet/.test(h));
});
t('rank 6 the entries tile counts entries (1,175) with the clients behind (2); a tile with no entries key keeps its n', () => {
  const a = { band: { bands: [{ key: 'on_us', first: true, tiles: [{ key: 'to_check', n: 2, entries: 1175 }, { key: 'bank_unexplained', n: 3 }] }] }, clients: [row()], words: {} };
  T.use(a);
  const html = T.bandHTML(a);
  assert.ok(/<b>1,175<\/b><span>Entries to check · 2 clients<\/span>/.test(html), html);
  assert.ok(/<b>3<\/b>/.test(html));
});

/* fin1117: F1 bank words from the one answer · F4 one line per client · F3 the blocker link carries the Mark filter */
t('F1 a bank with 35.00 unexplained says it in the Bank page words, never "bank not to year end"', () => {
  const r = row({ stage: 'books_in', stage_blocker: 'bank', year_end: Object.assign({}, YE, { bank_to_end: false }), bank: { state: 'unexplained', reconciled_to: '2026-06-30', unexplained_minor: 3500, currency: 'AUD' }, currency: 'AUD' });
  use([r]);
  const h = T.yendCell(r).replace(/<[^>]+>/g, '');
  assert.ok(/3.?5|35/.test(h) && /unexplained/.test(h) && !/not to year end/.test(h), h);
});
t('F4 the Year end cell is one line: stage + one blocker, the blocker said once', () => {
  const y = Object.assign({}, YE, { locked: 3, bank_to_end: false });
  const r = row({ stage: 'books_in', stage_blocker: 'months', year_end: y });
  use([r]);
  const h = T.yendCell(r);
  assert.ok(!/<br/.test(h), h); assert.strictEqual((h.replace(/title="[^"]*"/, '').match(/not locked/g) || []).length, 1, h);
});
t('F3 a client whose blocker is entries opens the Day book on Not checked; queries on Queried; months carry no filter', () => {
  const go = (b) => { const r = row({ entity_id: 'z1', stage_blocker: b }); use([r]); root.location.href = ''; T.openBooks('z1', 'pipeline'); return root.location.href; };
  assert.ok(/view=daybook&fy=2025-26&dbf_mark=notchecked$/.test(go('checked')), go('checked'));
  assert.ok(/view=daybook&fy=2025-26&dbf_mark=query$/.test(go('queries')), go('queries'));
  assert.ok(!/dbf_mark/.test(go('months')));
});
console.log(bad ? bad + ' FAILED' : 'all ok'); process.exit(bad ? 1 : 0);
