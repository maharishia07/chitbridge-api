'use strict';
/**
 * rollup.test.js — A DAY, A WEEK, A MONTH, AND THE ARITHMETIC THAT SURVIVES PURGING THE BILLS.
 *
 * Athi, 2026-09-19: *"each week summarise day chit to week chit. summarise, summarise month chit … after a
 * certain days, we don't need to refer the daily chit data."*
 *
 * ── ⚠️⚠️⚠️ THE PROPERTY THE WHOLE DESIGN RESTS ON ────────────────────────────────────────────────────────────
 *
 * If a week is folded from seven day summaries, that fold MUST equal summarising the seven days of bills
 * directly. Otherwise the month stops agreeing with the weeks it was built from, and once the daily detail is
 * deleted nobody can ever say which figure was right. Purging is only safe because this holds.
 *
 * ── ⚠️⚠️ AND THE BUG IT WAS WRITTEN AGAINST ─────────────────────────────────────────────────────────────────
 *
 * till.js todayTotals() counted `rows.length` as the number of sales — so a credit note counted as a sale made
 * — and only ever ADDED payments, so the drawer figure was over by exactly the day's refunds. till.html was
 * fixed for this on 2026-09-18; the program on the shop's PC was not. The summary would have inherited it, on
 * the figures that become the shop's permanent record.
 *
 * Run: node tests/rollup.test.js   · no DB, no network.
 */
const assert = require('assert');
const R = require('../lib/rollup');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const sale = (no, total, how) => ({ no, total, at: '2026-09-14T10:00:00Z', payments: [{ how: how || 'Cash', amount: total }] });
const back = (no, amount, how) => ({ no, kind: 'credit_note', total: -amount, at: '2026-09-14T11:00:00Z',
  refunds: [{ how: how || 'Cash', amount }] });

console.log('\nA RETURN IS NOT A SALE\n');

it('a plain day counts, sums and banks', () => {
  const t = R.totals([sale('1', 100), sale('2', 250, 'UPI')]);
  assert.strictEqual(t.count, 2);
  assert.strictEqual(t.gross, 350);
  assert.strictEqual(t.total, 350);
  assert.deepStrictEqual(t.by, { Cash: 100, UPI: 250 });
});

/** ⚠️⚠️ the exact defect in till.js todayTotals(): a credit note counted as a sale */
it('A RETURN IS NOT COUNTED AS A SALE', () => {
  const t = R.totals([sale('1', 100), back('CN-1', 40)]);
  assert.strictEqual(t.count, 1, 'the return was counted as a sale made');
  assert.strictEqual(t.returns, 1);
});

/** ⚠️⚠️ the other half: cash handed back has LEFT the drawer */
it('A REFUND LEAVES THE DRAWER', () => {
  const t = R.totals([sale('1', 100), back('CN-1', 40)]);
  assert.strictEqual(t.by.Cash, 60, 'the drawer figure did not lose the refund');
  assert.strictEqual(t.gross, 100, 'gross is what was sold, before returns');
  assert.strictEqual(t.refunds, 40, 'refunds is an amount, stated positive');
  assert.strictEqual(t.total, 60, 'total is what the shop kept');
});

it('a refund on a different tender than the sale is tracked on its own', () => {
  const t = R.totals([sale('1', 100, 'UPI'), back('CN-1', 30, 'Cash')]);
  assert.deepStrictEqual(t.by, { UPI: 100, Cash: -30 });
});

it('a day with nothing in it is zeroes, not empty', () => {
  const t = R.totals([]);
  assert.strictEqual(t.count, 0); assert.strictEqual(t.total, 0);
  assert.deepStrictEqual(t.by, {});
});

console.log('\n⚠️⚠️⚠️ FOLDING EQUALS SUMMARISING — THE REASON PURGING IS SAFE\n');

it('a week folded from days equals the days summarised together', () => {
  const d1 = [sale('1', 100), sale('2', 50, 'UPI')];
  const d2 = [sale('3', 200), back('CN-1', 25)];
  const d3 = [sale('4', 33.33, 'Card')];
  const folded = R.fold([R.totals(d1), R.totals(d2), R.totals(d3)]);
  const direct = R.totals(d1.concat(d2, d3));
  assert.deepStrictEqual(folded, direct,
    'the fold disagreed with the direct sum — a month would stop matching its own weeks');
});

it('and folding folds — a month from weeks equals a month from days', () => {
  const days = [[sale('1', 10)], [sale('2', 20)], [back('CN', 5)], [sale('3', 40, 'UPI')]];
  const weekA = R.fold([R.totals(days[0]), R.totals(days[1])]);
  const weekB = R.fold([R.totals(days[2]), R.totals(days[3])]);
  assert.deepStrictEqual(R.fold([weekA, weekB]), R.totals([].concat.apply([], days)));
});

