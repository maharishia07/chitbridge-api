'use strict';
/**
 * lib/db-role.js — does the role the app connects as BYPASS row-level security? (SEC-FIX2 live check 2)
 * owns: the one SELECT + the verdict · called by: server.js at boot (before listen), scripts/check-db-role.js
 * FLOW  boot → roleFacts(run) → verdict(row, env) → { fatal | warn | ok }      INIT  after db pool, before app.listen
 * Many routes rely on RLS alone (definitions, storage, catalogue); a superuser / BYPASSRLS role makes every one cross-shop.
 */
const ROLE_SQL = 'SELECT current_user, session_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user';

/** the role the pool really connects as: { current_user, session_user, rolsuper, rolbypassrls } or null when pg_roles shows no row */
async function roleFacts(run) {
  const result = await run(ROLE_SQL);
  return (result && result.rows && result.rows[0]) || null;
}

/** true when RLS does not apply to this role (a superuser or BYPASSRLS) */
const bypassesRls = (facts) => !!(facts && (facts.rolsuper || facts.rolbypassrls));

/**
 * What boot does about the role: { level: 'ok'|'warn'|'fatal', msg, reason }.
 * fatal everywhere except a local stack (production has carried NODE_ENV=" development", so only a local DB proves a developer's machine).
 */
function verdict(facts, isLocalStack) {
  if (!facts) return { level: 'warn', msg: 'database role not read', reason: 'pg_roles returned no row for current_user — RLS posture unknown' };
  if (!bypassesRls(facts)) return { level: 'ok', msg: 'database role enforces RLS', reason: facts.current_user + ' (rolsuper=false, rolbypassrls=false)' };
  const reason = facts.current_user + ' has rolsuper=' + facts.rolsuper + ' rolbypassrls=' + facts.rolbypassrls
    + ' — RLS is ignored, every shop-scoped route would be cross-shop. Connect the API as a NOSUPERUSER NOBYPASSRLS role (docs/HOSTING.md, Database).';
  return { level: isLocalStack ? 'warn' : 'fatal', msg: isLocalStack ? 'database role BYPASSES RLS (local stack: warning only)' : 'boot aborted: database role BYPASSES RLS', reason };
}

module.exports = { ROLE_SQL, roleFacts, bypassesRls, verdict };
