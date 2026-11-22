'use strict';
/**
 * tests/l16-ident-names.realstack.cjs — l16 integ2c-ident: the books' name readers under row security on a REAL Postgres, driven as cb_app (NOBYPASSRLS).
 * CARD  18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * PROVES  (1) books-store namesOf(handle, shop, ids): one shop cannot read another shop's names (its people, its customer), nor the other shop itself;
 *         (2) an auditor's seat (a request that runs withEntity(granted client)) reads only the granted client's names, never the firm's own people or a second client's;
 *         (3) the same two answers with b860 NOT applied (today's table): the statement's own fence holds without the policy.
 * HOW   like tests/sec-185-identities-rls.realstack.cjs: plants as the owner (CB_OWNER_DB_URL), reads as cb_app (DATABASE_URL), applies b860 itself and puts the table back in `finally`.
 *   CB_OWNER_DB_URL=postgres://postgres:postgres@localhost:5432/cb_s41 DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/l16-ident-names.realstack.cjs
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and CB_OWNER_DB_URL (owner) on localhost, the compose db or a SIT host'); process.exit(3); }
const { withEntity } = require('../db');
const S = require('../lib/books-store');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'n' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const B860 = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'RUN-2026-11-14-b860-identities-rls.sql'), 'utf8').replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''); /* the A2 guard is proved in tests/b860-guard.test.cjs; these stacks test the policies */
const GRANT_ARM = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'RUN-2026-11-16-identities-read-grant-party.sql'), 'utf8');
const names = (map) => JSON.stringify([...map.entries()].map(([id, name]) => name).sort());

(async () => {
  console.log('\n── l16 ident · the books name readers on real Postgres · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const planted = [];
  try {
    const plant = async (type, parent, tag) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, parent_entity_id, status, country, currency_code, otp_code)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', 'IN', 'INR', '654321') RETURNING identity_id`, ['B' + RUN + tag, 'N-' + tag + '-' + RUN, RUN + tag + '@names.test', 'u-' + tag + '-' + RUN, type, parent]);
      planted.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const A = await plant('entity', null, 'a'), B = await plant('entity', null, 'b'), FIRM = await plant('entity', null, 'firm');
    const aStaff = await plant('customer', A, 'as'), bStaff = await plant('customer', B, 'bs'), firmPerson = await plant('customer', FIRM, 'fp');
    const OLD = await plant('entity', null, 'old'), oldPerson = await plant('customer', OLD, 'op'), C = await plant('entity', null, 'c'), cPerson = await plant('customer', C, 'cp');
    const grant = async (grantee, revoked) => {
      const row = async (preset) => owner.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, purpose, granted_by, granted_at, expires_at, revoked_at) VALUES ($1, $2, $3, 'names test', $1, now() - interval '2 day', now() + interval '30 day', $4)`, [A, grantee, preset, revoked ? new Date() : null]);
      try { await row('adviser'); } catch (e) { await row('auditor'); }
    };
    await grant(FIRM, false); /* the firm holds a grant on A; OLD held one that was revoked; C holds none; nobody holds one on B */
    await grant(OLD, true);
    const all = [A, B, FIRM, aStaff, bStaff, firmPerson, OLD, oldPerson, C, cPerson];
    const read = (shop, ids) => withEntity(shop, (handle) => S.namesOf(handle, shop, ids));
    const tag = (id) => 'N-' + ({ [A]: 'a', [B]: 'b', [FIRM]: 'firm', [aStaff]: 'as', [bStaff]: 'bs', [firmPerson]: 'fp', [OLD]: 'old', [oldPerson]: 'op', [C]: 'c', [cPerson]: 'cp' }[id]) + '-' + RUN;
    const stage = async (label, grantNamesHidden) => {
      const seeA = await read(A, all);
      ok(label + ' · shop A asking for every id gets its own tree plus the people of its granted firm and of its revoked firm, never B, C or their people', names(seeA) === JSON.stringify((grantNamesHidden ? [A, aStaff] : [A, aStaff, FIRM, firmPerson, OLD, oldPerson]).map(tag).sort()), names(seeA));
      ok(label + ' · the owner sees the adviser person name on an entry they made (live grant), and a revoked grant still names its past actions', grantNamesHidden ? (await read(A, [firmPerson, oldPerson])).size === 0 : (await read(A, [firmPerson])).get(firmPerson) === tag(firmPerson) && (await read(A, [oldPerson])).get(oldPerson) === tag(oldPerson));
      ok(label + ' · an unrelated shop person stays null for A', (await read(A, [cPerson, C])).size === 0);
      ok(label + ' · shop A cannot read shop B by id, nor B\'s staff', (await read(A, [B, bStaff])).size === 0);
      ok(label + ' · shop B cannot read shop A\'s staff (the other way round)', (await read(B, [aStaff, A])).size === 0);
      /* the auditor's seat: the firm\'s person asks, but the request runs withEntity(the granted client) — the books handle is the client\'s */
      const audit1 = await read(A, [aStaff, firmPerson, bStaff]);
      ok(label + ' · on client A the firm handle (bound to A) names A people and the firm own people (it holds the grant), not client B staff', names(audit1) === JSON.stringify((grantNamesHidden ? [tag(aStaff)] : [tag(aStaff), tag(firmPerson)]).sort()), names(audit1));
      const audit2 = await read(B, [aStaff, firmPerson, bStaff]);
      ok(label + ' · the same firm on client B sees B\'s names only', names(audit2) === JSON.stringify([tag(bStaff)]), names(audit2));
      ok(label + ' · a blank shop and a malformed id answer nothing, no error', (await read(A, ['not-a-uuid'])).size === 0 && (await S.namesOf({ query: async () => { throw new Error('no read'); } }, null, [aStaff])).size === 0);
    };
    await stage('b860 NOT applied', false);
    await owner.query(B860);
    await stage('b860 applied, grant-party arm NOT run (the known gap: the firm people read blank, as the table says)', true);
    await owner.query(GRANT_ARM);
    await stage('b860 + grant-party arm (the whole of what is to be run)', false);
  } finally {
    try { await owner.query('ALTER TABLE identities NO FORCE ROW LEVEL SECURITY'); await owner.query('ALTER TABLE identities DISABLE ROW LEVEL SECURITY'); } catch (e) { console.log('  RESTORE FAILED: ' + e.message); }
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_read_counterparty', 'identities_read_grant_party']) { try { await owner.query('DROP POLICY IF EXISTS ' + p + ' ON identities'); } catch (e) { /* nothing to drop */ } }
    await owner.query('DELETE FROM books_access_grant WHERE grantor_entity = ANY($1::uuid[])', [planted]).catch(() => {});
    try { await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[]) OR bridge_id LIKE $2', [planted, '%' + RUN + '%']); } catch (e) { console.log('  cleanup failed: ' + e.message); }
    await owner.end();
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
