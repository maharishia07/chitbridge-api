#!/usr/bin/env node
// @type: unit
/**
 * actors-switch-off.test.cjs — QA no-proof wave 1 (6 Nov 2026): the owner's switch off / remove / back on of a person, PUT /api/actors/:id/status.
 *
 * OWNS      the proof that the status route (a) refuses an unknown person and a remove without the word REMOVE, (b) asks where open work goes before
 *           it switches a busy person off, (c) on switch-off writes break_status 'deactivated', clears the covers and the default assignee that pointed
 *           at the person, ends their sessions and keys and answers with the cleanup counts, (d) on remove writes 'removed', (e) on back-on routes no tasks.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in sign-in and a recording db.
 * FLOW      recording db + owner auth → real router on an express app → request over http → status · the UPDATE asked · the answer's counts
 * CARD      17-people-employees-hr-and-payroll/add-edit-switch-off-a-person
 * UNIT      17/Add / edit / switch off a person
 * MUTATION  checked once: in routes/actors.js change `break_status = 'deactivated'` (the deactivate UPDATE) to `'active'` → "switch-off writes deactivated" goes red.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const PERSON = '33333333-3333-4333-8333-333333333333';
const COLLEAGUE = '44444444-4444-4444-8444-444444444444';
const world = { person: { identity_id: PERSON, display_name: 'Ravi', actor_key: 'ravik', break_status: 'active', current_task_count: 0, delegate_actor_id: null }, coverRows: 0, defaultRows: 0 };
const queries = [];
const ranUpdate = (re) => queries.filter((q) => re.test(q)).length;

const stubDb = async (sql, params) => {
  queries.push(sql);
  if (/SELECT policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: { devices: {} } }] };
  if (/current_task_count, delegate_actor_id/.test(sql)) return { rows: params[0] === PERSON ? [world.person] : [] };
  if (/SET delegate_actor_id = NULL WHERE delegate_actor_id/.test(sql)) return { rows: [], rowCount: world.coverRows };
  if (/UPDATE entity_actor_settings SET default_assignee_actor_id = NULL/.test(sql)) return { rows: [], rowCount: world.defaultRows };
  if (/break_status = 'active'\s+AND hat IN/.test(sql)) return { rows: params[0] === COLLEAGUE ? [{ identity_id: COLLEAGUE, display_name: 'Asha' }] : [] };
  if (/entity_actor_settings/.test(sql)) return { rows: [{ setting_id: 1, entity_id: SHOP, assignment_model: 'both', default_max_tasks: 10 }] };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} }
};
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); };
stubAuth.entityOf = (req) => req.identity.identity_id;
stubAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/actors', require(path.join(ROOT, 'routes', 'actors.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const put = (server, id, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = http.request({ port: server.address().port, method: 'PUT', path: '/api/actors/' + id + '/status', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
  });
  req.end(data);
});

(async () => {
  const server = app.listen(0);
  let a = await put(server, '55555555-5555-4555-8555-555555555555', { action: 'deactivate' });
  check(a.status === 404, 'a person who is not in this shop → 404 (got ' + a.status + ')', a.text);

  queries.length = 0;
  a = await put(server, PERSON, { action: 'remove' });
  check(a.status === 400 && !ranUpdate(/SET break_status = 'removed'/), 'remove without the word REMOVE → 400 and nothing written (got ' + a.status + ')', a.text);

  world.person.current_task_count = 3;
  queries.length = 0;
  a = await put(server, PERSON, { action: 'deactivate' });
  check(a.status === 400 && !ranUpdate(/SET break_status = 'deactivated'/), 'a busy person with no task_action → 400, nothing written (got ' + a.status + ')', a.text);
  a = await put(server, PERSON, { action: 'deactivate', task_action: 'actor' });
  check(a.status === 400 && !ranUpdate(/SET break_status = 'deactivated'/), 'task_action actor with no target → 400, nothing written (got ' + a.status + ')', a.text);
  a = await put(server, PERSON, { action: 'deactivate', task_action: 'actor', target_actor_id: '66666666-6666-4666-8666-666666666666' });
  check(a.status === 400 && !ranUpdate(/SET break_status = 'deactivated'/), 'a target who is not an active colleague → 400, nothing written (got ' + a.status + ')', a.text);

  world.person.current_task_count = 0;
  world.coverRows = 2;
  world.defaultRows = 1;
  world.person.delegate_actor_id = COLLEAGUE;
  queries.length = 0;
  a = await put(server, PERSON, { action: 'deactivate', return_date: '2026-12-01' });
  check(a.status === 200, 'switch off a person with no open work → 200 (got ' + a.status + ')', a.text);
  check(ranUpdate(/SET break_status = 'deactivated'/) === 1, 'switch-off writes deactivated', queries);
  check(a.body.action === 'deactivate' && a.body.return_date === '2026-12-01', 'the answer names the action and the return date', a.body);
  check(a.body.covers_removed === 2 && a.body.was_default_assignee === true && a.body.had_cover === true, 'the answer carries the cleanup: covers removed, default assignee cleared, had a cover', a.body);
  check(a.body.signed_out && typeof a.body.signed_out.sessions === 'number' && typeof a.body.signed_out.keys_closed === 'number', 'the answer says how many sessions and keys were ended', a.body);
  check(ranUpdate(/SET delegate_actor_id = NULL WHERE delegate_actor_id/) === 1 && ranUpdate(/default_assignee_actor_id = NULL/) === 1, 'inbound covers and the default assignee are cleared in the same act', queries);

  world.person.current_task_count = 3;
  queries.length = 0;
  a = await put(server, PERSON, { action: 'deactivate', task_action: 'pool' });
  check(a.status === 200 && a.body.task_action === 'pool', 'a busy person with task_action pool → 200 (got ' + a.status + ')', a.text);

  world.person.current_task_count = 0;
  queries.length = 0;
  a = await put(server, PERSON, { action: 'remove', confirm: 'REMOVE' });
  check(a.status === 200 && ranUpdate(/SET break_status = 'removed'/) === 1 && !ranUpdate(/SET break_status = 'deactivated'/), 'remove with REMOVE → 200, writes removed, not deactivated (got ' + a.status + ')', a.text);

  world.person.break_status = 'deactivated';
  queries.length = 0;
  a = await put(server, PERSON, { action: 'reactivate' });
  check(a.status === 200 && /reactivated/i.test(a.body.message || ''), 'back on → 200 "Actor reactivated" (got ' + a.status + ' ' + a.text.slice(0, 150) + ')', a.text);
  check(ranUpdate(/SET break_status = 'deactivated'|SET break_status = 'removed'/) === 0 && !('tasks_routed' in a.body), 'back on does no switch-off write and no task routing', queries);

  a = await put(server, PERSON, { action: 'explode' });
  check(a.status === 400, 'an unknown action → 400 (got ' + a.status + ')', a.text);
  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
