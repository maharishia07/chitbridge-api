/**
 * ctr-177-bill-number-unique.test.cjs — CTR-177: A BILL NUMBER IS NEVER ISSUED TWICE, driven through the till's real takeNumber / seriesFor.
 *
 * The repro from laptop2's hunt (hunt-09 p07_series_dup): the series reset on 1 January but printed no year, so AU / AE / ZZ issued C1/0001
 * on 30 Dec and again on 1 Jan; India with FY dating and a monthly or daily reset repeated C1/26-27/0001 every month. The label now carries the
 * period the series resets on (engines v1.77.0); a series that already issued numbers keeps its old shape until its period rolls.
 *
 * Every expectation below is HAND-COMPUTED from the rule, not read back from the code: input -> expected -> actual (the assert prints both).
 * The till functions are cut out of tools/tally-connector/till.html (the master) and run in this process with a settable clock; nothing is retyped.
 *
 * The engine under test is lib/docnumber.js (the adopted copy). Until the api adopts engines v1.77.0, set CB_ENGINES_DIR=<engines checkout> to run
 * against its src/docnumber.js; with the pin moved both are the same file. Run: node tests/ctr-177-bill-number-unique.test.cjs
 */
'use strict';
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

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').slice(0, 4).join('\n      ')); fail++; }
};
const eq = (actual, expected, what) => assert.strictEqual(actual, expected, what + ': expected ' + expected + ' got ' + actual);

