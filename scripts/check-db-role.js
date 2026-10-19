// scripts/check-db-role.js — answers B1 open-question #1: does the API's DB role BYPASS Row-Level Security?   CARD 28-platform-and-operations/db-role
// OWNS the by-hand role check (the boot check is server.js checkDbRole; both use lib/db-role) · CALLED BY npm run db:role · FLOW  DATABASE_URL → connect → roleFacts → bypassesRls → verdict printed
// Runs through the SAME connection the app uses (process.env.DATABASE_URL), so it reports the REAL role —
// not the Supabase SQL-editor's `postgres` superuser. Run on the dev box (where DATABASE_URL is set):
//     node scripts/check-db-role.js
// Read-only; connects, prints, disconnects. No changes.
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in this environment.');
    process.exit(2);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const dbRole = require('../lib/db-role'); // SEC-FIX2: the one SELECT + verdict, shared with the boot check
  const r = (await dbRole.roleFacts((sql) => c.query(sql))) || {};
  const bypass = dbRole.bypassesRls(r);
  console.log('Connected as   :', r.current_user, '(session_user:', (r.session_user || '?') + ')');
  console.log('rolsuper       :', r.rolsuper);
  console.log('rolbypassrls   :', r.rolbypassrls);
  console.log('----------------------------------------------');
  console.log(
    'RLS for B1 will be:',
    bypass
      ? 'BYPASSED  ❌  — this role ignores RLS, so B1 would be a no-op.\n' +
          '                 Fix: connect the API as a dedicated role with NOSUPERUSER + NOBYPASSRLS\n' +
          '                 (grant it only the needed table privileges), then point DATABASE_URL at it.'
      : 'ENFORCED  ✅  — RLS will apply to this role. Good to proceed with B1.'
  );
  await c.end();
})().catch((e) => {
  console.error('check failed:', e.message);
  process.exit(1);
});
