/**
 * ctr-dupbill-1133.test.cjs — CTR-DUPBILL: A REFUSED BILL NUMBER MOVES THE COUNTER TO THE NEXT FREE ONE.
 *
 * Found by the shop actors (PM/sim-year/AREA-SWEEP-2026-11-27.md): Save was refused "Bill number C1/2026/0001 is already used on this counter ...
 * Press Save again", and every retry was refused again, because bill() took ONE number per press and the device's own bills already held a run of
 * them (a device whose sequence is behind what the counter has already issued). Now the till walks forward to the first number this counter has not
 * used. Numbers stay gapless (a skipped number is one already issued) and never reused (each is written to the series before it is returned).
 *
 * Hand-computed: bills 0001-0005 held, series behind (next 1) -> the next bill is 0006, then 0007. Two devices on one counter that share
 * the bill list -> 0001, 0002, 0003 in turn, each exactly once.  Run: node tests/ctr-dupbill-1133.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CBDoc = require(path.join(__dirname, '..', 'lib', 'docnumber.js'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const RealDate = Date;

function grab(name) {
  let i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = SRC.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not on the page');
  const j = SRC.indexOf('\n}\n', i + 1);
  return SRC.slice(i + 1, j + 2);
}
const line = (re) => { const m = SRC.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const BODY = [
  line(/^var DOC_TAGS = \{[^\n]*\};$/m), 'var SERIES_TURN = Promise.resolve(); var LAST_SERIES = null; function leaseApplies(){ return false; }',
  grab('DOCNUM'), grab('docCountry'), grab('tillScheme'), grab('docKindOf'), grab('todayIso'),
  grab('underSeriesLock'), grab('nextNumber'), grab('takeNumber'), grab('seriesFor'), grab('rollSeries'), grab('switchPrefix'), 'var PARKED_MAX = 400;', grab('runKey'), grab('parkRuns'), grab('parkedNext'), grab('resumeFromCloud'), grab('numberText'),
  line(/^var BILL_NO_SKIP_MAX = \d+;/m), grab('freeBillNumber'),
  'return { free: freeBillNumber };'
].join('\n');

/** one device: its own series box, and a `bills` store that may be shared with another device (the counter's bill list) */
function device(prefix, boxes, bills) {
  const clock = new RealDate(2026, 10, 27, 10, 0, 0);
  const ClockDate = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.getTime()); else super(...a); }
    static now() { return clock.getTime(); }
  };
  const factory = new Function('Date', 'window', 'CBDoc', 'S', 'DB', 'ls', 'shopLs', 'tillId', 'tillOpt', 'cbQuiet', 'navigator', 'tillStore',
    'var PREFIX = ' + JSON.stringify(prefix) + '; var OPT = { series: { dating: "fy", resets: "year", dayRollHour: 0 } };\n'
    + 'tillId = function(){ return PREFIX; }; tillOpt = function(){ return OPT; };\n' + BODY);
  const DB = {
    get: async (k) => (boxes[k] === undefined ? undefined : JSON.parse(JSON.stringify(boxes[k]))),
    set: async (k, v) => { boxes[k] = JSON.parse(JSON.stringify(v)); },
    exists: async (store, key) => store === 'bills' && bills.has(key)
  };
  return factory(ClockDate, { CBDoc }, CBDoc, { shop: { country: 'AU' } }, DB, { get: (k, d) => d, set: () => {} }, (k) => k, null, null, () => {}, undefined, () => 'cb-till');
}
const no = (n) => 'C1/2026/' + String(n).padStart(4, '0');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ok ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message.split('\n').slice(0, 4).join('\n      ')); fail++; }
};

(async () => {
  console.log('\nctr-dupbill-1133 · a refused bill number moves to the next free one');

  await t('a device whose sequence is behind: 0001-0005 are held, the next bill is 0006, then 0007', async () => {
    const bills = new Set([1, 2, 3, 4, 5].map(no));
    const d = device('C1', {}, bills);
    assert.strictEqual(await d.free(), no(6));
    bills.add(no(6));
    assert.strictEqual(await d.free(), no(7));
  });

  await t('two devices on one counter, one bill list: 0001, 0002, 0003, 0004 each exactly once and no gap', async () => {
    const bills = new Set();
    const a = device('C1', {}, bills), b = device('C1', {}, bills);
    const got = [];
    for (const d of [a, b, a, b]) { const n = await d.free(); assert.ok(!bills.has(n), n + ' was issued twice'); bills.add(n); got.push(n); }
    assert.deepStrictEqual(got, [1, 2, 3, 4].map(no));
  });

  await t('a counter that already holds a long run: one press finds the free number, the series carries on after it', async () => {
    const bills = new Set(Array.from({ length: 120 }, (_, i) => no(i + 1)));
    const boxes = {};
    const d = device('C1', boxes, bills);
    assert.strictEqual(await d.free(), no(121));
    assert.strictEqual(boxes.series.next, 122);
  });

  await t('a store that says every number is taken ends in words, not a loop', async () => {
    const d = device('C1', {}, { has: () => true });
    await assert.rejects(d.free(), /already used on this counter/);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
