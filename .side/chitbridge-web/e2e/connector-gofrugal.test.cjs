/**
 * connector-gofrugal.test.cjs — the GoFrugal adapter against fake GoFrugal (from the published knowledge base).
 *   node e2e/connector-gofrugal.test.cjs
 * items → products with code (itemReferenceCode), price, MRP as list price, GST %; stock stamped from the same list;
 * an order → a Sales Order with our reference, their itemId per line, the offer as a discount %, the amount kept; a
 * line for something they do not stock is refused with the name; no profile/receipt/purchase (skipped with the reason).
 * CARD      23-connectors-and-integrations/zoho-gofrugal-b2b-purchase
 */
const { spawn } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const KIT = path.join(process.env.CB_API_REPO ? path.resolve(process.env.CB_API_REPO) : path.join(__dirname, '..', '..', 'chitbridge-api'), 'tools', 'tally-connector');   /* CI checks the api out beside the web (CB_API_REPO) */
const port = 8600 + Math.floor(Math.random() * 90);
const fake = spawn(process.execPath, [path.join(KIT, 'fake-gofrugal.js'), String(port)], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
(async () => {
  await new Promise((r) => setTimeout(r, 700));
  const G = require(path.join(KIT, 'adapters', 'gofrugal.js')); const core = require(path.join(KIT, 'core.js'));
  const a = G({ gofrugal: { url: 'http://localhost:' + port, token: 'k' }, log: () => {} });
  const receipts = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-gf-')), 'r.jsonl'));

  const prods = await a.readProducts();
  const bas = prods.find((p) => p.code === 'BAS-25');
  ok(prods.length === 3 && bas && bas.price === 1000 && bas.list_price === 1100 && bas.gst_rate === 5 && bas.ref === '101', 'items → products: code · price · MRP as list · GST %: ' + JSON.stringify(bas));
  const stock = await a.readStock();
  ok(stock.find((s) => s.code === 'BAS-25').qty === 120 && stock.find((s) => s.code === 'DAL-TOR-1').qty === 0, 'stock stamped from the same list (120 · 0)');

  const order = { chit_id: 'gf1aaaaa-0000', at: '2026-09-05T10:00:00Z', buyer: 'Priya', total: 2040, lines: [
    { name: 'Basmati 25kg', code: 'BAS-25', qty: 2, unit: 'bag', price: 1000, total: 1800, offer: { label: 'Buy 2 save 200', off: 200 } },
    { name: 'Groundnut Oil 1L', code: 'GNO-1', qty: 1, unit: 'count', price: 240, total: 240 } ] };
  const r = await a.pushOrder(order);
  const so = (await (await fetch('http://localhost:' + port + '/_orders')).json())[0];
  ok(r.ref === '1' && so && so.onlineReferenceNo === 'CB-gf1aaaaa' && so.customerName === 'Priya' && so.totalAmount === 2040, 'a Sales Order with our reference and the chit total: ' + JSON.stringify(so && { ref: so.onlineReferenceNo, t: so.totalAmount }));
  ok(so && so.orderItems[0].itemId === 101 && so.orderItems[0].discountPercentage === 10 && so.orderItems[0].itemAmount === 1800 && so.orderItems[1].itemId === 102, 'lines carry THEIR itemId; the offer is a 10% discount with the amount kept: ' + JSON.stringify(so && so.orderItems[0]));
  ok(/offers: Buy 2 save 200/.test(so.orderRemarks), 'the remarks name the offer');
  let refused = null; try { await a.pushOrder({ chit_id: 'gf2bbbbb-0000', buyer: 'Priya', lines: [{ name: 'Mystery item', code: 'NOPE', qty: 1, price: 10, total: 10 }] }); } catch (e) { refused = e.message; }
  ok(/not in GoFrugal: Mystery item/.test(refused || ''), 'a line they do not stock is refused by name: ' + refused);
  const rc = await core.pushReceipt({ cb: { chit: async () => ({ header: { chit_id: 'gf1aaaaa-0000', business_json: { payment: { method: 'cash', amount: 2040 } } } }) }, adapter: a, receipts, log: () => {}, chit_id: 'gf1aaaaa-0000' });
  ok(rc.outcome === 'skipped', 'no receipt API: the payment is skipped with the reason, never lost');

  console.log((fail ? 'RED ' : 'GREEN ') + pass + ' passed · ' + fail + ' failed');
  fake.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch((e) => { console.log('FAIL exception: ' + (e && e.stack || e.message)); fake.kill(); setTimeout(() => process.exit(1), 200); });
