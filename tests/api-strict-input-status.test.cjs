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
const UUID_A = '44444444-4444-4444-8444-444444444444';
const PRICED_LINE = { qty: 1, listPrice: 5, pricing: { kind: 'fixed', amount: 4 } };
/** [label, method, url, body, the status expected, whether the unknown key is named in the answer, whose token: 'shop' (default) or 'customer' (a storefront shopper)] */
const PINS = [
  ['POST /api/adopt/:chit_id answers the standard 422', 'POST', '/api/adopt/' + ADOPT_ID, { accept: [], zz_unknown_field: 1 }, 422, true],
  ['PUT /api/catalogue-face keeps its old 400', 'PUT', '/api/catalogue-face', { face: {}, zz_unknown_field: 1 }, 400, true],
  ['POST /api/pricing/price (S13 outward list, keyed) still ignores an extra key', 'POST', '/api/pricing/price', { lines: [PRICED_LINE], currency: 'INR' }, 200, false],
  /* contract bulk pass, batch 1: each body is the valid one the callers send plus zz_unknown_field */
  ['POST /api/events/ticket (keyed, KEY_ROUTES: till, screen and connector scopes) still ignores an extra key', 'POST', '/api/events/ticket', { zz_unknown_field: 1 }, 200, false],
  ['POST /api/notifications/seen answers the standard 422', 'POST', '/api/notifications/seen', { zz_unknown_field: 1 }, 422, true],
  ['POST /api/notifications/dismiss answers the standard 422 (its 400 is the handler own)', 'POST', '/api/notifications/dismiss', { all: true, zz_unknown_field: 1 }, 422, true],
  ['POST /api/kyb/credential answers the standard 422', 'POST', '/api/kyb/credential', { title: 'Village NOC', zz_unknown_field: 1 }, 422, true],
  ['POST /api/kyb/field answers the standard 422', 'POST', '/api/kyb/field', { zz_unknown_field: 1 }, 422, true],
  ['POST /api/privacy/me/consent answers the standard 422 (a shopper token)', 'POST', '/api/privacy/me/consent', { channel: 'whatsapp', purpose: 'marketing', allowed: true, zz_unknown_field: 1 }, 422, true, 'customer'],
  ['POST /api/privacy/me/requests answers the standard 422 (a shopper token)', 'POST', '/api/privacy/me/requests', { kind: 'access', zz_unknown_field: 1 }, 422, true, 'customer'],
  ['POST /api/quick-keys/groups keeps its old 400', 'POST', '/api/quick-keys/groups', { name: 'Morning', zz_unknown_field: 1 }, 400, true],
  ['PATCH /api/quick-keys/groups/:id keeps its old 400', 'PATCH', '/api/quick-keys/groups/' + UUID_A, { name: 'Morning', zz_unknown_field: 1 }, 400, true],
  ['POST /api/quick-keys/groups/:id/items keeps its old 400', 'POST', '/api/quick-keys/groups/' + UUID_A + '/items', { product_id: UUID_A, position: 1, zz_unknown_field: 1 }, 400, true],
  ['PATCH /api/quick-keys/groups/:id/items keeps its old 400', 'PATCH', '/api/quick-keys/groups/' + UUID_A + '/items', { items: [], zz_unknown_field: 1 }, 400, true],
  ['PUT /api/quick-keys/screen-config/default keeps its old 400', 'PUT', '/api/quick-keys/screen-config/default', { config: {}, zz_unknown_field: 1 }, 400, true],
  ['POST /api/supplies answers the standard 422', 'POST', '/api/supplies', { name: 'Gloves', unit: 'box', keep_stock: true, zz_unknown_field: 1 }, 422, true],
  ['PATCH /api/supplies/:id answers the standard 422', 'PATCH', '/api/supplies/' + UUID_A, { name: 'Gloves', zz_unknown_field: 1 }, 422, true],
  ['POST /api/supplies/purchase answers the standard 422', 'POST', '/api/supplies/purchase', { ref: 'B-1', lines: [{ name: 'Gloves', qty: 1 }], zz_unknown_field: 1 }, 422, true],
  ['POST /api/supplies/:id/issue answers the standard 422', 'POST', '/api/supplies/' + UUID_A + '/issue', { qty: 1, zz_unknown_field: 1 }, 422, true]
];
let failed = 0;
const lines = []; /* the served app mutes console while it runs: the lines print after */
const check = (label, ok, info) => {
  if (!ok) failed++;
  lines.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 300)));
};

/** one request to the served app as the shop: { status, body } */
function ask(port, token, [, method, url, body]) {
  /* the token is the caller's: a shop's, or a shopper's for the routes only a shopper may call */
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
  const shopper = jwt.sign({ identity_id: cases.CALLER_SHOP, identity_type: 'customer', bridge_id: 'CB-CASE', parent_entity_id: cases.CALLER_SHOP, display_name: 'Case shopper' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  await cases.servedFor(app, async (port) => {
    for (const pin of PINS) {
      const seen = await ask(port, pin[6] === 'customer' ? shopper : token, pin);
      const named = !!seen.body && Array.isArray(seen.body.errors) && seen.body.errors.some((entry) => entry.field === 'zz_unknown_field');
      check(pin[0] + ' (got ' + seen.status + ')', seen.status === pin[4] && named === pin[5], seen.body);
    }
  });
  lines.forEach((line) => console.log(line));
  console.log('\n  ' + PINS.length + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
