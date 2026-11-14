// @stage tested
// @stage-note SEC-FIX2: the boot check that refuses to serve when the app's database role bypasses RLS.
'use strict';
/**
 * CARD 28-platform-and-operations/db-role
 * lib/db-role.js — does the role the app connects as BYPASS row-level security? (SEC-FIX2 live check 2)
 * owns: the one SELECT + the verdict · called by: server.js at boot (before listen), scripts/check-db-role.js
 * FLOW  boot → roleFacts(runQuery) → verdict(row, env) → { fatal | warn | ok }      INIT  after db pool, before app.listen
 * Many routes rely on RLS alone (definitions, storage, catalogue); a superuser / BYPASSRLS role makes every one cross-shop.
 */
const ROLE_SQL = 'SELECT current_user, session_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user';

/** the role the pool really connects as: { current_user, session_user, rolsuper, rolbypassrls } or null when pg_roles shows no row */
async function roleFacts(runQuery) {
  const result = await runQuery(ROLE_SQL);
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
  const reason =
    facts.current_user +
    ' has rolsuper=' +
    facts.rolsuper +
    ' rolbypassrls=' +
    facts.rolbypassrls +
    ' — RLS is ignored, every shop-scoped route would be cross-shop. Connect the API as a NOSUPERUSER NOBYPASSRLS role (docs/HOSTING.md, Database).';
  return {
    level: isLocalStack ? 'warn' : 'fatal',
    msg: isLocalStack ? 'database role BYPASSES RLS (local stack: warning only)' : 'boot aborted: database role BYPASSES RLS',
    reason
  };
}

/**
 * SEC-185 · the sign-in door must exist. lib/signin-lookup.js has NO fallback read any more: if ops.signin_candidates (migration b857) is missing, or cb_app may not run it,
 * every login throws 42883 / 42501. So boot asks once, before listening, and a missing door refuses to start (a local stack only warns), exactly like a role that bypasses RLS.
 * LAND PRECONDITION: b857 run AND its CHECK row all true. The CHECK is in the b857 header; this is its boot-time twin for the two facts the api needs (present, executable).
 */
const SIGNIN_SQL = "SELECT to_regprocedure('ops.signin_candidates(text,text)') IS NOT NULL AS present, COALESCE(has_function_privilege(current_user, to_regprocedure('ops.signin_candidates(text,text)'), 'EXECUTE'), false) AS may_run";

/** { present, may_run } or null when the read returned no row */
async function signinDoorFacts(runQuery) {
  const result = await runQuery(SIGNIN_SQL);
  return (result && result.rows && result.rows[0]) || null;
}

/** { level: 'ok'|'warn'|'fatal', msg, reason } for the sign-in door; fatal everywhere except a local stack */
function signinDoorVerdict(facts, isLocalStack) {
  if (facts && facts.present && facts.may_run) return { level: 'ok', msg: 'sign-in lookup ops.signin_candidates is present and executable', reason: 'the sign-in lookup migration has been run' };
  const reason = !facts ? 'the read returned no row' : !facts.present ? 'ops.signin_candidates does not exist: run migrations/b857_signin_candidates_definer.sql (and its CHECK row) BEFORE this api serves' : 'this role may not EXECUTE ops.signin_candidates: the grant in migrations/b857_signin_candidates_definer.sql is wrong';
  return { level: isLocalStack ? 'warn' : 'fatal', msg: isLocalStack ? 'sign-in lookup missing (local stack: warning only)' : 'boot aborted: sign-in lookup ops.signin_candidates missing, every login would fail', reason };
}

/**
 * SEC-75 · the two entity_schemas doors must exist. Four sites read ANOTHER shop's schema through ops.shop_has_catalogue(uuid) and ops.shop_default_schema(uuid) (migration RUN-2026-11-14-b861):
 * without them a has_catalogue flag or the order freeze would fail (42883) or, under the policy, go quietly empty. So boot asks once, before listening: a missing or non-executable door refuses to start
 * (a local stack only warns). has_function_privilege(current_user, ...) asks about the role the api really connects as (cb_app on every deployed stack).
 */
const ENTITY_DOORS = ['ops.shop_has_catalogue(uuid)', 'ops.shop_default_schema(uuid)'];
const ENTITY_SQL = "SELECT d.sig, to_regprocedure(d.sig) IS NOT NULL AS present, COALESCE(has_function_privilege(current_user, to_regprocedure(d.sig), 'EXECUTE'), false) AS may_run FROM unnest($1::text[]) AS d(sig)";

/** one { sig, present, may_run } row per door */
async function entityDoorFacts(runQuery) {
  const result = await runQuery(ENTITY_SQL, [ENTITY_DOORS]);
  return (result && result.rows) || [];
}

/** { level: 'ok'|'warn'|'fatal', msg, reason } for the two doors; fatal everywhere except a local stack */
function entityDoorVerdict(rows, isLocalStack) {
  const bad = ENTITY_DOORS.filter((sig) => !(rows || []).some((row) => row.sig === sig && row.present && row.may_run));
  if (!bad.length) return { level: 'ok', msg: 'entity_schemas doors ops.shop_has_catalogue and ops.shop_default_schema are present and executable', reason: 'the entity_schemas functions migration has been run' };
  const reason = 'missing or not executable by this role: ' + bad.join(', ') + ' — run the held entity_schemas functions file in migrations/ (and its CHECK rows) BEFORE this api serves';
  return { level: isLocalStack ? 'warn' : 'fatal', msg: isLocalStack ? 'entity_schemas doors missing (local stack: warning only)' : 'boot aborted: entity_schemas doors missing, the order freeze and the catalogue flag would fail', reason };
}

/**
 * bootCheck(runQuery, isLocalStack, log) — judge the role, then the sign-in door, then the two entity_schemas doors (SEC-75); log each verdict. Returns true when one is fatal (the caller exits), so the boot code is one line.
 * A door is asked only when the one before it passed: a fatal verdict stops the run before the next read.
 */
async function bootCheck(runQuery, isLocalStack, log) {
  const steps = [
    () => roleFacts(runQuery).then((facts) => verdict(facts, isLocalStack)),
    () => signinDoorFacts(runQuery).then((facts) => signinDoorVerdict(facts, isLocalStack)),
    () => entityDoorFacts(runQuery).then((rows) => entityDoorVerdict(rows, isLocalStack)) /* SEC-75 */
  ];
  for (const step of steps) {
    const found = await step();
    log[found.level === 'fatal' ? 'critical' : found.level === 'ok' ? 'info' : 'warn'](found.msg, { reason: found.reason });
    if (found.level === 'fatal') return true;
  }
  return false;
}

module.exports = { ROLE_SQL, roleFacts, bypassesRls, verdict, SIGNIN_SQL, signinDoorFacts, signinDoorVerdict, ENTITY_DOORS, ENTITY_SQL, entityDoorFacts, entityDoorVerdict, bootCheck };
