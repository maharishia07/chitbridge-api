'use strict';
/**
 * tests/sec-184-signin-lookup.realstack.cjs — SEC-184 step A on a REAL Postgres: b857 applied to a fresh database (tools/fresh-db-check.cjs), read as cb_app.
 *   R-1  the connecting role is NOT a superuser and does NOT bypass row security (the critic's point: forced RLS would be a silent no-op otherwise)
 *   R-2  the function exists in ops, is SECURITY DEFINER, pins search_path empty, runs as an owner that bypasses RLS; anon, authenticated and PUBLIC cannot execute it, cb_app can
 *   R-3  every kind finds a planted shop / customer; the answer has exactly the eight columns; a 2-character key and a % key find nothing; 12 shops of one name answer 10
 *   R-4  an unknown kind raises 22023
 *   R-5  the api's own reader (lib/identity-auth findLoginIdentity) signs the planted owner in by e-mail, by handle and by name through the function
 * Every row it makes is deleted at the end. Allow list: localhost, the compose db or a SIT host. Run in CI as cb_app:
 *   DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/sec-184-signin-lookup.realstack.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL on localhost, the compose db or a SIT host'); process.exit(3); }
const { query } = require('../db');
const identityAuth = require('../lib/identity-auth');
const lookup = require('../lib/signin-lookup');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'sl' + (Date.now() % 1e9).toString(36);
const EIGHT = ['identity_id', 'identity_type', 'parent_entity_id', 'bridge_id', 'display_name', 'user_id', 'email', 'status'];

(async () => {
  console.log('\n── SEC-184 A · the sign-in lookup on real Postgres · run ' + RUN + ' ──');
  const made = [];
  try {
    const role = (await query('SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
    ok('R-1 the connecting role (' + role.u + ') is not a superuser and does not bypass row security', role.rolsuper === false && role.rolbypassrls === false, JSON.stringify(role));

    const fn = (await query(`SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
        (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = pg_get_userbyid(p.proowner)) AS owner_bypasses,
        has_function_privilege('cb_app', p.oid, 'EXECUTE') AS app_may,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_function_privilege('anon', p.oid, 'EXECUTE') ELSE false END AS anon_may,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') ELSE false END AS auth_may,
        EXISTS (SELECT 1 FROM information_schema.routine_privileges r WHERE r.routine_schema = 'ops' AND r.routine_name = 'signin_candidates' AND r.grantee = 'PUBLIC') AS public_may
      FROM pg_proc p WHERE p.oid = 'ops.signin_candidates(text,text)'::regprocedure`)).rows[0];
    ok('R-2 definer, search_path pinned empty, owner bypasses RLS', fn.prosecdef === true && /search_path=""/.test(String(fn.proconfig)) && fn.owner_bypasses === true, JSON.stringify(fn));
    ok('R-2 cb_app may execute; anon, authenticated and PUBLIC may not', fn.app_may === true && fn.anon_may === false && fn.auth_may === false && fn.public_may === false, JSON.stringify(fn));

    const shop = (await query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, status, country, currency_code) VALUES ($1, $2, $3, $4, 'entity', 'active', 'IN', 'INR') RETURNING identity_id`,
      ['CB' + RUN, 'Lookup ' + RUN, RUN + '@lookup.test', 'lk-' + RUN])).rows[0].identity_id; made.push(shop);
    const cust = (await query(`INSERT INTO identities (bridge_id, display_name, identity_type, status, phone, otp_contact, country, currency_code) VALUES ($1, $2, 'customer', 'active', $3, $4, 'IN', 'INR') RETURNING identity_id`,
      ['CC' + RUN, 'Cust ' + RUN, '9' + String(Date.now()).slice(-9), RUN + '@cust.test'])).rows[0].identity_id; made.push(cust);
    const custPhone = (await query('SELECT phone FROM identities WHERE identity_id = $1', [cust])).rows[0].phone;
    const has = async (kind, key, id) => (await lookup.candidates(query, kind, key)).some((r) => r.identity_id === id);
    ok('R-3 e-mail finds the shop', await has('email', RUN + '@lookup.test', shop));
    ok('R-3 handle finds the shop (any case)', await has('handle', 'LK-' + RUN, shop));
    ok('R-3 name finds the shop', await has('name', 'LOOKUP ' + RUN, shop));
    ok('R-3 id finds the shop', await has('id', shop, shop));
    ok('R-3 phone finds the customer, with and without the +', (await has('phone', custPhone, cust)) && (await has('phone', custPhone.replace(/^\+/, ''), cust)));
    ok('R-3 contact finds the customer', await has('contact', RUN + '@cust.test', cust));
    const row = (await lookup.candidates(query, 'email', RUN + '@lookup.test'))[0];
    ok('R-3 the answer has exactly the eight columns and no secret', JSON.stringify(Object.keys(row).sort()) === JSON.stringify(EIGHT.slice().sort()), Object.keys(row).join());
    ok('R-3 a 2-character key and a % key find nothing', (await lookup.candidates(query, 'handle', 'lk')).length === 0 && (await lookup.candidates(query, 'name', '%')).length === 0 && (await query("SELECT * FROM ops.signin_candidates('name', '%%%')")).rows.length === 0);
    for (let i = 0; i < 12; i++) made.push((await query(`INSERT INTO identities (bridge_id, display_name, identity_type, status, country, currency_code) VALUES ($1, $2, 'entity', 'active', 'IN', 'INR') RETURNING identity_id`, ['CT' + RUN + i, 'Twin ' + RUN])).rows[0].identity_id);
    ok('R-3 12 shops of one name answer at most 10', (await lookup.candidates(query, 'name', 'Twin ' + RUN)).length === 10);
    let raised = null; try { await query("SELECT * FROM ops.signin_candidates('like', 'abcd')"); } catch (e) { raised = e.code; }
    ok('R-4 an unknown kind raises 22023', raised === '22023', raised);

    for (const typed of [RUN + '@lookup.test', 'lk-' + RUN, 'Lookup ' + RUN]) {
      lookup.reset();
      const found = await identityAuth.findLoginIdentity(query, typed);
      ok('R-5 findLoginIdentity(' + typed + ') finds the shop through the function', !!(found && found.identity && found.identity.identity_id === shop), JSON.stringify(found && found.identity && found.identity.identity_id));
    }
  } catch (e) {
    ok('the run reached its end without an error', false, e && e.stack);
  } finally {
    for (const id of made) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup of ' + id + ' failed: ' + e.message); } }
  }
  console.log('\n' + pass + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
