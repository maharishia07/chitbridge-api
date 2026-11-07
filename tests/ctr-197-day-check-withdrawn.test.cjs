'use strict';
/**
 * ctr-197-day-check-withdrawn.test.cjs - CTR-197: the counter's day check (dayServerCheck) knows a bill that was cancelled elsewhere.
 * GET /api/till/bills leaves a cancelled bill out and NAMES it in `withdrawn`. The device still holds that bill locally; before this it read
 * as "1 bill the server does not have yet", Close the day greyed and Send could not clear it. Now it is marked withdrawn in the local
 * store (out of every day sum), left out of both sides of the check, and the check agrees.
 * The page's own functions are lifted out of the kit master and run over an in-memory store (no browser).
 *   IN : live 1000 (S1), cancelled 1180 (S2)    AU : live 1100 (S1), cancelled 550 (S2)    a really unsent bill still differs
 * Run: node tests/ctr-197-day-check-withdrawn.test.cjs
 * CARD      09-counter/day-close
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');

/** one top-level function (plain or async) of the page, by name */
function lift(name) {
  let i = PAGE.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = PAGE.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not in the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth++;
    else if (PAGE[k] === '}') { depth--; if (depth === 0) return PAGE.slice(i, k + 1) + '\n'; }
  }
  throw new Error('unbalanced ' + name);
}

const NAMES = ['dayKeyOf', 'isDocRow', 'isExpenseRow', 'isReturnRow', 'withdrawnNos', 'dayMarkWithdrawn', 'dayServerCheck', 'dayCheckThenRefresh'];
const today = new Date().toISOString();

/** a fresh page context: a local store, a server answer, the lifted functions */
function scene(local, serverAnswer) {
  const store = local.map((b) => Object.assign({}, b));
  const ctx = {
    window: {}, Date, Object, Array, String, Number, isNaN, Promise,
    DB: { all: async () => store, put: async (name, row) => { const at = store.findIndex((b) => b.no === row.no); if (at >= 0) store[at] = row; } },
    HOST: { history: async () => serverAnswer, cred: () => true },
    dayClose: () => { ctx.reopened = (ctx.reopened || 0) + 1; },
    tillId: () => 'C1', cbQuiet: (where, e) => { throw e; },
    r2: (n) => Math.round((Number(n) || 0) * 100) / 100
  };
  vm.createContext(ctx);
  vm.runInContext(NAMES.map(lift).join('\n'), ctx);
  return { ctx, store };
}
const bill = (no, total) => ({ no, at: today, total, lines: [], kind: 'cash' });
const rowsOf = (store, ctx) => store.filter((b) => !ctx.isDocRow(b));

(async () => {
  let n = 0;
  const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name); });

  for (const [country, live, cancelled] of [['IN', 1000, 1180], ['AU', 1100, 550]]) {
    await ok(country + ': a bill cancelled elsewhere is known, not unsent - the check agrees and the day sum is the live bill', async () => {
      const server = { bills: [bill('S1', live)], withdrawn: [{ no: 'S2', chit_id: 'c2', client_ref: 'r2', at: today }] };
      const { ctx, store } = scene([bill('S1', live), bill('S2', cancelled)], server);
      const rows = rowsOf(store, ctx);
      const chk = await ctx.dayServerCheck(rows);
      assert.strictEqual(chk.state, 'agree');
      assert.deepStrictEqual([chk.fewer.length, chk.more.length, chk.fewerTotal], [0, 0, 0]);
      assert.strictEqual(chk.marked, 1);
      assert.ok(store.find((b) => b.no === 'S2')._withdrawn, 'marked cancelled in the local store');
      assert.strictEqual(store.length, 2, 'kept for the record, not deleted');
      assert.strictEqual(rowsOf(store, ctx).reduce((a, b) => a + b.total, 0), live, 'the local day sum leaves it out');
      const again = await ctx.dayServerCheck(rowsOf(store, ctx));
      assert.deepStrictEqual([again.state, again.marked], ['agree', 0], 'the second pass marks nothing, so the report settles');
    });
  }
  await ok('the report is read again when a cancelled bill left the day, and only then', async () => {
    const first = scene([bill('S1', 1000), bill('S2', 1180)], { bills: [bill('S1', 1000)], withdrawn: [{ no: 'S2' }] });
    await first.ctx.dayCheckThenRefresh(rowsOf(first.store, first.ctx));
    assert.strictEqual(first.ctx.reopened, 1);
    await first.ctx.dayCheckThenRefresh(rowsOf(first.store, first.ctx));
    assert.strictEqual(first.ctx.reopened, 1, 'the second pass marks none, so it does not read again');
  });
  await ok('a bill the server does not know and did not withdraw is still unsent: the check differs', async () => {
    const { ctx, store } = scene([bill('S1', 1000), bill('S3', 250)], { bills: [bill('S1', 1000)], withdrawn: [] });
    const chk = await ctx.dayServerCheck(rowsOf(store, ctx));
    assert.deepStrictEqual([chk.state, chk.fewer.map((b) => b.no), chk.fewerTotal], ['differ', ['S3'], 250]);
  });
  await ok('an older server that sends no `withdrawn` behaves as before', async () => {
    const { ctx, store } = scene([bill('S1', 1000), bill('S2', 1180)], { bills: [bill('S1', 1000)] });
    const chk = await ctx.dayServerCheck(rowsOf(store, ctx));
    assert.deepStrictEqual([chk.state, chk.marked], ['differ', 0]);
  });
  await ok('offline still says offline and marks nothing', async () => {
    const { ctx, store } = scene([bill('S1', 1000)], { bills: [], offline: true });
    assert.strictEqual((await ctx.dayServerCheck(rowsOf(store, ctx))).state, 'offline');
  });
  console.log(n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