it('fold accepts summary records as well as bare totals', () => {
  const s = R.summary('day', '2026-09-14', R.totals([sale('1', 100)]), { till: { id: 'C1' } });
  assert.deepStrictEqual(R.fold([s]), R.totals([sale('1', 100)]));
});

it('folding nothing is zeroes, not NaN', () => {
  const f = R.fold([]);
  assert.strictEqual(f.total, 0);
  assert.strictEqual(f.count, 0);
});

console.log('\nTHE PERIOD KEYS\n');

it('a day, a month', () => {
  assert.strictEqual(R.dayKey('2026-09-14T10:00:00Z'), '2026-09-14');
  assert.strictEqual(R.monthKey('2026-09-14T10:00:00Z'), '2026-09');
});

/** ⚠️ ISO-8601: Monday starts the week, and week 1 holds the first Thursday */
it('an ISO week — Monday starts it', () => {
  assert.strictEqual(R.weekKey('2026-09-14'), R.weekKey('2026-09-20'), 'Mon and Sun of one week disagreed');
  assert.notStrictEqual(R.weekKey('2026-09-20'), R.weekKey('2026-09-21'), 'Sunday and the next Monday agreed');
});

it('the year boundary does not lose a week', () => {
  /* 2026-12-31 is a Thursday, so it belongs to week 53 of 2026 */
  assert.strictEqual(R.weekKey('2026-12-31'), '2026-W53');
  /* and 2027-01-01, a Friday, is still that same ISO week */
  assert.strictEqual(R.weekKey('2027-01-01'), '2026-W53');
});

it('a period nobody has heard of is refused, not guessed', () => {
  assert.throws(() => R.keyOf('fortnight', '2026-09-14'), /no such period/);
});

it('daysIn picks exactly the days of a period', () => {
  const days = ['2026-09-13', '2026-09-14', '2026-09-20', '2026-09-21'];
  /* 14th–20th Sep 2026 is one ISO week; the 13th is the Sunday before, the 21st the Monday after */
  const wk = R.daysIn('week', R.weekKey('2026-09-14'), days);
  assert.deepStrictEqual(wk, ['2026-09-14', '2026-09-20']);
  assert.deepStrictEqual(R.daysIn('month', '2026-09', days), days);
});

console.log('\n⚠️ A PERIOD STILL RUNNING IS NEVER SUMMARISED\n');

/**
 * ⚠️⚠️ A summary of today would change after it was published — and once the bills behind it are purged,
 * nobody could correct it.
 */
it('today is not closed, yesterday is', () => {
  const now = '2026-09-14T15:00:00Z';
  assert.strictEqual(R.isClosed('day', '2026-09-14', now), false, 'today was treated as finished');
  assert.strictEqual(R.isClosed('day', '2026-09-13', now), true, 'yesterday was treated as still running');
});

it('this week and this month are not closed either', () => {
  const now = '2026-09-14T15:00:00Z';
  assert.strictEqual(R.isClosed('week', R.weekKey(now), now), false);
  assert.strictEqual(R.isClosed('month', '2026-09', now), false);
  assert.strictEqual(R.isClosed('month', '2026-08', now), true);
});

console.log('\nTHE SUMMARY TRAVELS AS A CHIT\n');

it('the chit is the shape the counter already queues', () => {
  const s = R.summary('day', '2026-09-14', R.totals([sale('1', 100)]), { till: { id: 'C1', name: 'Counter 1' } });
  const c = R.chitOf(s);
  assert.ok(Array.isArray(c.recipients) && c.recipients[0].self === true);
  assert.strictEqual(c.purpose, 'general', "a summary must not be an 'order' — it would double the books");
  assert.deepStrictEqual(c.line_items, []);
  assert.ok(/Day summary — 2026-09-14/.test(c.subject), 'the subject does not name the period: ' + c.subject);
  assert.strictEqual(c.business_json.summary.totals.total, 100);
});

/** ⚠️ re-sending the same period must not create a second record on the server */
it('the reference is stable and unique per period and counter', () => {
  const mk = (p, k, id) => R.refOf(R.summary(p, k, R.totals([]), { till: { id } }));
  assert.strictEqual(mk('day', '2026-09-14', 'C1'), mk('day', '2026-09-14', 'C1'), 'the same period gave two references');
  assert.notStrictEqual(mk('day', '2026-09-14', 'C1'), mk('day', '2026-09-14', 'C2'), 'two counters collided');
  assert.notStrictEqual(mk('day', '2026-09-14', 'C1'), mk('week', '2026-09-14', 'C1'), 'a day and a week collided');
});

it('a fresh summary has NOT been synced, and does not pretend to be', () => {
  const s = R.summary('day', '2026-09-14', R.totals([]), {});
  assert.strictEqual(s.synced_at, null, 'a summary claimed to have reached ChitBridge before it was sent');
});

console.log('\n' + pass + ' checks passed\n');