(async () => {
  console.log('\nctr-177 · a bill number is never issued twice (engine ' + path.relative(process.cwd(), ENGINE) + ')');

  await t('AU yearly, a series already billing: 31 Dec keeps its shape, 1 Jan is C1/2027/0001 (was C1/0001 twice)', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const boxes = { series: { prefix: 'C1', fy: '2026', next: 450, tagStyle: 'short' } };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C1/0450', '31 Dec 23:58 (legacy shape kept)');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', false), 'C1/2027/0001', '1 Jan 00:01');
    eq(await c.nextNumber('', false), 'C1/2027/0002', '1 Jan second bill');
    assert.strictEqual(boxes.series.lab, 2);
  });

  await t('AU yearly, a fresh series: C1/2026/0001 on 31 Dec, C1/2027/0001 on 1 Jan', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, {}, clock);
    eq(await c.nextNumber('', false), 'C1/2026/0001', '31 Dec');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', false), 'C1/2027/0001', '1 Jan');
  });

  await t('India FY dating monthly, a series mid-month: 31 Oct C1/26-27/0040, 1 Nov C1/2611/0001 (was C1/26-27/0001 again)', async () => {
    const clock = { now: at(2026, 10, 31, 22, 0) };
    const boxes = { series: { prefix: 'C1', fy: '2610', next: 40, tagStyle: 'short', scheme: { dating: 'fy', resets: 'month', dayRollHour: 0 } } };
    const c = counter('IN', 'C1', { dating: 'fy', resets: 'month', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C1/26-27/0040', '31 Oct (legacy shape kept)');
    clock.now = at(2026, 11, 1, 9, 0);
    eq(await c.nextNumber('', false), 'C1/2611/0001', '1 Nov');
  });

  await t('India FY dating daily: 5 Oct C1/26278/0001, 6 Oct C1/26279/0001', async () => {
    const clock = { now: at(2026, 10, 5, 10, 0) };
    const c = counter('IN', 'C1', { dating: 'fy', resets: 'day', dayRollHour: 0 }, {}, clock);
    eq(await c.nextNumber('', false), 'C1/26278/0001', '5 Oct');
    eq(await c.nextNumber('', false), 'C1/26278/0002', '5 Oct second');
    clock.now = at(2026, 10, 6, 10, 0);
    eq(await c.nextNumber('', false), 'C1/26279/0001', '6 Oct');
  });

  await t('India FY dating yearly, roll hour 4: 31 Mar 23:50 is 26-27/0450, 1 Apr 01:00 is 27-28/0001 (FY from the calendar instant)', async () => {
    const clock = { now: at(2027, 3, 31, 23, 50) };
    const boxes = { series: { prefix: 'C1', fy: '26-27', next: 450, tagStyle: 'short', lab: 2, scheme: { dating: 'fy', resets: 'year', dayRollHour: 4 } } };
    const c = counter('IN', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 4 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C1/26-27/0450', '31 Mar 23:50');
    clock.now = at(2027, 4, 1, 1, 0);
    eq(await c.nextNumber('', false), 'C1/27-28/0001', '1 Apr 01:00');
    clock.now = at(2027, 4, 1, 5, 0);
    eq(await c.nextNumber('', false), 'C1/27-28/0002', '1 Apr 05:00 (the same run; before the fix the 04:00 roll issued 0001 again)');
  });

  await t('a run that never resets is unchanged across 1 Jan', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const boxes = { series: { prefix: 'C1', fy: 'all', next: 450, tagStyle: 'short' } };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'never', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C1/0450', '31 Dec');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', false), 'C1/0451', '1 Jan');
  });

  await t('the other kinds follow: a legacy GRN keeps its long tag to the roll, then G/C1/2027/0001; credit note and expense roll labelled', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const boxes = {
      'series-GRN': { prefix: 'C1', fy: '2026', next: 7 },
      'series-CN': { prefix: 'C1', fy: '2026', next: 12, tagStyle: 'short' },
      'series-EXP': { prefix: 'C1', fy: '2026', next: 3, tagStyle: 'short' }
    };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('GRN', false), 'GRN/C1/0007', 'GRN legacy long tag');
    eq(await c.nextNumber('CN', false), 'C/C1/0012', 'credit note legacy');
    eq(await c.nextNumber('EXP', false), 'E/C1/0003', 'expense legacy');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('GRN', false), 'G/C1/2027/0001', 'GRN after the roll');
    eq(await c.nextNumber('CN', false), 'C/C1/2027/0001', 'credit note after the roll');
    eq(await c.nextNumber('EXP', false), 'E/C1/2027/0001', 'expense after the roll');
  });

  await t('a peek answers the same number and writes nothing', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const boxes = { series: { prefix: 'C1', fy: '2026', next: 450, tagStyle: 'short' } };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, boxes, clock);
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', true), 'C1/2027/0001', 'peek');
    assert.strictEqual(boxes.series.next, 450, 'the stored series did not move');
    eq(await c.nextNumber('', false), 'C1/2027/0001', 'then the real one');
  });

  await t('prefix C1 -> C2 -> C1 across a roll: a resumed legacy run keeps its shape, a new one is labelled, nothing repeats', async () => {
    const clock = { now: at(2026, 11, 5, 10, 0) };
    const boxes = { series: { prefix: 'C1', fy: '2026', next: 450, tagStyle: 'short' } };
    const c = counter('AU', 'C2', { dating: 'fy', resets: 'year', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C2/2026/0001', 'a new prefix begins at 1 and is labelled');
    c.setPrefix('C1');
    eq(await c.nextNumber('', false), 'C1/0450', 'C1 resumes where it stopped, in the shape it issued in');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', false), 'C1/2027/0001', 'C1 after the roll');
    c.setPrefix('C2');
    eq(await c.nextNumber('', false), 'C2/2027/0001', 'C2 after the roll');
  });

  await t('two tills with different ids, offline across midnight, never meet', async () => {
    const clock = { now: at(2026, 12, 31, 23, 59) };
    const a = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, {}, clock);
    const b = counter('AU', 'C2', { dating: 'fy', resets: 'year', dayRollHour: 0 }, {}, clock);
    const seen = new Set();
    for (const when of [at(2026, 12, 31, 23, 59), at(2027, 1, 1, 0, 0), at(2027, 1, 1, 0, 1)]) {
      clock.now = when;
      for (const c of [a, b]) {
        const n = await c.nextNumber('', false);
        assert.ok(!seen.has(n), n + ' issued twice');
        seen.add(n);
      }
    }
    assert.ok(seen.has('C1/2026/0001') && seen.has('C2/2026/0001') && seen.has('C1/2027/0001') && seen.has('C2/2027/0001'));
  });

  await t('the dating julian is untouched: C1/26365/0450 then C1/27001/0001', async () => {
    const clock = { now: at(2026, 12, 31, 23, 58) };
    const boxes = { series: { prefix: 'C1', fy: '2026', next: 450, tagStyle: 'short', lab: 2, scheme: { dating: 'julian', resets: 'year', dayRollHour: 0 } } };
    const c = counter('AU', 'C1', { dating: 'julian', resets: 'year', dayRollHour: 0 }, boxes, clock);
    eq(await c.nextNumber('', false), 'C1/26365/0450', '31 Dec');
    clock.now = at(2027, 1, 1, 0, 1);
    eq(await c.nextNumber('', false), 'C1/27001/0001', '1 Jan');
  });

  await t('a wrong clock cannot restart a used run: daily reset, 60 days forward and back, the numbers go on from where they stopped', async () => {
    const clock = { now: at(2026, 11, 5, 10, 0) };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'day', dayRollHour: 0 }, {}, clock);
    eq(await c.nextNumber('', false), 'C1/26309/0001', '5 Nov');
    eq(await c.nextNumber('', false), 'C1/26309/0002', '5 Nov second');
    clock.now = at(2027, 1, 4, 10, 0);                         /* the date is set 60 days forward by mistake … */
    eq(await c.nextNumber('', false), 'C1/27004/0001', '4 Jan (wrong clock)');
    clock.now = at(2026, 11, 5, 11, 0);                        /* … and put right again */
    eq(await c.nextNumber('', false), 'C1/26309/0003', '5 Nov again: the run resumes, 0001 is not issued twice');
  });

  await t('the ledger keeps 400 runs: a daily reset still remembers a day 360 days back', async () => {
    const clock = { now: at(2026, 1, 1, 10, 0) };
    const boxes = {};
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'day', dayRollHour: 0 }, boxes, clock);
    const day1 = await c.nextNumber('', false);
    for (let d = 2; d <= 360; d++) { clock.now = at(2026, 1, d, 10, 0); await c.nextNumber('', false); }
    assert.ok(Object.keys(boxes.series.parked).length <= 400, 'bounded');
    clock.now = at(2026, 1, 1, 12, 0);
    eq(await c.nextNumber('', false), day1.replace('0001', '0002'), '1 Jan resumes after 360 days');
  });

  await t('the same prefix, another period: a parked run of a prefix that was switched away resumes', async () => {
    const clock = { now: at(2026, 11, 5, 10, 0) };
    const c = counter('AU', 'C1', { dating: 'fy', resets: 'year', dayRollHour: 0 }, {}, clock);
    eq(await c.nextNumber('', false), 'C1/2026/0001', 'C1 2026');
    c.setPrefix('C2'); eq(await c.nextNumber('', false), 'C2/2026/0001', 'C2 2026');
    clock.now = at(2027, 1, 2, 10, 0);
    eq(await c.nextNumber('', false), 'C2/2027/0001', 'C2 2027');
    c.setPrefix('C1'); eq(await c.nextNumber('', false), 'C1/2027/0001', 'C1 2027');
    clock.now = at(2026, 11, 6, 10, 0);                        /* the clock goes back */
    eq(await c.nextNumber('', false), 'C1/2026/0002', 'C1 2026 resumes');
    c.setPrefix('C2'); eq(await c.nextNumber('', false), 'C2/2026/0002', 'C2 2026 resumes');
  });

  /* ⭐ the node host (tools/tally-connector/till.js) prints the KEY as the label and ignores the shop scheme: unique today, pinned so a change to
     the key that is not mirrored there fails here. It is left alone (retire it in a cleanup). */
  await t('till.js (the node host) prints the period key as its label: AU 2026 then 2027, IN 26-27 then 27-28', async () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.js'), 'utf8');
    assert.ok(/return docnumber\.periodKey\(\{ country, at: d \}\)/.test(js), 'fyOf still asks the engine for the key');
    assert.ok(/'\/' \+ fy \+ '\/' \+ String\(n\)\.padStart\(4, '0'\)/.test(js), 'nextNumberOf still prints the key as the label');
    eq(CBDoc.periodKey({ country: 'AU', at: at(2026, 12, 31, 12) }), '2026', 'AU key 31 Dec');
    eq(CBDoc.periodKey({ country: 'AU', at: at(2027, 1, 1, 12) }), '2027', 'AU key 1 Jan');
    eq(CBDoc.periodKey({ country: 'IN', at: at(2027, 3, 31, 12) }), '26-27', 'IN key 31 Mar');
    eq(CBDoc.periodKey({ country: 'IN', at: at(2027, 4, 1, 12) }), '27-28', 'IN key 1 Apr');
  });

  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
