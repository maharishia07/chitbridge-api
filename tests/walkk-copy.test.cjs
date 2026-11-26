#!/usr/bin/env node
'use strict';
/**
 * walkk-copy.test.cjs — WALK K K-F-04 / K-F-05 (21 Nov 2026), two words that named the wrong thing:
 *   K-F-04  an ADVISER refused a part of the books read a title "Not open to an auditor": the title belongs to the code (RFC 9457), and the code is shared by both roles, so it is neutral now; the sentence (detail) kept the role until W4-03 (ab6952732) made it "not part of this access" for both.
 *   K-F-05  a view-only seat's refusal sent the owner to "Co-assists"; the screen is called Employees.
 * Run: node tests/walkk-copy.test.cjs · no DB.
 */
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n      ' + info : '')); } };
const { titleOf } = require(path.join(API, 'lib', 'problem'));
ok('the title of GRANT_ROUTE_NOT_LISTED names no role', !/auditor|adviser/i.test(titleOf('GRANT_ROUTE_NOT_LISTED')), titleOf('GRANT_ROUTE_NOT_LISTED'));
const grant = require(path.join(API, 'lib', 'books-grant'));
/* W4-03 (ab6952732, w4bank-1130.test.cjs): a refused route is worded "not part of this access" for an adviser and an auditor alike, so the sentence names no role (it named the role before: 'not open to an adviser') */
const words = (sentence) => fs.readFileSync(path.join(API, 'lib', 'books-grant.js'), 'utf8').includes("'" + sentence + "'");
ok('the refusal sentence is the one W4-03 decided: not part of this access, naming no role', words('This is not part of this access.') && !words('This part of the books is not open to an adviser.') && !words('This part of the books is not open to an auditor.'));
ok('the ERROR-CODES.md row carries the same title as the register', /GRANT_ROUTE_NOT_LISTED \| 403 \| Not open to this access \|/.test(fs.readFileSync(path.join(API, 'docs', 'ERROR-CODES.md'), 'utf8')));
const gate = fs.readFileSync(path.join(API, 'middleware', 'hat-gate.js'), 'utf8');
ok('the view-only refusal sends the owner to Employees, not Co-assists', /can change this in Employees\./.test(gate) && !/can change this in Co-assists/.test(gate));
console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
