#!/usr/bin/env node
// @type: contract
/**
 * api-strict-input-status.test.cjs — PINS what an unknown body key answers, per route, on the real app (the cases of tools/api-contract-tests.cjs: stand-in database, real routes).
 *
 * OWNS      the refusal status of an unknown key on each route this sweep closed (PR #743): a route with the standard schema check answers 422; a route that keeps its old
 *           400 (`invalid: 400` + refusalFor, like lib/actors-contract.js) answers 400 with its old `details`; a route on the S13 outward list (keyed, POST /api/pricing/price)
 *           is NOT closed: an extra key such as `currency` is ignored as it always was, until its next major version (API-43).
 * CALLED BY scripts/guards.cjs · CI.
 * FLOW      real app → one request per case (valid body + one key the contract does not declare) → status · the refused field's name → expected
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-the-api-walk';
const cases = require(path.join(__dirname, '..', 'tools', 'api-contract-tests.cjs'));

const ADOPT_ID = '33333333-3333-4333-8333-333333333333';
const PRICED_LINE = { qty: 1, listPrice: 5, pricing: { kind: 'fixed', amount: 4 } };
/** [label, method, url, body, the status expected, whether the unknown key is named in the answer] */
const PINS = [
  ['POST /api/adopt/:chit_id answers the standard 422', 'POST', '/api/adopt/' + ADOPT_ID, { accept: [], zz_unknown_field: 1 }, 422, true],
  ['PUT /api/catalogue-face keeps its old 400', 'PUT', '/api/catalogue-face', { face: {}, zz_unknown_field: 1 }, 400, true],
  ['POST /api/pricing/price (S13 outward list, keyed) still ignores an extra key', 'POST', '/api/pricing/price', { lines: [PRICED_LINE], currency: 'INR' }, 200, false]
];
let failed = 0;
const lines = []; /* the served app mutes console while it runs: the lines print after */
const check = (label, ok, info) => {
  if (!ok) failed++;
  lines.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 300)));
};

/** one request to the served app as the shop: { status, body } */
function ask(port, token, [, method, url, body]) {
  const text = JSON.stringify(body);
  return new Promise((resolve) => {
    const sent = require('http').request({ host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), authorization: 'Bearer ' + token } }, (answer) => {
      let raw = '';
      answer.on('data', (part) => (raw += part));
      answer.on('end', () => resolve({ status: answer.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    sent.end(text);
  });
}

(async () => {
  const app = cases.appForCases(path.join(__dirname, '..'));
  const token = jwt.sign({ identity_id: cases.CALLER_SHOP, identity_type: 'entity', bridge_id: 'CB-CASE', display_name: 'Case shop' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  await cases.servedFor(app, async (port) => {
    for (const pin of PINS) {
      const seen = await ask(port, token, pin);
      const named = !!seen.body && Array.isArray(seen.body.errors) && seen.body.errors.some((entry) => entry.field === 'zz_unknown_field');
      check(pin[0] + ' (got ' + seen.status + ')', seen.status === pin[4] && named === pin[5], seen.body);
    }
  });
  lines.forEach((line) => console.log(line));
  console.log('\n  ' + PINS.length + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
