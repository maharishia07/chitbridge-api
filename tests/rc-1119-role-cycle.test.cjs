#!/usr/bin/env node
// @type: unit
/**
 * CARD  17-people-employees-hr-and-payroll/people-list-with-may-why
 * tests/rc-1119-role-cycle.test.cjs — the role-cycle rule answers of DECISIONS 2026-11-19, the offline half. No DB, no network.
 *   RC-4  assign to a view-only person: the registered ASSIGNEE_VIEW_ONLY, the person named · RC-5 the list carries assign_blocked · RC-7 the owner's own accountant reads the money (SEC-161 stays for the rest)
 *   RC-8  one person holds both seats (editor, whole entity, sees costs) · RC-9/10 the review word on the record · RC-11 the auditor's evidence reads, posting refused for the right reason · RC-13 the ended-grant words
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300));
  }
};

const PERSON = '22222222-2222-4222-8222-222222222222';
const SHOP = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';

/** a stand-in handle: the team read, the one-rule holder read (answers `holds`), the name read */
const handleOf = (holds) => ({
  query: async (sql) => {
    if (/^SELECT identity_id FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: [{ identity_id: PERSON }] };
    if (/to_jsonb\(identities\)/.test(sql)) return { rows: holds ? [{ identity_id: PERSON, display_name: 'Priya', max_tasks: 5, current_task_count: 0 }] : [] };
    if (/^SELECT display_name FROM identities/.test(sql)) return { rows: [{ display_name: 'Priya' }] };
    return { rows: [] };
  }
});

