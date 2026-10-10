/**
 * till-t2j.test.cjs - ROUND T2j (M201 one reader for the day's state), no DB, no network, no browser.
 * Sets the closed mark and asserts the Menu, Check and F10 all read CLOSED through the one reader, dayStatus().
 */
'use strict';
const assert = require('assert'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (label, fn) => { try { fn(); n++; console.log('  ok    ' + label); } catch (e) { bad++; console.log('  FAIL  ' + label + '\n        ' + (e && e.message)); } };
const PAGE = require('fs').readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const NL = String.fromCharCode(10);
/** one top-level function's source: a one-liner, or up to the closing brace at column 0 */
const grab = (name) => {
  let i = PAGE.indexOf(NL + 'function ' + name + '(');
  if (i < 0) i = PAGE.indexOf(NL + 'async function ' + name + '(');
  assert(i >= 0, name + ' is in the page');
  i++;
  const line = PAGE.slice(i, PAGE.indexOf(NL, i));
  return line.trimEnd().endsWith('}') ? line : PAGE.slice(i, PAGE.indexOf(NL + '}' + NL, i) + 2);
};

const mk = (store) => {
  const ctx = { ls: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } }, shopLs: (k) => k,
    tillScheme: () => ({ dayRollHour: 0 }), esc: (x) => String(x), menuAlerts: () => [] };
  vm.createContext(ctx);
  vm.runInContext(['bizDay', 'dayOpened', 'dayClosedMark', 'dayStatus', 'menuAlertsBody', 'dayWarnWords'].map(grab).join(NL), ctx);
  return ctx;
};
const today = new Date().toLocaleDateString('en-CA');
const closedStore = () => ({ cb_till_dayclosed: JSON.stringify({ day: today, at: new Date().toISOString(), bills: 5, total: 64500, by: 'A' }) });

console.log(NL + '-- M201 one reader for the day --');
ok('closed mark set -> dayStatus is closed, with the mark (bills, total)', () => {
  const s = mk(closedStore()).dayStatus();
  assert.strictEqual(s.state, 'closed'); assert.strictEqual(s.mark.bills, 5); assert.strictEqual(s.mark.total, 64500);
});
ok('closed mark wins over a day that was opened', () => {
  const st = closedStore(); const c = mk(st); st.cb_till_daystart = c.bizDay();
  assert.strictEqual(c.dayStatus().state, 'closed');
});
ok('opened, not closed -> open; neither -> new; yesterday\'s mark -> not closed', () => {
  const st = {}; const c = mk(st);
  assert.strictEqual(c.dayStatus().state, 'new');
  st.cb_till_daystart = c.bizDay(); assert.strictEqual(c.dayStatus().state, 'open');
  st.cb_till_dayclosed = JSON.stringify({ day: '2000-01-01', bills: 1, total: 1 }); assert.strictEqual(c.dayStatus().state, 'open');
});
ok('Check (the all-clear line) says closed, never "open"', () => {
  const html = mk(closedStore()).menuAlertsBody();
  assert(html.includes('the day is closed and') && !html.includes('the day is open'));
});
ok('Check says open for an opened day', () => {
  const st = {}; const c = mk(st); st.cb_till_daystart = c.bizDay();
  assert(c.menuAlertsBody().includes('the day is open and'));
});
ok('the bill warning does not say "Day not opened" on a closed day', () => {
  const c = mk(closedStore()); c.DAY = () => ({ priceAge: () => 1 }); c.S = { at: 1 };
  assert.strictEqual(c.dayWarnWords(), '');
});
ok('Menu (Start the day card), F10, the open set and the morning alert all ask dayStatus', () => {
  assert(grab('menuDayBody').includes('dayStatus()'));
  assert(grab('dayClose').includes('dayStatus().mark'));
  assert(grab('menuOpenSet').includes('dayStatus()') && grab('menuFirstSection').includes('dayStatus()'));
  assert(PAGE.includes("dayStatus().state === 'new'"));
});
ok('the opened mark is read in ONE place (dayOpened) - no second reader', () => {
  const reads = PAGE.split(NL).filter((l) => l.includes("ls.get(shopLs('cb_till_daystart')"));
  assert.strictEqual(reads.length, 1, 'reads: ' + reads.length);
});

console.log(NL + '  ' + n + ' passed' + (bad ? ', ' + bad + ' FAILED' : '') + NL);
process.exit(bad ? 1 : 0);
