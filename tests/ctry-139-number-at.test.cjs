/* ctry-139-number-at.test.cjs — CTRY-139: a bill pinned at its priced moment takes the number of THAT moment's period. Priced 23:59 IST on 31 Oct (monthly reset, India FY dating), saved after midnight: the number is the 31 Oct run's, not 1 Nov's. Real takeNumber lifted as in ctr-177. */
'use strict';
/* the till counts a day in the till PC's own zone (India here); pin it so the proof reads the same on a UTC runner (CI 11 Nov: the unpinned number stayed in October at 18:30Z) */
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ENGINE = process.env.CB_ENGINES_DIR ? path.join(process.env.CB_ENGINES_DIR, 'src', 'docnumber.js') : path.join(__dirname, '..', 'lib', 'docnumber.js');
const CBDoc = require(ENGINE);
const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const RealDate = Date;

/** a whole top-level function of the page, from its first line to the closing brace in column 0 */
function grab(name) {
  let i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = SRC.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not on the page');
  const j = SRC.indexOf('\n}\n', i + 1);
  return SRC.slice(i + 1, j + 2);
}
const line = (re) => { const m = SRC.match(re); assert.ok(m, 'missing ' + re); return m[0]; };
const BODY = [
  line(/^var DOC_TAGS = \{[^\n]*\};$/m), 'var SERIES_TURN = Promise.resolve(); var LAST_SERIES = null;',
  grab('DOCNUM'), grab('docCountry'), grab('tillScheme'), grab('docKindOf'), grab('todayIso'),
  grab('underSeriesLock'), grab('nextNumber'), grab('takeNumber'), grab('seriesFor'), grab('rollSeries'), grab('switchPrefix'), 'var PARKED_MAX = 400;', grab('runKey'), grab('parkRuns'), grab('parkedNext'), grab('resumeFromCloud'), grab('numberText'),
  'return { nextNumber: nextNumber, setScheme: function(s){ OPT.series = s; }, setPrefix: function(p){ PREFIX = p; } };'
].join('\n');

/** one counter: its country, its prefix, its scheme and its stored boxes; `clock.now` is the moment `new Date()` answers */
function counter(country, prefix, scheme, boxes, clock) {
  const store = {};
  const ClockDate = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now.getTime()); else super(...a); }
    static now() { return clock.now.getTime(); }
  };
  const factory = new Function('Date', 'window', 'CBDoc', 'S', 'DB', 'ls', 'shopLs', 'tillId', 'tillOpt', 'cbQuiet', 'navigator', 'tillStore',
    'var PREFIX = ' + JSON.stringify(prefix) + '; var OPT = { series: ' + JSON.stringify(scheme) + ' };\n'
    + 'tillId = function(){ return PREFIX; }; tillOpt = function(){ return OPT; };\n' + BODY);
  const DB = {
    get: async (k) => (boxes[k] === undefined ? undefined : JSON.parse(JSON.stringify(boxes[k]))),
    set: async (k, v) => { boxes[k] = JSON.parse(JSON.stringify(v)); }
  };
  return factory(ClockDate, { CBDoc }, CBDoc, { shop: { country } }, DB, { get: (k, d) => (store[k] === undefined ? d : store[k]), set: (k, v) => { store[k] = v; } },
    (k) => k, null, null, () => {}, undefined, () => 'cb-till');
}
const at = (y, m, d, h, mi) => new RealDate(y, m - 1, d, h || 0, mi || 0, 0);

(async () => {
  const PRICED = new RealDate('2026-10-31T18:29:40.000Z');   /* 23:59:40 IST on 31 Oct */
  const boxes = { series: { prefix: 'C1', fy: '2610', next: 40, tagStyle: 'short', lab: 2, scheme: { dating: 'fy', resets: 'month', dayRollHour: 0 } } };
  const mk = (clockAt) => counter('IN', 'C1', { dating: 'fy', resets: 'month', dayRollHour: 0 }, boxes, { now: new RealDate(clockAt) });
  const late = mk('2026-10-31T18:30:30.000Z');   /* the clock is now 00:00:30 IST on 1 Nov */
  const pinned = await late.nextNumber('', false, PRICED);
  console.log('  pinned at the priced moment: ' + pinned);
  assert.ok(/\/2610\//.test(pinned) || /26-27/.test(pinned), 'the 31 Oct run: ' + pinned);
  assert.ok(!/2611/.test(pinned), 'not 1 Nov\'s run: ' + pinned);
  const unpinned = await mk('2026-10-31T18:30:30.000Z').nextNumber('', false);
  console.log('  unpinned (the old behaviour): ' + unpinned);
  assert.ok(/2611/.test(unpinned), 'without the pin the number takes 1 Nov\'s period (this is the bug the pin closes): ' + unpinned);
  const next = await late.nextNumber('', false, PRICED);
  assert.strictEqual(next, 'C1/2610/0041', 'the run goes on: seq 41, not a second 0001');
  const back = await late.nextNumber('', false);
  assert.ok(/2611/.test(back), 'a bill priced after midnight takes the new run: ' + back);
  const again = await late.nextNumber('', false, PRICED);
  assert.strictEqual(again, 'C1/2610/0042', 'and a late pinned bill returns to the old run through the park ledger: ' + again);
  for (const site of ['nextNumber(undefined, false, b && b.at)', 'nextNumber(docTagOf(d.kind), false, d.at)', "nextNumber('R', false, p.at)", 'nextNumber(undefined, false, bill.at)']) assert.ok(SRC.includes(site), site);
  assert.ok(SRC.includes('await nextNumber(undefined, false, b && b.at)'), 'HOST.bill hands the pinned moment to the number');
  console.log('2 passed');
})().catch((e) => { console.error(e); process.exit(1); });