/** the app-level refusal of a request that names a client's books, run on a stand-in request */
const elsewhere = (gate, method, path) => {
  const result = { next: false };
  const res = { statusCode: 200, status(c) { result.status = c; return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json(b) { result.body = b; return this; }, send(b) { result.body = b; return this; }, end() { return this; }, locals: {} };
  gate.refuseElsewhere({ path, method, headers: { 'x-books-for': 'S' }, id: 'r1', originalUrl: path, get() { return undefined; } }, res, () => { result.next = true; });
  return result;
};

(async () => {
  console.log('\nRC-1119 role cycle (offline)');
  await t('RC-4: assign to a view-only person is ASSIGNEE_VIEW_ONLY (400) and names the person', async () => {
    const { targetOf } = require('../lib/assign-bulk');
    await assert.rejects(() => targetOf(handleOf(false), SHOP, PERSON, 'client'), (err) => err.status === 400 && err.code === 'ASSIGNEE_VIEW_ONLY' && /Priya/.test(err.message) && /view-only/.test(err.message));
  });
  await t('RC-4: a person who may hold the work is the target, no refusal', async () => {
    const { targetOf } = require('../lib/assign-bulk');
    const target = await targetOf(handleOf(true), SHOP, PERSON, 'client');
    assert.strictEqual(target.display_name, 'Priya');
  });
  await t('RC-4: ASSIGNEE_VIEW_ONLY is the one registered code (no second code was added)', () => {
    const codes = require('../docs/error-codes.json');
    const rows = Array.isArray(codes) ? codes : codes.codes;
    assert.strictEqual(rows.filter((row) => /VIEW_ONLY/.test(row.code)).length, 1);
  });
  await t('RC-5: the list row carries assign_blocked: view_only for a viewer, null for an editor and a commenter', () => {
    const { listedActor } = require('../lib/actors-contract');
    assert.strictEqual(listedActor({ access_level: 'viewer', hat: 'view_only', connector_config: null }).assign_blocked, 'view_only');
    assert.strictEqual(listedActor({ access_level: 'editor', hat: 'act', connector_config: null }).assign_blocked, null);
    assert.strictEqual(listedActor({ access_level: 'commenter', hat: 'audit', connector_config: null }).assign_blocked, null);
  });
  await t('RC-7: the owner own accountant reads the money; a plain staff seat, a view-only manager and a key are still refused (SEC-161)', async () => {
    const { isOwner, isInHouseAccountant, roleGate } = require('../lib/owner');
    const { readers } = require('../lib/books-readers');
    const { mayReadMoney } = readers({ isOwner, roleGate, problem() {}, refusalOf() {}, ctx: () => ({}), auditorMay: async () => false });
    const staff = (extra) => ({ identity: Object.assign({ identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', hat: 'act' }, extra) });
    assert.strictEqual(await mayReadMoney(staff({ hat: 'manager' })), true, 'accountant');
    assert.strictEqual(await mayReadMoney(staff({})), false, 'a plain editor');
    assert.strictEqual(await mayReadMoney(staff({ hat: 'manager', access_level: 'viewer' })), false, 'a view-only manager');
    assert.strictEqual(await mayReadMoney(Object.assign(staff({ hat: 'manager' }), { api_key: 'k' })), false, 'a key');
    assert.strictEqual(isInHouseAccountant(staff({ hat: 'manager', acting_for_grant: 'g' })), false, 'never a grant-synthetic identity');
  });
  await t('RC-8: editor + whole entity + sees costs holds BOTH seats; without costs the adviser seat only; the auditor preset the auditor seat only', () => {
    const gate = require('../middleware/books-grant');
    const person = (level, costs) => ({ identity: { identity_type: 'actor', access_level: level, whole_entity: true, can_see_costs: costs } });
    const seats = (level, costs) => [gate.holdsSeat(person(level, costs), 'adviser'), gate.holdsSeat(person(level, costs), 'auditor')];
    assert.deepStrictEqual(seats('editor', true), [true, true]);
    assert.deepStrictEqual(seats('editor', false), [true, false]);
    assert.deepStrictEqual(seats('commenter', true), [false, true]);
    assert.deepStrictEqual(seats('viewer', true), [false, false]);
  });
  await t('RC-9/10: the record says reviewed, self_reviewed or not_reviewed', () => {
    const { reviewWordOf, SELF_REVIEWED } = require('../lib/books-action');
    assert.strictEqual(reviewWordOf(null), 'not_reviewed');
    assert.strictEqual(reviewWordOf({ reason: null }), 'reviewed');
    assert.strictEqual(reviewWordOf({ reason: SELF_REVIEWED }), 'self_reviewed');
  });
  await t('RC-9: review is not enforced (no ACTION_NOT_REVIEWED) and delegated posting writes no review step under the doer', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'books-action.js'), 'utf8');
    assert.ok(!/ACTION_NOT_REVIEWED/.test(source));
    assert.ok(!/step: 'reviewed'[^\n]*role: 'delegated'/.test(source));
  });
  await t('RC-11: the auditor lists the action record and a chit thread (GET); a post to the thread is refused as read-only; other chit paths stay refused', () => {
    const gate = require('../middleware/books-grant');
    for (const path of ['/api/books-actions', '/api/chits/' + THREAD + '/messages']) {
      const req = { method: 'GET', baseUrl: '', path, headers: {}, query: {} };
      assert.ok(gate.listedFor('auditor', req), 'auditor lists ' + path);
      assert.ok(gate.listedFor('adviser', req), 'adviser lists ' + path);
    }
    assert.strictEqual(elsewhere(gate, 'GET', '/api/chits/' + THREAD + '/messages').next, true);
    const post = elsewhere(gate, 'POST', '/api/chits/' + THREAD + '/messages');
    assert.ok(!post.next && post.status === 403 && /BOOKS_FOR_READ_ONLY/.test(JSON.stringify(post.body)), JSON.stringify(post));
    assert.ok(!elsewhere(gate, 'GET', '/api/chits/' + THREAD).next, 'any other chit path stays refused');
  });
  await t('RC-13: an ended grant says which books, who ended it and when', async () => {
    const grants = require('../lib/books-grant');
    const names = new Map([[SHOP, 'Moonee Traders'], [PERSON, 'Priya']]);
    const transaction = { query: async (sql, params) => ({ rows: params[0].map((id) => ({ id, display_name: names.get(id) })) }) };
    const ended = { grantor_entity: SHOP, revoked_by: PERSON, revoked_at: '2026-11-19T10:00:00Z' };
    assert.strictEqual(await grants.endedWords(transaction, ended), "Your access to Moonee Traders's books was ended by Priya on 19 November 2026.");
    assert.ok(/ended by the owner of the books on 19 November 2026/.test(await grants.endedWords(transaction, Object.assign({}, ended, { revoked_by: SHOP }))));
    const answer = await grants.answerNamed(transaction, 'revoked', ended);
    assert.ok(answer.status === 403 && answer.code === 'BOOKS_GRANT_ENDED' && /Moonee/.test(answer.words));
  });
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
