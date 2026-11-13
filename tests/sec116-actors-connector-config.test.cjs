#!/usr/bin/env node
/**
 * sec116-actors-connector-config.test.cjs — SEC-116: GET /api/actors shows a colleague only the safe keys of a connector's connector_config.
 *
 * OWNS      the offline proof: a connector actor whose config holds auth_ref, a typed password, key_jti and enrol, listed by a colleague (staff) and by the owner, comes back with
 *           the shown keys only (adapter, version, host, kit, kit_id, counters, mode, base_url, auth_type); a person's row and a non-object config are unharmed.
 * CALLED BY scripts/guards.cjs.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/actors.js over http → read the list as a colleague and as the owner → scan the body for the secrets
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/sec116-actors-connector-config.test.cjs
 */
'use strict';
const path = require('path');
const { harness, OWNER, STAFF } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SECRETS = ['tok-SECRET-123', 'hunter2-PASSWORD', 'jti-SECRET-9', 'enrol-SECRET'];
const CONFIG = { adapter: 'tally', version: '1.4', host: 'BACKOFFICE', kit: true, kit_id: 'kit-1', counters: { pushed: 3 }, base_url: 'https://erp.example.com', auth_type: 'token', auth_ref: SECRETS[0], password: SECRETS[1], key_jti: SECRETS[2], enrol: { host: SECRETS[3] } };
const row = (id, type, config) => ({ identity_id: id, bridge_id: 'B' + id, display_name: 'N' + id, actor_key: 'k' + id, actor_role: null, actor_type: type, hat: 'act', break_status: 'active', max_tasks: 0, current_task_count: 0, pin_state: 'none', site: 'Back office', last_seen: null, connector_type: type === 'connector' ? 'erp' : null, connector_config: config });
const ROWS = [row('1111aaaa-1111-4111-8111-111111111111', 'connector', CONFIG), row('2222bbbb-2222-4222-8222-222222222222', 'human', {}), row('3333cccc-3333-4333-8333-333333333333', 'connector', 'not-an-object')];

const lab = harness({ here: HERE, mounts: ['/api/actors'], routeFiles: { '/api/actors': 'routes/actors.js' } });
const { check } = lab;

const model = (sql) => (/GROUP BY break_status/.test(sql) ? { rows: [{ break_status: 'active', count: '3' }], rowCount: 1 } : /connector_config/.test(sql) ? { rows: ROWS.map((one) => Object.assign({}, one)), rowCount: ROWS.length } : null);

async function list(port, who) {
  Object.assign(lab.world, { who, sqlRows: model, db: 'ok' });
  return lab.send(port, 'GET', '/api/actors');
}

async function main() {
  lab.installStubs();
  const actors = require(path.join(HERE, 'routes', 'actors.js'));
  const server = lab.appOf([{ mount: '/api/actors', router: actors }]).listen(0);
  const port = server.address().port;
  for (const [label, who] of [['colleague (staff)', STAFF], ['owner', OWNER]]) {
    const got = await list(port, who);
    check(label + ': 200 (it answered ' + got.status + ')', got.status === 200 && got.json && got.json.actors.length === 3, got.text.slice(0, 200));
    check(label + ': no auth_ref, password, key_jti or enrol anywhere in the body', SECRETS.every((secret) => !got.text.includes(secret)), got.text.slice(0, 300));
    const shown = got.json.actors[0].connector_config;
    check(label + ': the shown keys stay (adapter, version, host, kit_id, counters, base_url, auth_type)', shown.adapter === 'tally' && shown.version === '1.4' && shown.host === 'BACKOFFICE' && shown.kit_id === 'kit-1' && shown.counters.pushed === 3 && shown.base_url === 'https://erp.example.com' && shown.auth_type === 'token', JSON.stringify(shown));
    check(label + ': only the shown keys are there', Object.keys(shown).sort().join() === 'adapter,auth_type,base_url,counters,host,kit,kit_id,version', Object.keys(shown).join());
    check(label + ': a person keeps an empty config, a config that is no object is null', JSON.stringify(got.json.actors[1].connector_config) === '{}' && got.json.actors[2].connector_config === null, JSON.stringify([got.json.actors[1].connector_config, got.json.actors[2].connector_config]));
  }
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec116-actors-connector-config crashed:', failure);
  process.exit(1);
});
