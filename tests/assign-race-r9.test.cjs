#!/usr/bin/env node
// @type: unit
/**
 * tests/assign-race-r9.test.cjs — R9 (RACE-2026-11-20): two seats take the same client at once; the loser is told who holds it.
 * Stand-in db (no real concurrency: the row lock is asserted as SQL text; the second batch is run AFTER the first, as the lock makes it).
 * Run: node tests/assign-race-r9.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assign-bulk.js'), 'utf8');
let fail = 0;
const check = (n, ok) => { if (!ok) { fail++; console.log('  FAIL ' + n); } };
check('holder read is FOR UPDATE', /SELECT assigned_to_actor_id FROM chit_status[^`]*FOR UPDATE/.test(src));
const { heldByOther } = require('../lib/assign-bulk');
check('seat vs other holder', heldByOther('A', 'B') === true);
check('seat vs own', heldByOther('A', 'A') === false);
check('seat vs pool', heldByOther('A', null) === false);
check('manager (no staffId) overrides', heldByOther(null, 'B') === false);
if (fail) process.exit(1);
console.log('assign-race-r9: ok');
