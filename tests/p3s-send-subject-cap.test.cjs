#!/usr/bin/env node
// @type: unit
/**
 * tests/p3s-send-subject-cap.test.cjs — AT-F-11 (1129): the Compose panel's `subject` is capped like manual_subject (500), not kept at any length.
 * OWNS      lib/chits-input.js SEND_BODY.subject · CALLED BY scripts/guards.cjs · CARD 02-tasks-orders-and-workflow
 */
'use strict';
const Ajv = require('ajv');
const { SEND_BODY } = require('../lib/chits-input');
const check = new Ajv({ allErrors: true, strict: false }).compile({ type: 'object', properties: SEND_BODY });
let fail = 0;
const ok = (name, cond) => { console.log((cond ? '   ok   ' : '   FAIL ') + name); if (!cond) fail++; };
ok('a 20,000-character subject is refused', !check({ subject: 'x'.repeat(20000) }));
ok('a 500-character subject is kept', check({ subject: 'x'.repeat(500) }));
ok('a short subject and a null subject are kept', check({ subject: 'Rates for April' }) && check({ subject: null }));
ok('manual_subject keeps its own cap', !check({ manual_subject: 'x'.repeat(20000) }));
process.exit(fail ? 1 : 0);
