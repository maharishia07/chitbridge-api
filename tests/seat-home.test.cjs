#!/usr/bin/env node
/**
 * seat-home.test.cjs — UX-221 guard: what GET /me tells Home to hide (lib/seat-abilities seatOf) must agree with the gates (Athi 27 Nov: one source; the menu hides by the SAME answers the routes give).
 *
 * OWNS      for the owner, accountant, counter and viewer seats of tools/seat-matrix.cjs: seat.money = the books' moneyReader gate answer; seat.owner = the owner gate; the Counter staff seat leads with the till and draws only its own entries.
 * CALLED BY scripts/guards-list-1.cjs
 * FLOW      seat-matrix SEATS → seatOf(req) → compared with matrix.cellOf(gate chain, req)
 * CARD      17-people-employees-hr-and-payroll/people-list-with-may-why
 *
 *   node tests/seat-home.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const abilities = require('../lib/seat-abilities');
const matrix = require('../tools/seat-matrix.cjs');
let failed = 0, passed = 0;
const check = (ok, text) => { if (ok) passed++; else { failed++; console.log('  FAIL ' + text); } };
matrix.SEATS.forEach((seat) => {
  const said = abilities.seatOf(seat.req);
  check(said.money === (matrix.cellOf(['moneyReader'], seat.req) === true), seat.key + ': seat.money differs from the moneyReader gate');
  check(said.sells === (matrix.cellOf(['tillSeller'], seat.req) === true), seat.key + ': seat.sells differs from the till door');
  check(said.owner === (matrix.cellOf(['owner'], seat.req) === true), seat.key + ': seat.owner differs from the owner gate');
});
const counter = abilities.seatOf(matrix.SEATS.find((s) => s.key === 'counter').req);
check(counter.lead === 'till' && counter.entries.includes('till') && counter.entries[0] === counter.lead, 'Counter staff lead with the till and draw it');
check(!counter.entries.includes('accounts') && !counter.entries.includes('bank'), 'Counter staff are not shown the books');
check(abilities.seatOf(matrix.SEATS.find((s) => s.key === 'accountant').req).sells === false, 'the Bookkeeper seat is not given the till (UX-226 A5)');
check(abilities.seatOf(matrix.SEATS.find((s) => s.key === 'owner').req).sells && counter.sells, 'owner and Counter staff sell');
['owner', 'accountant', 'viewer'].forEach((key) => check(abilities.seatOf(matrix.SEATS.find((s) => s.key === key).req).entries === null, key + ': no entry list (every entry the owner and money flags leave)'));
console.log('\n  ' + (passed + failed) + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
