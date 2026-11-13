#!/usr/bin/env node
/**
 * ord-61-switch-off-atomic.test.cjs — ORD-61 (proof 2026-11-14): switching a person off (or removing them) and moving their open tasks commit TOGETHER, or not at all.
 * @type regression
 * OWNS      the rollback case tests/actors-switch-off.test.cjs lacks. The real PUT /api/actors/:id/status over a db whose withEntity behaves as a transaction (statements held until the callback ends:
 *           kept when it returns, thrown away when it throws). (a) happy path: a person holding 3 open tasks, task_action pool, 200 - the task re-route UPDATE chit_status and the status UPDATE identities
 *           are both in the ONE committed transaction, and no statement ran outside it; (b) the status UPDATE fails after the re-route ran: the answer is 500 and NOTHING of the transaction is
 *           kept (the re-route is rolled back with it - no person left switched on with their tasks gone); (c) the same for remove; (d) the re-route to a colleague (task_action actor) is inside the same one transaction.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in auth and a transaction-shaped recording db.
 * FLOW      owner PUT status -> withEntity(tx) { reroute, status write, cleanups } -> committed | rolled back
 *   node tests/ord-61-switch-off-atomic.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
['warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });

const SHOP = '11111111-1111-4111-8111-111111111111', PERSON = '33333333-3333-4333-8333-333333333333', COLLEAGUE = '44444444-4444-4444-8444-444444444444';
const person = { identity_id: PERSON, display_name: 'Ravi', actor_key: 'ravik', break_status: 'active', current_task_count: 3, delegate_actor_id: null };
const world = { failOn: null, committed: [], rolledBack: [], outside: [], inTx: false };
const answer = async (sql, params) => {
  if (world.failOn && world.failOn.test(sql)) throw new Error('simulated failure: ' + world.failOn);
  if (/current_task_count, delegate_actor_id/.test(sql)) return { rows: params[0] === PERSON ? [person] : [] };
  if (/break_status = 'active'\s+AND hat IN/.test(sql)) return { rows: params[0] === COLLEAGUE ? [{ identity_id: COLLEAGUE, display_name: 'Asha' }] : [] };
  if (/SELECT policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: { devices: {} } }] };
  if (/UPDATE chit_status/.test(sql)) return { rows: [], rowCount: 3 };
  return { rows: [], rowCount: 0 };
};
const flat = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const plain = async (sql, params) => { if (!world.inTx) world.outside.push(flat(sql)); return answer(String(sql), params); };
async function withEntity(id, fn) {
  const held = []; world.inTx = true;
  try {
    const r = await fn({ query: async (sql, params) => { held.push(flat(sql)); return answer(String(sql), params); } });
    world.committed.push(...held); return r;
  } catch (e) { world.rolledBack.push(...held); throw e; } finally { world.inTx = false; }
}
const db = { query: plain, withEntity, onEntity: async (id, d, fn) => withEntity(id, typeof d === 'function' ? d : fn), withTransaction: async (fn) => withEntity(SHOP, fn), pool: { query: plain } };
mock('db', db); mock('db/index', db);
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); };
stubAuth.entityOf = (req) => req.identity.identity_id; stubAuth.forgetKey = () => {};
mock('middleware/auth', stubAuth);

const reroute = (list) => list.filter((s) => /^UPDATE chit_status/.test(s)).length;
const statusWrite = (list) => list.filter((s) => /^UPDATE identities SET break_status = '(deactivated|removed)'/.test(s)).length;
const reset = (failOn) => { world.failOn = failOn || null; world.committed = []; world.rolledBack = []; world.outside = []; };

(async () => {
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.id = 'r'; next(); });
  app.use('/api/actors', require(path.join(API, 'routes', 'actors.js')));
  const server = app.listen(0); const port = server.address().port;
  const put = (body) => call(port, 'PUT', '/api/actors/' + PERSON + '/status', body);
  try {
    reset();
    let r = await put({ action: 'deactivate', task_action: 'pool' });
    ok('happy path: 200, 3 tasks routed', r.status === 200 && r.body.tasks_routed === 3, r.status + JSON.stringify(r.body).slice(0, 200));
    ok('the task re-route and the status write are both in the one committed transaction', reroute(world.committed) === 1 && statusWrite(world.committed) === 1, JSON.stringify(world.committed.map((s) => s.slice(0, 50))));
    ok('neither ran outside the transaction', reroute(world.outside) === 0 && statusWrite(world.outside) === 0, JSON.stringify(world.outside.map((s) => s.slice(0, 50))));

    reset(/SET break_status = 'deactivated'/);
    r = await put({ action: 'deactivate', task_action: 'pool' });
    ok('the status write fails after the re-route ran: the answer is 500, not 200', r.status === 500, r.status + JSON.stringify(r.body).slice(0, 200));
    ok('and the re-route was rolled back with it (it ran, then was thrown away; nothing kept)', reroute(world.rolledBack) === 1 && reroute(world.committed) === 0 && statusWrite(world.committed) === 0, 'rolledBack=' + reroute(world.rolledBack) + ' committed=' + world.committed.length);

    reset(/SET break_status = 'removed'/);
    r = await put({ action: 'remove', confirm: 'REMOVE', task_action: 'pool' });
    ok('remove: the same - 500 and nothing of the transaction kept', r.status === 500 && reroute(world.committed) === 0 && reroute(world.rolledBack) === 1, r.status + ' committed=' + world.committed.length);

    reset();
    r = await put({ action: 'deactivate', task_action: 'actor', target_actor_id: COLLEAGUE });
    ok('to a colleague: the re-route to them, their task count and the status write are all in the one committed transaction',
      r.status === 200 && reroute(world.committed) === 1 && statusWrite(world.committed) === 1 && world.committed.some((s) => /current_task_count/.test(s)) && reroute(world.outside) === 0, r.status + JSON.stringify(world.committed.map((s) => s.slice(0, 40))));
  } finally { server.close(); }
  done();
})();
