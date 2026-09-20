'use strict';
/**
 * till-retain.test.js — WHAT A COUNTER KEEPS ([TILL-166], BACKLOG TILL-134).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Athi: *"any unsent copy and based on the retention period, only those data will be in the till, rest will not
 * be here… set a hard limit. otherwise, you can always search from the backend. that should be the stand.
 * retention period upto 30 days or say 2000 bills or say 200 mb."*
 *
 * The desktop program's folder has been bounded since [TILL-123]. The BROWSER counter had no retention at all:
 * it kept every bill it had ever taken, for ever. A phone used daily grows until the browser refuses a write,
 * and that arrives as "cannot save" with a customer standing at the counter — the one fault in this product
 * that loses work.
 *
 * ⚠️⚠️ THE RULE THIS FILE EXISTS FOR: **unsent is never purged, whatever the limits say.** A bill ChitBridge
 * has not acknowledged is the shop's only copy of that money. Everything below is arithmetic; this one is the
 * difference between trimming a cache and destroying a record of cash taken.
 *
 * These run the page's own functions against fabricated bills — no browser, no DB.
 *
 * Run: node tests/till-retain.test.js
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/**
 * ⭐ THE REAL FUNCTIONS, LIFTED OUT AND RUN. A source-text check would pass on arithmetic that is wrong, and
 * the arithmetic is the whole thing here. Only `ls` and `shopLs` are stubbed, because limits come from
 * settings and this file is about the plan, not about where the numbers are stored.
 */
const RUN = (function () {
  const grab = (sig) => {
    const a = PAGE.indexOf(sig);
    assert.ok(a > 0, sig + ' is gone — this guard is measuring nothing');
    const b = PAGE.indexOf('\n}', a);
    return PAGE.slice(a, b + 2);
  };
  const src = [
    'var ls = { get: function(k, d){ return LIMITS[k] === undefined ? d : LIMITS[k]; } };',
    'function shopLs(k){ return k; }',
    grab('var RETAIN_DEF ='.replace('var ', 'var ')).split('\n')[0],
    grab('function retainLimits(){'),
    grab('function retainSettled(b){').split('\n')[0],
    grab('function retainBytes(b){').split('\n')[0],
    grab('function retainSay(why'),
    grab('function retainPlan(bills, lim){'),
    'module.exports = { retainPlan: retainPlan, retainLimits: retainLimits, retainSay: retainSay };',
  ].join('\n');
  const m = { exports: {} };
  new Function('module', 'LIMITS', src)(m, {});
  return m.exports;
})();

const day = 86400000;
const bill = (n, daysAgo, sent, size) => ({
  no: 'C1/' + n, at: new Date(Date.now() - daysAgo * day).toISOString(),
  _sent: sent ? { at: Date.now() } : undefined,
  pad: 'x'.repeat(size || 200),
});

console.log('\nWHAT A COUNTER KEEPS\n');

it('three limits, and the shop can set each of them', () => {
  const l = RUN.retainLimits();
  assert.strictEqual(l.days, 30, 'the day default moved');
  assert.strictEqual(l.bills, 2000, 'the bill-count default moved');
  assert.strictEqual(l.mb, 200, 'the size default moved');
});

/**
 * ⚠️⚠️⚠️ THE ONE THAT MATTERS. A bill the server has never acknowledged is the shop's only copy. It must
 * survive every limit — age, count and size — however old it gets.
 */
it('⚠️⚠️⚠️ an UNSENT bill is never dropped, by any limit', () => {
  const bills = [];
  for (let i = 0; i < 50; i++) bills.push(bill(i, 400, false));   /* all ancient, none sent */
  const p = RUN.retainPlan(bills, { days: 1, bills: 5, mb: 0.0001 });
  assert.strictEqual(p.drop.length, 0,
    'it would drop ' + p.drop.length + ' bills the server has never seen — that is money the shop cannot prove');
  assert.strictEqual(p.keep.length, 50, 'and it kept only ' + p.keep.length + ' of them');
});

it('and a settled bill older than the day limit does go', () => {
  const p = RUN.retainPlan([bill(1, 2, true), bill(2, 40, true)], { days: 30, bills: 2000, mb: 200 });
  assert.strictEqual(p.drop.length, 1, 'expected one old bill to go, got ' + p.drop.length);
  assert.strictEqual(p.binding, 'age', 'the age limit did not bind; it said ' + p.binding);
});

