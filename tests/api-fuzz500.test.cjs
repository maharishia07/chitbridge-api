#!/usr/bin/env node
/**
 * api-fuzz500.test.cjs — the junk input the column-17 fuzz (tools/junk-fuzz.cjs) answered 500 or a bare 400 to, refused now at the route's own contract with a Problem and a registered code.
 *
 * OWNS      the proof, per route the fuzz named, that the SCHEMA CHECK of the route (the one its route file wires: its own refusal status and code) refuses the junk before any handler or
 *           database runs: a NUL byte or a 3000-character handle in a path, a 20 KB clearance field, an end date that is not a day, a rule order of 1.5, a pin that is not digits,
 *           a list of photos nested 200 deep, a text where the network's flag goes. And that the good request each route took before still goes through.
 * CALLED BY CI (tests/run-tests.js picks up *.test.cjs). No database, no network: the real app over a stand-in database, each route's own schema check found on it, behind a handler that answers 200.
 * FLOW      route key → its schema check (found on the loaded app) → stand-in handler (200) → status + Problem fields + code registered in docs/error-codes.json
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const path = require('path');
const express = require('express');
const loader = require('../tools/load-app.cjs');
const CODES = new Set(require('../docs/error-codes.json').codes.map((row) => row.code));

loader.stubDatabase(path.join(__dirname, '..'));
const loaded = loader.loadApp(path.join(__dirname, '..'));
/** the REAL schema check of each route, as its route file wires it (its own refusal status and code), found on the loaded app */
const CHECKS = {};
loader.leavesOf(loaded, true).forEach((leaf) => {
  const found = leaf.fns.find((fn) => fn && fn.schemaOperation);
  if (found) CHECKS[leaf.method + ' ' + leaf.path] = found;
});

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log((ok ? 'ok     ' : 'FAILED ') + what);
};
const nest = (depth) => Array.from({ length: depth }).reduce((value) => ({ a: value }), 'x');
const nestList = (depth) => Array.from({ length: depth }).reduce((value) => [value], 'x');

const BIG = 'B'.repeat(20000);
const ZERO_ID = '00000000-0000-4000-8000-000000000001';
const RULE = 'PATCH /api/folders/rules/:rule_id';
const RULE_URL = '/api/folders/rules/' + ZERO_ID;
const LOGIN = 'POST /api/actors/login';
const READINESS = 'GET /api/governance/readiness/:bridge_id';
const ACCEPTANCE = 'GET /api/governance/supplier-acceptance/:handle';
const COMPLIANCE = 'POST /api/governance/compliance';
const VERIFY = 'POST /api/governance/verify';
const ENTITY = 'POST /api/network/entities';
const PHOTO = 'POST /api/catalogue/photo-extract';

