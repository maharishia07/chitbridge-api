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
/** [till expenses] Athi: "it can be anything like Gpay... or cash or card... need to know what the expense is
 *  and the mode of payment and amount" — `spent`, never `payments`, same reasoning as a return's `refunds`. */
const spend = (no, amount, how, what) => ({ no, kind: 'expense', total: -amount, what: what || 'Expense',
  at: '2026-09-14T12:00:00Z', spent: [{ how: how || 'Cash', amount }] });

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

console.log('\n[till expenses] AN EXPENSE IS NOT A SALE, AND IT LEAVES WHATEVER TENDER IT WAS PAID FROM\n');

it('an expense is not counted as a sale made', () => {
  const t = R.totals([sale('1', 100), spend('E-1', 40, 'Cash', 'Rent')]);
  assert.strictEqual(t.count, 1, 'the expense was counted as a sale made');
  assert.strictEqual(t.returns, 0, 'an expense is not a return either');
  assert.strictEqual(t.expenseCount, 1, 'expenseCount is the COUNT — a day-close screen asking "how many expenses" needs this, not the amount');
});

it('an expense leaves the tender it was paid from', () => {
  const t = R.totals([sale('1', 100), spend('E-1', 40, 'Cash', 'Rent')]);
  assert.strictEqual(t.by.Cash, 60, 'the drawer figure did not lose the expense');
  assert.strictEqual(t.gross, 100, 'gross is what was sold — an expense is not a sale, so it never touches gross');
  assert.strictEqual(t.expenses, 40, 'expenses is an amount, stated positive');
  assert.strictEqual(t.total, 60, 'total is what the shop actually kept, expense included');
});

it('an expense paid by GPay/UPI leaves THAT tender, not cash', () => {
  const t = R.totals([sale('1', 100, 'Cash'), spend('E-1', 25, 'UPI', 'Delivery boy')]);
  assert.deepStrictEqual(t.by, { Cash: 100, UPI: -25 }, 'an expense on a different tender than the day’s sales is tracked on its own');
});

it('a return AND an expense on the same day both leave the drawer, independently', () => {
  const t = R.totals([sale('1', 200), back('CN-1', 30), spend('E-1', 50, 'Cash', 'Tea for staff')]);
  assert.strictEqual(t.refunds, 30);
  assert.strictEqual(t.expenses, 50);
  assert.strictEqual(t.total, 120, '200 sold − 30 refunded − 50 spent = what the shop actually kept');
  assert.strictEqual(t.by.Cash, 120);
});

it('what the expense WAS FOR travels on the row, for a person checking the till later — never classified', () => {
  const t = R.totals([spend('E-1', 500, 'Cash', 'Electrician')]);
  assert.strictEqual(t.expenses, 500);
  /* ⭐ Athi: "we are not recording against each class... let it be that way" — totals() itself never reads
   * `what`; it is carried on the ROW for the chit and the day's list to show, not summarised into a category. */
});

console.log('\n⚠️⚠️⚠️ FOLDING EQUALS SUMMARISING — THE REASON PURGING IS SAFE\n');

it('a week folded from days equals the days summarised together', () => {
  const d1 = [sale('1', 100), sale('2', 50, 'UPI')];
  const d2 = [sale('3', 200), back('CN-1', 25)];
  const d3 = [sale('4', 33.33, 'Card'), spend('E-1', 15, 'Card', 'Auto fare')];
  const folded = R.fold([R.totals(d1), R.totals(d2), R.totals(d3)]);
  const direct = R.totals(d1.concat(d2, d3));
  assert.deepStrictEqual(folded, direct,
    'the fold disagreed with the direct sum — a month would stop matching its own weeks');
});

