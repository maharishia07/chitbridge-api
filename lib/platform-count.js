// CALLED BY routes/governance.js, routes/entities.js
'use strict';
/**
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * lib/platform-count.js — the ONE door for a count that spans shops (SEC-198; b860 makes such a read see 0 rows under any one shop's binding).
 * OWNS  governedCount, publicUnder
 * FLOW  call → ops.<fn>(arg) (SECURITY DEFINER, returns the number only; migrations/RUN-2026-11-26-identity-platform-counts.sql) → on 42883 (the file not run yet) the old read, logged once → number
 * WHY   Athi decision 2026-11-26: a platform-wide count goes through a named narrow definer, never a widened policy. The fallback exists so the api ships before the SQL is run; run the SQL BEFORE b860.
 */
const db = require('../db');
let warned = false;
const FALLBACK = {
  identities_governed_count: 'SELECT count(*)::int AS n FROM identities WHERE governed_by = $1',
  identities_public_under: "SELECT count(*)::int AS n FROM identities WHERE LOWER(user_id) LIKE $1 || '%' ESCAPE '\\' AND identity_type = 'entity' AND status = 'active' AND catalogue_visibility = 'public'"
};
const escapeLike = (text) => String(text).toLowerCase().replace(/([%_\\])/g, '\\$1');
/** `fn`(arg) as a number; `fallbackArg` is what the old read takes when the function is missing */
async function count(fn, arg, fallbackArg) {
  try {
    const found = await db.query('SELECT ops.' + fn + '($1) AS n', [arg]);
    return Number(found.rows[0] && found.rows[0].n) || 0;
  } catch (failure) {
    if (!failure || failure.code !== '42883') throw failure;
    if (!warned) { warned = true; require('./logger').warn('platform-count: ops.' + fn + ' is not in this database yet (run RUN-2026-11-26-identity-platform-counts.sql before the identities lock-down); using the old read'); }
    const found = await db.query(FALLBACK[fn], [fallbackArg === undefined ? arg : fallbackArg]);
    return Number(found.rows[0] && found.rows[0].n) || 0;
  }
}
/** how many identities a root governs */
const governedCount = (rootId) => count('identities_governed_count', rootId);
/** how many active public shops sit under a handle (its user_id + '.') */
const publicUnder = (handle) => count('identities_public_under', String(handle), escapeLike(handle) + '.');
module.exports = { governedCount, publicUnder };
