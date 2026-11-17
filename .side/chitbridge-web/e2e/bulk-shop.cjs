/**
 * bulk-shop.cjs — A SHOP WITH TEN THOUSAND THINGS IN IT (Athi, 2026-09-08: "can you add a product catalogue size of say 10,000 or
 * 100,000 with real data and category etc, maximum attributes and variants, and see how it behaves on desktop, mobile and the browser?").
 *
 * Builds a REAL catalogue — not lorem: an Indian general store's departments, real units, real HSN codes, real GST rates, prices that
 * make sense for what the thing is, variants (size, grade, pack), and the declared columns filled. Then it measures what matters:
 * how long the counter takes to take its copy, how big that copy is, and how fast a search over it is.
 *
 *   node e2e/bulk-shop.cjs --count 10000            build it and measure
 *   node e2e/bulk-shop.cjs --count 10000 --keep     print the till key so the screens can be tried by hand
 *
 * ⚠️ It builds its OWN throwaway entity. It never touches an existing shop.
 */
'use strict';
const { chromium } = require('@playwright/test');
const { mintEntity } = require('./fixtures');

const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const COUNT = Number(flag('count', 10000)) || 10000;
const BATCH = 200;                       /* the API's own limit per request */

/* ── a real shop's shelves. HSN and GST are the actual Indian codes for these goods. ───────────────────────── */
const DEPTS = [
  { cat: 'Rice & grains',   hsn: '1006', gst: 0,  unit: 'kg',    base: 55,  names: ['Ponni raw rice', 'Sona masoori', 'Idli rice', 'Basmati', 'Brown rice', 'Broken wheat', 'Ragi', 'Bajra', 'Jowar', 'Wheat'] },
  { cat: 'Pulses',          hsn: '0713', gst: 0,  unit: 'kg',    base: 120, names: ['Toor dal', 'Urad dal', 'Moong dal', 'Chana dal', 'Masoor dal', 'Rajma', 'Black chana', 'White peas', 'Green moong', 'Kabuli chana'] },
  { cat: 'Edible oil',      hsn: '1512', gst: 5,  unit: 'litre', base: 145, names: ['Sunflower oil', 'Groundnut oil', 'Gingelly oil', 'Coconut oil', 'Mustard oil', 'Rice bran oil', 'Olive oil', 'Palmolein', 'Ghee', 'Vanaspati'] },
  { cat: 'Spices',          hsn: '0910', gst: 5,  unit: 'gram',  base: 3,   names: ['Turmeric powder', 'Chilli powder', 'Coriander powder', 'Cumin seed', 'Mustard seed', 'Fenugreek', 'Pepper', 'Cardamom', 'Cloves', 'Cinnamon'] },
  { cat: 'Vegetables',      hsn: '0709', gst: 0,  unit: 'kg',    base: 40,  names: ['Tomato', 'Onion', 'Potato', 'Carrot', 'Beans', 'Brinjal', 'Ladies finger', 'Cabbage', 'Cauliflower', 'Drumstick'] },
  { cat: 'Fruit',           hsn: '0808', gst: 0,  unit: 'kg',    base: 90,  names: ['Apple', 'Banana', 'Grapes', 'Orange', 'Pomegranate', 'Guava', 'Papaya', 'Watermelon', 'Sapota', 'Mango'] },
  { cat: 'Dairy',           hsn: '0401', gst: 5,  unit: 'litre', base: 54,  names: ['Toned milk', 'Full cream milk', 'Curd', 'Butter milk', 'Paneer', 'Butter', 'Cheese', 'Cream', 'Flavoured milk', 'Lassi'] },
  { cat: 'Biscuits & snacks', hsn: '1905', gst: 18, unit: 'pack', base: 20, names: ['Marie biscuit', 'Glucose biscuit', 'Cream biscuit', 'Rusk', 'Namkeen mix', 'Banana chips', 'Murukku', 'Potato chips', 'Puffs', 'Cookies'] },
  { cat: 'Cleaning',        hsn: '3401', gst: 18, unit: 'piece', base: 35,  names: ['Detergent bar', 'Detergent powder', 'Dish wash bar', 'Dish wash liquid', 'Floor cleaner', 'Toilet cleaner', 'Bleach', 'Scrub pad', 'Broom', 'Phenyl'] },
  { cat: 'Personal care',   hsn: '3401', gst: 18, unit: 'piece', base: 45,  names: ['Bath soap', 'Shampoo sachet', 'Hair oil', 'Tooth paste', 'Tooth brush', 'Face cream', 'Talc', 'Razor', 'Sanitary pad', 'Hand wash'] },
];
const BRANDS = ['Aachi', 'Anil', 'Idhayam', 'Sakthi', 'Nandini', 'Aavin', 'Britannia', 'Parle', 'Local', 'Farm fresh', 'Gold', 'Daily'];
const PACKS = ['100 g', '250 g', '500 g', '1 kg', '2 kg', '5 kg', '200 ml', '500 ml', '1 L', '5 L', 'single', 'family pack'];
const GRADES = ['A', 'B', 'premium', 'economy', 'organic'];

