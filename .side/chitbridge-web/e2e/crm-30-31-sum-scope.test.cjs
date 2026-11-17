/**
 * crm-30-31-sum-scope.test.cjs — CRM-30 · CRM-31 (proof 2026-11-14): the select bar's Sum button.
 * OWNS      the proof, on the real app.html code (sumScope · partialSum lifted into a vm sandbox, with the real helpers.js cbSumByCurrency / cbMoneyList):
 *           CRM-30 explicit ticks sum ONLY the loaded ticked rows (a loaded row nobody ticked is not in the sum); with no ticks it falls back to the server roll-up of the ticked states.
 *           CRM-31 a selection of mixed kinds lists each kind separately and a selection of mixed currencies is shown per currency, never added into one figure.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/crm-30-31-sum-scope.test.cjs
 * Hand-computed rows: 1 order INR 100 · 2 order INR 250 · 3 bill USD 40 · 4 order INR 1000 (loaded, never ticked) · 5 bill INR 60.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const PUB = path.join(__dirname, '..', 'public');
const cx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: { setAttribute() {}, style: {} }, addEventListener() {} }, navigator: { language: 'en-IN' } });
cx.window = cx; cx.self = cx;
for (const f of ['engine/money.js', 'engine/locale.js', 'app/helpers.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), cx);

const toasts = [];
cx.toast = (m) => toasts.push(m);
cx.tx = (s) => s;
cx.UI = { rows: [], selected: new Set(), aggStates: new Set() };
cx.rollupBuckets = () => ({ open: { c: 7 }, act: { c: 2 } });
cx.rollupMoney = () => ({});
cx.tickedSumText = () => 'SERVER-TOTAL';
vm.runInContext(liftFns('public/app.html', ['partialSum', 'sumScope']) + '\nthis.sumScope = sumScope;', cx);

const loc = cx.CBLocale.money;
const rows = () => [
  { id: 1, kind: 'order', amt: 100, currency: 'INR', state: 'open' },
  { id: 2, kind: 'order', amt: 250, currency: 'INR', state: 'open' },
  { id: 3, kind: 'bill', amt: 40, currency: 'USD', state: 'open' },
  { id: 4, kind: 'order', amt: 1000, currency: 'INR', state: 'open' },
  { id: 5, kind: 'bill', amt: 60, currency: 'INR', state: 'open' }
];
const run = (ticked, states) => {
  toasts.length = 0;
  cx.UI.rows = rows();
  cx.UI.selected = new Set(ticked);
  cx.UI.aggStates = new Set(states || []);
  cx.sumScope();
  return toasts[0] || '';
};

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

let t = run([1, 2]);
ok(t === 'Selected · 2 chit(s) · Σ ' + loc(350, 'INR'), 'CRM-30 two ticked INR rows (100 + 250) sum to 350, not 1350 — the loaded row 4 (1000) was never ticked: "' + t + '"');
t = run([4]);
ok(t === 'Selected · 1 chit(s) · Σ ' + loc(1000, 'INR'), 'CRM-30 one ticked row sums to its own 1000: "' + t + '"');
cx.UI.rows = rows(); cx.UI.rows[1].costHidden = true;
cx.UI.selected = new Set([1, 2]); toasts.length = 0; cx.sumScope();
ok(/^Selected · 2 chit\(s\) · Σ partial · /.test(toasts[0]), 'CRM-30 a ticked row whose money the server hid makes the sum say "partial": "' + toasts[0] + '"');
t = run([], ['open', 'act']);
ok(t === 'Roll-up (all) · Open+Act · 9 chit(s) · Σ SERVER-TOTAL', 'CRM-30 nothing ticked + states Open and Act ticked → the server roll-up, 7 + 2 = 9 chits, the server total (not the loaded rows): "' + t + '"');
t = run([], []);
ok(t === 'Tick a state (Open/Act/Close) or some records first.', 'CRM-30 nothing ticked and no state → it asks for a tick, no figure: "' + t + '"');

t = run([1, 3]);
ok(t === 'Selected 2 · mixed kinds — order: ' + loc(100, 'INR') + ' · bill: ' + loc(40, 'USD'), 'CRM-31 an order and a bill → each kind listed on its own, never added (not 140): "' + t + '"');
t = run([1, 2, 3, 5]);
ok(t.indexOf('mixed kinds') > 0 && t.indexOf('order: ' + loc(350, 'INR')) > 0 && t.indexOf('bill: ') > 0 && t.indexOf(loc(40, 'USD')) > 0 && t.indexOf(loc(60, 'INR')) > 0 && t.indexOf(loc(450, 'INR')) < 0, 'CRM-31 two orders + two bills: order ₹350; bill shows $40 and ₹60 side by side (no ₹450 invented): "' + t + '"');
t = run([3, 5]);
ok(t.indexOf('Σ') > 0 && t.indexOf(loc(60, 'INR')) > 0 && t.indexOf(loc(40, 'USD')) > 0 && t.indexOf('not added together') > 0 && t.indexOf(loc(100, 'INR')) < 0, 'CRM-31 one kind but two currencies (bill USD 40 + bill INR 60) → both shown, "not added together", never ₹100: "' + t + '"');
process.exitCode = bad ? 1 : 0;
