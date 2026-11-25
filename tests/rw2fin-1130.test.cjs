#!/usr/bin/env node
/**
 * rw2fin-1130.test.cjs - RE-WALK 2 (26 Nov), RW2-03: ONE answer to "is the bank signed off?" on the trial balance and Home.
 * OWNS    October signed alone (September not) is "months signed, none in an unbroken run" (state no_run, the one phrase NO_RUN_WORDS), never "never signed" (No bank sign-off yet) beside the Bank page's "1 of 12";
 *         an account never signed stays 'never'; one with a run keeps its own states; the Home Bank card says the same phrase.
 * CALLED BY CI (tests/*.test.cjs). Pure rows in, answer out: no database.
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const assert = require('assert');
const BL = require('../lib/bank-rec-log');
const home = require('../lib/home-facts-bank');
const chart = [{ account_id: 'a1', code: '1500', name: 'Business bank', role: 'bank' }, { account_id: 'a2', code: '1510', name: 'Card', role: 'bank' }];
const out = BL.tbBankOf([], [], '2026-11-26', [], chart, 'AUD', [{ account_id: 'a1' }]);
assert.strictEqual(out.find((l) => l.account_id === 'a1').state, 'no_run');
assert.strictEqual(out.find((l) => l.account_id === 'a2').state, 'never');
const legacy = BL.tbBankOf([], [], '2026-11-26', [], chart, 'AUD');
assert.ok(legacy.every((l) => l.state === 'never'), 'six arguments: as before');
const ran = BL.tbBankOf([], [{ account_id: 'a1', period_to: '2026-08-31' }], '2026-07-31', [], chart, 'AUD', [{ account_id: 'a1' }]);
assert.strictEqual(ran.find((l) => l.account_id === 'a1').state, 'none_by_date', 'a run exists, only after the day: its own words');
const noRun = home.noSignedStatement({ row: null, waiting: null, posted: 0, signedNoRun: true }, null, {});
assert.strictEqual(noRun.lines[0].text, BL.NO_RUN_WORDS, 'Home says the trial balance words');
assert.strictEqual(noRun.state, 'in_use');
const never = home.noSignedStatement({ row: null, waiting: null, posted: 0, signedNoRun: false }, null, { plural: () => '' });
assert.strictEqual(never.state, 'not_started', 'nothing ever signed: as before');
console.log('rw2fin-1130 api: ok');
