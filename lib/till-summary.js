'use strict';
/**
 * lib/till-summary.js — THE SHOP'S SUMMARY CHITS, READ ONCE (extracted for GET /api/facts/till, 2026-10-08).
 *
 * The SQL and the fold are the ones GET /api/till/summary (routes/till.js) runs. That route still carries its own copy of the
 * statement: routes/till.js was out of bounds for the change that added this file (other branches edit it), so the follow-up
 * is ONE line there — `require('../lib/till-summary')` in place of the inline text. Until then, change both or neither.
 *
 * ⚠️ A summary chit is purpose 'general' and so is a SHIFT chit: the test is the summary's period, never the purpose.
 * ⚠️ Ordered newest-first, which rollup.acrossCounters() relies on. Run it inside withEntity()/readBatch() (chit_header is FORCE RLS).
 */
const rollup = require('./rollup');

const SUMMARY_SQL = `SELECT h.chit_id, h.created_at, h.business_json
         FROM chit_header h
        WHERE h.entity_id = $1
          AND h.purpose = 'general'
          AND h.business_json -> 'summary' ->> 'period' = $2
        ORDER BY h.business_json -> 'summary' ->> 'key' DESC, h.created_at DESC
        LIMIT $3`;

/** the statement + params for `limit` periods of one kind (reads limit*8 rows, as the route does: one per counter per re-send) */
const summaryStatement = (entity_id, period, limit) => ({ text: SUMMARY_SQL, params: [entity_id, period, Math.max(1, limit) * 8] });

/** rows of that statement → [{ key, totals, counters }] newest period first (the fold lives in lib/rollup, not here) */
const foldSummaries = (rows, limit) => rollup.acrossCounters((rows || []).map((x) => (x.business_json || {}).summary)).slice(0, limit);

module.exports = { SUMMARY_SQL, summaryStatement, foldSummaries };
