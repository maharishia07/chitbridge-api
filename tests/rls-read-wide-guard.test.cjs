/** l16: the runtime tripwire exempts the read-wide tables for READS only; a bare write still trips it. CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data */
process.env.RLS_GUARD = 'throw';
const { rlsGuardCheck, RLS_TENANT_TABLES } = require('../db');
let fail = 0;
const t = (name, cond) => { console.log((cond ? '   ok   ' : '   FAIL ') + name); if (!cond) fail++; };
const trips = (sql) => { try { rlsGuardCheck(sql); return false; } catch (e) { return /RLS-GUARD/.test(e.message); } };
const wide = ['catalogue_source', 'standard_source', 'product_container', 'media_blobs', 'network_revoked', 'membership_certificate', 'registry_entry', 'registry_cursor', 'registry_change'];
for (const w of wide) {
  t(w + ' is in the tenant list', RLS_TENANT_TABLES.includes(w));
  t(w + ': bare SELECT is quiet', !trips('SELECT * FROM ' + w + ' WHERE 1=1'));
  t(w + ': bare INSERT trips', trips('INSERT INTO ' + w + ' (a) VALUES (1)'));
  t(w + ': bare UPDATE trips', trips('UPDATE ' + w + ' SET a = 1'));
  t(w + ': bare DELETE trips', trips('DELETE FROM ' + w + ' WHERE a = 1'));
}
t('a shop table still trips on SELECT', trips('SELECT * FROM chit_header'));
console.log(fail ? '\n  ✗ ' + fail + ' failed' : '\n  ✓ all passed');
process.exit(fail ? 1 : 0);
