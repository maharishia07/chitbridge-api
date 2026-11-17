#!/usr/bin/env node
// @type: unit
/**
 * tests/assign-jobs-not-counted.test.cjs — DECISIONS-SLICE1 (d), 18 Nov: a JOB chit (plug other than task) does not count against identities.max_tasks or current_task_count. The cap stays for tasks and for auto-assign.
 * HAND-COMPUTED: a seat with max_tasks 10 is handed 12 job chits in one bulk call: assigned 12, skipped 0, NO write to identities (count stays 0). The same 12 as TASK chits: assigned 10, skipped 2 "at capacity (10)" (the cap stays).
 * A mixed batch (3 jobs + 12 tasks): the jobs are never capped and never counted; the tasks still stop at the cap. A single push of a job to a full seat warns nothing; a task warns "at maximum load".
 * taskCount(.., plug) writes nothing for a job plug and writes as before for 'task' or no plug. The auto door told a job plug never counts it.
 * Stand-in database; no server. Run: node tests/assign-jobs-not-counted.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};

const FIRM = '11111111-1111-4111-8111-111111111111';
const SEAT = '33333333-3333-4333-8333-333333333333';
const chitId = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0');
let log = [];
let plugOfChit = {}; /* chit_id → 'client' for the job chits of a scene */
let subjects = [];
const fakeClient = {
  query: async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ');
    log.push(text);
    if (/FROM entity_actor_settings/.test(text)) return { rows: [{ assignment_model: 'both', default_max_tasks: 10 }] };
    if (/jsonb_array_elements/.test(text)) return { rows: subjects.map((s, i) => ({ subject_id: s, chit_id: chitId(i + 1) })) };
    if (/SELECT DISTINCT chit_id, business_json/.test(text)) return { rows: (params[1] || []).filter((id) => plugOfChit[id]).map((id) => ({ chit_id: id, plug: plugOfChit[id] })) };
    if (/SELECT assigned_to_actor_id FROM chit_status/.test(text)) return { rows: [{ assigned_to_actor_id: null }] };
    return { rows: [], rowCount: 1 };
  }
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(fakeClient), query: async () => ({ rows: [] }) } };
const chitPath = require.resolve(path.join(API, 'lib', 'assign-chit'));
const real = require(chitPath);
const seat = { identity_id: SEAT, display_name: 'Seat', max_tasks: 10, current_task_count: 0 };
require.cache[chitPath].exports = Object.assign({}, real, {
  assignableActor: async () => seat,
  assignChit: async (run, entity, chit) => {
    log.push('ASSIGN ' + chit);
    return { moved: true, rows: 1, from: 'pending' };
  }
});
const { bulkAssign } = require(path.join(API, 'lib', 'assign-bulk'));
const countWrites = () => log.filter((t) => /UPDATE identities SET current_task_count/.test(t)).length;
const reqOf = (body) => ({ body, identity: { identity_id: FIRM, identity_type: 'entity', display_name: 'Firm' }, till: null });

