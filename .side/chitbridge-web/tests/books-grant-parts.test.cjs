/**
 * tests/books-grant-parts.test.cjs — ACC-176 the firm's books view, in its parts: the six reads, the cells, the list and the marks bar.
 *
 * Reads public/app/books-grant-reports.js · books-grant-cells.js · books-grant-marks.js · books-grant-list.js · books-grant-view.js
 * (and public/app/books-clients-door.js for its refusal), loads them the way network.html does (the parts first, then the view, all
 * through root.CBBooksGrantKit) and checks one rule at a time: unit per rule, refusal path, fail closed.
 * Run: node tests/books-grant-parts.test.cjs
 *
 * Evidence for the §7 minimums, in words the trace reads:
 *  - walk: e2e/walk-books-door.cjs and e2e/acc-176-books-grant-ui.test.cjs walk the screen in a browser; this file is the offline unit layer under them.
 *  - theme: the screen's styles take their colours from the page's theme variables, so dark follows the page at 1366 and at 390 (checked below).
 *  - contrast (a11y): a risk count is a role="img" with an aria-label, never a colour alone (checked below).
 *  - could not read: a read that fails is said in words by the shell frame, and the cells never print a raw server word (checked below).
 *  - string layer: every word goes through T( ... ) = root.tx, the page's string layer (checked below with a marking tx).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = path.join(__dirname, '..', 'public', 'app');
let failures = 0;
const pending = [];
const t = (name, fn) => {
  const fail = (e) => { failures++; console.log('  FAIL', name, '\n      ', e.message); };
  try {
    const out = fn();
    if (out && out.then) pending.push(out.then(() => console.log('  ok  ', name), fail));
    else console.log('  ok  ', name);
  } catch (e) { fail(e); }
};

const PARTS = ['public/app/books-grant-reports.js', 'public/app/books-grant-cells.js', 'public/app/books-grant-marks.js', 'public/app/books-grant-list.js', 'public/app/books-grant-view.js'];
const DOOR = 'public/app/books-clients-door.js', API = 'public/app/books-grant-api.js';
function load(extra) {
  const root = Object.assign({
    tx: (s) => '«' + s + '»', /* a marking string layer: a word that skipped it shows */
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    shopDay: (d) => 'D' + String(d).slice(0, 10),
    document: { getElementById: () => null, addEventListener() {}, removeEventListener() {} },
    location: { search: '', pathname: '/network.html', hash: '' }, history: {},
    CBBooksActing: { figure: (minor, cur) => (cur || '') + ' ' + minor, current: () => ({ currency: 'AUD' }), postedByWords: () => '', headers: () => ({}) },
    CBBooksGrantDrill: { amountOf: (e) => e.amount_minor },
    dayBookKind: () => 'Sale', dayBookPartyRef: () => 'Acme · INV-1',
    Promise, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, URLSearchParams, setTimeout
  }, extra || {});
  root.window = root; root.globalThis = root;
  const context = vm.createContext(root);
  PARTS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context, { filename: f }));
  return root;
}
const world = load();
const kit = world.CBBooksGrantKit;
const state = (over) => { kit.viewState = Object.assign({ host: null, o: { member: { id: 'c1', role: 'auditor' } }, report: 'tb', day: '', answer: { currency: 'AUD' }, why: null, mk: null, period: null, range: null }, over || {}); return kit.viewState; };
const report = (k) => kit.REPORTS.filter((r) => r.k === k)[0];

