#!/usr/bin/env node
/** tests/fresh-db-check.test.cjs — the fresh-database verdict: a new failure fails, an accepted file that passes must leave the list. Offline. */
'use strict';
const assert = require('assert');
const { judge, fileOf } = require('../tools/fresh-db-check.cjs');
const accepted = require('../migrations/fresh-db.accepted.json');
let checks = 0;
const it = (what, fn) => { fn(); checks++; console.log('  ok  ' + what); };

it('the file name is read from the front of a failure line', () => assert.strictEqual(fileOf('b185_x.sql — ERROR: boom'), 'b185_x.sql'));
it('nothing failed and nothing accepted → clean', () => assert.deepStrictEqual(judge([], []), { newlyFailing: [], nowPassing: [] }));
it('a file that fails and is not accepted is a new failure', () => assert.deepStrictEqual(judge(['b9_x.sql — ERROR'], []).newlyFailing, ['b9_x.sql']));
it('an accepted file that now passes must be taken off the list', () => assert.deepStrictEqual(judge([], ['b9_x.sql']).nowPassing, ['b9_x.sql']));
it('an accepted file that still fails is allowed', () => assert.deepStrictEqual(judge(['b9_x.sql — E'], ['b9_x.sql']), { newlyFailing: [], nowPassing: [] }));
it('the accepted list is the SCHEMA-FIX1 empty one (it only shrinks)', () => assert.deepStrictEqual(accepted.accepted, []));
console.log('\n  ' + checks + ' checks');
