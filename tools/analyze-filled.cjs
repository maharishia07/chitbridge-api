/**
 * tools/analyze-filled.cjs — ANALYZE the tables a bulk load just changed (journal_entry, journal_line, chit_header, ...).
 * OWNS      the one "statistics after a bulk load" step. A freshly loaded book has no planner statistics and a read hit 15 s (returns lane, 17 Nov).
 * CALLED BY tools/sim-load.cjs (end of the load, before its proof), tools/seed/seed-e.cjs (after the recorded_at stamp)
 * Which tables: those pg_stat_user_tables says changed since their last analyze (n_mod_since_analyze > 0), so no list to keep in step with the loaders.
 * Reads nothing else, writes only statistics. pool = a pg Pool (or client) that owns the tables.
 */
'use strict';
async function analyzeFilled(pool) {
  const r = await pool.query(`SELECT quote_ident(schemaname) || '.' || quote_ident(relname) AS t FROM pg_stat_user_tables WHERE schemaname = 'public' AND n_mod_since_analyze > 0 ORDER BY relname`);
  for (const row of r.rows) await pool.query('ANALYZE ' + row.t);
  return r.rows.map((x) => x.t);
}
module.exports = { analyzeFilled };