it('the COUNT limit binds even when everything is recent', () => {
  const bills = [];
  for (let i = 0; i < 20; i++) bills.push(bill(i, 0, true));
  const p = RUN.retainPlan(bills, { days: 30, bills: 5, mb: 200 });
  assert.strictEqual(p.keep.length, 5, 'kept ' + p.keep.length + ', expected the 5 newest');
  assert.strictEqual(p.binding, 'count', 'the count limit did not bind; it said ' + p.binding);
});

it('and the SIZE limit binds before either of the others', () => {
  const bills = [];
  for (let i = 0; i < 40; i++) bills.push(bill(i, 0, true, 20000));
  const p = RUN.retainPlan(bills, { days: 30, bills: 2000, mb: 0.2 });
  assert.ok(p.drop.length > 0, 'nothing was dropped although the size cap was passed');
  assert.strictEqual(p.binding, 'size', 'the size limit did not bind; it said ' + p.binding);
});

/** ⭐ the newest are what a counter is actually used for — a trim that kept the oldest would be useless */
it('⭐ it keeps the NEWEST, not the first it happened to read', () => {
  const bills = [bill('old', 20, true), bill('new', 1, true), bill('mid', 10, true)];
  const p = RUN.retainPlan(bills, { days: 365, bills: 1, mb: 200 });
  assert.strictEqual(p.keep.length, 1, 'kept ' + p.keep.length);
  assert.strictEqual(p.keep[0].no, 'C1/new', 'it kept ' + p.keep[0].no + ' instead of the newest');
});

/**
 * ⭐⭐ IT SAYS WHICH LIMIT BOUND. Athi's own framing: three numbers tell a shopkeeper nothing, "trimmed by
 * size: 200 MB reached" tells them what to change.
 */
it('⭐⭐ it says which limit bound, in words', () => {
  const bills = [];
  for (let i = 0; i < 20; i++) bills.push(bill(i, 0, true));
  const p = RUN.retainPlan(bills, { days: 30, bills: 5, mb: 200 });
  assert.ok(/reached 5 bills/.test(p.say), 'it does not name the limit that bound: "' + p.say + '"');
  assert.ok(/on the server/.test(p.say), 'it does not say the bills are still readable: "' + p.say + '"');
});

it('and when nothing needs to go, it says that instead of saying nothing', () => {
  const p = RUN.retainPlan([bill(1, 0, true)], { days: 30, bills: 2000, mb: 200 });
  assert.strictEqual(p.drop.length, 0);
  assert.ok(/still here/.test(p.say), '"' + p.say + '"');
});

console.log('\n⚠️⚠️ AND NOTHING IS DELETED BEFORE ITS DAY IS SUMMARISED\n');

const RUN_SRC = (function () {
  const a = PAGE.indexOf('async function retainRun(){');
  assert.ok(a > 0, 'retainRun is gone');
  return PAGE.slice(a, PAGE.indexOf('\n}', a));
})();

/**
 * ⚠️⚠️⚠️ THE ORDER IS THE PROPERTY. The money taken on a day is a fact the shop may be asked about years
 * later; the bills are a working copy. Delete first and fold after, and a crash between them loses the day.
 */
it('⚠️⚠️⚠️ the day is folded BEFORE any row is removed', () => {
  const fold = RUN_SRC.indexOf('CBRollup.summary');
  const del = RUN_SRC.indexOf("DB.del('bills'");
  assert.ok(fold > 0, 'nothing is summarised at all');
  assert.ok(del > 0, 'nothing is deleted at all — this guard is measuring nothing');
  assert.ok(fold < del, 'rows are deleted before the day is summarised');
});

it('and a day that will not fold stops the whole run', () => {
  assert.ok(/could not be summarised first/.test(RUN_SRC),
    'a failed summary does not stop the deletion — the day would vanish quietly');
});

it('it folds with the engine, not with its own arithmetic', () => {
  assert.ok(/CBRollup\.totals/.test(RUN_SRC),
    'it totals the day itself instead of using CBRollup — two answers for one day');
});

/** ⚠️ a trim that can fire mid-sale will one day fire mid-sale */
it('⚠️ it runs only at the close, never on a timer', () => {
  assert.strictEqual((PAGE.match(/setInterval\(\s*retain/g) || []).length, 0, 'retention is on a timer');
  assert.ok(/await retainAtClose\(\)/.test(PAGE), 'it is not wired to the counter close at all');
});

console.log('\n' + pass + ' checks passed\n');
