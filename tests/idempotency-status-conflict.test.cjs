/**
 * idempotency-status-conflict.test.cjs — F1 (1128): a 409 status_conflict is not stored as the key's answer.
 * Figures: status_conflict -> not final (true); BILL_NOT_RECORDED -> not final (true, as before); a 409 PERIOD_LOCKED verdict -> final (false); a 201 -> final (false).
 * Source of the rule: IETF draft-ietf-httpapi-idempotency-key-header 2.6-2.7 is silent on storing failures; see middleware/idempotency.js WAITING_CODES.
 * Run: node tests/idempotency-status-conflict.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = 'x';
const W = require('../middleware/idempotency')._waitsFor;
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = g === w; ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + n + (ok ? '' : ' got ' + g + ' want ' + w)); };
eq('status_conflict is a lost race, not stored', W({ code: 'status_conflict', error: 'Status changed' }), true);
eq('BILL_NOT_RECORDED still waits', W({ code: 'BILL_NOT_RECORDED' }), true);
eq('a real verdict (PERIOD_LOCKED) is stored', W({ code: 'PERIOD_LOCKED' }), false);
eq('a success body is stored', W({ chit_id: 'c1' }), false);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
