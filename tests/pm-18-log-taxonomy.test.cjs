#!/usr/bin/env node
// @type: unit
/**
 * pm-18-log-taxonomy.test.cjs — PM-18 (proof 2026-11-14): lib/logger.js carries the five-level taxonomy debug / info / warn / error / critical with a written rule
 * for each, and the levels behave as the rule says: a line carries its level, LOG_LEVEL is a floor (default info, an unknown word falls back to info), debug / info /
 * warn go to stdout and error / critical to stderr, and a swallowed failure (log.fellBack) is a warn, never an error.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. (onCritical-only-for-critical is CAT-83: tests/cat-83-logger-critical.test.cjs.)
 *   node tests/pm-18-log-taxonomy.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const LOGGER = path.join(__dirname, '..', 'lib', 'logger.js');
let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };
const LEVEL_NAMES = ['debug', 'info', 'warn', 'error', 'critical'];

/** load a fresh logger under one LOG_LEVEL and call every level once; returns { out: [records on stdout], err: [records on stderr] } */
function emitAll(logLevel, extra) {
  const saved = { level: process.env.LOG_LEVEL, hook: process.env.CB_ALERT_WEBHOOK, log: console.log, error: console.error };
  if (logLevel === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = logLevel;
  delete process.env.CB_ALERT_WEBHOOK;
  const out = [], err = [];
  console.log = (line) => out.push(JSON.parse(line));
  console.error = (line) => err.push(JSON.parse(line));
  try {
    delete require.cache[LOGGER];
    const log = require(LOGGER);
    for (const level of LEVEL_NAMES) log[level]('m-' + level, { id: 'req-1' });
    if (extra) extra(log);
  } finally {
    console.log = saved.log; console.error = saved.error;
    if (saved.level === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = saved.level;
    if (saved.hook !== undefined) process.env.CB_ALERT_WEBHOOK = saved.hook;
    delete require.cache[LOGGER];
  }
  return { out, err, seen: out.concat(err).map((record) => record.level) };
}

// 1. all five levels exist, each line carries its level, message and the correlation id passed in
const all = emitAll('debug');
ok(all.seen.join() === 'debug,info,warn,error,critical'.split(',').join() || all.seen.slice().sort().join() === LEVEL_NAMES.slice().sort().join(), 'PM-18: all five levels emit under LOG_LEVEL=debug');
const rec = all.out.find((record) => record.level === 'warn');
ok(rec.msg === 'm-warn' && rec.id === 'req-1' && /^\d{4}-\d\d-\d\dT/.test(rec.t), 'PM-18: a line is one JSON record with its level, message, correlation id and an ISO time');

// 2. the floor: default info, then warn, then critical, and a word that is no level falls back to info
ok(emitAll(undefined).seen.join() === 'info,warn,error,critical', 'PM-18: with no LOG_LEVEL, debug is off and info, warn, error, critical are on');
ok(emitAll('warn').seen.join() === 'warn,error,critical', 'PM-18: LOG_LEVEL=warn silences debug and info');
ok(emitAll('error').seen.join() === 'error,critical', 'PM-18: LOG_LEVEL=error shows only error and critical');
ok(emitAll('critical').seen.join() === 'critical', 'PM-18: LOG_LEVEL=critical shows only critical');
ok(emitAll('CRITICAL').seen.join() === 'critical', 'PM-18: the level word is read case-insensitively');
ok(emitAll('loud').seen.join() === 'info,warn,error,critical', 'PM-18: an unknown LOG_LEVEL falls back to info, never to silence');

// 3. routing: a failure level goes to stderr
const routed = emitAll('debug');
ok(routed.out.map((record) => record.level).join() === 'debug,info,warn', 'PM-18: debug, info and warn go to stdout');
ok(routed.err.map((record) => record.level).join() === 'error,critical', 'PM-18: error and critical go to stderr');

// 4. a swallowed failure is a warn (the rule: a bare catch is a warn); only a catch that is normal flow may say debug
const fell = emitAll('debug', (log) => { log.fellBack('price list not read', new Error('boom')); log.fellBack('input did not parse', new Error('x'), 'debug'); log.orElse('roster not read', { rows: [] })(new Error('y')); });
const fellRecords = fell.out.concat(fell.err).filter((record) => /not read|did not parse/.test(record.msg));
ok(fellRecords.length === 3 && fellRecords[0].level === 'warn' && fellRecords[0].err === 'boom', 'PM-18: log.fellBack writes the failure as a warn with the reason');
ok(fellRecords[1].level === 'debug' && fellRecords[2].level === 'warn', 'PM-18: only an explicit debug makes a fell-back catch debug; orElse is a warn');

// 5. the written rule: the header names each level with who acts and how soon
const header = fs.readFileSync(LOGGER, 'utf8').slice(0, 6000);
for (const level of LEVEL_NAMES) ok(new RegExp('^ [*] {3}' + level + ' {2,}[^ ]', 'm').test(header), 'PM-18: the header holds a written rule for ' + level);
ok(/who should act, and how soon/.test(header), 'PM-18: the header says the test for a level is who should act, and how soon');
console.log(pass + ' passed');
