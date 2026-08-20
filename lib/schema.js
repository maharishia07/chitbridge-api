/**
 * lib/schema.js — "does this column exist yet?", asked once and remembered.
 *
 * ⚠️⚠️ WHY THIS EXISTS. Code deploys here BEFORE the migration runs — always, because Athi runs SQL by hand in
 * the Supabase editor. b173 added `access_level` and `whole_entity`, and middleware/auth.js began SELECTing
 * them the moment it deployed. I left a comment claiming that was safe because the values "can be undefined".
 *
 * That was wrong, and wrong in the most damaging direction. A missing column in a SELECT is not `undefined` in
 * JavaScript — it is Postgres error 42703, and the WHOLE QUERY THROWS. The query in question is the one every
 * authenticated actor request runs to check revocation. So the effect was not a missing flag: it was that
 * NO CO-ASSIST COULD SIGN IN AT ALL, until a migration nobody had scheduled was run by hand.
 *
 * ⭐ The fix is to ask the database what it actually has, once, and shape the SQL to the answer. That makes the
 * deploy-before-migration window genuinely safe instead of merely commented as safe.
 *
 * The cache is per-process and never invalidated on purpose: a column cannot disappear under a running server,
 * and one that APPEARS is picked up on the next deploy or restart — which is exactly when a migration lands.
 * A false NEGATIVE is safe (the code falls back to the old column); a false positive would resurrect the bug,
 * so an unreachable database resolves to "absent" rather than optimistically to "present".
 */
const { query } = require('../db');

const cache = new Map();          // 'table.column' -> boolean

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (cache.has(key)) return cache.get(key);
  let present = false;
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    );
    present = r.rows.length > 0;
  } catch (e) {
    /* ⚠️ Do NOT cache a failure. The database being briefly unreachable is not evidence about the schema, and
       caching "absent" here would keep the fallback engaged for the life of the process long after the DB
       came back. Return absent for THIS call, ask again on the next one. */
    return false;
  }
  cache.set(key, present);
  return present;
}

/**
 * Same question one level up: does the TABLE exist yet?
 *
 * ⚠️ A route whose table has not been migrated must refuse cleanly, not 500. The vault already set this
 * precedent — b100's column is absent and the save returns a clean 503 — and copying that posture is why this
 * lives beside hasColumn instead of becoming a second, slightly different probe somewhere else.
 */
async function hasTable(table) {
  return hasColumn.__table(table);
}
hasColumn.__table = async function (table) {
  const key = `table:${table}`;
  if (cache.has(key)) return cache.get(key);
  let present = false;
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    present = r.rows.length > 0;
  } catch (e) { return false; }   // never cache a failure — see hasColumn
  cache.set(key, present);
  return present;
};

/** Test seam — the unit test drives the deploy-before-migration window through this. */
function _reset() { cache.clear(); }

module.exports = { hasColumn, hasTable, _reset };
