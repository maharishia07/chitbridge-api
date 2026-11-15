#!/usr/bin/env node
// @type: unit
/**
 * tests/mark-offline.test.cjs — MARK & QUERY (CAP-25), the guards that need no database.
 *   1  the adopter CI check: every registered adopter is honest; a planted adopter with no detector, a word mapped to no class, an empty `set`, a policy nobody answers, a table or column the schema does not know FAILS
 *   2  the core grep fixture: lib/review-mark.js, lib/message-post.js and migration b868 hold no adopter word (journal, auditor, books, drawing, invoice, ledger) and no grant_id / books_access
 *   3  the write-door classification: exactly POST /api/marks and POST /api/marks/:thread_id/messages write; POST /query is a read; a planted extra POST fails the guard
 *   4  the seal hygiene: a numeric as a string and as a number seal to the same hash (hostile test); a changed field list reads "re-check needed", never "altered"; a changed hash reads altered
 *   5  the policy forms: the auditor sets; the owner and the adviser do not; the owner and the adviser reply; an unknown form admits nobody
 *   6  the state rules of the core with a recording stub: Query needs words · removed is allowed for adopter 1 · a second identical press writes nothing · the owner is refused 403 and no row is written
 * OWNS      the offline checks of lib/review-mark.js, lib/mark-adopters.js, lib/mark-policies.js, lib/mark-detect.js and the marks classification of middleware/books-grant.js.
 * CALLED BY scripts/guards.cjs (CI guards job, no DB).   CARD  capability/MARK-AND-QUERY-CAPABILITY
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'mark_offline_secret_at_least_32_chars_padding_x';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); }
};

(async () => {
  const adopters = require(path.join(API, 'lib', 'mark-adopters.js'));
  const schemaStub = (tables) => ({ hasTable: async (name) => name in tables, hasColumn: async (table, column) => (tables[table] || []).includes(column) });
  const good = { journal_entry: ['entry_id', 'entry_no', 'posting_date', 'reverses_entry_id', 'created_by', 'created_at', 'entity_id'] };

  await t('1a every registered adopter is honest against the schema it names', async () => assert.deepStrictEqual(await adopters.checkAdopters(adopters.ADOPTERS, schemaStub(good)), []));
  const clone = () => JSON.parse(JSON.stringify(adopters.ADOPTERS['acc.audit']));
  const planted = async (edit, expect) => {
    const entry = clone();
    edit(entry);
    const faults = await adopters.checkAdopters({ 'acc.audit': entry }, schemaStub(good));
    assert.ok(faults.some((fault) => expect.test(fault)), 'expected ' + expect + ' in ' + JSON.stringify(faults));
  };
  await t('1b an adopter with no detector fails', () => planted((entry) => { entry.change = { how: 'none' }; }, /no change detector/));
  await t('1c a word mapped to no class fails', () => planted((entry) => { entry.vocabulary.checked.class = 'approved'; }, /mapped to no class/));
  await t('1d an empty `set` fails', () => planted((entry) => { entry.set = []; }, /`set` names no policy/));
  await t('1e a policy nothing answers fails', () => planted((entry) => { entry.reply = ['hat:testing']; }, /nothing answers/));
  await t('1f a subject table the schema does not know fails', () => planted((entry) => { entry.subject.table = 'no_such_table'; }, /not a table the schema knows/));
  await t('1g a detector column that does not exist fails', () => planted((entry) => { entry.change.column = 'no_such_column'; }, /does not exist/));
  await t('1h a removed word without allow_removed fails', () => planted((entry) => { entry.allow_removed = false; }, /allow_removed/));

  const BANNED = /journal|auditor|books|drawing|invoice|ledger|grant_id|books_access/i;
  for (const file of ['lib/review-mark.js', 'lib/message-post.js', 'migrations/b868_review_mark.sql']) {
    await t('2 the core file holds no adopter word: ' + file, () => {
      const hit = fs.readFileSync(path.join(API, file), 'utf8').split('\n').map((line, index) => ({ line, n: index + 1 })).filter((row) => BANNED.test(row.line));
      assert.deepStrictEqual(hit.map((row) => file + ':' + row.n + ' ' + row.line.trim().slice(0, 80)), []);
    });
  }
  await t('2b the fixture itself fires on a planted word', () => assert.ok(BANNED.test('select * from journal_entry')));

  const front = require(path.join(API, 'middleware', 'books-grant.js'));
  const express = require('express');
  await t('3a the real marks router: exactly the two write doors and the one read POST', () => {
    const router = require(path.join(API, 'routes', 'marks.js'));
    assert.deepStrictEqual(front.unclassifiedWrites(router), []);
    assert.deepStrictEqual([...front.MARK_WRITE_DOORS].sort(), ['POST /api/marks', 'POST /api/marks/:thread_id/messages']);
  });
  await t('3b a planted extra POST (or DELETE) on a marks router fails the guard', () => {
    const router = express.Router();
    router.post('/', () => {}); router.post('/query', () => {}); router.post('/:thread_id/messages', () => {});
    assert.deepStrictEqual(front.unclassifiedWrites(router), []);
    router.post('/:thread_id/close', () => {}); router.delete('/:thread_id', () => {});
    assert.deepStrictEqual(front.unclassifiedWrites(router).sort(), ['DELETE /api/marks/:thread_id', 'POST /api/marks/:thread_id/close']);
  });

  const detect = require(path.join(API, 'lib', 'mark-detect.js'));
  const canon = require(path.join(API, 'lib', 'canon.js'));
  await t('4a a numeric as a string and as a number seal to the same hash (one seal() call, one type)', () => {
    const change = { how: 'seal', fields: ['total', 'note'] };
    const asNumber = detect.sealOf(change, JSON.parse(JSON.stringify({ total: 100.5, note: 'x' })));
    const asString = detect.sealOf(change, JSON.parse(JSON.stringify({ total: 100.5, note: 'x' })));
    assert.strictEqual(asNumber.hash, asString.hash);
    assert.notStrictEqual(detect.sealOf(change, { total: '100.5', note: 'x' }).hash, asNumber.hash, 'the raw driver string would differ: that is why the row is read as JSON (to_jsonb) at both moments');
  });
  await t('4b a changed field list is "re-check needed", never "altered"; a changed hash is altered; an equal one is neither', () => {
    const a = canon.seal(['x'], { x: 1 }), b = canon.seal(['x', 'y'], { x: 1, y: 2 }), c = canon.seal(['x'], { x: 2 });
    assert.deepStrictEqual(detect.compareSeal(a, b), { altered: false, recheck_needed: true });
    assert.deepStrictEqual(detect.compareSeal(a, c), { altered: true, recheck_needed: false });
    assert.deepStrictEqual(detect.compareSeal(a, canon.seal(['x'], { x: 1 })), { altered: false, recheck_needed: false });
  });
  await t('4c the successor seal: no later row = empty, a reversing row = a different seal', () => {
    const change = { how: 'successor' };
    assert.notStrictEqual(detect.sealOf(change, null, null).hash, detect.sealOf(change, null, 'rev-1').hash);
  });

  const policies = require(path.join(API, 'lib', 'mark-policies.js'));
  const who = { auditor: { owner: false, via: { kind: 'grant', preset: 'auditor' } }, adviser: { owner: false, via: { kind: 'grant', preset: 'adviser' } }, owner: { owner: true, via: { kind: 'self' } } };
  const A = adopters.ADOPTERS['acc.audit'];
  await t('5 the auditor sets; the owner and the adviser do not; the owner and the adviser reply; the auditor too', () => {
    assert.ok(policies.answer(A.set, who.auditor).ok);
    assert.ok(!policies.answer(A.set, who.owner).ok && !policies.answer(A.set, who.adviser).ok);
    assert.ok(policies.answer(A.reply, who.owner).ok && policies.answer(A.reply, who.adviser).ok);
    assert.ok(policies.answer(A.reply, who.auditor).ok, 'the auditor who raised the query replies in its thread');
    assert.ok(!policies.answer(['hat:testing'], who.owner).ok, 'an unknown form fails closed');
  });

  /* 6 the core with a recording stub */
  const core = require(path.join(API, 'lib', 'review-mark.js'));
  const calls = [];
  const sealNow = canon.seal(['successor_id'], { successor_id: null });
  const stubDb = (state) => ({ query: async (sql, params) => {
    calls.push(sql.slice(0, 40));
    if (/FROM journal_entry s/.test(sql)) return { rows: params[1].map((id) => ({ id, label: 'MJ/1', date: '2026-11-01', succ_id: null, succ_no: null, succ_at: null, succ_who: null })) };
    if (/WITH latest AS/.test(sql)) return { rows: state.latest ? [state.latest] : [] };
    if (/review_mark_set/.test(sql)) { state.written = (state.written || 0) + 1; return { rows: [{ mark_id: 7, thread_id: 'th', kind: params[3], class: params[4], note: params[5], at: new Date() }] }; }
    return { rows: [] };
  } });
  const ctxOf = (kind) => Object.assign({ entity_id: 'e1', real: { identity_id: 'p1', name: 'A', entity_id: 'f1' }, via: { id: 'g1' } }, who[kind]);
  const refusedWith = async (fn, code) => { try { await fn(); } catch (e) { assert.strictEqual(e.code, code, 'got ' + e.code); return; } throw new Error('expected ' + code); };
  await t('6a a Query without words is refused 422 and writes nothing', async () => {
    const state = {};
    await refusedWith(() => core.set(stubDb(state), ctxOf('auditor'), { adopter: 'acc.audit', subject_id: 's1', kind: 'query', note: '  ' }), 'MARK_WORDS_REQUIRED');
    assert.ok(!state.written);
  });
  await t('6b the owner posting a class is refused 403 and no row is written', async () => {
    const state = {};
    await refusedWith(() => core.set(stubDb(state), ctxOf('owner'), { adopter: 'acc.audit', subject_id: 's1', kind: 'checked' }), 'MARK_NOT_ALLOWED');
    await refusedWith(() => core.set(stubDb(state), ctxOf('adviser'), { adopter: 'acc.audit', subject_id: 's1', kind: 'query', note: 'why' }), 'MARK_NOT_ALLOWED');
    assert.ok(!state.written);
  });
  await t('6c an unknown kind and a bulk press are refused 422', async () => {
    await refusedWith(() => core.set(stubDb({}), ctxOf('auditor'), { adopter: 'acc.audit', subject_id: 's1', kind: 'approved' }), 'MARK_KIND_UNKNOWN');
    await refusedWith(() => core.set(stubDb({}), ctxOf('auditor'), { adopter: 'acc.audit', subject_ids: ['a', 'b'], kind: 'checked' }), 'MARK_BULK_NOT_ALLOWED');
    await refusedWith(() => core.set(stubDb({}), ctxOf('auditor'), { adopter: 'nope.nope', subject_id: 's1', kind: 'checked' }), 'MARK_ADOPTER_UNKNOWN');
  });
  await t('6d the auditor sets a Checked mark: one review_mark_set call', async () => {
    const state = {};
    const out = await core.set(stubDb(state), ctxOf('auditor'), { adopter: 'acc.audit', subject_id: 's1', kind: 'checked' });
    assert.strictEqual(state.written, 1);
    assert.strictEqual(out.unchanged, false);
  });
  await t('6e an identical press writes nothing (the same kind and words as the latest row)', async () => {
    const state = { latest: { mark_id: 7, entity_id: 'e1', adopter: 'acc.audit', subject_id: 's1', thread_id: 'th', kind: 'query', class: 'open', note: 'why', seal: sealNow, at: new Date(), by_name: 'A', by_entity_id: 'f1', by_entity_name: 'Firm', open_since: new Date(), message_count: 0 } };
    const out = await core.set(stubDb(state), ctxOf('auditor'), { adopter: 'acc.audit', subject_id: 's1', kind: 'query', note: 'why' });
    assert.ok(out.unchanged && !state.written);
  });
  await t('6f a reply on a closed thread is refused 409 (the auditor included); a stranger may not reply (403)', async () => {
    const closed = { latest: { mark_id: 9, entity_id: 'e1', adopter: 'acc.audit', subject_id: 's1', thread_id: 'th', kind: 'checked', class: 'clear', seal: sealNow, at: new Date() } };
    const db = { query: async (sql) => (/FROM review_mark WHERE thread_id/.test(sql) ? { rows: [closed.latest] } : { rows: [] }) };
    await refusedWith(() => core.reply(db, ctxOf('owner'), 'th', { message_text: 'hi' }), 'MARK_THREAD_CLOSED');
    await refusedWith(() => core.reply(db, ctxOf('auditor'), 'th', { message_text: 'hi' }), 'MARK_THREAD_CLOSED');
    await refusedWith(() => core.reply(db, { entity_id: 'e1', real: { identity_id: 'p', name: 'x', entity_id: 'z' }, owner: false, via: { kind: 'self' } }, 'th', { message_text: 'hi' }), 'MARK_REPLY_NOT_ALLOWED');
  });
  await t('6g the open run keeps its age: markOf reads open_since, a removed class reads null in marksFor', async () => {
    const open = { mark_id: 3, entity_id: 'e1', adopter: 'acc.audit', subject_id: 's1', thread_id: 'th', kind: 'query', class: 'open', note: 'q', seal: sealNow, at: new Date(), open_since: new Date(Date.now() - 3 * 86400000), by_name: 'A', by_entity_id: 'f1', by_entity_name: 'Firm', message_count: '2' };
    const found = await core.marksFor(stubDb({ latest: open }), 'acc.audit', 'e1', ['s1'], ctxOf('owner'));
    assert.strictEqual(found.marks.s1.age_days, 3);
    assert.strictEqual(found.marks.s1.message_count, 2);
    assert.strictEqual(found.marks.s1.by_firm, 'Firm');
    assert.strictEqual(found.marks.s1.actions.set.ok, false);
    assert.strictEqual(found.marks.s1.actions.reply.ok, true);
    const removed = await core.marksFor(stubDb({ latest: Object.assign({}, open, { class: 'removed', kind: 'removed' }) }), 'acc.audit', 'e1', ['s1'], ctxOf('owner'));
    assert.strictEqual(removed.marks.s1, null);
  });

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
