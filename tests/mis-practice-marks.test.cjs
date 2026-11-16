#!/usr/bin/env node
// @type: unit
/**
 * tests/mis-practice-marks.test.cjs — MIS 0b + 0c (l17): the practice row's "queries open" and "entries checked" equal what the client's own page shows (review-mark.openList / coverage), for the same books.
 * The page reads openList (total_open, checked, of); the practice reads openCount + coverage per client under that client's binding (books-practice.withMarks). Two carried answers are compared, nothing is computed twice.
 * Fixture: 4 entries in the quarter; one checked and unchanged (counts), one checked and then ALTERED by a reversing entry (does not count), one query still reading, one hold still reading, one query on an entry that no longer reads (not counted, not listed).
 * OWNS the offline check of the practice marks rule.   CALLED BY scripts/guards.cjs.   CARD capability/MARK-AND-QUERY-CAPABILITY
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const lib = (name) => path.join(__dirname, '..', 'lib', name);
const canon = require(lib('canon.js'));
const E = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TODAY = '2026-11-16', QS = '2026-10-01';
const unchanged = canon.seal(['successor_id'], { successor_id: null });
/* the entries as they are NOW: e2 has a reversing (successor) entry, e5 is gone */
const ENTRIES = { e1: { no: 'J1', date: '2026-10-05' }, e2: { no: 'J2', date: '2026-10-06', succ: 'e9' }, e3: { no: 'J3', date: '2026-10-07' }, e4: { no: 'J4', date: '2026-10-08' } };
const MARKS = [ /* the latest row per entry */
  { mark_id: 1, subject_id: 'e1', class: 'clear', kind: 'checked', thread_id: 't1', seal: unchanged, at: '2026-10-20T00:00:00Z' },
  { mark_id: 2, subject_id: 'e2', class: 'clear', kind: 'checked', thread_id: 't2', seal: unchanged, at: '2026-10-20T00:00:00Z' },
  { mark_id: 3, subject_id: 'e3', class: 'open', kind: 'query', thread_id: 't3', seal: unchanged, at: '2026-10-21T00:00:00Z', open_since: '2026-10-21T00:00:00Z' },
  { mark_id: 4, subject_id: 'e4', class: 'hold', kind: 'on_hold', thread_id: 't4', seal: unchanged, at: '2026-10-22T00:00:00Z', open_since: '2026-10-22T00:00:00Z' },
  { mark_id: 5, subject_id: 'e5', class: 'open', kind: 'query', thread_id: 't5', seal: unchanged, at: '2026-10-23T00:00:00Z', open_since: '2026-10-23T00:00:00Z' }
].map((m) => Object.assign({ entity_id: E, adopter: 'acc.audit', note: null, by_name: 'A', by_entity_id: E, message_count: 0 }, m));
/** an in-memory books: answers exactly the statements review-mark and the practice's marks read send */
const fake = {
  async query(sql, values) {
    if (/FROM \(SELECT DISTINCT ON \(subject_id\) subject_id, class, thread_id FROM review_mark/.test(sql)) return { rows: MARKS.filter((m) => ['open', 'hold'].includes(m.class)) };
    if (/SELECT DISTINCT ON \(subject_id\) subject_id FROM review_mark/.test(sql)) return { rows: MARKS.map((m) => ({ subject_id: m.subject_id })) };
    if (/SELECT l\.\*/.test(sql)) return { rows: MARKS.filter((m) => values[2].includes(m.subject_id)) };
    if (/FROM journal_entry s/.test(sql)) return { rows: Object.entries(ENTRIES).filter(([id]) => values[1].includes(id)).map(([id, e]) => ({ id, label: e.no, date: e.date, succ_id: e.succ || null, succ_no: e.succ ? 'R1' : null, succ_at: null, succ_who: null })) };
    if (/count\(\*\)::int AS n FROM journal_entry/.test(sql)) return { rows: [{ n: Object.keys(ENTRIES).length }] };
    if (/l\.subject_id, l\.seal/.test(sql)) return { rows: MARKS.filter((m) => m.class === 'clear' && ENTRIES[m.subject_id]).map((m) => ({ subject_id: m.subject_id, seal: m.seal })) };
    if (/FROM chit_messages/.test(sql)) return { rows: [{ n: 1 }] };
    throw new Error('unexpected SQL in the test books: ' + sql.slice(0, 80));
  }
};
const db = require(path.join(__dirname, '..', 'db'));
db.withEntity = async (id, fn) => fn(fake);
/* the practice sends one client's marks as ONE batch: a read that takes ids from an earlier read carries them as a sub-select, which this in-memory books answers as the superset (every entry), as Postgres would answer the ids of that sub-select. The REAL text runs against Postgres in mis-practice-batch.test.cjs */
db.readBatch = async (id, actor, list) => Promise.all(list.map(async (one) => {
  if (/LEFT JOIN LATERAL|FROM journal_entry s/.test(one.text) && /ARRAY[(]SELECT/.test(one.text)) return { rows: Object.entries(ENTRIES).map(([id, e]) => ({ id, label: e.no, date: e.date, succ_id: e.succ || null, succ_no: e.succ ? 'R1' : null, succ_at: null, succ_who: null })) };
  if (/FROM chit_messages/.test(one.text)) return { rows: MARKS.filter((m) => ['open', 'hold'].includes(m.class)).map((m) => ({ thread: m.thread_id, us: m.thread_id === 't3' })) };
  return fake.query(one.text, one.params);
}));
db.inlineSql = db.inlineSql || ((text) => text);
const RM = require(lib('review-mark.js'));
const P = require(lib('books-practice.js'));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

(async () => {
  console.log('\nMIS 0b/0c · practice row = the client page (queries open, entries checked)');
  const page = await RM.openList(fake, 'acc.audit', E, { owner: true, via: { kind: 'self' } }, { from: QS, to: TODAY });
  const rows = [{ entity_id: E, quarter_start: QS }];
  await P.withMarks(rows, TODAY);
  const stored = Object.assign({ setting: { country: 'AU', functional_currency: 'AUD', enabled: true }, currencies: 1, cash_minor: 0, items: [], month_rows: [], bank: null }, rows[0]);
  const row = P.shape(stored, { can_see_costs: true, preset: 'auditor', grant_id: 'g', granted_at: '2026-01-01', expires_at: '2027-12-31' }, null, TODAY);
  await t('the page itself: 2 queries still read (e3 query, e4 hold), the gone entry is not listed', () => assert.strictEqual(page.total_open, 2));
  await t('queries open: practice = page', () => assert.strictEqual(row.queries.open, page.total_open));
  await t('entries checked: practice = page, the mark ALTERED by a seal does not count', () => { assert.strictEqual(page.checked, 1); assert.strictEqual(row.checked.n, page.checked); });
  await t('entries of: practice = page', () => assert.strictEqual(row.checked.of, page.of));
  await t('openCount is the same filter as openList (it counts what openList lists)', async () => assert.strictEqual((await RM.openCount(fake, 'acc.audit', E)).open, page.open.length));
  await t('coverage is exported and answers the page figure', async () => assert.deepStrictEqual(await RM.coverage(fake, RM.adopterOf('acc.audit'), 'acc.audit', E, QS, TODAY), { checked: page.checked, of: page.of }));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