const r = (n) => Math.floor(Math.random() * n);
const money = (n) => Math.round(n * 100) / 100;

function build(i) {
  const d = DEPTS[i % DEPTS.length];
  const name = d.names[r(d.names.length)];
  const brand = BRANDS[r(BRANDS.length)];
  const pack = PACKS[r(PACKS.length)];
  const grade = GRADES[r(GRADES.length)];
  const price = money(d.base * (0.6 + Math.random() * 1.8));
  return {
    name: brand + ' ' + name + ' ' + pack,
    code: (d.cat.slice(0, 3).toUpperCase() + '-' + String(i).padStart(6, '0')),
    sku: 'SKU' + String(100000 + i),
    barcode: String(8901000000000 + i),
    unit: d.unit,
    price: price,
    mrp: money(price * 1.15),
    hsn: d.hsn,
    category: d.cat,
    brand: brand,
    variant: pack,
    grade: grade,
    desc: brand + ' ' + name + ', ' + pack + ', grade ' + grade + ' — ' + d.cat.toLowerCase(),
    gst_rate: d.gst,
    /* the sort of extra columns a real catalogue declares */
    shelf: 'A' + (1 + r(24)) + '-' + (1 + r(8)),
    origin: ['Tamil Nadu', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Maharashtra'][r(5)],
    avail: { qty: r(400), at: new Date().toISOString() },
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: WEB });
  const shop = 'Bulk shop ' + COUNT + ' ' + Date.now().toString().slice(-5);
  console.log('shop: ' + shop + '\nbuilding ' + COUNT + ' products…');
  await mintEntity(page, { fresh: true, name: shop });

  const t0 = Date.now();
  let made = 0, failed = 0;
  for (let i = 0; i < COUNT; i += BATCH) {
    const items = []; for (let k = 0; k < Math.min(BATCH, COUNT - i); k++) items.push(build(i + k));
    const r2 = await page.evaluate(async (batch) => {
      try { const x = await api('prodAddMany', { body: { items: batch } }); return { ok: true, n: (x && (x.added || x.count || (x.items || []).length)) || batch.length }; }
      catch (e) { return { ok: false, error: String(e && e.message) }; }
    }, items);
    if (r2.ok) made += r2.n; else { failed += items.length; if (failed <= BATCH) console.log('  batch failed: ' + r2.error); }
    if ((i / BATCH) % 5 === 0) process.stdout.write('  ' + made + '/' + COUNT + ' (' + Math.round((Date.now() - t0) / 1000) + 's)\r');
  }
  console.log('\nbuilt ' + made + ' in ' + Math.round((Date.now() - t0) / 1000) + 's' + (failed ? ' · ' + failed + ' failed' : ''));

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'bulk till', scopes: ['till'], days: 7 } }); })).key;

  /* ── what it costs the counter ── */
  const measure = async (label, url) => {
    const t = Date.now();
    const res = await page.request.get(API + url, { headers: { 'X-Api-Key': key } });
    const body = await res.text();
    console.log('  ' + label.padEnd(34) + (Date.now() - t) + ' ms · ' + (body.length / 1024 / 1024).toFixed(2) + ' MB');
    return JSON.parse(body);
  };
  console.log('\nthe counter taking its copy:');
  const snap = await measure('first read (everything)', '/api/till/snapshot');
  console.log('  items in the copy'.padEnd(36) + (snap.items || []).length);
  await measure('a refresh with nothing changed', '/api/till/snapshot?since=' + encodeURIComponent(snap.at));

  /* ── searching that copy, in the browser, the way the till does ── */
  const search = await page.evaluate((items) => {
    const t = performance.now();
    const out = [];
    for (const q of ['tom', 'oil', 'rice 1', 'SKU100500', 'aachi', 'z']) {
      const t1 = performance.now();
      const hits = items.filter((i) => String(i.name || '').toLowerCase().indexOf(q.toLowerCase()) >= 0
        || String(i.code || '').toLowerCase().indexOf(q.toLowerCase()) >= 0
        || String(i.barcode || '').toLowerCase() === q.toLowerCase()).slice(0, 60);
      out.push({ q, hits: hits.length, ms: Math.round((performance.now() - t1) * 100) / 100 });
    }
    return { total: Math.round(performance.now() - t), per: out };
  }, snap.items || []);
  console.log('\nsearching that copy in the browser (what a keystroke costs):');
  search.per.forEach((p) => console.log('  ' + ('"' + p.q + '"').padEnd(14) + p.ms + ' ms · ' + p.hits + ' hits'));

  console.log('\nshop : ' + shop);
  if (flag('keep', false)) console.log('till : ' + WEB + '/till.html#key=' + encodeURIComponent(key));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
