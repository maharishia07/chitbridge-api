'use strict';
/**
 * tests/one-customer-1138.realstack.cjs — ONE-CUSTOMER (28 Nov 2026) on a REAL Postgres: the one reader (lib/customer-groups CUSTOMER_ROLE_SQL) and the backfill file migrations/b912_customer_role_backfill_1138.sql.
 * HAND-COMPUTED  shop S; parties on S's supplier list: A (never billed), B (2 sent invoices + 1 credit note = 3 sales bills), C (sent only an order), E (an invoice that is still a draft);
 *   D is a plain customer (never a supplier); F is a supplier S has billed AND already holds a customer row for (a row an earlier send made).
 *   before the backfill: the customers list (CUSTOMER_ROLE_SQL over S's customer_list) shows D and F only; B has no row at all.
 *   the backfill inserts exactly 1 row (B: txn_count 3, added_via transaction); a second run inserts 0; A, C and E get none.   after it: the list shows B, D, F; a hidden-by-supplier A row stays out.
 * Run: DATABASE_URL_OWNER=postgres://postgres:cblocal@127.0.0.1:55432/cb_local DATABASE_URL=postgres://cb_app:cblocal@127.0.0.1:55432/cb_local node tests/one-customer-1138.realstack.cjs
 * CARD  11-crm-and-marketing
 */
const owner = process.env.DATABASE_URL_OWNER || '', url = process.env.DATABASE_URL || '';
const HOSTS = /@(localhost|127\.0\.0\.1|db)[:/]/;
if (!HOSTS.test(owner) || !HOSTS.test(url) || !/^postgres(ql)?:\/\/cb_app:/.test(url)) { console.error('REFUSED: needs DATABASE_URL (cb_app) and DATABASE_URL_OWNER on localhost or the compose db'); process.exit(3); }
process.env.NODE_ENV = 'test';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require('pg');
const API = path.join(__dirname, '..');
const { withEntity } = require(path.join(API, 'db'));
const groups = require(path.join(API, 'lib', 'customer-groups'));
let pass = 0, fail = 0;
const eq = (what, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + '\n         got ' + g + ' want ' + w); } };
const RUN = 'oc' + (Date.now() % 1e9).toString(36);
const uuid = () => crypto.randomUUID();

(async () => {
  const o = new Client({ connectionString: owner }); await o.connect();
  const made = [];
  const ident = async (tag) => { const id = uuid(); await o.query(`INSERT INTO identities (identity_id, bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1,$2,$3,'entity','AU','AUD',$4)`, [id, ('CB' + RUN + tag).toUpperCase(), tag + ' ' + RUN, (RUN + tag).toLowerCase()]); made.push(id); return id; };
  const S = await ident('s'), P = {}; for (const t of ['a', 'b', 'c', 'd', 'e', 'f']) P[t] = await ident(t);
  const sup = (id) => o.query(`INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, added_via) VALUES ($1,$2,'manual')`, [S, id]);
  for (const t of ['a', 'b', 'c', 'e', 'f']) await sup(P[t]);
  const cust = (id) => o.query(`INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count) VALUES ($1,$2,'entity','transaction',1)`, [S, id]);
  await cust(P.d); await cust(P.f); await cust(P.a); /* A holds a row (e.g. added by hand) but was never billed: it stays out of Customers */
  const sent = (to, purpose, role) => o.query(
    `INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name, all_recipients, purpose, sent_at, role, direction)
     VALUES ($1,$2,$2,'CB'||$5,'S',$3::jsonb,$4,CASE WHEN $6 = 'Draft' THEN NULL ELSE now() END,$6,'sent')`,
    [uuid(), S, JSON.stringify([{ entity_id: S, role: 'sender' }, { entity_id: to, role: 'to' }]), purpose, RUN, role || 'Act']);
  await sent(P.b, 'invoice'); await sent(P.b, 'invoice'); await sent(P.b, 'credit_note'); await sent(P.c, 'order'); await sent(P.e, 'invoice', 'Draft'); await sent(P.f, 'invoice');

  const shown = async () => (await withEntity(S, (db) => db.query(
    `SELECT cl.customer_identity_id AS id FROM customer_list cl WHERE cl.owner_entity_id = $1 AND ${groups.CUSTOMER_ROLE_SQL}`, [S]))).rows.map((r) => r.id).sort();
  const sorted = (...t) => t.map((x) => P[x]).sort();
  try {
    eq('before the backfill the customers list is D and F (F was billed; A is a supplier never billed)', await shown(), sorted('d', 'f'));
    const file = fs.readFileSync(path.join(API, 'migrations', 'b912_customer_role_backfill_1138.sql'), 'utf8');
    /* the file is global (every shop): run it, then count only this run's shop */
    await o.query(file);
    const rows = (await o.query(`SELECT customer_identity_id AS id, txn_count, added_via FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = ANY($2)`, [S, [P.a, P.b, P.c, P.e].map(String)])).rows;
    eq('the backfill filed B (3 sales bills, via transaction) and nobody else of A, C, E', rows.filter((r) => r.id !== P.a).map((r) => [r.id === P.b ? 'b' : r.id, r.txn_count, r.added_via]), [['b', 3, 'transaction']]);
    const before = (await o.query('SELECT count(*)::int AS n FROM customer_list')).rows[0].n;
    await o.query(file);
    eq('a second run inserts 0 rows (idempotent)', (await o.query('SELECT count(*)::int AS n FROM customer_list')).rows[0].n - before, 0);
    eq('after it the customers list is B, D, F; A (never billed) stays out', await shown(), sorted('b', 'd', 'f'));
  } finally {
    await o.query('DELETE FROM chit_header WHERE entity_id = $1', [S]); await o.query('DELETE FROM customer_list WHERE owner_entity_id = $1', [S]); await o.query('DELETE FROM supplier_list WHERE owner_entity_id = $1', [S]);
    await o.query('DELETE FROM identities WHERE identity_id = ANY($1)', [made]).catch(() => {}); await o.end();
  }
  console.log('\n   ' + pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   CRASH ' + (e && e.stack)); process.exit(1); });
