'use strict';
/** tests/bank-as-at.test.cjs — RANK 9: the bank line of the trial balance (lib/bank-rec-log tbBankOf / onTrialBalance), hostile fixtures H1 to H9 of the critic.
 *  Hand-computed: statement 203,360.00 vs books 202,860.00 with one unpresented cheque 500.00 → remainder 0 (203,360.00 - (202,860.00 + 500.00)); a stored -50,000 reads A$500.00; an A$100.00 receipt after sign-off → moved 10,000. */
const assert = require('assert');
const schema = require('../lib/schema');
const LOG = require('../lib/bank-rec-log');
const DD = require('../lib/dues-view');
let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (err) { console.error('  XX  ' + name + '\n' + (err && err.stack)); process.exit(1); } };
const E = '11111111-1111-4111-8111-111111111111';
const AS = '2026-06-30';
const chart = [{ account_id: 'a1', code: '1500', name: 'Bank', role: 'bank' }, { account_id: 'a2', code: '1510', name: 'USD bank', role: 'bank' }, { account_id: 'g', code: '1000', name: 'Assets', is_group: true }, { account_id: 'x', code: '4000', name: 'Sales', role: 'sales' }];
const row = (extra) => Object.assign({ account_id: 'a1', period_to: AS, difference_minor: 0, closing_bank_minor: 20336000, closing_books_minor: 20286000, made_at: '2026-07-02 09:00:00+00', currency: 'AUD' }, extra);
const tb = (dr, cr, code) => [{ code: code || '1500', debit_minor: dr, credit_minor: cr }];
const of = (at, any, rows, ch) => LOG.tbBankOf(at, any || at, AS, rows || tb(20286000, 0), ch || chart.slice(0, 1), 'AUD');

/** a stand-in for the SQL (its own WHERE and ORDER BY words) */
function runLatest(sql, params, all) {
  assert.ok(/ORDER BY c.account_id, c.period_to DESC, c.seq DESC/.test(sql));
  const asOf = /period_to <= \$2::date/.test(sql) ? params[1] : null;
  const seen = new Map();
  all.filter((r) => !asOf || r.period_to <= asOf).sort((x, y) => (x.account_id < y.account_id ? -1 : x.period_to < y.period_to ? 1 : x.period_to > y.period_to ? -1 : y.seq - x.seq)).forEach((r) => { if (!seen.has(r.account_id)) seen.set(r.account_id, r); });
  return [...seen.values()];
}
const db = (all) => ({ async query(sql, params) { return { rows: runLatest(sql, params, all) }; } });

(async () => {
  schema.hasTable = async () => true;
  await t('H1: June signed, then May re-signed: the line says 30 June (the one rule, through the SQL)', async () => {
    const out = await LOG.onTrialBalance(db([row({ seq: 5, period_to: '2026-06-30', closing_bank_minor: 111 }), row({ seq: 6, period_to: '2026-05-31', closing_bank_minor: 222 })]), E, AS, tb(20286000, 0), chart.slice(0, 1), 'AUD');
    assert.strictEqual(out[0].period_to, '2026-06-30'); assert.strictEqual(out[0].statement_minor, 111);
  });
  await t('P9.1 reconciled with a timing item: statement differs from books, unexplained 0, books not moved', () => {
    const l = of([row()])[0];
    assert.deepStrictEqual([l.state, l.statement_minor, l.books_signed_minor, l.unexplained_minor, l.books_now_minor, l.moved_minor, l.code], ['reconciled', 20336000, 20286000, 0, 20286000, 0, '1500']);
  });
  await t('P9.2 / H6: unexplained, stored -50,000 and +50,000 both 50,000', () => {
    for (const d of [-50000, 50000]) { const l = of([row({ difference_minor: d })])[0]; assert.deepStrictEqual([l.state, l.unexplained_minor], ['unexplained', 50000]); }
  });
  await t('P9.3 earlier: the date and the statement as signed, no difference, no moved', () => {
    const l = of([row({ period_to: '2026-05-31' })])[0];
    assert.deepStrictEqual([l.state, l.period_to, l.statement_minor, l.unexplained_minor, l.books_signed_minor, l.moved_minor], ['earlier', '2026-05-31', 20336000, null, null, null]);
  });
  await t('P9.4 never, P9.4b none by this date (H7: only a later sign-off exists)', () => {
    assert.strictEqual(of([], [])[0].state, 'never');
    assert.strictEqual(of([], [row({ period_to: '2026-09-30' })])[0].state, 'none_by_date');
  });
  await t('H2: two bank accounts, one signed, one never: one line each; a group and a non-bank are no line', () => {
    const l = of([row()], [row()], tb(20286000, 0), chart);
    assert.deepStrictEqual(l.map((x) => [x.code, x.state]), [['1500', 'reconciled'], ['1510', 'never']]);
  });
  await t('H3: AUD and USD accounts are never added or compared: the USD line has no books figure or moved', () => {
    const l = of([row(), row({ account_id: 'a2', currency: 'USD', closing_bank_minor: 5000, closing_books_minor: 5000 })], null, [...tb(20286000, 0), ...tb(5000, 0, '1510')], chart);
    assert.deepStrictEqual([l[1].currency, l[1].state, l[1].books_now_minor, l[1].moved_minor], ['USD', 'reconciled', null, null]);
    assert.strictEqual(l[0].currency, 'AUD');
  });
  await t('H4: an overdraft (credit balance) signed as -150,000 and still -150,000 now: moved 0', () => {
    const l = of([row({ closing_books_minor: -150000, closing_bank_minor: -150000 })], null, tb(0, 150000))[0];
    assert.deepStrictEqual([l.books_now_minor, l.moved_minor, l.state], [-150000, 0, 'reconciled']);
  });
  await t('P9.9: an A$100.00 receipt after the sign-off: books now differ from the figure signed by 10,000', () => {
    const l = of([row()], null, tb(20296000, 0))[0];
    assert.deepStrictEqual([l.books_now_minor, l.moved_minor, l.state], [20296000, 10000, 'reconciled']);
  });
  await t('an account missing from the trial balance: no moved claim', () => {
    assert.strictEqual(of([row()], null, [])[0].moved_minor, null);
  });
  await t('H8: a cost-blind grant gets the state not_shared and no figure', () => {
    const answer = { currency: 'AUD', asOf: AS, rows: [], total_dr_minor: 1, total_cr_minor: 1, balanced: true, bank: of([row()]) };
    const blind = DD.blindBooks('trial_balance', answer);
    assert.strictEqual(blind.cost_hidden, true);
    const b0 = blind.bank[0];
    assert.strictEqual(b0.state, 'not_shared');
    assert.deepStrictEqual([b0.statement_minor, b0.books_signed_minor, b0.unexplained_minor, b0.books_now_minor, b0.moved_minor, b0.period_to, b0.signed_at], [null, null, null, null, null, null, null]);
    assert.deepStrictEqual(Object.keys(b0).sort(), Object.keys(of([row()])[0]).sort(), 'the shape stays');
    assert.strictEqual(DD.blindBooks('trial_balance', { rows: [], balanced: true }).bank, undefined);
  });
  await t('H9: table not migrated: no block (null), no throw', async () => {
    schema.hasTable = async () => false;
    assert.strictEqual(await LOG.onTrialBalance(db([row({ seq: 1 })]), E, AS, [], chart, 'AUD'), null);
  });
  console.log('bank-as-at: ' + pass + ' ok');
})();
