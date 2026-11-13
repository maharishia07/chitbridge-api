#!/usr/bin/env node
/**
 * cat-83-logger-critical.test.cjs — CAT-83 (proof 2026-11-14): onCritical fires for CRITICAL events only.
 * @type regression
 * OWNS      the proof that lib/logger.js calls the registered sink for `critical` and for no other level (debug/info/warn/error stay in the log).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      register a sink → emit one line per level → the sink saw exactly the critical one
 *   node tests/cat-83-logger-critical.test.cjs
 */
'use strict';
process.env.LOG_LEVEL = 'debug';
delete process.env.CB_ALERT_WEBHOOK;
const { ok, done } = require('./lib/cat-proof-kit.cjs');
const log = require('../lib/logger');
const out = console.log, err = console.error;
console.log = () => undefined; console.error = () => undefined;
const seen = [];
log.onCritical((rec) => seen.push(rec));
log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
const quiet = seen.length;
log.critical('db is gone', { id: 'r1' });
console.log = process.stdout.write.bind(process.stdout);
console.log = (...a) => process.stdout.write(a.join(' ') + '\n');
ok('debug, info, warn and error do not reach the critical sink (0 of 4)', quiet === 0, quiet);
ok('one critical event reaches the sink once, with its level, message and context', seen.length === 1 && seen[0].level === 'critical' && seen[0].msg === 'db is gone' && seen[0].id === 'r1', JSON.stringify(seen));
done();