it('and folding folds — a month from weeks equals a month from days', () => {
  const days = [[sale('1', 10)], [sale('2', 20)], [back('CN', 5)], [sale('3', 40, 'UPI'), spend('E-1', 8, 'UPI', 'Snacks')]];
  const weekA = R.fold([R.totals(days[0]), R.totals(days[1])]);
  const weekB = R.fold([R.totals(days[2]), R.totals(days[3])]);
  assert.deepStrictEqual(R.fold([weekA, weekB]), R.totals([].concat.apply([], days)));
});

it('a summary saved BEFORE expenses existed folds as zero expense, not a hole', () => {
  const oldSummary = { count: 2, returns: 0, gross: 300, refunds: 0, total: 300, by: { Cash: 300 } };   /* no .expenses field at all */
  const f = R.fold([oldSummary, R.totals([spend('E-1', 40, 'Cash', 'Rent')])]);
  assert.strictEqual(f.expenses, 40, 'the old summary contributed 0, not NaN');
  assert.strictEqual(f.total, 260);
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

console.log('\n\u26A0\uFE0F\u26A0\uFE0F\u26A0\uFE0F THE PURGE \u2014 THE ONLY CODE HERE THAT DESTROYS A RECORD OF MONEY\n');

/**
 * Athi: *"do the purge with a floor of 90 days."* Five things must be true before a day's bills are deleted, and
 * each one below is a way of losing a sale for good if it were skipped.
 */
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const SYNCED = { synced_at: '2026-01-01T00:00:00Z' };
const plan = (days, over) => R.planPurge(Object.assign({
  days, now: Date.now(), summaryOf: () => SYNCED, queuedDays: new Set(),
}, over || {}));

it('the floor is 90 days by default', () => {
  assert.strictEqual(R.FLOOR_DAYS, 90);
  assert.strictEqual(plan([]).floor, 90);
});

it('a day inside the floor is never purged, however tidy it is', () => {
  const p = plan([dayAgo(89), dayAgo(30), dayAgo(0)]);
  assert.deepStrictEqual(p.due, [], 'a day inside the floor was due for deletion');
  assert.strictEqual(p.kept.length, 3);
  assert.ok(/inside the 90-day floor/.test(p.kept[0].why));
});

/** ⚠️ the boundary itself: a day exactly ON the floor is still inside it */
it('the boundary day is INSIDE the floor, not outside', () => {
  assert.deepStrictEqual(plan([dayAgo(90)]).due, [], 'the day exactly on the floor was purged');
  assert.deepStrictEqual(plan([dayAgo(91)]).due, [dayAgo(91)]);
});

it('an old, summarised, synced, settled day is purged', () => {
  assert.deepStrictEqual(plan([dayAgo(200)]).due, [dayAgo(200)]);
});

console.log('\n\u26A0\uFE0F\u26A0\uFE0F AND THE FOUR REFUSALS\n');

it('NOT SUMMARISED — its figures would vanish with its bills', () => {
  const p = plan([dayAgo(200)], { summaryOf: () => null });
  assert.deepStrictEqual(p.due, []);
  assert.ok(/not summarised/.test(p.kept[0].why), p.kept[0].why);
});

it('NOT SYNCED — this disk is the shop\u2019s only record of it', () => {
  const p = plan([dayAgo(200)], { summaryOf: () => ({ synced_at: null }) });
  assert.deepStrictEqual(p.due, []);
  assert.ok(/has not reached ChitBridge/.test(p.kept[0].why), p.kept[0].why);
});

/** ⚠️⚠️ the worst one to get wrong: a sale ChitBridge has never seen */
it('A BILL STILL WAITING TO BE SENT stops the whole day', () => {
  const d = dayAgo(200);
  const p = plan([d], { queuedDays: new Set([d]) });
  assert.deepStrictEqual(p.due, [], 'a day with an unsent bill was deleted');
  assert.ok(/still waiting to be sent/.test(p.kept[0].why), p.kept[0].why);
});

/**
 * ⚠⚠ THE HOLE THIS CLOSES. rollUp() enumerates days by listing bills-*.jsonl — so deleting a day's bills
 * before its week is folded makes that day stop existing for the fold, and the week would be written from the
 * survivors, be wrong, and be written ONCE.
 */
it('ITS WEEK MUST BE SUMMARISED FIRST, or the week would be folded without it', () => {
  const d = dayAgo(200);
  const p = plan([d], { summaryOf: (period) => (period === 'week' ? null : SYNCED) });
  assert.deepStrictEqual(p.due, []);
  assert.ok(/its week is not summarised/.test(p.kept[0].why), p.kept[0].why);
});

it('and its month too, synced', () => {
  const d = dayAgo(200);
  const a1 = plan([d], { summaryOf: (period) => (period === 'month' ? null : SYNCED) });
  assert.ok(/its month is not summarised/.test(a1.kept[0].why), a1.kept[0].why);
  const a2 = plan([d], { summaryOf: (period) => (period === 'month' ? { synced_at: null } : SYNCED) });
  assert.ok(/month summary has not reached/.test(a2.kept[0].why), a2.kept[0].why);
});

console.log('\n\u26A0\uFE0F A RUNAWAY SWEEP IS REFUSED, NOT PERFORMED\n');

it('at most MAX_PER_RUN in one go, oldest first', () => {
  const many = [];
  for (let i = 100; i < 400; i++) many.push(dayAgo(i));
  const p = plan(many, { max: 5 });
  assert.strictEqual(p.due.length, 5, 'the cap did not hold');
  /* ⚠️ OLDEST FIRST, so a catch-up run makes progress in date order rather than nibbling at random */
  assert.deepStrictEqual(p.due, p.due.slice().sort(), 'the due list is not in date order');
  assert.strictEqual(p.due[0], dayAgo(399), 'the oldest day was not taken first');
  assert.ok(p.kept.some((k) => /over the 5-per-run limit/.test(k.why)), 'the skipped days did not say why');
});

it('the default cap is a real number, not unlimited', () => {
  assert.ok(R.MAX_PER_RUN > 0 && R.MAX_PER_RUN <= 1000, 'MAX_PER_RUN is ' + R.MAX_PER_RUN);
});

/** ⚠️ EVERY day it did not purge says why — a silent skip reads the same as a silent delete */
it('every kept day carries a reason', () => {
  const p = plan([dayAgo(10), dayAgo(200), dayAgo(300)], { summaryOf: (pd) => (pd === 'day' ? null : SYNCED) });
  assert.ok(p.kept.every((k) => k.day && k.why && k.why.length > 8), JSON.stringify(p.kept));
});

it('a floor can be set, and a silly one falls back to the default', () => {
  assert.strictEqual(plan([], { floorDays: 365 }).floor, 365);
  assert.strictEqual(plan([], { floorDays: 0 }).floor, 90, 'a zero floor would purge yesterday');
  assert.strictEqual(plan([], { floorDays: -5 }).floor, 90);
  assert.strictEqual(plan([], { floorDays: 'soon' }).floor, 90);
});

it('nothing on disk is not an error', () => {
  const p = plan([]);
  assert.deepStrictEqual(p.due, []); assert.deepStrictEqual(p.kept, []);
});

console.log('\n\u2B50\u2B50 ONE SHOP, MANY COUNTERS \u2014 THE SERVER HALF\n');

/**
 * Athi: *"this can be kept in local and also in server."* A counter folds its own periods; only the server can
 * fold ACROSS counters. GET /api/till/summary calls this with the stored summaries, newest first.
 */
const sm = (key, tillId, totals, at) => ({ period: 'day', key, till: { id: tillId, name: tillId }, totals,
  summarised_at: at || '2026-09-17T00:00:00Z' });
const T = (n) => R.totals([sale('x', n)]);

it('two counters on one day fold into one shop figure', () => {
  const out = R.acrossCounters([sm('2026-09-16', 'C1', T(100)), sm('2026-09-16', 'C2', T(250))]);
  assert.strictEqual(out.length, 1, 'the two counters did not land on one day');
  assert.strictEqual(out[0].totals.total, 350);
  assert.strictEqual(out[0].totals.count, 2);
  assert.strictEqual(out[0].counters.length, 2, 'the per-counter breakdown was lost');
});

/**
 * ⚠️⚠️ THE ONE THAT WOULD DOUBLE A SHOP'S TAKINGS. A counter re-sends a period only when its own copy was
 * lost; the newest is the corrected one, and counting both would silently inflate the day.
 */
it('A RE-SEND BY THE SAME COUNTER IS NOT COUNTED TWICE', () => {
  const out = R.acrossCounters([
    sm('2026-09-16', 'C1', T(120), '2026-09-18T00:00:00Z'),   /* newest first — the corrected one */
    sm('2026-09-16', 'C1', T(100), '2026-09-17T00:00:00Z'),   /* the superseded original */
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totals.total, 120, 'a re-send was added instead of replacing');
  assert.strictEqual(out[0].counters.length, 1, 'the superseded row is still in the breakdown');
});

it('but two different counters on the same day both count', () => {
  const out = R.acrossCounters([sm('2026-09-16', 'C1', T(10)), sm('2026-09-16', 'C2', T(10))]);
  assert.strictEqual(out[0].totals.total, 20, 'two counters were mistaken for a re-send');
});

it('periods come back newest first', () => {
  const out = R.acrossCounters([sm('2026-09-14', 'C1', T(1)), sm('2026-09-16', 'C1', T(2)), sm('2026-09-15', 'C1', T(3))]);
  assert.deepStrictEqual(out.map((x) => x.key), ['2026-09-16', '2026-09-15', '2026-09-14']);
});

/** ⚠️ losing a day because a till id was missing would be the same silent hole in a different place */
it('a summary with no counter is folded, not dropped', () => {
  const out = R.acrossCounters([{ period: 'day', key: '2026-09-16', totals: T(50) }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totals.total, 50);
});

it('rubbish rows are skipped without taking the good ones with them', () => {
  const out = R.acrossCounters([null, {}, { key: 'x' }, sm('2026-09-16', 'C1', T(9)), undefined]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totals.total, 9);
});

it('nothing stored is an empty list, not a throw', () => {
  assert.deepStrictEqual(R.acrossCounters([]), []);
  assert.deepStrictEqual(R.acrossCounters(null), []);
});

/** ⭐ the shop's month must equal its counters' months added up — the same property fold() has for days */
it('the shop figure equals its counters added up', () => {
  const parts = [T(100), T(250), T(33.33)];
  const out = R.acrossCounters(parts.map((t, i) => sm('2026-09', 'C' + i, t)));
  assert.deepStrictEqual(out[0].totals, R.fold(parts));
});

console.log('\n\u26A0\uFE0F\u26A0\uFE0F THE QUERY AND THE CHIT MUST AGREE\n');

/**
 * ── ⚠️⚠️⚠️ THE FAILURE THIS ROUTE HAS ALREADY SUFFERED ONCE ──────────────────────────
 *
 * GET /api/till/bills asked for direction 'sent' when a self chit lands as 'received'. It matched nothing,
 * errored never, and "Earlier bills" was empty for weeks on a shop that had been billing all week. A JSON path
 * that stops matching fails exactly the same way: silently, with an empty list.
 *
 * So this reads the ACTUAL SQL out of routes/till.js and checks every JSON path in it against the chit
 * rollup.chitOf() really produces. It cannot prove the SQL runs — that needs a database, and this box has
 * none — but it catches the one failure that would otherwise be invisible: the shape and the query drifting
 * apart. [[feedback-silence-is-the-bug]] [[feedback-check-after-the-wire]]
 */
const TILL_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'till.js'), 'utf8');
const SUMMARY_SQL = (function () {
  const at = TILL_SRC.indexOf("router.get('/summary'");
  assert.ok(at > 0, 'GET /api/till/summary is gone — this guard is measuring nothing');
  const sql = TILL_SRC.slice(at, TILL_SRC.indexOf('res.json(', at));
  assert.ok(/FROM chit_header/.test(sql), 'the summary route no longer queries chit_header');
  return sql;
})();

/** the chit as it is actually stored: POST /api/chits/send carries business_json through verbatim */
const STORED = R.chitOf(R.summary('day', '2026-09-16', R.totals([sale('1', 100)]), { till: { id: 'C1', name: 'Counter 1' } }));

it('the chit really does carry business_json.summary', () => {
  assert.ok(STORED.business_json && STORED.business_json.summary,
    'the summary rider is gone from the chit — the server route would match nothing');
});

/**
 * ⚠️ EVERY `business_json -> 'a' ->> 'b'` IN THE SQL IS RESOLVED AGAINST THE REAL OBJECT. A rename anywhere in
 * rollup.summary() breaks this test instead of quietly emptying a shopkeeper's trend screen.
 */
it('EVERY JSON PATH IN THE SQL RESOLVES ON A REAL CHIT', () => {
  const re = /business_json\s*->\s*'([a-z_]+)'\s*->>\s*'([a-z_]+)'/g;
  let m, checked = 0;
  while ((m = re.exec(SUMMARY_SQL))) {
    const got = STORED.business_json[m[1]] && STORED.business_json[m[1]][m[2]];
    assert.ok(got !== undefined && got !== null,
      "the SQL reads business_json -> '" + m[1] + "' ->> '" + m[2] + "' and a real chit has nothing there");
    checked++;
  }
  assert.ok(checked >= 2, 'only ' + checked + ' JSON paths were found — the parser has stopped matching');
});

it('the period the SQL filters on is one the engine emits', () => {
  assert.strictEqual(STORED.business_json.summary.period, 'day');
  assert.ok(R.PERIODS.indexOf(STORED.business_json.summary.period) >= 0);
});

/**
 * ⚠️⚠️ PURPOSE ALONE WOULD HAVE FOLDED SHIFT RECORDS INTO THE TAKINGS. A summary chit is 'general', and so
 * is the shift chit the counter has sent since 2026-09-08. The query must also test for the summary rider.
 */
it('the query does not match on purpose alone', () => {
  assert.ok(/purpose\s*=\s*'general'/.test(SUMMARY_SQL), 'the purpose filter is gone');
  assert.ok(/business_json\s*->\s*'summary'/.test(SUMMARY_SQL),
    "the query matches purpose 'general' without testing for the summary rider — shift chits would be folded");
});

/** ⚠️ acrossCounters() keeps the FIRST sighting of a (key, till) pair, so the query must be newest-first */
it('the query is ordered newest-first, which the fold relies on', () => {
  assert.ok(/ORDER BY[\s\S]*DESC/.test(SUMMARY_SQL),
    'the ordering is gone — acrossCounters would keep a SUPERSEDED re-send instead of the corrected one');
});

/** ⚠️ RLS: chit_header is FORCE RLS, and a read outside withEntity() returns an empty set, not an error */
it('the read goes through withEntity — RLS, not a bare query', () => {
  assert.ok(/withEntity\(entity_id/.test(SUMMARY_SQL),
    'the summary route reads chit_header without withEntity() — under FORCE RLS it would silently return nothing');
});


/* ══ ⭐⭐⭐ THE YEAR ([TILL-184]) ═══════════════════════════════════════════════════════════════════════════
 *
 * Athi: *"please confirm that MIS I asked for has been completed, in the sense, summing weekly, monthly,
 * yearly?"* Day, week and month were built and proven. The year was not there at all — this is it.
 */
console.log('\nA YEAR, AND IT IS THE FINANCIAL ONE\n');

/**
 * ⚠️⚠️ APRIL IS A DECISION, NOT A DETAIL. India's financial year runs 1 April to 31 March and every return a
 * shop files is against it; a January–December total is a number no Indian shopkeeper has a use for.
 */
it('⚠️⚠️ the year runs April to March by default', () => {
  assert.strictEqual(R.yearKey('2026-04-01'), '2026-27', '1 April did not start the new year');
  assert.strictEqual(R.yearKey('2027-03-31'), '2026-27', '31 March fell out of its own year');
  assert.strictEqual(R.yearKey('2026-03-31'), '2025-26');
  assert.strictEqual(R.yearKey('2026-12-31'), '2026-27', 'December was filed under the calendar year');
});

/** ⭐ and a shop whose year starts in January says so, and gets a key that LOOKS different */
it('⭐ a calendar-year shop is told apart at a glance', () => {
  assert.strictEqual(R.yearKey('2026-12-31', 1), '2026');
  assert.strictEqual(R.yearKey('2026-01-01', 1), '2026');
  /* ⚠️ a key that looked the same for both is how two shops' figures end up added together */
  assert.notStrictEqual(R.yearKey('2026-12-31', 1), R.yearKey('2026-12-31', 4));
});

it('and another country\'s year works without a code change', () => {
  /* ⭐ 1 July — Australia. The rule is a number, not a branch. */
  assert.strictEqual(R.yearKey('2026-07-01', 7), '2026-27');
  assert.strictEqual(R.yearKey('2026-06-30', 7), '2025-26');
});

it('the year is a period like any other', () => {
  assert.ok(R.PERIODS.indexOf('year') >= 0, 'the server reads PERIODS to decide what it will serve');
  assert.strictEqual(R.keyOf('year', '2026-05-02'), '2026-27');
  assert.strictEqual(R.keyOf('year', '2026-05-02', { fyStart: 1 }), '2026');
});

/** ⚠️ a year still running must never be summarised — the figure would change after it was published */
it('⚠️ a year that is still running is not closed', () => {
  assert.strictEqual(R.isClosed('year', '2026-27', new Date('2026-09-21T00:00:00Z')), false);
  assert.strictEqual(R.isClosed('year', '2025-26', new Date('2026-09-21T00:00:00Z')), true);
  /* ⚠️⚠️ THE BOUNDARY: on 31 March the year is still open, and on 1 April it is not */
  assert.strictEqual(R.isClosed('year', '2026-27', new Date('2027-03-31T00:00:00Z')), false);
  assert.strictEqual(R.isClosed('year', '2026-27', new Date('2027-04-01T00:00:00Z')), true);
});

/**
 * ⚠️⚠️⚠️ THE SAME EQUALITY THE WHOLE ROLLUP RESTS ON, now one level higher: a year folded from twelve months
 * must equal the same bills summarised directly. If it does not, purging the months makes the year unprovable.
 */
it('⚠️⚠️⚠️ a year folded from months equals the bills themselves', () => {
  const bill = (at, total, how) => ({ at, total, payments: [{ how: how || 'Cash', amount: total }] });
  const all = [];
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = 4 + i;                                   /* April .. March */
    const y = m <= 12 ? 2026 : 2027;
    const mm = m <= 12 ? m : m - 12;
    const day = y + '-' + String(mm).padStart(2, '0') + '-15';
    const rows = [bill(day, 100 + i), bill(day, 50, 'UPI')];
    all.push.apply(all, rows);
    months.push(R.summary('month', R.monthKey(day), R.totals(rows), {}));
  }
  const folded = R.fold(months);
  const direct = R.totals(all);
  assert.deepStrictEqual(folded, direct, 'a year folded from months disagrees with its own bills');
  assert.strictEqual(folded.count, 24);
});

/**
 * ⚠️⚠️ AND THE REFERENCE MUST EXIST. 'SUM/undefined/C1/2026-27' is a perfectly valid string — a year sent under
 * it could never be matched again, and re-sending would grow duplicates on the server for ever.
 */
it('⚠️⚠️ a year has its own reference letter', () => {
  const sum = R.summary('year', '2026-27', R.totals([]), { till: { id: 'C2' } });
  assert.strictEqual(R.refOf(sum), 'SUM/Y/C2/2026-27');
  /* ⭐ break it before trusting it: a period with no letter must throw rather than emit 'undefined' */
  assert.throws(() => R.refOf({ period: 'decade', key: 'x' }), /no reference letter/);
});

it('and it says what it is on the chit', () => {
  const sum = R.summary('year', '2026-27', R.totals([]), { till: { id: 'C2', name: 'Front' } });
  assert.ok(/Year summary — 2026-27/.test(R.chitOf(sum).subject), R.chitOf(sum).subject);
});


/* ══ ⭐⭐⭐ A SHORT PERIOD SAYS SO ([TILL-184]) ═══════════════════════════════════════════════════════════ */
console.log('\nA SHORT PERIOD SAYS SO\n');

/**
 * Athi, on a financial year folded from fewer than twelve months: *"no we can say upto"*.
 *
 * ⚠️⚠️ THE TWO OBVIOUS ANSWERS ARE BOTH WRONG. A shop's first financial year starts whenever it opened, so it
 * can never have twelve months: refusing to summarise it leaves the Years view empty for ever with nothing
 * said, and summarising it silently puts a part-year's trading under "2026-27" looking like a full one.
 */
it('⭐⭐⭐ a part year is folded AND labelled', () => {
  const c = R.coverage({ period: 'year', source: ['2026-06', '2026-07', '2026-08'] });
  assert.strictEqual(c.partial, true);
  assert.strictEqual(c.parts, 3);
  assert.strictEqual(c.say, 'up to August 2026');
});

/** ⭐ '2026-08' reads as August to a person; the key does not */
it('⭐ and it says the month in words', () => {
  assert.ok(/January 2027/.test(R.coverage({ period: 'year', source: ['2026-04', '2027-01'] }).say));
  assert.ok(/March 2027/.test(R.coverage({ period: 'year', source: ['2026-04', '2027-03'] }).say));
});

it('a full year says nothing, because there is nothing to say', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => '2026-' + String(i + 1).padStart(2, '0'));
  const c = R.coverage({ period: 'year', source: twelve });
  assert.strictEqual(c.partial, false);
  assert.strictEqual(c.say, '');
  assert.strictEqual(c.from, '2026-01');
  assert.strictEqual(c.to, '2026-12');
});

