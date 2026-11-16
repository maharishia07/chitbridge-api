'use strict';
/**
 * tests/mis-practice-batch.realstack.cjs — MIS 0b/0c (l17): the practice's ONE-TRIP marks read (books-practice.markFigures, one db.readBatch per client) answers the SAME figures as the client's own page rules
 * (review-mark.openCount + coverage, run one statement at a time under withEntity), on a REAL Postgres.
 *
 * WHY REAL POSTGRES: the batch inlines its values as literals and carries the ids of an earlier read as a sub-select; a stub cannot show a type slip (uuid vs text) or a refused statement (readBatch refuses a semicolon in a comment).
 * Run on a throwaway database that has the api's migrations (sit-grund: tools/migrate.cjs --db <admin url>), never a shared one:
 *   ADMIN=postgres://postgres:...@host/db APP=postgres://cb_app:...@host/db node tests/mis-practice-batch.realstack.cjs
 * ADMIN seeds three clients (rows only under this run's own ids, deleted at the end), APP (the app role, RLS on) reads them. Without both variables it says so and exits 0 (not part of the offline guard).
 * Fixture per client: entries in the quarter · one checked and unchanged · one checked then REVERSED (altered, not counted) · a query and a hold still reading · a query on an entry that is gone (not counted) · a thread last answered by the client, one by the firm.
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 */
const assert = require('assert');
const crypto = require('crypto');
if (!process.env.ADMIN || !process.env.APP) { console.log('skipped: needs ADMIN and APP (a throwaway migrated database)'); process.exit(0); }
process.env.DATABASE_URL = process.env.APP;
process.env.NODE_ENV = 'test';
const { Client } = require('pg');
const canon = require('../lib/canon');
const db = require('../db');
const RM = require('../lib/review-mark');
const P = require('../lib/books-practice');
const uuid = () => crypto.randomUUID();
const QS = '2026-10-01', TODAY = '2026-11-16';
const MESSAGE = "INSERT INTO chit_messages (sender_entity_id, sender_display_name, thread_type, message_text, entity_id, subject_type, subject_id, msg_type) VALUES ($1,'Sender','external','hello',$2,'mark',$3,'info')";
(async () => {
  const admin = new Client({ connectionString: process.env.ADMIN });
  await admin.connect();
  const q = (s, p) => admin.query(s, p);
  const unchanged = canon.seal(['successor_id'], { successor_id: null });
  const ids = [];
  let pass = 0;
  try {
    for (let i = 0; i < 3; i++) {
      const bid = 'BR-MISB-' + crypto.randomBytes(4).toString('hex');
      const id = (await q("INSERT INTO identities (bridge_id, display_name, country) VALUES ($1,$2,'AU') RETURNING identity_id", [bid, 'Batch client ' + i])).rows[0].identity_id;
      ids.push(id);
      const entries = [];
      for (let k = 1; k <= 6 + i; k++) entries.push((await q("INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor) VALUES ($1,$2,$3,'FY2026-27',4,'sale','AUD',10000) RETURNING entry_id", [id, 'J' + k, '2026-10-' + String(1 + k).padStart(2, '0')])).rows[0].entry_id);
      await q("INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor, reverses_entry_id) VALUES ($1,'R1','2026-10-30','FY2026-27',4,'reversal','AUD',10000,$2)", [id, entries[1]]);
      const mark = async (subject, cls, kind, thread) => q("INSERT INTO review_mark (entity_id, adopter, subject_id, thread_id, kind, class, seal, seal_how, note, by_identity_id, by_entity_id, by_policy, via_kind) VALUES ($1,'acc.audit',$2,$3,$4,$5,$6::jsonb,'successor','n',$1,$1,'grant:auditor','grant')", [id, String(subject), thread || uuid(), kind, cls, JSON.stringify(unchanged)]);
      await mark(entries[0], 'clear', 'checked');
      await mark(entries[1], 'clear', 'checked'); /* reversed above: altered */
      const t1 = uuid(), t2 = uuid();
      await mark(entries[2], 'open', 'query', t1);
      await mark(entries[3], 'hold', 'on_hold');
      await mark(uuid(), 'open', 'query'); /* an entry that no longer reads */
      if (i > 0) await mark(entries[4], 'open', 'query', t2);
      await q(MESSAGE, [id, id, t1]);
      if (i > 0) await q(MESSAGE, [ids[0], id, t2]);
    }
    const adopter = RM.adopterOf('acc.audit');
    for (const id of ids) {
      /* the reference: review-mark's functions one statement at a time under withEntity (the 9-trip path of 315f912c) */
      const ref = await db.withEntity(id, async (h) => {
        const queries = await RM.openCount(h, 'acc.audit', id);
        const cover = await RM.coverage(h, adopter, 'acc.audit', id, QS, TODAY);
        let on_us = 0;
        if (queries.thread_ids.length) on_us = (await h.query("SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (subject_id) sender_entity_id FROM chit_messages WHERE subject_type = 'mark' AND entity_id = $1::uuid AND subject_id::text = ANY($2::text[]) ORDER BY subject_id, created_at DESC) x WHERE x.sender_entity_id = $1::uuid", [id, queries.thread_ids])).rows[0].n;
        return { open: queries.open, on_us, checked: cover.checked, of: cover.of };
      });
      const got = await P.markFigures(id, QS, TODAY);
      assert.deepStrictEqual(got, ref, 'the batch answers what the per-statement path answers');
      assert.ok(ref.open >= 2 && ref.checked === 1 && ref.of >= 6, 'the fixture shows something: ' + JSON.stringify(ref));
      pass++;
    }
    const one = await P.markFigures(ids[0], QS, TODAY), two = await P.markFigures(ids[1], QS, TODAY);
    assert.strictEqual(one.on_us, 1);
    assert.strictEqual(two.on_us, 1);
    assert.strictEqual(two.open, one.open + 1, 'the second client has one more query, answered by the firm');
    pass++;
    console.log(pass + ' passed, 0 failed (3 clients: batch = per-statement path, on_us counted from the right sender)');
  } finally {
    for (const id of ids) {
      for (const sql of ['DELETE FROM chit_messages WHERE entity_id = $1', 'DELETE FROM review_mark WHERE entity_id = $1', 'DELETE FROM journal_entry WHERE entity_id = $1 AND reverses_entry_id IS NOT NULL', 'DELETE FROM journal_entry WHERE entity_id = $1', 'DELETE FROM identities WHERE identity_id = $1']) await q(sql, [id]).catch(() => {});
    }
    await admin.end();
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
