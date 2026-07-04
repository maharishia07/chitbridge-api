// scripts/rls-context-test.js — does set_config('app.current_entity',…) propagate through the cb_app connection?
// This is the exact mechanism withEntity() relies on. Run with the cb_app pooler URL + an entity_id that has chits:
//   $env:DATABASE_URL="postgresql://cb_app.<ref>:<pw>@<host>:5432/postgres"
//   node scripts/rls-context-test.js <entity_uuid>
// Read-only (BEGIN…COMMIT with only SELECTs).
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const entity = process.argv[2];
  if (!process.env.DATABASE_URL) { console.error('set DATABASE_URL first'); process.exit(2); }
  if (!entity) { console.error('pass an entity_id: node scripts/rls-context-test.js <entity_uuid>'); process.exit(2); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const who = await c.query(`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  console.log('role:', who.rows[0].current_user, '| bypassrls:', who.rows[0].rolbypassrls);

  // Mirror withEntity EXACTLY: one client, one transaction, set_config(...,true) then read.
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.current_entity', $1, true)`, [entity]);
  const ctx = await c.query(`SELECT current_setting('app.current_entity', true) AS ctx`);
  const cnt = await c.query(`SELECT count(*)::int AS n FROM chit_header`);
  await c.query('COMMIT');

  console.log('context read back inside the tx:', JSON.stringify(ctx.rows[0].ctx));
  console.log('visible chit_header rows       :', cnt.rows[0].n);
  console.log(cnt.rows[0].n > 0
    ? 'PASS — set_config propagates; the withEntity mechanism works on this connection.'
    : 'FAIL — 0 rows: set_config is NOT taking effect through this connection (pooler/transaction issue). This is the bug.');
  await c.end();
})().catch(e => { console.error('test failed:', e.message); process.exit(1); });
