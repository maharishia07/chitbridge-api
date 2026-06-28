// scripts/check-db-role.js — answers B1 open-question #1: does the API's DB role BYPASS Row-Level Security?
// Runs through the SAME connection the app uses (process.env.DATABASE_URL), so it reports the REAL role —
// not the Supabase SQL-editor's `postgres` superuser. Run on the dev box (where DATABASE_URL is set):
//     node scripts/check-db-role.js
// Read-only; connects, prints, disconnects. No changes.
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set in this environment.'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `SELECT current_user, session_user, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
  );
  const r = rows[0] || {};
  const bypass = !!(r.rolsuper || r.rolbypassrls);
  console.log('Connected as   :', r.current_user, '(session_user:', (r.session_user || '?') + ')');
  console.log('rolsuper       :', r.rolsuper);
  console.log('rolbypassrls   :', r.rolbypassrls);
  console.log('----------------------------------------------');
  console.log('RLS for B1 will be:', bypass
    ? 'BYPASSED  ❌  — this role ignores RLS, so B1 would be a no-op.\n'
      + '                 Fix: connect the API as a dedicated role with NOSUPERUSER + NOBYPASSRLS\n'
      + '                 (grant it only the needed table privileges), then point DATABASE_URL at it.'
    : 'ENFORCED  ✅  — RLS will apply to this role. Good to proceed with B1.');
  await c.end();
})().catch((e) => { console.error('check failed:', e.message); process.exit(1); });
