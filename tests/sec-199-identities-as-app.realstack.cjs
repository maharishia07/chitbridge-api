'use strict';
/**
 * tests/sec-199-identities-as-app.realstack.cjs — SEC-199 / SEC-198: the grant, practice and identity reads run AS cb_app on a REAL Postgres with the SEC-186 revokes applied, so a whole-row identities read
 * fails here and not on sit-au. Unit tests run with full rights and never see 42501.
 *   1 armed: a whole-row read (to_jsonb(i)) as cb_app answers 42501 (without this the rest proves nothing)
 *   2 lib/books-grant.js list(firm) answers (the 244e603dd923 bug: the client list was a 500)    3 lib/work-client.js readClients names the client from its own identities row, as cb_app
 *   4 the SEC-198 door: with b860 on, boundRead(query, id, 'SELECT ... FROM identities WHERE identity_id = $1') opens the row and the plain query does not (the 62 sites moved to it)
 * Run: CB_OWNER_DB_URL=postgres://postgres:...@localhost/db DATABASE_URL=postgres://cb_app:...@localhost/db node tests/sec-199-identities-as-app.realstack.cjs   (owner role: plants rows, applies the RUN files, puts identities back to open in finally)
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.CB_OWNER_DB_URL || '';
const hostOk = (u) => { const m = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(u); return !!m && /^(localhost|127\.0\.0\.1|db|[a-z0-9_-]+)$/.test(m[2]); };
if (!hostOk(url) || !hostOk(ownerUrl) || !/\/\/cb_app:/.test(url)) { console.error('REFUSED: needs DATABASE_URL as cb_app and CB_OWNER_DB_URL (owner)'); process.exit(3); }
process.env.NODE_ENV = 'test';
const { query } = require('../db');
const { boundRead } = require('../lib/bound-read');
const grants = require('../lib/books-grant');
const workClient = require('../lib/work-client');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 's9' + (Date.now() % 1e9).toString(36).padStart(6, '0');
const file = (n) => fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8');
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

(async () => {
  console.log('\n── SEC-199 · identities reads as cb_app with the SEC-186 revokes · run ' + RUN + ' ──');
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const planted = [];
  try {
    for (const n of ['RUN-2026-11-16-sec-186-revoke-credential-columns.sql', 'RUN-2026-11-14-b860-identities-rls.sql', 'RUN-2026-11-16-identities-read-grant-party.sql']) await owner.query(file(n));
    const plant = async (tag) => {
      const r = await owner.query(`INSERT INTO identities (bridge_id, display_name, email, user_id, identity_type, status, country, currency_code, pin_hash) VALUES ($1, $2, $3, $4, 'entity', 'active', 'AU', 'AUD', 'x') RETURNING identity_id`, ['B' + RUN + tag, 'Name ' + tag + ' ' + RUN, RUN + tag + '@s199.test', 'u-' + RUN + tag]);
      planted.push(r.rows[0].identity_id); return r.rows[0].identity_id;
    };
    const client = await plant('c'), firm = await plant('f');
    await owner.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, purpose, granted_by, expires_at) VALUES ($1, $2, 'sec199 test', $1, now() + interval '1 day')`, [client, firm]);

    ok('1 armed: a whole-row identities read as cb_app is refused 42501', (await failsWith(() => query('SELECT to_jsonb(i) FROM identities i LIMIT 1'))) === '42501');
    let listed = null, why = null;
    try { listed = await grants.list(firm); } catch (e) { why = e.code || e.message; }
    ok('2 books-grant list(firm) answers as cb_app and names the client it holds a grant from', !why && listed && JSON.stringify(listed).indexOf(client) >= 0, why || JSON.stringify(listed));
    let facts = null; why = null;
    try { facts = await workClient.readClients([client]); } catch (e) { why = e.code || e.message; }
    const row = facts && facts.get(String(client));
    ok('3 work-client readClients reads the client\'s name, country and money from its own identities row', !why && row && row.identity && row.identity.country === 'AU' && row.identity.currency_code === 'AUD', why || JSON.stringify(row));
    const text = 'SELECT display_name FROM identities WHERE identity_id = $1';
    const unbound = await query(text, [client]);
    const bound = await boundRead(query, client, text, [client]);
    ok('4 with b860 on, the plain query sees no row and boundRead opens the row', unbound.rows.length === 0 && bound.rows.length === 1 && bound.rows[0].display_name === 'Name c ' + RUN, 'unbound ' + unbound.rows.length + ' bound ' + bound.rows.length);
  } catch (e) { fail++; console.log('  FAIL setup/run: ' + String(e && e.message).slice(0, 300)); } finally {
    try { await owner.query('GRANT SELECT ON identities TO cb_app'); await owner.query('ALTER TABLE identities NO FORCE ROW LEVEL SECURITY'); await owner.query('ALTER TABLE identities DISABLE ROW LEVEL SECURITY'); } catch (e) { console.log('  RESTORE FAILED: ' + e.message); }
    for (const p of ['identities_own_tree', 'identities_created_by_me', 'identities_read_counterparty', 'identities_read_grant_party']) { try { await owner.query('DROP POLICY IF EXISTS ' + p + ' ON identities'); } catch (e) { /* open anyway */ } }
    try { await owner.query('DELETE FROM books_access_grant WHERE grantor_entity = ANY($1::uuid[])', [planted]); await owner.query('DELETE FROM identities WHERE identity_id = ANY($1::uuid[])', [planted]); } catch (e) { console.log('  CLEANUP: ' + e.message); }
    await owner.end();
  }
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
