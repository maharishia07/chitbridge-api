#!/usr/bin/env node
/**
 * ux226a5-till-door.test.cjs — UX-226 A5 guard: the till's snapshot door refuses the Bookkeeper seat (403 TILL_NOT_FOR_SEAT, problem+json) so no counter is minted for it; owner, Counter staff and a till key pass.
 *
 * OWNS      the door middleware of GET /snapshot (routes/till.js sellsOnly) read through lib/seat-abilities maySell and the seat matrix
 * CALLED BY scripts/guards-list-1.cjs
 * FLOW      seat-matrix SEATS → maySell → the 403 words of lib/till-contract
 * CARD      09-counter/README
 *
 *   node tests/ux226a5-till-door.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const abilities = require('../lib/seat-abilities');
const matrix = require('../tools/seat-matrix.cjs');
const fs = require('fs');
let failed = 0, passed = 0;
const check = (ok, text) => { if (ok) passed++; else { failed++; console.log('  FAIL ' + text); } };
const who = (hat, level, extra) => ({ api_key: null, identity: Object.assign({ identity_type: 'actor', parent_entity_id: 'shop', hat, access_level: level }, extra || {}) });
const cases = [
  ['owner', { api_key: null, identity: { identity_type: 'entity' } }, true],
  ['counter staff', who('act', 'editor'), true],
  ['a manager who sells (not the Bookkeeper grant)', who('manager', 'editor'), true],
  ['a manager with whole-shop reach but no cost sight', who('manager', 'editor', { whole_entity: true }), true],
  ['the Bookkeeper (manager hat, editor, whole shop, costs)', who('manager', 'editor', { whole_entity: true, can_see_costs: true }), false],
  ['an outside firm under a grant', who('manager', 'editor', { whole_entity: true, can_see_costs: true, acting_for_grant: true }), false],
  ['view-only staff', who('view_only', 'viewer'), false]
];
cases.forEach(([name, req, want]) => check(abilities.maySell(req) === want, name + ': sells ' + want));
check(abilities.maySell({ api_key: { jti: 'k' }, till: { key: { jti: 'k' } }, identity: { identity_type: 'entity' } }) === true, 'a till key passes the door');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'till.js'), 'utf8');
check(/router\.get\('\/snapshot', auth, sellsOnly,/.test(src), 'GET /snapshot is behind the sells door');
let status = 0, body = null;
const res = { status(c) { status = c; return this; }, type() { return this; }, set() { return this; }, setHeader() {}, json(b) { body = b; return this; }, send(b) { body = b; return this; }, end() {} };
require('../lib/till-contract').refuseNotTillSeat({ headers: {}, originalUrl: '/api/till/snapshot', id: 'r1', get() { return ''; } }, res);
check(status === 403 && JSON.stringify(body).includes('TILL_NOT_FOR_SEAT') && JSON.stringify(body).includes('does not ring sales'), 'the refusal is 403 with its code and its sentence');
console.log('\n  ' + (passed + failed) + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
