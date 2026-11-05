#!/usr/bin/env node
/**
 * sec118-employee-code.test.cjs — SEC-118: what the 4 actors routes that call lib/employee-code may put in their 200 answer.
 *
 * OWNS      (1) show_code is the R112 owner-only reveal: a non-owner (staff, manager hat, API key) is refused 403 on all 4 routes and never receives show_code, otp or dev_otp;
 *           (2) with a sealed env (production, uat, staging, live, prod, any case or padding) otp and dev_otp are impossible, even with DEV_OTP and DEV_OTP_IN_RESPONSE set and a localhost database;
 *           (3) deliver() never answers a key outside DELIVERED_KEYS, and the shapes in docs/contracts/api-output-shapes.json name show_code with its reason.
 * CALLED BY scripts/guards.cjs.
 * FLOW      lib/dev-otp (real) + lib/employee-code.deliver (real, stub sender) · routes/actors.js over http through tests/lib/problem-world.cjs for the refusals
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/sec118-employee-code.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { harness, OWNER, STAFF } = require('./lib/problem-world.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const lab = harness({ here: HERE, mounts: ['/api/actors'], routeFiles: { '/api/actors': 'routes/actors.js' } });
const { check } = lab;
const ID = '11111111-1111-4111-8111-111111111111';
const FOUR = [
  ['POST', '/api/actors', { display_name: 'Ravi K' }],
  ['POST', '/api/actors/' + ID + '/otp', {}],
  ['DELETE', '/api/actors/' + ID + '/pin', {}],
  ['PUT', '/api/actors/' + ID + '/status', { action: 'reactivate' }]
];
const SECRET = /show_code|dev_otp|"otp"/;
const LOCAL = { DEV_OTP: '1', DEV_OTP_IN_RESPONSE: 'true', DATABASE_URL: 'postgres://u:p@localhost:5432/x' };

async function gateChecks(devOtp, empCode) {
  const saved = Object.assign({}, process.env);
  const restore = () => {
    Object.keys(process.env).forEach((key) => !(key in saved) && delete process.env[key]);
    Object.assign(process.env, saved);
  };
  const set = (extra) => Object.assign(process.env, LOCAL, extra);
  const answer = () => empCode.deliver({ to: '', name: 'Ravi', otp: '482910', show: true, expires: new Date() });

  set({ NODE_ENV: 'development' });
  const dev = await answer();
  check('control: on a local stack (development, localhost, DEV_OTP, DEV_OTP_IN_RESPONSE) the opt-in works', devOtp.mayExposeOtp() === true && dev.otp === '482910');
  for (const env of ['production', ' Production ', 'PRODUCTION', 'uat', 'staging', 'live', 'prod']) {
    set({ NODE_ENV: env });
    const got = await answer();
    check('NODE_ENV=' + JSON.stringify(env) + ' with DEV_OTP and DEV_OTP_IN_RESPONSE set and a localhost database: no otp in the answer', devOtp.mayExposeOtp() === false && !('otp' in got) && !('dev_otp' in got), got);
  }
  set({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.railway.internal:5432/x' });
  check('production and a remote database: closed', devOtp.mayExposeOtp() === false);
  set({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' });
  check('development against a remote database: closed', devOtp.mayExposeOtp() === false);
  set({ NODE_ENV: '' });
  check('NODE_ENV unset: closed', devOtp.mayExposeOtp() === false);
  set({ NODE_ENV: 'development', DEV_OTP_IN_RESPONSE: '' });
  check('development, armed, echo not asked for: closed', devOtp.mayExposeOtp() === false);
  set({ NODE_ENV: 'development', DEV_OTP: '' });
  check('development, echo asked for but DEV_OTP not armed: closed', devOtp.mayExposeOtp() === false);

  /* deliver never exceeds its list, and every listed key is reachable */
  set({ NODE_ENV: 'development', DEV_OTP: '1', DEV_OTP_IN_RESPONSE: 'true' });
  const seen = new Set();
  const cases = [{ to: '', show: true }, { to: 'a@b.co', send: async () => ({ delivered: true }) }, { to: 'a@b.co', send: async () => ({ delivered: false }) }];
  for (const one of cases) Object.keys(await empCode.deliver(Object.assign({ name: 'R', otp: '482910', expires: new Date() }, one))).forEach((key) => seen.add(key));
  check('deliver() answers only keys of DELIVERED_KEYS (' + [...seen].join(', ') + ')', [...seen].every((key) => empCode.DELIVERED_KEYS.includes(key)), [...seen]);
  check('every DELIVERED_KEY was reached by a case (no dead key)', empCode.DELIVERED_KEYS.every((key) => seen.has(key)), empCode.DELIVERED_KEYS.filter((key) => !seen.has(key)));
  const noShow = await empCode.deliver({ to: '', name: 'R', otp: '482910', expires: new Date() });
  check('without show:true (a reactivate) there is never a show_code', !('show_code' in noShow));
  restore();
}

async function refusalChecks() {
  const actors = require(path.join(HERE, 'routes', 'actors.js'));
  const server = lab.appOf([{ mount: '/api/actors', router: actors }]).listen(0);
  const port = server.address().port;
  const callers = { staff: STAFF, 'manager hat': Object.assign({}, STAFF, { hat: 'manager', access_level: 'editor' }), 'api key': OWNER };
  for (const [who, identity] of Object.entries(callers)) {
    for (const [method, url, body] of FOUR) {
      Object.assign(lab.world, { who: identity, db: 'ok', sqlRows: () => null, asKey: identity === OWNER && who === 'api key' });
      const got = await lab.send(port, method, url, body);
      check(who + ' ' + method + ' ' + url + ': 403 and no code in the answer', got.status === 403 && !SECRET.test(got.text || ''), got.status);
    }
  }
  server.close();
}

function shapeChecks() {
  const shapes = JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'contracts', 'api-output-shapes.json'), 'utf8'));
  ['POST /api/actors', 'POST /api/actors/:id/otp', 'DELETE /api/actors/:id/pin'].forEach((route) => {
    const props = ((shapes.routes[route] || {}).schema || {}).properties || {};
    check(route + ': closed shape, show_code named with its owner-only reason', (shapes.routes[route].schema || {}).additionalProperties === false && /owner/.test((props.show_code || {}).description || ''));
    check(route + ': otp and dev_otp named with the local-stack reason', /local stack/.test((props.otp || {}).description || '') && /local stack/.test((props.dev_otp || {}).description || ''));
  });
  const status = ((shapes.routes['PUT /api/actors/:id/status'] || {}).schema || {}).properties || {};
  check('PUT /:id/status: shape does not list show_code (a reactivate never shows one), so the filter cuts it if it ever appears', Object.keys(status).length > 0 && !('show_code' in status));
  check('DELETE /:id/pin is no longer left open on purpose', !('DELETE /api/actors/:id/pin' in shapes.listed));
}

async function main() {
  lab.installStubs();
  await gateChecks(require(path.join(HERE, 'lib', 'dev-otp.js')), require(path.join(HERE, 'lib', 'employee-code.js')));
  await refusalChecks();
  shapeChecks();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec118-employee-code crashed:', failure);
  process.exit(1);
});
