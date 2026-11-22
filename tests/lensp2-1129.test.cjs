/**
 * tests/lensp2-1129.test.cjs — LENS pass 2 (1129): four P2s from walks/reviews/VERIFY-lens-*.md "Pass 2".
 *   1  db inlineLiteral: a negative number is parenthesised, so `a -$1` is never `a --5` (an SQL comment); -5, -0.5, -0, and the string "--x"
 *   2  chit-proposal applyVersion: amendments + agreed money + closed rounds + timeline row are ONE transaction; a throw mid-way leaves nothing
 *   3  reward-store settle: same ref (idempotency key) with another spend is refused in words (409), the same spend still replays
 *   4  counters-store noteBill: the counter's period never moves back on a late-clocked replay of an older period
 * Run: node tests/lensp2-1129.test.cjs   (offline, no database)
 */
'use strict';
const assert = require('assert');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const root = (p) => path.join(API, p);
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e)); }
};

/* ── the fake database: a transaction that rolls back on a throw ─────────────────────────────────────────── */
const world = { ops: [], failOn: null, counter: null, ledger: [] };
let txCount = 0;
async function fakeWithEntity(_id, fn) {
  const mark = world.ops.length;
  const me = ++txCount;
  const tx = {
    query: async (sql, p) => {
      const s = String(sql);
      if (world.failOn && world.failOn.test(s)) throw new Error('injected failure');
      world.ops.push({ sql: s.replace(/\s+/g, ' ').slice(0, 60), tx: me });
      if (/FROM reward_ledger/.test(s) && /GROUP BY why/.test(s)) {
        const mine = world.ledger.filter((x) => x.ref === p[3]);
        const sums = {};
        mine.forEach((x) => { sums[x.why] = (sums[x.why] || 0) + x.points; });
        return { rows: Object.keys(sums).map((why) => ({ why, points: sums[why] })) };
      }
      if (/FROM identities/.test(s)) return { rows: [{ c: world.counter }] };
      return { rows: [] };
    }
  };
  try { return await fn(tx); }
  catch (e) { world.ops.length = mark; throw e; } /* ROLLBACK */
}
const stub = (file, exp) => { const id = require.resolve(root(file)); require.cache[id] = { id, filename: id, loaded: true, exports: exp }; };

