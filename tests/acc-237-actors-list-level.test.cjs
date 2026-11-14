#!/usr/bin/env node
/**
 * acc-237-actors-list-level.test.cjs — ACC-237: GET /api/actors lists each person's access_level and whole_entity (a viewer auditor login shows as read-only).
 *
 * OWNS      the offline proof: with the columns, a viewer and an editor come back with the level and reach as stored; the SELECT names them. Without the columns (before b173)
 *           the list still answers 200 and does not ask for them (lib/schema hasColumn guard).
 * CALLED BY scripts/guards.cjs.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/actors.js over http → read the list as the owner
 * CARD      17-people-employees-hr-and-payroll/functions
 *
 *   node tests/acc-237-actors-list-level.test.cjs
 */
'use strict';
const path = require('path');
const { harness, OWNER } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const row = (id, extra) => Object.assign({ identity_id: id, bridge_id: 'B' + id, display_name: 'N' + id, actor_key: 'k' + id, actor_type: 'human', hat: 'act', break_status: 'active', max_tasks: 0, current_task_count: 0, pin_state: 'none', connector_config: {} }, extra);
const lab = harness({ here: HERE, mounts: ['/api/actors'], routeFiles: { '/api/actors': 'routes/actors.js' } });
const { check } = lab;

let columns = true;
let listSql = '';
let probes = 0;
const model = (sql) => {
  if (/information_schema\.columns/.test(sql)) probes++;
  if (/information_schema\.columns/.test(sql)) return { rows: columns ? [{ '?column?': 1 }] : [], rowCount: columns ? 1 : 0 };
  if (/GROUP BY break_status/.test(sql)) return { rows: [{ break_status: 'active', count: '2' }], rowCount: 1 };
  if (/FROM identities/.test(sql) && /connector_config/.test(sql)) {
    listSql = sql;
    const rows = columns ? [row('1111aaaa-1111-4111-8111-111111111111', { access_level: 'viewer', whole_entity: true }), row('2222bbbb-2222-4222-8222-222222222222', { access_level: 'editor', whole_entity: false }), row('3333cccc-3333-4333-8333-333333333333', { access_level: 'commenter', whole_entity: true, can_see_costs: true })] : [row('1111aaaa-1111-4111-8111-111111111111')];
    return { rows, rowCount: rows.length };
  }
  return null;
};

async function main() {
  lab.installStubs();
  const schema = require(path.join(HERE, 'lib', 'schema'));
  const actors = require(path.join(HERE, 'routes', 'actors.js'));
  const server = lab.appOf([{ mount: '/api/actors', router: actors }]).listen(0);
  const port = server.address().port;
  Object.assign(lab.world, { who: OWNER, sqlRows: model, db: 'ok' });

  let got = await lab.send(port, 'GET', '/api/actors');
  check('with the columns: 200 (it answered ' + got.status + ')', got.status === 200 && got.json && got.json.actors.length === 3, got.text.slice(0, 200));
  check('the SELECT names access_level and whole_entity off the row JSON, with no schema probe round trip (round-trips budget 2)', /->> 'access_level'\) AS access_level, \(to_jsonb\(identities\) -> 'whole_entity'\) AS whole_entity/.test(listSql) && probes === 0, 'probes ' + probes + ' ' + listSql.slice(0, 200));
  check('a viewer login lists access_level=viewer and whole_entity=true as stored', got.json.actors[0].access_level === 'viewer' && got.json.actors[0].whole_entity === true, JSON.stringify(got.json.actors[0]));
  check('an editor lists editor / false', got.json.actors[1].access_level === 'editor' && got.json.actors[1].whole_entity === false, JSON.stringify(got.json.actors[1]));

  check('an auditor login (hat act, commenter, whole entity, sees costs) lists preset auditor and its level', got.json.actors[2].preset === 'auditor' && got.json.actors[2].access_level === 'commenter', JSON.stringify(got.json.actors[2]));
  check('the other logins read the way the access screen does: a whole-entity viewer without cost sight matches no preset (null); a plain editor is the counter preset; level as stored', got.json.actors[0].preset === null && got.json.actors[1].preset === 'counter' && got.json.actors[1].access_level === 'editor', JSON.stringify(got.json.actors.slice(0, 2)));
  check('the SELECT names can_see_costs (the preset needs it)', /hat, can_see_costs,/.test(listSql), listSql.slice(0, 200));

  columns = false;
  schema._reset();
  got = await lab.send(port, 'GET', '/api/actors');
  check('without the columns (pre-b173): still 200 (it answered ' + got.status + ')', got.status === 200 && got.json.actors.length === 1, got.text.slice(0, 200));
  check('without the columns (a database the row JSON has no such key in): the same SELECT, still no probe, and the row carries no level', probes === 0 && !got.json.actors[0].access_level, listSql.slice(0, 200));
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('acc-237-actors-list-level crashed:', failure);
  process.exit(1);
});
