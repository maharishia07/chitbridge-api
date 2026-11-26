'use strict';
/** tests/home-bank-signed-to.test.cjs — RW1-rep: the Home Bank card reads the SAME sign-off as the Bank page ("Signed off to" = LATEST_SQL's unbroken run), not the newest by seq.
 *  Hand-computed: account a1 signed May (seq 1), June (seq 2), then October (seq 9, after an unsigned Jul-Sep hole). The unbroken run ends 30 June, so LATEST_SQL returns the June row (seq 2);
 *  the old read took the newest by seq = October (31 Oct). Two accounts: a1 run ends 30 June (seq 2), a2 run ends 31 Aug (seq 4, made earlier than seq 9) -> the card names 31 Aug (the latest run end). */
const assert = require('assert');
const schema = require('../lib/schema');
const LOG = require('../lib/bank-rec-log');
const E = '11111111-1111-4111-8111-111111111111';
const stored = { 2: { seq: 2, account_id: 'a1', period_to: '2026-06-30', difference_minor: 100, currency: 'AUD', made_by: 'u', made_at: '2026-07-02' }, 4: { seq: 4, account_id: 'a2', period_to: '2026-08-31', difference_minor: 0, currency: 'AUD', made_by: 'u', made_at: '2026-09-02' }, 9: { seq: 9, account_id: 'a1', period_to: '2026-10-31', difference_minor: 999, currency: 'AUD', made_by: 'u', made_at: '2026-11-02' } };
let sawRunSql = false;
const db = (runs) => ({ async query(sql, params) {
  if (/DISTINCT ON \(c\.account_id\)/.test(sql)) { sawRunSql = true; return { rows: runs }; }
  if (/FROM bank_rec_log WHERE entity_id = \$1 AND kind = 'statement' AND seq = \$2/.test(sql)) return { rows: [stored[params[1]]].filter(Boolean) };
  return { rows: [] };
} });
(async () => {
  schema.hasTable = async () => true; schema.hasColumn = async () => false;
  const one = await LOG.latest(db([{ account_id: 'a1', seq: 2, period_to: '2026-06-30' }]), E);
  assert.ok(sawRunSql, 'reads LATEST_SQL');
  assert.strictEqual(one.period_to, '2026-06-30'); assert.strictEqual(one.difference_minor, 100);
  const two = await LOG.latest(db([{ account_id: 'a1', seq: 2, period_to: '2026-06-30' }, { account_id: 'a2', seq: 4, period_to: '2026-08-31' }]), E);
  assert.strictEqual(two.period_to, '2026-08-31'); assert.strictEqual(two.difference_minor, 0);
  assert.strictEqual(await LOG.latest(db([]), E), null);
  console.log('home-bank-signed-to: 3 ok');
  console.log('  6 checks'); /* the guards runner counts "<n> checks" (a guard that counts nothing proved nothing; zeroreds 26 Nov: seven guards ended without it and read FAIL in the full run) */
})().catch((err) => { console.error(err); process.exit(1); });