(async () => {
  /* taskCount itself */
  log = [];
  await real.taskCount(fakeClient, SEAT, 'take', 'client');
  check('taskCount take for a job plug does not move the count', countWrites() === 0, log.join('|'));
  check('taskCount take for a job plug still stamps last_assigned_at (the round-robin tie-break, realstack T18)', log.some((t) => /UPDATE identities SET last_assigned_at = NOW.. WHERE identity_id/.test(t)), log.join('|'));
  await real.taskCount(fakeClient, SEAT, 'release', 'client');
  check('taskCount release for a job plug writes nothing', countWrites() === 0);
  log = [];
  await real.taskCount(fakeClient, SEAT, 'release', 'client');
  check('release for a job plug runs no statement at all', log.length === 0, log.join('|'));
  log = [];
  await real.taskCount(fakeClient, SEAT, 'take', 'task');
  await real.taskCount(fakeClient, SEAT, 'take');
  check('taskCount for the task plug, or none, writes as before (2 writes)', countWrites() === 2, String(countWrites()));

  /* 12 named job chits to a seat with cap 10 */
  subjects = Array.from({ length: 12 }, (_, i) => 'sub' + i);
  log = [];
  const jobs = await bulkAssign(reqOf({ plug: 'client', role: 'adviser', subject_ids: subjects, target_actor_id: SEAT }));
  check('12 job chits to a seat with max_tasks 10: assigned 12', jobs.assigned.length === 12, JSON.stringify(jobs.assigned.length));
  check('12 job chits: no at-capacity refusal', jobs.skipped.filter((s) => s.code === 'ASSIGN_AT_CAPACITY').length === 0, JSON.stringify(jobs.skipped).slice(0, 200));
  check('12 job chits: the seat count is never written', countWrites() === 0, String(countWrites()));

  /* the same 12 as task chits: the cap stays */
  plugOfChit = {};
  log = [];
  const ids = Array.from({ length: 12 }, (_, i) => chitId(i + 1));
  const tasks = await bulkAssign(reqOf({ chit_ids: ids, target_actor_id: SEAT }));
  check('12 task chits, cap 10: assigned 10', tasks.assigned.length === 10, String(tasks.assigned.length));
  check('12 task chits, cap 10: 2 skipped ASSIGN_AT_CAPACITY "at capacity (10)"', tasks.skipped.length === 2 && tasks.skipped.every((s) => s.code === 'ASSIGN_AT_CAPACITY' && s.reason === 'at capacity (10)'), JSON.stringify(tasks.skipped).slice(0, 200));
  check('12 task chits: 10 take writes', countWrites() === 10, String(countWrites()));

  /* a mixed batch: 3 jobs first, then 12 tasks */
  const mixed = Array.from({ length: 15 }, (_, i) => chitId(i + 1));
  plugOfChit = { [mixed[0]]: 'client', [mixed[1]]: 'client', [mixed[2]]: 'client' };
  log = [];
  const mix = await bulkAssign(reqOf({ chit_ids: mixed, target_actor_id: SEAT }));
  check('mixed 3 jobs + 12 tasks: jobs never capped, tasks stop at 10: assigned 13, skipped 2', mix.assigned.length === 13 && mix.skipped.length === 2, JSON.stringify([mix.assigned.length, mix.skipped.length]));
  check('mixed: only the 10 tasks are counted (10 writes)', countWrites() === 10, String(countWrites()));

  /* push: the warning is for tasks only, and a job is not counted */
  const pushChit = require(path.join(API, 'lib', 'actors-assign-jobs')).ASSIGN_JOBS.push;
  const push = async (plug) => {
    let out = null;
    const res = { json: (b) => (out = b), status() { return this; } };
    log = [];
    await pushChit({ req: { identity: { identity_id: FIRM }, body: {} }, res, client: fakeClient, handle: (t, p) => fakeClient.query(t, p), entity_id: FIRM, chit_id: chitId(1), action_by_id: FIRM, action_by_name: 'Firm', target_actor_id: SEAT, chitRow: { job_plug: plug, assigned_to_actor_id: null } });
    return out;
  };
  Object.assign(seat, { max_tasks: 10, current_task_count: 10 });
  const pj = await push('client');
  const jobPushWrites = countWrites();
  const pt = await push(null);
  check('push a job to a full seat: no warning', pj && pj.warning === null, JSON.stringify(pj));
  check('push a job: the count is not written', jobPushWrites === 0, String(jobPushWrites));
  check('push a task to a full seat: "at maximum load"', pt && /at maximum load/.test(pt.warning || ''), JSON.stringify(pt));
  check('push a task: the count is written (1)', countWrites() === 1, String(countWrites()));

  /* the auto door */
  const { autoAssign } = require(path.join(API, 'lib', 'auto-assign'));
  const autoWrites = async (plug) => {
    log = [];
    const was = fakeClient.query;
    fakeClient.query = async (sql, p) => {
      const text = String(sql).replace(/\s+/g, ' ');
      if (/FROM entity_actor_settings/.test(text)) return { rows: [{ auto_assign_mode: 'default_assignee', default_assignee_actor_id: SEAT, default_max_tasks: 10 }] };
      if (/SELECT assigned_to_actor_id, current_status FROM chit_status/.test(text)) return { rows: [{ assigned_to_actor_id: null, current_status: 'pending' }] };
      if (/FROM identities WHERE identity_id = \$1/.test(text)) return { rows: [{ identity_id: SEAT, display_name: 'Seat', break_status: 'active', hat: 'act', access_level: 'editor' }] };
      return was(sql, p);
    };
    try {
      await autoAssign(FIRM, chitId(1), plug);
    } finally {
      fakeClient.query = was;
    }
    return countWrites();
  };
  check('auto door: a client job is held but not counted', (await autoWrites('client')) === 0);
  check('auto door: a task is counted (1 write)', (await autoWrites('task')) === 1);

  console.log('assign-jobs-not-counted: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('  FAIL threw ' + (e && e.stack));
  process.exit(1);
});