/** [what, route key, url, body, expected status (200 = let through)] */
const CASES = [
  ['governance readiness: a NUL in the handle', READINESS, '/api/governance/readiness/%00', undefined, 422],
  ['governance readiness: a 3000-character handle', READINESS, '/api/governance/readiness/' + 'x'.repeat(3000), undefined, 422],
  ['governance readiness: a real handle still passes', READINESS, '/api/governance/readiness/BRG-123', undefined, 200],
  ['supplier acceptance: a NUL in the handle', ACCEPTANCE, '/api/governance/supplier-acceptance/%00', undefined, 422],
  ['supplier acceptance: a real handle still passes', ACCEPTANCE, '/api/governance/supplier-acceptance/acme', undefined, 200],
  ['compliance: 20 KB in every field', COMPLIANCE, '/api/governance/compliance', { standard_key: BIG, doc_key: BIG, evidence_ref: BIG, valid_until: BIG, status: BIG }, 422],
  ['compliance: an end date that is not a day', COMPLIANCE, '/api/governance/compliance', { standard_key: 'gst-registration', doc_key: 'gstn', valid_until: "' OR 1=1--" }, 422],
  ['compliance: the web call still passes', COMPLIANCE, '/api/governance/compliance', { standard_key: 'gst-registration', doc_key: 'gstn', evidence_ref: 'recorded', valid_until: '2027-03-31', status: 'gathered' }, 200],
  ['compliance: an empty end date still passes', COMPLIANCE, '/api/governance/compliance', { standard_key: 'gst-registration', doc_key: 'gstn', valid_until: '' }, 200],
  ['verify: 20 KB in every field', VERIFY, '/api/governance/verify', { id_type: BIG, id_value: BIG, standard_key: BIG, doc_key: BIG, valid_until: BIG }, 422],
  ['verify: a script as the end date', VERIFY, '/api/governance/verify', { id_type: 'gstn', id_value: '27AAAAA0000A1Z5', valid_until: '<script>alert(1)</script>' }, 422],
  ['verify: the web call still passes', VERIFY, '/api/governance/verify', { standard_key: 'gst-registration', doc_key: 'gstn', id_type: 'gstn', id_value: '27AAAAA0000A1Z5', valid_until: '2028-01-01' }, 200],
  ['folder rule: a sort of 1.5', RULE, RULE_URL, { sort: 1.5 }, 400],
  ['folder rule: a sort past the column', RULE, RULE_URL, { sort: 1e12 }, 400],
  ['folder rule: a whole sort still passes', RULE, RULE_URL, { sort: 3 }, 200],
  ['actor login: nested 200 deep as the username', LOGIN, '/api/actors/login', { username: nest(200) }, 400],
  ['actor login: a pin that is not digits', LOGIN, '/api/actors/login', { username: 'till@shop', pin: "' OR 1=1--" }, 400],
  ['actor login: no username', LOGIN, '/api/actors/login', {}, 400],
  ['actor login: key and pin still pass', LOGIN, '/api/actors/login', { username: 'till@shop', pin: '1234' }, 200],
  ['network entity: text where the flag goes', ENTITY, '/api/network/entities', { name: 'Acme', claimed: BIG }, 400],
  ['network entity: a mode the column refuses', ENTITY, '/api/network/entities', { name: 'Acme', mode: 'b2z' }, 400],
  ['network entity: a plain registration still passes', ENTITY, '/api/network/entities', { name: 'Acme', mode: 'b2b', businessType: 'Business', ownerScope: 'entity', claimed: true }, 200],
  ['photo extract: a list nested 200 deep as the images', PHOTO, '/api/catalogue/photo-extract', { images: nestList(200) }, 400],
  ['photo extract: a photo that is a text', PHOTO, '/api/catalogue/photo-extract', { images: ['AAAA'] }, 400],
  ['photo extract: a photo whose bytes are a list', PHOTO, '/api/catalogue/photo-extract', { images: [{ mime: 'image/png', b64: [1, 2] }] }, 400],
  ['photo extract: a photo as the client sends it still passes', PHOTO, '/api/catalogue/photo-extract', { images: [{ mime: 'image/jpeg', b64: 'AAAA' }] }, 200]
];

async function main() {
  for (const [what, key, url, body, expected] of CASES) {
    const found = CHECKS[key];
    check(!!found, what + ' (the route has its schema check)');
    if (!found) continue;
    const [method, expressPath] = key.split(' ');
    const app = express();
    app.use(express.json());
    app[method.toLowerCase()](expressPath, found, (req, res) => res.json({ ok: true }));
    const server = require('http').createServer(app).listen(0);
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let answer = {};
      try {
        answer = JSON.parse(text);
      } catch (notJson) {
        answer = {};
      }
      if (expected === 200) check(res.status === 200, what + ' → 200 (got ' + res.status + ')');
      else check(res.status === expected && !!answer.title && answer.status === expected && CODES.has(answer.code), what + ' → ' + expected + ' Problem with a registered code (got ' + res.status + ' ' + answer.code + ')');
    } finally {
      server.close();
    }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
