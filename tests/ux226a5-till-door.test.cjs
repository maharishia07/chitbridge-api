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
const pass = { owner: true, accountant: false, counter: true, viewer: true };
matrix.SEATS.forEach((seat) => check(abilities.maySell(seat.req) === pass[seat.key], seat.key + ': maySell ' + pass[seat.key]));
check(abilities.maySell({ api_key: { jti: 'k' }, till: { key: { jti: 'k' } }, identity: { identity_type: 'entity' } }) === true, 'a till key passes the door');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'till.js'), 'utf8');
check(/router\.get\('\/snapshot', auth, sellsOnly,/.test(src), 'GET /snapshot is behind the sells door');
let status = 0, body = null;
const res = { status(c) { status = c; return this; }, type() { return this; }, set() { return this; }, setHeader() {}, json(b) { body = b; return this; }, send(b) { body = b; return this; }, end() {} };
require('../lib/till-contract').refuseNotTillSeat({ headers: {}, originalUrl: '/api/till/snapshot', id: 'r1', get() { return ''; } }, res);
check(status === 403 && JSON.stringify(body).includes('TILL_NOT_FOR_SEAT') && JSON.stringify(body).includes('does not ring sales'), 'the refusal is 403 with its code and its sentence');
console.log('\n  ' + (passed + failed) + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
