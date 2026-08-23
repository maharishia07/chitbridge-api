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
 * ⚠️⚠️ THE PARAGRAPH THAT WAS HERE WAS WRONG, AND IT DESCRIBED THE BUG IT CAUSED. It said the cache never needs
 * invalidating because a column that appears "is picked up on the next deploy or restart — which is exactly
 * when a migration lands". Migrations do NOT land at restart here: Athi runs them by hand against a running
 * server. b178 was deployed and then run, so the requests in between cached "absent" and the column stayed
 * invisible after it existed.
 *
 * ⭐ A YES IS CACHED FOREVER, A NO EXPIRES IN A MINUTE. A column that exists will not vanish; one that does
 * not may appear at any moment. See the note at the cache write. A false positive would resurrect the 42703,
 * so an unreachable database still resolves to "absent" rather than optimistically to "present".
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

  /**
   * ⚠️⚠️ A "YES" IS CACHED FOREVER; A "NO" IS CACHED FOR SIXTY SECONDS. The asymmetry is the whole point, and
   * I had it wrong: this cached both permanently, on the reasoning that "a column which APPEARS is picked up
   * on the next deploy or restart — which is exactly when a migration lands."
   *
   * ⚠️ THAT IS FALSE HERE, AND I WROTE IT ABOVE THE CODE IT DESCRIBED. Athi runs migrations BY HAND against a
   * running server. b178 was deployed, then run — so every request in between cached "supplies: absent", and
   * the column stayed invisible after it existed. Ten live checks in a row returned undefined, and nothing was
   * wrong with the migration, the route, or the query.
   *
   * ⭐ A COLUMN THAT EXISTS WILL NOT VANISH — caching that is free. A column that does not exist may appear at
   * any moment, because that is precisely what a hand-run migration does. So the negative expires, and the
   * cost of being wrong is one extra information_schema lookup a minute per absent column.
   */
  if (present) cache.set(key, true);
  else cache.set(key, false), setTimeout(() => cache.delete(key), 60000).unref?.();
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
  /* ⚠️ SAME ASYMMETRY AS hasColumn — a table that exists will not vanish; one that does not may appear the
     moment a migration is run by hand against a live server. See the note above. */
  if (present) cache.set(key, true);
  else cache.set(key, false), setTimeout(() => cache.delete(key), 60000).unref?.();
  return present;
};

/** Test seam — the unit test drives the deploy-before-migration window through this. */
function _reset() { cache.clear(); }

/**
 * ── hasColumns — ASK ONCE FOR MANY ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ MEASURED 2026-08-23, AFTER ATHI SAID "the system became slow". `GET /entities/me` — a single-row lookup
 * by primary key, and the read behind every screen — was taking a **flat 3.27 seconds**, five calls in a row,
 * warm. The row was never the problem: it issues **eight sequential `hasColumn` probes** before it reads
 * anything, and each one is its own `information_schema` query. Eight probes plus the handler's real queries is
 * ~13 round trips, at roughly 250 ms each across Railway↔Supabase. That is the whole 3.3 seconds.
 *
 * ⭐ He suspected accumulated test rows and was going to delete them. It would not have helped by a
 * millisecond: `/connections/list` returns ZERO rows in 0.52 s while `/products` returns 58 in 1.9 s. **The
 * cost is per round trip, not per row** — the same finding as the profile's five reads, one layer down.
 *
 * ⭐⭐ So the probes become ONE query. `information_schema.columns` can answer for eight columns as easily as
 * for one, and the results land in the same cache with the same yes-forever / no-for-60s policy, so nothing
 * about the deploy-before-migration guarantee changes.
 *
 * ⚠️ A failure still caches NOTHING, for the reason the single version already documents: the database being
 * briefly unreachable is not evidence about the schema.
 */
async function hasColumns(table, columns) {
  const want = [...new Set((columns || []).filter(Boolean))];
  const out = {};
  const ask = [];
  for (const c of want) {
    const key = `${table}.${c}`;
    if (cache.has(key)) out[c] = cache.get(key);
    else ask.push(c);
  }
  if (!ask.length) return out;

  let rows = null;
  try {
    const r = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])`,
      [table, ask]);
    rows = new Set(r.rows.map((x) => x.column_name));
  } catch (e) {
    /* Unreachable database: answer absent for THIS call, cache nothing, ask again next time. */
    for (const c of ask) out[c] = false;
    return out;
  }

  for (const c of ask) {
    const present = rows.has(c);
    out[c] = present;
    const key = `${table}.${c}`;
    if (present) cache.set(key, true);
    else cache.set(key, false), setTimeout(() => cache.delete(key), 60000).unref?.();
  }
  return out;
}

module.exports = { hasColumn, hasColumns, hasTable, _reset };
