/**
 * tests/taxp1-1129-shelf-closed.test.cjs — TAX-01 r1 (GF M2), batch 1129: THE SEND FAILS CLOSED WHEN THE SHOP'S TAX DETAILS CANNOT BE READ.
 * lib/tax-shelf.readShelf already throws TAX_SHELF_UNREADABLE (503, refused:true; docs/ERROR-CODES.md row, tests/tax01-1128-shelf.test.cjs) when the identities read fails,
 * but routes/chits.js sendSeller caught every error from it ("carried on without it"), so the bill went out with no rate on its line: tax 0 on a taxed sale.
 * HAND FIGURES (minor units, paise): a GST shop sells one item at 100000 (1,000.00) at 18% -> tax 18000, total 118000. Read as "no tax details" the bill was 100000, short 18000.
 *   the read failing   -> sendSeller throws TAX_SHELF_UNREADABLE (the send answers it 503 through lib/knownerr), no bill is made
 *   the read working   -> sendSeller returns, the line's own rate resolves (18), nothing refused
 * Offline: the database is a stub that throws on the identities read. Run: node tests/taxp1-1129-shelf-closed.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const root = (p) => path.join(__dirname, '..', p);

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e));
  }
};

const SHOP = '5d111111-1111-4111-8111-111111111111';
const GSTIN = '27AAPFU0939F1ZV';
let identitiesRead = 'works';
const q = async (sql) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/FROM identities WHERE identity_id = \$1/.test(s) && /gstn, country, timezone/.test(s)) {
    if (identitiesRead === 'fails') throw new Error('pool timeout');
    return { rows: [{ gstn: GSTIN, country: 'IN', timezone: 'Asia/Kolkata' }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};
const dbId = require.resolve(root('db/index.js'));
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => fn(db).catch(() => fb) } };
const sc = require(root('lib/schema'));
sc.hasTable = async () => false;
sc.hasColumn = async () => false;
const { known } = require(root('lib/knownerr'));
const chits = require(root('routes/chits'));

const state = () => ({
  sender_id: SHOP,
  purpose: 'invoice',
  business_json: {},
  line_items: [{ particulars: 'Pump seal', quantity: 1, price: 1000 }],
  receiverDetails: [{ kind: 'to', entity_id: SHOP, bridge_id: 'CB', display_name: 'x', all_role: 'receiver' }],
  currency_code: 'INR'
});

(async () => {
  await t('the tax details cannot be read: the send is refused TAX_SHELF_UNREADABLE (503), never sent with no tax (118000 owed, not 100000)', async () => {
    identitiesRead = 'fails';
    await assert.rejects(
      () => chits.sendSeller(state(), { body: {} }, {}),
      (e) => {
        assert.equal(e.code, 'TAX_SHELF_UNREADABLE');
        const said = known(e);
        assert.ok(said && said.status === 503 && said.body.code === 'TAX_SHELF_UNREADABLE', 'the send door answers it as the register code');
        return true;
      }
    );
  });
  await t('the same read working: the send goes on (1,000.00 at 18% = 18000 tax, 118000 total)', async () => {
    identitiesRead = 'works';
    const st = state();
    await chits.sendSeller(st, { body: {} }, {});
    assert.equal(st.sellerId, SHOP);
    assert.equal(Math.round((100000 * 18) / 100), 18000);
    assert.equal(100000 + 18000, 118000);
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
