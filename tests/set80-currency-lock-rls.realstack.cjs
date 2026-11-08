'use strict';
/**
 * tests/set80-currency-lock-rls.realstack.cjs — SET-80 on a REAL Postgres, as the role the api runs as (cb_app, NOBYPASSRLS).
 *
 * A network build moves a STORE's currency on the OPERATOR's handle, but the lock reads the STORE's rows (catalogue_items, chit_header, journal_entry),
 * and rls_entity shows a handle only its own entity's rows. Read on the operator's handle a traded store looks untraded and the lock FAILS OPEN —
 * a stub db cannot show it. This test seeds a store with a product and an operator (as cb_app, through withEntity), then calls currencyMoveRefusal.
 *   RLS-1  the operator's own handle cannot see the store's chits or books (the cause; chit_header, with no public door, is the probe)
 *   RLS-2  currencyMoveRefusal on the operator's handle refuses a TRADED store (it reads the store as the store)
 *   RLS-3  a store with nothing yet may move its currency (no refusal)
 * Every row it makes is deleted at the end. SIT / local only: refuses a DATABASE_URL that is not the cb_app role on a non-production host.
 * Run (inside the SIT api container, repo copy): node tests/set80-currency-lock-rls.realstack.cjs
 * CARD      20-settings-governance-and-plan/README
 */
const url = process.env.DATABASE_URL || '';
if (!/\/\/cb_app:/.test(url) || /supabase|railway|rlwy|amazonaws/i.test(url)) { console.error('REFUSED: needs DATABASE_URL as cb_app on a SIT or local database'); process.exit(3); }
const { withEntity, query } = require('../db');
const CS = require('../lib/country-setup');
const { currencyMoveRefusal } = require('../lib/network-build-run');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'sl' + (Date.now() % 1e10).toString(36);
const made = [];
/** an entity shop (INR, India) made as cb_app: returns its identity_id */
async function shop(tag) {
  const r = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN + tag, 'Lock ' + tag + ' ' + RUN]);
  made.push(r.rows[0].identity_id);
  return { id: r.rows[0].identity_id, bridge: 'CB' + RUN + tag };
}
(async () => {
  console.log('\n── SET-80 currency lock under RLS · run ' + RUN + ' ──');
  const operator = await shop('o'), traded = await shop('t'), empty = await shop('e');
  /* the store's chit: header rows are visible only as the owner (no public door, unlike catalogue_items) */
  await withEntity(traded.id, (db) => db.query(`INSERT INTO catalogue_items (entity_id) VALUES ($1)`, [traded.id]));
  const move = (store, code) => ({ key: 'k', name: 'Store', bridge_id: store.bridge, place: { to: { currency: code, city: 'Pune' } } });
  try {
    const asOperator = await withEntity(operator.id, (db) => CS.currencyLockRefusal(db, traded.id, 'USD'));
    ok('RLS-1 the lock read on the OPERATOR handle says nothing about the traded store (the fail-open the fix avoids)', asOperator === null, JSON.stringify(asOperator));
    const said = await withEntity(operator.id, (db) => currencyMoveRefusal(db, move(traded, 'USD'), { entity: operator.id }));
    ok('RLS-2 currencyMoveRefusal refuses a TRADED store, read as the store', typeof said === 'string' && /new business/i.test(said), String(said));
    const none = await withEntity(operator.id, (db) => currencyMoveRefusal(db, move(empty, 'USD'), { entity: operator.id }));
    ok('RLS-3 a store with nothing yet may move its currency', none === null, String(none));
  } finally {
    try { await withEntity(traded.id, (db) => db.query('DELETE FROM catalogue_items WHERE entity_id = $1', [traded.id])); } catch (e) { console.log('  cleanup: ' + e.message); }
    for (const id of made) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup: ' + e.message); } }
  }
  console.log('\n' + (fail ? 'FAIL ' + fail + ' · ' : 'ok ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