(async () => {
  /* 1 ── the ONE formatter ─────────────────────────────────────────────────────────────────────────────── */
  const dbReal = require(root('db/index.js'));
  await t('1 inlineSql: -5, -0.5 and -0 are parenthesised, so "a -$1" never reads "a --5"', () => {
    assert.strictEqual(dbReal.inlineSql('SELECT 10 -$1', [-5]), 'SELECT 10 -(-5)');
    assert.strictEqual(dbReal.inlineSql('SELECT 10 -$1', [-0.5]), 'SELECT 10 -(-0.5)');
    for (const v of [-5, -0.5, -1e-7]) assert.ok(!/--/.test(dbReal.inlineSql('SELECT 10 -$1', [v])), 'no comment marker for ' + v);
  });
  await t('1 inlineSql: positives are unchanged and the string "--x" stays a quoted literal, never a comment', () => {
    assert.strictEqual(dbReal.inlineSql('SELECT $1 + $2', [5, 0.5]), 'SELECT 5 + 0.5');
    assert.strictEqual(dbReal.inlineSql('SELECT $1, $2', ['--x', 'a']), "SELECT '--x', 'a'");
    assert.strictEqual(dbReal.inlineSql("SELECT '--keep' , $1", [-2]), "SELECT '--keep' , (-2)");
  });

  /* 2 ── applyVersion is one transaction ───────────────────────────────────────────────────────────────── */
  stub('db/index.js', { query: async () => ({ rows: [] }), withEntity: fakeWithEntity, withTransaction: (fn) => fakeWithEntity(null, fn), onEntity: async (i, d, fn) => (d ? fn(d) : fakeWithEntity(i, fn)), readBatch: async () => ({}), trySavepoint: async (d, fn, fb) => { try { return await fn(d); } catch (_) { return fb; } }, inlineSql: dbReal.inlineSql });
  const amend = require(root('lib/amend'));
  /* the stand-in for amend.record keeps its real contract: the caller's `inside` step runs INSIDE the one transaction (RAIL-147) */
  amend.record = async (entity, chit, edits, who, inside = async (_c, prepared) => prepared) => fakeWithEntity(entity, async (db) => { await inside(db, edits); await db.query('INSERT INTO chit_line_amendment'); return { amendments: edits }; });
  require(root('lib/invoice-issued')).isIssued = async () => false;
  const proposals = require(root('lib/chit-proposal'));
  const ROW = { kind: 'change', round: 2, proposal_id: 'p1', from_entity_id: 'seller', from_name: 'Seller', edits: [{ line_index: 0, line: { price: 90 } }], invoice: { x: 1 }, summary: { total_value: 90 } };
  await t('2 accept: a throw on the LAST step leaves nothing (no amended lines, old total, round still open)', async () => {
    world.ops.length = 0; world.failOn = /INSERT INTO state_log/;
    await assert.rejects(() => proposals.applyVersion('buyer', 'c1', ROW, { name: 'Buyer' }), /injected/);
    world.failOn = null;
    assert.deepStrictEqual(world.ops.map((o) => o.sql), [], 'nothing of the accept survives: ' + JSON.stringify(world.ops));
  });
  await t('2 accept: a throw mid-way (closing the rounds) leaves nothing either', async () => {
    world.ops.length = 0; world.failOn = /UPDATE chit_proposal SET status = 'accepted'/;
    await assert.rejects(() => proposals.applyVersion('buyer', 'c1', ROW, { name: 'Buyer' }), /injected/);
    world.failOn = null;
    assert.deepStrictEqual(world.ops, []);
  });
  await t('2 accept: success writes the amendment, money, rounds and timeline row in ONE transaction', async () => {
    world.ops.length = 0;
    await proposals.applyVersion('buyer', 'c1', ROW, { name: 'Buyer' });
    const kinds = world.ops.map((o) => o.sql);
    assert.ok(kinds.some((k) => /chit_line_amendment/.test(k)) && kinds.some((k) => /UPDATE chit_header/.test(k)) && kinds.some((k) => /state_log/.test(k)), JSON.stringify(kinds));
    const writes = world.ops.filter((o) => !/^s*SELECT/i.test(o.sql) && !/chit_line_amendment/.test(o.sql)); /* the amendment row goes through amend.record, which JOINS the caller's handle (LV-04, givenDb): proved by the source line below; this stub cannot tell a joined handle from a new one */
    assert.ok(/amend.record([^;]*undefined, db)/.test(require('fs').readFileSync(root('lib/chit-proposal.js'), 'utf8')), 'applyVersion hands amend.record its own handle'); /* fold 1129: a read before the transaction opens is not a write; every WRITE is in the one */
    assert.ok(writes.length >= 4, 'the writes: ' + writes.length);
    assert.strictEqual(new Set(writes.map((o) => o.tx)).size, 1, 'one transaction for every write: ' + JSON.stringify(writes.map((o) => o.tx + ':' + o.sql.slice(0, 40))));
  });

  /* 3 ── reward replay with another spend ──────────────────────────────────────────────────────────────── */
  const store = require(root('lib/reward-store'));
  require(root('lib/xact-lock')).lockKeys = async () => undefined;
  require(root('lib/counter-bill')).byRef = async () => ({ billed_at: null, line_items: [] });
  require(root('lib/rewards')).earnedOn = () => 0;
  const prog = { definition_id: 'd1' }, holder = { scheme: 'phone', value: '9840012345' };
  world.ledger.push({ why: 'spent', points: -4, ref: 'B1' });
  await t('3 spend replay: same ref, same spend 4 replays as before', async () => {
    const r = await store.settle('e1', holder, prog, { ref: 'B1', spend: 4, earn: false }, fakeWithEntity);
    assert.strictEqual(r.replayed, true); assert.strictEqual(r.spent, 4);
  });
  await t('3 spend replay: same ref, spend 9 is REFUSED 409 in words, never success', async () => {
    await assert.rejects(() => store.settle('e1', holder, prog, { ref: 'B1', spend: 9, earn: false }, fakeWithEntity), (e) => e.status === 409 && e.code === 'REWARD_REF_REUSED' && /Nothing moved/.test(e.say) && /4 points/.test(e.say));
  });
  await t('3 spend replay: same ref, spend 0 where 4 was spent is refused too', async () => {
    await assert.rejects(() => store.settle('e1', holder, prog, { ref: 'B1', spend: 0, earn: false }, fakeWithEntity), (e) => e.status === 409);
  });

  /* 4 ── the counter's period never moves back ────────────────────────────────────────────────────────── */
  const counters = require(root('lib/counters-store'));
  const patches = [];
  require(root('lib/policy')).patchKey = async (_db, _e, keyPath, patch) => { patches.push({ keyPath, patch }); };
  const series = (period, seq) => ({ prefix: 'c1', period, seq });
  await t('4 noteBill: a late-clocked replay of an OLDER period (clock after the mark) leaves period and next alone', async () => {
    world.counter = { period: '26-27', next: 42, hw_at: '2026-10-01T10:00:00.000Z' }; patches.length = 0;
    await counters.noteBill('e1', series('25-26', 900), '2026-10-02T10:00:00.000Z', 'C1/25-26/0900');
    assert.deepStrictEqual(patches, [], 'no patch: ' + JSON.stringify(patches));
  });
  await t('4 noteBill: a LATER period still switches, the same period still raises next', async () => {
    world.counter = { period: '26-27', next: 42, hw_at: '2026-10-01T10:00:00.000Z' }; patches.length = 0;
    await counters.noteBill('e1', series('27-28', 3), '2027-04-02T10:00:00.000Z', 'C1/27-28/0003');
    assert.strictEqual(patches.length, 1); assert.strictEqual(patches[0].patch.period, '27-28'); assert.strictEqual(patches[0].patch.next, 4);
    world.counter = { period: '26-27', next: 42, hw_at: '2026-10-01T10:00:00.000Z' }; patches.length = 0;
    await counters.noteBill('e1', series('26-27', 50), '2026-10-03T10:00:00.000Z', 'C1/26-27/0050');
    assert.strictEqual(patches[0].patch.next, 51); assert.strictEqual(patches[0].patch.period, undefined);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
