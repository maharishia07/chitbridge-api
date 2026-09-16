/**
 * docnumber-scheme.test.cjs — THE SHOP'S BILL-NUMBER SCHEME, AND WHAT EACH CHOICE COSTS.
 *
 * Athi, 2026-09-16, after watching three days of numbers side by side: *"the design is every day julian date
 * changes and every month, both rotates."* And, on the tail repeating under a monthly reset: *"that is fine,
 * because the number is the combination of both — julian date and the sequence number."*
 *
 * ⚠️⚠️ THE TWO QUESTIONS ARE SEPARATE AND THIS FILE EXISTS TO KEEP THEM SO. What the middle segment SAYS
 * (dating) and when the sequence RESTARTS (resets) are different decisions. Tie them together — make a daily
 * date imply a daily reset — and the repeating `001` tail comes straight back, which is the thing julian dating
 * was chosen to avoid.
 *
 * Run: node tests/docnumber-scheme.test.cjs
 */
'use strict';
const assert = require('assert');
const D = require('../lib/docnumber');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
};
const at = (iso) => new Date(iso);
const no = (scheme, d, seq) => D.compose({ country: 'IN', prefix: 'C1', kind: 'sale', at: at(d), seq, scheme });

console.log('\ndocnumber · the shop’s scheme');

t('⚠️ THE DEFAULT DOES NOT MOVE — a counter that never opens the setting numbers as it always has', () => {
  assert.strictEqual(D.compose({ country: 'IN', prefix: 'C1', kind: 'sale', at: at('2026-09-16'), seq: 3 }),
    'C1/26-27/0003');
  assert.strictEqual(no({ dating: 'fy', resets: 'year' }, '2026-09-16', 3), 'C1/26-27/0003');
});

t('⭐ julian dating puts the DAY in the number, and it moves every morning', () => {
  const s = { dating: 'julian', resets: 'month' };
  assert.strictEqual(no(s, '2026-09-16', 3), 'C1/26259/0003');
  assert.strictEqual(no(s, '2026-09-17', 4), 'C1/26260/0004');
  assert.strictEqual(no(s, '2026-09-18', 5), 'C1/26261/0005');
});

t('⭐⭐ THE DESIGN: date rotates DAILY, sequence rotates MONTHLY', () => {
  const s = { dating: 'julian', resets: 'month' };
  /* the printed label follows the day … */
  assert.notStrictEqual(no(s, '2026-09-30', 150), no(s, '2026-10-01', 1));
  /* … and the reset key follows the month, not the day */
  assert.strictEqual(D.periodKey({ country: 'IN', at: at('2026-09-16'), scheme: s }),
                     D.periodKey({ country: 'IN', at: at('2026-09-30'), scheme: s }), 'same month, same run');
  assert.notStrictEqual(D.periodKey({ country: 'IN', at: at('2026-09-30'), scheme: s }),
                        D.periodKey({ country: 'IN', at: at('2026-10-01'), scheme: s }), 'a new month restarts it');
});

t('⚠️⚠️ A DAILY DATE MUST NOT IMPLY A DAILY RESET — that is the whole point of keeping them apart', () => {
  const monthly = { dating: 'julian', resets: 'month' };
  const daily = { dating: 'julian', resets: 'day' };
  const k = (s, d) => D.periodKey({ country: 'IN', at: at(d), scheme: s });
  assert.strictEqual(k(monthly, '2026-09-16'), k(monthly, '2026-09-17'), 'monthly: the run continues across days');
  assert.notStrictEqual(k(daily, '2026-09-16'), k(daily, '2026-09-17'), 'daily: it restarts');
});

t('⭐ the whole number stays unique even when the tail repeats — Athi: "the combination of both"', () => {
  const s = { dating: 'julian', resets: 'month' };
  /* 0001 is issued on 1 Sept and again on 1 Oct — but the dates differ, so the numbers differ */
  const a = no(s, '2026-09-01', 1), b = no(s, '2026-10-01', 1);
  assert.strictEqual(a, 'C1/26244/0001');
  assert.strictEqual(b, 'C1/26274/0001');
  assert.notStrictEqual(a, b, 'the date segment keeps them apart');
});

t('⭐ the trading day can roll AFTER midnight, for a counter open late', () => {
  const mid = { dating: 'julian', resets: 'month', dayRollHour: 0 };
  const four = { dating: 'julian', resets: 'month', dayRollHour: 4 };
  /* 1am on the 17th: at midnight-roll it is already the 17th; at 4am-roll it still belongs to the 16th */
  assert.strictEqual(D.julianLabel(at('2026-09-17T01:00:00'), 0), '26260');
  assert.strictEqual(D.julianLabel(at('2026-09-17T01:00:00'), 4), '26259');
  assert.strictEqual(no(mid, '2026-09-17T01:00:00', 9), 'C1/26260/0009');
  assert.strictEqual(no(four, '2026-09-17T01:00:00', 9), 'C1/26259/0009');
});

t('⚠️ every shape this offers still passes India’s sixteen characters', () => {
  const shapes = [
    { dating: 'fy', resets: 'year' },
    { dating: 'julian', resets: 'month' },
    { dating: 'julian', resets: 'day' },
    { dating: 'julian', resets: 'never' },
  ];
  for (const s of shapes) {
    for (const seq of [1, 9999, 100000]) {
      const n = no(s, '2026-09-16', seq);
      const c = D.check(n, 'IN');
      assert.ok(c.ok, n + ' (' + s.dating + '/' + s.resets + ') → ' + c.reason);
    }
  }
});

t('⚠️⚠️ AND THE COST OF JULIAN IS REAL: the financial year cannot be read off the number', () => {
  const s = { dating: 'julian', resets: 'month' };
  /* 31 Mar 2027 is FY 26-27; 1 Apr 2027 is FY 27-28. Both read "27". */
  assert.ok(no(s, '2027-03-31', 1).indexOf('/27') >= 0);
  assert.ok(no(s, '2027-04-01', 1).indexOf('/27') >= 0);
  /* whereas the FY scheme says which year it is, on the bill */
  assert.strictEqual(no({ dating: 'fy', resets: 'year' }, '2027-03-31', 1), 'C1/26-27/0001');
  assert.strictEqual(no({ dating: 'fy', resets: 'year' }, '2027-04-01', 1), 'C1/27-28/0001');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
