#!/usr/bin/env node
/**
 * tests/retention-archive-gate.test.cjs — NOTHING FLUSHES WITHOUT AN ARCHIVE, AND EVERY ATTEMPT IS AN EVENT (K-DB / DB-21 + PM-16, 21 Oct 2026).
 * lib/retention.js planRetirement({ commit: true }) with no receipt → BLOCKED, 0 deleted, no DELETE/UPDATE sent, one flush event logged.
 * With a sound receipt it stays human-gated (commit-not-wired), still 0 deleted, still logged; an event that cannot be logged blocks it.
 * Offline: db/index.js is stubbed and every statement it is sent is kept.
 * FLOW  stub db (2 copies due of 100) → planRetirement variants → the statements and the answer
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const seen = [];
let eventFails = false;
const dbPath = path.join(ROOT, 'db', 'index.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/count\(\*\)::int AS n FROM chit_status/.test(sql)) return { rows: [{ n: 100 }] };
      if (/retire_at <= now\(\)/.test(sql)) return { rows: [{ chit_id: 'c1', entity_id: 'e1' }, { chit_id: 'c2', entity_id: 'e1' }] };
      if (/ops\.f_retention_flush_event/.test(sql)) {
        if (eventFails) throw Object.assign(new Error('function ops.f_retention_flush_event does not exist'), { code: '42883' });
        return { rows: [{ id: 'flush-' + seen.length }] };
      }
      return { rows: [] };
    },
    withEntity: async () => {
      throw new Error('not used');
    }
  }
};
const retention = require(path.join(ROOT, 'lib', 'retention.js'));
const RECEIPT = { archive_ref: 'archive://test/2026-10-21', sha256: 'a'.repeat(64), rows: 2, at: '2026-10-21T10:00:00Z' };
const writes = () => seen.filter((item) => /\b(DELETE|UPDATE|TRUNCATE)\b/i.test(item.sql));
const events = () => seen.filter((item) => /ops\.f_retention_flush_event/.test(item.sql));

let checks = 0;
async function it(what, fn) {
  seen.length = 0;
  eventFails = false;
  await fn();
  checks++;
  console.log('  ✓ ' + what);
}

(async () => {
  await it('a commit with NO receipt is BLOCKED, deletes 0, sends no write, and logs one BLOCKED event', async () => {
    const out = await retention.planRetirement({ commit: true });
    assert.strictEqual(out.mode, 'BLOCKED');
    assert.strictEqual(out.deleted, 0);
    assert.ok(/no archive receipt/.test(out.reason), out.reason);
    assert.deepStrictEqual(writes(), []);
    assert.strictEqual(events().length, 1);
    assert.strictEqual(events()[0].params[0], 'BLOCKED');
    assert.strictEqual(events()[0].params[2], 2, 'the event counts the candidates');
  });
  await it('a receipt that archived a different count is BLOCKED', async () => {
    const out = await retention.planRetirement({ commit: true, archiveReceipt: Object.assign({}, RECEIPT, { rows: 1 }) });
    assert.strictEqual(out.mode, 'BLOCKED');
    assert.deepStrictEqual(writes(), []);
  });
  await it('a sound receipt is logged and stays human-gated (commit-not-wired, 0 deleted)', async () => {
    const out = await retention.planRetirement({ commit: true, archiveReceipt: RECEIPT });
    assert.strictEqual(out.mode, 'commit-not-wired');
    assert.strictEqual(out.deleted, 0);
    assert.ok(out.flush_id);
    assert.deepStrictEqual(writes(), []);
  });
  await it('no flush without its event: when b772 is missing the commit is BLOCKED', async () => {
    eventFails = true;
    const out = await retention.planRetirement({ commit: true, archiveReceipt: RECEIPT });
    assert.strictEqual(out.mode, 'BLOCKED');
    assert.strictEqual(out.flush_id, null);
  });
  await it('a dry run logs nothing and stays a dry run', async () => {
    const out = await retention.planRetirement();
    assert.strictEqual(out.mode, 'dry-run');
    assert.strictEqual(events().length, 0);
  });
  console.log('\n  ' + checks + ' checks');
})().catch((e) => {
  console.error('  ✗ ' + e.message);
  process.exit(1);
});
