/* CTR-242 + CTR-180 (till): THE DAY IS CUT IN THE SHOP'S ZONE, ONCE. The bills lists, the day close, the closed mark and the summary key all read
   dayKeyOf -> shopDayOf; a bill rung at 00:10 IST or AEST belongs to THAT local day, 23:50 the evening before stays in the day before.
   Lifts the page's own functions over a settable clock (follow ctry-139-till-band). Break check: put toISOString().slice(0,10) back in dayKeyOf and this fails. */
// CARD      09-counter/day-close
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
function grabAt(at, label) {
  assert.ok(at >= 0, label + ' is gone from till.html');
  let i = h.indexOf('{', at), d = 0;
  for (; i < h.length; i++) { if (h[i] === '{') d++; else if (h[i] === '}' && --d === 0) break; }
  return h.slice(at, i + 1);
}
const grab = (n) => grabAt(h.indexOf('function ' + n + '('), n);
/** a CloudHost method ('bills', 'local', 'state') lifted as a function the test can call */
const grabMethod = (n) => 'var M_' + n + ' = ' + grabAt(h.indexOf('async ' + n + '(', h.indexOf('var CloudHost')), n).replace(/^async \w+\(/, 'async function(');
const FNS = ['dayKeyOf', 'shopDayOf', 'dayInZone', 'shopTz', 'tzOpt', 'shopPack', 'dayClosedMark', 'dayCloseDo', 'dueDateFor'];
const ZONES = { IN: 'Asia/Kolkata', AU: 'Australia/Sydney' };

/** the page for a country with the clock stopped at `now` (an ISO instant) and `rows` in the bill store */
function page(country, now, rows) {
  const T0 = Date.parse(now), store = {}, sent = [];
  class Clock extends Date { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } }
  const ctx = {
    window: { CBRegulation: { packFor: () => (country === 'IN' ? { timeZones: [ZONES.IN] } : { timeZones: ['Australia/Sydney', 'Australia/Perth'] }) },
              CBLocale: { timezone: () => ZONES[country] } },
    Date: Clock, Intl, Number, String, Math, Object, Array, JSON, isNaN, cbQuiet() {}, docCountry: () => country,
    DB: { all: async () => rows }, isDocRow: () => false, creditDaysOf: () => 15,
    ls: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } }, shopLs: (k) => k,
    DAY_D: { bills: 3, total: 90, server: null }, WHO: { name: 'T' }, money: (v) => String(v), toastLine() {}, hhmm: () => '00:10',
    dayCloseHTML: () => '', dayClosedButtons() {}, paintStatus() {}, daySummarySend: (m) => { sent.push(m); },
    document: { getElementById: () => ({ textContent: '', innerHTML: '', hidden: false }) },
  };
  ctx.CBLocale = ctx.window.CBLocale; vm.createContext(ctx);
  vm.runInContext(FNS.map(grab).join('\n') + '\n' + ['bills', 'local'].map(grabMethod).join('\n'), ctx);
  ctx.CBLocale = ctx.window.CBLocale; ctx.sent = sent;
  return ctx;
}
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
const okA = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };

(async () => {
  // 00:10 local on 14 Nov = 18:40 UTC on 13 Nov (IST, +5:30) = 13:10 UTC on 13 Nov (AEDT, +11; Sydney is on summer time in November)
  const CASES = [
    { country: 'IN', after: '2026-11-13T18:40:00Z', before: '2026-11-13T18:20:00Z', now: '2026-11-14T06:00:00Z', day: '2026-11-14', prev: '2026-11-13' },
    { country: 'AU', after: '2026-11-13T13:10:00Z', before: '2026-11-13T12:50:00Z', now: '2026-11-14T03:00:00Z', day: '2026-11-14', prev: '2026-11-13' },
  ];
  for (const c of CASES) {
    const rows = [{ no: 'A', at: c.after, total: 10 }, { no: 'B', at: c.before, total: 20 }, { no: 'C', at: c.now, total: 60 }];
    const p = page(c.country, c.now, rows);
    ok(c.country + ': 00:10 local is the new local day, 23:50 the evening before is the old one', () => {
      assert.strictEqual(p.dayKeyOf(c.after), c.day); assert.strictEqual(p.dayKeyOf(c.before), c.prev);
    });
    await okA(c.country + ': the bills list (today) holds the 00:10 bill and not the 23:50 one', async () => {
      const got = (await p.M_bills()).map((b) => b.no).sort();
      assert.deepStrictEqual(got, ['A', 'C']);
    });
    await okA(c.country + ': the last-days list keeps the day before from its local midnight', async () => {
      const got = (await p.M_local(1)).map((b) => b.no).sort();
      assert.deepStrictEqual(got, ['A', 'B', 'C']);
    });
    ok(c.country + ': the closed mark, the summary key and the cut agree on one day', () => {
      p.dayCloseDo();
      const m = p.sent[0];
      assert.strictEqual(m.day, c.day, 'the summary key is the shop day');
      assert.strictEqual(p.dayClosedMark().day, c.day, 'the closed mark reads back for the same day');
      assert.strictEqual(m.day, p.dayKeyOf(c.after), 'the day close and the list cut the same day');
    });
  }
  ok('a credit due date counts calendar days from the SHOP day of the bill (00:10 IST + 15 = the 29th, not the 28th)', () => {
    const p = page('IN', '2026-11-14T06:00:00Z', []);
    assert.strictEqual(p.dueDateFor({}, '2026-11-13T18:40:00Z'), '2026-11-29');
  });
  ok('no UTC slice is left cutting a day in the till (the ones left are listed in the PR body)', () => {
    const left = h.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /toISOString\(\)\.slice\(0, ?10\)/.test(l)).map(([i]) => i);
    assert.strictEqual(left.length, 2, 'only dueDateFor (a calendar date from a date) and the catalogue file name keep the slice: ' + left);
  });
  console.log(n + ' ok');
})().catch((e) => { console.error(e); process.exit(1); });
