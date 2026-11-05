#!/usr/bin/env node
/**
 * sec92-readiness-passport.test.cjs — SEC-92: GET /api/governance/readiness/:bridge_id shows a shop's passport only to its owner and to a shop that lists it as a party.
 *
 * OWNS      the offline proof: shop B, with no customer or supplier row for shop A, asks for A's bridge id and gets the SAME 404 (status and body, request id aside) as for an unknown id,
 *           and nothing of A (user id, name, country, tax facts, standards) is in it. A shop that lists A as a supplier still reads the passport; A reads its own.
 * CALLED BY scripts/guards.cjs. The real T2 twin is the S41 suite (tests/isolation-s41.test.cjs), whose expected list no longer holds this route.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/governance.js over http → ask as B (stranger), B (supplier listed), A (owner), B (unknown id)
 * CARD      21-compliance-attestation-and-trade/trade-readiness-lanes-instruments-journey-track
 *
 *   node tests/sec92-readiness-passport.test.cjs
 */
'use strict';
const path = require('path');
const { harness, SHOP } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP_A = SHOP;
const SHOP_B = '66666666-6666-4666-8666-666666666666';
const WHO_A = { identity_id: SHOP_A, identity_type: 'entity', display_name: 'Shop A' };
const WHO_B = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Shop B' };
const A_ROW = { identity_id: SHOP_A, display_name: 'Alpha Traders', bridge_id: 'BRG-ALPHA', user_id: 'alphauser77', gstn: '27AAAAA0000A1Z5', country: 'IN', policy_flags: null };

const lab = harness({ here: HERE, mounts: ['/api/governance'], routeFiles: { '/api/governance': 'routes/governance.js' } });
const { check } = lab;

/** the database: shop A exists under its bridge id; B lists A as a supplier only when `listed` is true; row security is not modelled (the route must ask) */
const model = (listed) => (sql, params) => {
  if (/FROM identities/.test(sql)) return /BRG-ALPHA|alphauser77/i.test(String(params[0])) ? { rows: [A_ROW], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/FROM customer_list/.test(sql)) return { rows: [{ customer: false, supplier: listed && params[0] === SHOP_B && params[1] === SHOP_A }], rowCount: 1 };
  return null;
};
const comparable = (answer) => JSON.stringify({ status: answer.status, body: answer.json ? Object.assign({}, answer.json, { request_id: null }) : answer.text });

async function ask(port, who, listed, handle) {
  Object.assign(lab.world, { who, sqlRows: model(listed), db: 'ok' });
  return lab.send(port, 'GET', '/api/governance/readiness/' + handle);
}

async function main() {
  lab.installStubs();
  require(path.join(HERE, 'lib', 'readiness')).resolveReadiness = async () => ({ standards: [{ standard_key: 'gst' }], clearances: [{ standard_key: 'gst', evidence_ref: 'SECRET-REF' }], summary: { met: 1 } });
  const governance = require(path.join(HERE, 'routes', 'governance.js'));
  const server = lab.appOf([{ mount: '/api/governance', router: governance }]).listen(0);
  const port = server.address().port;

  const stranger = await ask(port, WHO_B, false, 'BRG-ALPHA');
  const unknown = await ask(port, WHO_B, false, 'BRG-NOBODY');
  check('stranger B for A\'s bridge id: 404 (it answered ' + stranger.status + ')', stranger.status === 404, stranger.text.slice(0, 200));
  check('stranger B: byte for byte the answer of an unknown id, request id aside', comparable(stranger) === comparable(unknown), [stranger.text.slice(0, 160), unknown.text.slice(0, 160)]);
  check('stranger B: nothing of A in the body (name, user id, tax id, standards)', !/Alpha|alphauser77|27AAAAA|SECRET-REF|standard_key/.test(stranger.text), stranger.text.slice(0, 200));
  const byUserId = await ask(port, WHO_B, false, 'alphauser77');
  check('stranger B using A\'s user id: the same 404', byUserId.status === 404, byUserId.text.slice(0, 200));
  const listedB = await ask(port, WHO_B, true, 'BRG-ALPHA');
  check('B that lists A as a supplier: 200 with A\'s passport (it answered ' + listedB.status + ')', listedB.status === 200 && listedB.json && listedB.json.supplier.bridge_id === 'BRG-ALPHA', listedB.text.slice(0, 200));
  check('B listed: the registry value stays with its owner (evidence_ref null)', listedB.json && listedB.json.clearances[0].evidence_ref === null, listedB.text.slice(0, 200));
  const owner = await ask(port, WHO_A, false, 'BRG-ALPHA');
  check('owner A reads its own passport (200) with its evidence_ref', owner.status === 200 && owner.json.clearances[0].evidence_ref === 'SECRET-REF', owner.text.slice(0, 200));
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec92-readiness-passport crashed:', failure);
  process.exit(1);
});
