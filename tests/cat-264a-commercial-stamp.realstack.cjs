'use strict';
/**
 * tests/cat-264a-commercial-stamp.realstack.cjs — CAT-264a on a REAL Postgres, as the role the api runs as (cb_app, NOBYPASSRLS), after migrations/b845.
 *
 * One shop, one item per case, every write through withEntity (RLS on). The stamp is catalogue_items.commercial_changed_at, set by ONE BEFORE trigger:
 *   K-*   each key of the ONE list (cb_item_commercial_keys) moves the stamp when its value changes
 *   N-*   what must NOT move it: a rename, a unit, a sku, is_active alone (also: updated_at stays), "100.00" / {amount:100} for 100, 100 to 100.0 in a rate
 *   C-*   currency: INR to AUD at the same amount moves it (and cuts a version); the CUR-1 backfill (bare price to {amount,currency}, same value) stamps nothing and cuts no version
 *   R-*   a whole-document REPLACE of item_data keeps the stamp it earned; writing the stamp column directly is pinned; another shop cannot read the column
 *   L-*   the SQL key list equals the JS lists (till RECHECK_FIELDS ∪ RATE_KEYS ∪ currency)
 * Every row it makes is deleted at the end. Allow list: it runs only as cb_app on localhost, the compose db or a SIT host.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/cat-264a-commercial-stamp.realstack.cjs   (CI: the integration S41 job; SIT: inside the api container)
 * CARD      06-catalogue-pim/README
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
const fs = require('fs'), path = require('path');
const { withEntity, query } = require('../db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'cs' + (Date.now() % 1e10).toString(36);
const made = [];
const BASE = () => ({ name: 'Tea ' + RUN, price: { amount: 100, currency: 'INR' }, mrp: 150, hsn: '0902', tax_slab: 'gst-18', tax_slab_name: 'GST 18', gst_rate: 18, cess_rate: 0, categories: ['beverage'], category: 'beverage', status: 'available', unit: 'kg', sku: 'T-1' });
/** a different value for each key of the ONE list (currency is its own case C-1) */
const CHANGED = { price: { amount: 120, currency: 'INR' }, mrp: 160, hsn: '0903', tax_slab: 'gst-12', tax_slab_name: 'GST 12', gst_rate: 12, cess_rate: 1, categories: ['beverage', 'hot'], category: 'hot', status: 'sold_out' };
const readJsLists = () => {
  const till = fs.readFileSync(path.join(__dirname, '..', 'tools/tally-connector/till.html'), 'utf8');
  const recheck = [...(/var RECHECK_FIELDS = \[([^\]]+)\]/.exec(till)[1]).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  return [...new Set([...recheck, ...require('../lib/rate-door').RATE_KEYS, 'currency'])].sort();
};

async function shop(tag) {
  const row = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN + tag, 'Stamp ' + tag + ' ' + RUN]);
  made.push(row.rows[0].identity_id);
  return row.rows[0].identity_id;
}
/** a new item written as the shop; its id */
const add = (id, data) => withEntity(id, async (db) => (await db.query('INSERT INTO catalogue_items (entity_id, item_data) VALUES ($1, $2::jsonb) RETURNING item_id', [id, JSON.stringify(data)])).rows[0].item_id);
/** the stamp, updated_at, is_active and the version count of one item, read as the shop */
const look = (id, item) => withEntity(id, async (db) => (await db.query(
  `SELECT commercial_changed_at AS stamp, updated_at, is_active, (SELECT count(*)::int FROM catalogue_item_version v WHERE v.item_id = $1) AS versions FROM catalogue_items WHERE item_id = $1`, [item])).rows[0]);
/** one UPDATE in its own transaction (so now() differs between steps) */
const write = (id, sql, args) => withEntity(id, (db) => db.query(sql, args));
const setData = (id, item, data) => write(id, 'UPDATE catalogue_items SET item_data = $2::jsonb WHERE item_id = $1', [item, JSON.stringify(data)]);
/** did writing `data` move the stamp? (true / false) plus both reads */
async function moves(id, item, data) {
  const before = await look(id, item);
  await setData(id, item, data);
  const after = await look(id, item);
  return { moved: after.stamp > before.stamp, before, after };
}

