#!/usr/bin/env node
// @type: unit
/**
 * heir-of-plug.test.cjs — L30/L34 (20 Nov): the heir of a leaver's open work is checked per kind of work the leaver holds (lib/assign-chit heirOf, used by routes/actors routeTargetOf).
 * A comment-only Reviewer may hold CLIENTS (seat rule) but not TASKS (act_or_manager). Fake db: the team read answers the id; the seat statement (holderSql 'client') finds the person, the editor one does not.
 * Run: node tests/heir-of-plug.test.cjs
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { heirOf } = require('../lib/assign-chit');
const SHOP = '11111111-1111-4111-8111-111111111111', LEAVER = '22222222-2222-4222-8222-222222222222', REVIEWER = '33333333-3333-4333-8333-333333333333';
const reviewerDb = { query: async (sql, params) => {
  if (/identity_id = ANY/.test(sql)) return { rows: [{ identity_id: params[1] && params[1][0] || REVIEWER }] };
  if (/= 'viewer'/.test(sql)) return { rows: [{ identity_id: REVIEWER, display_name: 'Rita' }] }; /* the seat rule (clients): a reviewer passes */
  return { rows: [] }; /* the editor rule (tasks): a reviewer does not */
} };
let checks = 0;
for (const k of ['ok', 'strictEqual']) { const real = assert[k]; assert[k] = function () { checks += 1; return real.apply(assert, arguments); }; }
(async () => {
  const clients = await heirOf(reviewerDb, SHOP, REVIEWER, { total: 2, tasks: 0, plugs: ['client'] }, LEAVER);
  assert.ok(clients.actor && clients.actor.identity_id === REVIEWER, 'a client-only leaver: the Reviewer colleague is a valid heir (L30)');
  const tasks = await heirOf(reviewerDb, SHOP, REVIEWER, { total: 2, tasks: 2, plugs: ['task'] }, LEAVER);
  assert.strictEqual(tasks.failedPlug, 'task', 'a tasks-only leaver: the Reviewer is refused');
  const none = await heirOf(reviewerDb, SHOP, REVIEWER, { total: 0, tasks: 0, plugs: [] }, LEAVER);
  assert.strictEqual(none.failedPlug, 'task', 'nothing read: asked as a task, as before');
  const both = await heirOf(reviewerDb, SHOP, REVIEWER, { total: 3, tasks: 1, plugs: ['client', 'task'] }, LEAVER);
  assert.strictEqual(both.failedPlug, 'task', 'both kinds held: the heir must qualify for each, and the refusal names the kind he fails');
  const self = await heirOf(reviewerDb, SHOP, REVIEWER, { total: 2, tasks: 0, plugs: ['client'] }, REVIEWER);
  assert.strictEqual(self.failedPlug, 'client', 'L13: the leaver is never his own heir');
  const { words } = require('../lib/actors-contract');
  const w = words.targetNotFor('task');
  assert.ok(/tasks/.test(JSON.stringify(w)) && /TARGET_ACTOR_NOT_ACTIVE/.test(JSON.stringify(w)), 'the refusal names the kind: ' + JSON.stringify(w));
  console.log('heir-of-plug: ok');
console.log(String(checks) + ' checks');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
