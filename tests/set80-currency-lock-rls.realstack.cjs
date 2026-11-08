'use strict';
/**
 * tests/set80-currency-lock-rls.realstack.cjs — SET-80 on a REAL Postgres, as the role the api runs as (cb_app, NOBYPASSRLS).
 *
 * A network build moves a STORE's currency on the OPERATOR's handle, but the lock reads the STORE's rows (catalogue_items, chit_header, journal_entry),
 * and rls_entity shows a handle only its own entity's rows. Read on the operator's handle a traded store looks untraded and the lock FAILS OPEN —
 * a stub db cannot show it. This test seeds an operator and, per constitution leg, a store that traded by exactly that leg (as cb_app, through withEntity):
 *   RLS-1  the operator's own handle cannot see the store's rows (the cause)
 *   RLS-2  currencyMoveRefusal on the operator's handle refuses the store, for a product · a chit · a books entry (it reads the store as the store)
 *   RLS-3  a store with nothing yet may move its currency (no refusal)
 * Every row it makes is deleted at the end. Allow list: it runs only as cb_app on localhost or a SIT host; anything else is refused.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/set80-currency-lock-rls.realstack.cjs   (CI: the integration S41 job; SIT: inside the api container)
 * CARD      20-settings-governance-and-plan/README
 */
const url = process.env.DATABASE_URL || '';
/** the hosts a throwaway or SIT database may sit on: localhost, 127.0.0.1, the compose service `db`, and the SIT boxes by name */
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
const { withEntity, query } = require('../db');
const CS = require('../lib/country-setup');
const { currencyMoveRefusal } = require('../lib/network-build-run');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'sl' + (Date.now() % 1e10).toString(36);
const made = [];
/** an entity shop (INR, India) made as cb_app: its identity_id and bridge id */
async function shop(tag) {
  const bridge = 'CB' + RUN + tag;
  const row = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, [bridge, 'Lock ' + tag + ' ' + RUN]);
  made.push(row.rows[0].identity_id);
  return { id: row.rows[0].identity_id, bridge };
}
/** how a store trades, one row each, written as the store: the three things constitution() asks about */
const LEGS = {
  product: { table: 'catalogue_items', add: (db, id) => db.query('INSERT INTO catalogue_items (entity_id) VALUES ($1)', [id]) },
  chit: { table: 'chit_header', add: (db, id) => db.query(`INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name) VALUES (gen_random_uuid(), $1, $1, 'CB' || $2, 'Lock chit')`, [id, RUN]) },
  'books entry': { table: 'journal_entry', add: (db, id) => db.query(`INSERT INTO journal_entry (entity_id, entry_no, event_type, fiscal_year, period, posting_date, currency, total_minor) VALUES ($1, 'L-' || $2, 'opening', '2026-27', 1, CURRENT_DATE, 'INR', 0)`, [id, RUN]) }
};
const moveOf = (store, code) => ({ key: 'k', name: 'Store', bridge_id: store.bridge, place: { to: { currency: code, city: 'Pune' } } });
(async () => {
  console.log('\n── SET-80 currency lock under RLS · run ' + RUN + ' ──');
  const stores = [];
  try {
    const operator = await shop('o'), empty = await shop('e');
    for (const leg of Object.keys(LEGS)) {
      const store = await shop(leg.slice(0, 2));
      await withEntity(store.id, (db) => LEGS[leg].add(db, store.id));
      stores.push([leg, store]);
    }
    for (const [leg, store] of stores) {
      const asOperator = await withEntity(operator.id, (db) => CS.currencyLockRefusal(db, store.id, 'USD'));
      ok('RLS-1 (' + leg + ') the lock read on the OPERATOR handle says nothing about the traded store (the fail-open the fix avoids)', asOperator === null, JSON.stringify(asOperator));
      const said = await withEntity(operator.id, (db) => currencyMoveRefusal(db, moveOf(store, 'USD'), { entity: operator.id }));
      ok('RLS-2 (' + leg + ') currencyMoveRefusal refuses a store traded by a ' + leg + ', read as the store', typeof said === 'string' && /new business/i.test(said), String(said));
    }
    const none = await withEntity(operator.id, (db) => currencyMoveRefusal(db, moveOf(empty, 'USD'), { entity: operator.id }));
    ok('RLS-3 a store with nothing yet may move its currency', none === null, String(none));
  } catch (e) {
    ok('the run reached its end', false, e && e.stack);
  } finally {
    for (const [leg, store] of stores) {
      try { await withEntity(store.id, (db) => db.query('DELETE FROM ' + LEGS[leg].table + ' WHERE entity_id = $1', [store.id])); } catch (e) { console.log('  cleanup ' + leg + ': ' + e.message); }
    }
    for (const id of made) { try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup identity: ' + e.message); } }
  }
  console.log('\n' + (fail ? 'FAIL ' + fail + ' · ' : 'ok ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
