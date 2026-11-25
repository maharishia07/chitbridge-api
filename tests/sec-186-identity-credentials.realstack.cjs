'use strict';
/**
 * tests/sec-186-identity-credentials.realstack.cjs — SEC-186: with b860 (counterparty arm), the grant-party arm, b874 and the REVOKE file applied, a shop reads other shops' NAMES but never
 * pin_hash, otp_code or otp_code_hash of any person; sign-in and OTP still work. REAL Postgres, driven as cb_app (NOBYPASSRLS); rows planted and files applied as the owner.
 *   CB_OWNER_DB_URL=postgres://postgres:...@localhost/db DATABASE_URL=postgres://cb_app:...@localhost/db node tests/sec-186-identity-credentials.realstack.cjs
 * Needs a database built from the chain (b874 included); applies the RUN- files itself and puts identities back to open (NO FORCE, DISABLE, policies dropped, SELECT regranted) in `finally`.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|[a-z0-9_-]+)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and CB_OWNER_DB_URL (owner)'); process.exit(3); }
const { query, queryAs } = require('../db');
const identityAuth = require('../lib/identity-auth');
const otp = require('../lib/otp');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 's6' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const file = (n) => fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8');
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const REVOKE = 'RUN-2026-11-16-sec-186-revoke-credential-columns.sql';

(async () => {
  console.log('\n── SEC-186 · identity credentials on real Postgres · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const planted = [];
  try {
    for (const n of [REVOKE, 'RUN-2026-11-14-b860-identities-rls.sql', 'RUN-2026-11-16-identities-read-grant-party.sql', REVOKE]) await owner.query(file(n)); // the revoke twice: harmless
    const plant = async (type, parent, tag, pin, code, hash) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, parent_entity_id, status, country, currency_code, pin_hash, otp_code, otp_code_hash, otp_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', 'IN', 'INR', $7, $8, $9, now() + interval '1 hour') RETURNING identity_id`, ['B' + RUN + tag, 'Name ' + tag + ' ' + RUN, RUN + tag + '@s186.test', 'u-' + tag + '-' + RUN, type, parent, pin, code, hash]);
      planted.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const A = await plant('entity', null, 'a', null, '111111', null), B = await plant('entity', null, 'b', null, '222222', 'hashB');
    const bStaff = await plant('actor', B, 'bs', '$2b$10$bstaffhash', null, null);
    const FIRM = await plant('entity', null, 'f', null, '333333', null), firmP = await plant('customer', FIRM, 'fp', '$2b$10$firmperson', '444444', null);
    await owner.query(`INSERT INTO connections (from_entity_id, from_display_name, from_bridge_id, to_entity_id, to_display_name, to_bridge_id, status) VALUES ($1, 'A', 'ba', $2, 'B', 'bb', 'accepted')`, [A, B]);
    await owner.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, purpose, granted_by, expires_at) VALUES ($1, $2, 'sec186 test', $1, now() + interval '1 day')`, [A, FIRM]);

    const rls = (await owner.query(`SELECT relrowsecurity r, relforcerowsecurity f, (SELECT count(*) FROM pg_policy WHERE polrelid=c.oid)::int p FROM pg_class c WHERE oid='public.identities'::regclass`)).rows[0];
    ok('S-0 b860 + grant arm applied: RLS forced, 4 policies', rls.r && rls.f && rls.p === 4, JSON.stringify(rls));
    const blocked = (await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='identities' AND NOT has_column_privilege('cb_app','public.identities',column_name,'SELECT') ORDER BY 1`)).rows.map((r) => r.column_name);
    ok('S-1 the columns cb_app cannot SELECT are EXACTLY otp_code, otp_code_hash, pin_hash (a new column added without a grant fails here)', JSON.stringify(blocked) === JSON.stringify(['otp_code', 'otp_code_hash', 'pin_hash']), JSON.stringify(blocked));

    const tp = (await owner.query("SELECT has_table_privilege('cb_app','public.identities','SELECT') AS t, has_column_privilege('cb_app','public.identities','pin_hash','SELECT') AS p, has_column_privilege('cb_app','public.identities','otp_code','SELECT') AS o, has_column_privilege('cb_app','public.identities','otp_code_hash','SELECT') AS h")).rows[0];
    ok('S-1b cb_app holds NO table-level SELECT on identities and none on the three columns (a blanket GRANT or re-baseline would flip this)', !tp.t && !tp.p && !tp.o && !tp.h, JSON.stringify(tp));
    const names = await queryAs(A, 'SELECT identity_id, display_name, email FROM identities WHERE identity_id = ANY($1::uuid[])', [[B, FIRM, firmP]]);
    ok('S-2 shop A (connected to B, grantor to FIRM) READS the names of B, FIRM and the firm person', names.rowCount === 3 && names.rows.every((r) => /^Name /.test(r.display_name)), names.rowCount);
    for (const col of ['pin_hash', 'otp_code', 'otp_code_hash']) {
      ok('S-3 ' + col + ': reading another shop\'s person by id is permission denied', (await failsWith(() => queryAs(A, `SELECT ${col} FROM identities WHERE identity_id = $1`, [B]))) === '42501');
      ok('S-3 ' + col + ': … also for the shop\'s own staff (no direct read at all)', (await failsWith(() => queryAs(B, `SELECT ${col} FROM identities WHERE identity_id = $1`, [bStaff]))) === '42501');
      ok('S-3 ' + col + ': … and in a WHERE (no oracle)', (await failsWith(() => queryAs(A, `SELECT 1 FROM identities WHERE ${col} IS NOT NULL`))) === '42501');
    }
    ok('S-4 SELECT * and a whole-row to_jsonb(i) on identities are refused too', (await failsWith(() => queryAs(A, 'SELECT * FROM identities WHERE identity_id = $1', [B]))) === '42501' && (await failsWith(() => queryAs(A, 'SELECT to_jsonb(i) FROM identities i WHERE identity_id = $1', [B]))) === '42501');
    const vOther = await queryAs(A, 'SELECT * FROM ops.identity_secret WHERE for_identity = ANY($1::uuid[])', [[B, FIRM, firmP, bStaff]]);
    ok('S-5 the view answers nothing for another shop, a counterparty, a grant party or their people', vOther.rowCount === 0, vOther.rowCount);
    const vOwn = await queryAs(B, 'SELECT for_identity, pin_hash, otp_code, otp_code_hash, has_pin, has_code FROM ops.identity_secret ORDER BY for_identity');
    const byId = Object.fromEntries(vOwn.rows.map((r) => [r.for_identity, r]));
    ok('S-6 bound to B the view gives B its own code and hash and its own staff PIN hash (own tree), nothing of anyone else', vOwn.rowCount === 2 && byId[B].otp_code === '222222' && byId[B].otp_code_hash === 'hashB' && !!byId[bStaff].pin_hash && byId[bStaff].has_pin === true, JSON.stringify(vOwn.rows).slice(0, 200));
    ok('S-7 unbound: the view answers no row', (await query('SELECT 1 FROM ops.identity_secret')).rowCount === 0);
    const found = await identityAuth.findLoginIdentity(query, RUN + 'b@s186.test');
    ok('S-8 sign-in by e-mail finds shop B and reads its code and hash (through the view)', !!(found && found.identity && found.identity.identity_id === B && found.identity.otp_code === '222222' && found.identity.otp_code_hash === 'hashB'), JSON.stringify(found && found.identity && found.identity.identity_id));
    const issued = await identityAuth.issueOtp(query, found.identity, undefined, 'entity');
    ok('S-9 issueOtp still writes the code (a column UPDATE needs no SELECT)', /^\d{6}$/.test(issued) && (await owner.query('SELECT otp_code FROM identities WHERE identity_id=$1', [B])).rows[0].otp_code === issued);
    const cust = await plant('customer', A, 'ac', null, '987654', null);
    const spent = await otp.spendShopperOtp(query, cust, '987654');
    const again = await otp.spendShopperOtp(query, cust, '987654');
    ok('S-10 the shopper code is spent ONCE (compare-and-clear inside the owner function): first true, second false', spent === true && again === false, spent + '/' + again);
    const cust2 = await plant('customer', A, 'ac2', null, '135790', null);
    ok('S-11 a wrong code, or another shop\'s binding, spends nothing', (await otp.spendShopperOtp(query, cust2, '000000')) === false && (await queryAs(B, 'SELECT ops.spend_shopper_code($1::uuid, $2) AS s', [cust2, '135790'])).rows[0].s === false && (await owner.query('SELECT otp_code FROM identities WHERE identity_id=$1', [cust2])).rows[0].otp_code === '135790');
    const cust3 = await plant('customer', A, 'ac3', null, '246810', null);
    const race = await Promise.all([1, 2, 3, 4, 5, 6].map(() => otp.spendShopperOtp(query, cust3, '246810')));
    ok('S-12 six racing spends of one code: exactly one wins', race.filter((x) => x === true).length === 1, JSON.stringify(race));
  } catch (e) {
    ok('the run reached its end without an error', false, e && e.stack);
  } finally {
    try { await owner.query('GRANT SELECT ON identities TO cb_app'); await owner.query('ALTER TABLE identities NO FORCE ROW LEVEL SECURITY'); await owner.query('ALTER TABLE identities DISABLE ROW LEVEL SECURITY'); } catch (e) { console.log('  RESTORE FAILED: ' + e.message); fail++; }
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_read_counterparty', 'identities_read_grant_party']) { try { await owner.query('DROP POLICY IF EXISTS ' + p + ' ON identities'); } catch (e) { /* open anyway */ } }
    try { await owner.query('DELETE FROM connections WHERE from_entity_id = ANY($1::uuid[])', [planted]); await owner.query('DELETE FROM books_access_grant WHERE grantor_entity = ANY($1::uuid[])', [planted]); await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[]) OR bridge_id LIKE $2', [planted, '%' + RUN + '%']); } catch (e) { console.log('  cleanup failed: ' + e.message); }
    await owner.end();
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
