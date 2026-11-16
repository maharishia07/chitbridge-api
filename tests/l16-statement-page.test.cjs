'use strict';
/** tests/l16-statement-page.test.cjs — the PAGED statements box (l16, W15-100): a page of files, newest first, a keyset cursor, a search, the counts; never the whole box. Pure node: a stub db that records every statement. */
const assert = require('assert');
const BSP = require('../lib/bank-statement-page');
const schema = require('../lib/schema');
let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  XX  ' + name + '\n' + (err && err.stack));
    process.exit(1);
  }
};
const E = '11111111-1111-4111-8111-111111111111';
const A1 = { account_id: '22222222-2222-4222-8222-222222222222', code: '1500', name: 'Everyday account' };
const row = (n, to) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), account_id: A1.account_id, label: null, period_from: to.slice(0, 8) + '01', period_to: to, currency: 'AUD', name: 'f' + n + '.csv', size: 5, mime: 'text/csv', kind: 'bank_statement', source: 'owner', overlaps: false, by_name: 'M', by_firm: null, grant_id: null, created_at: 'x', seq: String(n) });
const PAGE = /ORDER BY period_to DESC/;
function stub(pageRows) {
  const log = [];
  return {
    log,
    async query(sql, values) {
      log.push({ sql, values });
      if (/GROUP BY account_id/.test(sql)) return { rows: [{ account_id: A1.account_id, label: '..77' }] };
      if (/^SELECT id, account_id, name, period_from::text/.test(sql)) return { rows: pageRows.map((r) => ({ id: r.id, account_id: r.account_id, name: r.name, period_from: r.period_from, period_to: r.period_to, overlaps: r.overlaps })) };
      if (/NOT \(period_from/.test(sql)) return { rows: [{ n: '7' }] };
      if (/^SELECT count\(\*\) AS n/.test(sql)) return { rows: [{ n: String(pageRows.length) }] };
      if (PAGE.test(sql)) return { rows: pageRows.slice(0, Number(/LIMIT (\d+)/.exec(sql)[1])) };
      return { rows: [] };
    }
  };
}
(async () => {
  schema.hasTable = async () => true;
  const months = ['2026-10', '2026-11'];
  await t('limit: a whole number 1 to 100, else a sentence (400)', () => {
    for (const bad of ['0', '101', 'x', '2.5', '']) assert.throws(() => BSP.limitOf(bad), (err) => err.code === 'LIMIT_INVALID' && err.status === 400, bad);
    assert.strictEqual(BSP.limitOf('25'), 25);
  });
  await t('cursor: round-trips, and a made-up one is a sentence (400)', () => {
    const c = BSP.cursorOf({ period_to: '2026-11-20', seq: '9' });
    assert.deepStrictEqual(BSP.unCursor(c), { to: '2026-11-20', seq: '9' });
    assert.throws(() => BSP.unCursor('zzz'), (err) => err.code === 'CURSOR_INVALID' && err.status === 400);
  });
  await t('a page: size files, newest first, next set when more exist, total and older counted', async () => {
    const rows = [row(3, '2026-11-20'), row(2, '2026-11-10'), row(1, '2026-10-31')];
    const db = stub(rows);
    const out = await BSP.list(db, E, { accounts: [A1], chart: [], months, limit: '2' });
    assert.strictEqual(out.files.length, 2);
    assert.strictEqual(out.files[0].id, rows[0].id);
    assert.deepStrictEqual(BSP.unCursor(out.next), { to: '2026-11-10', seq: '2' });
    assert.strictEqual(out.total, 3);
    assert.strictEqual(out.older, 7);
    assert.strictEqual(out.accounts[0].label, '..77');
    const nov = out.cells.find((cell) => cell.month === '2026-11');
    assert.deepStrictEqual([nov.newest_id, nov.newest_name, nov.newest_to], [rows[0].id, 'f3.csv', '2026-11-20'], 'the cell names its newest file, to open it without reading the list');
    assert.ok(out.cells.every((cell) => 'overlaps' in cell && 'newest_id' in cell && 'newest_name' in cell && 'newest_to' in cell));
    assert.ok(db.log.some((q) => /ORDER BY period_to DESC, seq DESC LIMIT 3/.test(q.sql)), 'asks for size + 1 to know whether more exist');
    assert.ok(db.log.every((q) => /period_from <=|GROUP BY/.test(q.sql) || /file_id = ANY/.test(q.sql)), 'every statement is the window, a group or the page events: none reads the whole box');
  });
  await t('the last page has no next', async () => {
    const out = await BSP.list(stub([row(1, '2026-10-31')]), E, { accounts: [A1], chart: [], months, limit: '25' });
    assert.strictEqual(out.next, null);
  });
  await t('after: a keyset on (period_to, seq), values bound, never spliced', async () => {
    const db = stub([row(1, '2026-10-31')]);
    await BSP.list(db, E, { accounts: [A1], chart: [], months, limit: '25', after: BSP.cursorOf({ period_to: '2026-11-10', seq: '2' }) });
    const q = db.log.find((x) => PAGE.test(x.sql));
    assert.ok(/\(period_to, seq\) < \(\$\d+::date, \$\d+::bigint\)/.test(q.sql));
    assert.ok(q.values.includes('2026-11-10') && q.values.includes('2'));
  });
  await t('search: name (wildcards plain), account name, a month as a name and as 2026-10; a long one is refused', async () => {
    const find = (db) => db.log.find((x) => PAGE.test(x.sql));
    const db1 = stub([]);
    await BSP.list(db1, E, { accounts: [A1], chart: [], months, limit: '25', q: '50%_' });
    assert.ok(find(db1).values.includes('%50\\%\\_%'));
    const db2 = stub([]);
    await BSP.list(db2, E, { accounts: [A1], chart: [], months, limit: '25', q: 'everyday' });
    assert.ok(/account_id = ANY/.test(find(db2).sql));
    const db3 = stub([]);
    await BSP.list(db3, E, { accounts: [A1], chart: [], months, limit: '25', q: 'Oct' });
    assert.ok(/EXTRACT\(MONTH FROM period_from\)/.test(find(db3).sql) && find(db3).values.includes(10));
    const db4 = stub([]);
    await BSP.list(db4, E, { accounts: [A1], chart: [], months, limit: '25', q: '2026-10' });
    assert.ok(/\(period_from <= \$\d+::date AND period_to >= \$\d+::date\)/.test(find(db4).sql));
    await assert.rejects(() => BSP.list(stub([]), E, { accounts: [A1], chart: [], months, limit: '25', q: 'x'.repeat(61) }), (err) => err.code === 'SEARCH_TOO_LONG' && err.status === 400);
  });
  await t('not migrated: BOOKS_NOT_MIGRATED 503, as the unpaged list', async () => {
    schema.hasTable = async () => false;
    await assert.rejects(() => BSP.list(stub([]), E, { accounts: [A1], chart: [], months, limit: '25' }), (err) => err.code === 'BOOKS_NOT_MIGRATED' && err.status === 503);
    schema.hasTable = async () => true;
  });
  console.log('\n' + pass + ' passed');
})();
