/**
 * tests/t3-fixes.test.cjs — Round T3-FIXES (MAINT-PLAN CAT-FIX1 · STK-FIX1 · SIGNIN-CONST). No network, no database.
 *
 *   STK-FIX1     a received line's lot is the OBJECT {batch, expiry} the till writes — each batch its own lot, with its date
 *   CAT-FIX1     one cost gate (lib/cost.writeRefusal) on PATCH /products, the schedule, POST /till/price and the combo push ·
 *                PATCH /entities/profile writes the SHOP's row · a cut workbook says so · the GTIN check digit is called
 *   SIGNIN-CONST an owner sign-in that names no constitution never re-stamps the shop to 'base'
 *
 * Run: node tests/t3-fixes.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const src = (rel) => fs.readFileSync(path.join(API, rel), 'utf8');

/* ── a database stub for lib/cost (can_see_costs per actor) — installed before anything requires ../db ── */
let CAN = {};
require.cache[require.resolve(path.join(API, 'db'))] = { id: 'db', loaded: true, exports: {
  query: async () => ({ rows: [] }),
  withEntity: async (_id, fn) => fn({ query: async (sql, p) => (/can_see_costs/.test(sql) ? { rows: [{ can_see_costs: !!CAN[p[0]] }] } : { rows: [] }) }),
} };

