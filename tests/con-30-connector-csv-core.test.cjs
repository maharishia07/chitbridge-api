/**
 * tests/con-30-connector-csv-core.test.cjs — CON-30 · THE CONNECTOR core: products up, offers back, orders down — through the CSV adapter (the system-neutral proof).
 * OWNS      the proof of the CSV adapter (readProducts, readStock, pushOrder, pushReceipt) and of tools/tally-connector/core.js syncProducts (products up, once: receipts) and evaluate (offers back).
 * CALLED BY scripts/guards.cjs (P2 PROOF pass 2026-11-14; the zoho/b2b/purchase/gofrugal e2e cases already ran green offline)
 * FLOW      temp dir with products.csv → real csvAdapter + real core.syncProducts with a stand-in `cb` → what was added/edited, the receipts, the files written
 * CARD      23-connectors-and-integrations
 * Hand-computed: 2 CSV rows ("Tea, Assam" 250.5 with a comma in the name; Salt 20, no unit) · CB already holds Salt at 15 → 1 added, 1 updated, 0 unchanged; a second run → 0 added, 0 updated, 2 unchanged (the receipts).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ok, done, API } = require('./lib/cat-proof-kit.cjs');
const core = require(path.join(API, 'tools', 'tally-connector', 'core.js'));
const csvAdapter = require(path.join(API, 'tools', 'tally-connector', 'adapters', 'csv.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'con30-'));
fs.writeFileSync(path.join(dir, 'products.csv'), 'name,code,unit,price,hsn,category\n"Tea, Assam",T1,kg,250.5,0902,Beverages\nSalt,S1,,20,,\n');
fs.writeFileSync(path.join(dir, 'stock.csv'), 'code,qty\nT1,12\nS1,x\nS9,3\n');
const cfg = { csv: { dir }, _configFile: path.join(dir, 'connector.json') };

(async () => {
  console.log('\nCON-30 · CSV adapter');
  const a = csvAdapter(cfg);
  const prods = await a.readProducts();
  ok('readProducts: 2 rows; a quoted comma stays inside the name; price is a number', prods.length === 2 && prods[0].name === 'Tea, Assam' && prods[0].code === 'T1' && prods[0].price === 250.5 && prods[0].hsn === '0902' && prods[0].category === 'Beverages', JSON.stringify(prods));
  ok('readProducts: a blank unit becomes "unit", a blank hsn/category null', prods[1].unit === 'unit' && prods[1].hsn === null && prods[1].category === null && prods[1].price === 20, JSON.stringify(prods[1]));
  const stock = await a.readStock();
  ok('readStock: stock.csv (code, qty) — a non-number quantity is dropped (S1 "x"), 2 rows kept', stock.length === 2 && stock[0].code === 'T1' && stock[0].qty === 12 && stock[1].code === 'S9' && stock[1].qty === 3, JSON.stringify(stock));
  const order = { chit_id: 'c-1', buyer: 'Asha', lines: [{ name: 'Tea', code: 'T1', qty: 2, unit: 'kg', price: 225, list_price: 250, offer: { label: '10% off', off: 25 }, total: 450 }, { name: 'Salt', code: '', qty: 1, unit: 'unit', price: 20, list_price: null, offer: null, total: 20 }] };
  const pushed = await a.pushOrder(order);
  const written = fs.readFileSync(path.join(dir, 'orders', 'c-1.csv'), 'utf8').split('\n');
  ok('pushOrder writes orders/<chit_id>.csv: a header and one row per line (3 lines + the closing newline)', written.length === 4 && written[0] === 'chit,buyer,name,code,qty,unit,price,list_price,offer,total', String(written.length));
  ok('pushOrder row 1 carries buyer, code, qty, list_price 250, the offer "10% off −25" and total 450', written[1] === '"c-1","Asha","Tea","T1","2","kg","225","250","10% off −25","450"', written[1]);
  ok('pushOrder row 2: blank code, blank list_price, blank offer', written[2] === '"c-1","Asha","Salt","","1","unit","20","","","20"', written[2]);
  ok('pushOrder answers its file as the ref', /c-1\.csv$/.test(pushed.ref));
  await a.pushReceipt({ chit_id: 'c-1', at: '2026-11-14T10:00:00Z', method: 'upi', ref: 'U1', amount: 470, buyer: 'Asha' });
  await a.pushReceipt({ chit_id: 'c-2', at: '2026-11-14T11:00:00Z', method: 'cash', amount: 50 });
  const rc = fs.readFileSync(path.join(dir, 'orders', 'receipts.csv'), 'utf8').trim().split('\n');
  ok('pushReceipt appends one line per payment under one header (3 lines)', rc.length === 3 && rc[0] === 'chit,at,method,ref,amount,buyer' && rc[1] === '"c-1","2026-11-14T10:00:00Z","upi","U1","470","Asha"' && rc[2] === '"c-2","2026-11-14T11:00:00Z","cash","","50",""', rc.join(' | '));

  console.log('\nCON-30 · core: products up (once), offers back');
  const calls = { add: [], edit: [], eval: [] };
  const cb = {
    products: async () => [{ item_id: 'X9', item_data: { name: 'Salt', code: 'S1', price: 15, keep_me: 'yes' } }],
    addProducts: async (items) => { calls.add.push(items); return {}; },
    editProduct: async (id, d) => { calls.edit.push({ id, d }); return {}; },
    evaluate: async (lines, offers) => { calls.eval.push({ lines, offers }); return { lines: [] }; }
  };
  const receipts = new core.Receipts(path.join(dir, 'receipts.jsonl'));
  let r = await core.syncProducts({ cb, adapter: a, receipts, log: () => {} });
  ok('first run: read 2, added 1 (Tea), updated 1 (Salt), unchanged 0, failed 0', r.read === 2 && r.added === 1 && r.updated === 1 && r.unchanged === 0 && r.failed === 0, JSON.stringify(r));
  ok('the added product is the CSV row: name "Tea, Assam", price 250.5, source_system "csv"', calls.add.length === 1 && calls.add[0][0].name === 'Tea, Assam' && calls.add[0][0].price === 250.5 && calls.add[0][0].source_system === 'csv', JSON.stringify(calls.add));
  ok('the edit goes to the existing item X9 with price 20, keeping fields the CSV does not own (keep_me)', calls.edit.length === 1 && calls.edit[0].id === 'X9' && calls.edit[0].d.price === 20 && calls.edit[0].d.keep_me === 'yes', JSON.stringify(calls.edit));
  ok('a receipt per product was written (2 ok lines in receipts.jsonl)', fs.readFileSync(path.join(dir, 'receipts.jsonl'), 'utf8').trim().split('\n').filter((l) => /"outcome":"ok"/.test(l)).length === 2);
  r = await core.syncProducts({ cb, adapter: a, receipts: new core.Receipts(path.join(dir, 'receipts.jsonl')), log: () => {} });
  ok('second run: nothing sent again — added 0, updated 0, unchanged 2', r.added === 0 && r.updated === 0 && r.unchanged === 2 && calls.add.length === 1 && calls.edit.length === 1, JSON.stringify(r));
  await core.evaluate({ cb, lines: [{ code: 'T1', name: 'Tea', qty: '2', price: '250' }, { key: 'k', sku: 'S1', name: 'Salt', qty: 1, unitPrice: 20 }], offers: [{ id: 'o1' }] });
  const e = calls.eval[0];
  ok('offers back: evaluate sends normalised lines (string key, sku from code, numeric qty and unitPrice) and the offers to the ONE explain call', e && e.lines[0].key === '0' && e.lines[0].sku === 'T1' && e.lines[0].qty === 2 && e.lines[0].unitPrice === 250 && e.lines[1].key === 'k' && e.lines[1].sku === 'S1' && e.lines[1].unitPrice === 20 && e.offers.length === 1, JSON.stringify(e));
  const o = core.orderOf({ header: { chit_id: 'c9', purpose: 'order' }, detail: { line_items: [{ name: 'Tea', code: 'T1', quantity: 2, unit: 'kg', price: 225, list_price: 250, offer: { label: '10% off', off: 25 }, total: 450 }] } });
  ok('an order down keeps the offer that was applied: list 250, price 225, offer "10% off" 25, total 450', o.lines[0].list_price === 250 && o.lines[0].price === 225 && o.lines[0].offer.label === '10% off' && o.lines[0].offer.off === 25 && o.total === 450, JSON.stringify(o.lines));
  fs.rmSync(dir, { recursive: true, force: true });
  done();
})();
