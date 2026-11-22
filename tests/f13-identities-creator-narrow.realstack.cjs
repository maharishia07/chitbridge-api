'use strict';
/**
 * tests/f13-identities-creator-narrow.realstack.cjs — F13 (platform-10): the shop that MINTED an identity may not delete it, and may not change it once the person has claimed it
 * (network-provisioned stores excepted). REAL Postgres, driven as cb_app (NOBYPASSRLS); rows planted and files applied as the owner.
 * CARD      18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 *   CB_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/f13-identities-creator-narrow.realstack.cjs
 * Applies b860 and the b909 file itself, and in `finally` puts identities back to open (NO FORCE, DISABLE, policies dropped). FAILS ON THE PARENT: with b860's FOR ALL creator arm (before b909) C-2 and C-4 fail.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and CB_OWNER_DB_URL (owner) on localhost, the compose db or a SIT host'); process.exit(3); }
const { queryAs } = require('../db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'f13' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const MIG = path.join(__dirname, '..', 'migrations');
const B860 = fs.readFileSync(path.join(MIG, 'RUN-2026-11-14-b860-identities-rls.sql'), 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''); /* the A2 guard is proved in tests/b860-guard.test.cjs; these stacks test the policies */
const B909 = fs.readFileSync(path.join(MIG, 'RUN-2026-11-22-b909-identities-creator-narrow.sql'), 'utf8');

(async () => {
  console.log('\n── F13 · identities creator arm on real Postgres · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const planted = [];
  try {
    await owner.query(B860);
    await owner.query(B909);
    await owner.query(B909); // idempotent
    const pol = (await owner.query("SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.identities'::regclass AND polname LIKE 'identities_created_by_me%' ORDER BY 1")).rows;
    ok('C-0 b909 applied twice: three creator policies (insert a, read r, update w) and the wide FOR ALL one is gone', pol.length === 3 && !pol.some((p) => p.polname === 'identities_created_by_me') && pol.map((p) => p.polcmd).sort().join('') === 'arw', JSON.stringify(pol));

    const plant = async (tag, createdBy, claimed, kind) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, status, country, currency_code, created_by, last_active_at, entity_kind)
        VALUES ($1, $2, $3, $4, 'entity', 'active', 'IN', 'INR', $5, $6, $7) RETURNING identity_id`, ['B' + RUN + tag, 'Store ' + tag + ' ' + RUN, RUN + tag + '@rls.test', 'u-' + tag + '-' + RUN, createdBy, claimed ? new Date() : null, kind || 'customer']);
      planted.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const head = await plant('h', null, true), other = await plant('o', null, true);
    const unclaimed = await plant('u', head, false), claimed = await plant('c', head, true), network = await plant('n', head, true, 'network'), foreign = await plant('f', other, false);

    const name = async (id) => (await owner.query('SELECT display_name FROM identities WHERE identity_id = $1', [id])).rows[0].display_name;
    const rename = (as, id) => queryAs(as, "UPDATE identities SET display_name = 'edited' WHERE identity_id = $1", [id]);

    ok('C-1 the creator still changes an UNCLAIMED identity it minted (corrects what it typed)', (await rename(head, unclaimed)).rowCount === 1 && (await name(unclaimed)) === 'edited');
    ok('C-2 the creator can NOT change an identity once the person has CLAIMED it (last_active_at set)', (await rename(head, claimed)).rowCount === 0 && (await name(claimed)) !== 'edited');
    ok('C-3 a store the creator PROVISIONED (entity_kind network) stays arranged by it after the claim', (await rename(head, network)).rowCount === 1 && (await name(network)) === 'edited');
    const delU = await queryAs(head, 'DELETE FROM identities WHERE identity_id = ANY($1::uuid[])', [[unclaimed, claimed, network]]);
    ok('C-4 the creator can delete NONE of them, unclaimed, claimed or network: it ends a link instead', delU.rowCount === 0 && (await owner.query('SELECT count(*)::int AS n FROM identities WHERE identity_id = ANY($1::uuid[])', [[unclaimed, claimed, network]])).rows[0].n === 3);
    ok('C-5 another shop cannot change or delete any of them (positive control: it can change its own)', (await rename(other, unclaimed)).rowCount === 0 && (await queryAs(other, 'DELETE FROM identities WHERE identity_id = $1', [claimed])).rowCount === 0 && (await rename(other, foreign)).rowCount === 1);
    ok('C-6 the creator still READS what it minted (INSERT ... RETURNING keeps working)', (await queryAs(head, 'SELECT identity_id FROM identities WHERE identity_id = ANY($1::uuid[])', [[unclaimed, claimed, network]])).rowCount === 3);
    const ins = await queryAs(head, "INSERT INTO identities (bridge_id, display_name, email, identity_type, status, country, created_by) VALUES ($1, 'new', $2, 'entity', 'active', 'IN', $3) RETURNING identity_id", ['N' + RUN, RUN + 'n2@rls.test', head]);
    planted.push(ins.rows[0].identity_id);
    ok('C-7 the creator can still mint (INSERT ... RETURNING under created_by = me)', ins.rowCount === 1);
    let handed = null; try { await queryAs(head, 'UPDATE identities SET created_by = $2 WHERE identity_id = $1', [unclaimed, other]); handed = 'allowed'; } catch (e) { handed = e.code; }
    ok('C-8 the creator cannot hand an unclaimed row to another shop (WITH CHECK)', handed === '42501', handed);
  } catch (e) {
    ok('the run reached its end without an error', false, e && e.stack);
  } finally {
    try { await owner.query('ALTER TABLE identities NO FORCE ROW LEVEL SECURITY'); await owner.query('ALTER TABLE identities DISABLE ROW LEVEL SECURITY'); } catch (e) { console.log('  RESTORE FAILED: ' + e.message); fail++; }
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_created_by_me_read', 'identities_created_by_me_insert', 'identities_created_by_me_update', 'identities_read_counterparty']) { try { await owner.query('DROP POLICY IF EXISTS ' + p + ' ON identities'); } catch (e) { /* the table is open anyway */ } }
    try { await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[]) OR bridge_id LIKE $2', [planted, '%' + RUN + '%']); } catch (e) { console.log('  cleanup failed: ' + e.message); }
    await owner.end();
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