(async () => {
  console.log('\n── CAT-264a commercial stamp under RLS · run ' + RUN + ' ──');
  try {
    const A = await shop('a'), B = await shop('b');

    const keys = (await query('SELECT cb_item_commercial_keys() AS k')).rows[0].k;
    ok('L-1 the SQL key list equals till RECHECK_FIELDS ∪ RATE_KEYS ∪ currency', JSON.stringify([...keys].sort()) === JSON.stringify(readJsLists()), keys.join(','));
    const made_ = Object.keys((await query(`SELECT cb_item_fields('{}'::jsonb) AS f`)).rows[0].f);
    ok('L-2 cb_item_fields makes every key of the list', keys.every((key) => made_.includes(key)), made_.join(','));

    for (const key of Object.keys(CHANGED)) {
      const item = await add(A, BASE());
      const r = await moves(A, item, { ...BASE(), [key]: CHANGED[key] });
      ok('K-' + key + ' changing ' + key + ' moves the stamp', r.moved, JSON.stringify(r));
    }
    const keyless = Object.keys(CHANGED).length;
    ok('K-all every key of the list but currency has a case (' + keyless + ' of ' + (keys.length - 1) + ')', keyless === keys.length - 1, keys.join(','));

    const quiet = await add(A, BASE());
    for (const [what, patch] of [['a rename', { name: 'Tea 2' }], ['a unit', { unit: 'g' }], ['a sku', { sku: 'T-2' }], ['a stock count', { stock: 7 }], ['an alias and offers_excluded', { alias: 'chai', offers_excluded: true }]]) {
      const r = await moves(A, quiet, { ...BASE(), ...patch });
      ok('N-' + what + ' does not move the stamp', !r.moved, JSON.stringify(r));
    }
    for (const [what, price] of [['"100.00" for 100', { amount: '100.00', currency: 'INR' }], ['{amount:100.0}', { amount: 100.0, currency: 'INR' }], ['100 written again', { amount: 100, currency: 'INR' }]]) {
      const r = await moves(A, quiet, { ...BASE(), price });
      ok('N-price ' + what + ' is the same price: no move', !r.moved, JSON.stringify(r));
    }
    const rate = await moves(A, quiet, { ...BASE(), gst_rate: '18.00', mrp: '150.0' });
    ok('N-rate "18.00" for 18 and mrp "150.0" for 150 are numbers, not changes', !rate.moved, JSON.stringify(rate));

    const flip = await look(A, quiet);
    await write(A, 'UPDATE catalogue_items SET is_active = false WHERE item_id = $1', [quiet]);
    const gone = await look(A, quiet);
    await write(A, 'UPDATE catalogue_items SET is_active = true WHERE item_id = $1', [quiet]);
    const back = await look(A, quiet);
    ok('N-is_active alone (off and on) does not move the stamp', +flip.stamp === +gone.stamp && +gone.stamp === +back.stamp, JSON.stringify({ flip, gone, back }));
    ok('N-is_active alone does not move updated_at either (the stated choice, catalogue-write.js:196)', +flip.updated_at === +gone.updated_at && +gone.updated_at === +back.updated_at, JSON.stringify({ flip, gone, back }));
    const price = await look(A, quiet);
    await setData(A, quiet, { ...BASE(), price: { amount: 130, currency: 'INR' } });
    const priced = await look(A, quiet);
    ok('N-a price change leaves updated_at to the app (the trigger never writes it)', +priced.updated_at === +price.updated_at && priced.stamp > price.stamp, JSON.stringify({ price, priced }));

    const cur = await add(A, BASE());
    const aud = await moves(A, cur, { ...BASE(), price: { amount: 100, currency: 'AUD' } });
    ok('C-1 INR to AUD at the same amount moves the stamp', aud.moved, JSON.stringify(aud));
    ok('C-1b ... and cuts a version (the history keeps the move)', aud.after.versions === aud.before.versions + 1, JSON.stringify(aud));
    const bare = await add(A, { ...BASE(), price: 100 });
    for (const [what, p] of [['number to {amount,currency}', { amount: 100, currency: 'INR' }], ['string to {amount,currency}', { amount: '100.00', currency: 'INR' }]]) {
      await setData(A, bare, { ...BASE(), price: 100 });
      const r = await moves(A, bare, { ...BASE(), price: p });
      ok('C-2 the CUR-1 backfill, ' + what + ', same value: no stamp, no version', !r.moved && r.after.versions === r.before.versions, JSON.stringify(r));
    }

    const rep = await add(A, { ...BASE(), price_changed_at: '2026-01-01T00:00:00Z' });
    const earned = await moves(A, rep, { ...BASE(), price: { amount: 140, currency: 'INR' } });
    const replaced = await moves(A, rep, { name: 'Tea ' + RUN, price: { amount: 140, currency: 'INR' } });
    ok('R-1 a whole-document REPLACE that drops price_changed_at and the rate keys: the earned stamp is kept, not erased', earned.moved && +replaced.after.stamp >= +earned.after.stamp, JSON.stringify({ earned, replaced }));
    const pin = await look(A, rep);
    await write(A, `UPDATE catalogue_items SET commercial_changed_at = '2001-01-01' WHERE item_id = $1`, [rep]);
    ok('R-2 writing the stamp column directly is pinned to its old value', +(await look(A, rep)).stamp === +pin.stamp);
    const seen = await withEntity(B, async (db) => (await db.query('SELECT commercial_changed_at FROM catalogue_items WHERE item_id = $1', [rep])).rows.length);
    ok('R-3 another shop cannot read the column (RLS)', seen === 0, 'rows ' + seen);
  } catch (e) {
    ok('the run reached its end', false, e && e.stack);
  } finally {
    for (const id of made) {
      try { await withEntity(id, (db) => db.query('DELETE FROM catalogue_items WHERE entity_id = $1', [id])); } catch (e) { console.log('  cleanup items: ' + e.message); }
      try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup identity: ' + e.message); }
    }
  }
  console.log('\n' + (fail ? 'FAIL ' + fail + ' · ' : 'ok ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