(async () => {
  console.log('\n-- STK-FIX1 · each received batch is its own lot, with its expiry --');
  const sfc = require(path.join(API, 'lib/stock-from-chit'));
  const lotfields = require(path.join(API, 'lib/lotfields'));
  const receipt = { chit_id: 'c1', purpose: 'receipt', business_json: { doc: 'receipt', client_ref: 'RCV-1' },
    line_items: [
      { particulars: 'Paracetamol 500', quantity: 10, price: 20, item_data: { item_id: 'p1', line_id: 'L1', unit_cost: 21, lot: { batch: 'A-4471', expiry: '2027-01-31', mrp: 30 } } },
      { particulars: 'Paracetamol 500', quantity: 5, price: 20, item_data: { item_id: 'p1', line_id: 'L2', unit_cost: 21, lot: { batch: 'b-0092', expiry: '2027-06-30' } } },
      { particulars: 'Phone', quantity: 1, price: 900, item_data: { item_id: 'p2', line_id: 'L3', unit_cost: 900, lot: { serial: 'SN123' } } },
      { particulars: 'Old shape', quantity: 2, price: 5, item_data: { item_id: 'p3', line_id: 'L4', unit_cost: 5, batch: 'OLD1', expiry: '2027-02-01' } },
    ] };
  const mv = sfc.movementsFor(receipt);
  const keys = mv.map((m) => lotfields.lotKey(m.lot));
  t('no lot is "[OBJECT OBJECT]"', keys.indexOf('[OBJECT OBJECT]') < 0, JSON.stringify(keys));
  t('two batches of one product are two lots', keys[0] === 'A-4471' && keys[1] === 'B-0092', JSON.stringify(keys));
  t('each lot carries its own expiry', mv[0].expires_at === '2027-01-31' && mv[1].expires_at === '2027-06-30', JSON.stringify(mv.map((m) => m.expires_at)));
  t('a serial-tracked line keys on its serial', mv[2].lot === 'SN123');
  t('an older flat batch/expiry is still read', mv[3].lot === 'OLD1' && mv[3].expires_at === '2027-02-01');
  t('a line with no lot stays one pool (null, never "{}")', sfc.lotOf({ item_data: { lot: null } }).lot === null
    && sfc.lotOf({ item_data: { lot: { mrp: 30 } } }).lot === null);

  const adopt = require(path.join(API, 'lib/adopt'));
  const seen = adopt.consider({ particulars: 'Paracetamol 500', item_data: { lot: { batch: 'A-4471', expiry: '2027-01-31' } } },
    { sectors: ['pharma'] }, { sectors: ['pharma'] });
  t('adopt: a lot object answers batch AND expiry (nothing "missing")', Array.isArray(seen.missing) && seen.missing.length === 0, JSON.stringify(seen.missing));

  console.log('\n-- CAT-FIX1 · one cost gate --');
  const cost = require(path.join(API, 'lib/cost'));
  const OWNER = { identity: { identity_id: 'e1', identity_type: 'entity' } };
  const BLIND = { identity: { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' } };
  const SEES = { identity: { identity_id: 'a2', identity_type: 'actor', parent_entity_id: 'e1' } };
  CAN = { a2: true };
  t('the owner is never refused', (await cost.writeRefusal(OWNER, 'e1', ['price'])) === null);
  const r = await cost.writeRefusal(BLIND, 'e1', ['price']);
  t('a cost-blind co-assist is refused a price, with a code', r && r.code === 'COST_BLIND' && /Co-assists/.test(r.message));
  t('…but may flip availability', (await cost.writeRefusal(BLIND, 'e1', ['status'])) === null);
  t('a co-assist granted "Sees costs" may', (await cost.writeRefusal(SEES, 'e1', ['price', 'name'])) === null);
  /* every door asks it before it writes */
  const products = src('routes/products.js'), till = src('routes/till.js'), combo = src('routes/combo-templates.js');
  const sched = products.slice(products.indexOf("router.post('/:id/schedule'"));
  t('POST /products/:id/schedule asks the gate before it schedules', sched.indexOf('writeRefusal') > 0 && sched.indexOf('writeRefusal') < sched.indexOf('schedule.schedule('));
  const patch = products.slice(products.indexOf("router.patch('/:id'"));
  t('PATCH /products/:id asks the same gate (no private copy)', patch.indexOf('writeRefusal') > 0 && products.indexOf('COST_BLIND_ALLOWED_FIELDS') < 0);
  const price = till.slice(till.indexOf("router.post('/price'"));
  t('POST /till/price asks the gate before its UPDATE', price.indexOf('writeRefusal') > 0 && price.indexOf('writeRefusal') < price.indexOf('UPDATE catalogue_items'));
  const push = combo.slice(combo.indexOf("router.post('/:id/push'"));
  t('the combo push asks the gate before it reads or writes', push.indexOf('writeRefusal') > 0 && push.indexOf('writeRefusal') < push.indexOf('SELECT name, definition'));

  console.log('\n-- CAT-FIX1 · the profile writes the shop --');
  const ent = src('routes/entities.js');
  const prof = ent.slice(ent.indexOf("router.patch('/profile'"), ent.indexOf("router.patch('/:id/erase'"));
  t('PATCH /entities/profile writes auth.entityOf(req), not the caller', /const id = auth\.entityOf\(req\);/.test(prof) && !/const id = req\.identity\.identity_id;/.test(prof));

  console.log('\n-- CAT-FIX1 · the import --');
  const pre = require(path.join(API, 'lib/csv-preflight'));
  const { gtinCheck } = require(path.join(API, 'routes/products'));
  const tpl = { columns: ['name', 'sku', 'price'], optional: [] };
  const rep = pre.preflight({ headers: ['Name', 'Barcode', 'Price'], template: tpl, codeCheck: gtinCheck,
    rows: [['Tea', '4006381333931', '10'], ['Dal', '4006381333932', '20'], ['Rice', 'RICE-5KG', '30']] });
  t('both import routes hand the preflight the GTIN check', (products.match(/codeCheck: gtinCheck/g) || []).length === 2);
  const gt = rep.issues.filter((i) => /Check digit/.test(i.message));
  t('a barcode failing its GTIN check digit is warned, naming the right digit', gt.length === 1 && gt[0].row === 3 && gt[0].severity === 'warn' && /should be 1/.test(gt[0].message), JSON.stringify(rep.issues));
  t('…a good GTIN and an internal SKU are not', !rep.issues.some((i) => i.row === 2 || i.row === 4));
  t('workbookCut reads xlsx-read\'s truncated flag, both routes call it', (products.match(/= workbookCut\(parsed\)/g) || []).length === 2 && /WORKBOOK_CUT/.test(products));
  const imp = products.slice(products.indexOf("router.post('/import', auth"));
  t('the commit refuses a cut workbook before it writes', imp.indexOf('workbookCut') > 0 && imp.indexOf('workbookCut') < imp.indexOf('commitFields'));

  console.log('\n-- SIGNIN-CONST --');
  const si = src('routes/signin.js');
  const mint = si.slice(si.indexOf('INSERT INTO entity_governance'), si.indexOf('INSERT INTO entity_governance') + 600);
  t('the stamp moves only when the request named it, or the key is unchanged',
    /WHERE \$5::boolean OR entity_governance\.constitution_key = EXCLUDED\.constitution_key/.test(mint), mint);
  t('"named" is the constitution actually found, not the default it fell back to',
    /const named = !!\(req\.body\.constitution && String\(req\.body\.constitution\)\.trim\(\) === c\.constitution_key\)/.test(si));

  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
