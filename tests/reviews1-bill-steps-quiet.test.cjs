/**
 * tests/reviews1-bill-steps-quiet.test.cjs — reviews1 counter M6: a fact read that fails still answers its fallback, and the failure is logged (it was swallowed with no trace).
 * CALLED BY scripts/guards.cjs. No database. CARD 02-counter/bill-lifecycle
 */
'use strict';
const assert = require('assert');
const log = require('../lib/logger');
const seen = [];
const orig = log.warn;
log.warn = (msg, extra) => { seen.push([msg, extra]); };
const steps = require('../lib/bill-steps');
(async () => {
  const out = await steps.quiet(async () => { const e = new Error('statement timeout'); e.code = '57014'; throw e; }, 'fallback');
  assert.strictEqual(out, 'fallback', 'the fallback still stands');
  assert.strictEqual(seen.length, 1, 'the failure is logged');
  assert.strictEqual(seen[0][1].code, '57014');
  assert.strictEqual(await steps.quiet(async () => 7, 0), 7, 'a good read is untouched and logs nothing');
  assert.strictEqual(seen.length, 1);
  log.warn = orig;
  console.log('reviews1-bill-steps-quiet: ok, 5 checks'); /* the guards runner reads the number */
})().catch((e) => { console.error(e); process.exit(1); });
