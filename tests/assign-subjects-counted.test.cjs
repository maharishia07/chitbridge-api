#!/usr/bin/env node
// @type: unit
/**
 * tests/assign-subjects-counted.test.cjs — Fable review 18 Nov, A3 + A4 (rail side).
 * HAND-COMPUTED: firm F, clients C1 C2 C3; C1 and C2 each hold two job copies (two periods), C3 none. Tick 3, assign to a seat:
 *   copies 4 · clients assigned 2 (assigned = SUBJECTS, not copies) · ONE skip: C3 by name, "no job is open for this client" · previous holds 4 rows (all were the pool: actor_id null).
 * A4: a received JOB copy is not client work (classify drops it); the firm's SENT job copy is (the Tasks page); an ordinary received task stays; the bell's feed carries the same marker.
 * Stand-in database; no server. Run: node tests/assign-subjects-counted.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
let fail = 0;
const check = (name, ok, extra) => {
  if (!ok) { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); }
};
const FIRM = '11111111-1111-4111-8111-111111111111';
const SEAT = '33333333-3333-4333-8333-333333333333';
const C = ['c1', 'c2', 'c3'].map((n, i) => 'aaaaaaaa-0000-4000-8000-00000000000' + (i + 1));
const chitId = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fakeClient = {
  query: async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ');
    if (/FROM entity_actor_settings/.test(text)) return { rows: [{ assignment_model: 'both', default_max_tasks: 10 }] };
    if (/jsonb_array_elements/.test(text)) return { rows: [{ subject_id: C[0], chit_id: chitId(1) }, { subject_id: C[0], chit_id: chitId(2) }, { subject_id: C[1], chit_id: chitId(3) }, { subject_id: C[1], chit_id: chitId(4) }] };
    if (/FROM identities WHERE identity_id = ANY/.test(text)) return { rows: [{ id: C[2], display_name: 'Brunswick Grocer' }] };
    if (/SELECT assigned_to_actor_id FROM chit_status/.test(text)) return { rows: [{ assigned_to_actor_id: null }] };
    return { rows: [], rowCount: 1 };
  }
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(fakeClient), query: async () => ({ rows: [] }) } };
const chitPath = require.resolve(path.join(API, 'lib', 'assign-chit'));
const real = require(chitPath);
require.cache[chitPath].exports = Object.assign({}, real, {
  assignableActor: async () => ({ identity_id: SEAT, display_name: 'Seat', max_tasks: 10, current_task_count: 0 }),
  assignChit: async () => ({ moved: true, rows: 1, from: 'pending' })
});
const { bulkAssign } = require(path.join(API, 'lib', 'assign-bulk'));
const workRows = require(path.join(API, 'lib', 'work-rows'));

(async () => {
  const out = await bulkAssign({ body: { plug: 'client', role: 'adviser', subject_ids: C, target_actor_id: SEAT }, identity: { identity_id: FIRM, identity_type: 'entity', display_name: 'Firm' }, till: null });
  check('copies assigned 4', out.assigned.length === 4, String(out.assigned.length));
  check('subjects handled 2 (clients, not copies)', out.subjects === 2, String(out.subjects));
  check('one skip, C3 by name, with its reason', out.skipped.length === 1 && out.skipped[0].name === 'Brunswick Grocer' && out.skipped[0].code === 'JOB_NOT_OPEN' && /no job is open/.test(out.skipped[0].reason), JSON.stringify(out.skipped));
  check('previous holders: 4 rows, each was the pool, each carries its client', out.previous.length === 4 && out.previous.every((p) => p.actor_id === null && p.subject_id), JSON.stringify(out.previous));
  const listed = await bulkAssign({ body: { chit_ids: [chitId(1)], target_actor_id: SEAT }, identity: { identity_id: FIRM, identity_type: 'entity', display_name: 'Firm' }, till: null });
  check('a listed batch has no subject count (the route answers the chit count)', listed.subjects === null);

  /* A4: the client's Tasks rows */
  const row = (id, direction, isJob) => ({ chit_id: id, direction, purpose: 'general', is_job_chit: isJob, current_status: 'pending', sender_entity_id: FIRM });
  const kept = workRows.classify([row('r-job', 'received', true), row('r-task', 'received', false), row('s-job', 'sent', true), row('s-plain', 'sent', false)], 'ENT').map((x) => x.r.chit_id).sort();
  check('received job copy out, firm sent job copy in, plain received task in, plain sent non-order out', kept.join() === 's-job,r-task'.split(',').sort().join(), kept.join());
  const feed = fs.readFileSync(path.join(API, 'routes', 'notifications.js'), 'utf8');
  check("the bell's one fragment excludes a received job copy", /cs\.direction = 'received' AND ch\.business_json \? 'job'/.test(feed));
  console.log(fail ? '\n  ' + fail + ' FAILED' : '\n  all checks passed');
  process.exit(fail ? 1 : 0);
})();
