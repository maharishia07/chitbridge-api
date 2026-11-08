'use strict';
/**
 * tests/cat-313-search-blind.realstack.cjs — CAT-313 / CAT-314 on a REAL Postgres: GET /api/products?q= looks only at the named visible fields.
 *
 * The route builds its WHERE through lib/catalogue-search.shelfWhere (the same for every caller), so what a cost-blind editor can find is what ANYONE can find:
 *   S-1  the exact hidden cost (4242.5, and 4242.50 / "4242") finds 0 rows — the cent-step loop that read a cost is dead
 *   S-2  the owner (cost permission) still finds the same product by its name, sku and brand
 *   S-3  q='%' and q='_' and a backslash match only a literal %, _ or \ (a product named "100% pure" is found by '%', not every product)
 *   S-4  a field NAME ("cost", "supplier_name", "name") matches nothing; a hidden supplier value matches nothing
 *   W-1  routes/products.js GET / uses shelfWhere and no longer holds `item_data::text ILIKE`
 *   C-1  no search field is a cost key (cost.isCostKey)
 * Every row it makes is deleted at the end. Allow list: localhost, the compose db or a SIT host. Meant for cb_app (RLS on): every row goes through withEntity.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/cat-313-search-blind.realstack.cjs
 * CARD      06-catalogue-pim/README
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL on localhost, the compose db or a SIT host'); process.exit(3); }
const fs = require('fs'), path = require('path');
const { withEntity, query } = require('../db');
const cost = require('../lib/cost');
const { shelfWhere, SEARCH_FIELDS } = require('../lib/catalogue-search');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'sb' + (Date.now() % 1e10).toString(36);

(async () => {
  console.log('\n── CAT-313/314 search sees visible fields only · run ' + RUN + ' ──');
  let shop = null;
  try {
    shop = (await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN, 'Search ' + RUN])).rows[0].identity_id;
    const add = (data) => withEntity(shop, async (db) => (await db.query('INSERT INTO catalogue_items (entity_id, item_data) VALUES ($1, $2::jsonb) RETURNING item_id', [shop, JSON.stringify(data)])).rows[0].item_id);
    const dosa = await add({ name: 'Masala Dosa ' + RUN, sku: 'DOSA-' + RUN, brand: 'Udupi', cost: 4242.5, unit_cost: 4242.5, supplier_name: 'Hidden Supplier ' + RUN, margin: 31.7, price: { amount: 70, currency: 'INR' } });
    const pure = await add({ name: '100% pure ghee ' + RUN, sku: 'GH_1-' + RUN });
    const BS = String.fromCharCode(92); /* one backslash */
    const slash = await add({ name: 'Path a' + BS + 'b ' + RUN });
    const plain = await add({ name: 'Plain tea ' + RUN });
    /** ids found for q, among this run's four rows */
    const find = async (q) => {
      const f = shelfWhere(shop, q); /* the route's own fragment: entity_id $1, pattern $2 */
      const r = await withEntity(shop, (db) => db.query('SELECT item_id FROM catalogue_items WHERE ' + f.where, f.params));
      return r.rows.map((x) => x.item_id);
    };
    const only = (got, ...want) => got.length === want.length && want.every((id) => got.includes(id));

    for (const q of ['4242.5', '4242.50', '4242', '42', '31.7', 'Hidden Supplier ' + RUN]) ok('S-1 hidden value "' + q + '" finds 0 rows', (await find(q)).length === 0, JSON.stringify(await find(q)));
    ok('S-2 owner finds the product by name', only(await find('masala dosa'), dosa));
    ok('S-2 ... by sku', only(await find('DOSA-' + RUN), dosa));
    ok('S-2 ... by brand', only(await find('udupi'), dosa));
    ok("S-3 q='%' matches only the product that holds a literal %", only(await find('%'), pure));
    ok("S-3 q='_' matches only the product that holds a literal _", only(await find('_'), pure));
    ok('S-3 a lone backslash matches only the product that holds a literal backslash', only(await find(BS), slash));
    ok("S-3 q='100%' is literal too", only(await find('100%'), pure));
    ok("S-3 q='p_re' does not wildcard-match 'pure'", (await find('p_re')).length === 0);
    for (const q of ['cost', 'unit_cost', 'supplier_name', 'margin', 'item_id', 'amount', 'currency']) ok('S-4 field name "' + q + '" matches nothing', (await find(q)).length === 0, JSON.stringify(await find(q)));
    ok('S-4 the name field is not a key to match: "name" finds nothing', (await find('"name"')).length === 0);
    ok('C-1 no search field is a cost key', SEARCH_FIELDS.every((field) => !cost.isCostKey(field)), SEARCH_FIELDS.join());
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes/products.js'), 'utf8');
    ok('W-1 GET / goes through shelfWhere', src.includes('catSearch.shelfWhere(entity_id, q)'));
    ok('W-1 no whole-record ILIKE left in routes/products.js', !/item_data::text\s+ILIKE/i.test(src));
    void plain;
  } catch (e) {
    fail++; console.log('  FAIL threw: ' + (e && e.stack || e));
  } finally {
    if (shop) { await withEntity(shop, (db) => db.query('DELETE FROM catalogue_items WHERE entity_id=$1', [shop])).catch((e) => console.log('  cleanup items: ' + e.message)); await query('DELETE FROM identities WHERE identity_id=$1', [shop]).catch((e) => console.log('  cleanup identity: ' + e.message)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
