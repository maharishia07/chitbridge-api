'use strict';
/** tests/bankfix-signed-as-at.test.cjs — bankfix: the Bank page line READS the sign-off the api chooses (ONE rule, LATEST_SQL), and difference_minor is the UNEXPLAINED remainder, never statement minus books.
 *  Hand-computed: (A) statement 203,360.00, books 202,860.00, one unpresented cheque 500.00 → 203,360.00 - (202,860.00 + 500.00) = 0, so tied, unexplained 0.
 *  (B) the same two figures with no timing item → remainder +50,000 (and -50,000 reads the same 50,000). (C) June signed (seq 5), then May re-signed (seq 6): the newest is JUNE. */
const assert = require('assert');
const schema = require('../lib/schema');
const LOG = require('../lib/bank-rec-log');
let pass = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + name); } catch (err) { console.error('  XX  ' + name + '\n' + (err && err.stack)); process.exit(1); }
};
const E = '11111111-1111-4111-8111-111111111111';
const row = (extra) => Object.assign({ account_id: 'a1', period_to: '2026-06-30', difference_minor: 0, closing_bank_minor: 20336000, closing_books_minor: 20286000, made_at: '2026-07-02 09:00:00+00', currency: 'AUD' }, extra);

/** a stand-in for the SQL: applies LATEST_SQL's own WHERE and ORDER BY words to rows carrying a seq (so the order the SQL TEXT names is the order tested) */
function runLatest(sql, params, all) {
  assert.ok(/ORDER BY account_id, period_to DESC, seq DESC/.test(sql), 'order: the latest period end, a later re-sign of it winning');
  const asOf = /period_to <= \$2::date/.test(sql) ? params[1] : null;
  const seen = new Map();
  all.filter((r) => !asOf || r.period_to <= asOf).sort((x, y) => (x.account_id < y.account_id ? -1 : x.account_id > y.account_id ? 1 : x.period_to < y.period_to ? 1 : x.period_to > y.period_to ? -1 : y.seq - x.seq)).forEach((r) => { if (!seen.has(r.account_id)) seen.set(r.account_id, r); });
  return [...seen.values()];
}
const db = (all) => ({ async query(sql, params) { return { rows: runLatest(sql, params, all) }; } });

(async () => {
  schema.hasTable = async () => true;
  await t('A: a clean sign-off with a timing item: statement differs from books, unexplained 0, tied', async () => {
    const out = await LOG.signedAsAt(db([row({ seq: 1 })]), E, '2026-06-30');
    assert.deepStrictEqual(out.accounts[0], { account_id: 'a1', currency: 'AUD', period_to: '2026-06-30', statement_minor: 20336000, books_signed_minor: 20286000, unexplained_minor: 0, apart_minor: 50000, tied: true, made_at: '2026-07-02 09:00:00+00' });
    assert.notStrictEqual(out.accounts[0].statement_minor, out.accounts[0].books_signed_minor, 'statement is NOT books here; the old "difference" word would have been wrong');
  });
  await t('BD-F-03: a sign-off stored as tied over statement 4,049.75 and books 4,749.75 carries the 700.00 they are apart (70000 paise), on the Bank line and on the Trial balance line', async () => {
    const stored = row({ seq: 1, closing_bank_minor: 404975, closing_books_minor: 474975, difference_minor: 0, currency: 'INR' });
    const out = await LOG.signedAsAt(db([stored]), E, '2026-06-30');
    assert.strictEqual(out.accounts[0].apart_minor, 70000);
    assert.strictEqual(out.accounts[0].unexplained_minor, 0);
    const line = LOG.tbBankOf([stored], [stored], '2026-06-30', [{ code: '1500', debit_minor: 474975, credit_minor: 0 }], [{ account_id: 'a1', code: '1500', name: 'Bank', role: 'bank' }], 'INR')[0];
    assert.strictEqual(line.apart_minor, 70000);
  });
  await t('B: a non-zero remainder shows its absolute value, either sign', async () => {
    for (const diff of [50000, -50000]) {
      const out = await LOG.signedAsAt(db([row({ seq: 1, difference_minor: diff })]), E, '2026-06-30');
      assert.strictEqual(out.accounts[0].unexplained_minor, 50000);
      assert.strictEqual(out.accounts[0].tied, false);
    }
  });
  await t('C: two sign-offs where seq order is not period order: June (seq 5) then May re-signed (seq 6) → June', async () => {
    const all = [row({ seq: 5, period_to: '2026-06-30', closing_bank_minor: 111 }), row({ seq: 6, period_to: '2026-05-31', closing_bank_minor: 222 })];
    assert.strictEqual((await LOG.signedAsAt(db(all), E, '2026-06-30')).accounts[0].period_to, '2026-06-30');
    assert.strictEqual((await LOG.signedAsAt(db(all), E, '2026-06-30')).accounts[0].statement_minor, 111);
    assert.strictEqual((await LOG.signedAsAt(db(all), E, '2026-05-31')).accounts[0].period_to, '2026-05-31', 'on or before the period end asked');
    assert.strictEqual((await LOG.signedAsAt(db(all), E, '2026-04-30')).accounts.length, 0, 'nothing signed by then: no row, no line');
    const home = await LOG.unexplained(db(all), E);
    assert.strictEqual(home.to, '2026-06-30', 'the Home reads the same rule: reconciled to 30 June, not backwards to 31 May');
  });
  await t('C2: the same period end signed twice: the later one (seq) wins', async () => {
    const all = [row({ seq: 7, difference_minor: 900 }), row({ seq: 8, difference_minor: 0 })];
    assert.strictEqual((await LOG.signedAsAt(db(all), E, '2026-06-30')).accounts[0].unexplained_minor, 0);
  });
  await t('the day is read by calendar parts (a Date row), the table not migrated reads as nothing signed', async () => {
    assert.strictEqual(LOG.asAtOf([row({ period_to: new Date(2026, 5, 30) })], '2026-06-30').accounts[0].period_to, '2026-06-30');
    schema.hasTable = async () => false;
    assert.deepStrictEqual(await LOG.signedAsAt(db([row({ seq: 1 })]), E, '2026-06-30'), { asOf: '2026-06-30', accounts: [] });
  });
  console.log('bankfix-signed-as-at: ' + pass + ' ok');
})();
