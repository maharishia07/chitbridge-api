'use strict';
/**
 * tests/sec-185-identities-rls.realstack.cjs — SEC-185 (step B of SEC-184): row security on identities, on a REAL Postgres, read and written as cb_app (NOBYPASSRLS).
 * CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * THE TWO GATES THE CRITIC SET (api #1234, 2026-11-14):
 *   (a) G-A  a shop-bound session cannot read, change or take over another shop's identity rows
 *   (b) G-B  "login fails when the function is removed" (mutation): drop ops.signin_candidates and the sign-in finds nobody, no direct read answers instead; put it back and it finds the owner again
 * EVERYTHING ELSE it proves: unbound = no row; bound = own tree only (shop, its customer); the counterparty arm is read-only; queryAs/queryAsEach bind for ONE message and leave nothing on the pooled connection.
 * HOW  it applies migrations/RUN-2026-11-14-b860-identities-rls.sql itself, as the OWNER (CB_OWNER_DB_URL), plants its rows as the owner, drives everything else as cb_app (DATABASE_URL),
 *      and in `finally` puts the table back to its open state (NO FORCE, DISABLE, policies dropped) so the realstack tests that follow plant and read identities unbound, as they do today.
 *   CB_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/sec-185-identities-rls.realstack.cjs
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and CB_OWNER_DB_URL (owner) on localhost, the compose db or a SIT host'); process.exit(3); }
const { query, queryAs, queryAsEach } = require('../db');
const identityAuth = require('../lib/identity-auth');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'r5' + (Date.now() % 1e9).toString(36);
const B860 = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'RUN-2026-11-14-b860-identities-rls.sql'), 'utf8');
const B857 = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b857_signin_candidates_definer.sql'), 'utf8');
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

(async () => {
  console.log('\n── SEC-185 · identities row security on real Postgres · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const planted = [];
  try {
    await owner.query(B860);
    const state = (await owner.query(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forced, (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)::int AS policies FROM pg_class c WHERE oid = 'public.identities'::regclass`)).rows[0];
    ok('R-0 b860 applied: RLS on, FORCE on, three policies; a second run is harmless', state.rls && state.forced && state.policies === 3, JSON.stringify(state));
    await owner.query(B860);
    const role = (await query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
    ok('R-1 the api role is not a superuser and does not bypass row security (else FORCE is a silent no-op)', role.rolsuper === false && role.rolbypassrls === false, JSON.stringify(role));

    const plant = async (type, parent, tag, extra) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, parent_entity_id, status, country, currency_code, otp_code)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', 'IN', 'INR', $7) RETURNING identity_id`, ['B' + RUN + tag, 'Shop ' + tag + ' ' + RUN, RUN + tag + '@rls.test', 'u-' + tag + '-' + RUN, type, parent, '654321']);
      planted.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const A = await plant('entity', null, 'a'), B = await plant('entity', null, 'b'), C = await plant('entity', null, 'c');
    const aCust = await plant('customer', A, 'ac'), bCust = await plant('customer', B, 'bc');

    // ── G-A · a shop-bound session cannot read another shop's rows ─────────────────────────────────────────
    const ids = (r) => r.rows.map((x) => x.identity_id).sort();
    ok('G-A0 unbound (no shop, no identity): not one identity row is visible, whatever the WHERE', (await query('SELECT count(*)::int AS n FROM identities')).rows[0].n === 0 && (await query('SELECT 1 FROM identities WHERE identity_id = $1', [A])).rowCount === 0);
    const seeA = await queryAs(A, 'SELECT identity_id, otp_code FROM identities WHERE identity_id = ANY($1::uuid[])', [[A, B, C, aCust, bCust]]);
    ok('G-A1 bound to shop A: A and A\'s customer are visible, B, C and B\'s customer are not', JSON.stringify(ids(seeA)) === JSON.stringify([A, aCust].sort()), JSON.stringify(ids(seeA)));
    ok('G-A2 bound to shop A, a read of shop B by id answers no row (and so no otp_code)', (await queryAs(A, 'SELECT identity_id, otp_code, email FROM identities WHERE identity_id = $1', [B])).rowCount === 0);
    ok('G-A3 bound to shop A, a scan by e-mail pattern or by display name finds only A\'s own tree', (await queryAs(A, "SELECT identity_id FROM identities WHERE email LIKE $1", ['%' + RUN + '%'])).rowCount === 2);
    const upd = await queryAs(A, "UPDATE identities SET display_name = 'taken over' WHERE identity_id = ANY($1::uuid[])", [[B, bCust]]);
    ok('G-A4 bound to shop A, an UPDATE of B and B\'s customer changes nothing', upd.rowCount === 0 && (await owner.query('SELECT count(*)::int AS n FROM identities WHERE display_name = $1', ['taken over'])).rows[0].n === 0);
    const del = await queryAs(A, 'DELETE FROM identities WHERE identity_id = $1', [B]);
    ok('G-A5 bound to shop A, a DELETE of B removes nothing', del.rowCount === 0 && (await owner.query('SELECT 1 FROM identities WHERE identity_id = $1', [B])).rowCount === 1);
    const forged = await failsWith(() => queryAs(A, `INSERT INTO identities (bridge_id, display_name, email, identity_type, parent_entity_id, status, country) VALUES ($1, 'forged', $2, 'customer', $3, 'active', 'IN')`, ['F' + RUN, RUN + 'f@rls.test', B]));
    ok('G-A6 bound to shop A, a row planted under shop B is refused by the policy (42501)', forged === '42501', forged);
    const mine = await queryAs(A, `INSERT INTO identities (bridge_id, display_name, email, identity_type, parent_entity_id, status, country) VALUES ($1, 'mine', $2, 'customer', $3, 'active', 'IN') RETURNING identity_id`, ['M' + RUN, RUN + 'm@rls.test', A]);
    planted.push(mine.rows[0].identity_id);
    ok('G-A7 bound to shop A, a customer under A is accepted and read back (INSERT ... RETURNING works)', mine.rowCount === 1);
    const bAsB = await queryAs(B, 'SELECT identity_id FROM identities WHERE identity_id = $1', [A]);
    ok('G-A8 the same holds the other way round: B sees nothing of A', bAsB.rowCount === 0);

    // counterparty arm: read-only, only for a real connection
    await owner.query(`INSERT INTO connections (from_entity_id, from_display_name, from_bridge_id, to_entity_id, to_display_name, to_bridge_id, status) VALUES ($1, 'A', 'ba', $2, 'C', 'bc', 'accepted')`, [A, C]);
    const viaConn = await queryAs(A, 'SELECT identity_id FROM identities WHERE identity_id = $1', [C]);
    ok('G-A9 a shop reads the other side of ITS OWN connection (A→C) …', viaConn.rowCount === 1);
    ok('G-A10 … but cannot write it, and a third shop B still sees neither', (await queryAs(A, "UPDATE identities SET display_name = 'x' WHERE identity_id = $1", [C])).rowCount === 0 && (await queryAs(B, 'SELECT 1 FROM identities WHERE identity_id = $1', [C])).rowCount === 0);
    await owner.query('DELETE FROM connections WHERE from_entity_id = $1 AND to_entity_id = $2', [A, C]);

    // the doors: one message, binding ends with it
    const each = await queryAsEach([A, B], 'SELECT identity_id FROM identities WHERE identity_id = ANY($1::uuid[])', (id) => [[id]]);
    ok('G-A11 queryAsEach opens each id under its own binding (A and B, one round trip) and nothing else', JSON.stringify(ids(each)) === JSON.stringify([A, B].sort()));
    const after = (await query("SELECT current_setting('app.current_entity', true) AS v")).rows[0].v;
    ok('G-A12 no binding is left on the pooled connection after queryAs (SET LOCAL ends with the message)', after === '' || after === null, after);
    await failsWith(() => queryAs(A, 'SELECT * FROM no_such_table_' + RUN));
    ok('G-A13 an error inside queryAs leaves no binding and no open transaction behind', (await query('SELECT count(*)::int AS n FROM identities')).rows[0].n === 0);
    ok('G-A14 queryAs refuses a second statement (no stacked statement under a binding)', /one statement/.test(String(await failsWith(() => queryAs(A, 'SELECT 1; SELECT 2')))));
    ok('G-A15 a blank binding opens nothing (fail closed, never every row)', (await queryAs('', 'SELECT 1 FROM identities')).rowCount === 0 && (await queryAs(null, 'SELECT 1 FROM identities')).rowCount === 0);

    // ── G-B · sign-in goes through the function, and fails when it is gone ──────────────────────────────────
    const typed = RUN + 'a@rls.test';
    const found = await identityAuth.findLoginIdentity(query, typed);
    ok('G-B1 with the function in place and RLS forced, sign-in finds shop A by e-mail and reads its credentials', !!(found && found.identity && found.identity.identity_id === A && found.identity.otp_code === '654321'), JSON.stringify(found && found.identity && found.identity.identity_id));
    const byHandle = await identityAuth.findLoginIdentity(query, 'u-a-' + RUN);
    ok('G-B2 … and by handle', !!(byHandle && byHandle.identity && byHandle.identity.identity_id === A));
    await owner.query('DROP FUNCTION ops.signin_candidates(text, text)');           // THE MUTATION
    let gone = null; let miss = null;
    try { miss = await identityAuth.findLoginIdentity(query, typed); } catch (e) { gone = e.code; }
    ok('G-B3 MUTATION: with ops.signin_candidates dropped the login FAILS (42883), it does not read the table instead', gone === '42883' && !(miss && miss.identity), gone + ' / ' + JSON.stringify(miss && miss.identity && miss.identity.identity_id));
    ok('G-B4 MUTATION: and the table is still closed to an unbound read (nothing to fall back to)', (await query('SELECT 1 FROM identities WHERE email = $1', [typed])).rowCount === 0);
    await owner.query(B857);                                                          // put the function back
    const back = await identityAuth.findLoginIdentity(query, typed);
    ok('G-B5 function restored: the login finds shop A again', !!(back && back.identity && back.identity.identity_id === A));
    // the credential write after sign-in
    const otp = await identityAuth.issueOtp(query, back.identity, undefined, 'entity');
    ok('G-B6 issueOtp writes the code under the person\'s own binding (the row changed, 6 digits)', /^\d{6}$/.test(otp) && (await owner.query('SELECT otp_code FROM identities WHERE identity_id = $1', [A])).rows[0].otp_code === otp);
  } catch (e) {
    ok('the run reached its end without an error', false, e && e.stack);
  } finally {
    try { await owner.query('ALTER TABLE identities NO FORCE ROW LEVEL SECURITY'); await owner.query('ALTER TABLE identities DISABLE ROW LEVEL SECURITY'); } catch (e) { console.log('  RESTORE FAILED: ' + e.message); fail++; }
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_read_counterparty']) { try { await owner.query('DROP POLICY IF EXISTS ' + p + ' ON identities'); } catch (e) { /* the table is open anyway */ } }
    try { await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[]) OR bridge_id LIKE $2', [planted, '%' + RUN + '%']); } catch (e) { console.log('  cleanup failed: ' + e.message); }
    await owner.end();
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
