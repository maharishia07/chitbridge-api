/**
 * till-demo.cjs — A SHOP TO TRY THE COUNTER WITH (2026-09-07).
 *
 * Mints a throwaway entity, puts a few things on its shelf, and prints a till key — so the DESKTOP host (tools/tally-connector/till.js)
 * can be run against something real without borrowing anybody's live account. It writes nothing to an existing shop.
 *
 *   node e2e/till-demo.cjs                → prints the key and the shop's name
 *   node e2e/till-demo.cjs --write DIR    → also writes DIR/connector.json, ready for: node till.js --config DIR/connector.json
 */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { mintEntity, addProduct } = require('./fixtures');

const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const argv = process.argv.slice(2);
const outDir = argv.includes('--write') ? argv[argv.indexOf('--write') + 1] : null;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: WEB });
  const name = 'Counter demo ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name });
  for (const p of [
    { name: 'Tomato', unit: 'kg', price: 40, code: 'TOM' },
    { name: 'Onion', unit: 'kg', price: 35, code: 'ONI' },
    { name: 'Cooking oil 1L', unit: 'litre', price: 250, code: 'OIL' },
    { name: 'Rice 5kg', unit: 'bag', price: 480, code: 'RICE5' },
  ]) await addProduct(page, p);

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'counter demo', scopes: ['till'], days: 30 } }); })).key;

  console.log('\nshop : ' + name);
  console.log('api  : ' + API);
  console.log('key  : ' + key);
  console.log('\nweb counter : ' + WEB + '/till.html#key=' + encodeURIComponent(key));
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, 'connector.json');
    fs.writeFileSync(file, JSON.stringify({ api: API, key, configured: true, adapter: 'csv', name: 'Counter demo',
      till: { id: 'C1', name: 'Counter 1', port: 7071, refreshMinutes: 15, drainSeconds: 20 } }, null, 2) + '\n');
    console.log('desktop till: node tools/tally-connector/till.js --config "' + file + '"');
  }
  console.log('');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
