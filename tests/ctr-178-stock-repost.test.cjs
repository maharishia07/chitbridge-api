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

const world = { chits: [], ledger: new Map(), failIssue: 0, issued: 0 };
const refOf = (chit) => String(chit.business_json.client_ref || chit.business_json.bill_no || chit.chit_id).slice(0, 64);
const withEntity = async (_entity, fn) =>
  fn({
    query: async (text) => {
      if (/FROM chit_header h JOIN chit_detail d/.test(String(text))) {
        const have = new Set([...world.ledger.keys()].map((key) => key.split('|')[0]));
        return { rows: world.chits.filter((chit) => !have.has(refOf(chit))) };
      }
      return { rows: [] };
    }
  });
store.issue = async (_entity, mv) => {
  world.issued++;
  if (world.failIssue > 0) {
    world.failIssue--;
    return { ok: false, why: 'connection reset' };
  }
  world.ledger.set([mv.ref, mv.line_ref, mv.reason].join('|'), -mv.qty);
  return { ok: true, moved: 1 };
};
stocked.flagsFor = async (_entity, ids) => ({ by: new Map(ids.map((id) => [id, { tracked: false, counted: true }])) });
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

  /* 7 — the SQL asks what the JS posts under: the ref chain, drafts and cancelled bills out, a bound */
  assert.ok(/m\.ref = left\(COALESCE[\s\S]*client_ref[\s\S]*bill_no[\s\S]*doc_no[\s\S]*chit_id::text\), 64\)/.test(sweep.GAPS_SQL), 'the SQL ref is movementsFor ref');
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
