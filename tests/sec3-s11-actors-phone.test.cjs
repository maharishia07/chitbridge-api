#!/usr/bin/env node
/**
 * sec3-s11-actors-phone.test.cjs — S11 (VERIFY-EL-SECURITY): GET /api/actors gave every signed-in colleague every colleague's mobile number and connector config.
 * ATTACK    a view-only (or act-hat) staff login lists the shop's people and copies every colleague's phone; a connector actor's config (where it runs) rides along.
 * RULE      phone and connector_config of OTHER people are answered only to the owner and a manager hat; anyone else sees only their own phone.
 * RUN       node tests/sec3-s11-actors-phone.test.cjs        STANDARD  OWASP API3:2023 (broken object property level authorization) · ASVS 4.0.3 V4.2 / V8.3
 * CARD      17-people-employees-hr-and-payroll/add-edit-switch-off-a-person
 */
'use strict';
const path = require('path');
const { harness, OWNER, STAFF } = require('./lib/problem-world.cjs');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const SELF = STAFF.identity_id, OTHER = '2222bbbb-2222-4222-8222-222222222222', CONN = '3333cccc-3333-4333-8333-333333333333';
const row = (id, extra) => Object.assign({ identity_id: id, bridge_id: 'B' + id, display_name: 'N' + id, actor_key: 'k' + id, actor_type: 'human', hat: 'act', break_status: 'active', max_tasks: 0, current_task_count: 0, phone: '+9198' + id.slice(0, 6), connector_config: null }, extra || {});
const lab = harness({ here: HERE, mounts: ['/api/actors'], routeFiles: { '/api/actors': 'routes/actors.js' } });
const { check } = lab;
const model = (sql) => {
  if (/GROUP BY break_status/.test(sql)) return { rows: [{ break_status: 'active', count: '3' }], rowCount: 1 };
  if (/FROM identities/.test(sql) && /connector_config/.test(sql)) return { rows: [row(SELF), row(OTHER), row(CONN, { actor_type: 'connector', connector_type: 'tally', connector_config: { host: 'pc-7.internal' } })], rowCount: 3 };
  return null;
};
async function main() {
  lab.installStubs();
  const actors = require(path.join(HERE, 'routes', 'actors.js'));
  const server = lab.appOf([{ mount: '/api/actors', router: actors }]).listen(0);
  const port = server.address().port;
  const by = async (who) => { Object.assign(lab.world, { who, sqlRows: model, db: 'ok' }); const g = await lab.send(port, 'GET', '/api/actors'); return g.json && g.json.actors ? g.json.actors : g; };
  let list = await by(Object.assign({}, STAFF, { hat: 'act' }));
  const mine = list.find((a) => a.identity_id === SELF), theirs = list.find((a) => a.identity_id === OTHER), conn = list.find((a) => a.identity_id === CONN);
  check('a staff login on the act hat: a colleague\'s phone is not in the answer', !!theirs && !theirs.phone, JSON.stringify(theirs));
  check('...nor the connector\'s config', !!conn && !conn.connector_config, JSON.stringify(conn));
  check('...but their own phone is', !!mine && !!mine.phone, JSON.stringify(mine));
  list = await by(Object.assign({}, STAFF, { hat: 'manager' }));
  check('a manager hat reads the phones and the connector config', !!list.find((a) => a.identity_id === OTHER).phone && !!list.find((a) => a.identity_id === CONN).connector_config);
  list = await by(OWNER);
  check('the owner reads the phones and the connector config', !!list.find((a) => a.identity_id === OTHER).phone && !!list.find((a) => a.identity_id === CONN).connector_config);
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}
main().catch((e) => { console.log('crashed:', e); process.exit(1); });
