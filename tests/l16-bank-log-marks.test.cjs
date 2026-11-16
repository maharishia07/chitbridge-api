'use strict';
/**
 * tests/l16-bank-log-marks.test.cjs — GET /bank/log marks past 5,000 (l16, W15-100; coordinator 16 Nov, growth5y speed check).
 * The marks read was `ORDER BY seq LIMIT 5000` ascending: after the 5,000th mark the NEWEST marks never came back, so a busy shop's latest reconciliation vanished.
 * Now: the NEWEST marks are read (newest first), returned oldest first so a replay is unchanged; `marks_limit` (0 to 5000; 0 = none, the Bank home needs only the sign-offs) and `marks_before` (a seq cursor)
 * page back to older ones; `marks_next` is the cursor of the next older page, or null. Pure node: a stub db that obeys ORDER BY seq [DESC] LIMIT n and seq < $3.
 */
const assert = require('assert');
const BRL = require('../lib/bank-rec-log');
const schema = require('../lib/schema');
let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  XX  ' + name + '\n' + (err && err.stack));
    process.exitCode = 1;
  }
};
const E = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = { account_id: '22222222-2222-4222-8222-222222222222', code: '1500', name: 'Bank' };
/** a shop with `n` marks, seq 1..n */
const marksOf = (n) => Array.from({ length: n }, (_, at) => ({ id: 'm' + (at + 1), seq: at + 1, account_id: ACCOUNT.account_id, kind: 'mark', line_key: 'k' + (at + 1), act: 'accept', how: 'ledger', entry_ids: [], chit_ids: [], note: null, attach_ref: null, made_by: 'u', made_at: 'x' }));
function stub(all) {
  const log = [];
  return {
    log,
    async query(sql, values) {
      log.push({ sql, values });
      if (/kind = 'mark'/.test(sql)) {
        const desc = /ORDER BY seq DESC/.test(sql),
          cap = Number(/LIMIT (\d+)/.exec(sql)[1]),
          before = /seq < \$3/.test(sql) && values[2] != null ? Number(values[2]) : Infinity;
        const rows = all.filter((row) => row.seq < before).sort((a, b) => (desc ? b.seq - a.seq : a.seq - b.seq));
        return { rows: rows.slice(0, cap) };
      }
      return { rows: [] };
    }
  };
}
(async () => {
  schema.hasTable = async () => true;
  schema.hasColumn = async () => false;
  const six = marksOf(6000);
  await t('RED FIRST: with 6,000 marks the NEWEST come back (the last mark is in the answer), oldest first', async () => {
    const out = await BRL.read(stub(six), E, ACCOUNT, null, null);
    assert.strictEqual(out.marks[out.marks.length - 1].line_key, 'k6000', 'the newest mark is the last in the log');
    assert.ok(out.marks.length <= 5000);
    assert.ok(out.marks[0].seq < out.marks[out.marks.length - 1].seq, 'oldest first, as a replay reads it');
  });
  await t('the answer says there are older marks: marks_next is the cursor of the oldest one returned', async () => {
    const out = await BRL.read(stub(six), E, ACCOUNT, null, null);
    assert.strictEqual(out.marks_next, out.marks[0].seq);
  });
  await t('marks_before pages back: the older 1,000 come next, then marks_next is null', async () => {
    const first = await BRL.read(stub(six), E, ACCOUNT, null, null);
    const second = await BRL.read(stub(six), E, ACCOUNT, null, null, { limit: 5000, before: first.marks_next });
    assert.strictEqual(second.marks.length, 1000);
    assert.strictEqual(second.marks[second.marks.length - 1].seq, first.marks[0].seq - 1);
    assert.strictEqual(second.marks_next, null);
  });
  await t('marks_limit: a smaller page, and 0 reads no marks at all (the Bank home needs only the sign-offs)', async () => {
    const small = await BRL.read(stub(six), E, ACCOUNT, null, null, { limit: 100 });
    assert.strictEqual(small.marks.length, 100);
    assert.strictEqual(small.marks[99].line_key, 'k6000');
    const db = stub(six);
    const none = await BRL.read(db, E, ACCOUNT, null, null, { limit: 0 });
    assert.deepStrictEqual(none.marks, []);
    assert.strictEqual(none.marks_next, null);
    assert.ok(!db.log.some((q) => /kind = 'mark'/.test(q.sql)), 'no statement reads the marks');
  });
  await t('a shop under the cap is unchanged: every mark, oldest first, no marks_next', async () => {
    const out = await BRL.read(stub(marksOf(30)), E, ACCOUNT, null, null);
    assert.strictEqual(out.marks.length, 30);
    assert.strictEqual(out.marks[0].line_key, 'k1');
    assert.strictEqual(out.marks_next, null);
  });
  await t('the options are validated in words: a limit 0 to 5000, a cursor a whole number', () => {
    assert.throws(() => BRL.marksPageOf({ marks_limit: '5001' }), (err) => err.code === 'MARKS_LIMIT_INVALID' && err.status === 400);
    assert.throws(() => BRL.marksPageOf({ marks_before: 'abc' }), (err) => err.code === 'MARKS_CURSOR_INVALID' && err.status === 400);
    assert.deepStrictEqual(BRL.marksPageOf({}), { limit: 5000, before: null });
    assert.deepStrictEqual(BRL.marksPageOf({ marks_limit: '0' }), { limit: 0, before: null });
  });
  console.log('\n' + pass + ' passed');
})();