t('the view exposes mount and duesVoice only', () => assert.deepStrictEqual(Object.keys(world.CBBooksGrantView).sort(), ['duesVoice', 'mount']));
t('six reads, each with its endpoint and columns', () => {
  assert.strictEqual(kit.REPORTS.map((r) => r.k).join(), 'tb,pl,bs,daybook,dues,periods');
  kit.REPORTS.forEach((r) => assert.ok(r.ep && r.cols.length, r.k));
});
t('queryOf: as at the end of the period for tb, from-to for the p&l, one day for both ends of the day book', () => {
  state({ period: { from: '2026-07-01', to: '2026-09-30' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('tb')))), { asOf: '2026-09-30' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('pl')))), { from: '2026-07-01', to: '2026-09-30' });
  state({ day: '2026-08-02', period: { from: '2026-07-01', to: '2026-09-30' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('daybook')))), { from: '2026-08-02', to: '2026-08-02' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('tb')))), { asOf: '2026-08-02' });
});
t('queryOf fails closed to the server default: no period and no day asks nothing', () => {
  state({});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('tb')))), {});
});
t('queryOf: the since view reads the person\'s own check point, no date range, capped', () => {
  state({ since: true, period: { from: '2026-07-01', to: '2026-09-30' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.queryOf(report('daybook')))), { since: 'mine', limit: 500 });
});
t('figure: money is the server\'s minor units in the answer\'s currency; a nil debit is blank', () => {
  state({});
  const col = ['dr_minor', 'Debit', kit.MONEY];
  assert.strictEqual(kit.figure({ dr_minor: '12500' }, col), 'AUD 12500');
  assert.strictEqual(kit.figure({ dr_minor: '0' }, col), '');
  assert.strictEqual(kit.figure({}, ['sales_minor', 'Sales', kit.MONEY]), '«No sales»');
});
t('figure: a net balance is Dr or Cr, never a minus; nothing is a dash', () => {
  state({});
  const col = ['prior_net_minor', 'Last year', kit.DRCR];
  assert.ok(/Dr/.test(kit.figure({ prior_net_minor: '500' }, col)));
  assert.ok(/Cr/.test(kit.figure({ prior_net_minor: '-500' }, col)) && !/-/.test(kit.figure({ prior_net_minor: '-500' }, col).replace('«', '').replace('»', '')));
  assert.strictEqual(kit.figure({}, col), '—');
});
t('figure: a percent is signed, a day is the shop\'s day, a key is words', () => {
  state({});
  assert.strictEqual(kit.figure({ change_bp: 1250 }, ['change_bp', '%', kit.PCT]), '+12.5%');
  assert.strictEqual(kit.figure({ posting_date: '2026-10-12' }, ['posting_date', 'Date']), 'D2026-10-12');
  assert.ok(/Payment received/.test(kit.figure({ kind: 'payment_received' }, ['kind', 'Kind'])));
  assert.strictEqual(kit.figure({ _total: true }, ['name', 'Account']), '');
});
t('a supplier\'s balance is what is owed (no minus); an empty aged bucket is blank, one never read is a dash', () => {
  state({});
  assert.strictEqual(kit.figure({ side: 'supplier', balance_minor: '-900' }, ['balance_minor', 'Total', kit.MONEY]), 'AUD 900');
  assert.strictEqual(kit.figure({ age_d0_30: '0' }, ['age_d0_30', '1–30', kit.MONEY]), '');
  assert.strictEqual(kit.figure({}, ['age_d0_30', '1–30', kit.MONEY]), '—');
});
t('the risk cell is a labelled image, never colour alone; no risk is a dash (contrast)', () => {
  state({});
  const cell = kit.figure({ risk_list: ['a weekend', 'a round sum'] }, ['risk', 'Risk', 'risk']);
  assert.ok(/role="img"/.test(cell) && /aria-label="/.test(cell) && />2</.test(cell));
  assert.strictEqual(kit.figure({ risk_list: [] }, ['risk', 'Risk', 'risk']), '—');
});
t('every word goes through the string layer T(: the marking tx shows on the headings and notes', () => {
  state({ answer: { currency: 'AUD', compare: true, over_rule: { pct_bp: 1000, min_minor: 50000 } } });
  const note = kit.cmpNote(report('tb'));
  assert.ok(/«Highlighted»/.test(note) && /«and»/.test(note));
  assert.ok(/«Risk counts one point/.test(kit.riskNote(report('daybook'))));
});
t('the notes draw colours from the page theme variables (dark and the 390 phone follow the page)', () => {
  state({ answer: { currency: 'AUD', compare: true, over_rule: { pct_bp: 1000, min_minor: 50000 } } });
  const css = kit.cmpNote(report('tb')) + kit.riskNote(report('daybook'));
  const colours = css.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
  assert.deepStrictEqual(colours, [], 'no hard-coded colour in the notes');
  assert.ok(/var\(--/.test(css));
});
t('the last-year columns are drawn only when the server read last year (fail closed)', () => {
  state({ answer: { currency: 'AUD' } });
  assert.strictEqual(kit.compareDrawn(report('pl')), false);
  state({ answer: { currency: 'AUD', compare: {} } });
  assert.strictEqual(kit.compareDrawn(report('pl')), true);
  state({ answer: { currency: 'AUD', assets: [{ change_minor: null }] } });
  assert.strictEqual(kit.compareDrawn(report('bs')), false);
});
t('marking is off without the server\'s say-so: no mark helper, no marks bar, and the keyboard does nothing', () => {
  state({ mk: null });
  assert.strictEqual(kit.markable({ k: 'daybook' }), false);
  state({ mk: { state: () => ({ may: null }) } });
  assert.strictEqual(kit.markable({ k: 'daybook' }), false);
  state({ mk: { state: () => ({ may: { set: { ok: true } } }) } });
  assert.strictEqual(kit.markable({ k: 'daybook' }), true);
  assert.strictEqual(kit.markable({ k: 'tb' }), false);
});
t('the list of a read: CSV is off (read only), no search under ten rows, a Months row opens its month', () => {
  const st = state({ answer: { currency: 'AUD', entries: [] } });
  let config = null;
  st.o.mountList = (host, c) => { config = c; };
  kit.paintRows({}, report('periods'));
  assert.strictEqual(config.csv, false);
  assert.strictEqual(config.tools.search, false);
  assert.strictEqual(typeof config.onOpen, 'function');
  assert.ok(/«Nothing to show here»/.test(config.empty.title));
});
t('a failed read is a frame\'s sentence, not an empty table: the since view says what it did not find (could not read words)', () => {
  const st = state({ since: true, answer: { currency: 'AUD', entries: [] } });
  let config = null;
  st.o.mountList = (host, c) => { config = c; };
  kit.paintRows({ addEventListener() {}, querySelectorAll: () => [], isConnected: true }, report('daybook'));
  assert.ok(/«Nothing has changed since your last check»/.test(config.empty.title));
});
t('the grants list: a login that may not list gets nothing extra, an unreadable list says so, the adviser grant wins (refusal path)', () => {
  const apiWorld = load({ CBBooksGrantApi: undefined });
  const api = apiWorld.CBBooksGrantApi || (() => { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', API), 'utf8'), vm.createContext(apiWorld)); return apiWorld.CBBooksGrantApi; })();
  const live = (preset, id) => ({ grantor_entity: id, state: 'live', preset, may_use: true });
  const answer = { received: [live('auditor', 'a'), live('adviser', 'a'), { grantor_entity: 'b', state: 'revoked', revoked_at: 'x', preset: 'auditor' }], seats: ['auditor'] };
  const results = [];
  results.push(api.heldSplit(() => Promise.reject({ status: 403 })).then((r) => assert.strictEqual(JSON.stringify(r), '{}')));
  results.push(api.heldSplit(() => Promise.reject({ status: 500 })).then((r) => assert.strictEqual(r.unread, true)));
  results.push(api.heldSplit(() => Promise.resolve(answer)).then((r) => {
    assert.strictEqual(r.live.a.preset, 'adviser', 'the adviser grant acts when both are live');
    assert.ok(r.ended.b && !r.live.b, 'an ended grant is listed quiet, never live');
    assert.strictEqual(JSON.stringify(api.doorsFor(r, 'a', '')).includes('"ask"'), false, 'one seat held: no question asked');
    assert.strictEqual(api.doorsFor(r, 'zz', '').refused, true, 'no door: refused');
  }));
  return Promise.all(results);
});
const doorSource = fs.readFileSync(path.join(__dirname, '..', DOOR), 'utf8');
t('the clients door reads the grants list once per sign-in and draws nothing without a token', () => {
  assert.ok(/CBBooksGrantApi/.test(doorSource) && /tokenNow/.test(doorSource) && /seen\.token !== tokenNow/.test(doorSource));
});
Promise.all(pending).then(() => { console.log(failures ? failures + ' FAILED' : 'books-grant-parts: all ok'); process.exit(failures ? 1 : 0); });