/** ⚠️ a short WEEK is a real thing too — a shop that opened on Thursday has a four-day week */
it('⚠️ a short week is labelled as well', () => {
  const c = R.coverage({ period: 'week', source: ['2026-09-17', '2026-09-18', '2026-09-19'] });
  assert.strictEqual(c.partial, true);
  assert.ok(/up to 2026-09-19/.test(c.say), c.say);
});

/**
 * ⚠️⚠️ A MONTH IS 28 TO 31 DAYS, so "full" cannot be an equality — February would be reported short every year,
 * and a label that cries wolf annually is one nobody reads.
 */
it('⚠️⚠️ February is not a short month', () => {
  const feb = Array.from({ length: 28 }, (_, i) => '2026-02-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(R.coverage({ period: 'month', source: feb }).partial, false);
  const half = feb.slice(0, 10);
  assert.strictEqual(R.coverage({ period: 'month', source: half }).partial, true);
});

it('and a summary written before this existed still answers', () => {
  /* ⚠️ `source` is null when a period was read straight from bills rather than folded — not an error */
  const c = R.coverage({ period: 'year' });
  assert.strictEqual(c.partial, false);
  assert.strictEqual(c.say, '');
  assert.strictEqual(R.coverage(null).say, '');
});

/** ⭐ a day is never partial — it is the smallest thing there is */
it('⭐ a day cannot be short', () => {
  assert.strictEqual(R.coverage({ period: 'day', source: ['2026-09-21'] }).partial, false);
});

console.log('\n' + pass + ' checks passed\n');
