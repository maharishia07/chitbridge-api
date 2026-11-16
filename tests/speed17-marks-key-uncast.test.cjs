#!/usr/bin/env node
// @type: unit
/**
 * tests/speed17-marks-key-uncast.test.cjs — l17 speed: the marks statements compare the entry key as a uuid, never `entry_id::text`, so the key index serves them (MIS depth: 4.4 ms to 1.4 ms per client at 7 years).
 * Offline guard on the SQL text; the EXPLAIN proof on a seeded depth database is tools/speed17-marks-explain.cjs (run on a SIT box).
 * Behaviour pin: a non-uuid text id (the guard CASE) reads as NULL, never raises, and an adopter without id_type keeps the text compare.
 * OWNS the offline check that the marks key column is never cast.   CALLED BY scripts/guards.cjs.   CARD capability/MARK-AND-QUERY-CAPABILITY
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const detect = lib('mark-detect.js'), RM = lib('review-mark.js'), A = lib('mark-adopters.js');
const a = A.adopterOf('acc.audit');
const texts = { nowSql: detect.nowSql(a), cleared: RM.coverageSql(a).cleared };
for (const [name, sql] of Object.entries(texts)) {
  assert(!/entry_id::text\s*=/.test(sql), name + ' casts the key column to text');
  assert(/s\.entry_id\s*=\s*(ANY\(|l\.subject_key)/.test(sql), name + ' compares the bare uuid key');
  assert(!/s\.entry_id\s*=\s*CASE/.test(sql), name + ' casts inside the join condition (not leakproof under row security: no index condition); cast in a SELECT list');
  assert(/~ '\^\[0-9a-f\]\{8\}/.test(sql), name + ' lost the uuid-shape guard (a non-uuid id would raise)');
}
const plain = { subject: Object.assign({}, a.subject, { id_type: undefined }), change: a.change };
assert(/s\.entry_id::text = ANY\(\$2::text\[\]\)/.test(detect.nowSql(plain)), 'an adopter without id_type keeps the text compare');
assert(a.subject.id_type === 'uuid');
console.log('speed17-marks-key-uncast: ok');
