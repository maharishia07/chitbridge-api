#!/usr/bin/env node
/**
 * tests/speed17-marks-explain.test.cjs — the pure readings of tools/speed17-marks-explain.cjs: which indexes an EXPLAIN plan reads, and the verdict that fails a statement (a journal_entry Seq Scan, or the key index not used).
 * OWNS      the unit-per-rule proof of indexesRead, verdictOf and medianOf (the EXPLAIN run itself needs a seeded Postgres and is run by hand on a SIT box).
 * CALLED BY scripts/guards.cjs · by hand: node tests/speed17-marks-explain.test.cjs
 * FLOW      require tools/speed17-marks-explain.cjs ──▶ hand-built plan trees ──▶ one rule per check ──▶ "<n> checks"
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 * No database, no network.
 */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'tools', 'speed17-marks-explain.cjs'));

let passed = 0,
  failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else {
    failed++;
    console.log('   FAIL ' + label);
  }
};

/* a plan that reads the key index under a nested loop */
const good = { 'Node Type': 'Nested Loop', Plans: [{ 'Node Type': 'Index Scan', 'Index Name': 'journal_entry_pkey' }, { 'Node Type': 'Index Scan', 'Index Name': 'review_mark_subject_idx' }] };
ok('every index a nested plan reads is found, children included', E.indexesRead(good).join() === 'journal_entry_pkey,review_mark_subject_idx');
ok('a plan with no index reads none', E.indexesRead({ 'Node Type': 'Result' }).length === 0);
ok('a Seq Scan of journal_entry is marked', E.indexesRead({ 'Node Type': 'Seq Scan', 'Relation Name': 'journal_entry' }).join() === 'Seq Scan journal_entry');
ok('a Seq Scan of another table is not marked', E.indexesRead({ 'Node Type': 'Seq Scan', 'Relation Name': 'review_mark' }).length === 0);
ok('a Seq Scan of journal_entry deep in the tree is still found', E.indexesRead({ 'Node Type': 'Aggregate', Plans: [{ 'Node Type': 'Hash', Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'journal_entry' }] }] }).includes('Seq Scan journal_entry'));

/* the verdict: good only when the key index is used and journal_entry is never Seq Scanned */
ok('the key index used and no Seq Scan is a good verdict', E.verdictOf(new Set(['journal_entry_pkey'])).bad === false);
ok('a journal_entry Seq Scan is bad even when the key index is also read', E.verdictOf(new Set(['journal_entry_pkey', 'Seq Scan journal_entry'])).bad === true);
ok('the key index not used is bad (the cast is back): fail closed', E.verdictOf(new Set(['review_mark_subject_idx'])).bad === true);
ok('an empty plan is bad: nothing proves the key compare was served', E.verdictOf(new Set()).bad === true);
ok('the verdict says which half failed', E.verdictOf(new Set(['Seq Scan journal_entry'])).seqScan === true && E.verdictOf(new Set(['Seq Scan journal_entry'])).keyIndexUsed === false);

/* the median of seven timed runs is the fourth when sorted, whatever order they arrived in */
ok('the median of seven runs is the fourth sorted', E.medianOf([9, 1, 5, 3, 7, 2, 8]) === 5);
ok('the median does not reorder the caller\'s list', (() => { const runs = [3, 1, 2, 5, 4, 7, 6]; E.medianOf(runs); return runs.join() === '3,1,2,5,4,7,6'; })());

console.log('\n  ' + (passed + failed) + ' checks' + (failed ? ', ' + failed + ' failed' : ', all ok'));
process.exit(failed ? 1 : 0);
