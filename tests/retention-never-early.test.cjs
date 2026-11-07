#!/usr/bin/env node
// @type: unit
/**
 * tests/retention-never-early.test.cjs — RETENTION NEVER RETIRES OWNED DATA EARLY (lib/retention.js).
 * CARD      27-data-lifecycle-retention-storage-archive/retention-rules-and-floor
 * UNIT      27/Retention rules & floor
 * OWNS      the rules that make a retention job safe BEFORE any deletion is wired: an open dispute never retires (null) · a resolved dispute is a FLOOR
 *           (max of the plain end and resolved + grace), never a restarted clock · an extension is bounded and refuses 0, negatives, words and the over-cap ·
 *           one copy's days = max(records-law floor, the owner's floor, the sender's ask) with the winning rule named, a sender can never SHORTEN a receiver's copy ·
 *           a receipt that does not match the candidates is refused in words · the sweep query excludes legal holds, open disputes and anything younger than
 *           the records floor, and a dry run sends no write.
 * CALLED BY scripts/guards.cjs · CI. No database: db/index.js is stubbed and every statement kept.
 * FLOW      pure functions → asserted; planRetirement over a stub db → the SQL and its parameters asserted
 * CARD      27-data-lifecycle-retention-storage-archive/retention-rules-and-floor
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const seen = [];
const dbPath = path.join(ROOT, 'db', 'index.js');
const dueRows = { n: 1 };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    seen.push({ sql, params });
    if (/count\(\*\)::int AS n FROM chit_status/.test(sql)) return { rows: [{ n: 100 }] };
    if (/retire_at <= now\(\)/.test(sql)) return { rows: Array.from({ length: dueRows.n }, (_, i) => ({ chit_id: 'c' + i, entity_id: 'e1' })) };
    if (/ops\.f_retention_flush_event/.test(sql)) return { rows: [{ id: 'flush-1' }] };
    return { rows: [] };
  },
  withEntity: async () => { throw new Error('not used'); }
} };
const retention = require(path.join(ROOT, 'lib', 'retention.js'));
const policy = require(path.join(ROOT, 'lib', 'policy.js'));
const DAY = 86400000;

let checks = 0;
async function it(what, fn) { seen.length = 0; dueRows.n = 1; await fn(); checks++; console.log('  ok  ' + what); }
const throwsStatus = (fn, status, re) => {
  try { fn(); } catch (e) { assert.strictEqual(e.status, status); if (re) assert.ok(re.test(e.message), e.message); return; }
  assert.fail('did not refuse');
};

(async () => {
  const END = new Date('2035-01-01T00:00:00Z');

  await it('no dispute: retire_at is the plain retention end', async () => {
    assert.strictEqual(retention.computeRetireAt(END, false, null, 30).getTime(), END.getTime());
    assert.strictEqual(retention.computeRetireAt('2035-01-01T00:00:00Z', false, null).getTime(), END.getTime(), 'a string end is read the same');
  });

  await it('an OPEN dispute never retires: null whatever the dates say', async () => {
    assert.strictEqual(retention.computeRetireAt(new Date('2001-01-01'), true, null, 30), null);
    assert.strictEqual(retention.computeRetireAt(END, true, '2020-01-01', 0), null);
  });

  await it('a resolved dispute is a FLOOR: a late dispute adds only the grace, never another full period', async () => {
    const resolved = new Date(END.getTime() + 10 * DAY);
    const r = retention.computeRetireAt(END, false, resolved, 30);
    assert.strictEqual(r.getTime(), resolved.getTime() + 30 * DAY);
    assert.ok(r.getTime() - END.getTime() < 60 * DAY, 'the clock restarted a full period');
  });

  await it('a dispute resolved long BEFORE the end cannot pull retirement earlier than the plain end (MAX, not MIN)', async () => {
    const r = retention.computeRetireAt(END, false, new Date('2020-01-01'), 30);
    assert.strictEqual(r.getTime(), END.getTime());
  });

  await it('property: over 200 dispute dates the answer is never earlier than the end and never earlier than resolved + grace', async () => {
    for (let i = 0; i < 200; i++) {
      const resolved = new Date(END.getTime() + (i - 100) * 7 * DAY);
      const grace = i % 90;
      const r = retention.computeRetireAt(END, false, resolved, grace);
      assert.ok(r.getTime() >= END.getTime(), 'earlier than the end at i=' + i);
      assert.ok(r.getTime() >= resolved.getTime() + grace * DAY, 'earlier than resolved+grace at i=' + i);
    }
  });

  await it('an extension is bounded: whole positive days up to the cap; 0, negative, words, null and over the cap are refused 400', async () => {
    assert.strictEqual(retention.boundedExtension(30), 30);
    assert.strictEqual(retention.boundedExtension('45'), 45);
    assert.strictEqual(retention.boundedExtension(retention.MAX_EXTEND_DAYS), retention.MAX_EXTEND_DAYS);
    throwsStatus(() => retention.boundedExtension(0), 400, /positive/);
    throwsStatus(() => retention.boundedExtension(-5), 400);
    throwsStatus(() => retention.boundedExtension('forever'), 400);
    throwsStatus(() => retention.boundedExtension(null), 400);
    throwsStatus(() => retention.boundedExtension(retention.MAX_EXTEND_DAYS + 1), 400, /capped/);
    throwsStatus(() => retention.boundedExtension(1e9), 400, /no unbounded/);
  });

  await it('one copy keeps max(records-law floor, own floor, sender ask): a sender cannot shorten it, and the winner is named', async () => {
    const law = policy.RECORDS_FLOOR_DAYS;
    assert.strictEqual(retention.copyRetention(0, 1).days, law);
    assert.strictEqual(retention.copyRetention(0, 1).source, 'records_law');
    assert.strictEqual(retention.copyRetention(law + 100, 1).days, law + 100);
    assert.strictEqual(retention.copyRetention(law + 100, 1).source, 'own_floor');
    assert.strictEqual(retention.copyRetention(0, law + 500).days, law + 500);
    assert.strictEqual(retention.copyRetention(0, law + 500).source, 'sender_asked');
    assert.strictEqual(retention.copyRetention(law, law).source, 'records_law', 'a tie names the law first');
  });

  await it('property: no (floor, ask) pair ever yields fewer days than the nine-year law', async () => {
    const law = policy.RECORDS_FLOOR_DAYS;
    assert.ok(law >= 9 * 365, 'the floor is under nine years');
    for (const floor of [0, 1, 30, 90, 365, law - 1, law, law + 1]) {
      for (const ask of [undefined, 0, 1, 30, law - 1, law + 1, 100000]) {
        assert.ok(retention.copyRetention(floor, ask).days >= law, 'floor ' + floor + ' ask ' + ask);
      }
    }
  });

  await it('stamp: before b771 nothing is added to the INSERT; after, the source rides as $5', async () => {
    const plain = retention.copyRetention(0, 0, false);
    assert.deepStrictEqual([plain.col, plain.val, plain.params], ['', '', []]);
    const stamped = retention.copyRetention(0, 0, true);
    assert.deepStrictEqual([stamped.col, stamped.val, stamped.params], [', retention_source', ', $5', ['records_law']]);
  });

  await it('a flush receipt must say where, carry a sha256, count exactly the due copies and carry a time — each gap is named', async () => {
    const good = { archive_ref: 'archive://x', sha256: 'f'.repeat(64), rows: 3, at: '2026-11-06T00:00:00Z' };
    assert.strictEqual(retention.receiptProblem(good, 3), null);
    assert.ok(/no archive receipt/.test(retention.receiptProblem(null, 3)));
    assert.ok(/no archive receipt/.test(retention.receiptProblem('yes', 3)));
    assert.ok(/archive_ref/.test(retention.receiptProblem({ ...good, archive_ref: '' }, 3)));
    assert.ok(/sha256/.test(retention.receiptProblem({ ...good, sha256: 'abc' }, 3)));
    assert.ok(/sha256/.test(retention.receiptProblem({ ...good, sha256: 'F'.repeat(64) }, 3)), 'upper-case hex is not what the archive writes');
    assert.ok(/archived 2 copies and 3 are due/.test(retention.receiptProblem({ ...good, rows: 2 }, 3)));
    assert.ok(/archived 4 copies and 3 are due/.test(retention.receiptProblem({ ...good, rows: 4 }, 3)), 'more archived than due is also a mismatch');
    assert.ok(/no time/.test(retention.receiptProblem({ ...good, at: 'yesterday-ish' }, 3)));
  });

  await it('the sweep asks only for copies that are not held, not under an open dispute, and older than the records floor', async () => {
    const plan = await retention.planRetirement();
    assert.strictEqual(plan.mode, 'dry-run');
    const q = seen.find((s) => /retire_at <= now\(\)/.test(s.sql));
    assert.ok(/legal_hold,false\) = false/.test(q.sql), 'a legal hold is not excluded');
    assert.ok(/NOT EXISTS \(SELECT 1 FROM chit_disputes/.test(q.sql) && /d\.status = 'open'/.test(q.sql), 'an open dispute is not excluded');
    assert.ok(/make_interval\(years => \$1::int\)/.test(q.sql));
    assert.deepStrictEqual(q.params, [retention.RECORDS_FLOOR_YEARS]);
    assert.strictEqual(retention.RECORDS_FLOOR_YEARS, 9);
  });

  await it('a dry run and a commit with no receipt send no DELETE, UPDATE or TRUNCATE, and delete nothing', async () => {
    await retention.planRetirement();
    const r = await retention.planRetirement({ commit: true });
    assert.strictEqual(r.mode, 'BLOCKED');
    assert.strictEqual(r.deleted, 0);
    assert.strictEqual(seen.filter((s) => /\b(DELETE|UPDATE|TRUNCATE)\b/i.test(s.sql)).length, 0);
  });

  await it('a runaway sweep (30 of 100 due) is refused by the guardrail even with a sound receipt: BLOCKED, 0 deleted', async () => {
    dueRows.n = 30;
    const receipt = { archive_ref: 'a://b', sha256: 'a'.repeat(64), rows: 30, at: '2026-11-06T00:00:00Z' };
    const r = await retention.planRetirement({ commit: true, archiveReceipt: receipt });
    assert.strictEqual(r.mode, 'BLOCKED');
    assert.strictEqual(r.deleted, 0);
    assert.ok(r.guardrail.blocked && r.guardrail.pct === 30);
  });

  console.log('\n  ' + checks + ' checks');
  console.log('  ' + checks + ' passed');
})().catch((e) => { console.log('  FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); process.exit(1); });
