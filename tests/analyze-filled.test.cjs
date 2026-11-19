#!/usr/bin/env node
// @type: unit
/**
 * analyze-filled.test.cjs — the bulk-load statistics step: only the tables the database says changed are analysed, each once, and their names come back.
 *
 * OWNS      the proof that tools/analyze-filled.cjs asks pg_stat_user_tables for the changed tables, runs ANALYZE on each (names quoted by the database), and answers the list.
 * CALLED BY .github/workflows/ci.yml (offline tests loop). No database, no network: a recording stand-in pool.
 * FLOW      stand-in pool (one answer for the stats read) → analyzeFilled → the statements it ran → the names it answered
 * CARD      qa/sim-load
 * UNIT      qa/Bulk-load statistics
 * MUTATION  checked once: in tools/analyze-filled.cjs drop the `n_mod_since_analyze > 0` filter → "asks only for the tables that changed" fails.
 */
'use strict';
const assert = require('assert');
const { analyzeFilled } = require('../tools/analyze-filled.cjs');

(async () => {
  const ran = [];
  const pool = { query: async (sql) => { ran.push(sql); return /pg_stat_user_tables/.test(sql) ? { rows: [{ t: 'public.journal_entry' }, { t: 'public.chit_header' }] } : { rows: [] }; } };
  const names = await analyzeFilled(pool);
  assert.deepStrictEqual(names, ['public.journal_entry', 'public.chit_header'], 'answers the names it analysed');
  assert.ok(/n_mod_since_analyze > 0/.test(ran[0]), 'asks only for the tables that changed');
  assert.deepStrictEqual(ran.slice(1), ['ANALYZE public.journal_entry', 'ANALYZE public.chit_header'], 'one ANALYZE per changed table');
  const quiet = await analyzeFilled({ query: async () => ({ rows: [] }) });
  assert.deepStrictEqual(quiet, [], 'nothing changed, nothing analysed');
  console.log('analyze-filled: 4 checks');
})().catch((error) => { console.error(error); process.exit(1); });
