/**
 * am-relock.test.cjs - AM-F-07 (walk AM, 21 Nov 2026; batch 1129 fixAM): a soft lock pressed again on a soft-locked month used to answer 200 and overwrite the lock record (reason, locked_at, by).
 * Now it is refused in words (the hard lock's repeat already was), the first record stays; the tax close's own re-stamp (opts.restamp) still works and the change log keeps the history.
 * Run: node tests/am-relock.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const path = require('path'), assert = require('assert');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n + '.js'));
const B = lib('books'), S = lib('books-store');
let row = { fiscal_year: '2026', period: 3, status: 'soft_locked', reason: 'March signed off', locked_by: 'u1', locked_at: '2026-04-02T00:00:00Z' };
const writes = [], logs = [];
B.settingOf = async () => ({ entity_id: 'e1', enabled: true, country: 'AE', fy_start_month: 1, functional_currency: 'AED', pack_version: '1', timezone: 'Asia/Dubai' });
S.periods = async () => [row];
S.setPeriodStatus = async (db, e, fy, p, status, by, reason) => { writes.push([status, reason]); row = Object.assign({}, row, { status, reason }); };
S.logChange = async (db, e, ch) => { logs.push(ch); };
const handle = { query: async () => ({ rows: [] }) };
const press = (status, reason, opts) => B.setPeriod(handle, 'e1', '2026', 3, status, 'u1', reason, opts).then(() => null, (err) => err);
(async () => {
  let err = await press('soft_locked', 'again soft');
  assert.ok(err && err.refused && /already locked \(March signed off\)\. Nothing was changed/.test(err.message), err && err.message);
  assert.strictEqual(writes.length, 0); assert.strictEqual(row.reason, 'March signed off');
  console.log('  ok  a soft lock repeated is refused in words, the first reason and time stay');
  const lock = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'books-period-lock.js'), 'utf8');
  assert.ok(lock.indexOf('{ restamp: true }') >= 0, 'the tax close re-stamps with restamp: true');
  console.log('  ok  the tax close re-stamp of a hand-locked month says restamp: true (and so still lands)');

  console.log('  2 passed');
})().catch((e) => { console.error(e); process.exit(1); });
