'use strict';
/**
 * tests/signin-provider.realstack.cjs — SEC-112 P0 on a REAL Postgres: b878 + b879 + b880 applied to a fresh database (the CI fresh-db step applies every migration), read and written as cb_app.
 *   R-1  the connecting role neither is a superuser nor bypasses row security (else FORCE would be a silent no-op)
 *   R-2  signin_provider_link: shop A writes its link; shop B sees none and cannot insert a row filed under A; an unbound connection sees none; cb_app cannot change the subject (column privilege)
 *   R-3  the pre-binding door ops.signin_provider_links: exact match finds A's link; a wildcard, an empty, a NULL and a near-miss argument find nothing; definer, pinned path, closed to anon / authenticated / PUBLIC
 *   R-4  the same subject may link two shops (no existence oracle: the unique key holds identity_id), but one provider once per account
 *   R-5  ops.signin_pending: cb_app cannot read or write the table directly; put then take returns the payload ONCE; another kind finds nothing; a ticket answers five tries and then dies; an expired row is gone
 *   R-6  signin_events accepts subject_hash (64 hex) and refuses anything else
 * Every row it makes is deleted at the end (by the owner connection). Run in CI as cb_app, with the owner URL for planting:
 *   DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 CB_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 node tests/signin-provider.realstack.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2]) || !process.env.CB_OWNER_DB_URL) {
  console.error('REFUSED: needs DATABASE_URL (cb_app) on localhost, the compose db or a SIT host, and CB_OWNER_DB_URL');
  process.exit(3);
}
const crypto = require('crypto');
const { Client } = require('pg');
const { query, withEntity } = require('../db');
let pass = 0;
let fail = 0;
const ok = (what, cond, info) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + what);
  } else {
    fail++;
    console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : ''));
  }
};
const refused = async (fn) => {
  try {
    await fn();
    return null;
  } catch (failure) {
    return failure.code || 'ERR';
  }
};
const RUN = 'sp' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const hashOf = (value) => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  console.log('\n── SEC-112 P0 · provider links and the pending store on real Postgres · run ' + RUN + ' ──');
  const owner = new Client({ connectionString: process.env.CB_OWNER_DB_URL });
  await owner.connect();
  const made = [];
  try {
    const role = (await query('SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
    ok('R-1 the connecting role (' + role.u + ') is not a superuser and does not bypass row security', role.rolsuper === false && role.rolbypassrls === false, JSON.stringify(role));

    const shop = async (tag) =>
      (await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, status, country, currency_code) VALUES ($1, $2, $3, $4, 'entity', 'active', 'IN', 'INR') RETURNING identity_id`,
        ['CB' + RUN + tag, 'Link ' + RUN + tag, RUN + tag + '@link.test', 'lnk-' + RUN + tag])).rows[0].identity_id;
    const shopA = await shop('a');
    const shopB = await shop('b');
    made.push(shopA, shopB);
    const issuer = 'https://accounts.google.com';
    const subject = 'sub-' + RUN;
    const insert = (entity, identity, provider) =>
      withEntity(entity, (db) =>
        db.query(`INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, tenant, subject, email, email_verified) VALUES ($1, $2, $3, $4, '', $5, 'x@y.test', true) RETURNING link_id`, [entity, identity, provider, issuer, subject]));
    const linkA = (await insert(shopA, shopA, 'google')).rows[0].link_id;
    ok('R-2 shop A writes its own link under its binding', !!linkA);
    ok('R-2 shop B sees none of A\'s links', (await withEntity(shopB, (db) => db.query('SELECT count(*)::int AS n FROM signin_provider_link WHERE identity_id = $1', [shopA]))).rows[0].n === 0);
    ok('R-2 shop A sees its own', (await withEntity(shopA, (db) => db.query('SELECT count(*)::int AS n FROM signin_provider_link'))).rows[0].n >= 1);
    /* b911 put a BEFORE INSERT bind trigger on the table (the identity must belong to the entity, check_violation 23514): it now speaks first when B files under A's entity with B's identity, so that case is refused by the trigger; the WITH CHECK itself is proved by the second line, A's own identity filed under B's binding, where the trigger passes and only row security can refuse (42501) */
    ok('R-2 shop B cannot file a link under A with its own identity (refused: the bind trigger, or row security)', ['23514', '42501'].includes(await refused(() => withEntity(shopB, (db) => db.query(`INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES ($1, $2, 'google2', 'i', 's')`, [shopA, shopB])))));
    ok('R-2 shop B cannot file a link for the other shop identity under its own binding (WITH CHECK, 42501)', (await refused(() => withEntity(shopB, (db) => db.query(`INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES ($1, $2, 'google3', 'i', 's3')`, [shopA, shopA])))) === '42501');
    ok('R-2 cb_app cannot change the subject (column privilege, 42501)', (await refused(() => withEntity(shopA, (db) => db.query('UPDATE signin_provider_link SET subject = $1 WHERE link_id = $2', ['other', linkA])))) === '42501');
    ok('R-2 cb_app may refresh last_used_at', (await withEntity(shopA, (db) => db.query('UPDATE signin_provider_link SET last_used_at = now() WHERE link_id = $1', [linkA]))).rowCount === 1);
    ok('R-2 unlink DELETEs the row (nothing of the provider is kept)', (await withEntity(shopA, async (db) => (await db.query('DELETE FROM signin_provider_link WHERE link_id = $1', [linkA])).rowCount === 1 && (await db.query('SELECT 1 FROM signin_provider_link WHERE link_id = $1', [linkA])).rowCount === 0)) === true);
    await insert(shopA, shopA, 'google');

    const door = async (...args) => (await query('SELECT * FROM ops.signin_provider_links($1, $2, $3, $4)', args)).rows;
    ok('R-3 the door finds the link by the four-part key, unbound', (await door('google', issuer, '', subject)).length === 1);
    for (const [what, args] of [['a wildcard subject', ['google', issuer, '', '%']], ['an empty subject', ['google', issuer, '', '']], ['an empty provider', ['', issuer, '', subject]], ['a near-miss issuer', ['google', issuer + '/', '', subject]], ['a wrong tenant', ['google', issuer, 'x', subject]], ['a wrong provider', ['microsoft', issuer, '', subject]]]) ok('R-3 the door finds nothing for ' + what, (await door(...args)).length === 0);
    ok('R-3 NULL arguments find nothing', (await query('SELECT * FROM ops.signin_provider_links(NULL, NULL, NULL, NULL)')).rows.length === 0);
    const fn = (await query(`SELECT p.prosecdef, p.proconfig, has_function_privilege('cb_app', p.oid, 'EXECUTE') AS app_may,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_function_privilege('anon', p.oid, 'EXECUTE') ELSE false END AS anon_may,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE false END AS auth_may,
        EXISTS (SELECT 1 FROM information_schema.routine_privileges r WHERE r.routine_schema = 'ops' AND r.routine_name = 'signin_provider_links' AND r.grantee = 'PUBLIC') AS public_may
      FROM pg_proc p WHERE p.oid = 'ops.signin_provider_links(text,text,text,text)'::regprocedure`)).rows[0];
    ok('R-3 definer, path pinned empty, cb_app only', fn.prosecdef === true && /search_path=""/.test(String(fn.proconfig)) && fn.app_may === true && fn.anon_may === false && fn.auth_may === false && fn.public_may === false, JSON.stringify(fn));

    await insert(shopB, shopB, 'google');
    ok('R-4 the same Google subject links two shops, and the door answers both (up to 10), never telling one the other\'s', (await door('google', issuer, '', subject)).length === 2);
    ok('R-4 one Google per account (unique identity_id + provider, 23505)', (await refused(() => insert(shopA, shopA, 'google'))) === '23505');

    ok('R-5 cb_app cannot read the pending table directly', (await refused(() => query('SELECT * FROM ops.signin_pending'))) === '42501');
    ok('R-5 cb_app cannot write the pending table directly', (await refused(() => query(`INSERT INTO ops.signin_pending (ref_hash, kind, payload, expires_at) VALUES ($1, 'start', '{}', now() + interval '1 minute')`, [hashOf('x')]))) === '42501');
    const ref = hashOf('ref-' + RUN);
    await query('SELECT ops.signin_pending_put($1, $2, $3::jsonb, 60)', ['handoff', ref, JSON.stringify({ a: 1 })]);
    ok('R-5 another kind finds nothing', (await query('SELECT ops.signin_pending_take($1, $2) AS p', ['start', ref])).rows[0].p === null);
    ok('R-5 take returns the payload once', JSON.stringify((await query('SELECT ops.signin_pending_take($1, $2) AS p', ['handoff', ref])).rows[0].p) === '{"a":1}');
    ok('R-5 and then never again (single use)', (await query('SELECT ops.signin_pending_take($1, $2) AS p', ['handoff', ref])).rows[0].p === null);
    const ticket = hashOf('ticket-' + RUN);
    await query('SELECT ops.signin_pending_put($1, $2, $3::jsonb, 60)', ['ticket', ticket, JSON.stringify({ t: 1 })]);
    let tries = 0;
    for (let i = 0; i < 7; i++) if ((await query('SELECT ops.signin_pending_try($1) AS p', [ticket])).rows[0].p !== null) tries++;
    ok('R-5 a ticket answers five tries, then it is dead', tries === 5, 'tries ' + tries);
    const old = hashOf('old-' + RUN);
    await owner.query(`INSERT INTO ops.signin_pending (ref_hash, kind, payload, expires_at) VALUES ($1, 'start', '{}', now() - interval '1 minute')`, [old]);
    ok('R-5 an expired row answers nothing', (await query('SELECT ops.signin_pending_take($1, $2) AS p', ['start', old])).rows[0].p === null);
    await query('SELECT ops.signin_pending_put($1, $2, $3::jsonb, 60)', ['start', hashOf('sweeper-' + RUN), '{}']);
    ok('R-5 the put sweeps expired rows', (await owner.query('SELECT count(*)::int AS n FROM ops.signin_pending WHERE ref_hash = $1', [old])).rows[0].n === 0);
    ok('R-5 a reference that is not a 64-hex hash is refused (22023)', (await refused(() => query('SELECT ops.signin_pending_put($1, $2, $3::jsonb, 60)', ['start', 'plain-reference', '{}']))) === '22023');

    const hash = crypto.randomBytes(32).toString('hex');
    const event = (value) => withEntity(shopA, (db) => db.query(`INSERT INTO signin_events (entity_id, identity_id, action, method, subject_hash) VALUES ($1, $1, 'link', 'google', $2)`, [shopA, value]));
    ok('R-6 signin_events accepts a 64-hex subject_hash', (await refused(() => event(hash))) === null);
    ok('R-6 and refuses a subject in the clear (23514)', (await refused(() => event('someone@gmail.com'))) === '23514');
  } catch (failure) {
    fail++;
    console.log('  FAIL threw: ' + (failure && failure.stack ? failure.stack.slice(0, 500) : failure));
  } finally {
    try {
      await owner.query('DELETE FROM signin_provider_link WHERE entity_id = ANY($1::uuid[])', [made]);
      await owner.query('DELETE FROM signin_events WHERE entity_id = ANY($1::uuid[])', [made]);
      await owner.query("DELETE FROM ops.signin_pending WHERE kind IN ('start','handoff','ticket','linkstart') AND ref_hash = ANY($1)", [[hashOf('ticket-' + RUN), hashOf('sweeper-' + RUN), hashOf('old-' + RUN), hashOf('ref-' + RUN)]]);
      await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[])', [made]);
    } catch (failure) {
      console.log('  (cleanup: ' + String(failure.message).slice(0, 120) + ')');
    }
    await owner.end();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
