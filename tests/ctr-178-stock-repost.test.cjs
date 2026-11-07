/**
 * tests/ctr-178-stock-repost.test.cjs — CTR-178: the stock a recorded counter sale takes out is not lost when the after-commit post fails or the process stops.
 *
 * OWNS      the proof that lib/stock-sweep finds a counter bill with no stock movement and posts it again through the real stock-from-chit.postFor
 *           (store.issue fails once -> moved 0, failed 1 -> the sweep moves it; again -> nothing twice), that a post that still fails is SAID (warn stock.repost,
 *           stock.repost.gave_up), that a retry timer is set after a failed line, and that routes/chits.js calls the sweep from sendStock and from sendReplay.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the db is a stand-in holding chits and a stock ledger in memory; stock-store.issue is the one thing made to fail.
 * FLOW      scene (bill, ledger) -> real postFor (first try, issue fails) -> real stock-sweep.healShop -> in-memory ledger
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 *
 * Run: node tests/ctr-178-stock-repost.test.cjs
 */
'use strict';
const real = require('assert'),
  path = require('path');
let checks = 0;
const assert = new Proxy(real, { get: (target, name) => (typeof target[name] === 'function' ? (...args) => (checks++, target[name](...args)) : target[name]) });
const API = path.join(__dirname, '..');
const files = require(path.join(API, 'tools', 'chits-files.cjs'));
const store = require(path.join(API, 'lib', 'stock-store'));
const stocked = require(path.join(API, 'lib', 'stocked'));
const logger = require(path.join(API, 'lib', 'logger'));
const sweep = require(path.join(API, 'lib', 'stock-sweep'));
const fromChit = require(path.join(API, 'lib', 'stock-from-chit'));

const MADE_TO_ORDER = '55555555-5555-4555-8555-555555555555';
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '44444444-4444-4444-8444-444444444444';
const bill = (n, extra) =>
  Object.assign(
    {
      chit_id: '2222222' + n + '-2222-4222-8222-222222222222',
      purpose: 'order',
      business_json: { bill_no: 'B-' + n, client_ref: 'T1-B-' + n },
      created_at: '2026-11-07T08:00:00Z',
      line_items: [{ line_id: 'L' + n, item_id: ITEM, quantity: 3, unit: 'pc', particulars: 'tea' }]
    },
    extra
  );

const world = { chits: [], ledger: new Map(), failIssue: 0, issued: 0, failLine: null, reads: [] };
const refOf = (chit) => String(chit.business_json.client_ref || chit.business_json.bill_no || chit.chit_id).slice(0, 64);
const stockLines = (chit) => chit.line_items.map((line, i) => ({ line_ref: String(line.line_id || i + 1), id: line.item_id, qty: line.quantity })).filter((line) => line.id && line.qty > 0);
const moved = (chit, lineRef) => world.ledger.has([refOf(chit), lineRef, 'sale'].join('|'));
const withEntity = async (_entity, fn) =>
  fn({
    query: async (text, params) => {
      const sql = String(text);
      if (/FROM chit_header h JOIN chit_detail d/.test(sql)) {
        const open = world.chits.filter((chit) => !(params[4] && chit.created_at >= params[4]) && stockLines(chit).some((line) => !moved(chit, line.line_ref)));
        world.reads.push(sql.includes('LIMIT 200') ? 'open' : 'page');
        if (sql.includes('LIMIT 200')) return { rows: open.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)) };
        return { rows: open.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, params[3]) };
      }
      return { rows: [] };
    }
  });
store.issue = async (_entity, mv) => {
  world.issued++;
  if (world.failLine && mv.line_ref === world.failLine) {
    world.failLine = null;
    return { ok: false, why: 'connection reset' };
  }
  if (world.failIssue > 0) {
    world.failIssue--;
    return { ok: false, why: 'connection reset' };
  }
  const key = [mv.ref, mv.line_ref, mv.reason].join('|');
  if (world.ledger.has(key)) return { ok: true, duplicate: true, moved: 0 };
  world.ledger.set(key, -mv.qty);
  return { ok: true, moved: 1 };
};
stocked.flagsFor = async (_entity, ids) => ({ by: new Map(ids.map((id) => [id, { tracked: false, counted: id !== MADE_TO_ORDER }])) });
const said = [];
const realWarn = logger.warn,
  realInfo = logger.info;
logger.warn = (what, data) => said.push(['warn', what, data]);
logger.info = (what, data) => said.push(['info', what, data]);

