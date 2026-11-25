'use strict';
/** tests/l16-fable3-unexplained.test.cjs — the ONE "unexplained" rule (l16 fable3): the practice list and the Bank home read the same newest-sign-off-per-account rule, in each row's own currency, never added across two. Pure node. */
const assert = require('assert');
const schema = require('../lib/schema');
const LOG = require('../lib/bank-rec-log');
const P = require('../lib/books-practice');
let pass = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + name); } catch (err) { console.error('  XX  ' + name + '\n' + (err && err.stack)); process.exit(1); }
};
const E = '11111111-1111-4111-8111-111111111111';
const row = (acct, to, diff, cur) => ({ account_id: acct, period_to: to, difference_minor: diff, currency: cur });
const stub = (rows) => ({ async query(sql, values) { stub.sql = sql; stub.values = values; return { rows }; } });
(async () => {
  schema.hasTable = async () => true;
  await t('one currency: the accounts add, the earliest end is the date (Moonee: A$354.32)', async () => {
    const out = await LOG.unexplained(stub([row('a1', '2026-10-31', '-35432', 'AUD'), row('a2', '2026-09-30', 0, 'AUD')]), E);
    assert.deepStrictEqual([out.currency, out.unexplained_minor, out.to], ['AUD', 35432, '2026-09-30']);
    assert.deepStrictEqual(out.by_currency, [{ currency: 'AUD', unexplained_minor: 35432, to: '2026-09-30' }]);
    assert.strictEqual(out.accounts[0].unexplained_minor, 35432);
    assert.ok(/DISTINCT ON \(c\.account_id\)/.test(stub.sql) && /kind = 'statement'/.test(stub.sql), 'the newest sign-off per account');
  });
  await t('R4-1: a pg DATE column arrives as a Date; the day is its calendar day, never "Sat Oct 31" (fixture typed like the driver row)', async () => {
    const out = await LOG.unexplained(stub([row('a1', new Date(2026, 9, 31), 35432, 'AUD')]), E);
    assert.strictEqual(out.to, '2026-10-31');
    assert.ok(/period_to::text AS period_to/.test(stub.sql), 'the read casts the day to text');
  });
  await t('two currencies: one line each, never one figure', async () => {
    const out = await LOG.unexplained(stub([row('a1', '2026-10-31', 35432, 'AUD'), row('a2', '2026-10-31', -10000, 'USD')]), E);
    assert.strictEqual(out.unexplained_minor, null);
    assert.strictEqual(out.currency, null);
    assert.deepStrictEqual(out.by_currency.map((l) => [l.currency, l.unexplained_minor]).sort(), [['AUD', 35432], ['USD', 10000]]);
  });
  await t('a signed month with no file kept still carries its figure (Westgate: A$832.01)', async () => {
    const out = await LOG.unexplained(stub([row('a1', '2026-10-31', 83201, 'AUD')]), E); /* the sign-off rows do not depend on the files box */
    assert.deepStrictEqual([out.currency, out.unexplained_minor, out.to, out.count], ['AUD', 83201, '2026-10-31', 1]);
  });
  await t('the table not migrated reads as nothing signed, never an error', async () => {
    schema.hasTable = async () => false;
    const out = await LOG.unexplained(stub([row('a1', '2026-10-31', 5, 'AUD')]), E);
    assert.deepStrictEqual([out.count, out.by_currency.length], [0, 0]);
    schema.hasTable = async () => true;
  });
  await t('the practice row reads the SAME rule: one currency agrees with the Bank home, two never add', async () => {
    const rows = [row('a1', '2026-10-31', 83201, 'AUD')];
    const bank = P.bankOf ? P.bankOf({ accounts: 1, rows }) : null;
    assert.ok(bank, 'books-practice exports bankOf');
    const home = await LOG.unexplained(stub(rows), E);
    assert.deepStrictEqual([bank.state, bank.unexplained_minor, bank.currency, bank.reconciled_to], ['unexplained', home.unexplained_minor, home.currency, home.to]);
    const mixed = P.bankOf({ accounts: 2, rows: [row('a1', '2026-10-31', 100, 'AUD'), row('a2', '2026-10-31', 100, 'USD')] });
    assert.strictEqual(mixed.unexplained_minor, null);
    assert.strictEqual(mixed.by_currency.length, 2);
    assert.strictEqual(P.bankOf({ accounts: 1, rows: [row('a1', '2026-10-31', 0, 'AUD')] }).state, 'reconciled');
    assert.strictEqual(P.bankOf({ accounts: 0 }).state, 'none');
  });
  await t('the practice statement carries the shared newest-per-account text', () => {
    assert.ok(P.statement(['cash'], true).includes(LOG.LATEST_SQL('$1::uuid')));
  });
  console.log(pass + ' passed');
})();