(async () => {
  /* 1 — the hunt-09 repro: the real postFor, store.issue fails once -> the shelf did not move */
  const sale = bill(1);
  world.chits = [sale];
  world.failIssue = 1;
  const first = await fromChit.postFor(SHOP, sale, withEntity, {});
  assert.strictEqual(first.moved, 0, 'the first post moved nothing');
  assert.strictEqual(first.failed.length, 1, 'and failed one line');
  assert.strictEqual(world.ledger.size, 0, 'the ledger holds nothing for the sale');

  /* 2 — the sweep finds that bill and posts it; the shelf moves once */
  const healed = await sweep.healShop(SHOP, withEntity, { grace: 0 });
  assert.deepStrictEqual([healed.found, healed.moved, healed.still.length], [1, 1, 0], 'one bill found, one line moved, none still failing');
  assert.strictEqual([...world.ledger.values()].reduce((a, b) => a + b, 0), -3, 'the stock came off by the 3 sold');
  assert.ok(said.some((s) => s[0] === 'info' && s[1] === 'stock.repost'), 'a heal is said');

  /* 3 — again: nothing found (a movement exists under its ref), nothing doubled */
  const again = await sweep.healShop(SHOP, withEntity, { grace: 0 });
  assert.deepStrictEqual([again.found, again.moved], [0, 0], 'a second sweep finds nothing');
  assert.strictEqual(world.ledger.size, 1, 'one movement, not two');

  /* 4 — a bill that still fails is NAMED, not swallowed */
  world.chits.push(bill(2));
  world.failIssue = 5;
  said.length = 0;
  const stuck = await sweep.healShop(SHOP, withEntity, { grace: 0 });
  assert.strictEqual(stuck.still.length, 1, 'the bill is reported still failing');
  assert.ok(said.some((s) => s[0] === 'warn' && s[1] === 'stock.repost' && s[2].still.length === 1), 'warn stock.repost names it');
  world.failIssue = 0;
  assert.strictEqual((await sweep.healShop(SHOP, withEntity, { grace: 0 })).moved, 1, 'and it posts once the shelf can be written');

  /* 5 — a store that throws is answered, never rejected */
  const broken = await sweep.healShop(SHOP, async () => { throw new Error('db down'); }, { grace: 0 });
  assert.strictEqual(broken.still[0].failed[0].why, 'db down', 'the read failure is named');

  /* 6 — retryLater sets a timer, tries again, and says it gave up after RETRIES */
  world.chits.push(bill(3));
  world.failIssue = 99;
  said.length = 0;
  const timers = [];
  const realSet = global.setTimeout;
  global.setTimeout = (fn) => (timers.push(fn), { unref() {} });
  sweep.retryLater('RETRY-SHOP', withEntity);
  sweep.retryLater('RETRY-SHOP', withEntity); /* a second call while one is set adds no second timer */
  assert.strictEqual(timers.length, 1, 'one timer for a shop');
  for (let i = 0; i < sweep.RETRIES; i++) {
    const next = timers.shift();
    assert.ok(next, 'a retry is set for try ' + (i + 1));
    next();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }
  global.setTimeout = realSet;
  assert.strictEqual(timers.length, 0, 'no sixth retry');
  assert.ok(said.some((s) => s[1] === 'stock.repost.gave_up'), 'giving up is said');

  /* 6b — HALF-POSTED: a 2-line bill, line 1 moved, line 2 failed once -> the sweep still finds it and posts line 2 only */
  world.chits = [];
  world.ledger.clear();
  const two = bill(5, { line_items: [{ line_id: 'LA', item_id: ITEM, quantity: 1, unit: 'pc' }, { line_id: 'LB', item_id: ITEM, quantity: 2, unit: 'pc' }] });
  world.chits = [two];
  world.failIssue = 0;
  world.failLine = 'LB';
  const half = await fromChit.postFor(SHOP, two, withEntity, {});
  assert.deepStrictEqual([half.moved, half.failed.length], [1, 1], 'line 1 moved, line 2 failed');
  const rest = await sweep.healShop(SHOP, withEntity, { grace: 0 });
  assert.deepStrictEqual([rest.found, rest.moved, rest.still.length], [1, 1, 0], 'the half-posted bill is found and its second line moves');
  assert.strictEqual([...world.ledger.values()].reduce((a, b) => a + b, 0), -3, 'both lines are off the shelf, once each');

  /* 6c — STARVATION: 60 newer bills that move no stock (made to order) cannot hide the one real gap behind them */
  world.chits = [];
  world.ledger.clear();
  sweep.memo.clear();
  for (let n = 0; n < 60; n++)
    world.chits.push(bill(10 + n, { created_at: '2026-11-07T09:' + String(10 + (n % 50)) + ':00Z', line_items: [{ line_id: 'M' + n, item_id: MADE_TO_ORDER, quantity: 1, unit: 'pc' }] }));
  world.chits.push(bill(9, { created_at: '2026-11-06T08:00:00Z' }));
  const hidden = await sweep.healShop(SHOP, withEntity, { grace: 0, say: true });
  assert.strictEqual(hidden.moved, 1, 'the real gap behind 60 no-stock bills is healed');
  assert.ok(hidden.found >= 61, 'the pass went on past the first full page');
  let posts = 0;
  await sweep.healShop(SHOP, withEntity, { grace: 0, post: (...args) => (posts++, fromChit.postFor(...args)) });
  assert.strictEqual(posts, 0, 'the no-stock bills are not posted again on the next pass');

  /* 6d — the gap still open after a pass is said, with a count over 30 days */
  world.chits = [bill(70)];
  world.failIssue = 9;
  sweep.memo.clear();
  said.length = 0;
  const openSaid = await sweep.healShop(SHOP, withEntity, { grace: 0, say: true });
  assert.strictEqual(openSaid.open, 1, 'one bill still open');
  assert.ok(said.some((s) => s[1] === 'stock.repost.open' && s[2].bills === 1), 'stock.repost.open names the count');
  world.failIssue = 0;

  /* 6e — a shop with only made-to-order lines is not alarmed: the 60 bills of 6c, memoed as not_stocked, give no stock.repost.open */
  world.chits = [];
  world.ledger.clear();
  sweep.memo.clear();
  for (let n = 0; n < 5; n++) world.chits.push(bill(80 + n, { line_items: [{ line_id: 'D' + n, item_id: MADE_TO_ORDER, quantity: 1, unit: 'pc' }] }));
  said.length = 0;
  const calm = await sweep.healShop(SHOP, withEntity, { grace: 0, say: true });
  assert.strictEqual(calm.open, 0, 'no open gap for a made-to-order shop');
  assert.ok(!said.some((s) => s[1] === 'stock.repost.open'), 'nothing is warned about');

  /* 6f — the memo holds only what can not heal: a no_cost skip is read again, never memoed */
  sweep.memo.clear();
  world.chits = [bill(90)];
  const noCost = await sweep.healShop(SHOP, withEntity, { grace: 0, say: true, post: async () => ({ moved: 0, failed: [], skipped: [{ code: 'no_cost' }] }) });
  assert.strictEqual((sweep.memo.get(SHOP) || new Map()).size, 0, 'a no_cost bill is not memoed');
  assert.strictEqual(noCost.open, 1, 'and it stays an open gap');

  /* 6g — the 30-day count is not run by a plain heal (a replay): only the throttled pass says */
  world.reads.length = 0;
  await sweep.healShop(SHOP, withEntity, { grace: 0 });
  assert.ok(!world.reads.includes('open'), 'a replay heal does not read the 30 days');

  /* 6h — the memo is per shop and capped: 600 remembered bills keep MEMO_CAP, the newest, and another shop's memo is its own */
  sweep.memo.clear();
  for (let n = 0; n < sweep.MEMO_CAP + 100; n++) sweep.remember('MEMO-SHOP', 'chit-' + n);
  sweep.remember('OTHER-SHOP', 'chit-0');
  assert.strictEqual(sweep.memo.get('MEMO-SHOP').size, sweep.MEMO_CAP, 'a shop keeps at most MEMO_CAP');
  assert.ok(sweep.memo.get('MEMO-SHOP').has('chit-' + (sweep.MEMO_CAP + 99)) && !sweep.memo.get('MEMO-SHOP').has('chit-0'), 'the oldest goes first');
  assert.strictEqual(sweep.memo.get('OTHER-SHOP').size, 1, 'another shop is its own memo');

  /* 7 — the SQL asks what the JS posts under: the ref chain, drafts and cancelled bills out, a bound */
  assert.ok(/m\.ref = left\(COALESCE[\s\S]*client_ref[\s\S]*bill_no[\s\S]*doc_no[\s\S]*chit_id::text\), 64\)/.test(sweep.GAPS_SQL), 'the SQL ref is movementsFor ref');
  assert.ok(/stocked' = 'false'/.test(sweep.GAPS_SQL) && /stocked' = 'false'/.test(sweep.OPEN_SQL), 'a product marked not stocked is out by SQL, in the page and in the count');
  assert.ok(!/[$][45]/.test(sweep.OPEN_SQL) && /[$]3/.test(sweep.OPEN_SQL), 'the count uses only its own three parameters');
  assert.ok(/ORDER BY h.created_at DESC/.test(sweep.GAPS_SQL) && /line_ref/.test(sweep.GAPS_SQL), 'newest first, judged per line');
  assert.ok(/m.line_ref = x.line_ref/.test(sweep.GAPS_SQL) && /#top-up/.test(sweep.GAPS_SQL), 'a movement counts for its own line_ref (and its top-up), not for the whole bill');
  assert.ok(/cancelled', 'rejected'/.test(sweep.GAPS_SQL) && /<> 'Draft'/.test(sweep.GAPS_SQL) && /LIMIT \$4/.test(sweep.GAPS_SQL), 'cancelled, draft and a limit');

  /* 8 — the route calls it: sendStock (retry + heal) and sendReplay (heal at once, before the duplicate answer) */
  const text = files.read(API);
  const stockBody = text.slice(text.indexOf('async function sendStock('), text.indexOf('async function sendBooks('));
  assert.ok(/stock-sweep'\)\.retryLater\(sender_id/.test(stockBody) && /stock-sweep'\)\.healSoon\(sender_id/.test(stockBody), 'sendStock retries a failed line and heals the shop');
  const replayFrom = text.indexOf('async function sendReplay(');
  const replayBody = text.slice(replayFrom, text.indexOf('function answerReplay(', replayFrom));
  const healAt = replayBody.indexOf("stock-sweep').healShop");
  assert.ok(healAt > 0 && healAt < replayBody.indexOf('return answerReplay'), 'sendReplay heals before it answers duplicate');

  logger.warn = realWarn;
  logger.info = realInfo;
  console.log(checks + ' checks');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
